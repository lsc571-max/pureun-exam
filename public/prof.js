// 푸른시험 — 교수 화면 (시험 목록 · 학생과 반 · 진행 · 문항 편집 · 채점 · 결과)
import * as C from './core.js';
import { S, be, parse } from './state.js';
import { media, typeChip, answerHtml } from './view.js';
import { hideToast } from './ui.js';
import { $, esc, on, toast, modal, closeModal, confirmBox, zoom, CIRCLED, errText, hhmmss, download, copyText, shrinkImage } from './ui.js';

const app = $('app');
let bind = {}, users = {}, entry = {}, P = null, clockT = 0, liveT = 0, baseSubs = [];
const LS = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
/* ----- 되돌리기 · 다시 하기 (Ctrl+Z · Ctrl+Y, 화면 버튼) — 최근 10번까지. 이 탭을 닫으면 사라집니다 ----- */
const HIST = { undo: [], redo: [] };
async function record(label, doFn, undoFn, guard = null) {
  await doFn();
  HIST.undo.push({ label, doFn, undoFn, guard }); if (HIST.undo.length > 10) HIST.undo.shift();
  HIST.redo = []; paintHist();
}
// 되돌릴 수 없는 일(시작·종료·설정·입장 취소·시험 지우기 등)을 하면, 그 전 기록으로 되돌아가지 않게 비웁니다
function histBarrier() { HIST.undo = []; HIST.redo = []; paintHist(); }
function refreshView() { if (P) renderTab(); else if ($('listMain')) viewList(); }
let histBusy = false;
async function histStep(from, to, fnKey, done) {
  if (histBusy) return; const h = from.pop();
  if (!h) return toast(fnKey === 'undoFn' ? '되돌릴 것이 없어요.' : '다시 할 것이 없어요.');
  if (h.guard && !(await h.guard())) { from.push(h); return; }
  histBusy = true;
  try { await h[fnKey](); to.push(h); toast(`${done}: ${h.label}`); }
  catch (e) { from.push(h); toast(errText(e)); }
  finally { histBusy = false; paintHist(); refreshView(); }
}
const histUndo = () => histStep(HIST.undo, HIST.redo, 'undoFn', '되돌렸어요');
const histRedo = () => histStep(HIST.redo, HIST.undo, 'doFn', '다시 했어요');
const histButtons = () => `<span class="undoredo"><button data-a="h-undo" id="h-undo" title="되돌리기 (Ctrl+Z)" aria-label="되돌리기">↶</button><button data-a="h-redo" id="h-redo" title="다시 하기 (Ctrl+Y)" aria-label="다시 하기">↷</button></span>`;
function paintHist() {
  const u = $('h-undo'), r = $('h-redo'), lu = HIST.undo[HIST.undo.length - 1], lr = HIST.redo[HIST.redo.length - 1];
  if (u) { u.disabled = !lu; u.title = lu ? `되돌리기: ${lu.label} (Ctrl+Z)` : '되돌릴 것이 없어요'; }
  if (r) { r.disabled = !lr; r.title = lr ? `다시 하기: ${lr.label} (Ctrl+Y)` : '다시 할 것이 없어요'; }
}
on('h-undo', () => histUndo());
on('h-redo', () => histRedo());
document.addEventListener('keydown', e => {
  if (S.role !== 'prof' || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target; if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;   // 글 쓰는 칸에서는 글자 되돌리기
  if (!$('modal').hidden) return;
  if (e.repeat) return;   // 길게 누르고 있어도 한 번만
  const k = e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); histUndo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); histRedo(); }
});
const ST = { draft: ['', '준비 중'], open: ['mid', '대기실 열림'], running: ['ok', '진행 중'], ended: ['', '종료'] };
const pill = m => { const s = ST[m.status] || ST.draft; return `<span class="pill ${s[0]}">${s[1]}</span>${m.released ? ' <span class="pill blue">결과 공개</span>' : ''}${m.practice ? ' <span class="pill blue">문제풀이 공개</span>' : ''}`; };
const meta = () => S.exams[P.id] || {};
// 안내 쪽과 마무리 쪽은 앱이 자동으로 만듭니다. 문항 목록에는 문제만 둡니다.
const questionsOnly = pages => pages.filter(p => p.t !== 'intro' && p.t !== 'end');
const isLeave = e => e.t === 'leave' || e.t === 'unpin' || e.t === 'unfull' || e.t === 'nopin';
// 잠겨 있어 교수의 확인이 필요한 학생인가
const isLocked = a => !!a && !a.submittedAt && C.leaveSummary(a.ev).locks > (a.unlock || 0);
const totalTime = a => Object.values((a && a.tm) || {}).reduce((x, y) => x + (Number(y) || 0), 0);
const isTest = sid => /^TEST/.test(String(sid || ''));
const testPill = sid => (isTest(sid) ? ' <span class="pill blue">테스트</span>' : '');
// 이름·반: 지금 입장해 있으면 입장 기록에서, 입장이 취소됐으면 시험을 시작할 때 답안에 적어 둔 것에서
const whoOf = sid => people()[sid] || (P && P.answers[sid] && P.answers[sid].who) || null;
const LATE = 30;   // 늦게 시작해도 되는 시간(분)의 기본값
// 학생별 마감 시각: 따로 준 시각이 있으면 그 시각, 없으면 시작한 때 + 시험 시간(+연장). 전체 마감은 넘지 않음
// 실제로 시험을 시작한 학생(시험 화면까지 들어감). 늦게 와서 시험을 누르기만 한 학생은 startedAt 만 있고 sess 가 없습니다(시간은 흐름).
const began = a => !!a && !!a.startedAt && !!a.sess;
const peeking = a => !!a && !!a.startedAt && !a.sess && !a.submittedAt;
const dlOf = (m, a) => (!a || !a.startedAt ? 0 : Math.min(m.endAt || 0, a.until || (a.startedAt + (m.minutes || 0) * 60000 + (m.extra || 0))));
// 학생 목록 = 반·학번·이름을 입력하고 입장한 학생
const people = () => { const m = {}; for (const u of Object.values(users)) if (u && u.sid) m[u.sid] = { name: u.name, cls: u.cls }; return m; };
const students = () => Object.entries(people()).map(([sid, r]) => ({ sid, ...r })).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
const allClasses = () => [...new Set([...S.classes, ...students().map(x => x.cls)])].filter(Boolean);

export function start() {
  baseSubs.forEach(u => u()); baseSubs = [
    be.on('bind', v => { bind = v || {}; live(); }),
    be.on('users', v => { users = v || {}; live(); if (!P && $('listMain')) viewList(); }),
  ];
  baseSubs.push(be.on('entry', v => { entry = v || {}; if ($('codeBox')) paintCode(); if (!P && $('listMain')) viewList(); if (P) paintHead(); }));
  // 반 목록을 서버에 적어 둡니다 (비어 있으면 기본값 A반·B반)
  be.get('classes').then(v => { if (!v) saveClasses(C.DEFAULT_CLASSES).catch(() => {}); }).catch(() => {});
  P = null; viewList();
}
export function onClasses() { if ($('clsBox')) paintClasses(); if (P && (P.tab === 'run' || P.tab === 'result')) renderTab(); }
export function onExams() { if (!P) viewList(); else if (!S.exams[P.id]) { closeExam(); viewList(); } else { paintHead(); live(); } }
// 학생들이 답을 저장할 때마다 화면을 다시 그리되, 너무 잦지 않게 모아서 그립니다.
function live() {
  if ($('peopleBox')) paintPeople();
  if (!P || (P.tab !== 'run' && P.tab !== 'result')) return;
  clearTimeout(liveT); liveT = setTimeout(() => { if (P && (P.tab === 'run' || P.tab === 'result')) renderTab(); }, 350);
}

/* ================= 시험 목록 ================= */
function viewList() {
  const keep = { t: $('n-title') ? $('n-title').value : '', m: $('n-min') ? $('n-min').value : '50', f: document.activeElement && document.activeElement.id };
  const list = Object.entries(S.exams).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  app.innerHTML = `<div class="desk"><header><h1 data-a="brand">푸른시험</h1>${codePill()}${histButtons()}<button data-a="test-open">학생으로 테스트</button><button data-a="people">학생 · 반 (${students().length}명)</button><button data-a="logout">로그아웃</button></header>
    <main id="listMain">
      <div class="panel"><h2>새 시험 만들기</h2>
        <div class="row"><label class="f" style="flex:1;min-width:180px">시험 이름<input class="in" id="n-title" placeholder="예: 기계공작법 중간고사" maxlength="60"></label>
        <label class="f" style="width:110px">시험 시간(분)<input class="in" id="n-min" type="number" min="1" max="300" value="50"></label>
        <button class="btn s" style="align-self:flex-end" data-a="new-exam">만들기</button></div></div>
      ${list.length ? list.map(([id, m]) => `<button class="card" data-a="p-open" data-id="${esc(id)}"><div style="margin-bottom:6px">${pill(m)}</div><h3>${esc(m.title || '(이름 없음)')}</h3><div class="sm">${m.n || 0}문항 · ${m.total || 0}점 · ${m.minutes || 0}분</div></button>`).join('')
      : '<div class="panel"><div class="sm">아직 시험이 없어요. 위에서 새 시험을 만들어 주세요.</div></div>'}
    </main></div>`;
  // 학생이 입장할 때마다 목록을 다시 그리므로, 쓰던 시험 이름이 지워지지 않게 되돌려 놓습니다
  paintHist();
  $('n-title').value = keep.t; $('n-min').value = keep.m; if (keep.f === 'n-title' || keep.f === 'n-min') $(keep.f).focus();
}
on('logout', async () => { if (await confirmBox('로그아웃할까요?', '', '로그아웃')) { closeExam(); try { localStorage.removeItem('pureun:prof'); } catch (e) {} await be.signOut(); location.href = './?prof=1'; } });
on('new-exam', async () => {
  const title = $('n-title').value.trim(), minutes = Math.round(+$('n-min').value);
  if (!title) return toast('시험 이름을 입력해 주세요.');
  if (!(minutes >= 1 && minutes <= 300)) return toast('시험 시간은 1~300분으로 입력해 주세요.');
  const id = 'e' + Date.now().toString(36);
  await be.set('exams/' + id, { title, minutes, status: 'draft', released: false, practice: false, n: 0, total: 0, at: be.now() });
  openExam(id, 'edit');
});

/* ================= 학생과 반 ================= */
on('people', () => {
  modal(`<h2>학생 · 반</h2>
    <div class="panel" style="padding:14px;box-shadow:none"><h2>반</h2><div class="sm">학생이 입장할 때 고르는 반입니다. 이름은 자유롭게 정할 수 있고(예: 1학년 A반, C반), 하나만 두면 학생은 반을 고르지 않습니다.</div>
      <div id="clsBox"></div>
      <div class="row"><input class="in" id="c-new" placeholder="새 반 이름" maxlength="20" style="flex:1;min-width:140px;font-size:16px;padding:9px 11px"><button class="btn s" data-a="c-add">반 추가</button></div></div>
    <div class="panel" style="padding:14px;box-shadow:none"><h2>입장 코드 (선택)</h2><div class="sm">켜 두면 교실에서 불러 주는 코드를 아는 학생만 입장합니다. 교실 밖의 누군가가 다른 학생의 학번으로 먼저 들어와 그 학생을 막는 일을 방지합니다. 비워 두면 코드 없이 바로 입장합니다.</div>
      <div id="codeBox"></div></div>
    <div class="panel" style="padding:14px;box-shadow:none"><h2>입장한 학생</h2><div class="sm">학생이 반·학번·이름을 직접 입력하고 들어옵니다. 한 학번은 처음 입장한 기기 하나만 쓸 수 있습니다. 휴대폰을 바꿨거나 학번을 잘못 입력한 학생은 <b>입장 취소</b>를 누르면 다시 입장할 수 있습니다. 답안은 그대로 남습니다.</div>
      <div id="peopleBox"></div></div>
    <button class="btn gh" data-a="modal-close">닫기</button>`, { wide: true });
  paintPeople(); paintClasses(); paintCode();
});
function paintCode() {
  const box = $('codeBox'); if (!box) return;
  box.innerHTML = `<div class="row" style="margin-top:8px"><input class="in" id="code-in" inputmode="numeric" placeholder="예: 4821" maxlength="12" value="${esc(entry.code || '')}" style="width:150px;font-size:18px;padding:9px 11px;font-weight:700;letter-spacing:.08em">
    <button class="btn s" data-a="code-save">저장</button><button class="btn s gh" data-a="code-rand">새 코드 만들기</button>${entry.code ? '<button class="btn s gh" data-a="code-off">코드 끄기</button>' : ''}
    <span class="pill ${entry.code ? 'ok' : ''}">${entry.code ? '켜짐' : '꺼짐 — 코드 없이 입장'}</span></div>`;
}
// 맨 위 입장 코드 표시: 세 번 연달아 누르면 바로 바꾸는 창이 뜹니다 (꺼져 있으면 회색 "입장 코드 꺼짐")
const codePill = () => `<span class="pill codepill ${entry.code ? 'blue' : ''}" data-a="code-tap" title="세 번 누르면 바꿀 수 있어요">${entry.code ? `입장 코드 ${esc(entry.code)}` : '입장 코드 꺼짐'}</span>`;
let codeTaps = 0, codeTapAt = 0;
on('code-tap', () => {
  const t = Date.now(); codeTaps = t - codeTapAt < 700 ? codeTaps + 1 : 1; codeTapAt = t;
  if (codeTaps < 3) return;
  codeTaps = 0;
  modal(`<h2>입장 코드</h2><div class="sm">학생이 입장할 때 넣는 코드입니다. 모든 시험에 함께 쓰입니다. 바꿔도 이미 입장한 학생은 그대로입니다.</div><div id="codeBox"></div><button class="btn gh" data-a="modal-close">닫기</button>`);
  paintCode(); const i = $('code-in'); if (i) { i.focus(); i.select(); }
});
const setCode = code => be.set('entry', code ? { code, need: true } : null);
on('code-save', async () => { const c = $('code-in').value.trim(); if (c && !/^[A-Za-z0-9]{3,12}$/.test(c)) return toast('코드는 숫자나 영문 3~12자로 정해 주세요.'); await setCode(c); toast(c ? '입장 코드를 켰어요.' : '입장 코드를 껐어요.'); });
on('code-rand', async () => { await setCode(String(1000 + Math.floor(Math.random() * 9000))); toast('새 코드를 만들었어요.'); });
on('code-off', async () => { await setCode(''); toast('입장 코드를 껐어요.'); });
on('unbind-all', async () => {
  histBarrier();
  const st = students();
  if (!st.length || !(await confirmBox('모든 학생의 입장을 취소할까요?', `${st.length}명이 모두 다시 입장해야 합니다. 저장된 답안은 그대로 남습니다.`, '모두 취소', { danger: true }))) return;
  await be.update('', { bind: null, users: null }); toast('모두 취소했어요. 답안·점수·이름은 결과에 남아 있습니다.');
  document.querySelector('[data-a=people]')?.click();
});
function paintClasses() {
  const box = $('clsBox'); if (!box) return;
  box.innerHTML = `<div class="row" style="margin:8px 0">${S.classes.map(c => `<span class="pill ok" style="font-size:15px;padding:4px 6px 4px 12px">${esc(c)} <button class="mini" data-a="c-del" data-c="${esc(c)}" aria-label="${esc(c)} 삭제" ${S.classes.length > 1 ? '' : 'disabled'}>✕</button></span>`).join('')}</div>`;
}
const saveClasses = list => be.set('classes', Object.fromEntries(list.map((c, i) => [c, i])));
on('c-add', async () => {
  const c = C.normCls($('c-new').value);
  if (!C.validCls(c)) return toast('반 이름은 1~20자로, . # $ / [ ] 없이 써 주세요.');
  if (S.classes.includes(c)) return toast('이미 있는 반이에요.');
  await saveClasses([...S.classes, c]); $('c-new').value = '';
});
on('c-del', async el => {
  const c = el.dataset.c, n = students().filter(s => s.cls === c).length;
  if (n) return toast(`${c}에 입장한 학생이 ${n}명 있어요. 그 학생들을 먼저 입장 취소해 주세요.`, 4000);
  await saveClasses(S.classes.filter(x => x !== c));
});
function paintPeople() {
  const box = $('peopleBox'); if (!box) return;
  const st = students(), cnt = c => st.filter(s => s.cls === c).length;
  if (!st.length) { box.innerHTML = '<div class="sm" style="margin-top:8px">아직 입장한 학생이 없어요.</div>'; return; }
  box.innerHTML = `<div class="sm" style="margin:8px 0 6px">전체 ${st.length}명 (${allClasses().map(c => `${esc(c)} ${cnt(c)}`).join(' · ')})</div>
    <div class="tw" style="max-height:40dvh;overflow:auto"><table><tr><th>반</th><th>학번</th><th>이름</th><th></th></tr>
    ${st.map(s => `<tr><td>${esc(s.cls)}</td><td>${esc(s.sid)}</td><td>${esc(s.name)}${testPill(s.sid)}</td><td style="text-align:right"><button class="mini" data-a="unbind" data-sid="${esc(s.sid)}">입장 취소</button></td></tr>`).join('')}
    </table></div><div class="row" style="margin-top:8px"><button class="mini red" data-a="unbind-all">모두 입장 취소</button>${st.some(x => isTest(x.sid)) ? '<button class="mini" data-a="test-clean">테스트 학생 정리</button>' : ''}</div>`;
}
on('unbind', async el => {
  const sid = el.dataset.sid, uid = bind[sid], r = people()[sid] || {};
  const again = !!$('peopleBox');
  if (!(await confirmBox('입장을 취소할까요?', `${esc(r.name || sid)} 학생이 다시(다른 기기에서도) 입장할 수 있게 됩니다. 답안·점수·이름은 결과에 그대로 남습니다.\n시험을 보는 중이면 학생 화면이 바로 입장 화면으로 돌아가고, 다시 들어오면 이어서 풉니다. 시험 시간은 그동안에도 흐릅니다.`, '입장 취소'))) return;
  histBarrier();
  const u = { ['bind/' + sid]: null };
  for (const [k, v] of Object.entries(users)) if ((v && v.sid === sid) || k === uid) u['users/' + k] = null;
  await be.update('', u); toast('취소했어요. 학생이 다시 입장하면 됩니다.');
  if (again) document.querySelector('[data-a=people]')?.click(); else if (P) renderTab();
});

