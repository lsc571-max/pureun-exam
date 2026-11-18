// 푸른시험 — 교수 화면 (시험 목록 · 명단 · 진행 · 문항 편집 · 서술형 채점 · 결과)
import * as C from './core.js';
import { S, be, parse } from './state.js';
import { $, esc, on, toast, modal, closeModal, confirmBox, zoom, CIRCLED, errText, hhmmss, download, copyText, shrinkImage } from './ui.js';

const app = $('app');
let roster = {}, bind = {}, users = {}, P = null, clockT = 0, liveT = 0, baseSubs = [];
const LS = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const ST = { draft: ['', '준비 중'], open: ['mid', '대기실 열림'], running: ['ok', '진행 중'], ended: ['no', '종료'] };
const pill = m => { const s = ST[m.status] || ST.draft; return `<span class="pill ${s[0]}">${s[1]}</span>${m.released ? ' <span class="pill ok">결과 공개</span>' : ''}${m.practice ? ' <span class="pill">문제풀이 공개</span>' : ''}`; };
const meta = () => S.exams[P.id] || {};
// 학생 목록 = 명단 + (명단 없이) 직접 입력해 입장한 학생
const people = () => { const m = {}; for (const u of Object.values(users)) if (u && u.sid) m[u.sid] = { name: u.name, cls: u.cls, self: true }; return { ...m, ...roster }; };
const students = () => Object.entries(people()).map(([sid, r]) => ({ sid, ...r })).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));

export function start() {
  baseSubs.forEach(u => u()); baseSubs = [
    be.on('roster', v => { roster = v || {}; live(); }),
    be.on('bind', v => { bind = v || {}; live(); }),
    be.on('users', v => { users = v || {}; live(); if (!P && $('listMain')) viewList(); }),
  ];
  P = null; viewList();
}
export function onClasses() { if ($('clsBox')) paintClasses(); if (P && (P.tab === 'run' || P.tab === 'result')) renderTab(); }
export function onExams() { if (!P) viewList(); else if (!S.exams[P.id]) { closeExam(); viewList(); } else { paintHead(); live(); } }
// 학생들이 답을 저장할 때마다 화면을 다시 그리되, 너무 잦지 않게 모아서 그립니다.
function live() {
  if ($('rosterBox')) paintRoster();
  if (!P) return;
  if (P.tab !== 'run' && P.tab !== 'result') return;
  clearTimeout(liveT); liveT = setTimeout(() => { if (P && (P.tab === 'run' || P.tab === 'result')) renderTab(); }, 350);
}

/* ================= 시험 목록 ================= */
function viewList() {
  const list = Object.entries(S.exams).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  app.innerHTML = `<div class="desk"><header><h1>푸른시험 · 교수</h1><button data-a="roster">학생 (${students().length}명)</button><button data-a="logout">로그아웃</button></header>
    <main id="listMain">
      <div class="panel"><h2>새 시험 만들기</h2>
        <div class="row"><label class="f" style="flex:1;min-width:180px">시험 이름<input class="in" id="n-title" placeholder="예: 기계공작법 중간고사" maxlength="60"></label>
        <label class="f" style="width:110px">시험 시간(분)<input class="in" id="n-min" type="number" min="1" max="300" value="50"></label>
        <button class="btn s" style="align-self:flex-end" data-a="new-exam">만들기</button></div></div>
      ${list.length ? list.map(([id, m]) => `<button class="card" data-a="p-open" data-id="${esc(id)}"><div style="margin-bottom:6px">${pill(m)}</div><h3>${esc(m.title || '(이름 없음)')}</h3><div class="sm">${m.n || 0}문항 · ${m.total || 0}점 · ${m.minutes || 0}분</div></button>`).join('')
      : '<div class="panel"><div class="sm">아직 시험이 없어요. 위에서 새 시험을 만들어 주세요.</div></div>'}
    </main></div>`;
}
on('logout', async () => { if (await confirmBox('로그아웃할까요?', '', '로그아웃')) { closeExam(); await be.signOut(); location.href = './?prof=1'; } });
on('new-exam', async () => {
  const title = $('n-title').value.trim(), minutes = Math.round(+$('n-min').value);
  if (!title) return toast('시험 이름을 입력해 주세요.');
  if (!(minutes >= 1 && minutes <= 300)) return toast('시험 시간은 1~300분으로 입력해 주세요.');
  const id = 'e' + Date.now().toString(36);
  await be.set('exams/' + id, { title, minutes, status: 'draft', released: false, practice: false, n: 0, total: 0, at: be.now() });
  openExam(id, 'edit');
});

