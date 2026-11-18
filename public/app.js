// 푸른시험 — 시작점과 학생 화면
import * as C from './core.js';
import { createAnswerStore } from './save.js';
import { S, be, setBackend, APP, parse } from './state.js';
import { $, esc, on, toast, modal, closeModal, confirmBox, zoom, closeZoom, CIRCLED, errText, hhmmss } from './ui.js';

const CONFIG = {
  apiKey: 'AIzaSyBDVS-cdDMhjVpRk8ipoYG79DrTvatKsLQ',
  authDomain: 'pureun-exam.firebaseapp.com',
  databaseURL: 'https://pureun-exam-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pureun-exam',
  storageBucket: 'pureun-exam.firebasestorage.app',
  messagingSenderId: '203422377658',
  appId: '1:203422377658:web:90ddb8b489b038a40bc483',
};
const Q = new URLSearchParams(location.search);
const MOCK = Q.has('mock') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const WANT_PROF = Q.has('prof');
const app = $('app');
const who = () => (S.me ? `${S.me.cls} ${S.me.sid} ${S.me.name}` : '');
const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

// 인터넷이 끊기면 서버 요청이 끝없이 기다리므로, 정해진 시간 뒤에는 실패로 봅니다.
const within = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('network timeout')), ms))]);

/* ================= 시작 · 로그인 ================= */
let unsubExams = null, unsubCls = null, profMod = null;
async function boot() {
  try { setBackend(await (MOCK ? import('./mock.js') : import('./fb.js')).then(m => m.createBackend(CONFIG))); }
  catch (e) { $('bootmsg').textContent = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.'; return; }
  be.onAuth(async u => {
    stopExam(); if (unsubExams) { unsubExams(); unsubExams = null; } if (unsubCls) { unsubCls(); unsubCls = null; }
    S.user = u; S.role = ''; S.me = null;
    try {
      if (!u) { if (WANT_PROF) return viewProfLogin(); await be.signInAnon(); return; }
      unsubCls = be.on('classes', v => { S.classes = C.classList(v); if ($('e-sid')) keepEntry(); if (profMod && S.role === 'prof') profMod.onClasses(); });
      if (u.anon) {
        if (WANT_PROF) return viewProfLogin();
        S.role = 'student';
        S.me = await be.get('users/' + u.uid);
        unsubExams = be.on('exams', v => { S.exams = v || {}; onExams(); });
        if (!S.me) viewEntry();
      } else {
        let ok = (await be.get('admins/' + u.uid)) === true;
        if (!ok) { try { await be.set('admins/' + u.uid, true); ok = true; } catch (e) { ok = false; } } // 맨 처음 로그인한 교수 계정만 등록됨
        if (!ok) { await be.signOut(); return viewProfLogin('이 계정은 교수 계정으로 등록되어 있지 않아요.'); }
        S.role = 'prof';
        profMod = profMod || await import('./prof.js');
        unsubExams = be.on('exams', v => { S.exams = v || {}; profMod.onExams(); });
        profMod.start();
      }
    } catch (e) { console.error(e); app.innerHTML = shell(`<div class="h1">연결 문제</div><div class="txt">${esc(errText(e))}</div><button class="btn am" data-a="reload">다시 시도</button>`, true); }
  });
}
on('reload', () => location.reload());
const shell = (inner, center) => `<div class="phone dark"><div class="body${center ? ' center' : ''}">${inner}</div></div>`;

function viewProfLogin(msg = '') {
  app.innerHTML = shell(`<div class="chip">교수용</div><div class="h1">교수 계정으로 로그인하세요</div>
    ${msg ? `<div class="box no">${esc(msg)}</div>` : ''}
    <button class="btn am" style="flex:none" data-a="glogin">Google 계정으로 로그인</button>
    <a class="link" href="./">학생 화면으로</a>`, true);
}
on('glogin', async () => { try { await be.signInGoogle(); } catch (e) { toast('로그인하지 못했어요. 팝업 차단을 확인해 주세요.'); } });

/* ================= 학생: 입장 ================= */
let entryCls = '';
function viewEntry(err = '') {
  const cs = S.classes;
  if (!cs.includes(entryCls)) entryCls = cs.length === 1 ? cs[0] : '';   // 반이 하나뿐이면 고를 필요 없음
  app.innerHTML = shell(`<div class="chip">푸른시험</div>
    <div class="h1">${cs.length > 1 ? '반을 고르고 학번과 이름을 입력하세요' : '학번과 이름을 입력하세요'}</div>
    ${cs.length > 1 ? `<div class="seg">${cs.map(c => `<button data-a="cls" data-c="${esc(c)}" class="${entryCls === c ? 'on' : ''}" aria-pressed="${entryCls === c}">${esc(c)}</button>`).join('')}</div>` : `<div class="sm" style="font-size:17px;font-weight:700">${esc(cs[0])}</div>`}
    <input class="in" id="e-sid" inputmode="numeric" autocomplete="off" placeholder="학번 (예: 20261234)" maxlength="20">
    <input class="in" id="e-name" autocomplete="off" placeholder="이름" maxlength="20">
    ${err ? `<div class="box no">${esc(err)}</div>` : ''}
    <button class="btn am" style="flex:none" data-a="enter">입장</button>
    <div class="sm">학번과 이름을 정확히 입력하세요. 처음 입장한 이 기기에서만 응시할 수 있습니다.</div>
    <div style="margin-top:auto;text-align:center"><a class="link" href="./?prof=1">교수용</a></div>`, true);
}
// 입력하던 글자를 지우지 않고 화면만 다시 그립니다
function keepEntry(err = '') { const sid = $('e-sid') ? $('e-sid').value : '', nm = $('e-name') ? $('e-name').value : ''; viewEntry(err); $('e-sid').value = sid; $('e-name').value = nm; }
on('cls', el => { entryCls = el.dataset.c; keepEntry(); });
on('enter', async () => {
  const sid = C.normSid($('e-sid').value), name = C.normName($('e-name').value), cls = entryCls;
  const again = m => { viewEntry(m); $('e-sid').value = sid; $('e-name').value = name; };
  if (!cls) return again('반을 먼저 골라 주세요.');
  if (!C.validSid(sid)) return again('학번을 정확히 입력해 주세요.');
  if (!name) return again('이름을 입력해 주세요.');
  try {
    await be.update('', { ['users/' + S.user.uid]: { sid, name, cls, at: be.now() }, ['bind/' + sid]: S.user.uid });
    S.me = { sid, name, cls }; viewHome();
  } catch (e) {
    again(/PERMISSION/i.test(String(e.code || e.message)) ? '입장하지 못했어요. 이 학번으로 이미 다른 기기에서 입장했거나, 반·학번·이름이 명단과 다릅니다. 교수님께 말씀해 주세요.' : errText(e));
  }
});

/* ================= 학생: 시험 목록 ================= */
let view = '';   // 'home' | 'notice' | 'exam' | 'done' | 'review'
function onExams() {
  if (!S.me) return;
  if (view === '' || view === 'home') viewHome();
  else if (view === 'notice') viewNotice();
  else if (view === 'exam') examMetaChanged();
  else if (view === 'done') viewDone();
}
function viewHome() {
  view = 'home';
  const list = Object.entries(S.exams).filter(([, m]) => m && (m.status !== 'draft' || m.practice)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  const card = ([id, m]) => {
    const exam = m.status !== 'draft';
    const st = { open: ['wait', '곧 시작'], running: ['run', '진행 중'], ended: ['end', m.released ? '결과 공개' : '종료'] }[m.status] || ['', '문제풀이'];
    const hint = m.status === 'open' ? '눌러서 대기실에 들어가세요' : m.status === 'running' ? '눌러서 응시하세요' : m.status === 'ended' ? (m.released ? '눌러서 내 점수와 해설을 보세요' : '결과는 교수님이 공개하면 볼 수 있어요') : '';
    return `${exam ? `<button class="card" data-a="open-exam" data-id="${esc(id)}"><span class="st ${st[0]}">${st[1]}</span><h3>${esc(m.title || '시험')}</h3><div class="sm">${m.n || 0}문항 · ${m.minutes || 0}분 · ${hint}</div></button>` : ''}
      ${m.practice ? `<button class="card" data-a="open-practice" data-id="${esc(id)}"><span class="st">문제풀이</span><h3>${esc(m.title || '문제풀이')}</h3><div class="sm">${m.n || 0}문항 · 순서대로 풀고 해설을 바로 확인</div></button>` : ''}`;
  };
  app.innerHTML = `<div class="phone"><div class="bar"><span>푸른시험</span><span class="who">${esc(who())}</span></div>
    <div class="body tint">${list.length ? list.map(card).join('') : '<div class="box info">지금 열려 있는 시험이 없어요. 교수님이 시험을 열면 여기에 나타납니다.</div>'}</div></div>`;
}
on('home', () => { stopExam(); viewHome(); });

/* ================= 학생: 안내 쪽 ================= */
let N = null, noticeT = 0;
on('open-exam', async el => {
  const id = el.dataset.id, m = S.exams[id]; if (!m) return;
  const my = (await be.get(`answers/${id}/${S.me.sid}`)) || {};
  N = { id, checked: false, my };
  if (my.submittedAt) return viewDone();
  if (m.status === 'ended') return m.released ? openReview(id, 'result') : viewDone();
  if (m.status === 'running' && my.startedAt && be.now() < m.endAt) return startExam();
  viewNotice();
});
const dndOn = () => { try { return !APP || !!APP.isDndOn(); } catch (e) { return true; } };
function viewNotice() {
  view = 'notice';
  const m = S.exams[N.id];
  if (!m || m.status === 'draft') return viewHome();
  if (m.status === 'ended') return viewDone();
  const running = m.status === 'running' && be.now() < m.endAt;
  const ready = running && N.checked && dndOn();
  const nt = m.notice || {};
  app.innerHTML = `<div class="phone"><div class="bar"><span>시험 안내</span><span class="who">${esc(who())}</span></div>
    <div class="body">
      <div class="h1">${esc(nt.title || m.title || '시험')}</div>
      ${nt.body ? `<div class="txt">${esc(nt.body)}</div>` : ''}
      <ul class="rules">
        <li>시험 시간은 <b>${m.minutes}분</b>이고, 끝나면 자동으로 제출됩니다.</li>
        <li>문제 순서와 보기 순서는 학생마다 다릅니다.</li>
        <li>시험 화면을 벗어나면 <b>횟수와 시각이 기록</b>됩니다.</li>
        <li>화면 캡처·녹화·복사는 금지입니다.</li>
        <li>답은 고르는 즉시 저장됩니다. 앱이 꺼져도 이어서 풀 수 있습니다.</li>
      </ul>
      ${APP ? `<div class="box ${dndOn() ? 'ok' : 'warn'}">${dndOn() ? '방해 금지 모드가 켜져 있습니다.' : '<b>방해 금지 모드가 꺼져 있습니다.</b> 켜야 시작할 수 있어요.'}</div>` : '<div class="box info">전화와 알림이 시험을 방해하지 않게 <b>방해 금지 모드</b>를 켜 주세요.</div>'}
      <button class="btn gh" style="flex:none" data-a="dnd">방해 금지 모드 켜기</button>
      <button class="check ${N.checked ? 'on' : ''}" data-a="agree" aria-pressed="${N.checked}"><i>✓</i>확인했습니다</button>
      <div class="sm">${running ? '' : '교수님이 시험을 시작하면 아래 버튼이 켜집니다. 이 화면에서 기다려 주세요.'}</div>
    </div>
    <div class="foot"><button class="btn gh" style="flex:0 0 30%" data-a="home">나가기</button><button class="btn am" data-a="start" ${ready ? '' : 'disabled'}>시험 시작</button></div></div>`;
  clearInterval(noticeT);
  if (APP) noticeT = setInterval(() => { if (view !== 'notice') return clearInterval(noticeT); const b = document.querySelector('[data-a=start]'); if (b && b.disabled === (running && N.checked && dndOn())) viewNotice(); }, 1000);
}
on('agree', () => { N.checked = !N.checked; const y = document.querySelector('.body').scrollTop; viewNotice(); document.querySelector('.body').scrollTop = y; });
on('dnd', () => {
  if (APP && APP.openDndSettings) { try { APP.openDndSettings(); return; } catch (e) {} }
  modal(`<h2>방해 금지 모드 켜는 방법</h2>
    <div class="txt"><b>아이폰</b>\n화면 오른쪽 위에서 아래로 쓸어내려 제어 센터를 열고 → 집중 모드 → 방해금지 모드를 누릅니다.\n\n<b>안드로이드</b>\n화면 위에서 아래로 두 번 쓸어내리고 → 방해 금지를 누릅니다.</div>
    <button class="btn" data-a="modal-close">알겠습니다</button>`);
});
on('start', () => startExam());

/* ================= 학생: 시험 보기 ================= */
let X = null;   // 지금 보고 있는 시험
const ansPath = () => `answers/${X.id}/${S.me.sid}`;
async function startExam() {
  const id = N.id, m = S.exams[id];
  try {
    const [sheetRec, imgs, my] = await within(Promise.all([be.get('sheets/' + id), be.get('images/' + id), be.get(`answers/${id}/${S.me.sid}`)]), 15000);
    const sheet = C.fixSheet(parse(sheetRec, []));
    if (!sheet.length) return toast('문제를 불러오지 못했어요.');
    const mine = my || {};
    if (mine.submittedAt) { N.my = mine; return viewDone(); }
    X = {
      id, sheet, byId: Object.fromEntries(sheet.map(q => [q.id, q])), imgs: imgs || {},
      order: C.examOrder(sheet, id, S.me.sid), idx: Math.max(0, +(sessionStorage.getItem('idx:' + id) || 0)),
      sess: Math.random().toString(36).slice(2, 12), leaves: C.leaveSummary(mine.ev).count, away: false, unsubs: [], done: false, typing: 0,
    };
    X.idx = Math.min(X.idx, X.order.length - 1);
    X.store = createAnswerStore({
      key: `ans:${id}:${S.me.sid}`, storage: localStorage,
      send: patch => be.update(ansPath(), Object.fromEntries(Object.entries(patch).map(([k, v]) => ['a/' + k, v]))),
      onStatus: paintSave,
    });
    X.store.load(mine.a || {});
    await within(be.update(ansPath(), { startedAt: mine.startedAt || be.now(), sess: X.sess, dev: (APP ? 'app ' : 'web ') + navigator.userAgent.slice(0, 200) }));
    X.unsubs.push(be.on(ansPath() + '/sess', v => { if (X && !X.done && v && v !== X.sess) otherWindow(); }));
    X.unsubs.push(be.on(ansPath() + '/submittedAt', v => { if (X && !X.done && v) finish(true); }));
    X.unsubs.push(be.onConnected(c => { if (X) { X.conn = c; paintSave(); } }));
    X.tick = setInterval(tick, 500);
    app.classList.add('lock');
    try { if (APP && APP.startLock) APP.startLock(); } catch (e) {}
    view = 'exam'; renderExam(); tick();
  } catch (e) {
    console.error(e); X = null;
    if (/PERMISSION/i.test(String(e.code || e.message))) { toast('지금은 시험을 시작할 수 없어요.'); viewNotice(); } else toast(errText(e));
  }
}
function stopExam() {
  if (!X) return;
  clearInterval(X.tick); X.unsubs.forEach(u => { try { u(); } catch (e) {} });
  app.classList.remove('lock'); $('guard').hidden = true; closeZoom(); closeModal();
  try { if (APP && APP.stopLock) APP.stopLock(); } catch (e) {}
  X = null;
}
function examMetaChanged() { if (X && !X.done) tick(); }
function tick() {
  if (!X || X.done) return;
  const m = S.exams[X.id];
  if (!m || m.status !== 'running') return finish(true);
  const left = m.endAt - be.now();
  const c = $('clock'); if (c) { c.textContent = C.fmtClock(left); c.classList.toggle('low', left < 5 * 60000); }
  if (left <= 0) finish(true);
}
function paintSave() {
  const el = $('save'); if (!el || !X) return;
  const st = X.store.status(), off = X.conn === false || st === 'offline';
  el.className = 'save' + (off ? ' off' : '');
  el.textContent = off ? '연결 끊김 — 답은 이 기기에 저장되어 있고, 연결되면 자동으로 보냅니다' : st === 'saving' ? '저장 중…' : '✓ 저장됨';
}
const imgSrc = (q, imgs) => !q.img ? '' : q.img.startsWith('img:') ? (imgs[q.img.slice(4)] || '') : q.img;
function media(q, imgs) {
  let h = '';
  const src = imgSrc(q, imgs);
  if (src) h += `<div class="pic" data-a="zoom" role="button" aria-label="사진 크게 보기"><img src="${esc(src)}" alt="문제 사진" draggable="false"></div>`;
  if (q.video) {
    const y = C.youtubeId(q.video);
    h += y ? `<div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${y}?playsinline=1&rel=0&modestbranding=1" title="문제 영상" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
      : `<div class="vid"><video src="${esc(q.video)}" controls playsinline controlslist="nodownload"></video></div>`;
  }
  return h;
}
on('zoom', el => zoom(el.querySelector('img').src));
const typeChip = q => `${q.t === 'image' || q.t === 'video' ? C.TYPE_NAME[q.t] + ' · ' : ''}${C.KIND_NAME[q.k] || '문제'} · ${q.pts}점`;

function renderExam() {
  if (!X) return;
  flushTyping();
  const o = X.order[X.idx], q = X.byId[o.id], a = X.store.get(q.id), n = X.order.length;
  sessionStorage.setItem('idx:' + X.id, X.idx);
  let body;
  if (q.k === 'choice') body = o.opt.map((orig, slot) => `<button class="opt ${a === orig ? 'on' : ''}" data-a="pick" data-v="${orig}" aria-pressed="${a === orig}"><span class="n">${slot + 1}</span><span>${esc(q.opts[orig])}</span></button>`).join('');
  else if (q.k === 'check') { const sel = C.unpackChecks(a); body = '<div class="sm">맞는 것을 모두 고르세요.</div>' + o.opt.map((orig, slot) => `<button class="opt sq ${sel.includes(orig) ? 'on' : ''}" data-a="tick" data-v="${orig}" aria-pressed="${sel.includes(orig)}"><span class="n">${sel.includes(orig) ? '✓' : slot + 1}</span><span>${esc(q.opts[orig])}</span></button>`).join(''); }
  else if (q.k === 'dropdown') body = `<select class="in" id="dd" aria-label="답 고르기"><option value="">눌러서 고르세요</option>${o.opt.map(orig => `<option value="${orig}" ${a === orig ? 'selected' : ''}>${esc(q.opts[orig])}</option>`).join('')}</select>`;
  else if (q.k === 'short') body = `<input class="in" id="short" placeholder="답을 짧게 쓰세요" maxlength="100" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${esc(a || '')}">`;
  else body = `<textarea class="in ta" id="essay" placeholder="여기에 답을 쓰세요" maxlength="4000" autocomplete="off" autocorrect="off" spellcheck="false">${esc(a || '')}</textarea><div class="sm" id="count">${(a || '').length}자</div>`;
  app.innerHTML = `<div class="phone"><div class="bar"><span>${X.idx + 1} / ${n}</span><span class="clock" id="clock">--:--</span></div>
    <div class="prog"><i style="width:${(X.idx + 1) / n * 100}%"></i></div>
    <div class="body"><div class="chip">${esc(typeChip(q))}</div><div class="q">${esc(q.q)}</div>${media(q, X.imgs)}${body}<div class="save" id="save" style="margin-top:auto"></div></div>
    <div class="foot"><button class="btn gh" data-a="prev" ${X.idx ? '' : 'disabled'}>이전</button><button class="btn gh" data-a="qlist">문항 목록</button>${X.idx < n - 1 ? '<button class="btn" data-a="next">다음</button>' : '<button class="btn am" data-a="qlist">제출</button>'}</div></div>`;
  paintSave(); tick();
  const ta = $('essay') || $('short');
  if (ta) ta.addEventListener('input', () => {
    if ($('count')) $('count').textContent = ta.value.length + '자';
    clearTimeout(X.typing); X.pendingText = { id: q.id, v: ta.value };
    const sv = $('save'); if (sv && !sv.classList.contains('off')) sv.textContent = '저장 중…';
    X.typing = setTimeout(flushTyping, 800);
  });
  const dd = $('dd');
  if (dd) dd.addEventListener('change', () => X.store.set(q.id, dd.value === '' ? '' : +dd.value));
}
function flushTyping() {
  if (!X || !X.pendingText) return;
  clearTimeout(X.typing); const p = X.pendingText; X.pendingText = null;
  X.store.set(p.id, p.v);
}
on('pick', el => {
  const o = X.order[X.idx], v = +el.dataset.v;
  X.store.set(o.id, v);
  document.querySelectorAll('.opt').forEach(b => { const onb = +b.dataset.v === v; b.classList.toggle('on', onb); b.setAttribute('aria-pressed', onb); });
});
on('tick', el => {
  const o = X.order[X.idx], v = +el.dataset.v, cur = C.unpackChecks(X.store.get(o.id));
  const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
  X.store.set(o.id, C.packChecks(next));
  const onb = next.includes(v); el.classList.toggle('on', onb); el.setAttribute('aria-pressed', onb);
  el.querySelector('.n').textContent = onb ? '✓' : String([...el.parentNode.querySelectorAll('.opt')].indexOf(el) + 1);
});
on('prev', () => { if (X.idx > 0) { X.idx--; renderExam(); } });
on('next', () => { if (X.idx < X.order.length - 1) { X.idx++; renderExam(); } });
const answered = id => { const v = X.store.get(id); return v !== undefined && v !== null && v !== ''; };
on('qlist', () => {
  flushTyping();
  const left = X.order.filter(o => !answered(o.id)).length;
  modal(`<h2>${left ? `안 푼 문항 ${left}개` : '모든 문항에 답했어요'}</h2>
    <div class="grid">${X.order.map((o, i) => `<button data-a="goto" data-i="${i}" class="${answered(o.id) ? 'on' : ''} ${i === X.idx ? 'cur' : ''}" aria-label="${i + 1}번${answered(o.id) ? '' : ' 안 풂'}">${i + 1}</button>`).join('')}</div>
    <div class="sm">번호를 누르면 그 문항으로 갑니다. 색이 칠해진 번호는 답한 문항입니다.</div>
    <div class="row"><button class="btn gh" data-a="modal-close">돌아가기</button><button class="btn am" data-a="submit">제출</button></div>`);
});
on('goto', el => { X.idx = +el.dataset.i; closeModal(); renderExam(); });
on('submit', async () => {
  const left = X.order.filter(o => !answered(o.id)).length;
  const ok = await confirmBox('제출할까요?', `${left ? `<b>안 푼 문항이 ${left}개</b> 있습니다.\n` : ''}제출하면 다시 고칠 수 없습니다.`, '제출', { cancel: '더 풀기' });
  if (ok && X) finish(false);
});
// auto=true: 시간이 끝났거나 교수가 종료함
async function finish(auto) {
  if (!X || X.done) return;
  X.done = true; flushTyping();
  const id = X.id, store = X.store;
  let sent = false;
  try { await within(Promise.all([store.flush(), be.update(ansPath(), { submittedAt: be.now() })])); sent = true; } catch (e) { sent = false; }
  if (!sent && !auto) { X.done = false; return toast('제출하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', 4000); }
  if (sent || !store.pending()) store.close();
  N = { id, my: { submittedAt: sent ? be.now() : 0, a: store.all() }, auto, unsent: !sent && store.pending() > 0 };
  stopExam(); viewDone();
}

/* ---------- 부정행위 방지: 이탈 기록 · 복사 차단 ---------- */
function logEv(t) { if (X) be.push(ansPath() + '/ev', { t, at: be.now() }).catch(() => {}); }
function wentAway(t) { if (!X || X.done || X.away) return; X.away = true; X.leaves++; logEv(t); }
function cameBack() {
  if (!X || X.done || !X.away) return;
  X.away = false; logEv('back');
  showGuard(`<div class="h1">시험 화면을 벗어났습니다</div><div class="txt">벗어난 횟수와 시각이 기록되었습니다.\n지금까지 <b>${X.leaves}회</b></div><button class="btn am" style="flex:none" data-a="guard-ok">시험으로 돌아가기</button>`);
}
function showGuard(html) { const g = $('guard'); g.innerHTML = `<div style="max-width:420px;display:flex;flex-direction:column;gap:16px;text-align:center">${html}</div>`; g.hidden = false; }
on('guard-ok', () => { $('guard').hidden = true; });
function otherWindow() {
  X.done = true; clearInterval(X.tick);
  showGuard('<div class="h1">다른 창에서 시험이 열렸습니다</div><div class="txt">시험은 한 창에서만 볼 수 있습니다. 이 창은 닫아 주세요.</div>');
}
document.addEventListener('visibilitychange', () => (document.hidden ? wentAway('leave') : cameBack()));
window.addEventListener('pagehide', () => wentAway('leave'));
window.addEventListener('blur', () => setTimeout(() => { const el = document.activeElement; if (el && el.tagName === 'IFRAME') return; wentAway('leave'); }, 0));
window.addEventListener('focus', cameBack);
// 안드로이드 앱이 알려 주는 일 (화면 고정이 풀림 등)
window.onPureunEvent = t => { if (t === 'back') cameBack(); else wentAway(t === 'unpin' ? 'unpin' : 'leave'); };
for (const ev of ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop'])
  document.addEventListener(ev, e => { if (X) e.preventDefault(); });
document.addEventListener('selectstart', e => { if (X && !e.target.closest?.('textarea,input')) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (!X) return;
  if (e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && /^[cvxapsu]$/i.test(e.key) && !(e.target.closest?.('textarea') && /^a$/i.test(e.key)))) e.preventDefault();
});

/* ================= 학생: 마무리 쪽 ================= */
function viewDone() {
  view = 'done';
  const m = S.exams[N.id] || {}, e = m.end || {}, my = N.my || {};
  const cnt = Object.values(my.a || {}).filter(v => v !== '' && v != null).length;
  app.innerHTML = shell(`<div style="text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center">
    <div style="font-size:56px" aria-hidden="true">🎓</div>
    <div class="h1">${esc(e.title || '고생하셨습니다')}</div>
    ${e.body ? `<div class="txt">${esc(e.body)}</div>` : ''}
    <div class="txt">${my.submittedAt ? '답안이 제출되었습니다.' : N.unsent ? '시험 시간이 끝났습니다.\n인터넷 연결이 끊겨 일부 답이 아직 전송되지 않았습니다. 이 화면을 닫지 말고 교수님께 알려 주세요.' : '시험이 끝났습니다. 저장된 답안으로 채점됩니다.'}</div>
    <div class="sm">${my.submittedAt ? `제출 시각 ${hhmmss(my.submittedAt)} · ` : ''}답한 문항 ${cnt} / ${m.n || 0}</div>
    ${m.released ? `<button class="btn am" style="flex:none;width:100%" data-a="open-result" data-id="${esc(N.id)}">내 점수와 해설 보기</button>` : '<div class="sm">점수와 해설은 교수님이 공개하면 볼 수 있어요.</div>'}
    <button class="btn gh" style="flex:none;width:100%" data-a="home">처음으로</button></div>`, true);
}
on('open-result', el => openReview(el.dataset.id, 'result'));
on('open-practice', el => openReview(el.dataset.id, 'practice'));

/* ================= 학생: 결과 보기 · 문제풀이 모드 ================= */
let R = null;
async function openReview(id, mode) {
  try {
    const sid = S.me.sid;
    const [sheetRec, keyRec, imgs, my, essay] = await Promise.all([
      be.get('sheets/' + id), be.get('keys/' + id), be.get('images/' + id),
      mode === 'result' ? be.get(`answers/${id}/${sid}`) : null, mode === 'result' ? be.get(`essay/${id}/${sid}`) : null,
    ]);
    const sheet = C.fixSheet(parse(sheetRec, [])), key = parse(keyRec, {});
    if (!sheet.length) return toast('문제를 불러오지 못했어요.');
    let answers = (my && my.a) || {};
    if (mode === 'practice') { try { answers = JSON.parse(LS.get(`prac:${id}:${sid}`) || '{}'); } catch (e) { answers = {}; } }
    R = { id, mode, sheet, key, imgs: imgs || {}, answers, essay: essay || {}, idx: mode === 'result' ? -1 : 0, onlyWrong: false, shown: {} };
    R.score = C.scoreStudent(sheet, key, answers, R.essay);
    view = 'review'; renderReview();
  } catch (e) { toast(/PERMISSION/i.test(String(e.code || e.message)) ? '아직 공개되지 않았어요.' : errText(e)); }
}
const reviewList = () => (R.onlyWrong ? R.sheet.filter(q => R.score.wrong.includes(q.id)) : R.sheet);
function renderReview() {
  const m = S.exams[R.id] || {}, list = reviewList(), sc = R.score, prac = R.mode === 'practice';
  if (R.idx === -1) {
    app.innerHTML = `<div class="phone"><div class="bar"><span>내 결과</span><span class="who">${esc(who())}</span></div>
      <div class="body"><div class="chip">${esc(m.title || '')}</div>
        <div class="big">${sc.total}<small> / ${sc.max}점</small></div>
        <div class="txt">자동 채점 ${sc.mc}점 · 장문형 ${sc.essay}점${sc.essayPending ? ` (채점 전 ${sc.essayPending}문항)` : ''}\n틀리거나 감점된 문항 ${sc.wrong.length}개</div>
        <div class="grid">${R.sheet.map((q, i) => `<button data-a="rv-goto" data-id="${q.id}" class="${sc.per[q.id].ok === true ? 'right' : sc.per[q.id].ok === false ? 'wrong' : ''}" aria-label="${i + 1}번">${i + 1}</button>`).join('')}</div>
        <div class="sm">초록은 맞은 문항, 빨강은 틀린 문항입니다. 번호를 누르면 해설을 봅니다.</div></div>
      <div class="foot"><button class="btn gh" style="flex:0 0 28%" data-a="home">나가기</button><button class="btn gh" data-a="rv-wrong" ${sc.wrong.length ? '' : 'disabled'}>틀린 문항만</button><button class="btn" data-a="rv-all">전체 보기</button></div></div>`;
    return;
  }
  R.idx = Math.max(0, Math.min(R.idx, list.length - 1));
  const q = list[R.idx], k = R.key[q.id] || {}, a = R.answers[q.id], no = R.sheet.indexOf(q) + 1;
  const has = a !== undefined && a !== null && a !== '';
  const p = R.score.per[q.id];
  // 문제풀이: 객관식·드롭다운은 고르면 바로, 나머지는 "정답 확인"을 눌러야 정답이 보입니다.
  const reveal = !prac || R.shown[q.id] || ((q.k === 'choice' || q.k === 'dropdown') && has);
  const live = prac && !reveal;
  let body;
  if (C.hasOpts(q.k)) {
    const mineSet = q.k === 'check' ? C.unpackChecks(a) : (has ? [Number(a)] : []), good = q.k === 'check' ? (k.a || []) : [k.a];
    body = (q.k === 'check' ? '<div class="sm">맞는 것을 모두 고르는 문제입니다.</div>' : '') + q.opts.map((t, i) => {
      const mine = mineSet.includes(i), right = reveal && good.includes(i);
      return `<button class="opt ${q.k === 'check' ? 'sq' : ''} ${right ? 'right' : mine && reveal ? 'wrong' : mine ? 'on' : ''}" ${live ? `data-a="${q.k === 'check' ? 'pr-tick' : 'pr-pick'}" data-v="${i}"` : 'disabled'}><span class="n">${i + 1}</span><span>${esc(t)}</span>${right ? `<span class="tag">정답${mine ? ' · 내 답' : ''}</span>` : mine ? '<span class="tag">내 답</span>' : ''}</button>`;
    }).join('') + (reveal && !mineSet.length ? '<div class="box warn">답을 고르지 않았습니다.</div>' : '') + (live && q.k === 'check' ? '<button class="btn gh" style="flex:none" data-a="pr-show">정답 확인</button>' : '');
  } else if (q.k === 'short') {
    body = live ? `<input class="in" id="pr-text" placeholder="답을 짧게 쓰세요" maxlength="100" autocomplete="off" value="${esc(a || '')}"><button class="btn gh" style="flex:none" data-a="pr-show">정답 확인</button>`
      : `<div class="box ${p.ok ? 'ok' : 'no'}"><b>내 답 — ${p.ok ? '정답' : '오답'}</b>\n${esc(has ? a : '(답을 쓰지 않았습니다)')}</div><div class="box ok"><b>정답</b>\n${esc((k.answers || []).join(' / '))}</div>`;
  } else if (prac) {
    body = `<textarea class="in ta" id="pr-text" placeholder="답을 써 본 뒤 모범 답안을 확인하세요" maxlength="4000">${esc(a || '')}</textarea>${reveal ? '' : '<button class="btn gh" style="flex:none" data-a="pr-show">모범 답안 보기</button>'}`;
  } else {
    body = `<div class="box info"><b>내 답</b>\n${esc(has ? a : '(답을 쓰지 않았습니다)')}</div><div class="box ${p.graded ? 'ok' : 'warn'}"><b>${p.graded ? `받은 점수 ${p.pts} / ${q.pts}점` : '아직 채점 전입니다'}</b></div>`;
  }
  const expl = reveal ? `${q.k === 'long' && k.model ? `<div class="box ok"><b>모범 답안</b>\n${esc(k.model)}</div>` : ''}${k.why ? `<div class="box ok"><b>${q.k === 'long' ? '채점 기준' : '해설'}</b>\n${esc(k.why)}</div>` : ''}` : '';
  app.innerHTML = `<div class="phone"><div class="bar"><span>${prac ? '문제풀이' : R.onlyWrong ? '틀린 문항' : '해설'} ${R.idx + 1} / ${list.length}</span><button data-a="${prac ? 'home' : 'rv-top'}">${prac ? '나가기' : '점수 화면'}</button></div>
    <div class="prog"><i style="width:${(R.idx + 1) / list.length * 100}%"></i></div>
    <div class="body"><div class="chip">${no}번 · ${esc(typeChip(q))}${reveal && k.level ? ` · 난이도 ${esc(k.level)}` : ''}</div><div class="q">${esc(q.q)}</div>${media(q, R.imgs)}${body}${expl}</div>
    <div class="foot"><button class="btn gh" data-a="rv-prev" ${R.idx ? '' : 'disabled'}>이전</button>${prac ? '<button class="btn gh" data-a="pr-reset">처음부터 다시</button>' : ''}<button class="btn" data-a="rv-next" ${R.idx < list.length - 1 ? '' : 'disabled'}>다음</button></div></div>`;
  const ta = $('pr-text');
  if (ta) ta.addEventListener('input', () => { R.answers[q.id] = ta.value; savePractice(); });
}
const savePractice = () => LS.set(`prac:${R.id}:${S.me.sid}`, JSON.stringify(R.answers));
on('rv-goto', el => { R.onlyWrong = false; R.idx = R.sheet.findIndex(q => q.id === el.dataset.id); renderReview(); });
on('rv-wrong', () => { R.onlyWrong = true; R.idx = 0; renderReview(); });
on('rv-all', () => { R.onlyWrong = false; R.idx = 0; renderReview(); });
on('rv-top', () => { R.idx = -1; renderReview(); });
on('rv-prev', () => { R.idx--; renderReview(); });
on('rv-next', () => { R.idx++; renderReview(); });
on('pr-pick', el => { const q = reviewList()[R.idx]; R.answers[q.id] = +el.dataset.v; savePractice(); renderReview(); });
on('pr-tick', el => { const q = reviewList()[R.idx], v = +el.dataset.v, cur = C.unpackChecks(R.answers[q.id]); R.answers[q.id] = C.packChecks(cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]); savePractice(); renderReview(); });
on('pr-show', () => { R.shown[reviewList()[R.idx].id] = true; R.score = C.scoreStudent(R.sheet, R.key, R.answers, R.essay); renderReview(); });
on('pr-reset', async () => { if (await confirmBox('처음부터 다시 풀까요?', '지금까지 고른 답이 지워집니다.', '다시 풀기')) { R.answers = {}; R.shown = {}; R.idx = 0; savePractice(); renderReview(); } });

boot();