/* ================= 시험 하나 열기 ================= */
async function openExam(id, tab = 'run') {
  closeExam();
  P = { id, tab, pages: [], imgs: {}, answers: {}, essay: {}, trash: {}, sel: new Set(), cls: '', rtab: 'rank', gq: '', blind: true, unsubs: [], sheetOpts: {} };
  const [draft, imgs] = await Promise.all([be.get('drafts/' + id), be.get('images/' + id)]);
  if (!P || P.id !== id) return;
  P.pages = questionsOnly(parse(draft, []).map(C.normalizePage)); P.imgs = imgs || {};
  P.unsubs.push(be.on('answers/' + id, v => { P.answers = v || {}; live(); }));
  P.unsubs.push(be.on('essay/' + id, v => { P.essay = v || {}; live(); }));
  P.unsubs.push(be.on('trash/' + id, v => { P.trash = v || {}; if (P.tab === 'result') live(); }));
  app.innerHTML = `<div class="desk"><header id="phead"></header><main><div class="tabs" id="ptabs"></div><div id="pmain" style="display:flex;flex-direction:column;gap:14px"></div></main><div id="bellbox" hidden></div></div>`;
  paintHead(); renderTab();
  clockT = setInterval(paintClock, 1000);
}
function closeExam() { histBarrier(); hideToast(); clearInterval(clockT); clearTimeout(liveT); hideCtx(); if (P) P.unsubs.forEach(u => u()); P = null; }
on('p-open', el => openExam(el.dataset.id));
on('p-back', () => { closeExam(); viewList(); });
function paintHead() {
  if (!P || !$('phead')) return;
  const m = meta();
  $('phead').innerHTML = `<button data-a="p-back">← 목록</button><h1 data-a="brand">${esc(m.title || '')}</h1><span>${pill(m)}</span>${codePill()}${histButtons()}<button data-a="test-open">학생으로 테스트</button><button class="band" id="pband" data-a="p-band" hidden></button>`;
  paintBand(); paintHist();
  $('ptabs').innerHTML = [['run', '진행'], ['edit', '문항'], ['grade', '채점'], ['result', '결과']].map(([k, n]) => `<button data-a="p-tab" data-t="${k}" class="${P.tab === k ? 'on' : ''}">${n}</button>`).join('');
}
on('p-band', () => { P.tab = 'run'; hideCtx(); paintHead(); renderTab(); });
on('p-tab', el => { P.tab = el.dataset.t; hideCtx(); hideToast(); paintHead(); renderTab(); });
function renderTab() { if (!P) return; ({ run: tabRun, edit: tabEdit, grade: tabGrade, result: tabResult })[P.tab](); paintClock(); }
// 기본 종료 = 교수가 시작한 때 + 시험 시간(+연장). 이때 교수 화면에서 종이 울립니다.
const baseEnd = m => Math.min(m.endAt || 0, (m.startAt || 0) + (m.minutes || 0) * 60000 + (m.extra || 0));
// 가장 늦게 시작한 학생(테스트 학생 제외)과, 그 학생 기준 전체 마감
function lastIn() {
  const m = meta(); let last = null, end = 0;
  for (const [sid, a] of Object.entries(P.answers)) {
    if (!a || !a.startedAt || a.submittedAt || isTest(sid)) continue;   // 이미 제출한 학생은 빼고, 아직 시간이 흐르는 학생 중 가장 늦게 끝나는 학생
    const d = dlOf(m, a);
    if (!last || d > end) { last = { sid, at: a.startedAt }; end = d; }
  }
  return last ? { ...last, name: (whoOf(last.sid) || {}).name || last.sid, end } : null;
}
function paintClock() {
  if (!P) return; const m = meta(), el = $('pclock'), now = be.now();
  const left = m.status === 'running' ? m.endAt - now : 0, bl = m.status === 'running' ? baseEnd(m) - now : 0;
  if (el) el.textContent = m.status === 'running' ? (bl > 0 ? C.fmtClock(bl) : left > 0 ? '끝' : '종료하는 중…') : '--:--';
  const tm = $('ptimes');
  if (tm) { const li = m.status === 'running' ? lastIn() : null; tm.innerHTML = m.status !== 'running' ? '' : `시작 <b>${hhmmss(m.startAt)}</b> · 기본 종료 <b>${hhmmss(baseEnd(m))}</b>${li ? ` <span class="dim">· 전체 마감 ${hhmmss(li.end)} (${esc(li.name)} ${hhmmss(li.at)} 입장)</span>` : ''}`; }
  if (m.status === 'running' && bl <= 0 && bl > -60000) bell(m);
  // 학생마다 남은 시간
  document.querySelectorAll('[data-dl]').forEach(td => { const d = +td.dataset.dl - now; td.textContent = m.status !== 'running' ? '' : d > 0 ? C.fmtClock(d) : '시간 끝'; });
  paintBand();
  // 전체 마감이 지나면(또는 "시험 종료"를 누르면) 학생들의 마지막 답과 제출을 8초 동안 받은 뒤 시험을 닫습니다
  if (m.status === 'running' && left < -8000 && !P.closing) { P.closing = true; setMeta({ status: 'ended' }).catch(() => {}).then(() => { if (P) P.closing = false; }); }
}
// 시험 중에는 어느 탭에서든 맨 위에 진행 상황을 보여 줍니다. 누르면 진행 탭으로 갑니다.
// 기본 종료 종소리(교수 화면에서만). 같은 시험·같은 종료 시각에는 한 번만 울립니다.
let audio = null;
document.addEventListener('pointerdown', () => { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {} }, true);
function chime() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime + 0.05;
    [[659.25, 0], [523.25, 0.55], [783.99, 1.1], [1046.5, 1.65]].forEach(([f, d]) => {
      [[1, 0.32], [2.76, 0.07], [5.4, 0.03]].forEach(([h, vol]) => {   // 종처럼 들리게 배음을 섞음
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f * h; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(vol, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 2.4);
        o.start(t0 + d); o.stop(t0 + d + 2.5);
      });
    });
  } catch (e) {}
}
function bell(m) {
  const k = `bell:${P.id}:${baseEnd(m)}`;
  let rung = P.belled === k; try { rung = rung || !!localStorage.getItem(k); } catch (e) {}
  if (rung) return;
  // 소리가 실제로 날 수 있을 때(교수님이 화면을 한 번이라도 누른 뒤)만 "울렸음"으로 적고, 아니면 1분 동안 다시 시도합니다
  try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume().catch(() => {}); } catch (e) {}
  const ok = !!audio && audio.state === 'running';
  if (ok) { chime(); P.belled = k; try { localStorage.setItem(k, '1'); } catch (e) {} }
  if (P.bellShown === k) return;
  P.bellShown = k;
  const li = lastIn(), late = li && li.end > baseEnd(m) + 1000;
  const box = $('bellbox'); if (!box) return;
  box.innerHTML = `<div class="bellcard"><div class="bellico">🔔</div><h2>시험 시간이 끝났습니다</h2><div class="sm">${late ? `늦게 들어온 학생은 각자 시간이 끝날 때까지 계속 풉니다.<br><span class="dim">전체 마감 ${hhmmss(li.end)}</span>` : '학생들의 답안이 자동으로 제출됩니다.'}</div><button class="btn s" data-a="bell-close">닫기</button></div>`;
  box.hidden = false; clearTimeout(P.bellT); P.bellT = setTimeout(() => { box.hidden = true; }, 15000);
}
on('bell-close', () => { const b = $('bellbox'); if (b) b.hidden = true; });
function liveCounts() {
  const { sheet, key } = exam(), rows = Object.entries(P.answers).filter(([sid, a]) => began(a) && !isTest(sid));   // 테스트 학생은 세지 않음
  const tot = rows.map(([sid, a]) => C.scoreStudent(sheet, key, a.a, P.essay[sid]).total);
  return { go: rows.filter(([, a]) => !a.submittedAt).length, sub: rows.filter(([, a]) => a.submittedAt).length,
    lv: rows.filter(([, a]) => C.leaveSummary(a.ev).count).length, locked: rows.filter(([, a]) => isLocked(a)).length, avg: tot.length ? tot.reduce((x, y) => x + y, 0) / tot.length : 0, max: sheet.reduce((n, q) => n + q.pts, 0) };
}
function paintBand() {
  const el = $('pband'); if (!el || !P) return; const m = meta();
  if (m.status !== 'running') { el.hidden = true; return; }
  const c = liveCounts(), left = m.endAt - be.now();
  el.hidden = false;
  const bl = baseEnd(m) - be.now(), li = lastIn();
  el.innerHTML = `<b>시험 중</b><span>${bl > 0 ? `기본 종료까지 ${C.fmtClock(bl)}` : left > 0 ? `기본 시간 끝${li ? ` <i class="dim">· 전체 마감 ${hhmmss(li.end)}</i>` : ''}` : '종료하는 중…'}</span><span>응시 중 ${c.go}명</span><span>제출 ${c.sub}명</span><span>이탈 ${c.lv}명</span>${c.locked ? `<span class="alarm">잠긴 학생 ${c.locked}명 — 확인 필요</span>` : ''}<span>평균 ${c.avg.toFixed(1)} / ${c.max}점 <small>(자동 채점 기준)</small></span>${P.tab === 'run' ? '' : '<span class="go">진행 탭으로 →</span>'}`;
}
const exam = () => C.splitExam(P.pages);
const clsFilter = () => `<div class="tabs">${[['', '전체'], ...allClasses().map(c => [c, c])].map(([c, n]) => `<button data-a="p-cls" data-c="${esc(c)}" class="${P.cls === c ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`;
on('p-cls', el => { P.cls = el.dataset.c; renderTab(); });

/* ----- 그래프 ----- */
const COL = { sub: '#9fd6b8', go: '#a9c9f0', in: '#f3dca0' };
function donut(parts, center) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  let acc = 0; const seg = parts.filter(p => p.n).map(p => { const a = acc / total * 360; acc += p.n; return `${p.c} ${a}deg ${acc / total * 360}deg`; });
  return `<div class="row" style="gap:18px;flex-wrap:nowrap"><div class="donut" data-c="${esc(center)}" style="background:${total ? `conic-gradient(${seg.join(',')})` : 'var(--soft)'}" role="img" aria-label="${esc(parts.map(p => `${p.label} ${p.n}명`).join(', '))}"></div>
    <div class="legend">${parts.map(p => `<div><i style="background:${p.c}"></i>${esc(p.label)} <b>${p.n}</b>명</div>`).join('')}</div></div>`;
}
function histChart(totals, max) {
  if (!totals.length) return '<div class="sm">아직 응시한 학생이 없어요.</div>';
  const h = C.histogram(totals, max, 10), top = Math.max(1, ...h.map(b => b.n));
  return `<div class="hist" role="img" aria-label="점수대별 학생 수">${h.map(b => `<div style="height:${Math.max(2, b.n / top * 100)}%" title="${b.from}~${b.to}점 ${b.n}명">${b.n ? `<b>${b.n}</b>` : ''}</div>`).join('')}</div>
    <div class="hax">${h.map(b => `<span>${Math.round(b.from)}</span>`).join('')}</div><div class="sm">점수대별 학생 수 (가로: 점수, ${Math.round(h[0].to)}점 단위)</div>`;
}
const hbar = (label, n, total, cls = '') => `<div class="hbar ${cls}"><span class="lb" title="${esc(label)}">${esc(label)}</span><span class="tr"><i style="width:${total ? n / total * 100 : 0}%"></i></span><span class="nn">${n}명</span></div>`;
function questionCharts(stats) {
  if (!stats.length || !stats[0].n) return '<div class="sm">아직 응시한 학생이 없어요.</div>';
  return stats.map(s => {
    let rows;
    if (s.choice) rows = s.picks.map((n, j) => hbar((s.good.includes(j) ? '✓ ' : '') + (P.sheetOpts[s.id] || [])[j], n, s.n, s.good.includes(j) ? 'good' : (j === s.topWrong ? 'bad' : ''))).join('') + (s.blank ? hbar('안 풂', s.blank, s.n) : '');
    else if (s.k === 'short') rows = s.tally.slice(0, 8).map(t => hbar((t.ok ? '✓ ' : '') + t.text, t.n, s.n, t.ok ? 'good' : 'bad')).join('') + (s.tally.length > 8 ? `<div class="sm">그 밖의 답 ${s.tally.length - 8}종류</div>` : '') + (s.blank ? hbar('안 씀', s.blank, s.n) : '');
    else rows = `<div class="sm">교수 채점 문항 — 채점 ${s.graded} / ${s.n - s.blank}명, 평균 ${s.avg.toFixed(1)} / ${s.pts}점</div>`;
    const tms = Object.values(P.answers).map(a => a && a.tm && Number(a.tm[s.id])).filter(v => v > 0), avgT = tms.length ? tms.reduce((x, y) => x + y, 0) / tms.length : 0;
    return `<div class="qchart"><h4>${s.no}. ${esc(s.q.length > 60 ? s.q.slice(0, 60) + '…' : s.q)} <span class="pill ${s.k === 'long' ? '' : s.rate < .4 ? 'no' : s.rate < .7 ? 'mid' : 'ok'}">${s.k === 'long' ? C.KIND_NAME.long : `정답률 ${Math.round(s.rate * 100)}%`}</span><span class="pill">${C.KIND_NAME[s.k]} · 난이도 ${esc(s.level || '')}</span>${avgT ? `<span class="pill">평균 풀이 ${C.fmtDur(avgT)}</span>` : ''}</h4>${rows}</div>`;
  }).join('');
}