/* ================= 명단 ================= */
on('roster', () => {
  modal(`<h2>학생</h2>
    <div class="box info">${Object.keys(roster).length ? '<b>명단 확인 켜짐</b> — 명단의 반·학번·이름과 똑같이 입력한 학생만 입장합니다.' : '<b>명단 없이 입장</b> — 학생이 반·학번·이름을 직접 입력하고 들어옵니다. 아래에 명단을 넣으면 명단에 있는 학생만 입장하게 바뀝니다(선택).'}</div>
    <div class="panel" style="padding:12px"><h2>반</h2><div class="sm">학생이 입장할 때 고르는 반입니다. 이름은 자유롭게 정할 수 있고(예: 1학년 A반, C반), 하나만 두면 학생은 반을 고르지 않습니다.</div>
      <div id="clsBox"></div>
      <div class="row"><input class="in" id="c-new" placeholder="새 반 이름" maxlength="20" style="flex:1;min-width:140px;font-size:16px;padding:9px 11px"><button class="btn s" data-a="c-add">반 추가</button></div></div>
    <div class="sm">명단을 쓰려면 엑셀에서 <b>반 · 학번 · 이름</b> 칸을 복사해 붙여 넣으세요. 칸 순서는 상관없고 한 줄에 한 명입니다.</div>
    <textarea class="in" id="r-text" rows="5" placeholder="A	20261234	홍길동&#10;B	20261301	김철수" style="font-size:15px"></textarea>
    <div class="row"><button class="btn s" data-a="r-add">명단에 추가</button><button class="btn s gh" data-a="r-replace">전체 바꾸기</button></div>
    <div id="r-msg"></div><div id="rosterBox"></div>
    <button class="btn gh" data-a="modal-close">닫기</button>`, { wide: true });
  paintRoster(); paintClasses();
});
function paintClasses() {
  const box = $('clsBox'); if (!box) return;
  box.innerHTML = `<div class="row" style="margin:8px 0">${S.classes.map(c => `<span class="pill" style="font-size:15px;padding:4px 6px 4px 12px">${esc(c)} <button class="mini red" data-a="c-del" data-c="${esc(c)}" aria-label="${esc(c)} 삭제" ${S.classes.length > 1 ? '' : 'disabled'}>✕</button></span>`).join('')}</div>`;
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
  if (n) return toast(`${c}에 학생이 ${n}명 있어요. 반을 지우려면 그 학생들을 먼저 정리해 주세요.`, 4000);
  await saveClasses(S.classes.filter(x => x !== c));
});
function paintRoster() {
  const box = $('rosterBox'); if (!box) return;
  const st = students(), cnt = c => st.filter(s => s.cls === c).length;
  if (!st.length) { box.innerHTML = '<div class="sm">아직 입장한 학생이 없어요.</div>'; return; }
  box.innerHTML = `<div class="sm" style="margin-bottom:6px">전체 ${st.length}명 (${[...new Set([...S.classes, ...st.map(x => x.cls)])].map(c => `${esc(c)} ${cnt(c)}`).join(' · ')}) · 입장한 기기 ${st.filter(s => bind[s.sid]).length}대</div>
    <div class="tw" style="max-height:40dvh;overflow:auto"><table><tr><th>반</th><th>학번</th><th>이름</th><th>기기</th><th></th></tr>
    ${st.map(s => `<tr><td>${esc(s.cls)}</td><td>${esc(s.sid)}</td><td>${esc(s.name)}</td><td>${bind[s.sid] ? '<span class="pill ok">입장함</span>' : '<span class="pill">미입장</span>'}</td>
      <td style="white-space:nowrap">${bind[s.sid] ? `<button class="mini" data-a="unbind" data-sid="${esc(s.sid)}">기기 풀기</button> ` : ''}${roster[s.sid] ? `<button class="mini red" data-a="r-del" data-sid="${esc(s.sid)}">명단에서 삭제</button>` : ''}</td></tr>`).join('')}
    </table></div>`;
}
async function rosterApply(replace) {
  const { rows, errors } = C.parseRoster($('r-text').value, S.classes);
  const bad = rows.filter(r => !C.validSid(r.sid));
  if (!rows.length || bad.length) { $('r-msg').innerHTML = `<div class="box no">${esc(bad.length ? `학번에 쓸 수 없는 글자가 있어요: ${bad[0].sid}` : errors.length ? errors.map(e => e.msg).join('\n') : '붙여 넣은 내용이 없어요.')}</div>`; return; }
  if (replace && !(await confirmBox('명단 전체를 바꿀까요?', `지금 명단 ${Object.keys(roster).length}명을 지우고 ${rows.length}명으로 바꿉니다.`, '바꾸기', { danger: true }))) return;
  const next = Object.fromEntries(rows.map(r => [r.sid, { name: r.name, cls: r.cls }]));
  if (replace) await be.set('roster', next); else await be.update('roster', next);
  toast(`${rows.length}명을 넣었어요.` + (errors.length ? ` 못 읽은 줄 ${errors.length}개` : ''));
  const msg = $('r-msg'); if (msg) msg.innerHTML = errors.length ? `<div class="box warn">${esc(errors.map(e => e.msg).join('\n'))}</div>` : '';
  const t = $('r-text'); if (t) t.value = '';
}
on('r-add', () => rosterApply(false));
on('r-replace', () => rosterApply(true));
on('r-del', async el => { await be.update('', { ['roster/' + el.dataset.sid]: null }); });
// 휴대폰을 바꾸거나 앱을 다시 설치한 학생: 묶음을 풀면 새 기기에서 다시 입장할 수 있습니다. 답안은 그대로 남습니다.
on('unbind', async el => {
  const sid = el.dataset.sid, uid = bind[sid], r = people()[sid] || {};
  if (!(await confirmBox('기기 묶음을 풀까요?', `${esc(r.name || sid)} 학생이 다른 기기에서 다시 입장할 수 있게 됩니다. 저장된 답안은 그대로 남습니다.`, '풀기'))) return;
  const u = { ['bind/' + sid]: null }; if (uid) u['users/' + uid] = null;
  await be.update('', u); toast('풀었어요. 학생이 다시 입장하면 됩니다.');
  if (P) renderTab();
});

/* ================= 시험 하나 열기 ================= */
async function openExam(id, tab = 'run') {
  closeExam();
  P = { id, tab, pages: [], imgs: {}, answers: {}, essay: {}, sel: new Set(), cls: '', rtab: 'rank', gq: '', blind: true, unsubs: [] };
  const [draft, imgs] = await Promise.all([be.get('drafts/' + id), be.get('images/' + id)]);
  if (!P || P.id !== id) return;
  P.pages = parse(draft, []); P.imgs = imgs || {};
  P.unsubs.push(be.on('answers/' + id, v => { P.answers = v || {}; live(); }));
  P.unsubs.push(be.on('essay/' + id, v => { P.essay = v || {}; live(); }));
  app.innerHTML = `<div class="desk"><header id="phead"></header><main><div class="tabs" id="ptabs"></div><div id="pmain" style="display:flex;flex-direction:column;gap:14px"></div></main></div>`;
  paintHead(); renderTab();
  clockT = setInterval(paintClock, 1000);
}
function closeExam() { clearInterval(clockT); clearTimeout(liveT); if (P) P.unsubs.forEach(u => u()); P = null; }
on('p-open', el => openExam(el.dataset.id));
on('p-back', () => { closeExam(); viewList(); });
function paintHead() {
  if (!P || !$('phead')) return;
  const m = meta();
  $('phead').innerHTML = `<button data-a="p-back">← 목록</button><h1>${esc(m.title || '')}</h1><span>${pill(m)}</span>`;
  $('ptabs').innerHTML = [['run', '진행'], ['edit', '문항'], ['grade', '서술형 채점'], ['result', '결과']].map(([k, n]) => `<button data-a="p-tab" data-t="${k}" class="${P.tab === k ? 'on' : ''}">${n}</button>`).join('');
}
on('p-tab', el => { P.tab = el.dataset.t; paintHead(); renderTab(); });
function renderTab() { if (!P) return; ({ run: tabRun, edit: tabEdit, grade: tabGrade, result: tabResult })[P.tab](); paintClock(); }
function paintClock() {
  const el = $('pclock'); if (!el || !P) return; const m = meta();
  el.textContent = m.status === 'running' ? C.fmtClock(m.endAt - be.now()) : '--:--';
}
const exam = () => C.splitExam(P.pages);
const clsFilter = () => `<div class="tabs">${[['', '전체'], ...[...new Set([...S.classes, ...students().map(x => x.cls)])].filter(Boolean).map(c => [c, c])].map(([c, n]) => `<button data-a="p-cls" data-c="${esc(c)}" class="${P.cls === c ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`;
on('p-cls', el => { P.cls = el.dataset.c; renderTab(); });

