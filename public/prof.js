// 푸른시험 — 교수 화면 (시험 목록 · 학생과 반 · 진행 · 문항 편집 · 채점 · 결과)
import * as C from './core.js';
import { S, be, parse } from './state.js';
import { $, esc, on, toast, modal, closeModal, confirmBox, zoom, CIRCLED, errText, hhmmss, download, copyText, shrinkImage } from './ui.js';

const app = $('app');
let bind = {}, users = {}, P = null, clockT = 0, liveT = 0, baseSubs = [];
const LS = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const ST = { draft: ['', '준비 중'], open: ['mid', '대기실 열림'], running: ['ok', '진행 중'], ended: ['', '종료'] };
const pill = m => { const s = ST[m.status] || ST.draft; return `<span class="pill ${s[0]}">${s[1]}</span>${m.released ? ' <span class="pill blue">결과 공개</span>' : ''}${m.practice ? ' <span class="pill blue">문제풀이 공개</span>' : ''}`; };
const meta = () => S.exams[P.id] || {};
// 학생 목록 = 반·학번·이름을 입력하고 입장한 학생
const people = () => { const m = {}; for (const u of Object.values(users)) if (u && u.sid) m[u.sid] = { name: u.name, cls: u.cls }; return m; };
const students = () => Object.entries(people()).map(([sid, r]) => ({ sid, ...r })).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
const allClasses = () => [...new Set([...S.classes, ...students().map(x => x.cls)])].filter(Boolean);

export function start() {
  baseSubs.forEach(u => u()); baseSubs = [
    be.on('bind', v => { bind = v || {}; live(); }),
    be.on('users', v => { users = v || {}; live(); if (!P && $('listMain')) viewList(); }),
  ];
  // 예전 방식의 명단이 남아 있으면 학생 입장을 막으므로 지웁니다 (지금은 학생이 직접 입력하고 입장)
  be.get('roster').then(v => { if (v) be.remove('roster').catch(() => {}); }).catch(() => {});
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
  const list = Object.entries(S.exams).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  app.innerHTML = `<div class="desk"><header><h1>푸른시험</h1><button data-a="people">학생 · 반 (${students().length}명)</button><button data-a="logout">로그아웃</button></header>
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

/* ================= 학생과 반 ================= */
on('people', () => {
  modal(`<h2>학생 · 반</h2>
    <div class="panel" style="padding:14px;box-shadow:none"><h2>반</h2><div class="sm">학생이 입장할 때 고르는 반입니다. 이름은 자유롭게 정할 수 있고(예: 1학년 A반, C반), 하나만 두면 학생은 반을 고르지 않습니다.</div>
      <div id="clsBox"></div>
      <div class="row"><input class="in" id="c-new" placeholder="새 반 이름" maxlength="20" style="flex:1;min-width:140px;font-size:16px;padding:9px 11px"><button class="btn s" data-a="c-add">반 추가</button></div></div>
    <div class="panel" style="padding:14px;box-shadow:none"><h2>입장한 학생</h2><div class="sm">학생이 반·학번·이름을 직접 입력하고 들어옵니다. 한 학번은 처음 입장한 기기 하나만 쓸 수 있습니다. 휴대폰을 바꿨거나 학번을 잘못 입력한 학생은 <b>입장 취소</b>를 누르면 다시 입장할 수 있습니다. 답안은 그대로 남습니다.</div>
      <div id="peopleBox"></div></div>
    <button class="btn gh" data-a="modal-close">닫기</button>`, { wide: true });
  paintPeople(); paintClasses();
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
    ${st.map(s => `<tr><td>${esc(s.cls)}</td><td>${esc(s.sid)}</td><td>${esc(s.name)}</td><td style="text-align:right"><button class="mini" data-a="unbind" data-sid="${esc(s.sid)}">입장 취소</button></td></tr>`).join('')}
    </table></div>`;
}
on('unbind', async el => {
  const sid = el.dataset.sid, uid = bind[sid], r = people()[sid] || {};
  const again = !!$('peopleBox');
  if (!(await confirmBox('입장을 취소할까요?', `${esc(r.name || sid)} 학생이 다시(다른 기기에서도) 입장할 수 있게 됩니다. 저장된 답안은 그대로 남습니다.`, '입장 취소'))) return;
  const u = { ['bind/' + sid]: null };
  for (const [k, v] of Object.entries(users)) if ((v && v.sid === sid) || k === uid) u['users/' + k] = null;
  await be.update('', u); toast('취소했어요. 학생이 다시 입장하면 됩니다.');
  if (again) document.querySelector('[data-a=people]')?.click(); else if (P) renderTab();
});