/* ================= 진행 ================= */
function tabRun() {
  const m = meta(), v = C.validateBundle(P.pages), { sheet, key } = exam(), ppl = people();
  const sids = [...new Set([...Object.keys(ppl), ...Object.keys(P.answers)])];
  const rows = sids.map(sid => {
    const r = whoOf(sid) || { name: '(이름 없음)', cls: '' }, a = P.answers[sid], lv = C.leaveSummary(a && a.ev);
    return { sid, ...r, a, lv, cnt: a && a.a ? Object.values(a.a).filter(x => x !== '' && x != null).length : 0 };
  }).filter(r => !P.cls || r.cls === P.cls).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
  const real = rows.filter(r => !isTest(r.sid));   // 그래프·평균에는 테스트 학생을 넣지 않음
  const sub = real.filter(r => r.a && r.a.submittedAt), go = real.filter(r => began(r.a) && !r.a.submittedAt), wait = real.filter(r => !began(r.a) && !(r.a && r.a.submittedAt));
  const btns = {
    draft: `<button class="btn s am" data-a="ex-status" data-s="open">학생에게 열기 (대기실)</button>`,
    open: `<button class="btn s am" data-a="ex-start">시험 시작 (모든 반 함께)</button><button class="btn s gh" data-a="ex-status" data-s="draft">대기실 닫기</button>`,
    running: `<button class="btn s gh" data-a="ex-extend">시간 5분 연장</button><button class="btn s red" data-a="ex-end">시험 종료 (모든 반 함께)</button>`,
    ended: `<button class="btn s ${m.released ? 'gh' : 'am'}" data-a="ex-release">${m.released ? '결과 공개 취소' : '결과 공개'}</button>${m.released ? '<button class="btn s gh" data-a="ex-reopen">못 본 학생 열기 (결과 공개 취소 후)</button>' : '<button class="btn s gh" data-a="ex-resume">다시 열기 (못 본 학생 응시)</button>'}`,
  }[m.status || 'draft'];
  const guide = { draft: '문항을 준비한 뒤 대기실을 여세요. 학생은 대기실에서 안내를 읽고 기다립니다.', open: '학생들이 입장해 기다리고 있습니다. 시작을 누르면 학생의 "시험 시작" 버튼이 켜지고, 학생이 그 버튼을 누른 때부터 각자 시간이 흐릅니다. 늦게 온 학생은 목록에서 시험을 누른 때부터 흐릅니다.', running: `대기실 학생은 "시험 시작"을 누른 때부터, 늦게 온 학생은 시험을 누른 때부터 각자 ${m.minutes}분. ${hhmmss(m.endAt - m.minutes * 60000 - (m.extra || 0))}까지 들어오면 시간을 다 받습니다. 각자 시간이 끝나면 자동으로 제출됩니다.`, ended: '시험이 끝났습니다. 장문형을 채점한 뒤 결과를 공개하세요.' }[m.status || 'draft'];
  const scores = real.filter(r => began(r.a)).map(r => C.scoreStudent(sheet, key, r.a.a, P.essay[r.sid]).total);
  $('pmain').innerHTML = `
    <div class="panel"><div class="row"><h2 style="margin-right:auto">${ST[m.status || 'draft'][1]}</h2><span class="sm">기본 종료까지</span><span class="pill blue" style="font-size:20px;padding:2px 14px" id="pclock">--:--</span></div>
      <div class="sm" id="ptimes"></div>
      <div class="sm">${esc(guide)}</div>
      ${v.errors.length ? `<div class="box no">문항에 고칠 곳이 ${v.errors.length}군데 있어요. <b>문항</b> 탭에서 확인해 주세요.</div>` : ''}
      <div class="row">${btns}<button class="btn s gh" data-a="ex-settings">시험 설정</button><button class="btn s gh" data-a="ex-copy">시험 복사 (재시험용)</button></div>
      ${m.status === 'ended' && m.released ? '<div class="sm">결과를 공개한 상태에서는 정답이 학생에게 보이므로, <b>못 본 학생 열기</b>를 누르면 결과 공개를 먼저 취소합니다. 제출한 학생은 다시 풀 수 없고, 답과 점수는 그대로 남습니다. 다시 공개하기 전까지 학생은 결과를 볼 수 없습니다.</div>' : ''}</div>
    <div class="charts">
      <div class="panel"><h2>응시 현황</h2>${donut([{ label: '제출', n: sub.length, c: COL.sub }, { label: '응시 중', n: go.length, c: COL.go }, { label: '입장만 함', n: wait.length, c: COL.in }], `${sub.length}/${rows.length}`)}</div>
      <div class="panel"><h2>지금까지의 점수 분포</h2>${histChart(scores, sheet.reduce((n, q) => n + q.pts, 0))}<div class="sm">자동 채점 기준이며 학생에게는 보이지 않습니다.</div></div>
    </div>
    <div class="panel"><div class="row"><h2 style="margin-right:auto">학생별 현황</h2>${clsFilter()}</div>
      <div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th>상태</th><th class="num">남은 시간</th><th class="num">답한 문항</th><th class="num">이탈</th>${C.camOn(m) ? '<th class="num">카메라 경고</th>' : ''}<th class="num">잠금</th><th></th></tr>
      ${rows.map(r => `<tr><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}${testPill(r.sid)}${bind[r.sid] ? '' : ' <span class="pill">입장 취소됨</span>'}</td>
        <td>${r.a && r.a.submittedAt ? `<span class="pill ok">제출 ${hhmmss(r.a.submittedAt)}</span>` : began(r.a) ? '<span class="pill blue">응시 중</span>' : peeking(r.a) ? '<span class="pill mid">안내 보는 중 (시간 흐름)</span>' : '<span class="pill mid">입장</span>'}${r.a && r.a.dev ? ` <span class="pill">${r.a.dev.startsWith('app') ? '앱' : '웹'}</span>` : ''}</td>
        <td class="num" ${r.a && r.a.startedAt && !r.a.submittedAt ? `data-dl="${dlOf(m, r.a)}"` : ''}></td>
        <td class="num">${r.a ? `${r.cnt} / ${sheet.length}` : ''}</td>
        <td class="num">${r.lv.count ? `<button class="mini red" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.count}회</button>` : ''}</td>
        ${C.camOn(m) ? `<td class="num">${r.lv.face ? `<button class="mini" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.face}회</button>` : ''}${r.lv.camOff ? ' <span class="pill mid">카메라 꺼짐</span>' : ''}</td>
` : ''}
        <td class="num">${r.lv.locks ? `${r.lv.locks}회` : ''}${isLocked(r.a) ? ` <button class="mini red" data-a="unlock" data-sid="${esc(r.sid)}">잠금 해제</button>` : ''}</td>
        <td style="white-space:nowrap;text-align:right">${bind[r.sid] ? `<button class="mini" data-a="unbind" data-sid="${esc(r.sid)}">입장 취소</button> ` : ''}${r.a && r.a.submittedAt && m.status === 'running' ? `<button class="mini" data-a="unsubmit" data-sid="${esc(r.sid)}">제출 취소</button> ` : ''}${r.a ? `<button class="mini red" data-a="stu-del" data-sid="${esc(r.sid)}">지우기</button>` : ''}</td></tr>`).join('')}
      </table></div>${rows.length ? '' : '<div class="sm">아직 입장한 학생이 없어요. 학생이 반·학번·이름을 입력하고 들어오면 여기에 나타납니다.</div>'}</div>`;
}
const setMeta = patch => { histBarrier(); return be.update('exams/' + P.id, patch); };
on('ex-status', async el => {
  if (el.dataset.s === 'open' && C.validateBundle(P.pages).errors.length) return toast('문항에 고칠 곳이 있어요. 문항 탭에서 먼저 고쳐 주세요.');
  await setMeta(el.dataset.s === 'open' ? { status: 'open', practice: false } : { status: el.dataset.s });   // 시험으로 열 때는 문제풀이 공개를 끕니다(정답 노출 방지)
});
on('ex-start', async () => {
  const m = meta();
  if (C.validateBundle(P.pages).errors.length) return toast('문항에 고칠 곳이 있어요.');
  const late = m.late >= 0 ? m.late : LATE;
  if (!(await confirmBox('시험을 시작할까요?', `대기실 학생은 <b>시험 시작</b>을 누른 때부터, 늦게 온 학생은 목록에서 <b>시험을 누른 때</b>부터 각자 <b>${m.minutes}분</b>이 흐릅니다.\n<b>${m.minutes}분</b> 뒤(기본 종료)에 이 화면에서 종이 울립니다.\n늦게 온 학생은 <b>${late}분</b> 안에 들어와야 시간을 다 받습니다(시험 설정에서 바꿀 수 있음). 지금부터 <b>${m.minutes + late}분</b> 뒤에는 모두 끝납니다.`, '시작'))) return;
  const now = be.now(); await setMeta({ status: 'running', practice: false, startAt: now, extra: 0, endAt: now + (m.minutes + late) * 60000 });
});
on('ex-extend', async () => { const m = meta(); await setMeta({ extra: (m.extra || 0) + 5 * 60000, endAt: m.endAt + 5 * 60000 }); toast('모든 학생의 시간을 5분 연장했어요.'); });
on('ex-end', async () => {
  if (!(await confirmBox('시험을 종료할까요?', '모든 학생의 시험이 바로 끝나고, 지금까지 저장된 답안으로 채점됩니다.', '종료', { danger: true }))) return;
  await setMeta({ endAt: Math.min(meta().endAt, be.now()) });   // 남은 시간을 0으로 → 학생 답안이 자동 제출되고, 잠시 뒤 시험이 닫힙니다
  toast('종료하는 중입니다. 학생들의 마지막 답안을 받고 있어요.', 6000);
});
// 끝난 시험을 다시 엽니다 (시험을 못 본 학생용)
function resumeModal() {
  const m = meta(), started = Object.values(P.answers).filter(a => began(a) && !a.submittedAt).length;
  modal(`<h2>시험 다시 열기</h2>
    <div class="txt">정한 시간 동안 시험이 다시 진행됩니다. 이미 제출한 학생은 다시 풀 수 없습니다.</div>
    <label class="f">다시 여는 시간(분)<input class="in" id="rs-min" type="number" min="1" max="300" value="${m.minutes || 50}"></label>
    <button class="check on" data-a="rs-lock" id="rs-lock"><i>✓</i>이미 응시한 학생은 제출 처리하기</button>
    <div class="sm">켜 두면 <b>시험을 아예 보지 않은 학생만</b> 응시할 수 있습니다. 끄면 응시했지만 제출하지 않은 학생${started ? ` ${started}명` : ''}도 위에서 정한 시간 동안 이어서 풀 수 있습니다. 처음 보는 학생은 시작을 누른 때부터 원래 시험 시간(${m.minutes}분)을 받되, 다시 여는 시간이 끝나면 함께 끝납니다.</div>
    <div class="row"><button class="btn gh" data-a="modal-close">취소</button><button class="btn am" data-a="rs-go">다시 열기</button></div>`);
}
on('ex-resume', resumeModal);
on('ex-reopen', async () => {
  if (!(await confirmBox('결과 공개를 취소하고 다시 열까요?', '정답과 해설이 학생에게 다시 숨겨집니다. 이미 본 학생도 다시 공개할 때까지 결과를 볼 수 없습니다.', '취소하고 다시 열기', { danger: true }))) return;
  await setMeta({ released: false });
  resumeModal();
});
on('rs-lock', el => el.classList.toggle('on'));
on('rs-go', async () => {
  const minutes = Math.round(+$('rs-min').value), lock = $('rs-lock').classList.contains('on');
  if (!(minutes >= 1 && minutes <= 300)) return toast('시간은 1~300분으로 입력해 주세요.');
  const now = be.now(), u = { [`exams/${P.id}/status`]: 'running', [`exams/${P.id}/practice`]: false, [`exams/${P.id}/extra`]: 0, [`exams/${P.id}/startAt`]: now, [`exams/${P.id}/endAt`]: now + minutes * 60000 };
  for (const [sid, a] of Object.entries(P.answers)) {
    if (!a.startedAt || a.submittedAt) continue;
    if (!began(a)) u[`answers/${P.id}/${sid}/startedAt`] = null;   // 시험을 눌러 보기만 한 학생은 "못 본 학생"으로: 다시 누른 때부터 새로 시간을 받음
    else u[`answers/${P.id}/${sid}/${lock ? 'submittedAt' : 'until'}`] = lock ? now : now + minutes * 60000;
  }
  await be.update('', u); closeModal(); toast(`${minutes}분 동안 다시 열었어요.`);
});
// 문항과 사진만 그대로 새 시험으로 복사합니다 (답안·점수는 복사하지 않음)
on('ex-copy', async () => {
  const m = meta();
  if (!(await confirmBox('이 시험을 복사할까요?', '문항과 사진을 그대로 담은 새 시험이 "준비 중" 상태로 만들어집니다. 답안과 점수는 복사되지 않습니다. 재시험용으로 문항을 고쳐 쓰세요.', '복사'))) return;
  const src = P.id, id = 'e' + Date.now().toString(36), at = be.now();
  const [draft, sheet, key, imgs] = await Promise.all(['drafts/', 'sheets/', 'keys/', 'images/'].map(k => be.get(k + src)));
  const u = { ['exams/' + id]: { title: (m.title || '시험') + ' (재시험)', minutes: m.minutes || 50, status: 'draft', released: false, practice: false, n: m.n || 0, total: m.total || 0, notice: m.notice || null, end: m.end || null, at } };
  for (const k of ['late', 'cam', 'appOnly', 'camBatt', 'camLock', 'camYaw', 'camPitch', 'camSec', 'leaveLock']) if (m[k] !== undefined) u['exams/' + id][k] = m[k];   // 시험 설정도 그대로
  if (draft) u['drafts/' + id] = { ...draft, at };
  if (sheet) u['sheets/' + id] = { ...sheet, at };
  if (key) u['keys/' + id] = { ...key, at };
  if (imgs) u['images/' + id] = imgs;
  await be.update('', u);
  toast('복사했어요. 새 시험을 엽니다.'); openExam(id, 'edit');
});
on('ex-release', async () => {
  const m = meta();
  if (!m.released) {
    const { sheet, key } = exam();
    const pend = Object.entries(P.answers).reduce((n, [sid, a]) => n + C.scoreStudent(sheet, key, a.a, P.essay[sid]).essayPending, 0);
    if (!(await confirmBox('결과를 공개할까요?', `학생이 자기 점수, 틀린 문항, 해설을 볼 수 있게 됩니다.${pend ? `\n\n<b>아직 채점하지 않은 장문형 답이 ${pend}개</b> 있습니다.` : ''}`, '공개'))) return;
  }
  await setMeta({ released: !m.released });
});
on('unsubmit', async el => { if (await confirmBox('제출을 취소할까요?', '학생이 남은 시간 동안 다시 풀 수 있게 됩니다.', '취소하기')) await be.remove(`answers/${P.id}/${el.dataset.sid}/submittedAt`); });
// 카메라 경고 3회로 잠긴 학생의 화면을 풀어 줍니다 (교실에서 확인한 뒤 누르세요)
on('unlock', async el => {
  const sid = el.dataset.sid, a = P.answers[sid]; if (!a) return;
  await be.set(`answers/${P.id}/${sid}/unlock`, C.leaveSummary(a.ev).locks);
  toast('잠금을 풀었어요.');
});
on('lv-show', el => {
  const sid = el.dataset.sid, r = whoOf(sid) || {}, lv = C.leaveSummary((P.answers[sid] || {}).ev);
  const name = C.EV_NAME;
  modal(`<h2>${esc(r.cls || '')} ${esc(sid)} ${esc(r.name || '')} — 이탈 ${lv.count}회 · 카메라 경고 ${lv.face}회 · 잠금 ${lv.locks}회</h2>
    <div class="tw"><table><tr><th>시각</th><th>내용</th></tr>${lv.list.map(e => `<tr><td>${hhmmss(e.at)}</td><td>${esc(name[e.t] || e.t)}</td></tr>`).join('')}</table></div>
    <button class="btn gh" data-a="modal-close">닫기</button>`);
});
on('ex-settings', () => {
  const m = meta();
  modal(`<h2>시험 설정</h2>
    <label class="f">시험 이름<input class="in" id="s-title" value="${esc(m.title || '')}" maxlength="60"></label>
    <label class="f">시험 시간(분) ${m.status === 'running' ? '— 진행 중에는 "5분 연장"을 쓰세요' : ''}<input class="in" id="s-min" type="number" min="1" max="300" value="${m.minutes || 50}" ${m.status === 'running' ? 'disabled' : ''}></label>
    <label class="f">늦게 시작해도 되는 시간(분) — 전체 마감 = 시험 시간 + 이 시간<input class="in" id="s-late" type="number" min="0" max="300" value="${m.late >= 0 ? m.late : LATE}" ${m.status === 'running' ? 'disabled' : ''}></label>
    <label class="f">안내 쪽에 덧붙일 말 (선택)<textarea class="in" id="s-notice" rows="2" maxlength="500" placeholder="예: 계산기는 쓸 수 없습니다.">${esc((m.notice || {}).body || '')}</textarea></label>
    <label class="f">마무리 쪽에 보일 말 (선택)<textarea class="in" id="s-end" rows="2" maxlength="500" placeholder="예: 결과는 다음 주 수업 시간에 공개합니다.">${esc((m.end || {}).body || '')}</textarea></label>
    <button class="check ${C.camOn(m) ? 'on' : ''}" data-a="s-practice" id="s-cam"><i>✓</i>전면 카메라로 얼굴 확인</button>
    <div class="sm">켜면 시험 중 얼굴이 화면에서 사라지거나 고개가 정한 각도보다 더 돌아가거나(좌우) 숙이거나 든(위아래) 상태가 정한 시간 넘게 이어질 때 화면을 가리고 경고를 기록합니다. 경고가 정한 횟수만큼 쌓이면 화면이 잠기고, 진행 탭에서 교수님이 풀어 줍니다. 영상은 저장하지 않습니다. 기기가 뜨거워지거나 배터리가 아래 값보다 적으면 카메라를 저절로 끕니다.<br><b>화면 벗어남</b>: 다른 앱으로 가거나 전체 화면을 빠져나가면 시험 화면을 가리고 경고합니다(새로 고침도 1회). 정한 횟수가 되면 잠깁니다. 카메라를 꺼도 적용됩니다.</div>
    <div class="pgrid">
      <label class="pcell">화면 벗어남 잠금 횟수<input class="in" id="s-leavelock" type="number" min="0" max="20" value="${Number.isInteger(m.leaveLock) && m.leaveLock >= 0 ? m.leaveLock : C.CAM_DEF.leaveLock}"><small>이 횟수면 잠금 · 0이면 기록만</small></label>
      <label class="pcell">위아래 각도(도)<input class="in" id="s-campitch" type="number" min="5" max="90" value="${Number.isFinite(m.camPitch) ? m.camPitch : C.CAM_DEF.camPitch}"><small>이보다 더 숙이거나 들면 경고</small></label>
      <label class="pcell">좌우 각도(도)<input class="in" id="s-camyaw" type="number" min="5" max="90" value="${Number.isFinite(m.camYaw) ? m.camYaw : C.CAM_DEF.camYaw}"><small>이보다 더 돌리면 경고</small></label>
      <label class="pcell">이어진 시간(초)<input class="in" id="s-camsec" type="number" min="1" max="60" value="${Number.isFinite(m.camSec) ? m.camSec : C.CAM_DEF.camSec}"><small>이만큼 계속되면 경고</small></label>
      <label class="pcell">잠그는 경고 횟수<input class="in" id="s-camlock" type="number" min="0" max="20" value="${Number.isInteger(m.camLock) && m.camLock >= 0 ? m.camLock : C.CAM_DEF.camLock}"><small>0이면 잠그지 않음</small></label>
    </div>
    <label class="f">카메라를 끄는 배터리 잔량(%)<input class="in" id="s-batt" type="number" min="0" max="100" value="${m.camBatt >= 0 ? m.camBatt : 20}"></label>
    <button class="check ${C.appOnlyOn(m) ? 'on' : ''}" data-a="s-practice" id="s-app"><i>✓</i>안드로이드는 앱으로만 응시</button>
    <div class="sm">켜면 안드로이드 휴대폰의 인터넷 창(크롬 등)으로는 시작할 수 없고, 앱 내려받기 안내가 나옵니다. 아이폰은 그대로 웹으로 봅니다.</div>
    <button class="btn" data-a="s-save">저장</button>
    <hr style="border:0;border-top:1px solid var(--line)">
    <button class="btn gh" data-a="ex-wipe">답안 모두 지우기 (모의시험 뒤 초기화)</button>
    <button class="btn gh" style="color:var(--red)" data-a="ex-delete">이 시험 삭제</button>
    <button class="btn gh" data-a="modal-close">닫기</button>`);
});
on('s-practice', el => el.classList.toggle('on'));
on('s-save', async () => {
  const title = $('s-title').value.trim(), minutes = Math.round(+$('s-min').value), appOnly = $('s-app').classList.contains('on'), cam = $('s-cam').classList.contains('on'), camBatt = Math.max(0, Math.min(100, Math.round(+$('s-batt').value || 0))), camLock = Math.max(0, Math.min(20, Math.round(+$('s-camlock').value || 0))),
    camYaw = Math.max(5, Math.min(90, Math.round(+$('s-camyaw').value || C.CAM_DEF.camYaw))), camPitch = Math.max(5, Math.min(90, Math.round(+$('s-campitch').value || C.CAM_DEF.camPitch))), camSec = Math.max(1, Math.min(60, Math.round(+$('s-camsec').value || C.CAM_DEF.camSec))), leaveLock = Math.max(0, Math.min(20, Math.round(+$('s-leavelock').value || 0)));
  const late = Math.round(+$('s-late').value);
  const noticeBody = $('s-notice').value.trim(), endBody = $('s-end').value.trim();   // 확인 창이 뜨면 이 칸들이 사라지므로 미리 읽어 둡니다
  if (!title || !(minutes >= 1 && minutes <= 300) || !(late >= 0 && late <= 300)) return toast('이름과 시간을 확인해 주세요.');
  // 문제풀이(학습) 공개는 설정에서 뺐습니다(시험이 끝난 뒤 "결과 공개"로 해설을 봅니다). 예전에 켜 둔 것이 있으면 저장할 때 끕니다.
  await setMeta({ title, minutes, late, practice: false, appOnly, cam, camBatt, camLock, camYaw, camPitch, camSec, leaveLock, notice: { title: '', body: noticeBody }, end: { title: '고생하셨습니다', body: endBody } }); closeModal(); toast('저장했어요.');
});
on('ex-wipe', async () => {
  if (!(await confirmBox('답안을 모두 지울까요?', '이 시험의 모든 학생 답안, 이탈 기록, 장문형 점수가 지워지고 시험이 "준비 중"으로 돌아갑니다. <b>되돌릴 수 없습니다.</b>', '모두 지우기', { danger: true }))) return;
  histBarrier();
  await be.update('', { ['answers/' + P.id]: null, ['essay/' + P.id]: null, ['trash/' + P.id]: null, [`exams/${P.id}/status`]: 'draft', [`exams/${P.id}/released`]: false, [`exams/${P.id}/startAt`]: null, [`exams/${P.id}/endAt`]: null });
  closeModal(); toast('지웠어요.');
});
on('ex-delete', async () => {
  if (!(await confirmBox('이 시험을 삭제할까요?', '문항, 답안, 점수가 모두 지워집니다. <b>되돌릴 수 없습니다.</b>', '삭제', { danger: true }))) return;
  const id = P.id; closeExam(); closeModal();
  await be.update('', Object.fromEntries(['exams', 'drafts', 'sheets', 'keys', 'images', 'answers', 'essay', 'trash'].map(k => [`${k}/${id}`, null])));
  viewList();
});