/* ================= 진행 ================= */
function tabRun() {
  const m = meta(), st = students(), v = C.validateBundle(P.pages), { sheet } = exam();
  const rows = st.filter(s => !P.cls || s.cls === P.cls).map(s => {
    const a = P.answers[s.sid], lv = C.leaveSummary(a && a.ev);
    return { ...s, a, lv, cnt: a && a.a ? Object.values(a.a).filter(x => x !== '' && x != null).length : 0 };
  });
  const k = { all: rows.length, inb: rows.filter(r => bind[r.sid]).length, go: rows.filter(r => r.a && r.a.startedAt && !r.a.submittedAt).length, sub: rows.filter(r => r.a && r.a.submittedAt).length, lv: rows.filter(r => r.lv.count).length };
  const btns = {
    draft: `<button class="btn s am" data-a="ex-status" data-s="open">학생에게 열기 (대기실)</button>`,
    open: `<button class="btn s am" data-a="ex-start">시험 시작 (모든 반 함께)</button><button class="btn s gh" data-a="ex-status" data-s="draft">대기실 닫기</button>`,
    running: `<button class="btn s gh" data-a="ex-extend">시간 5분 연장</button><button class="btn s red" data-a="ex-end">시험 종료 (모든 반 함께)</button>`,
    ended: `<button class="btn s ${m.released ? 'gh' : 'am'}" data-a="ex-release">${m.released ? '결과 공개 취소' : '결과 공개'}</button>${m.released ? '' : '<button class="btn s gh" data-a="ex-resume">다시 열기 (못 본 학생 응시)</button>'}`,
  }[m.status || 'draft'];
  const guide = { draft: '문항과 명단을 준비한 뒤 대기실을 여세요. 학생은 대기실에서 안내를 읽고 기다립니다.', open: '학생들이 입장해 기다리고 있습니다. 시작을 누르면 모든 반이 동시에 시작합니다.', running: `${hhmmss(m.startAt)} 시작 · ${hhmmss(m.endAt)} 종료 예정. 시간이 되면 자동으로 제출됩니다.`, ended: '시험이 끝났습니다. 서술형을 채점한 뒤 결과를 공개하세요.' }[m.status || 'draft'];
  $('pmain').innerHTML = `
    <div class="panel"><div class="row"><h2 style="margin-right:auto">${ST[m.status || 'draft'][1]}</h2><span class="pill" style="font-size:20px;padding:2px 14px" id="pclock">--:--</span></div>
      <div class="sm">${esc(guide)}</div>
      ${v.errors.length ? `<div class="box no">문항에 고칠 곳이 ${v.errors.length}군데 있어요. <b>문항</b> 탭에서 확인해 주세요.</div>` : ''}
      <div class="row">${btns}<button class="btn s gh" data-a="ex-settings">시험 설정</button><button class="btn s gh" data-a="ex-copy">시험 복사 (재시험용)</button></div>
      ${m.status === 'ended' && m.released ? '<div class="sm">결과를 공개한 상태에서는 정답이 보이므로 다시 열 수 없습니다. 다시 열려면 먼저 "결과 공개 취소"를 누르거나, "시험 복사"로 새 시험을 만드세요.</div>' : ''}</div>
    <div class="kpis"><div class="kpi"><b>${k.inb} / ${k.all}</b><span>입장</span></div><div class="kpi"><b>${k.go}</b><span>응시 중</span></div><div class="kpi"><b>${k.sub}</b><span>제출</span></div><div class="kpi"><b>${k.lv}</b><span>이탈한 학생</span></div></div>
    <div class="panel"><div class="row"><h2 style="margin-right:auto">응시 현황</h2>${clsFilter()}</div>
      <div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th>상태</th><th class="num">답한 문항</th><th class="num">이탈</th><th></th></tr>
      ${rows.map(r => `<tr><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td>
        <td>${r.a && r.a.submittedAt ? `<span class="pill ok">제출 ${hhmmss(r.a.submittedAt)}</span>` : r.a && r.a.startedAt ? '<span class="pill mid">응시 중</span>' : bind[r.sid] ? '<span class="pill">입장</span>' : '<span class="pill no">미입장</span>'}</td>
        <td class="num">${r.a ? `${r.cnt} / ${sheet.length}` : ''}</td>
        <td class="num">${r.lv.count ? `<button class="mini red" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.count}회</button>` : ''}</td>
        <td style="white-space:nowrap">${bind[r.sid] ? `<button class="mini" data-a="unbind" data-sid="${esc(r.sid)}">기기 풀기</button> ` : ''}${r.a && r.a.submittedAt && m.status === 'running' ? `<button class="mini" data-a="unsubmit" data-sid="${esc(r.sid)}">제출 취소</button>` : ''}</td></tr>`).join('')}
      </table></div>${rows.length ? '' : '<div class="sm">아직 입장한 학생이 없어요. 학생이 반·학번·이름을 입력하고 들어오면 여기에 나타납니다.</div>'}</div>`;
}
const setMeta = patch => be.update('exams/' + P.id, patch);
on('ex-status', async el => {
  if (el.dataset.s === 'open') {
    const v = C.validateBundle(P.pages);
    if (v.errors.length) return toast('문항에 고칠 곳이 있어요. 문항 탭에서 먼저 고쳐 주세요.');
  }
  await setMeta({ status: el.dataset.s });
});
on('ex-start', async () => {
  const m = meta(), v = C.validateBundle(P.pages);
  if (v.errors.length) return toast('문항에 고칠 곳이 있어요.');
  if (!(await confirmBox('시험을 시작할까요?', `모든 반이 함께 시작합니다. <b>${m.minutes}분</b> 뒤 자동으로 끝납니다.`, '시작'))) return;
  const now = be.now(); await setMeta({ status: 'running', startAt: now, endAt: now + m.minutes * 60000 });
});
on('ex-extend', async () => { await setMeta({ endAt: meta().endAt + 5 * 60000 }); toast('5분 연장했어요.'); });
on('ex-end', async () => {
  if (!(await confirmBox('시험을 종료할까요?', '모든 학생의 시험이 바로 끝나고, 지금까지 저장된 답안으로 채점됩니다.', '종료', { danger: true }))) return;
  await setMeta({ status: 'ended', endAt: Math.min(meta().endAt, be.now()) });
});
// 끝난 시험을 다시 엽니다 (시험을 못 본 학생용)
on('ex-resume', () => {
  const m = meta(), started = Object.values(P.answers).filter(a => a.startedAt && !a.submittedAt).length;
  modal(`<h2>시험 다시 열기</h2>
    <div class="txt">정한 시간 동안 시험이 다시 진행됩니다. 이미 제출한 학생은 다시 풀 수 없습니다.</div>
    <label class="f">다시 여는 시간(분)<input class="in" id="rs-min" type="number" min="1" max="300" value="${m.minutes || 50}"></label>
    <button class="check on" data-a="rs-lock" id="rs-lock"><i>✓</i>이미 응시한 학생은 제출 처리하기</button>
    <div class="sm">켜 두면 <b>시험을 아예 보지 않은 학생만</b> 응시할 수 있습니다. 끄면 응시했지만 제출하지 않은 학생${started ? ` ${started}명` : ''}도 이어서 풀 수 있습니다.</div>
    <div class="row"><button class="btn gh" data-a="modal-close">취소</button><button class="btn am" data-a="rs-go">다시 열기</button></div>`);
});
on('rs-lock', el => el.classList.toggle('on'));
on('rs-go', async () => {
  const minutes = Math.round(+$('rs-min').value), lock = $('rs-lock').classList.contains('on');
  if (!(minutes >= 1 && minutes <= 300)) return toast('시간은 1~300분으로 입력해 주세요.');
  const m = meta(), now = be.now(), u = { [`exams/${P.id}/status`]: 'running', [`exams/${P.id}/endAt`]: now + minutes * 60000 };
  if (lock) for (const [sid, a] of Object.entries(P.answers)) if (a.startedAt && !a.submittedAt) u[`answers/${P.id}/${sid}/submittedAt`] = m.endAt || now;
  await be.update('', u); closeModal(); toast(`${minutes}분 동안 다시 열었어요.`);
});
// 문항과 사진만 그대로 새 시험으로 복사합니다 (답안·점수는 복사하지 않음)
on('ex-copy', async () => {
  const m = meta();
  if (!(await confirmBox('이 시험을 복사할까요?', '문항과 사진을 그대로 담은 새 시험이 "준비 중" 상태로 만들어집니다. 답안과 점수는 복사되지 않습니다. 재시험용으로 문항을 고쳐 쓰세요.', '복사'))) return;
  const src = P.id, id = 'e' + Date.now().toString(36), at = be.now();
  const [draft, sheet, key, imgs] = await Promise.all(['drafts/', 'sheets/', 'keys/', 'images/'].map(k => be.get(k + src)));
  const u = { ['exams/' + id]: { title: (m.title || '시험') + ' (재시험)', minutes: m.minutes || 50, status: 'draft', released: false, practice: false, n: m.n || 0, total: m.total || 0, notice: m.notice || null, end: m.end || null, at } };
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
    if (!(await confirmBox('결과를 공개할까요?', `학생이 자기 점수, 틀린 문항, 해설을 볼 수 있게 됩니다.${pend ? `\n\n<b>아직 채점하지 않은 서술형 답이 ${pend}개</b> 있습니다.` : ''}`, '공개'))) return;
  }
  await setMeta({ released: !m.released });
});
on('unsubmit', async el => { if (await confirmBox('제출을 취소할까요?', '학생이 남은 시간 동안 다시 풀 수 있게 됩니다.', '취소하기')) await be.remove(`answers/${P.id}/${el.dataset.sid}/submittedAt`); });
on('lv-show', el => {
  const sid = el.dataset.sid, r = people()[sid] || {}, lv = C.leaveSummary((P.answers[sid] || {}).ev);
  const name = { leave: '화면을 벗어남', back: '돌아옴', unpin: '화면 고정이 풀림' };
  modal(`<h2>${esc(r.cls || '')} ${esc(sid)} ${esc(r.name || '')} — 이탈 ${lv.count}회</h2>
    <div class="tw"><table><tr><th>시각</th><th>내용</th></tr>${lv.list.map(e => `<tr><td>${hhmmss(e.at)}</td><td>${esc(name[e.t] || e.t)}</td></tr>`).join('')}</table></div>
    <button class="btn gh" data-a="modal-close">닫기</button>`);
});
on('ex-settings', () => {
  const m = meta();
  modal(`<h2>시험 설정</h2>
    <label class="f">시험 이름<input class="in" id="s-title" value="${esc(m.title || '')}" maxlength="60"></label>
    <label class="f">시험 시간(분) ${m.status === 'running' ? '— 진행 중에는 "5분 연장"을 쓰세요' : ''}<input class="in" id="s-min" type="number" min="1" max="300" value="${m.minutes || 50}" ${m.status === 'running' ? 'disabled' : ''}></label>
    <button class="check ${m.practice ? 'on' : ''}" data-a="s-practice" id="s-prac"><i>✓</i>문제풀이(학습) 모드로 공개</button>
    <div class="sm">켜면 명단의 학생이 이 문항을 순서대로 풀며 정답과 해설을 바로 봅니다. 실제 시험 문항에는 켜지 마세요.</div>
    <button class="btn" data-a="s-save">저장</button>
    <hr style="border:0;border-top:1px solid var(--line)">
    <button class="btn gh" data-a="ex-wipe">답안 모두 지우기 (모의시험 뒤 초기화)</button>
    <button class="btn red" data-a="ex-delete">이 시험 삭제</button>
    <button class="btn gh" data-a="modal-close">닫기</button>`);
});
on('s-practice', el => el.classList.toggle('on'));
on('s-save', async () => {
  const title = $('s-title').value.trim(), minutes = Math.round(+$('s-min').value), practice = $('s-prac').classList.contains('on');
  if (!title || !(minutes >= 1 && minutes <= 300)) return toast('이름과 시간을 확인해 주세요.');
  if (practice && !meta().practice && meta().status !== 'draft' && !(await confirmBox('시험 문항을 문제풀이로 공개할까요?', '학생이 정답과 해설을 모두 볼 수 있게 됩니다.', '공개', { danger: true }))) return;
  await setMeta({ title, minutes, practice }); closeModal(); toast('저장했어요.');
});
on('ex-wipe', async () => {
  if (!(await confirmBox('답안을 모두 지울까요?', '이 시험의 모든 학생 답안, 이탈 기록, 서술형 점수가 지워지고 시험이 "준비 중"으로 돌아갑니다. <b>되돌릴 수 없습니다.</b>', '모두 지우기', { danger: true }))) return;
  await be.update('', { ['answers/' + P.id]: null, ['essay/' + P.id]: null, [`exams/${P.id}/status`]: 'draft', [`exams/${P.id}/released`]: false, [`exams/${P.id}/startAt`]: null, [`exams/${P.id}/endAt`]: null });
  closeModal(); toast('지웠어요.');
});
on('ex-delete', async () => {
  if (!(await confirmBox('이 시험을 삭제할까요?', '문항, 답안, 점수가 모두 지워집니다. <b>되돌릴 수 없습니다.</b>', '삭제', { danger: true }))) return;
  const id = P.id; closeExam(); closeModal();
  await be.update('', Object.fromEntries(['exams', 'drafts', 'sheets', 'keys', 'images', 'answers', 'essay'].map(k => [`${k}/${id}`, null])));
  viewList();
});