/* ================= 시험 하나 열기 ================= */
async function openExam(id, tab = 'run') {
  closeExam();
  P = { id, tab, pages: [], imgs: {}, answers: {}, essay: {}, sel: new Set(), cls: '', rtab: 'rank', gq: '', blind: true, unsubs: [], sheetOpts: {} };
  const [draft, imgs] = await Promise.all([be.get('drafts/' + id), be.get('images/' + id)]);
  if (!P || P.id !== id) return;
  P.pages = parse(draft, []).map(C.normalizePage); P.imgs = imgs || {};
  P.unsubs.push(be.on('answers/' + id, v => { P.answers = v || {}; live(); }));
  P.unsubs.push(be.on('essay/' + id, v => { P.essay = v || {}; live(); }));
  app.innerHTML = `<div class="desk"><header id="phead"></header><main><div class="tabs" id="ptabs"></div><div id="pmain" style="display:flex;flex-direction:column;gap:14px"></div></main></div>`;
  paintHead(); renderTab();
  clockT = setInterval(paintClock, 1000);
}
function closeExam() { clearInterval(clockT); clearTimeout(liveT); hideCtx(); if (P) P.unsubs.forEach(u => u()); P = null; }
on('p-open', el => openExam(el.dataset.id));
on('p-back', () => { closeExam(); viewList(); });
function paintHead() {
  if (!P || !$('phead')) return;
  const m = meta();
  $('phead').innerHTML = `<button data-a="p-back">← 목록</button><h1>${esc(m.title || '')}</h1><span>${pill(m)}</span>`;
  $('ptabs').innerHTML = [['run', '진행'], ['edit', '문항'], ['grade', '채점'], ['result', '결과']].map(([k, n]) => `<button data-a="p-tab" data-t="${k}" class="${P.tab === k ? 'on' : ''}">${n}</button>`).join('');
}
on('p-tab', el => { P.tab = el.dataset.t; hideCtx(); paintHead(); renderTab(); });
function renderTab() { if (!P) return; ({ run: tabRun, edit: tabEdit, grade: tabGrade, result: tabResult })[P.tab](); paintClock(); }
function paintClock() {
  const el = $('pclock'); if (!el || !P) return; const m = meta();
  el.textContent = m.status === 'running' ? C.fmtClock(m.endAt - be.now()) : '--:--';
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
    return `<div class="qchart"><h4>${s.no}. ${esc(s.q.length > 60 ? s.q.slice(0, 60) + '…' : s.q)} <span class="pill ${s.k === 'long' ? '' : s.rate < .4 ? 'no' : s.rate < .7 ? 'mid' : 'ok'}">${s.k === 'long' ? C.KIND_NAME.long : `정답률 ${Math.round(s.rate * 100)}%`}</span><span class="pill">${C.KIND_NAME[s.k]} · 난이도 ${esc(s.level || '')}</span></h4>${rows}</div>`;
  }).join('');
}