/* ================= 문항 편집 ================= */
// 문항을 저장합니다. 교수용 원본, 학생용 문제지(정답 없음), 정답지를 함께 씁니다.
async function savePagesFor(id, pages) {
  if (!(await be.get(`exams/${id}/status`))) throw new Error('이 시험은 이미 지워졌어요.');   // 지운 시험이 되살아나지 않게
  pages = C.ensureIds(pages);
  const x = C.splitExam(pages), v = C.validateBundle(pages), at = be.now();
  await be.update('', {
    ['drafts/' + id]: { data: JSON.stringify(pages), at },
    ['sheets/' + id]: { data: JSON.stringify(x.sheet), at },   // 학생용: 정답·해설 없음
    ['keys/' + id]: { data: JSON.stringify(x.key), at },       // 교수용 / 공개 후 학생
    [`exams/${id}/n`]: v.stats.n, [`exams/${id}/total`]: v.stats.total,
  });
  if (P && P.id === id) P.pages = pages;
  return at;
}
// 문항을 바꾸고, 되돌리기 기록에 남깁니다. 그 사이에 문항이 바뀌었으면(다른 기기 등) 되돌리지 않고,
// 시험이 이미 열려 있으면 되돌리기 전에 한 번 묻습니다.
async function changePages(next, label) {
  const id = P.id, before = P.pages.slice(), after = C.ensureIds(next);
  let at = 0;
  const unchanged = async () => { if ((await be.get(`drafts/${id}/at`)) !== at) throw new Error('그 사이에 문항이 바뀌어서 되돌릴 수 없어요.'); };
  const guard = async () => { const st = (S.exams[id] || {}).status; return !st || st === 'draft' || confirmBox('문항을 되돌릴까요?', '이 시험은 이미 학생에게 열려 있습니다. 되돌리면 학생에게 보이는 문제와 채점이 바뀝니다.', '되돌리기', { danger: true }); };
  await record(label, async () => { if (at) await unchanged(); at = await savePagesFor(id, after); }, async () => { await unchanged(); at = await savePagesFor(id, before); }, guard);
}