/* ================= 문항 편집 ================= */
async function savePages(pages) {
  P.pages = C.ensureIds(pages);
  const x = C.splitExam(P.pages), v = C.validateBundle(P.pages), at = be.now(), id = P.id;
  await be.update('', {
    ['drafts/' + id]: { data: JSON.stringify(P.pages), at },
    ['sheets/' + id]: { data: JSON.stringify(x.sheet), at },   // 학생용: 정답·해설 없음
    ['keys/' + id]: { data: JSON.stringify(x.key), at },       // 교수용 / 공개 후 학생
    [`exams/${id}/notice`]: x.notice, [`exams/${id}/end`]: x.end, [`exams/${id}/n`]: v.stats.n, [`exams/${id}/total`]: v.stats.total,
  });
}
const srcOf = p => !p.img ? '' : p.img.startsWith('img:') ? (P.imgs[p.img.slice(4)] || '') : p.img;
function tabEdit() {
  const v = C.validateBundle(P.pages), s = v.stats, m = meta();
  const errAt = i => v.errors.filter(e => e.i === i).map(e => e.msg), warnAt = i => v.warnings.filter(e => e.i === i).map(e => e.msg);
  let no = 0;
  $('pmain').innerHTML = `
    ${m.status === 'running' ? '<div class="box warn"><b>시험이 진행 중입니다.</b> 지금 문항을 고치면 이미 푼 학생과 달라질 수 있어요.</div>' : ''}
    <div class="panel"><div class="row"><h2 style="margin-right:auto">${s.n}문항 · ${s.total}점</h2><span class="sm">사지선다 ${s.choice} · 서술형 ${s.essay} · 난이도 상 ${s.byLevel['상']} 중 ${s.byLevel['중']} 하 ${s.byLevel['하']}</span></div>
      <div class="row"><button class="btn s" data-a="ed-paste">문항 묶음 붙여 넣기</button><button class="btn s gh" data-a="ed-replace">고른 문항만 교체 붙여 넣기</button><button class="btn s gh" data-a="ed-add">빈 문항 추가</button><button class="btn s gh" data-a="ed-del">고른 문항 삭제</button></div>
      <div class="ask"><div class="ask-t">AI 부탁문 <span>문제를 만들고 검토할 때 차례로 복사해 쓰세요</span></div>
        <div class="row"><button class="btn s am" data-a="cp" data-k="make">① 문제 만들기</button><button class="btn s am" data-a="cp" data-k="review">② 정확성 검토</button><button class="btn s am" data-a="cp" data-k="final">③ 최종 확인</button></div></div>
      ${v.errors.length ? `<div class="box no"><b>고칠 곳 ${v.errors.length}군데</b> — 빨간 문항을 확인하세요. 고치기 전에는 시험을 열 수 없습니다.${v.errors.filter(e => e.i < 0).map(e => '\n' + esc(e.msg)).join('')}</div>` : s.n ? '<div class="box ok">문항 검사를 통과했습니다.</div>' : ''}
    </div>
    ${P.pages.map((p, i) => {
      const q = C.isQuestion(p), er = errAt(i), wr = warnAt(i);
      const sub = q ? `${C.TYPE_NAME[p.t]} · 난이도 ${esc(p.level)} · ${p.pts}점${C.isChoice(p) && Number.isInteger(p.a) && p.opts[p.a] ? ` · 정답 ${CIRCLED[p.a]} ${esc(p.opts[p.a])}` : ''}${p.img ? ' · 📷 사진' : ''}${p.video ? ' · ▶ 영상' : ''}` : esc(p.body || '');
      return `<div class="qrow ${er.length ? 'err' : ''}"><input type="checkbox" data-i="${i}" class="ed-sel" ${P.sel.has(i) ? 'checked' : ''} aria-label="고르기">
        <div class="t"><b>${q ? `${++no}. ` : `[${C.TYPE_NAME[p.t] || '알 수 없음'}] `}${esc(q ? p.q : p.title) || '(비어 있음)'}</b><span>${sub}</span>
        ${er.map(e => `<div style="color:var(--no);font-size:13px;font-weight:700">⚠ ${esc(e)}</div>`).join('')}${wr.map(e => `<div style="color:var(--warn);font-size:13px">· ${esc(e)}</div>`).join('')}</div>
        <button class="mini" data-a="ed-up" data-i="${i}" aria-label="위로" ${i ? '' : 'disabled'}>↑</button><button class="mini" data-a="ed-down" data-i="${i}" aria-label="아래로" ${i < P.pages.length - 1 ? '' : 'disabled'}>↓</button><button class="mini" data-a="ed-edit" data-i="${i}">고치기</button></div>`;
    }).join('') || '<div class="panel"><div class="sm">아직 문항이 없어요. <b>① 문제 만들기 부탁문</b>을 복사해 AI에게 주고, 받은 JSON을 <b>문항 묶음 붙여 넣기</b>로 넣으세요.</div></div>'}`;
  document.querySelectorAll('.ed-sel').forEach(c => c.addEventListener('change', () => { c.checked ? P.sel.add(+c.dataset.i) : P.sel.delete(+c.dataset.i); }));
}
const selected = () => [...P.sel].filter(i => i < P.pages.length).sort((a, b) => a - b);
on('ed-up', async el => { const i = +el.dataset.i, a = P.pages.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; P.sel.clear(); await savePages(a); tabEdit(); });
on('ed-down', async el => { const i = +el.dataset.i, a = P.pages.slice(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; P.sel.clear(); await savePages(a); tabEdit(); });
on('ed-del', async () => {
  const sel = selected(); if (!sel.length) return toast('삭제할 문항을 먼저 골라 주세요(왼쪽 네모).');
  if (!(await confirmBox(`고른 ${sel.length}쪽을 삭제할까요?`, '', '삭제', { danger: true }))) return;
  P.sel.clear(); await savePages(P.pages.filter((_, i) => !sel.includes(i))); tabEdit();
});
on('ed-add', async () => {
  const end = P.pages.findIndex(p => p.t === 'end'), a = P.pages.slice();
  const blank = C.normalizePage({ t: 'choice', q: '', opts: ['', '', '', ''], a: 0, why: '', level: '중', pts: 4 });
  const at = end < 0 ? a.length : end; a.splice(at, 0, blank);
  await savePages(a); tabEdit(); editPage(at);
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
    const pages = C.ensureIds(C.parseBundle($('p-text').value).map(C.normalizePage));
    const v = C.validateBundle(pages), s = v.stats; P.paste.pages = pages;
    const lines = arr => arr.map(e => `${e.i >= 0 ? `${e.i + 1}번째 쪽: ` : ''}${e.msg}`).join('\n');
    out.innerHTML = `<div class="box info"><b>${pages.length}쪽</b>을 읽었어요 — 문제 ${s.n}개(사지선다 ${s.choice} · 서술형 ${s.essay}), 배점 합계 ${s.total}점, 난이도 상 ${s.byLevel['상']} · 중 ${s.byLevel['중']} · 하 ${s.byLevel['하']}</div>
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
    else if (mode === 'add') { const end = P.pages.findIndex(p => p.t === 'end'), a = P.pages.slice(); a.splice(end < 0 ? a.length : end, 0, ...fresh.filter(C.isQuestion)); next = a; }
    else {
      if (P.pages.length && Object.keys(P.answers).length && !(await confirmBox('전체를 바꿀까요?', '이미 학생 답안이 있습니다. 문항을 바꾸면 기존 답안과 맞지 않게 됩니다.', '바꾸기', { danger: true }))) return;
      next = fresh;
    }
  } catch (e) { return toast(e.message, 4000); }
  // 붙여 넣은 JSON 안에 사진 자료(data:)가 있으면 사진 보관함으로 옮깁니다
  for (const p of next) if (p.img && p.img.startsWith('data:')) { const k = C.newId(); await be.set(`images/${P.id}/${k}`, p.img); P.imgs[k] = p.img; p.img = 'img:' + k; }
  P.sel.clear(); await savePages(next); closeModal(); tabEdit(); toast('넣었어요.');
});

/* ----- 문항 하나 고치기 ----- */
let E = null;
function editPage(i) {
  const p = P.pages[i]; E = { i, img: p.img || '' };
  if (!C.isQuestion(p)) {
    modal(`<div class="edbar"><h2>${C.TYPE_NAME[p.t] || ''} 쪽</h2><button class="btn s gh" data-a="modal-close">취소</button><button class="btn s" data-a="f-save">저장</button></div>
      <label class="f">제목<input class="in" id="f-title" value="${esc(p.title)}" maxlength="80"></label>
      <label class="f">내용<textarea class="in" id="f-body" rows="5" maxlength="1000">${esc(p.body)}</textarea></label>`);
    return;
  }
  const opts = p.opts || [];
  modal(`<div class="edbar"><h2>문항 고치기</h2><button class="btn s gh" data-a="modal-close">취소</button><button class="btn s" data-a="f-save">저장</button></div>
    <div class="row"><label class="f" style="flex:1">유형<select class="in" id="f-t">${C.QTYPES.map(t => `<option value="${t}" ${p.t === t ? 'selected' : ''}>${C.TYPE_NAME[t]}</option>`).join('')}</select></label>
      <label class="f" style="width:90px">난이도<select class="in" id="f-level">${C.LEVELS.map(l => `<option ${p.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f" style="width:90px">배점<input class="in" id="f-pts" type="number" min="0" step="0.5" value="${p.pts || ''}"></label></div>
    <label class="f">문제<textarea class="in" id="f-q" rows="3" maxlength="1000">${esc(p.q)}</textarea></label>
    <label class="f">답하는 방식<select class="in" id="f-kind"><option value="c" ${C.isChoice(p) ? 'selected' : ''}>사지선다 (보기에서 고르기)</option><option value="e" ${C.isChoice(p) ? '' : 'selected'}>서술형 (글로 쓰기)</option></select></label>
    <div id="f-choice" ${C.isChoice(p) ? '' : 'hidden'} style="display:flex;flex-direction:column;gap:6px"><div class="sm">보기 — 정답인 보기 왼쪽 동그라미를 누르세요. 빈 칸은 저장할 때 빠집니다.</div>
      ${[0, 1, 2, 3, 4, 5].map(k => `<div class="row" style="flex-wrap:nowrap"><input type="radio" name="f-a" value="${k}" ${p.a === k ? 'checked' : ''} style="width:22px;height:22px;flex:none" aria-label="${k + 1}번이 정답"><input class="in f-opt" style="font-size:16px;padding:8px 10px" value="${esc(opts[k] || '')}" placeholder="보기 ${k + 1}${k > 3 ? ' (선택)' : ''}" maxlength="300"></div>`).join('')}</div>
    <label class="f" id="f-modelw" ${C.isChoice(p) ? 'hidden' : ''}>모범 답안<textarea class="in" id="f-model" rows="3" maxlength="3000">${esc(p.model || '')}</textarea></label>
    <label class="f">해설 (왜 정답인지) / 서술형은 채점 기준<textarea class="in" id="f-why" rows="3" maxlength="3000">${esc(p.why)}</textarea></label>
    <div class="f">사진<div class="row"><input type="file" id="f-file" accept="image/*" style="max-width:100%"><button class="mini red" data-a="f-noimg">사진 빼기</button></div><div id="f-prev"></div></div>
    <label class="f">영상 주소 (유튜브 공유 링크)<input class="in" id="f-video" value="${esc(p.video || '')}" placeholder="https://youtu.be/…" maxlength="300"></label>`, { wide: true, sticky: true });
  $('f-kind').addEventListener('change', e => { const c = e.target.value === 'c'; $('f-choice').hidden = !c; $('f-modelw').hidden = c; });
  $('f-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const data = await shrinkImage(f), k = C.newId(); await be.set(`images/${P.id}/${k}`, data); P.imgs[k] = data; E.img = 'img:' + k; paintPrev(); }
    catch (err) { toast(errText(err)); }
  });
  paintPrev();
}
function paintPrev() { const src = srcOf({ img: E.img }); $('f-prev').innerHTML = src ? `<img src="${esc(src)}" alt="문항 사진" style="max-width:100%;max-height:200px;border-radius:10px;margin-top:6px;cursor:zoom-in" data-a="f-zoom">` : '<span class="sm">사진 없음</span>'; }
on('f-zoom', el => zoom(el.src));
on('f-noimg', () => { E.img = ''; $('f-file').value = ''; paintPrev(); });
on('ed-edit', el => editPage(+el.dataset.i));
on('f-save', async () => {
  const old = P.pages[E.i]; let p;
  if (!C.isQuestion(old)) p = { ...old, title: $('f-title').value.trim(), body: $('f-body').value.trim() };
  else {
    const raw = { id: old.id, t: $('f-t').value, q: $('f-q').value, why: $('f-why').value, level: $('f-level').value, pts: +$('f-pts').value, img: E.img, video: $('f-video').value };
    if ($('f-kind').value === 'c') {
      const all = [...document.querySelectorAll('.f-opt')].map(x => x.value.trim());
      const picked = +(document.querySelector('input[name=f-a]:checked') || {}).value;
      const keep = all.map((t, k) => k).filter(k => all[k]);
      raw.opts = keep.map(k => all[k]); raw.a = keep.indexOf(picked) >= 0 ? keep.indexOf(picked) : null;
    } else raw.model = $('f-model').value;
    p = C.normalizePage(raw);
  }
  const a = P.pages.slice(); a[E.i] = p;
  await savePages(a); closeModal(); tabEdit();
});

/* ----- 복사 버튼 3개 ----- */
const PO_KEY = 'promptopts2';
const promptOpts = () => ({ subject: '', nChoice: 20, nEssay: 2, nImage: 0, nVideo: 0, hi: 5, mid: 11, lo: 6, ptsChoice: 4, ptsEssay: 10, ...(LS.get(PO_KEY) || {}) });
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
// ① 문제 만들기: 유형별 문항 수 · 난이도별 문항 수 · 배점을 골라서 부탁문을 만듭니다
function makeForm() {
  const o = promptOpts();
  const sel = (k, label, max, min = 0) => `<label class="f" style="flex:1;min-width:104px">${label}<select class="in po" data-k="${k}">${Array.from({ length: max - min + 1 }, (_, i) => i + min).map(v => `<option ${+o[k] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`;
  modal(`<h2>문제 만들기 부탁문</h2><div class="sm">고른 값이 부탁문에 들어갑니다. 이 컴퓨터에 기억됩니다.</div>
    <label class="f">과목 이름<input class="in" id="po-subject" value="${esc(o.subject)}" placeholder="예: 기계공작법" maxlength="40"></label>
    <div class="sm" style="font-weight:700;color:var(--navy)">유형별 문항 수</div>
    <div class="row">${sel('nChoice', '객관식(사지선다)', 60)}${sel('nEssay', '주관식(서술형)', 20)}${sel('nImage', '그림 문제', 20)}${sel('nVideo', '영상 문제', 20)}</div>
    <div class="sm" style="font-weight:700;color:var(--navy)">난이도별 문항 수</div>
    <div class="row">${sel('hi', '상', 60)}${sel('mid', '중', 60)}${sel('lo', '하', 60)}</div>
    <div class="sm" style="font-weight:700;color:var(--navy)">배점</div>
    <div class="row">${sel('ptsChoice', '객관식·그림·영상 한 문항', 20, 1)}${sel('ptsEssay', '주관식 한 문항', 30, 1)}</div>
    <div id="po-sum"></div>
    <div class="row"><button class="btn gh" data-a="modal-close">취소</button><button class="btn am" data-a="po-copy">부탁문 복사</button></div>`, { wide: true });
  const paint = () => {
    const v = readMake(), t = C.promptTotals(v), ok = t.count > 0 && t.count === t.levels;
    $('po-sum').innerHTML = `<div class="box ${ok ? 'ok' : 'warn'}"><b>모두 ${t.count}문항 · 합계 ${t.total || 0}점</b>${ok ? '' : t.count ? `\n난이도별 문항 수의 합(${t.levels})이 전체 문항 수(${t.count})와 같아야 합니다.` : '\n문항 수를 골라 주세요.'}</div>`;
    document.querySelector('[data-a=po-copy]').disabled = !ok;
  };
  document.querySelectorAll('.po').forEach(x => x.addEventListener('change', paint));
  paint();
}
function readMake() {
  const o = { subject: $('po-subject').value.trim() };
  document.querySelectorAll('.po').forEach(i => { o[i.dataset.k] = +i.value || 0; });
  return o;
}
on('po-copy', async () => {
  const o = readMake(); LS.set(PO_KEY, o);
  const text = C.promptMake(o);
  showPrompt('make', text, await copyText(text));
});

/* ================= 서술형 채점 ================= */
function tabGrade() {
  const qs = P.pages.filter(C.isEssay);
  if (!qs.length) { $('pmain').innerHTML = '<div class="panel"><div class="sm">이 시험에는 서술형 문항이 없어요. 사지선다는 자동으로 채점됩니다.</div></div>'; return; }
  if (!qs.some(q => q.id === P.gq)) P.gq = qs[0].id;
  const q = qs.find(x => x.id === P.gq), nos = Object.fromEntries(P.pages.filter(C.isQuestion).map((p, i) => [p.id, i + 1]));
  const base = Object.entries(P.answers).filter(([, a]) => a.a && typeof a.a[q.id] === 'string' && a.a[q.id].trim()).map(([sid, a]) => ({ sid, text: a.a[q.id] })).sort((a, b) => a.sid.localeCompare(b.sid));
  const list = P.blind ? C.shuffled(base, P.id + q.id) : base;   // 이름을 가릴 때는 학번 순서도 섞습니다
  const done = list.filter(s => typeof (P.essay[s.sid] || {})[q.id] === 'number').length;
  const step = q.pts <= 20 ? Array.from({ length: Math.floor(q.pts) + 1 }, (_, i) => i) : null;
  $('pmain').innerHTML = `
    <div class="panel"><div class="tabs">${qs.map(x => { const n = Object.values(P.answers).filter(a => a.a && typeof a.a[x.id] === 'string' && a.a[x.id].trim()).length, d = Object.entries(P.answers).filter(([sid, a]) => a.a && typeof a.a[x.id] === 'string' && a.a[x.id].trim() && typeof (P.essay[sid] || {})[x.id] === 'number').length; return `<button data-a="g-q" data-id="${x.id}" class="${x.id === q.id ? 'on' : ''}">${nos[x.id]}번 (${d}/${n})</button>`; }).join('')}</div>
      <div class="q" style="font-size:18px">${esc(q.q)}</div>
      ${q.model ? `<div class="box ok"><b>모범 답안</b>\n${esc(q.model)}</div>` : ''}${q.why ? `<div class="box info"><b>채점 기준</b>\n${esc(q.why)}</div>` : ''}
      <div class="row"><span class="sm" style="margin-right:auto" id="g-prog">배점 ${q.pts}점 · 채점 ${done} / ${list.length}명</span><button class="mini" data-a="g-blind">${P.blind ? '이름 보이기' : '이름 가리기'}</button><button class="mini" data-a="g-refresh">새 답안 불러오기</button></div></div>
    ${list.map((s, i) => {
      const r = people()[s.sid] || {}, g = (P.essay[s.sid] || {})[q.id];
      return `<div class="panel" data-sid="${esc(s.sid)}"><div class="sm">${P.blind ? `답안 ${i + 1}` : `${esc(r.cls || '')} ${esc(s.sid)} ${esc(r.name || '')}`}</div><div class="txt">${esc(s.text)}</div>
        ${step ? `<div class="scores">${step.map(v => `<button data-a="g-set" data-sid="${esc(s.sid)}" data-v="${v}" class="${g === v ? 'on' : ''}">${v}</button>`).join('')}</div>`
        : `<div class="row"><input class="in g-num" type="number" min="0" max="${q.pts}" step="0.5" value="${typeof g === 'number' ? g : ''}" data-sid="${esc(s.sid)}" style="width:120px;font-size:16px;padding:8px"><span class="sm">/ ${q.pts}점 — 입력하고 칸 밖을 누르면 저장</span></div>`}</div>`;
    }).join('') || '<div class="panel"><div class="sm">아직 이 문항에 답한 학생이 없어요.</div></div>'}`;
  document.querySelectorAll('.g-num').forEach(inp => inp.addEventListener('change', () => { if (inp.value !== '') grade(inp.dataset.sid, +inp.value); }));
}
async function grade(sid, v) {
  const q = P.pages.find(x => x.id === P.gq); v = Math.max(0, Math.min(q.pts, v));
  (P.essay[sid] = P.essay[sid] || {})[q.id] = v;
  document.querySelectorAll(`.panel[data-sid="${CSS.escape(sid)}"] .scores button`).forEach(b => b.classList.toggle('on', +b.dataset.v === v));
  try { await be.set(`essay/${P.id}/${sid}/${q.id}`, v); } catch (e) { toast('점수를 저장하지 못했어요. ' + errText(e)); }
}
on('g-set', el => grade(el.dataset.sid, +el.dataset.v));
on('g-q', el => { P.gq = el.dataset.id; tabGrade(); });
on('g-blind', () => { P.blind = !P.blind; tabGrade(); });
on('g-refresh', () => tabGrade());

/* ================= 결과 ================= */
function resultRows() {
  const ppl = people(), { sheet, key } = exam(), sids = new Set([...Object.keys(ppl), ...Object.keys(P.answers)]);
  const rows = [...sids].map(sid => {
    const r = ppl[sid] || { name: '(이름 없음)', cls: '' }, a = P.answers[sid], sc = C.scoreStudent(sheet, key, a && a.a, P.essay[sid]);
    return { sid, name: r.name, cls: r.cls, took: !!(a && a.startedAt), a, lv: C.leaveSummary(a && a.ev), ...sc };
  });
  return { sheet, key, rows };
}
function tabResult() {
  const m = meta(), { sheet, key, rows } = resultRows();
  const took = rows.filter(r => r.took && (!P.cls || r.cls === P.cls)), absent = rows.filter(r => !r.took && (!P.cls || r.cls === P.cls));
  const rk = C.ranked(took), tot = took.map(r => r.total), avg = tot.length ? tot.reduce((a, b) => a + b, 0) / tot.length : 0;
  const pend = took.reduce((n, r) => n + r.essayPending, 0), max = sheet.reduce((n, q) => n + q.pts, 0);
  const stats = C.questionStats(sheet, key, took.map(r => ({ answers: (r.a && r.a.a) || {}, essay: P.essay[r.sid] || {} })));
  const sub = [['rank', '순위'], ['q', '문항별 정답률'], ['miss', '많이 틀린 문제'], ['leave', '이탈 기록']];
  let body = '';
  if (P.rtab === 'rank') body = `<div class="tw"><table><tr><th class="num">순위</th><th>반</th><th>학번</th><th>이름</th><th class="num">총점</th><th class="num">사지선다</th><th class="num">서술형</th><th class="num">이탈</th><th>제출</th></tr>
    ${rk.map(r => `<tr><td class="num"><b>${r.rank}</b></td><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="num"><b>${r.total}</b></td><td class="num">${r.mc}</td><td class="num">${r.essay}${r.essayPending ? ' <span class="pill mid">채점 전</span>' : ''}</td><td class="num">${r.lv.count ? `<button class="mini red" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.count}회</button>` : ''}</td><td>${r.a.submittedAt ? hhmmss(r.a.submittedAt) : '<span class="pill">미제출</span>'}</td></tr>`).join('')}
    ${absent.map(r => `<tr><td class="num">—</td><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td colspan="5"><span class="pill no">미응시</span></td></tr>`).join('')}</table></div>`;
  else if (P.rtab === 'q') body = `<div class="tw"><table><tr><th class="num">번호</th><th>문제</th><th>난이도</th><th class="num">정답률</th><th></th><th>가장 많이 고른 오답</th></tr>
    ${stats.map(s => `<tr><td class="num">${s.no}</td><td>${esc(s.q.slice(0, 40))}${s.q.length > 40 ? '…' : ''}</td><td>${esc(s.level || '')}</td><td class="num">${s.choice ? Math.round(s.rate * 100) + '%' : `평균 ${s.avg.toFixed(1)} / ${s.pts}`}</td><td><div class="meter"><i class="${s.rate < .4 ? 'low' : ''}" style="width:${Math.round(s.rate * 100)}%"></i></div></td><td>${s.choice ? (s.topWrong >= 0 ? `${esc(s.topWrongText)} (${s.picks[s.topWrong]}명)` : '—') + (s.blank ? ` · 안 풂 ${s.blank}명` : '') : `채점 ${s.graded}명`}</td></tr>`).join('')}</table></div>`;
  else if (P.rtab === 'miss') body = C.mostMissed(stats, 5).map(s => `<div class="box ${s.rate < .4 ? 'no' : 'warn'}"><b>${s.no}번 · ${s.choice ? `정답률 ${Math.round(s.rate * 100)}%` : `평균 ${s.avg.toFixed(1)} / ${s.pts}점`} · 난이도 ${esc(s.level || '')}</b>\n${esc(s.q)}${s.choice ? `\n정답: ${esc(s.answerText)}${s.topWrong >= 0 ? `\n가장 많이 고른 오답: ${esc(s.topWrongText)} (${s.picks[s.topWrong]}명)` : ''}` : ''}</div>`).join('') || '<div class="sm">아직 응시한 학생이 없어요.</div>';
  else body = `<div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th class="num">횟수</th><th>시각</th></tr>
    ${took.filter(r => r.lv.count).sort((a, b) => b.lv.count - a.lv.count).map(r => `<tr><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="num">${r.lv.count}</td><td>${r.lv.list.filter(e => e.t !== 'back').map(e => hhmmss(e.at) + (e.t === 'unpin' ? '(고정 풀림)' : '')).join(', ')}</td></tr>`).join('') || '<tr><td colspan="5">이탈 기록이 없습니다.</td></tr>'}</table></div>`;
  $('pmain').innerHTML = `
    <div class="kpis"><div class="kpi"><b>${took.length}</b><span>응시</span></div><div class="kpi"><b>${avg.toFixed(1)}</b><span>평균 / ${max}점</span></div><div class="kpi"><b>${tot.length ? Math.max(...tot) : 0}</b><span>최고</span></div><div class="kpi"><b>${tot.length ? Math.min(...tot) : 0}</b><span>최저</span></div><div class="kpi"><b>${pend}</b><span>서술형 채점 전</span></div></div>
    <div class="panel"><div class="row">${m.status === 'ended' ? `<button class="btn s ${m.released ? 'gh' : 'am'}" data-a="ex-release">${m.released ? '결과 공개 취소' : '결과 공개'}</button>` : '<span class="sm">시험이 끝나면 결과를 공개할 수 있습니다.</span>'}<button class="btn s gh" data-a="csv">엑셀(CSV) 내보내기</button><span style="margin-left:auto">${clsFilter()}</span></div>
      <div class="tabs">${sub.map(([k, n]) => `<button data-a="r-tab" data-t="${k}" class="${P.rtab === k ? 'on' : ''}">${n}</button>`).join('')}</div>${body}</div>`;
}
on('r-tab', el => { P.rtab = el.dataset.t; tabResult(); });
on('csv', () => {
  const { sheet, rows } = resultRows(), m = meta();
  const took = C.ranked(rows.filter(r => r.took)), absent = rows.filter(r => !r.took).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
  const head = ['순위', '반', '학번', '이름', '총점', '만점', '사지선다', '서술형', '답한 문항', '이탈 횟수', '이탈 시각', '시작', '제출', ...sheet.map((q, i) => `${i + 1}번(${q.pts}점)`)];
  const line = r => [r.rank || '', r.cls, r.sid, r.name, r.took ? r.total : '미응시', r.max, r.took ? r.mc : '', r.took ? r.essay : '', r.took ? r.answered : '', r.lv.count || '', r.lv.list.filter(e => e.t !== 'back').map(e => hhmmss(e.at)).join(' '), r.took ? hhmmss(r.a.startedAt) : '', r.took && r.a.submittedAt ? hhmmss(r.a.submittedAt) : '', ...sheet.map(q => (r.took ? (r.per[q.id].graded === false ? '채점 전' : r.per[q.id].pts) : ''))];
  download(`${(m.title || '시험').replace(/[\\/:*?"<>|]/g, '_')}_결과.csv`, C.toCSV([head, ...took.map(line), ...absent.map(line)]));
});