/* ================= 진행 ================= */
function tabRun() {
  const m = meta(), v = C.validateBundle(P.pages), { sheet, key } = exam(), ppl = people();
  const sids = [...new Set([...Object.keys(ppl), ...Object.keys(P.answers)])];
  const rows = sids.map(sid => {
    const r = ppl[sid] || { name: '(입장 취소됨)', cls: '' }, a = P.answers[sid], lv = C.leaveSummary(a && a.ev);
    return { sid, ...r, a, lv, cnt: a && a.a ? Object.values(a.a).filter(x => x !== '' && x != null).length : 0 };
  }).filter(r => !P.cls || r.cls === P.cls).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
  const sub = rows.filter(r => r.a && r.a.submittedAt), go = rows.filter(r => r.a && r.a.startedAt && !r.a.submittedAt), wait = rows.filter(r => !(r.a && r.a.startedAt));
  const btns = {
    draft: `<button class="btn s am" data-a="ex-status" data-s="open">학생에게 열기 (대기실)</button>`,
    open: `<button class="btn s am" data-a="ex-start">시험 시작 (모든 반 함께)</button><button class="btn s gh" data-a="ex-status" data-s="draft">대기실 닫기</button>`,
    running: `<button class="btn s gh" data-a="ex-extend">시간 5분 연장</button><button class="btn s red" data-a="ex-end">시험 종료 (모든 반 함께)</button>`,
    ended: `<button class="btn s ${m.released ? 'gh' : 'am'}" data-a="ex-release">${m.released ? '결과 공개 취소' : '결과 공개'}</button>${m.released ? '' : '<button class="btn s gh" data-a="ex-resume">다시 열기 (못 본 학생 응시)</button>'}`,
  }[m.status || 'draft'];
  const guide = { draft: '문항을 준비한 뒤 대기실을 여세요. 학생은 대기실에서 안내를 읽고 기다립니다.', open: '학생들이 입장해 기다리고 있습니다. 시작을 누르면 모든 반이 동시에 시작합니다.', running: `${hhmmss(m.startAt)} 시작 · ${hhmmss(m.endAt)} 종료 예정. 시간이 되면 자동으로 제출됩니다.`, ended: '시험이 끝났습니다. 장문형을 채점한 뒤 결과를 공개하세요.' }[m.status || 'draft'];
  const scores = rows.filter(r => r.a && r.a.startedAt).map(r => C.scoreStudent(sheet, key, r.a.a, P.essay[r.sid]).total);
  $('pmain').innerHTML = `
    <div class="panel"><div class="row"><h2 style="margin-right:auto">${ST[m.status || 'draft'][1]}</h2><span class="pill blue" style="font-size:20px;padding:2px 14px" id="pclock">--:--</span></div>
      <div class="sm">${esc(guide)}</div>
      ${v.errors.length ? `<div class="box no">문항에 고칠 곳이 ${v.errors.length}군데 있어요. <b>문항</b> 탭에서 확인해 주세요.</div>` : ''}
      <div class="row">${btns}<button class="btn s gh" data-a="ex-settings">시험 설정</button><button class="btn s gh" data-a="ex-copy">시험 복사 (재시험용)</button></div>
      ${m.status === 'ended' && m.released ? '<div class="sm">결과를 공개한 상태에서는 정답이 보이므로 다시 열 수 없습니다. 다시 열려면 먼저 "결과 공개 취소"를 누르거나, "시험 복사"로 새 시험을 만드세요.</div>' : ''}</div>
    <div class="charts">
      <div class="panel"><h2>응시 현황</h2>${donut([{ label: '제출', n: sub.length, c: COL.sub }, { label: '응시 중', n: go.length, c: COL.go }, { label: '입장만 함', n: wait.length, c: COL.in }], `${sub.length}/${rows.length}`)}</div>
      <div class="panel"><h2>지금까지의 점수 분포</h2>${histChart(scores, sheet.reduce((n, q) => n + q.pts, 0))}<div class="sm">자동 채점 기준이며 학생에게는 보이지 않습니다.</div></div>
    </div>
    <div class="panel"><div class="row"><h2 style="margin-right:auto">학생별 현황</h2>${clsFilter()}</div>
      <div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th>상태</th><th class="num">답한 문항</th><th class="num">이탈</th><th></th></tr>
      ${rows.map(r => `<tr><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td>
        <td>${r.a && r.a.submittedAt ? `<span class="pill ok">제출 ${hhmmss(r.a.submittedAt)}</span>` : r.a && r.a.startedAt ? '<span class="pill blue">응시 중</span>' : '<span class="pill mid">입장</span>'}${r.a && r.a.dev ? ` <span class="pill">${r.a.dev.startsWith('app') ? '앱' : '웹'}</span>` : ''}</td>
        <td class="num">${r.a ? `${r.cnt} / ${sheet.length}` : ''}</td>
        <td class="num">${r.lv.count ? `<button class="mini red" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.count}회</button>` : ''}</td>
        <td style="white-space:nowrap;text-align:right">${bind[r.sid] ? `<button class="mini" data-a="unbind" data-sid="${esc(r.sid)}">입장 취소</button> ` : ''}${r.a && r.a.submittedAt && m.status === 'running' ? `<button class="mini" data-a="unsubmit" data-sid="${esc(r.sid)}">제출 취소</button>` : ''}</td></tr>`).join('')}
      </table></div>${rows.length ? '' : '<div class="sm">아직 입장한 학생이 없어요. 학생이 반·학번·이름을 입력하고 들어오면 여기에 나타납니다.</div>'}</div>`;
}
const setMeta = patch => be.update('exams/' + P.id, patch);
on('ex-status', async el => {
  if (el.dataset.s === 'open' && C.validateBundle(P.pages).errors.length) return toast('문항에 고칠 곳이 있어요. 문항 탭에서 먼저 고쳐 주세요.');
  await setMeta({ status: el.dataset.s });
});
on('ex-start', async () => {
  const m = meta();
  if (C.validateBundle(P.pages).errors.length) return toast('문항에 고칠 곳이 있어요.');
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
    if (!(await confirmBox('결과를 공개할까요?', `학생이 자기 점수, 틀린 문항, 해설을 볼 수 있게 됩니다.${pend ? `\n\n<b>아직 채점하지 않은 장문형 답이 ${pend}개</b> 있습니다.` : ''}`, '공개'))) return;
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
    <div class="sm">켜면 입장한 학생이 이 문항을 순서대로 풀며 정답과 해설을 바로 봅니다. 실제 시험 문항에는 켜지 마세요.</div>
    <button class="check ${m.appOnly ? 'on' : ''}" data-a="s-practice" id="s-app"><i>✓</i>안드로이드는 앱으로만 응시</button>
    <div class="sm">켜면 안드로이드 휴대폰의 인터넷 창(크롬 등)으로는 시작할 수 없고, 앱 내려받기 안내가 나옵니다. 아이폰은 그대로 웹으로 봅니다.</div>
    <button class="btn" data-a="s-save">저장</button>
    <hr style="border:0;border-top:1px solid var(--line)">
    <button class="btn gh" data-a="ex-wipe">답안 모두 지우기 (모의시험 뒤 초기화)</button>
    <button class="btn gh" style="color:var(--red)" data-a="ex-delete">이 시험 삭제</button>
    <button class="btn gh" data-a="modal-close">닫기</button>`);
});
on('s-practice', el => el.classList.toggle('on'));
on('s-save', async () => {
  const title = $('s-title').value.trim(), minutes = Math.round(+$('s-min').value), practice = $('s-prac').classList.contains('on'), appOnly = $('s-app').classList.contains('on');
  if (!title || !(minutes >= 1 && minutes <= 300)) return toast('이름과 시간을 확인해 주세요.');
  if (practice && !meta().practice && meta().status !== 'draft' && !(await confirmBox('시험 문항을 문제풀이로 공개할까요?', '학생이 정답과 해설을 모두 볼 수 있게 됩니다.', '공개', { danger: true }))) return;
  await setMeta({ title, minutes, practice, appOnly }); closeModal(); toast('저장했어요.');
});
on('ex-wipe', async () => {
  if (!(await confirmBox('답안을 모두 지울까요?', '이 시험의 모든 학생 답안, 이탈 기록, 장문형 점수가 지워지고 시험이 "준비 중"으로 돌아갑니다. <b>되돌릴 수 없습니다.</b>', '모두 지우기', { danger: true }))) return;
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
      <div class="row"><button class="btn s" data-a="ed-paste">문항 묶음 붙여 넣기</button><button class="btn s gh" data-a="ed-replace">고른 문항만 교체 붙여 넣기</button><button class="btn s gh" data-a="ed-add">빈 문항 추가</button><button class="btn s gh" data-a="ed-del">고른 문항 지우기</button></div>
      ${v.errors.length ? `<div class="box no"><b>고칠 곳 ${v.errors.length}군데</b> — 빨간 문항을 확인하세요. 고치기 전에는 시험을 열 수 없습니다.${v.errors.filter(e => e.i < 0).map(e => '\n' + esc(e.msg)).join('')}</div>` : s.n ? '<div class="box ok">문항 검사를 통과했습니다.</div>' : ''}
      ${P.pages.length > 1 ? '<div class="sm">왼쪽 ⠿ 를 끌어서 순서를 바꿉니다. 문항에서 마우스 오른쪽 버튼을 누르면 고치기·복제·지우기 메뉴가 나옵니다.</div>' : ''}
    </div>
    <div id="qlist" style="display:flex;flex-direction:column;gap:8px">
    ${P.pages.map((p, i) => {
      const q = C.isQuestion(p), er = errAt(i), wr = warnAt(i);
      const sub = q ? `${p.t === 'image' || p.t === 'video' ? C.TYPE_NAME[p.t] + ' · ' : ''}${C.KIND_NAME[C.kindOf(p)]} · 난이도 ${esc(p.level)} · ${p.pts}점${answerLabel(p)}${p.img ? ' · 사진' : ''}${p.video ? ' · 영상' : ''}` : esc(p.body || '');
      return `<div class="qrow ${er.length ? 'err' : ''}" data-i="${i}"><span class="grip" data-grip="${i}" title="끌어서 순서 바꾸기" aria-hidden="true">⠿</span><input type="checkbox" data-i="${i}" class="ed-sel" ${P.sel.has(i) ? 'checked' : ''} aria-label="고르기">
        <div class="t"><b>${q ? `${++no}. ` : `[${C.TYPE_NAME[p.t] || '알 수 없음'}] `}${esc(q ? p.q : p.title) || '(비어 있음)'}</b><span>${sub}</span>
        ${er.map(e => `<div style="color:var(--red);font-size:13px;font-weight:700">⚠ ${esc(e)}</div>`).join('')}${wr.map(e => `<div style="color:var(--amber);font-size:13px">· ${esc(e)}</div>`).join('')}</div>
        <button class="mini" data-a="ed-edit" data-i="${i}">고치기</button><button class="mini red" data-a="ed-rm" data-i="${i}">지우기</button></div>`;
    }).join('') || '<div class="panel"><div class="sm">아직 문항이 없어요. <b>① 문제 만들기</b>로 부탁문을 복사해 AI에게 주고, 받은 JSON을 <b>문항 묶음 붙여 넣기</b>로 넣으세요.</div></div>'}
    </div>`;
  document.querySelectorAll('.ed-sel').forEach(c => c.addEventListener('change', () => { c.checked ? P.sel.add(+c.dataset.i) : P.sel.delete(+c.dataset.i); }));
}
const selected = () => [...P.sel].filter(i => i < P.pages.length).sort((a, b) => a - b);
// 지운 직후에는 되돌릴 수 있게 합니다
async function removePages(idx) {
  const before = P.pages.slice(), id = P.id;
  P.sel.clear(); await savePages(P.pages.filter((_, i) => !idx.includes(i))); tabEdit();
  toast(`${idx.length}쪽을 지웠어요.`, 7000, { label: '되돌리기', fn: async () => { if (!P || P.id !== id) return; await savePages(before); if (P.tab === 'edit') tabEdit(); toast('되돌렸어요.'); } });
}
on('ed-rm', el => removePages([+el.dataset.i]));
on('ed-del', () => { const sel = selected(); if (!sel.length) return toast('지울 문항을 먼저 골라 주세요(왼쪽 네모).'); return removePages(sel); });
on('ed-add', async () => {
  const end = P.pages.findIndex(p => p.t === 'end'), a = P.pages.slice();
  const blank = C.normalizePage({ t: 'choice', q: '', opts: ['', '', '', ''], a: 0, why: '', level: '중', pts: 4 });
  const at = end < 0 ? a.length : end; a.splice(at, 0, blank);
  await savePages(a); tabEdit(); editPage(at);
});
async function movePage(from, to) {   // to: 옮긴 뒤의 자리
  if (from === to || from < 0 || to < 0) return;
  const a = P.pages.slice(), [x] = a.splice(from, 1); a.splice(to, 0, x);
  P.sel.clear(); await savePages(a); tabEdit();
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
  c.innerHTML = `<button data-a="ed-edit" data-i="${i}">고치기</button><button data-a="ed-dup" data-i="${i}">복제</button><button class="red" data-a="ed-rm" data-i="${i}">지우기</button>`;
  c.hidden = false;
  c.style.left = Math.min(e.clientX, innerWidth - c.offsetWidth - 8) + 'px'; c.style.top = Math.min(e.clientY, innerHeight - c.offsetHeight - 8) + 'px';
});
document.addEventListener('click', hideCtx); document.addEventListener('scroll', hideCtx, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
on('ed-dup', async el => {
  const i = +el.dataset.i, a = P.pages.slice(), { id, ...copy } = a[i];
  a.splice(i + 1, 0, JSON.parse(JSON.stringify(copy)));
  P.sel.clear(); await savePages(a); tabEdit(); toast('복제했어요.');
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
  await savePages(a); closeModal(); tabEdit();
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
    const { sheet, key } = exam(), took = Object.values(P.answers).filter(a => a.startedAt);
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
  $('pmain').innerHTML = `
    <div class="panel">${tabs}
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
// 단답형: 학생이 쓴 답을 정답으로 인정하거나 취소 → 정답지가 바뀌어 모두 다시 채점됩니다
async function setAccepted(text, accept) {
  const i = P.pages.findIndex(x => x.id === P.gq), p = P.pages[i], n = C.normAns(text);
  const answers = accept ? [...(p.answers || []), text] : (p.answers || []).filter(x => C.normAns(x) !== n);
  if (!answers.length) return toast('정답이 하나는 있어야 해요.');
  const a = P.pages.slice(); a[i] = C.normalizePage({ ...p, answers });
  await savePages(a); tabGrade(); toast(accept ? `"${text}" 을(를) 정답으로 인정했어요.` : '인정을 취소했어요.');
}
on('g-accept', el => setAccepted(el.dataset.t, true));
on('g-reject', el => setAccepted(el.dataset.t, false));

/* ================= 결과 ================= */
function resultRows() {
  const ppl = people(), { sheet, key } = exam(), sids = new Set([...Object.keys(ppl), ...Object.keys(P.answers)]);
  const rows = [...sids].map(sid => {
    const r = ppl[sid] || { name: '(입장 취소됨)', cls: '' }, a = P.answers[sid], sc = C.scoreStudent(sheet, key, a && a.a, P.essay[sid]);
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
  P.sheetOpts = Object.fromEntries(sheet.map(q => [q.id, q.opts || []]));
  const sub = [['rank', '순위'], ['chart', '그래프'], ['miss', '많이 틀린 문제'], ['leave', '이탈 기록']];
  let body = '';
  if (P.rtab === 'rank') body = `<div class="tw"><table><tr><th class="num">순위</th><th>반</th><th>학번</th><th>이름</th><th class="num">총점</th><th class="num">자동 채점</th><th class="num">장문형</th><th class="num">이탈</th><th>제출</th></tr>
    ${rk.map(r => `<tr><td class="num"><b>${r.rank}</b></td><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="num"><b>${r.total}</b></td><td class="num">${r.mc}</td><td class="num">${r.essay}${r.essayPending ? ' <span class="pill mid">채점 전</span>' : ''}</td><td class="num">${r.lv.count ? `<button class="mini red" data-a="lv-show" data-sid="${esc(r.sid)}">${r.lv.count}회</button>` : ''}</td><td>${r.a.submittedAt ? hhmmss(r.a.submittedAt) : '<span class="pill">미제출</span>'}</td></tr>`).join('')}
    ${absent.map(r => `<tr><td class="num">—</td><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td colspan="5"><span class="pill no">미응시</span></td></tr>`).join('')}</table></div>${rk.length || absent.length ? '' : '<div class="sm">아직 응시한 학생이 없어요.</div>'}`;
  else if (P.rtab === 'chart') body = `<h2>점수 분포</h2>${histChart(tot, max)}<h2 style="margin-top:8px">문항별 응답</h2><div class="sm">초록 막대(✓)가 정답, 분홍 막대는 가장 많이 고른 오답입니다.</div>${questionCharts(stats)}`;
  else if (P.rtab === 'miss') body = C.mostMissed(stats, 5).map(s => `<div class="box ${s.rate < .4 ? 'no' : 'warn'}"><b>${s.no}번 · ${s.auto ? `정답률 ${Math.round(s.rate * 100)}%` : `평균 ${s.avg.toFixed(1)} / ${s.pts}점`} · 난이도 ${esc(s.level || '')}</b>\n${esc(s.q)}${s.auto ? `\n정답: ${esc(s.answerText)}${s.topWrongText ? `\n가장 많이 고른 오답: ${esc(s.topWrongText)} (${s.choice ? s.picks[s.topWrong] : s.topWrongN}명)` : ''}` : ''}</div>`).join('') || '<div class="sm">아직 응시한 학생이 없어요.</div>';
  else body = `<div class="tw"><table><tr><th>반</th><th>학번</th><th>이름</th><th class="num">횟수</th><th>시각</th></tr>
    ${took.filter(r => r.lv.count).sort((a, b) => b.lv.count - a.lv.count).map(r => `<tr><td>${esc(r.cls)}</td><td>${esc(r.sid)}</td><td>${esc(r.name)}</td><td class="num">${r.lv.count}</td><td>${r.lv.list.filter(e => e.t !== 'back').map(e => hhmmss(e.at) + (e.t === 'unpin' ? '(고정 풀림)' : '')).join(', ')}</td></tr>`).join('') || '<tr><td colspan="5">이탈 기록이 없습니다.</td></tr>'}</table></div>`;
  $('pmain').innerHTML = `
    <div class="kpis"><div class="kpi"><b>${took.length}</b><span>응시</span></div><div class="kpi"><b>${avg.toFixed(1)}</b><span>평균 / ${max}점</span></div><div class="kpi"><b>${tot.length ? Math.max(...tot) : 0} · ${tot.length ? Math.min(...tot) : 0}</b><span>최고 · 최저</span></div><div class="kpi"><b>${pend}</b><span>장문형 채점 전</span></div></div>
    <div class="panel"><div class="row">${m.status === 'ended' ? `<button class="btn s ${m.released ? 'gh' : 'am'}" data-a="ex-release">${m.released ? '결과 공개 취소' : '결과 공개'}</button>` : '<span class="sm">시험이 끝나면 결과를 공개할 수 있습니다.</span>'}<button class="btn s gh" data-a="csv">엑셀(CSV) 내보내기</button><span style="margin-left:auto">${clsFilter()}</span></div>
      <div class="tabs">${sub.map(([k, n]) => `<button data-a="r-tab" data-t="${k}" class="${P.rtab === k ? 'on' : ''}">${n}</button>`).join('')}</div>${body}</div>`;
}
on('r-tab', el => { P.rtab = el.dataset.t; tabResult(); });
on('csv', () => {
  const { sheet, rows } = resultRows(), m = meta();
  const took = C.ranked(rows.filter(r => r.took)), absent = rows.filter(r => !r.took).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.sid.localeCompare(b.sid));
  const head = ['순위', '반', '학번', '이름', '총점', '만점', '자동 채점', '장문형', '답한 문항', '이탈 횟수', '이탈 시각', '시작', '제출', ...sheet.map((q, i) => `${i + 1}번(${q.pts}점)`)];
  const line = r => [r.rank || '', r.cls, r.sid, r.name, r.took ? r.total : '미응시', r.max, r.took ? r.mc : '', r.took ? r.essay : '', r.took ? r.answered : '', r.lv.count || '', r.lv.list.filter(e => e.t !== 'back').map(e => hhmmss(e.at)).join(' '), r.took ? hhmmss(r.a.startedAt) : '', r.took && r.a.submittedAt ? hhmmss(r.a.submittedAt) : '', ...sheet.map(q => (r.took ? (r.per[q.id].graded === false ? '채점 전' : r.per[q.id].pts) : ''))];
  download(`${(m.title || '시험').replace(/[\\/:*?"<>|]/g, '_')}_결과.csv`, C.toCSV([head, ...took.map(line), ...absent.map(line)]));
});