const srcOf = p => !p.img ? '' : p.img.startsWith('img:') ? (P.imgs[p.img.slice(4)] || '') : p.img;
const answerLabel = p => {
  const k = C.kindOf(p);
  if (k === 'check') return Array.isArray(p.a) && p.a.length ? ` · 정답 ${p.a.map(i => CIRCLED[i]).join('')}` : '';
  if (C.hasOpts(k)) return Number.isInteger(p.a) && (p.opts || [])[p.a] ? ` · 정답 ${CIRCLED[p.a]} ${esc(p.opts[p.a])}` : '';
  if (k === 'short') return (p.answers || []).length ? ` · 정답 ${esc(p.answers[0])}${p.answers.length > 1 ? ` 외 ${p.answers.length - 1}` : ''}` : '';
  return '';
};
function tabEdit() {
  const v = C.validateBundle(P.pages), s = v.stats, m = meta();
  const errAt = i => v.errors.filter(e => e.i === i).map(e => e.msg), warnAt = i => v.warnings.filter(e => e.i === i).map(e => e.msg);
  const kinds = C.KINDS.filter(k => s.byKind[k]).map(k => `${C.KIND_NAME[k]} ${s.byKind[k]}`).join(' · ');
  let no = 0;
  $('pmain').innerHTML = `
    ${m.status === 'running' ? '<div class="box warn"><b>시험이 진행 중입니다.</b> 지금 문항을 고치면 이미 푼 학생과 달라질 수 있어요.</div>' : ''}
    <div class="panel"><div class="row"><h2 style="margin-right:auto" id="ed-sum">${s.n}문항 · ${s.total}점</h2><span class="sm">${kinds}${kinds ? ' · ' : ''}난이도 하 ${s.byLevel['하']} 중 ${s.byLevel['중']} 상 ${s.byLevel['상']}</span></div>
      <div class="ask"><div class="ask-t">AI 부탁문 <span>문제를 만들고 검토할 때 차례로 복사해 쓰세요</span></div>
        <div class="row"><button class="btn s am" data-a="cp" data-k="make">① 문제 만들기</button><button class="btn s am" data-a="cp" data-k="review">② 정확성 검토</button><button class="btn s am" data-a="cp" data-k="final">③ 최종 확인</button></div></div>
      <div class="row"><button class="btn s" data-a="ed-paste">문항 묶음 붙여 넣기</button><button class="btn s gh" data-a="ed-replace">고른 문항만 교체 붙여 넣기</button><button class="btn s gh" data-a="ed-add">빈 문항 추가</button><button class="btn s gh" data-a="ed-del">고른 문항 지우기</button><button class="btn s gh" data-a="pv-open" style="margin-left:auto">학생 화면으로 보기</button></div>
      ${v.errors.length ? `<div class="box no"><b>고칠 곳 ${v.errors.length}군데</b> — 빨간 문항을 확인하세요. 고치기 전에는 시험을 열 수 없습니다.${v.errors.filter(e => e.i < 0).map(e => '\n' + esc(e.msg)).join('')}</div>` : s.n ? '<div class="box ok">문항 검사를 통과했습니다.</div>' : ''}
      ${P.pages.length > 1 ? '<div class="sm">왼쪽 ⠿ 를 끌어서 순서를 바꿉니다. 문항에서 마우스 오른쪽 버튼을 누르면 고치기·복제·지우기 메뉴가 나옵니다.</div>' : ''}
    </div>
    <div class="qrow fixed"><div class="t"><b>안내 쪽</b><span>자동으로 만들어집니다 — 시험 이름, 시험 시간, 주의사항, "확인했습니다". 덧붙일 말은 진행 탭의 시험 설정에서 넣습니다.</span></div></div>
    <div id="qlist" style="display:flex;flex-direction:column;gap:8px">
    ${P.pages.map((p, i) => {
      const q = C.isQuestion(p), er = errAt(i), wr = warnAt(i);
      const sub = q ? `${p.t === 'image' || p.t === 'video' ? C.TYPE_NAME[p.t] + ' · ' : ''}${C.KIND_NAME[C.kindOf(p)]} · 난이도 ${esc(p.level)} · ${p.pts}점${answerLabel(p)}${p.img ? ' · 사진' : ''}${p.video ? ' · 영상' : ''}` : esc(p.body || '');
      return `<div class="qrow ${er.length ? 'err' : ''}" data-i="${i}"><span class="grip" data-grip="${i}" title="끌어서 순서 바꾸기" aria-hidden="true">⠿</span><input type="checkbox" data-i="${i}" class="ed-sel" ${P.sel.has(i) ? 'checked' : ''} aria-label="고르기">
        <div class="t"><b>${q ? `${++no}. ` : `[${C.TYPE_NAME[p.t] || '알 수 없음'}] `}${esc(q ? p.q : p.title) || '(비어 있음)'}</b><span>${sub}</span>
        ${er.map(e => `<div style="color:var(--red);font-size:13px;font-weight:700">⚠ ${esc(e)}</div>`).join('')}${wr.map(e => `<div style="color:var(--amber);font-size:13px">· ${esc(e)}</div>`).join('')}</div>
        <button class="mini" data-a="ed-edit" data-i="${i}">고치기</button><button class="mini red" data-a="ed-rm" data-i="${i}">지우기</button></div>`;
    }).join('') || '<div class="panel" style="box-shadow:none"><div class="sm">아직 문항이 없어요. <b>① 문제 만들기</b>로 부탁문을 복사해 AI에게 주고, 받은 JSON을 <b>문항 묶음 붙여 넣기</b>로 넣으세요.</div></div>'}
    </div>
    <div class="qrow fixed"><div class="t"><b>마무리 쪽</b><span>자동으로 만들어집니다 — "고생하셨습니다"와 제출 확인.</span></div></div>`;
  document.querySelectorAll('.ed-sel').forEach(c => c.addEventListener('change', () => { c.checked ? P.sel.add(+c.dataset.i) : P.sel.delete(+c.dataset.i); }));
}
const selected = () => [...P.sel].filter(i => i < P.pages.length).sort((a, b) => a - b);
// 지운 직후에는 되돌릴 수 있게 합니다
async function removePages(idx) {
  P.sel.clear(); await changePages(P.pages.filter((_, i) => !idx.includes(i)), `문항 ${idx.length}개 지우기`); tabEdit();
  toast(`${idx.length}쪽을 지웠어요.`, 7000, { label: '되돌리기', fn: () => histUndo() });
}
on('ed-rm', el => removePages([+el.dataset.i]));
on('ed-del', () => { const sel = selected(); if (!sel.length) return toast('지울 문항을 먼저 골라 주세요(왼쪽 네모).'); return removePages(sel); });
on('ed-add', async () => {
  const a = P.pages.slice();
  const blank = C.normalizePage({ t: 'choice', q: '', opts: ['', '', '', ''], a: 0, why: '', level: '중', pts: 4 });
  const at = a.length; a.push(blank);
  await changePages(a, '빈 문항 추가'); tabEdit(); editPage(at);
});
async function movePage(from, to) {   // to: 옮긴 뒤의 자리
  if (from === to || from < 0 || to < 0) return;
  const a = P.pages.slice(), [x] = a.splice(from, 1); a.splice(to, 0, x);
  P.sel.clear(); await changePages(a, '문항 순서 바꾸기'); tabEdit();
}
/* 끌어서 순서 바꾸기 (마우스·손가락 모두) */
let DR = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest?.('[data-grip]'); if (!g || !P || P.tab !== 'edit') return;
  e.preventDefault(); hideCtx();
  DR = { from: +g.dataset.grip, to: null, row: g.closest('.qrow') }; DR.row.classList.add('drag');
  try { g.setPointerCapture(e.pointerId); } catch (err) {}
});
document.addEventListener('pointermove', e => {
  if (!DR) return;
  e.preventDefault();
  const rows = [...document.querySelectorAll('#qlist .qrow')];
  rows.forEach(r => r.classList.remove('over-t', 'over-b'));
  let hit = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
  if (!hit && rows.length) { const f = rows[0].getBoundingClientRect(), l = rows[rows.length - 1].getBoundingClientRect(); hit = e.clientY < f.top ? rows[0] : e.clientY > l.bottom ? rows[rows.length - 1] : null; }
  if (!hit) { DR.to = null; return; }
  const b = hit.getBoundingClientRect(), after = e.clientY > b.top + b.height / 2, i = +hit.dataset.i;
  hit.classList.add(after ? 'over-b' : 'over-t');
  let to = after ? i + 1 : i; if (to > DR.from) to--;
  DR.to = to;
  const sc = document.querySelector('.desk'), edge = 70;   // 화면 끝에서는 저절로 넘김
  if (sc) { if (e.clientY < edge) sc.scrollTop -= 14; else if (e.clientY > innerHeight - edge) sc.scrollTop += 14; }
}, { passive: false });
const endDrag = () => {
  if (!DR) return; const d = DR; DR = null;
  document.querySelectorAll('#qlist .qrow').forEach(r => r.classList.remove('over-t', 'over-b', 'drag'));
  if (d.to !== null && d.to !== d.from) movePage(d.from, d.to).catch(e => toast(errText(e)));
};
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
/* 오른쪽 버튼 메뉴 */
function hideCtx() { const c = $('ctx'); if (c) c.hidden = true; }
document.addEventListener('contextmenu', e => {
  const row = e.target.closest?.('#qlist .qrow'); if (!row || !P || P.tab !== 'edit') return;
  e.preventDefault();
  const c = $('ctx'), i = row.dataset.i;
  c.innerHTML = `<button data-a="ed-edit" data-i="${i}">고치기</button><button data-a="pv-open" data-i="${i}">학생 화면으로 보기</button><button data-a="ed-dup" data-i="${i}">복제</button><button class="red" data-a="ed-rm" data-i="${i}">지우기</button>`;
  c.hidden = false;
  c.style.left = Math.min(e.clientX, innerWidth - c.offsetWidth - 8) + 'px'; c.style.top = Math.min(e.clientY, innerHeight - c.offsetHeight - 8) + 'px';
});
document.addEventListener('click', hideCtx); document.addEventListener('scroll', hideCtx, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
on('ed-dup', async el => {
  const i = +el.dataset.i, a = P.pages.slice(), { id, ...copy } = a[i];
  a.splice(i + 1, 0, JSON.parse(JSON.stringify(copy)));
  P.sel.clear(); await changePages(a, '문항 복제'); tabEdit(); toast('복제했어요.');
});

/* ----- 붙여 넣기 ----- */
function pasteModal(replace) {
  const sel = selected();
  if (replace && !sel.length) return toast('교체할 문항을 먼저 골라 주세요(왼쪽 네모).');
  P.paste = { replace, sel, pages: null };
  modal(`<h2>${replace ? `고른 ${sel.length}쪽만 교체` : '문항 묶음 붙여 넣기'}</h2>
    <div class="sm">${replace ? `AI가 다시 써 준 문항 <b>${sel.length}개</b>를 [ ] 로 묶인 JSON 그대로 붙여 넣으세요. 고른 순서대로 바뀝니다.` : 'AI가 만든 <b>[ {"t":"intro", …}, … ]</b> 형태의 JSON 전체를 붙여 넣으세요. 미리 확인한 뒤 적용합니다.'}</div>
    <textarea class="in" id="p-text" rows="8" style="font-size:14px;font-family:ui-monospace,monospace" placeholder='[ {"t":"choice","q":"문제", …} ]'></textarea>
    <button class="btn" data-a="p-check">미리 확인</button><div id="p-out"></div>
    <button class="btn gh" data-a="modal-close">닫기</button>`, { wide: true });
}
on('ed-paste', () => pasteModal(false));
on('ed-replace', () => pasteModal(true));
on('p-check', () => {
  const out = $('p-out');
  try {
    const pages = C.ensureIds(questionsOnly(C.parseBundle($('p-text').value).map(C.normalizePage)));   // 안내·마무리 쪽이 섞여 와도 문제만 받습니다
    const v = C.validateBundle(pages), s = v.stats; P.paste.pages = pages;
    const lines = arr => arr.map(e => `${e.i >= 0 ? `${e.i + 1}번째 쪽: ` : ''}${e.msg}`).join('\n');
    const kinds = C.KINDS.filter(k => s.byKind[k]).map(k => `${C.KIND_NAME[k]} ${s.byKind[k]}`).join(' · ');
    out.innerHTML = `<div class="box info"><b>${pages.length}쪽</b>을 읽었어요 — 문제 ${s.n}개(${kinds}), 배점 합계 ${s.total}점, 난이도 하 ${s.byLevel['하']} · 중 ${s.byLevel['중']} · 상 ${s.byLevel['상']}</div>
      ${v.errors.length ? `<div class="box no" style="margin-top:8px"><b>고칠 곳 ${v.errors.length}군데</b> (넣은 뒤 문항 탭에서 고칠 수 있어요)\n${esc(lines(v.errors))}</div>` : ''}
      ${v.warnings.length ? `<div class="box warn" style="margin-top:8px"><b>확인할 곳 ${v.warnings.length}군데</b>\n${esc(lines(v.warnings))}</div>` : ''}
      <div class="row" style="margin-top:10px">${P.paste.replace ? '<button class="btn am" data-a="p-apply" data-m="sel">고른 문항 교체</button>' : `<button class="btn am" data-a="p-apply" data-m="all">${P.pages.length ? '전체 바꾸기' : '넣기'}</button>${P.pages.length ? '<button class="btn gh" data-a="p-apply" data-m="add">뒤에 추가</button>' : ''}`}</div>`;
  } catch (e) { P.paste.pages = null; out.innerHTML = `<div class="box no">${esc(e.message)}</div>`; }
});
on('p-apply', async el => {
  const fresh = P.paste.pages, mode = el.dataset.m; if (!fresh) return;
  let next;
  try {
    if (mode === 'sel') next = C.replaceSelected(P.pages, P.paste.sel, fresh.map(({ id, ...p }) => p));
    else if (mode === 'add') next = [...P.pages, ...fresh];
    else {
      if (P.pages.length && Object.keys(P.answers).length && !(await confirmBox('전체를 바꿀까요?', '이미 학생 답안이 있습니다. 문항을 바꾸면 기존 답안과 맞지 않게 됩니다.', '바꾸기', { danger: true }))) return;
      next = fresh;
    }
  } catch (e) { return toast(e.message, 4000); }
  // 붙여 넣은 JSON 안에 사진 자료(data:)가 있으면 사진 보관함으로 옮깁니다
  for (const p of next) if (p.img && p.img.startsWith('data:')) { const k = C.newId(); await be.set(`images/${P.id}/${k}`, p.img); P.imgs[k] = p.img; p.img = 'img:' + k; }
  P.sel.clear(); await changePages(next, '문항 붙여 넣기'); closeModal(); tabEdit(); toast('넣었어요.');
});

/* ----- 문항 하나 고치기 ----- */
let E = null;
const edBar = title => `<div class="edbar"><h2>${title}</h2><button class="btn s gh" data-a="modal-close">취소</button><button class="btn s" data-a="f-save">저장</button></div>`;
function editPage(i) {
  const p = P.pages[i];
  if (!C.isQuestion(p)) {
    E = { i };
    modal(`${edBar((C.TYPE_NAME[p.t] || '') + ' 쪽')}
      <label class="f">제목<input class="in" id="f-title" value="${esc(p.title)}" maxlength="80"></label>
      <label class="f">내용<textarea class="in" id="f-body" rows="5" maxlength="1000">${esc(p.body)}</textarea></label>`);
    return;
  }
  const k = C.kindOf(p);
  E = { i, img: p.img || '', kind: k, opts: p.opts && p.opts.length ? p.opts.slice() : ['', '', '', ''],   // 보기는 4칸이 기본, 더 필요하면 "보기 추가"
    right: k === 'check' ? (p.a || []).slice() : (Number.isInteger(p.a) ? [p.a] : []), answers: (p.answers || []).slice(), model: p.model || '' };
  modal(`${edBar('문항 고치기')}
    ${meta().status === 'running' ? '<div class="box warn"><b>시험이 진행 중입니다.</b> 지금 고치면 이미 푼 학생과 문제가 달라질 수 있어요.</div>' : ''}
    <div class="row"><label class="f" style="flex:1;min-width:130px">답하는 방식<select class="in" id="f-kind">${C.KINDS.map(x => `<option value="${x}" ${k === x ? 'selected' : ''}>${C.KIND_NAME[x]}</option>`).join('')}</select></label>
      <label class="f" style="flex:1;min-width:120px">쪽 모양<select class="in" id="f-shape"><option value="">기본</option><option value="image" ${p.t === 'image' ? 'selected' : ''}>그림 문제</option><option value="video" ${p.t === 'video' ? 'selected' : ''}>영상 문제</option></select></label>
      <label class="f" style="width:84px">난이도<select class="in" id="f-level">${['하', '중', '상'].map(l => `<option ${p.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" style="width:84px">배점<input class="in" id="f-pts" type="number" min="0" step="1" value="${p.pts || ''}"></label></div>
    <label class="f">문제<textarea class="in" id="f-q" rows="3" maxlength="1000">${esc(p.q)}</textarea></label>
    <div id="f-ans"></div>
    <label class="f"><span id="f-whyl">해설 (왜 정답인지)</span><textarea class="in" id="f-why" rows="3" maxlength="3000">${esc(p.why)}</textarea></label>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:700;color:var(--muted)">사진<div class="row"><input type="file" id="f-file" accept="image/*" style="max-width:100%"><button class="mini red" data-a="f-noimg">사진 빼기</button></div><div id="f-prev"></div></div>
    <label class="f">영상 주소 (유튜브 공유 링크)<input class="in" id="f-video" value="${esc(p.video || '')}" placeholder="https://youtu.be/…" maxlength="300"></label>`, { wide: true, sticky: true });
  $('f-kind').addEventListener('change', e => { keepAns(); E.kind = e.target.value; if (E.kind !== 'check' && E.right.length > 1) E.right = E.right.slice(0, 1); paintAns(); });
  $('f-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const data = await shrinkImage(f), key = C.newId(); await be.set(`images/${P.id}/${key}`, data); P.imgs[key] = data; E.img = 'img:' + key; paintPrev(); }
    catch (err) { toast(errText(err)); }
  });
  paintAns(); paintPrev();
}
// 답 칸에 쓰던 글자를 기억해 두었다가 다시 그립니다
function keepAns() {
  const o = document.querySelectorAll('.f-opt');
  if (o.length) { E.opts = [...o].map(x => x.value); E.right = [...document.querySelectorAll('.f-right:checked')].map(x => +x.value); }
  if ($('f-answers')) E.answers = $('f-answers').value.split('\n').map(x => x.trim()).filter(Boolean);
  if ($('f-model')) E.model = $('f-model').value;
}
function paintAns() {
  const k = E.kind, box = $('f-ans');
  $('f-whyl').textContent = k === 'long' ? '채점 기준' : '해설 (왜 정답인지)';
  if (C.hasOpts(k)) {
    const multi = k === 'check';
    box.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px"><div class="sm">보기 — ${multi ? '정답인 보기를 <b>모두</b> 체크하세요.' : '정답인 보기 왼쪽 동그라미를 누르세요.'}</div>
      ${E.opts.map((t, j) => `<div class="row" style="flex-wrap:nowrap"><input type="${multi ? 'checkbox' : 'radio'}" name="f-a" class="f-right" value="${j}" ${E.right.includes(j) ? 'checked' : ''} style="width:22px;height:22px;flex:none;accent-color:var(--pri)" aria-label="${j + 1}번이 정답"><input class="in f-opt" style="font-size:16px;padding:8px 10px" value="${esc(t)}" placeholder="보기 ${j + 1}" maxlength="300">${E.opts.length > 2 ? `<button class="mini" data-a="f-optdel" data-j="${j}" aria-label="보기 ${j + 1} 빼기">✕</button>` : ''}</div>`).join('')}
      ${E.opts.length < 6 ? '<button class="btn s gh" style="align-self:flex-start" data-a="f-optadd">+ 보기 추가</button>' : ''}</div>`;
  } else if (k === 'short') {
    box.innerHTML = `<label class="f">정답과 인정할 답 — 한 줄에 하나씩. 첫 줄이 대표 정답입니다.<textarea class="in" id="f-answers" rows="4" maxlength="1000" placeholder="사출금형&#10;사출금형기&#10;사출금헝">${esc(E.answers.join('\n'))}</textarea></label>
      <div class="sm">띄어쓰기와 영문 대소문자 차이는 자동으로 같은 답으로 봅니다. 시험 뒤 <b>채점</b> 탭에서 학생들이 쓴 답을 보고 더 인정할 수도 있습니다.</div>`;
  } else box.innerHTML = `<label class="f">모범 답안<textarea class="in" id="f-model" rows="3" maxlength="3000">${esc(E.model)}</textarea></label>`;
}
on('f-optadd', () => { keepAns(); if (E.opts.length < 6) E.opts.push(''); paintAns(); const o = document.querySelectorAll('.f-opt'); o[o.length - 1].focus(); });
on('f-optdel', el => { keepAns(); const j = +el.dataset.j; E.opts.splice(j, 1); E.right = E.right.filter(x => x !== j).map(x => (x > j ? x - 1 : x)); paintAns(); });
function paintPrev() { const src = srcOf({ img: E.img }); $('f-prev').innerHTML = src ? `<img src="${esc(src)}" alt="문항 사진" style="max-width:100%;max-height:200px;border-radius:12px;margin-top:6px;cursor:zoom-in" data-a="f-zoom">` : '<span class="sm">사진 없음</span>'; }
on('f-zoom', el => zoom(el.src));
on('f-noimg', () => { E.img = ''; $('f-file').value = ''; paintPrev(); });
on('ed-edit', el => editPage(+el.dataset.i));
on('f-save', async () => {
  const old = P.pages[E.i]; let p;
  if (!C.isQuestion(old)) p = { ...old, title: $('f-title').value.trim(), body: $('f-body').value.trim() };
  else {
    keepAns();
    const k = E.kind, shape = $('f-shape').value;
    const raw = { id: old.id, t: shape || k, ans: k, q: $('f-q').value, why: $('f-why').value, level: $('f-level').value, pts: +$('f-pts').value, img: E.img, video: $('f-video').value };
    if (C.hasOpts(k)) {
      const keep = E.opts.map((t, j) => j).filter(j => E.opts[j].trim());   // 빈 칸은 빼고, 정답 번호도 그에 맞춰 옮깁니다
      raw.opts = keep.map(j => E.opts[j].trim());
      const right = E.right.map(j => keep.indexOf(j)).filter(j => j >= 0);
      raw.a = k === 'check' ? right : (right.length ? right[0] : null);
    } else if (k === 'short') raw.answers = E.answers;
    else raw.model = E.model;
    p = C.normalizePage(raw);
  }
  const a = P.pages.slice(); a[E.i] = p;
  await changePages(a, '문항 고치기'); closeModal(); tabEdit();
});

/* ----- 복사 버튼 3개 ----- */
const PO_KEY = 'promptopts3';
const promptOpts = () => ({ ...C.PROMPT_DEFAULTS, ...(LS.get(PO_KEY) || {}) });
function showPrompt(k, text, ok) {
  modal(`<h2>${ok ? '복사했어요' : '아래 글을 복사하세요'}</h2><div class="sm">${k === 'make' ? '강의 자료 파일과 함께 AI에게 붙여 넣으세요.' : k === 'review' ? '문제를 만든 AI가 아닌 다른 AI에게 강의 자료와 함께 붙여 넣으세요.' : 'ChatGPT에 붙여 넣으세요. 앞선 검토 의견이 있으면 표시된 자리에 넣습니다.'}</div>
    <pre class="code">${esc(text)}</pre><button class="btn" data-a="modal-close">닫기</button>`, { wide: true });
}
on('cp', async el => {
  const o = promptOpts(), k = el.dataset.k;
  if (k === 'make') return makeForm();
  if (!P.pages.some(C.isQuestion)) return toast('먼저 문항을 넣어 주세요.');
  const text = k === 'review' ? C.promptReview(P.pages, o) : C.promptFinal(P.pages, o);
  showPrompt(k, text, await copyText(text));
});
// ① 문제 만들기: 총 문항 수에서 다른 유형을 빼면 객관식, 100%에서 중·상을 빼면 하, 배점은 합계에 맞춰 자동
let MK = null;
function makeForm() {
  MK = promptOpts(); MK.pts = { ...(MK.pts || {}) };
  modal(`<h2>문제 만들기 부탁문</h2><div class="sm">숫자를 바꾸면 나머지가 자동으로 맞춰집니다. 이 컴퓨터에 기억됩니다.</div>
    <label class="f">과목 이름<input class="in" id="mk-subject" value="${esc(MK.subject)}" placeholder="예: 기계공작법" maxlength="40"></label>
    <div id="mk-body" style="display:flex;flex-direction:column;gap:8px"></div>
    <div class="row"><button class="btn gh" data-a="modal-close">취소</button><button class="btn am" data-a="mk-copy">부탁문 복사</button></div>`, { wide: true });
  $('mk-subject').addEventListener('input', e => { MK.subject = e.target.value.trim(); });
  paintMake();
}
function paintMake(focusKey) {
  const pl = C.promptPlan(MK), c = pl.counts;
  const num = (key, label, val, extra = '') => `<label class="pcell">${label}<input class="in mk" data-k="${key}" type="number" inputmode="numeric" min="0" value="${val}" ${extra}></label>`;
  $('mk-body').innerHTML = `
    <div class="psec">문항 수</div>
    <div class="pgrid">${num('n', '총 문항 수', pl.n, 'max="200"')}
      <div class="pcell base-b">객관식 (기준)<span class="auto" id="mk-choice">${c.choice}</span><small>자동 계산</small></div>
      ${C.PROMPT_TYPES.filter(t => t[2]).map(([, name, f]) => num(f, name, MK[f] || 0, 'max="200"')).join('')}</div>
    <div class="psec">난이도 (%)</div>
    <div class="pgrid"><div class="pcell base-g">하 (기준)<span class="auto" id="mk-lo">${pl.lo}%</span><small>자동 계산</small></div>${num('mid', '중 %', pl.mid, 'max="100" step="5"')}${num('hi', '상 %', pl.hi, 'max="100" step="5"')}</div>
    <div class="psec">배점</div>
    <div class="pgrid">${num('total', '총 합계', pl.total, 'max="1000"')}
      ${C.PROMPT_TYPES.filter(([t]) => c[t] > 0).map(([t, name]) => `<label class="pcell">${name} 한 문항<input class="in mk" data-p="${t}" type="number" inputmode="numeric" min="1" placeholder="자동" value="${MK.pts[t] || ''}"></label>`).join('')}</div>
    <div class="sm">한 문항 점수 칸을 비워 두면 <b>자동</b>입니다. 남은 점수를 똑같이 나누고, 딱 나누어떨어지지 않으면 어려운 문항부터 1점씩 더 줍니다.</div>
    <div class="box ${pl.ok ? 'ok' : 'no'}" id="mk-sum">${pl.ok ? `<b>모두 ${pl.n}문항 · 합계 ${pl.total}점</b>\n${esc(C.promptPointsText(pl).replace(/^- /gm, ''))}` : esc(pl.errors.join('\n'))}</div>`;
  document.querySelector('[data-a=mk-copy]').disabled = !pl.ok;
  document.querySelectorAll('.mk').forEach(inp => inp.addEventListener('change', () => {
    if (inp.dataset.p) { const v = Math.round(+inp.value); if (v > 0) MK.pts[inp.dataset.p] = v; else delete MK.pts[inp.dataset.p]; }
    else MK[inp.dataset.k] = Math.max(0, Math.round(+inp.value || 0));
    paintMake(inp.dataset.k || 'p:' + inp.dataset.p);
  }));
  if (focusKey) { const el = focusKey.startsWith('p:') ? document.querySelector(`.mk[data-p="${focusKey.slice(2)}"]`) : document.querySelector(`.mk[data-k="${focusKey}"]`); if (el) el.focus(); }
}
on('mk-copy', async () => {
  if (!C.promptPlan(MK).ok) return;
  LS.set(PO_KEY, MK);
  const text = C.promptMake(MK);
  showPrompt('make', text, await copyText(text));
});

/* ================= 채점 (장문형은 직접, 단답형은 인정 답 확인) ================= */
const wrote = (a, id) => a.a && typeof a.a[id] === 'string' && a.a[id].trim();
function tabGrade() {
  const qs = P.pages.filter(p => C.isQuestion(p) && ['long', 'short'].includes(C.kindOf(p)));
  if (!qs.length) { $('pmain').innerHTML = '<div class="panel"><div class="sm">이 시험에는 장문형·단답형 문항이 없어요. 객관식·체크박스·드롭다운은 자동으로 채점됩니다.</div></div>'; return; }
  if (!qs.some(q => q.id === P.gq)) P.gq = qs[0].id;
  const q = qs.find(x => x.id === P.gq), k = C.kindOf(q), nos = Object.fromEntries(P.pages.filter(C.isQuestion).map((p, i) => [p.id, i + 1]));
  const tabs = `<div class="tabs">${qs.map(x => {
    const n = Object.values(P.answers).filter(a => wrote(a, x.id)).length;
    const d = C.kindOf(x) === 'long' ? Object.entries(P.answers).filter(([sid, a]) => wrote(a, x.id) && typeof (P.essay[sid] || {})[x.id] === 'number').length : null;
    return `<button data-a="g-q" data-id="${x.id}" class="${x.id === q.id ? 'on' : ''}">${nos[x.id]}번 ${C.KIND_NAME[C.kindOf(x)]} ${d === null ? `(${n}명)` : `(${d}/${n})`}</button>`;
  }).join('')}</div>`;
  if (k === 'short') {
    const { sheet, key } = exam(), took = Object.values(P.answers).filter(a => began(a) || (a && a.submittedAt));
    const st = C.questionStats(sheet, key, took.map(a => ({ answers: a.a || {} }))).find(s => s.id === q.id);
    $('pmain').innerHTML = `<div class="panel">${tabs}<div class="q" style="font-size:18px">${esc(q.q)}</div>
      <div class="box ok"><b>정답으로 인정하는 답</b>\n${esc((q.answers || []).join(' / '))}</div>
      <div class="sm">학생들이 쓴 답을 종류별로 모았습니다. 띄어쓰기·대소문자만 다른 답은 한 종류입니다. <b>정답으로 인정</b>을 누르면 그렇게 쓴 학생이 모두 다시 채점됩니다.</div>
      <div class="tw"><table><tr><th>학생이 쓴 답</th><th class="num">학생 수</th><th>채점</th><th></th></tr>
      ${st.tally.map(t => `<tr><td>${esc(t.text)}</td><td class="num">${t.n}명</td><td>${t.ok ? '<span class="pill ok">정답</span>' : '<span class="pill no">오답</span>'}</td>
        <td style="text-align:right">${t.ok ? ((q.answers || []).length > 1 ? `<button class="mini" data-a="g-reject" data-t="${esc(t.text)}">인정 취소</button>` : '') : `<button class="mini ok" data-a="g-accept" data-t="${esc(t.text)}">정답으로 인정</button>`}</td></tr>`).join('') || '<tr><td colspan="4">아직 이 문항에 답한 학생이 없어요.</td></tr>'}
      </table></div>${st.blank ? `<div class="sm">답을 쓰지 않은 학생 ${st.blank}명</div>` : ''}</div>`;
    return;
  }
  const base = Object.entries(P.answers).filter(([, a]) => wrote(a, q.id)).map(([sid, a]) => ({ sid, text: a.a[q.id] })).sort((a, b) => a.sid.localeCompare(b.sid));
  const list = P.blind ? C.shuffled(base, P.id + q.id) : base;   // 이름을 가릴 때는 학번 순서도 섞습니다
  const done = list.filter(s => typeof (P.essay[s.sid] || {})[q.id] === 'number').length;
  const step = q.pts <= 20 ? Array.from({ length: Math.floor(q.pts) + 1 }, (_, i) => i) : null;
  if (step && !Number.isInteger(q.pts)) step.push(q.pts);   // 배점이 2.5점처럼 딱 떨어지지 않아도 만점을 줄 수 있게
  $('pmain').innerHTML = `
    <div class="panel">${tabs}
      <div class="q" style="font-size:18px">${esc(q.q)}</div>
      ${q.model ? `<div class="box ok"><b>모범 답안</b>\n${esc(q.model)}</div>` : ''}${q.why ? `<div class="box info"><b>채점 기준</b>\n${esc(q.why)}</div>` : ''}
      <div class="row"><span class="sm" style="margin-right:auto" id="g-prog">배점 ${q.pts}점 · 채점 ${done} / ${list.length}명</span><button class="mini" data-a="g-blind">${P.blind ? '이름 보이기' : '이름 가리기'}</button><button class="mini" data-a="g-refresh">새 답안 불러오기</button></div></div>
    ${list.map((s, i) => {
      const r = whoOf(s.sid) || {}, g = (P.essay[s.sid] || {})[q.id];
      return `<div class="panel" data-sid="${esc(s.sid)}"><div class="sm">${P.blind ? `답안 ${i + 1}` : `${esc(r.cls || '')} ${esc(s.sid)} ${esc(r.name || '')}`}</div><div class="txt">${esc(s.text)}</div>
        ${step ? `<div class="scores">${step.map(v => `<button data-a="g-set" data-sid="${esc(s.sid)}" data-v="${v}" class="${g === v ? 'on' : ''}">${v}</button>`).join('')}</div>`
        : `<div class="row"><input class="in g-num" type="number" min="0" max="${q.pts}" step="0.5" value="${typeof g === 'number' ? g : ''}" data-sid="${esc(s.sid)}" style="width:120px;font-size:16px;padding:8px"><span class="sm">/ ${q.pts}점 — 입력하고 칸 밖을 누르면 저장</span></div>`}</div>`;
    }).join('') || '<div class="panel"><div class="sm">아직 이 문항에 답한 학생이 없어요.</div></div>'}`;
  document.querySelectorAll('.g-num').forEach(inp => inp.addEventListener('change', () => { if (inp.value !== '') grade(inp.dataset.sid, +inp.value); }));
}
async function setEssay(sid, qid, v) {
  const q = P.pages.find(x => x.id === qid); v = Math.max(0, Math.min(q.pts, v));
  (P.essay[sid] = P.essay[sid] || {})[qid] = v;
  try { await be.set(`essay/${P.id}/${sid}/${qid}`, v); } catch (e) { toast('점수를 저장하지 못했어요. ' + errText(e)); }
  return v;
}
async function grade(sid, v) {
  v = await setEssay(sid, P.gq, v);
  document.querySelectorAll(`.panel[data-sid="${CSS.escape(sid)}"] .scores button`).forEach(b => b.classList.toggle('on', +b.dataset.v === v));
}
on('g-set', el => grade(el.dataset.sid, +el.dataset.v));
on('g-q', el => { P.gq = el.dataset.id; tabGrade(); });
on('g-blind', () => { P.blind = !P.blind; tabGrade(); });
on('g-refresh', () => tabGrade());
// 단답형: 학생이 쓴 답을 정답으로 인정하거나 취소 → 정답지가 바뀌어 모두 다시 채점됩니다
async function setAccepted(text, accept) {
  const i = P.pages.findIndex(x => x.id === P.gq), p = P.pages[i], n = C.normAns(text);
  const answers = accept ? [...(p.answers || []), text] : (p.answers || []).filter(x => C.normAns(x) !== n);
  if (!answers.length) return toast('정답이 하나는 있어야 해요.');
  const a = P.pages.slice(); a[i] = C.normalizePage({ ...p, answers });
  await changePages(a, accept ? '단답형 정답 인정' : '단답형 인정 취소'); tabGrade(); toast(accept ? `"${text}" 을(를) 정답으로 인정했어요.` : '인정을 취소했어요.');
}
on('g-accept', el => setAccepted(el.dataset.t, true));
on('g-reject', el => setAccepted(el.dataset.t, false));

/* ================= 결과 ================= */
function resultRows() {
  const ppl = people(), { sheet, key } = exam(), sids = new Set([...Object.keys(ppl), ...Object.keys(P.answers)]);
  const rows = [...sids].map(sid => {
    const r = whoOf(sid) || { name: '(이름 없음)', cls: '' }, a = P.answers[sid], sc = C.scoreStudent(sheet, key, a && a.a, P.essay[sid]);
    return { sid, name: r.name, cls: r.cls, took: began(a) || !!(a && a.submittedAt), test: isTest(sid), a, lv: C.leaveSummary(a && a.ev), ...sc };
  });
  return { sheet, key, rows };
}
function tabResult() {
  const m = meta(), { sheet, key, rows } = resultRows();
  const tests = rows.filter(r => r.test && r.took);   // 테스트 학생은 순위·평균·통계에서 빼고 따로 보여 줌
  const took = rows.filter(r => r.took && !r.test && (!P.cls || r.cls === P.cls)), absent = rows.filter(r => !r.took && !r.test && (!P.cls || r.cls === P.cls));
  const rk = C.ranked(took), tot = took.map(r => r.total), avg = tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : 0;
  const pend = took.reduce((n, r) => n + r.essayPending, 0), max = sheet.reduce((n, q) => n + q.pts, 0);
  const stats = C.questionStats(sheet, key, took.map(r => ({ answers: (r.a && r.a.a) || {}, essay: P.essay[r.sid] || {} })));
  P.sheetOpts = Object.fromEntries(sheet.map(q => [q.id, q.opts || []]));
  const nTrash = Object.keys(P.trash || {}).length;
  const sub = [['rank', '순위'], ['chart', '그래프'], ['miss', '많이 틀린 문제'], ['leave', '이탈 기록'], ['trash', `휴지통${nTrash ? ' ' + nTrash : ''}`]];
  let body = '';
  if (P.rtab === 'rank') body = `<div class="sm">이름을 누르면 그 학생이 무엇을 틀렸는지 볼 수 있습니다.</div><div class="tw"><table><tr><th class="num">순위</th><th>반</th><th>학번</th><th>이름</th><th class="num">총점</th><th class="num">자동 채점</th><th class="num">장문형</th><th class="num">이탈</th><th class="num">카메라 경고 · 잠금</th><th class="num">풀이 시간</th><th>제출</th><th></th></tr>
    ${rk.map(r => `<tr><td class="num"><b>${r.rank}</b></td><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td><button class="namebtn" data-a="stu-detail" data-sid="${esc(r.sid)}">${esc(r.name)}</button>${testPill(r.sid)}</td><td class="num"><b>${r.total}</b></td><td class="num">${r.mc}</td><td class="num">${r.essay}${r.essayPending ? ' <span class="pill mid">채점 전</span>' : ''}</td><td class="num">${r.lv.count ? `<button class="mini red" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.count}회</button>` : ''}</td><td class="num">${r.lv.face || r.lv.locks ? `${r.lv.face} · ${r.lv.locks}` : ''}</td><td class="num">${totalTime(r.a) ? C.fmtDur(totalTime(r.a)) : ''}</td><td>${r.a.submittedAt ? hhmmss(r.a.submittedAt) : '<span class="pill">미제출</span>'}</td><td><button class="mini red" data-a="stu-del" data-sid="${esc(r.sid)}">지우기</button></td></tr>`).join('')}
    ${absent.map(r => `<tr><td class="num">—</td><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}${testPill(r.sid)}</td><td colspan="8"><span class="pill no">미응시</span></td></tr>`).join('')}</table></div>${tests.length ? `<div class="sm" style="margin-top:6px"><b>테스트 학생</b> — 순위·평균·통계·CSV·PDF에서 빠집니다. ${tests.map(r => `<button class="namebtn" data-a="stu-detail" data-sid="${esc(r.sid)}">${esc(r.sid)} ${r.total}점</button> <button class="mini red" data-a="stu-del" data-sid="${esc(r.sid)}">지우기</button>`).join(' · ')}</div>` : ''}${rk.length || absent.length || tests.length ? '' : '<div class="sm">아직 응시한 학생이 없어요.</div>'}`;
  else if (P.rtab === 'chart') body = `<h2>점수 분포</h2>${histChart(tot, max)}<h2 style="margin-top:8px">문항별 응답</h2><div class="sm">초록 막대(✓)가 정답, 분홍 막대는 가장 많이 고른 오답입니다.</div>${questionCharts(stats)}`;
  else if (P.rtab === 'miss') body = C.mostMissed(stats, 5).map(s => `<div class="box ${s.rate < .4 ? 'no' : 'warn'}"><b>${s.no}번 · ${s.auto ? `정답률 ${Math.round(s.rate * 100)}%` : `평균 ${s.avg.toFixed(1)} / ${s.pts}점`} · 난이도 ${esc(s.level || '')}</b>\n${esc(s.q)}${s.auto ? `\n정답: ${esc(s.answerText)}${s.topWrongText ? `\n가장 많이 고른 오답: ${esc(s.topWrongText)} (${s.choice ? s.picks[s.topWrong] : s.topWrongN}명)` : ''}` : ''}</div>`).join('') || '<div class="sm">아직 응시한 학생이 없어요.</div>';
  else if (P.rtab === 'trash') {
    const tr = Object.entries(P.trash || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    body = `<div class="sm">지운 학생은 여기에 모입니다. <b>되살리기</b>를 누르면 답안·점수·이탈 기록이 그대로 돌아옵니다. <b>휴지통 비우기</b>를 누르면 완전히 지워집니다.</div>
      <div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th>지운 시각</th><th></th></tr>
      ${tr.map(([k, t]) => { const sid = trashSid(k, t); return `<tr><td>${esc((t.who || {}).cls || '')}</td><td>${esc(sid)}</td><td>${esc((t.who || {}).name || '')}${testPill(sid)}</td><td>${hhmmss(t.at)}</td><td style="text-align:right"><button class="mini ok" data-a="trash-back" data-k="${esc(k)}">되살리기</button></td></tr>`; }).join('') || '<tr><td colspan="5">휴지통이 비어 있습니다.</td></tr>'}</table></div>
      ${tr.length ? '<div class="row"><button class="btn s gh" style="color:var(--red)" data-a="trash-empty">휴지통 비우기</button></div>' : ''}`;
  }
  else body = `<div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th class="num">횟수</th><th>시각</th></tr>
    ${took.filter(r => r.lv.count).sort((a, b) => b.lv.count - a.lv.count).map(r => `<tr><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="num">${r.lv.count}</td><td>${r.lv.list.filter(isLeave).map(e => hhmmss(e.at) + (e.t === 'unpin' ? '(고정 풀림)' : '')).join(', ')}</td></tr>`).join('') || '<tr><td colspan="5">이탈 기록이 없습니다.</td></tr>'}</table></div>`;
  $('pmain').innerHTML = `
    <div class="kpis"><div class="kpi"><b>${took.length}</b><span>응시</span></div><div class="kpi"><b>${avg.toFixed(1)}</b><span>평균 / ${max}점</span></div><div class="kpi"><b>${tot.length ? Math.max(...tot) : 0} · ${tot.length ? Math.min(...tot) : 0}</b><span>최고 · 최저</span></div><div class="kpi"><b>${pend}</b><span>장문형 채점 전</span></div></div>
    <div class="panel"><div class="row">${m.status === 'ended' ? `<button class="btn s ${m.released ? 'gh' : 'am'}" data-a="ex-release">${m.released ? '결과 공개 취소' : '결과 공개'}</button>` : '<span class="sm">시험이 끝나면 결과를 공개할 수 있습니다.</span>'}<button class="btn s gh" data-a="csv">엑셀(CSV) 내보내기</button><button class="btn s gh" data-a="pdf-all">전체 결과 PDF</button><button class="btn s gh" data-a="pdf-each">학생별 결과 PDF</button><span style="margin-left:auto">${clsFilter()}</span></div>
      <div class="tabs">${sub.map(([k, n]) => `<button data-a="r-tab" data-t="${k}" class="${P.rtab === k ? 'on' : ''}">${n}</button>`).join('')}</div>${body}</div>`;
}
on('r-tab', el => { P.rtab = el.dataset.t; tabResult(); });
on('csv', () => {
  const { sheet, rows } = resultRows(), m = meta();
  const took = C.ranked(rows.filter(r => r.took && !r.test)), absent = rows.filter(r => !r.took && !r.test).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
  const head = ['순위', '반', '학번', '이름', '총점', '만점', '자동 채점', '장문형', '답한 문항', '이탈 횟수', '이탈 시각', '카메라 경고', '잠금 횟수', '풀이 시간(초)', '시작', '제출', ...sheet.map((q, i) => `${i + 1}번(${q.pts}점)`)];
  const line = r => [r.rank || '', r.cls, r.sid, r.name, r.took ? r.total : '미응시', r.max, r.took ? r.mc : '', r.took ? r.essay : '', r.took ? r.answered : '', r.lv.count || '', r.lv.list.filter(isLeave).map(e => hhmmss(e.at)).join(' '), r.lv.face || '', r.lv.locks || '', r.took ? Math.round(totalTime(r.a)) : '', r.took ? hhmmss(r.a.startedAt) : '', r.took && r.a.submittedAt ? hhmmss(r.a.submittedAt) : '', ...sheet.map(q => (r.took ? (r.per[q.id].graded === false ? '채점 전' : r.per[q.id].pts) : ''))];
  download(`${(m.title || '시험').replace(/[\\/:*?"<>|]/g, '_')}_결과.csv`, C.toCSV([head, ...took.map(line), ...absent.map(line)]));
});

/* ================= 학생 화면으로 보기 (미리 보기) ================= */
// 학생이 보는 모양 그대로 넘겨 봅니다. 여기서 누른 답은 어디에도 저장되지 않습니다.
let PV = null;
on('pv-open', el => {
  const { sheet } = exam();
  if (!sheet.length) return toast('먼저 문항을 넣어 주세요.');
  const one = el.dataset.i !== undefined ? P.pages[+el.dataset.i] : null;
  PV = { sheet, shuffle: false, ans: {}, idx: one ? sheet.findIndex(q => q.id === one.id) + 1 : 0 };
  paintPreview();
});
function paintPreview() {
  const m = meta(), n = PV.sheet.length, order = PV.shuffle ? C.examOrder(PV.sheet, P.id, 'preview') : C.plainOrder(PV.sheet);
  PV.idx = Math.max(0, Math.min(n + 1, PV.idx));
  let inner;
  if (PV.idx === 0) inner = `<div class="bar"><span>시험 안내</span><span class="who">A반 20261234 홍길동</span></div>
    <div class="body"><div class="h1">${esc(m.title || '시험')}</div>${(m.notice || {}).body ? `<div class="txt">${esc(m.notice.body)}</div>` : ''}
      <ul class="rules"><li><b>시험 시작</b>을 누른 때부터 <b>${m.minutes}분</b>이 흐르고, 끝나면 자동으로 제출됩니다.</li><li>문제 순서와 보기 순서는 학생마다 다릅니다.</li><li>시험 화면을 벗어나면 <b>횟수와 시각이 기록</b>됩니다.</li><li>화면 캡처·녹화·복사는 금지입니다.</li><li>답은 고르는 즉시 저장됩니다. 앱이 꺼져도 이어서 풀 수 있습니다.</li></ul>
      <div class="box info">전화와 알림이 시험을 방해하지 않게 <b>방해 금지 모드</b>를 켜 주세요.</div><div class="check on"><i>✓</i>확인했습니다</div></div>`;
  else if (PV.idx === n + 1) inner = `<div class="body center dark" style="text-align:center;align-items:center"><div style="font-size:56px" aria-hidden="true">🎓</div><div class="h1">고생하셨습니다</div>${(m.end || {}).body ? `<div class="txt">${esc(m.end.body)}</div>` : ''}<div class="txt">답안이 제출되었습니다.</div><div class="sm">점수와 해설은 교수님이 공개하면 볼 수 있어요.</div></div>`;
  else {
    const o = order[PV.idx - 1], q = PV.sheet.find(x => x.id === o.id);
    inner = `<div class="bar"><span>${PV.idx} / ${n}</span><span class="clock">${C.fmtClock((m.minutes || 50) * 60000)}</span></div><div class="prog"><i style="width:${PV.idx / n * 100}%"></i></div>
      <div class="body qbody"><div class="qa"><div class="chip">${esc(typeChip(q))}</div><div class="q">${esc(q.q)}</div>${media(q, P.imgs)}</div><div class="qb">${answerHtml(q, o, PV.ans[q.id], 'pv-pick', 'pv-tick')}<div class="save" style="margin-top:auto">✓ 저장됨</div></div></div>`;
  }
  modal(`<div class="row"><h2 style="margin-right:auto">학생 화면으로 보기</h2><button class="mini ${PV.shuffle ? 'ok' : ''}" data-a="pv-shuffle">${PV.shuffle ? '섞어서 보는 중' : '원래 순서로 보는 중'}</button><button class="mini" data-a="modal-close">닫기</button></div>
    <div class="sm">${PV.idx === 0 ? '안내 쪽' : PV.idx === n + 1 ? '마무리 쪽' : `${PV.idx}번 문항`} · 여기서 누른 답은 저장되지 않습니다. 실제 시험에서는 학생마다 문제와 보기 순서가 다릅니다.</div>
    <div class="pvwrap"><div class="phone pv" id="pvphone">${inner}<div class="foot"><button class="btn gh" data-a="pv-go" data-d="-1" ${PV.idx ? '' : 'disabled'}>이전</button><button class="btn" data-a="pv-go" data-d="1" ${PV.idx <= n ? '' : 'disabled'}>다음</button></div></div></div>`, { wide: true });
  const qid = PV.idx >= 1 && PV.idx <= n ? order[PV.idx - 1].id : null, box = $('pvphone');
  const t = box.querySelector('#essay,#short'); if (t) t.addEventListener('input', () => { PV.ans[qid] = t.value; });
  const dd = box.querySelector('#dd'); if (dd) dd.addEventListener('change', () => { PV.ans[qid] = dd.value === '' ? '' : +dd.value; });
  PV.qid = qid;
}
on('pv-go', el => { PV.idx += +el.dataset.d; paintPreview(); });
on('pv-shuffle', () => { PV.shuffle = !PV.shuffle; paintPreview(); });
on('pv-pick', el => { PV.ans[PV.qid] = +el.dataset.v; paintPreview(); });
on('pv-tick', el => { const v = +el.dataset.v, cur = C.unpackChecks(PV.ans[PV.qid]); PV.ans[PV.qid] = C.packChecks(cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]); paintPreview(); });

/* ================= 학생별 상세 보기 · PDF ================= */
// 답을 사람이 읽는 글로: 객관식·드롭다운은 보기 글, 체크박스는 고른 보기들, 단답형·장문형은 쓴 글
function fmtAns(q, a) {
  if (a === undefined || a === null || a === '') return '';
  if (q.k === 'check') return C.unpackChecks(a).map(i => q.opts[i]).filter(Boolean).join(', ');
  if (C.hasOpts(q.k)) return q.opts[Number(a)] ?? '';
  return String(a);
}
function fmtKey(q, k) {
  if (q.k === 'check') return (k.a || []).map(i => q.opts[i]).join(', ');
  if (C.hasOpts(q.k)) return q.opts[k.a] ?? '';
  if (q.k === 'short') return (k.answers || []).join(' / ');
  return k.model || '';
}
// 한 학생의 문항별 결과
function studentItems(r, sheet, key) {
  return sheet.map((q, i) => {
    const k = key[q.id] || {}, p = r.per[q.id], a = r.a && r.a.a ? r.a.a[q.id] : undefined;
    return { no: i + 1, q, mine: fmtAns(q, a), right: fmtKey(q, k), ok: p.ok, pts: p.pts, graded: p.graded, level: k.level, why: k.why, sec: Number(r.a && r.a.tm && r.a.tm[q.id]) || 0 };
  });
}
const okText = it => (it.q.k === 'long' ? (it.graded ? (it.ok ? '만점' : '감점') : '채점 전') : it.ok ? '맞음' : (it.mine ? '틀림' : '안 풂'));
on('stu-detail', el => showDetail(el.dataset.sid));
function showDetail(sid, onlyWrong = false) {
  const { sheet, key, rows } = resultRows(), r = C.ranked(rows.filter(x => x.took && x.test === isTest(sid))).find(x => x.sid === sid);
  if (!r) return;
  const items = studentItems(r, sheet, key), wrong = items.filter(it => it.ok !== true), list = onlyWrong ? wrong : items;
  modal(`<div class="edbar"><h2>${esc(r.cls)} ${esc(r.sid)} ${esc(r.name)}</h2><button class="btn s gh" data-a="pdf-one" data-sid="${esc(sid)}">이 학생 PDF</button><button class="btn s gh" data-a="modal-close">닫기</button></div>
    <div class="kpis"><div class="kpi"><b>${r.total} / ${r.max}</b><span>총점 · ${r.rank}등</span></div><div class="kpi"><b>${r.mc}</b><span>자동 채점</span></div><div class="kpi"><b>${r.essay}${r.essayPending ? ' <small style="font-size:13px">(채점 전 ' + r.essayPending + ')</small>' : ''}</b><span>장문형</span></div><div class="kpi"><b>${r.lv.count}회</b><span>이탈${r.a.submittedAt ? ' · 제출 ' + hhmmss(r.a.submittedAt) : ' · 미제출'}</span></div><div class="kpi"><b>${r.lv.face} · ${r.lv.locks}</b><span>카메라 경고 · 잠금</span></div><div class="kpi"><b>${C.fmtDur(totalTime(r.a))}</b><span>풀이 시간</span></div></div>
    <div class="row"><div class="tabs"><button data-a="d-filter" data-sid="${esc(sid)}" data-w="" class="${onlyWrong ? '' : 'on'}">전체 ${items.length}문항</button><button data-a="d-filter" data-sid="${esc(sid)}" data-w="1" class="${onlyWrong ? 'on' : ''}">틀리거나 감점된 문항 ${wrong.length}</button></div></div>
    <div class="tw"><table class="dtab"><tr><th class="num">번호</th><th>문제</th><th>학생의 답</th><th>정답</th><th>결과</th><th class="num">풀이 시간</th><th class="num">점수</th></tr>
    ${list.map(it => `<tr class="${it.ok === true ? '' : it.ok === false ? 'bad' : 'pend'}"><td class="num">${it.no}</td><td>${esc(it.q.q)}<div class="sm">${C.KIND_NAME[it.q.k]} · 난이도 ${esc(it.level || '')}</div></td>
      <td class="pre">${esc(it.mine) || '<span class="sm">(답 없음)</span>'}</td><td class="pre">${esc(it.right)}</td>
      <td><span class="pill ${it.ok === true ? 'ok' : it.ok === false ? 'no' : 'mid'}">${okText(it)}</span></td>
      <td class="num">${it.sec ? C.fmtDur(it.sec) : ''}</td>
      <td class="num">${it.q.k === 'long' ? `<input class="in d-num" type="number" min="0" max="${it.q.pts}" step="0.5" value="${it.graded ? it.pts : ''}" data-q="${it.q.id}" aria-label="${it.no}번 점수" style="width:70px;font-size:15px;padding:5px 6px;text-align:right"> / ${it.q.pts}` : `${it.pts} / ${it.q.pts}`}</td></tr>`).join('') || '<tr><td colspan="7">틀린 문항이 없습니다.</td></tr>'}
    </table></div>
    ${r.lv.count ? `<div class="sm">이탈 시각: ${r.lv.list.filter(isLeave).map(e => hhmmss(e.at) + (e.t === 'unpin' ? '(고정 풀림)' : e.t === 'nopin' ? '(고정 없이 계속)' : '')).join(', ')}</div>` : ''}`, { wide: true });
  document.querySelectorAll('.d-num').forEach(inp => inp.addEventListener('change', async () => { if (inp.value === '') return; await setEssay(sid, inp.dataset.q, +inp.value); showDetail(sid, onlyWrong); if (P.tab === 'result') tabResult(); }));
}
on('d-filter', el => showDetail(el.dataset.sid, !!el.dataset.w));

/* ----- PDF: 인쇄 화면을 만들어 브라우저의 인쇄(→ "PDF로 저장")를 엽니다 ----- */
function doPrint(html, title) {
  $('print').innerHTML = html;
  const old = document.title; document.title = title;
  setTimeout(() => { window.print(); setTimeout(() => { document.title = old; }, 1500); }, 60);
}
const today = () => { const d = new Date(be.now()); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const fileName = s => (s || '시험').replace(/[\\/:*?"<>|]/g, '_');
function printStudent(r, sheet, key, m) {
  const items = studentItems(r, sheet, key);
  return `<section class="pr-page"><h1>${esc(m.title || '시험')} — 개인 결과</h1>
    <div class="pr-meta"><b>${esc(r.cls)} · ${esc(r.sid)} · ${esc(r.name)}</b><span>총점 <b>${r.total} / ${r.max}점</b> (${r.rank}등) · 자동 채점 ${r.mc}점 · 장문형 ${r.essay}점${r.essayPending ? ` (채점 전 ${r.essayPending}문항)` : ''}</span>
      <span>제출 ${r.a.submittedAt ? hhmmss(r.a.submittedAt) : '안 함'} · 이탈 ${r.lv.count}회${r.lv.count ? ' (' + r.lv.list.filter(isLeave).map(e => hhmmss(e.at)).join(', ') + ')' : ''} · 카메라 경고 ${r.lv.face}회 · 잠금 ${r.lv.locks}회 · 풀이 시간 ${C.fmtDur(totalTime(r.a))}</span></div>
    <table><tr><th>번호</th><th>문제</th><th>학생의 답</th><th>정답</th><th>결과</th><th>풀이 시간</th><th>점수</th></tr>
    ${items.map(it => `<tr class="${it.ok === false ? 'bad' : ''}"><td class="c">${it.no}</td><td>${esc(it.q.q)}</td><td class="pre">${esc(it.mine) || '(답 없음)'}</td><td class="pre">${esc(it.right)}</td><td class="c">${okText(it)}</td><td class="c">${it.sec ? C.fmtDur(it.sec) : ''}</td><td class="c">${it.q.k === 'long' && !it.graded ? '—' : it.pts} / ${it.q.pts}</td></tr>`).join('')}
    </table><div class="pr-foot">푸른시험 · ${today()} 출력</div></section>`;
}
function printData() {
  const { sheet, key, rows } = resultRows(), m = meta();
  const took = C.ranked(rows.filter(r => r.took && !r.test)).filter(r => !P.cls || r.cls === P.cls);   // 등수는 전체 기준, 보이는 반만 출력 (테스트 학생 제외)
  const absent = rows.filter(r => !r.took && !r.test && (!P.cls || r.cls === P.cls));
  return { sheet, key, m, took, absent };
}
on('pdf-one', el => { const d = printData(), r = d.took.find(x => x.sid === el.dataset.sid); if (r) doPrint(printStudent(r, d.sheet, d.key, d.m), `${fileName(d.m.title)}_${r.sid}_${r.name}`); });
on('pdf-each', () => {
  const d = printData(); if (!d.took.length) return toast('아직 응시한 학생이 없어요.');
  doPrint(d.took.slice().sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid)).map(r => printStudent(r, d.sheet, d.key, d.m)).join(''), `${fileName(d.m.title)}_학생별 결과${P.cls ? '_' + P.cls : ''}`);
});
on('pdf-all', () => {
  const d = printData(); if (!d.took.length) return toast('아직 응시한 학생이 없어요.');
  const tot = d.took.map(r => r.total), avg = tot.reduce((a, b) => a + b, 0) / tot.length, max = d.sheet.reduce((n, q) => n + q.pts, 0);
  const stats = C.questionStats(d.sheet, d.key, d.took.map(r => ({ answers: (r.a && r.a.a) || {}, essay: P.essay[r.sid] || {} })));
  doPrint(`<section class="pr-page"><h1>${esc(d.m.title || '시험')} — 전체 결과${P.cls ? ` (${esc(P.cls)})` : ''}</h1>
    <div class="pr-meta"><span>응시 <b>${d.took.length}명</b>${d.absent.length ? ` · 미응시 ${d.absent.length}명` : ''} · 평균 <b>${avg.toFixed(1)}</b> · 최고 ${Math.max(...tot)} · 최저 ${Math.min(...tot)} · 만점 ${max}점 · ${d.sheet.length}문항</span></div>
    <table><tr><th>순위</th><th>반</th><th>학번</th><th>이름</th><th>총점</th><th>자동 채점</th><th>장문형</th><th>이탈</th><th>제출</th></tr>
    ${d.took.map(r => `<tr><td class="c">${r.rank}</td><td class="c">${esc(r.cls)}</td><td class="c">${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="c"><b>${r.total}</b></td><td class="c">${r.mc}</td><td class="c">${r.essay}${r.essayPending ? ' (채점 전)' : ''}</td><td class="c">${r.lv.count || ''}</td><td class="c">${r.a.submittedAt ? hhmmss(r.a.submittedAt) : '미제출'}</td></tr>`).join('')}
    ${d.absent.map(r => `<tr><td class="c">—</td><td class="c">${esc(r.cls)}</td><td class="c">${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="c" colspan="5">미응시</td></tr>`).join('')}</table>
    <div class="pr-foot">푸른시험 · ${today()} 출력</div></section>
    <section class="pr-page"><h1>${esc(d.m.title || '시험')} — 문항별 결과</h1>
    <table><tr><th>번호</th><th>문제</th><th>유형</th><th>난이도</th><th>배점</th><th>정답</th><th>정답률</th><th>가장 많이 고른 오답</th></tr>
    ${stats.map(s => `<tr class="${s.auto && s.rate < .4 ? 'bad' : ''}"><td class="c">${s.no}</td><td>${esc(s.q)}</td><td class="c">${C.KIND_NAME[s.k]}</td><td class="c">${esc(s.level || '')}</td><td class="c">${s.pts}</td><td class="pre">${esc(s.auto ? s.answerText : '(교수 채점)')}</td><td class="c">${s.auto ? Math.round(s.rate * 100) + '%' : `평균 ${s.avg.toFixed(1)}`}</td><td class="pre">${s.auto && s.topWrongText ? `${esc(s.topWrongText)} (${s.choice ? s.picks[s.topWrong] : s.topWrongN}명)` : ''}</td></tr>`).join('')}</table>
    <div class="pr-foot">푸른시험 · ${today()} 출력</div></section>`, `${fileName(d.m.title)}_전체 결과${P.cls ? '_' + P.cls : ''}`);
});

/* ================= 학생 지우기 · 휴지통 · 테스트 학생 정리 ================= */
// 지운 학생은 이 시험의 휴지통으로 옮기고, 입장도 함께 취소합니다(학생 기기가 기록을 다시 만들지 않게).
// 휴지통은 지울 때마다 새 칸에 넣어, 같은 학번을 여러 번 지워도 앞의 기록이 덮이지 않습니다.
const trashSid = (key, t) => (t && t.sid) || String(key).split('_')[0];
on('stu-del', async el => {
  const id = P.id, sid = el.dataset.sid, w = whoOf(sid) || {}, m = meta(), cur = P.answers[sid];
  if (began(cur) && !cur.submittedAt && m.status === 'running' && !isTest(sid)) return toast('시험을 보는 중인 학생은 지울 수 없어요. 제출하거나 시험이 끝난 뒤에 지우세요.', 5000);
  if (!(await confirmBox(`${w.name || sid} 학생을 지울까요?`, `${esc(w.cls || '')} ${esc(sid)} ${esc(w.name || '')} 학생의 답안, 점수, 이탈 기록이 이 시험 결과에서 빠지고 <b>휴지통</b>으로 갑니다. 입장도 함께 취소됩니다. 휴지통에서 언제든 되살릴 수 있습니다.${['open', 'running'].includes(m.status) ? '\n\n시험이 아직 열려 있어서, 이 학생이 다시 입장하면 처음부터 다시 볼 수 있습니다.' : ''}`, '지우기', { danger: true }))) return;
  let key = '';
  await record(`${w.name || sid} 학생 지우기`, async () => {
    const [a, es] = await Promise.all([be.get(`answers/${id}/${sid}`), be.get(`essay/${id}/${sid}`)]);   // 확인한 뒤의 최신 기록
    if (!a && !es) throw new Error('지울 기록이 없어요.');
    key = `${sid}_${be.now()}`;
    const u = { [`answers/${id}/${sid}`]: null, [`essay/${id}/${sid}`]: null, [`bind/${sid}`]: null,
      [`trash/${id}/${key}`]: { sid, answers: a || null, essay: es || null, who: { name: w.name || '', cls: w.cls || '' }, at: be.now() } };
    for (const [k, v] of Object.entries(users)) if (v && v.sid === sid) u['users/' + k] = null;
    await be.update('', u);
  }, async () => {
    if (await be.get(`answers/${id}/${sid}`)) throw new Error('그 사이에 이 학생의 새 기록이 생겨 되돌리지 않았어요. 휴지통에서 확인해 주세요.');
    const t = await be.get(`trash/${id}/${key}`); if (!t) throw new Error('휴지통에서 이미 비워져 되돌릴 수 없어요.');
    await be.update('', { [`answers/${id}/${sid}`]: t.answers || null, [`essay/${id}/${sid}`]: t.essay || null, [`trash/${id}/${key}`]: null });
  });
  closeModal(); toast('지웠어요. 휴지통에 있습니다.', 7000, { label: '되돌리기', fn: () => histUndo() });
});
on('trash-back', async el => {
  const id = P.id, key = el.dataset.k, t = (P.trash || {})[key]; if (!t) return;
  const sid = trashSid(key, t);
  const [a, es] = await Promise.all([be.get(`answers/${id}/${sid}`), be.get(`essay/${id}/${sid}`)]);
  let swap = '', curRec = null;
  if (a || es) {   // 같은 학번의 기록이 이미 있으면 서로 바꿉니다 — 지금 기록도 휴지통에 남아 아무것도 사라지지 않음
    if (!(await confirmBox('같은 학번의 기록이 이미 있어요', `${esc(sid)} 학생의 지금 기록을 휴지통의 기록으로 바꿀까요? 지금 기록은 휴지통으로 옮겨 둡니다(지워지지 않음).`, '바꾸기'))) return;
    swap = `${sid}_${be.now()}`; curRec = { sid, answers: a || null, essay: es || null, who: (a && a.who) || t.who || null, at: be.now() };
  }
  await record(`${(t.who || {}).name || sid} 학생 되살리기`, async () => {
    const u = { [`answers/${id}/${sid}`]: t.answers || null, [`essay/${id}/${sid}`]: t.essay || null, [`trash/${id}/${key}`]: null };
    if (swap) u[`trash/${id}/${swap}`] = curRec;
    await be.update('', u);
  }, async () => {
    const now = await be.get(`answers/${id}/${sid}/startedAt`);
    if ((now || null) !== ((t.answers && t.answers.startedAt) || null)) throw new Error('그 사이에 기록이 바뀌어 되돌리지 않았어요.');
    const u = { [`answers/${id}/${sid}`]: swap ? curRec.answers : null, [`essay/${id}/${sid}`]: swap ? curRec.essay : null, [`trash/${id}/${key}`]: t };
    if (swap) u[`trash/${id}/${swap}`] = null;
    await be.update('', u);
  });
  toast(swap ? '바꿨어요. 원래 있던 기록은 휴지통에 있습니다.' : '되살렸어요.');
});
on('trash-empty', async () => {
  const id = P.id, all = { ...(P.trash || {}) }, n = Object.keys(all).length; if (!n) return;
  if (!(await confirmBox('휴지통을 비울까요?', `휴지통의 ${n}건이 <b>완전히 지워집니다.</b> 바로 뒤라면 되돌리기로 되살릴 수 있지만, 새로 고치거나 화면을 바꾸면 되살릴 수 없습니다.`, '비우기', { danger: true }))) return;
  const paths = v => Object.fromEntries(Object.keys(all).map(k => [`trash/${id}/${k}`, v === null ? null : all[k]]));
  await record(`휴지통 비우기 (${n}건)`, () => be.update('', paths(null)), () => be.update('', paths(1)));   // 비운 칸만 되살림(그 뒤에 들어온 것은 그대로)
});
// 교수 기기에서 만든 테스트 학생(학번이 TEST로 시작)을 모든 시험에서 한 번에 정리합니다
async function testPlan() {
  const [allAns, allEssay] = await Promise.all([be.get('answers'), be.get('essay')]);
  const del = {}, back = {}; let n = 0;
  for (const [k, v] of Object.entries(users)) if (v && isTest(v.sid)) { del['users/' + k] = null; back['users/' + k] = v; }
  for (const [sid, uid] of Object.entries(bind)) if (isTest(sid)) { del['bind/' + sid] = null; back['bind/' + sid] = uid; }
  for (const [e, mm] of Object.entries(allAns || {})) for (const [sid, a] of Object.entries(mm || {})) if (isTest(sid)) { del[`answers/${e}/${sid}`] = null; back[`answers/${e}/${sid}`] = a; n++; }
  for (const [e, mm] of Object.entries(allEssay || {})) for (const [sid, v] of Object.entries(mm || {})) if (isTest(sid)) { del[`essay/${e}/${sid}`] = null; back[`essay/${e}/${sid}`] = v; }
  return { del, back, n };
}
on('test-clean', async () => {
  const again = !!$('peopleBox');   // 확인 창이 학생 목록을 닫으므로, 끝나면 다시 엽니다
  const first = await testPlan();
  if (!Object.keys(first.del).length) return toast('정리할 테스트 학생이 없어요.');
  if (!(await confirmBox('테스트 학생을 정리할까요?', `학번이 TEST로 시작하는 학생의 입장 기록과 모든 시험의 답안 ${first.n}건을 지웁니다. 실제 학생은 그대로입니다. 바로 뒤라면 되돌리기로 되살릴 수 있습니다.`, '정리', { danger: true }))) return;
  let back = {};
  await record('테스트 학생 정리', async () => {
    const plan = await testPlan(); back = plan.back;   // 확인한 뒤의 최신 기록
    if (Object.keys(plan.del).length) await be.update('', plan.del);
  }, async () => {
    const cur = await Promise.all(Object.keys(back).map(async p => [p, await be.get(p)]));
    const u = {}; let kept = 0;
    for (const [p, v] of cur) { if (v == null) u[p] = back[p]; else kept++; }   // 그 사이에 새로 생긴 기록은 덮지 않음
    if (Object.keys(u).length) await be.update('', u);
    if (kept) toast(`${kept}건은 그 사이에 새 기록이 있어 그대로 두었어요.`, 5000);
  });
  toast('정리했어요.', 7000, { label: '되돌리기', fn: () => histUndo() });
  if (again) document.querySelector('[data-a=people]')?.click();
});
