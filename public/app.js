// 푸른시험 — 시작점과 학생 화면
import * as C from './core.js';
import { createAnswerStore } from './save.js';
import { S, be, setBackend, APP, parse } from './state.js';
import { media, typeChip, answerHtml } from './view.js';
import { testCamera, startWatch } from './face.js';
import { $, esc, on, toast, modal, closeModal, confirmBox, zoom, closeZoom, CIRCLED, errText, hhmmss, countdown } from './ui.js';

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
// ?test=번호 : 교수 기기에서 여는 '테스트 학생' 화면. 교수 로그인과 따로, 이 탭에만 학생 로그인을 둡니다.
// 테스트 학생 화면은 교수님이 로그인한 기기에서만 열립니다 (실제 학생이 주소만 바꿔 두 번째 이름을 얻지 못하게)
const TEST = /^\d{1,4}$/.test(Q.get('test') || '') && (() => { try { return localStorage.getItem('pureun:prof') === '1'; } catch (e) { return false; } })() ? Q.get('test') : '';
const WANT_PROF = Q.has('prof') && !TEST;
const PROF_HERE = 'pureun:prof';   // 이 기기에서 교수님이 로그인한 적이 있으면 '1' (실제 학생 기기에는 없음)
const urlFor = q => './?' + [q, MOCK ? 'mock=1' : ''].filter(Boolean).join('&');
const app = $('app');
const who = () => (S.me ? `${S.me.cls} ${S.me.sid} ${S.me.name}` : '');
const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

// 인터넷이 끊기면 서버 요청이 끝없이 기다리므로, 정해진 시간 뒤에는 실패로 봅니다.
const within = (p, ms = 8000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('network timeout')), ms))]);

/* ================= 시작 · 로그인 ================= */
let unsubExams = null, unsubCls = null, unsubNeed = null, unsubMe = null, profMod = null;
async function boot() {
  if (TEST) document.title = `[테스트 학생 ${TEST}] 푸른시험`;
  try { setBackend(await (MOCK ? import('./mock.js') : import('./fb.js')).then(m => m.createBackend(CONFIG, TEST ? { name: 'test' + TEST, session: true } : WANT_PROF ? { name: 'prof' } : {}))); }
  catch (e) { app.innerHTML = shell('<div class="h1">연결하지 못했어요</div><div class="txt">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</div><button class="btn am" style="flex:none" data-a="reload">다시 시도</button>', true); return; }
  be.onAuth(async u => {
    stopExam(); if (unsubExams) { unsubExams(); unsubExams = null; } if (unsubCls) { unsubCls(); unsubCls = null; } if (unsubNeed) { unsubNeed(); unsubNeed = null; } if (unsubMe) { unsubMe(); unsubMe = null; }
    S.user = u; S.role = ''; S.me = null;
    try {
      // 교수용 주소와 학생용 주소는 로그인 자리가 따로입니다(교수: 'prof', 학생: 기본).
      // 그래서 같은 기기에서도 교수 로그인과 학생 입장이 서로 덮이지 않습니다.
      if (WANT_PROF) {
        if (!u) return viewProfLogin();
        if (u.anon) { await be.signOut(); return; }   // 교수 자리에 학생 로그인이 있으면 내보냄
      } else {
        if (!u) { await be.signInAnon(); return; }
        if (!u.anon) { await be.signOut(); return; }  // 예전에 학생 자리에 남아 있던 교수 로그인은 내보내고 학생으로 시작
      }
      unsubCls = be.on('classes', v => { S.classes = C.classList(v); if ($('e-sid')) keepEntry(); if (profMod && S.role === 'prof') profMod.onClasses(); });
      unsubNeed = be.on('entry/need', v => { S.needCode = !!v; if ($('e-sid')) keepEntry(); });
      if (u.anon) {
        S.role = 'student';
        S.me = await be.get('users/' + u.uid);
        // 교수님이 '입장 취소'를 누르면 이 기록이 지워집니다. 껐다 켜지 않아도 바로 입장 화면으로 돌아갑니다.
        unsubMe = be.on('users/' + u.uid, v => { if (!v && S.me && S.role === 'student') entryCancelled(); });
        unsubExams = be.on('exams', v => { S.exams = v || {}; onExams(); });
        if (!S.me) viewEntry();
      } else {
        let ok = (await be.get('admins/' + u.uid)) === true;
        if (!ok) { try { await be.set('admins/' + u.uid, true); ok = true; } catch (e) { ok = false; } } // 맨 처음 로그인한 교수 계정만 등록됨
        if (!ok) { await be.signOut(); return viewProfLogin('이 계정은 교수 계정으로 등록되어 있지 않아요.'); }
        S.role = 'prof';
        LS.set(PROF_HERE, '1');
        profMod = profMod || await import('./prof.js');
        unsubExams = be.on('exams', v => { S.exams = v || {}; profMod.onExams(); });
        profMod.start();
      }
    } catch (e) { console.error(e); app.innerHTML = shell(`<div class="h1">연결 문제</div><div class="txt">${esc(errText(e))}</div><button class="btn am" data-a="reload">다시 시도</button>`, true); }
  });
}
on('reload', () => location.reload());
// 입장이 취소됨: 풀던 답은 이 기기에 남겨 두고(다시 입장하면 이어서 보냄) 입장 화면으로 돌아갑니다
let cancelPending = false;
function entryCancelled() {
  if (X && X.done) { cancelPending = true; return; }   // 제출하는 중이면 제출을 마친 뒤에 입장 화면으로
  const me = S.me, inExam = !!X;
  if (X) { flushTyping(); try { saveTime(); } catch (e) {} try { X.store.close(false); } catch (e) {} X.done = true; stopExam(); }
  closeModal(); clearInterval(noticeT); S.me = null; view = ''; N = null; R = null;
  if (me) entryCls = me.cls;
  viewEntry(`입장이 취소되었습니다. 입장을 다시 누르면 들어갈 수 있습니다.${inExam ? ' 풀던 답은 이 기기에 남아 있어, 같은 학번으로 다시 들어가면 이어서 보냅니다. 시험 시간은 그동안에도 흐릅니다.' : ''}`);
  if (me && $('e-sid')) { $('e-sid').value = me.sid; $('e-name').value = me.name; }   // 다시 입력하지 않아도 되게
}
// 테스트 학생 화면 맨 위 띠
const testRibbon = () => (TEST ? `<div class="testband">테스트 학생 ${TEST} · 실제 학생처럼 기록됩니다 · '푸른시험'을 5번 누르면 교수 화면</div>` : '');
// '푸른시험' 글자를 5번 빠르게 누르면 교수 화면 ↔ 테스트 학생 화면 (교수님이 로그인한 적 있는 기기에서만)
let brandN = 0, brandT = 0;
on('brand', () => {
  if (X && !X.done && !TEST) return;   // 시험 푸는 중에는 안 됨. 교수 화면은 교수 구글 계정으로 로그인해야 들어갈 수 있습니다
  const now = Date.now(); brandN = now - brandT < 1500 ? brandN + 1 : 1; brandT = now;
  if (brandN < 5) return;
  brandN = 0;
  location.href = S.role === 'prof' ? urlFor('test=' + mySlot()) : urlFor('prof=1');
});
// 테스트 학생 번호: 새로 받을 때마다 하나씩 올립니다. 이 탭에서 오가는 테스트 학생은 늘 같은 번호(같은 학생)입니다.
const SS = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };
// 번호는 무작위로 정합니다 (교수님의 PC와 휴대폰이 같은 번호를 내지 않게)
const newSlot = () => String(1000 + Math.floor(Math.random() * 9000));
const mySlot = () => SS.get('pureun:myslot') || (s => (SS.set('pureun:myslot', s), s))(newSlot());
if (TEST) SS.set('pureun:myslot', TEST);
// 교수 화면의 '학생으로 테스트': 새 탭마다 새 테스트 학생
on('test-open', () => {
  const n = newSlot();
  const a = document.createElement('a'); a.href = urlFor('test=' + n); a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
});
/* ----- 업데이트: "업데이트"를 누르면 최신 화면으로 새로 고칩니다. 앱에 새 버전이 있으면 내려받아 설치 화면을 띄웁니다. ----- */
const UPD_BTN = '<button class="updbtn" data-a="upd" title="최신 버전으로">업데이트</button>';
const appNew = () => { try { return !!(APP && APP.updateAvailable && APP.updateAvailable()); } catch (e) { return false; } };
const appOld = () => !!APP && !(APP.updateAvailable);   // 업데이트 기능이 없는 예전 앱
const appUpdBox = () => appNew() ? '<div class="box info"><b>새 앱 버전이 있습니다.</b> 아래 버튼을 누르고 안드로이드의 <b>설치</b>를 눌러 주세요. 시험 전에 해 두세요.</div><button class="btn am" style="flex:none" data-a="upd">새 버전 설치</button>' : '';
on('upd', () => {
  if (APP && X && !X.done) return;   // 시험 중에는 하지 않음
  if (appNew()) { try { APP.installUpdate(); } catch (e) {} return; }
  if (appOld()) return toast('이 앱은 새 앱을 크롬에서 한 번 내려받아 다시 설치해야 합니다. 교수님께 받은 주소를 크롬에서 여세요.', 7000);
  toast('최신 버전으로 새로 고칩니다…'); setTimeout(() => location.reload(), 300);
});
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
const IN_APP_BROWSER = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
// 안드로이드는 앱으로만 보는 시험이 열려 있으면, 인터넷 창에서는 입장하지 않게 합니다.
// (인터넷 창에서 먼저 입장하면 그 학번이 그 창에 묶여, 앱에서 다시 입장할 수 없게 됩니다)
const mustUseApp = () => IS_ANDROID && !APP && Object.values(S.exams).some(m => C.appOnlyOn(m) && (m.status === 'open' || m.status === 'running'));
function viewEntry(err = '') {
  const cs = S.classes;
  if (!cs.includes(entryCls)) entryCls = cs.length === 1 ? cs[0] : '';   // 반이 하나뿐이면 고를 필요 없음
  if (mustUseApp() || IN_APP_BROWSER) {
    app.innerHTML = shell(`<div class="chip" data-a="brand">푸른시험</div>${mustUseApp()
      ? `<div class="h1">이 시험은 앱으로 봅니다</div><div class="txt">아래 버튼으로 앱을 내려받아 설치한 뒤, <b>앱에서</b> 반·학번·이름을 입력해 입장하세요.\n이 인터넷 창에서는 입장하지 마세요.</div><a class="btn am" style="flex:none;text-decoration:none" href="${APK_URL}">안드로이드 앱 내려받기</a>`
      : '<div class="h1">다른 창에서 열어 주세요</div><div class="txt">카카오톡·네이버 같은 앱 안의 창에서는 시험을 볼 수 없습니다.\n오른쪽 위 메뉴(⋮ 또는 공유)에서 <b>다른 브라우저로 열기</b>를 눌러 크롬이나 사파리로 열어 주세요.</div>'}`, true);
    return;
  }
  app.innerHTML = shell(`${testRibbon()}<div class="brandrow"><div class="chip" data-a="brand">푸른시험${TEST ? ` · 테스트 학생 ${TEST}` : ''}</div>${UPD_BTN}</div>${appUpdBox()}
    <div class="h1">${cs.length > 1 ? '반을 고르고 학번과 이름을 입력하세요' : '학번과 이름을 입력하세요'}</div>
    ${cs.length > 1 ? `<div class="seg">${cs.map(c => `<button data-a="cls" data-c="${esc(c)}" class="${entryCls === c ? 'on' : ''}" aria-pressed="${entryCls === c}">${esc(c)}</button>`).join('')}</div>` : `<div class="sm" style="font-size:17px;font-weight:700">${esc(cs[0])}</div>`}
    <input class="in" id="e-sid" inputmode="numeric" autocomplete="off" placeholder="학번 (예: 20261234)" maxlength="20" value="${TEST ? 'TEST' + TEST : ''}">
    <input class="in" id="e-name" autocomplete="off" placeholder="이름" maxlength="20" value="${TEST ? '테스트' + TEST : ''}">
    ${S.needCode ? '<input class="in" id="e-code" inputmode="numeric" autocomplete="off" placeholder="입장 코드 (교수님이 알려 줍니다)" maxlength="12">' : ''}
    ${err ? `<div class="box no">${esc(err)}</div>` : ''}
    <button class="btn am" style="flex:none" data-a="enter">입장</button>
    <div class="sm">학번과 이름을 정확히 입력하세요. 처음 입장한 이 기기에서만 응시할 수 있습니다.</div>
    <div style="margin-top:auto;text-align:center">${IS_ANDROID && !APP ? `<a class="link" href="${APK_URL}">안드로이드 앱 내려받기</a>` : ''}</div>`, true);
}
// 입력하던 글자를 지우지 않고 화면만 다시 그립니다
function keepEntry(err = '') {
  const v = id => ($(id) ? $(id).value : ''), sid = v('e-sid'), nm = v('e-name'), code = v('e-code');
  viewEntry(err);
  if ($('e-sid')) { $('e-sid').value = sid; $('e-name').value = nm; if ($('e-code')) $('e-code').value = code; }
}
on('cls', el => { entryCls = el.dataset.c; keepEntry(); });
on('enter', async () => {
  const sid = C.normSid($('e-sid').value), name = C.normName($('e-name').value), cls = entryCls, code = $('e-code') ? $('e-code').value.trim() : '';
  const again = m => { keepEntry(m); $('e-sid').value = sid; $('e-name').value = name; };
  if (!cls) return again('반을 먼저 골라 주세요.');
  if (!C.validSid(sid)) return again('학번을 정확히 입력해 주세요.');
  if (!name) return again('이름을 입력해 주세요.');
  if (S.needCode && !code) return again('입장 코드를 입력해 주세요. 교수님이 알려 줍니다.');
  const rec = { sid, name, cls, at: be.now() }; if (code) rec.code = code;
  try {
    await within(be.update('', { ['users/' + S.user.uid]: rec, ['bind/' + sid]: S.user.uid }), 15000);
    S.me = { sid, name, cls }; viewHome();
  } catch (e) {
    again(/PERMISSION/i.test(String(e.code || e.message)) ? `입장하지 못했어요. ${S.needCode ? '입장 코드가 틀렸거나, ' : ''}이 학번으로 이미 다른 기기에서 입장했습니다. 교수님께 말씀해 주세요.` : errText(e));
  }
});

/* ================= 학생: 시험 목록 ================= */
let view = '';   // 'home' | 'notice' | 'exam' | 'done' | 'review'
function onExams() {
  if (!S.me) { if ($('e-sid') || mustUseApp()) keepEntry(); return; }
  if (view === '' || view === 'home') viewHome();
  else if (view === 'notice') viewNotice();
  else if (view === 'exam') examMetaChanged();
  else if (view === 'done') viewDone();
}
// 시간이 지났으면 교수가 "종료"를 누르기 전이라도 끝난 시험으로 봅니다
const isOver = m => m.status === 'ended' || (m.status === 'running' && be.now() >= m.endAt);
// 학생마다 "시험 시작"을 누른 때부터 시험 시간이 흐릅니다. 전체 마감(endAt)을 넘길 수는 없습니다.
const deadline = (m, startedAt, until) => Math.min(m.endAt, until || (startedAt + m.minutes * 60000 + (m.extra || 0)));
function viewHome() {
  view = 'home'; exitFull();
  try { if (APP && APP.fullscreen) APP.fullscreen(false); } catch (e) {}
  const list = Object.entries(S.exams).filter(([, m]) => m && ['open', 'running', 'ended'].includes(m.status)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  // 끝난 시험은 내가 봤는지 확인해서, 보지 않았으면 "미응시"로 보여 줍니다
  const ask = list.filter(([id, m]) => isOver(m) && S.took[id] === undefined);
  if (ask.length) Promise.all(ask.map(([id]) => be.get(`answers/${id}/${S.me.sid}/startedAt`).then(v => { S.took[id] = !!v; }, () => {}))).then(() => { if (view === 'home') viewHome(); });
  const card = ([id, m]) => {
    const over = isOver(m), missed = over && S.took[id] === false;
    const st = missed ? ['end', '미응시'] : over ? ['end', m.released ? '결과 공개' : '종료'] : ({ open: ['wait', '곧 시작'], running: ['run', '진행 중'] }[m.status] || ['', '']);
    const hint = missed ? '이 시험을 보지 않았어요' : m.status === 'open' ? '눌러서 대기실에 들어가세요' : !over && m.status === 'running' ? '눌러서 응시하세요' : over ? (m.released ? '눌러서 내 점수와 해설을 보세요' : '결과는 교수님이 공개하면 볼 수 있어요') : '';
    return `<button class="card" data-a="open-exam" data-id="${esc(id)}"><span class="st ${st[0]}">${st[1]}</span><h3>${esc(m.title || '시험')}</h3><div class="sm">${m.n || 0}문항 · ${m.minutes || 0}분 · ${hint}</div></button>`;
  };
  app.innerHTML = `<div class="phone"><div class="bar"><span class="brandrow"><span data-a="brand">푸른시험${TEST ? ' · 테스트' : ''}</span>${UPD_BTN}</span><span class="who">${esc(who())}</span></div>
    <div class="body tint">${appUpdBox()}${list.length ? list.map(card).join('') : '<div class="box info">지금 열려 있는 시험이 없어요. 교수님이 시험을 열면 여기에 나타납니다.</div>'}</div></div>`;
}
on('home', () => { stopExam(); viewHome(); });

/* ================= 학생: 안내 쪽 ================= */
let N = null, noticeT = 0;
on('open-exam', async el => {
  const id = el.dataset.id, m = S.exams[id]; if (!m) return;
  if (!isOver(m)) enterFull();   // 누르는 순간부터 전체 화면(안내 화면부터). 브라우저는 누르는 그때만 허락합니다.
  const my = (await be.get(`answers/${id}/${S.me.sid}`)) || {};
  // wait: 교수가 시작하기 전에 대기실에 들어온 학생 → 교수가 시작하면 5·4·3·2·1 뒤 모두 함께 시작
  N = { id, checked: false, my, wait: m.status === 'open', going: false };
  if (my.submittedAt) return viewDone();
  if (isOver(m)) return !my.startedAt ? viewMissed(id) : m.released ? openReview(id, 'result') : viewDone();
  if (m.status === 'running' && my.startedAt) return be.now() < deadline(m, my.startedAt, my.until) ? startExam() : viewDone();   // 이어서 풀기
  viewNotice();
});
const APK_URL = 'https://github.com/lsc571-max/pureun-exam/releases/latest/download/pureun-exam.apk';
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const appCall = (name, fallback) => { try { return APP && APP[name] ? APP[name]() : fallback; } catch (e) { return fallback; } };
// 앱에서는 방해 금지가 켜져 있거나, 시작할 때 자동으로 켤 수 있어야 시작 버튼이 눌립니다.
const dndOn = () => !APP || !!appCall('isDndOn', true) || !!appCall('canAutoDnd', false);
function viewNotice() {
  view = 'notice';
  const m = S.exams[N.id];
  if (!m || m.status === 'draft') return viewHome();
  if (isOver(m)) return viewDone();
  const running = m.status === 'running';
  const needApp = C.appOnlyOn(m) && IS_ANDROID && !APP;   // 안드로이드는 앱으로만 응시
  const camReady = !C.camOn(m) || N.camOk || N.camSkip;
  const prepared = N.checked && dndOn() && !needApp && camReady, ready = running && prepared;
  const nt = m.notice || {};
  const dndBox = !APP ? `<div class="box info">전화와 알림이 시험을 방해하지 않게 <b>방해 금지 모드</b>를 켜 주세요.${/iPhone|iPad/i.test(navigator.userAgent) ? '\n아이폰은 <b>사용법 유도</b>(설정 → 손쉬운 사용)를 켜고 옆 버튼을 세 번 누르면 시험 화면이 고정됩니다.' : ''}</div><button class="btn gh" style="flex:none" data-a="dnd">방해 금지 모드 켜는 방법</button>`
    : appCall('canAutoDnd', false) ? '<div class="box ok">시험을 시작하면 <b>방해 금지 모드가 자동으로 켜지고</b>, 끝나면 원래대로 돌아갑니다.</div>'
    : appCall('isDndOn', false) ? '<div class="box ok">방해 금지 모드가 켜져 있습니다.</div>'
    : '<div class="box warn"><b>방해 금지 모드가 꺼져 있습니다.</b> 아래 버튼을 눌러 "푸른시험"을 허용하면 시험 때 자동으로 켜고 끕니다. 한 번만 하면 됩니다.</div><button class="btn am" style="flex:none" data-a="dnd">방해 금지 자동 켜기 허용</button>';
  app.innerHTML = `<div class="phone"><div class="bar"><span>시험 안내</span><span class="who">${esc(who())}</span></div>
    <div class="body">
      <div class="h1">${esc(nt.title || m.title || '시험')}</div>
      ${nt.body ? `<div class="txt">${esc(nt.body)}</div>` : ''}
      <ul class="rules">
        ${N.wait ? `<li>확인을 마치고 기다리면, <b>교수님이 시작할 때 5초 뒤 모두 함께</b> 시작됩니다. 그때부터 <b>${m.minutes}분</b>이 흐르고, 끝나면 자동으로 제출됩니다.</li>` : `<li>확인을 마치고 <b>시험 시작</b>을 누르면 5초 뒤 1번 문제가 나오고, 그때부터 <b>${m.minutes}분</b>이 흐릅니다. 끝나면 자동으로 제출됩니다.</li>`}
        <li>문제 순서와 보기 순서는 학생마다 다릅니다.</li>
        <li>시험 화면을 벗어나면 <b>횟수와 시각이 기록</b>됩니다.${m.leaveLock === 0 ? '' : ` <b>${Number.isFinite(m.leaveLock) && m.leaveLock > 0 ? m.leaveLock : 2}번</b> 벗어나면 화면이 잠기고, 교수님이 풀어 주셔야 합니다.`}</li>
        <li>화면 캡처·녹화·복사는 금지입니다.</li>
        <li>답은 고르는 즉시 저장됩니다. 앱이 꺼져도 이어서 풀 수 있습니다.</li>
        ${APP ? '<li>시작하면 <b>화면 고정</b>을 묻는 창이 뜹니다. <b>확인</b>을 눌러 주세요. 고정이 풀리면 기록되고 문제가 가려집니다.</li>' : ''}
      </ul>
      ${needApp ? `<div class="box no"><b>이 시험은 안드로이드 앱으로만 볼 수 있습니다.</b>\n아래에서 앱을 내려받아 설치한 뒤, 앱에서 다시 입장해 주세요.</div><a class="btn am" style="flex:none;text-decoration:none" href="${APK_URL}">안드로이드 앱 내려받기</a>` : dndBox}
      ${!C.camOn(m) || needApp ? '' : N.camOk ? '<div class="box ok">카메라가 확인되었습니다. 시험 중에는 얼굴이 화면을 향하게 해 주세요.</div>'
        : N.camSkip ? '<div class="box warn">카메라 없이 시작합니다. 교수님 화면에 표시됩니다.</div>'
        : `<div class="box info">이 시험은 <b>전면 카메라</b>로 얼굴이 화면을 보고 있는지 확인합니다. 영상은 저장되거나 전송되지 않습니다. 얼굴이 몇 초 넘게 보이지 않거나 고개를 돌리면 경고가 기록되고, ${(Number.isInteger(m.camLock) && m.camLock >= 0 && m.camLock <= 20 ? m.camLock : C.CAM_DEF.camLock) ? `경고가 ${Number.isInteger(m.camLock) && m.camLock >= 0 && m.camLock <= 20 ? m.camLock : C.CAM_DEF.camLock}회 쌓이면 화면이 잠깁니다` : '경고는 교수님 화면에 남습니다'}.\n아래 버튼을 누르면 3초 동안 내 얼굴이 화면에 보입니다.</div>
          ${N.camErr ? '<div class="box no"><b>카메라를 켤 수 없어요.</b> 카메라 사용을 허용했는지 확인하고 다시 눌러 주세요. 계속 안 되면 교수님께 말씀하세요.</div>' : ''}
          <button class="btn am" style="flex:none" data-a="cam-test">카메라 확인하기</button>${N.camErr ? '<button class="btn gh" style="flex:none" data-a="cam-skip">카메라 없이 시작 (교수님께 표시됨)</button>' : ''}`}
      <button class="check ${N.checked ? 'on' : ''}" data-a="agree" aria-pressed="${N.checked}"><i>✓</i>확인했습니다</button>
      <div class="sm">${N.wait ? (prepared ? '준비가 끝났습니다. 이 화면에서 기다려 주세요.' : '위의 확인을 마치고 기다려 주세요.') : ''}</div>
    </div>
    <div class="foot"><button class="btn gh" style="flex:0 0 30%" data-a="home">나가기</button>${N.wait
      ? `<button class="btn am" data-a="start" disabled>${!running ? '교수님이 시작하면 자동으로 시작됩니다' : prepared ? '곧 시작합니다' : '확인을 마치면 바로 시작됩니다'}</button>`
      : `<button class="btn am" data-a="start" ${ready ? '' : 'disabled'}>시험 시작</button>`}</div></div>`;
  try { if (APP && APP.fullscreen) APP.fullscreen(true); } catch (e) {}
  if (N.wait && ready) go();   // 대기실 학생: 교수가 시작했고 확인도 끝났으면 바로 5·4·3·2·1
  clearInterval(noticeT);
  // 앱: 방해 금지 설정을 바꾸고 돌아오면 안내와 시작 버튼을 바로 고쳐 보여 줍니다
  const dndShown = `${appCall('isDndOn', false)}${appCall('canAutoDnd', false)}`;
  if (APP) noticeT = setInterval(() => { if (view !== 'notice') return clearInterval(noticeT); if (`${appCall('isDndOn', false)}${appCall('canAutoDnd', false)}` !== dndShown) keepScroll(viewNotice); }, 1000);
}
on('agree', () => { N.checked = !N.checked; const y = document.querySelector('.body').scrollTop; viewNotice(); document.querySelector('.body').scrollTop = y; });
on('dnd', () => {
  if (APP) { if (appCall('canAutoDnd', false)) return toast('시험을 시작하면 자동으로 켜집니다.'); try { APP.requestDndAccess(); } catch (e) {} return; }
  modal(`<h2>방해 금지 모드 켜는 방법</h2>
    <div class="txt"><b>아이폰</b>\n화면 오른쪽 위에서 아래로 쓸어내려 제어 센터를 열고 → 집중 모드 → 방해금지 모드를 누릅니다.\n\n<b>안드로이드</b>\n화면 위에서 아래로 두 번 쓸어내리고 → 방해 금지를 누릅니다.</div>
    <button class="btn" data-a="modal-close">알겠습니다</button>`);
});
const keepScroll = fn => { const b = document.querySelector('.body'), y = b ? b.scrollTop : 0; fn(); const n = document.querySelector('.body'); if (n) n.scrollTop = y; };
on('cam-test', async () => {
  try { await testCamera(); N.camOk = true; N.camErr = false; } catch (e) { N.camErr = true; }
  if (view === 'notice') keepScroll(viewNotice);
});
on('cam-skip', () => { N.camSkip = true; keepScroll(viewNotice); });
on('start', () => { enterFull(); go(); });   // 누른 바로 그때 전체 화면을 켭니다(브라우저는 누르는 순간에만 허락)
// 5·4·3·2·1 뒤 1번 문제부터. 시간은 이때부터 흐릅니다.
async function go() {
  if (!N || N.going) return;
  N.going = true; const mine = N;
  await countdown(5);
  if (N === mine && view === 'notice') startExam(); else mine.going = false;
}

/* ================= 학생: 시험 보기 ================= */
let X = null;   // 지금 보고 있는 시험
const ansPath = () => X.path;
let wake = null;
// 웹에서는 화면이 저절로 꺼지면 "이탈"로 기록되므로, 시험 중에는 화면이 꺼지지 않게 합니다 (앱은 앱이 처리)
async function keepAwake() { try { if (!APP && X && !X.done && navigator.wakeLock && !document.hidden) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
async function startExam() {
  const id = N.id, path = `answers/${id}/${S.me.sid}`;
  try {
    const mine = (await within(be.get(path), 15000)) || {};
    if (mine.submittedAt) { N.my = mine; return viewDone(); }
    // 시작 기록을 먼저 남깁니다. 시작한 학생만 문제지를 받을 수 있습니다.
    const sess = Math.random().toString(36).slice(2, 12);
    const first = { sess, dev: (APP ? 'app ' : 'web ') + navigator.userAgent.slice(0, 200) };
    const startedAt = mine.startedAt || be.now();
    if (!mine.startedAt) first.startedAt = startedAt;
    if (!mine.who) first.who = { name: S.me.name, cls: S.me.cls };   // 입장이 취소돼도 결과에 이름이 남게
    await within(be.update(path, first));
    const [sheetRec, imgs] = await within(Promise.all([be.get('sheets/' + id), be.get('images/' + id)]), 25000);
    const sheet = C.fixSheet(parse(sheetRec, []));
    if (!sheet.length) return toast('문제를 불러오지 못했어요.');
    X = {
      id, path, startedAt, until: mine.until || 0, sheet, byId: Object.fromEntries(sheet.map(q => [q.id, q])), imgs: imgs || {},
      order: C.examOrder(sheet, id, S.me.sid), idx: Math.max(0, +(sessionStorage.getItem('idx:' + id) || 0)),
      sess, leaves: C.leaveSummary(mine.ev).count, away: false, unsubs: [], done: false, typing: 0,
      tm: { ...(mine.tm || {}) }, tmDirty: {}, curQ: '', qStart: 0, ticks: 0,                                   // 문항별 풀이 시간(초)
      camWarn: C.leaveSummary(mine.ev).warn, leaveWarn: C.leaveSummary(mine.ev).lwarn, locks: C.leaveSummary(mine.ev).locks, unlockN: mine.unlock || 0,   // 카메라 경고 · 잠금
      watch: null, camDown: false, guardKind: '',
    };
    X.idx = Math.min(X.idx, X.order.length - 1);
    fullOn = !!document.fullscreenElement;   // 시작을 누를 때 켠 전체 화면이 풀리면 기록
    X.store = createAnswerStore({
      key: `ans:${id}:${S.me.sid}`, storage: localStorage,
      send: patch => be.update(path, Object.fromEntries(Object.entries(patch).map(([k, v]) => ['a/' + k, v]))),   // 시험 화면이 닫힌 뒤에도 같은 자리로 다시 보냅니다
      onStatus: paintSave,
    });
    X.store.load(mine.a || {});
    X.unsubs.push(be.on(path + '/sess', v => { if (X && !X.done && v && v !== X.sess) otherWindow(); }));
    X.unsubs.push(be.on(path + '/unlock', v => {   // 교수가 잠긴 화면을 풀어 줌
      if (!X) return; X.unlockN = v || 0;
      if (!locked() && X.guardKind === 'lock') { logEv('unlocked'); X.camWarn = 0; X.leaveWarn = 0; hideGuard(); if (X.watch) X.watch.reset(); resumeTime(); toast('교수님이 잠금을 풀었습니다. 계속 푸세요.', 4000); }
    }));
    X.unsubs.push(be.on(path + '/until', v => { if (X) { X.until = v || 0; tick(); } }));   // 교수가 이 학생의 시간을 따로 준 경우
    X.unsubs.push(be.on(path + '/submittedAt', v => { if (X && !X.done && v) finish(true); }));
    X.unsubs.push(be.onConnected(c => { if (X) { X.conn = c; paintSave(); } }));
    X.tick = setInterval(tick, 500);
    app.classList.add('lock');
    try { if (APP && APP.startLock) APP.startLock(); } catch (e) {}
    if (!TEST) try { history.pushState({ exam: 1 }, ''); } catch (e) {}   // 뒤로 가기로 시험 화면을 벗어나지 않게
    keepAwake();
    view = 'exam'; renderExam(); tick();
    if (C.camOn(S.exams[id])) {
      if (N && N.camSkip) { X.camDown = true; logEv('nocam'); } else camStart();
      if (locked()) showLock();
    }
  } catch (e) {
    console.error(e); X = null; if (N) N.going = false;
    if (/PERMISSION/i.test(String(e.code || e.message))) { toast('지금은 시험을 시작할 수 없어요.'); viewNotice(); } else toast(errText(e));
  }
}
function stopExam() {
  exitFull();
  if (!X) return;
  camStop();
  clearInterval(X.tick); clearInterval(X.pinPoll); X.unsubs.forEach(u => { try { u(); } catch (e) {} });
  app.classList.remove('lock'); $('guard').hidden = true; closeZoom(); closeModal();
  try { if (APP && APP.stopLock) APP.stopLock(); } catch (e) {}
  try { if (wake) wake.release(); } catch (e) {} wake = null;
  X = null;
}
// 뒤로 가기: 시험 중에는 화면을 벗어나지 않고, 열려 있는 창만 닫습니다
window.addEventListener('popstate', () => { if (X && !X.done && !TEST) { try { history.pushState({ exam: 1 }, ''); } catch (e) {} closeZoom(); if (!$('modal').hidden) closeModal(); } });
function examMetaChanged() { if (X && !X.done) tick(); }
function tick() {
  if (!X || X.done) return;
  const m = S.exams[X.id];
  if (!m || m.status !== 'running') return finish(true);
  if (++X.ticks % 40 === 0) { saveTime(); camPolicy(); }   // 20초마다 풀이 시간을 저장하고, 발열·배터리를 확인
  const left = deadline(m, X.startedAt, X.until) - be.now();
  const c = $('clock'); if (c) { c.textContent = C.fmtClock(left); c.classList.toggle('low', left < 5 * 60000); }
  if (left <= 0) finish(true);
}
function paintSave() {
  const el = $('save'); if (!el || !X) return;
  const st = X.store.status(), off = X.conn === false || st === 'offline';
  el.className = 'save' + (off ? ' off' : '');
  el.textContent = off ? '연결 끊김 — 답은 이 기기에 저장되어 있고, 연결되면 자동으로 보냅니다' : st === 'saving' ? '저장 중…' : '✓ 저장됨';
}
on('zoom', el => zoom(el.querySelector('img').src));

function renderExam(dir = '') {
  if (!X) return;
  flushTyping();
  const o = X.order[X.idx], q = X.byId[o.id], a = X.store.get(q.id), n = X.order.length;
  if (X.curQ !== q.id) { saveTime(); X.curQ = q.id; X.qStart = paused() ? 0 : Date.now(); }
  sessionStorage.setItem('idx:' + X.id, X.idx);
  const body = answerHtml(q, o, a);
  const rest = X.only ? leftIdx().length : 0;
  const onlyBar = X.only ? `<div class="onlyband"><span>안 푼 문제만 보는 중 · <b>${rest}개</b> 남음</span><button data-a="only-off">전체 보기</button></div>` : '';
  const prevOff = X.only ? !leftIdx().some(i => i < X.idx) : !X.idx;
  const nextBtn = X.only ? '<button class="btn" data-a="next">다음</button>' : X.idx < n - 1 ? '<button class="btn" data-a="next">다음</button>' : '<button class="btn am" data-a="qlist">제출</button>';
  app.innerHTML = `<div class="phone"><div class="bar"><span>${X.idx + 1} / ${n}</span>${C.camOn(S.exams[X.id]) ? '<span class="watch"><i></i>부정행위 감시 중</span>' : ''}<span class="clock" id="clock">--:--</span></div>
    <div class="prog"><i style="width:${(X.idx + 1) / n * 100}%"></i></div>${onlyBar}
    <div class="body qbody ${dir ? 'in-' + dir : ''}"><div class="qa"><div class="chip">${esc(typeChip(q))}</div><div class="q">${esc(q.q)}</div>${media(q, X.imgs)}</div><div class="qb">${body}<div class="save" id="save" style="margin-top:auto"></div></div></div>
    <div class="foot"><button class="btn gh" data-a="prev" ${prevOff ? 'disabled' : ''}>이전</button><button class="btn gh" data-a="qlist">문항 목록</button>${nextBtn}</div></div>`;
  paintSave(); tick(); fitQ();
  document.querySelectorAll('.qbody img').forEach(im => { if (!im.complete) im.addEventListener('load', fitQ, { once: true }); });
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
// "더 풀기"를 누르면 안 푼 문제만 차례로 봅니다(X.only). 다 풀면 1번부터 모든 문제를 다시 보여 줍니다.
// swipe=true: 손으로 밀어서 넘김. 맨 끝·맨 앞에서는 살짝 튕기기만 합니다(제출 창을 띄우거나 제출하지 않음).
function goPrev(swipe) {
  if (!X || X.done) return;
  flushTyping();
  if (X.only) { const b = leftIdx().filter(i => i < X.idx); if (b.length) { X.idx = b[b.length - 1]; renderExam('prev'); } else if (swipe) bump('앞에 안 푼 문제가 없어요'); return; }
  if (X.idx > 0) { X.idx--; renderExam('prev'); } else if (swipe) bump('첫 문제입니다');
}
function goNext(swipe) {
  if (!X || X.done) return;
  flushTyping();
  if (X.only) {
    const rest = leftIdx().filter(i => i !== X.idx);
    if (!rest.length) {
      if (!answered(X.order[X.idx].id)) return swipe ? bump('이 문제가 마지막 안 푼 문제예요') : toast('이 문제가 마지막 안 푼 문제예요.');
      X.only = false; X.idx = 0; renderExam('next'); return toast('모든 문제를 풀었어요. 1번부터 전체를 보여 줍니다.');
    }
    X.idx = rest.find(i => i > X.idx) ?? rest[0]; renderExam('next'); return;
  }
  if (X.idx < X.order.length - 1) { X.idx++; renderExam('next'); } else if (swipe) bump('마지막 문제입니다');
}
function bump(msg) {
  const b = document.querySelector('.qbody');
  if (b) { b.classList.remove('in-next', 'in-prev', 'bump'); void b.offsetWidth; b.classList.add('bump'); }
  toast(msg, 1300);
}
on('prev', () => goPrev(false));
on('next', () => goNext(false));
// 화면을 옆으로 밀기: 왼쪽 → 다음, 오른쪽 → 이전. 글 쓰는 칸·영상·확대 사진 위에서는 넘기지 않습니다.
let swipe = null;
document.addEventListener('touchstart', e => {
  swipe = null;
  if (view !== 'exam' || !X || X.done || e.touches.length !== 1 || !$('guard').hidden || !$('modal').hidden || !$('zoom').hidden) return;
  if (e.target.closest('textarea,input,select,.vid') || !e.target.closest('.qbody')) return;
  const x0 = e.touches[0].clientX; if (x0 < 28 || x0 > innerWidth - 28) return;   // 화면 가장자리는 휴대폰의 '뒤로' 동작과 겹치므로 쓰지 않음
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  const s0 = swipe; swipe = null;
  if (!s0 || view !== 'exam' || !X || X.done) return;
  const c = e.changedTouches[0], dx = c.clientX - s0.x, dy = c.clientY - s0.y;
  if (Date.now() - s0.at > 800 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  if (dx < 0) goNext(true); else goPrev(true);
}, { passive: true });
document.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });
// 문제가 한 화면에 들어가도록 글씨·사진을 조금씩 줄입니다(최소 70%). 그래도 넘치면 그 안에서만 밀어 봅니다.
function fitQ() {
  const b = document.querySelector('.qbody'); if (!b) return;
  let f = 1; b.style.setProperty('--fit', f);
  while (b.scrollHeight > b.clientHeight + 1 && f > 0.72) { f = Math.round((f - 0.04) * 100) / 100; b.style.setProperty('--fit', f); }
}
on('only-off', () => { flushTyping(); X.only = false; renderExam(); });
const answered = id => { const v = X.store.get(id); return v !== undefined && v !== null && v !== ''; };
const leftIdx = () => X.order.map((o, i) => answered(o.id) ? -1 : i).filter(i => i >= 0);
on('qlist', () => {
  flushTyping();
  const left = X.order.filter(o => !answered(o.id)).length;
  modal(`<h2>${left ? `안 푼 문항 ${left}개` : '모든 문항에 답했어요'}</h2>
    <div class="grid">${X.order.map((o, i) => `<button data-a="goto" data-i="${i}" class="${answered(o.id) ? 'on' : ''} ${i === X.idx ? 'cur' : ''}" aria-label="${i + 1}번${answered(o.id) ? '' : ' 안 풂'}">${i + 1}</button>`).join('')}</div>
    <div class="sm">번호를 누르면 그 문항으로 갑니다. 색이 칠해진 번호는 답한 문항입니다.</div>
    <div class="row"><button class="btn gh" data-a="modal-close">돌아가기</button><button class="btn am" data-a="submit">제출</button></div>`);
});
on('goto', el => { X.idx = +el.dataset.i; X.only = false; closeModal(); renderExam(); });
on('submit', async () => {
  const left = X.order.filter(o => !answered(o.id)).length;
  const ok = await confirmBox('제출할까요?', `${left ? `<b>안 푼 문항이 ${left}개</b> 있습니다.\n` : ''}제출하면 다시 고칠 수 없습니다.`, '제출', { cancel: '더 풀기' });
  if (ok && X) return finish(false);
  if (X && !X.done && left) { closeModal(); X.only = true; X.idx = leftIdx()[0]; renderExam(); }   // 더 풀기 → 안 푼 문제 맨 앞으로
});
// auto=true: 시간이 끝났거나 교수가 종료함
async function finish(auto) {
  if (!X || X.done) return;
  X.done = true; flushTyping(); exitFull();
  const { id, path, store } = X;
  // 1) 남은 답을 모두 서버에 넣고  2) 그다음에 제출 표시를 합니다. (제출 표시가 먼저 들어가면 뒤따르는 답이 거절됩니다)
  try { await within(saveTime(), 3000); } catch (e) {}
  const drained = await store.drain(auto ? 7000 : 8000);
  let sent = false;
  if (drained) {
    try { await within(be.update(path, { submittedAt: be.now() }), 8000); sent = true; }
    catch (e) { try { sent = !!(await within(be.get(path + '/submittedAt'), 4000)); } catch (e2) { sent = false; } }   // 이미 제출 처리돼 있으면 성공으로 봅니다
  }
  if (!X) return;
  if (!sent && !auto) { X.done = false; return toast(drained ? '제출하지 못했어요. 잠시 뒤 다시 눌러 주세요.' : '인터넷 연결이 끊겨 제출하지 못했어요. 답은 이 기기에 저장되어 있습니다. 연결을 확인하고 다시 눌러 주세요.', 5000); }
  if (!store.pending()) store.close();
  N = { id, my: { submittedAt: sent ? be.now() : 0, a: store.all() }, auto, unsent: store.pending() > 0 };
  stopExam(); viewDone();
  if (store.pending()) lateSend(store, path, id);
}
// 시간이 끝났는데 못 보낸 답이 있으면, 연결되는 대로 다시 보냅니다 (서버가 받아 주는 여유 시간 안에서)
async function lateSend(store, path, id) {
  for (let i = 0; i < 20 && store.pending(); i++) {
    if (await store.drain(2500)) {
      try { await within(be.update(path, { submittedAt: be.now() }), 5000); } catch (e) {}
      store.close();
      if (view === 'done' && N && N.id === id) { N.unsent = false; N.my.a = store.all(); try { N.my.submittedAt = (await be.get(path + '/submittedAt')) || 0; } catch (e) {} viewDone(); }
      return;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

/* ---------- 부정행위 방지: 이탈 기록 · 복사 차단 ---------- */
function logEv(t) { if (X) be.push(ansPath() + '/ev', { t, at: be.now() }).catch(() => {}); }
const locked = () => !!X && X.locks > X.unlockN;
// 풀이 시간: 문항을 보고 있는 동안만 셉니다 (화면이 가려지거나 벗어난 동안은 세지 않음)
const paused = () => !X || X.away || locked() || !$('guard').hidden;
function addTime() {
  if (!X || !X.curQ || !X.qStart) return;
  const d = (Date.now() - X.qStart) / 1000; X.qStart = Date.now();
  if (d <= 0 || d > 3600) return;
  X.tm[X.curQ] = Math.round(((X.tm[X.curQ] || 0) + d) * 10) / 10; X.tmDirty[X.curQ] = true;
}
function pauseTime() { addTime(); if (X) X.qStart = 0; }
function resumeTime() { if (X && !X.done && !X.qStart && !paused()) X.qStart = Date.now(); }
function saveTime() {
  if (!X) return Promise.resolve();
  addTime();
  const ids = Object.keys(X.tmDirty); if (!ids.length) return Promise.resolve();
  const patch = Object.fromEntries(ids.map(id => ['tm/' + id, Math.min(100000, X.tm[id])])); X.tmDirty = {};
  return be.update(X.path, patch).catch(() => {});
}
function wentAway(t) { if (!X || X.done || X.away) return; pauseTime(); X.away = true; X.awayWhy = t; X.leaves++; if (!locked()) X.leaveWarn++; logEv(t); }
function cameBack() {
  if (!X || X.done || !X.away || X.unpinned) return;
  X.away = false; X.backAt = Date.now(); logEv('back');
  if (locked()) return;   // 잠긴 동안에는 잠금 화면 그대로
  const L = rule('leaveLock', C.CAM_DEF.leaveLock, 0, 20);
  if (L && X.leaveWarn >= L) { X.leaveWarn = 0; X.locks++; logEv('lockout'); return showLock('leave'); }
  showGuard(`<div class="h1">${X.awayWhy === 'unfull' ? '전체 화면이 풀렸습니다' : '시험 화면을 벗어났습니다'}</div><div class="txt">벗어난 횟수와 시각이 기록되었습니다.\n지금까지 <b>${X.leaves}회</b>${L ? `\n${L - X.leaveWarn === 1 ? '한 번 더' : `${L - X.leaveWarn}번 더`} 벗어나면 화면이 잠깁니다.` : ''}</div><button class="btn am" style="flex:none" data-a="guard-ok">시험으로 돌아가기</button>`, 'leave');
}
// kind: 'face'(얼굴이 돌아오면 저절로 걷힘) · 'lock'(교수가 풀어야 함) · ''(그 밖). 잠긴 동안에는 다른 안내로 덮지 않습니다.
function showGuard(html, kind = '') {
  if (X && locked() && kind !== 'lock') return;
  const g = $('guard'); g.innerHTML = `<div style="max-width:420px;display:flex;flex-direction:column;gap:16px;text-align:center">${html}</div>`;
  g.classList.toggle('black', kind === 'face' || kind === 'lock' || kind === 'leave'); g.hidden = false;
  if (X) { X.guardKind = kind; pauseTime(); }
}
function hideGuard() { $('guard').hidden = true; if (X) X.guardKind = ''; }
on('guard-ok', () => { hideGuard(); resumeTime(); if (X && !X.done) enterFull(); });

/* ---------- 시험 중 전체 화면 (안드로이드 웹·PC. 아이폰 사파리는 웹 전체 화면을 지원하지 않음, 앱은 앱이 처리) ---------- */
const FS_OK = !APP && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
let fullOn = false;   // 시험 중 전체 화면이었는지 (풀리면 이탈로 기록)
function enterFull() {
  if (!FS_OK) return;
  const lock = () => { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait'); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
  if (document.fullscreenElement) return lock();
  try { const p = document.documentElement.requestFullscreen({ navigationUI: 'hide' }); if (p && p.then) p.then(lock, () => {}); } catch (e) {}
}
function exitFull() { fullOn = false; try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {} }
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) { fullOn = !!X && !X.done; return; }
  if (!fullOn) return;
  fullOn = false;
  // 다른 앱으로 가서 풀린 것은 "화면을 벗어남"으로 이미 기록됩니다
  setTimeout(() => { if (!X || X.done || document.hidden || X.away || !$('guard').hidden || Date.now() - (X.backAt || 0) < 2500) return; wentAway('unfull'); cameBack(); }, 400);
});
// 잠금이 풀린 뒤 등: 시험 중 화면을 누르면 다시 전체 화면으로
document.addEventListener('pointerdown', () => { if (FS_OK && view === 'notice') return enterFull(); if (FS_OK && view === 'exam' && X && !X.done && !document.fullscreenElement && !locked() && $('guard').hidden) enterFull(); }, true);
// 세로로만: 휴대폰을 가로로 돌리면 "세로로 돌려 주세요"를 띄웁니다(앱은 세로로 고정)
const TOUCH = matchMedia('(pointer:coarse)').matches;
function paintTurn() {
  const t = (screen.orientation && screen.orientation.type) || (Math.abs(window.orientation || 0) === 90 ? 'landscape' : 'portrait');
  document.body.classList.toggle('turn', !APP && TOUCH && Math.min(screen.width, screen.height) < 600 && /landscape/.test(t));   // 휴대폰만(태블릿 제외)
}
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', paintTurn);
window.addEventListener('orientationchange', () => setTimeout(paintTurn, 50));
paintTurn();

/* ---------- 전면 카메라 얼굴 확인 ---------- */
async function camStart() {
  if (!X || X.watch || X.done || X.camStarting) return;
  X.camStarting = true; const mine = X;
  try {
    const w = await startWatch({ onAway: faceAway, onBack: faceBack, yawLimit: rule('camYaw', C.CAM_DEF.camYaw, 5, 90), pitchLimit: rule('camPitch', C.CAM_DEF.camPitch, 5, 90), awayMs: rule('camSec', C.CAM_DEF.camSec, 1, 60) * 1000 });
    if (X !== mine || mine.done) return w.stop();
    X.watch = w;
    if (X.camDown) { X.camDown = false; logEv('camon'); }
  } catch (e) {
    if (X === mine && !X.camFailed) { X.camFailed = true; X.camDown = true; logEv('camfail'); }   // 권한 거부·카메라 없음·감지기를 받지 못함 → 교수 화면에 표시
  } finally { mine.camStarting = false; }
}
function camStop() { if (X && X.watch) { X.watch.stop(); X.watch = null; } }
// 얼굴이 몇 초 넘게 안 보임(또는 고개가 돌아감): 화면을 검게 가리고 경고. 경고가 2회 쌓이면 잠급니다.
// 카메라 경고가 이만큼 쌓이면 화면을 잠급니다. 교수님이 시험 설정에서 정하고(기본 3회), 0이면 잠그지 않고 경고만 합니다.
// 교수님이 시험 설정에서 정한 기준 (정하지 않았으면 기본값)
const rule = (k, def, min, max) => { const v = X && (S.exams[X.id] || {})[k]; return Number.isFinite(v) && v >= min && v <= max ? v : def; };
const lockAt = () => rule('camLock', C.CAM_DEF.camLock, 0, 20);   // 카메라 경고 몇 번에 잠글지 (0: 잠그지 않음)
function faceAway(why) {
  if (!X || X.done || locked()) return;
  X.camWarn++; logEv('face');
  const LOCK_AT = lockAt();
  if (LOCK_AT && X.camWarn >= LOCK_AT) { X.camWarn = 0; X.locks++; logEv('lock'); return showLock(); }
  showGuard(`<div class="h1">${why === 'turn' ? '고개가 돌아가 있습니다' : why === 'tilt' ? '고개를 숙이거나 들고 있습니다' : '얼굴이 보이지 않습니다'}</div><div class="txt">화면을 정면으로 봐 주세요. 얼굴이 다시 보이면 시험 화면이 돌아옵니다.\n<b>경고 ${X.camWarn}회</b> ${LOCK_AT ? `— ${LOCK_AT - X.camWarn === 1 ? '한 번 더' : `${LOCK_AT - X.camWarn}번 더`} 받으면 화면이 잠깁니다.` : '— 경고는 교수님 화면에 기록됩니다.'}</div>`, 'face');
}
function faceBack() { if (X && !X.done && X.guardKind === 'face') { hideGuard(); logEv('faceok'); resumeTime(); } }
function showLock(why = 'face') {
  showGuard(`<div class="h1">화면이 잠겼습니다</div><div class="txt">${why === 'leave' ? `시험 화면을 ${rule('leaveLock', C.CAM_DEF.leaveLock, 0, 20)}번 벗어났습니다.` : `카메라 경고가 ${lockAt() || X.camWarn}회 쌓였습니다.`}\n<b>손을 들고 교수님께 확인받으세요.</b>\n교수님이 풀어 주면 이어서 풀 수 있습니다. 시험 시간은 계속 흐릅니다.</div><div class="sm" style="color:#c9d6cf">잠금 ${X.locks}회</div>`, 'lock');
}
// 기기가 뜨겁거나(앱) 배터리가 모자라면(웹) 카메라를 저절로 끄고, 괜찮아지면 다시 켭니다. "감시 중" 표시는 그대로 둡니다.
async function camPolicy() {
  const m = X && S.exams[X.id];
  if (!X || X.done || !C.camOn(m) || X.camFailed || (N && N.camSkip)) return;
  let off = false;
  if (APP) off = appCall('thermalStatus', 0) >= 3;
  else if (navigator.getBattery) { try { const b = await navigator.getBattery(); off = !b.charging && b.level * 100 < (m.camBatt || 20); } catch (e) {} }
  if (!X || X.done) return;
  if (off && X.watch) { camStop(); X.camDown = true; if (X.guardKind === 'face') { hideGuard(); resumeTime(); } logEv('camoff'); }
  else if (!off && !X.watch && X.camDown) camStart();
}
function otherWindow() {
  flushTyping(); X.done = true; clearInterval(X.tick);
  showGuard('<div class="h1">다른 창에서 시험이 열렸습니다</div><div class="txt">시험은 한 창에서만 볼 수 있습니다. 이 창은 닫아 주세요.</div>');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { flushTyping(); wentAway('leave'); } else { cameBack(); keepAwake(); } });
window.addEventListener('pagehide', () => { flushTyping(); wentAway('leave'); });
// 창이 포커스를 잃음 = 다른 창으로 감. 영상(IFRAME)이나 드롭다운(SELECT)을 누른 것은 이탈이 아닙니다.
// 앱 안에서는 앱이 직접 알려 주므로 쓰지 않습니다(드롭다운 창이 뜰 때 잘못 기록되는 것을 막음).
if (!APP) {
  window.addEventListener('blur', () => setTimeout(() => { const el = document.activeElement; if (el && (el.tagName === 'IFRAME' || el.tagName === 'SELECT')) return; wentAway('leave'); }, 0));
  window.addEventListener('focus', cameBack);
}
// 안드로이드 앱이 알려 주는 일
window.onPureunEvent = t => {
  // 앱 업데이트 알림 (화면 이탈이 아님)
  if (t === 'update-ready') { if (view === 'home') viewHome(); else if (!S.me && $('e-sid')) keepEntry(); return; }
  if (t === 'update-perm') return toast('처음 한 번만: "이 출처 허용"(알 수 없는 앱 설치)을 켠 뒤 돌아와서 다시 "새 버전 설치"를 눌러 주세요.', 9000);
  if (t === 'update-downloading') return toast('새 버전을 내려받는 중이에요… 잠시 뒤 설치 화면이 뜹니다.', 8000);
  if (t === 'update-fail') return toast('업데이트하지 못했어요. 인터넷을 확인하고 다시 눌러 주세요.', 6000);
  if (t === 'back') return cameBack();
  if (t === 'pinned') { if (X && !X.done && X.unpinned) { X.unpinned = false; X.away = true; cameBack(); } return; }
  if (t === 'unpin') {
    if (!X || X.done) return;
    if (!X.unpinned) { X.unpinned = true; X.away = false; wentAway('unpin'); }
    // 다시 고정할 때까지 문제를 가립니다
    return showGuard(`<div class="h1">화면 고정이 풀렸습니다</div><div class="txt">풀린 시각이 기록되었습니다.\n아래 버튼을 누르고 <b>확인</b>을 눌러 화면을 다시 고정해야 시험을 계속할 수 있습니다.</div><button class="btn am" style="flex:none" data-a="repin">화면 고정 다시 켜기</button>`);
  }
  wentAway('leave');
};
on('repin', () => {
  try { APP.startLock(); } catch (e) {}
  if (!X) return;
  // 앱이 "다시 고정됨"을 알려 주지 못해도 스스로 확인해서 가림을 풉니다
  clearInterval(X.pinPoll); let n = 0;
  X.pinPoll = setInterval(() => {
    if (!X || !X.unpinned) return clearInterval(X && X.pinPoll);
    if (appCall('isPinned', false)) { clearInterval(X.pinPoll); window.onPureunEvent('pinned'); }
    else if (++n === 30 && !$('nopin')) {   // 15초가 지나도 고정이 안 되는 기기: 기록을 남기고 계속할 수 있게
      $('guard').firstElementChild.insertAdjacentHTML('beforeend', '<button class="btn gh" style="flex:none" id="nopin" data-a="nopin">고정이 안 돼요 — 고정 없이 계속 (기록됨)</button>');
    }
  }, 500);
});
on('nopin', () => { if (!X) return; clearInterval(X.pinPoll); logEv('nopin'); X.unpinned = false; X.away = false; hideGuard(); resumeTime(); });
for (const ev of ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop'])
  document.addEventListener(ev, e => { if (X) e.preventDefault(); });
document.addEventListener('selectstart', e => { if (X && !e.target.closest?.('textarea,input')) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (!X) return;
  if (e.key === 'PrintScreen' || ((e.ctrlKey || e.metaKey) && /^[cvxapsu]$/i.test(e.key) && !(e.target.closest?.('textarea') && /^a$/i.test(e.key)))) e.preventDefault();
});

/* ================= 학생: 마무리 쪽 ================= */
function viewDone() {
  if (cancelPending) { cancelPending = false; view = 'done'; return entryCancelled(); }
  view = 'done'; exitFull();
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
function viewMissed(id) {
  view = 'done'; S.took[id] = false; exitFull();
  const m = S.exams[id] || {};
  app.innerHTML = shell(`<div style="text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center">
    <div class="chip">${esc(m.title || '시험')}</div>
    <div class="h1">이 시험을 보지 않아 결과가 없습니다</div>
    <button class="btn gh" style="flex:none;width:100%" data-a="home">처음으로</button></div>`, true);
}

/* ================= 학생: 결과 보기 · 문제풀이 모드 ================= */
let R = null;
async function openReview(id, mode) {
  try {
    const sid = S.me.sid, my = await be.get(`answers/${id}/${sid}`);
    if (!my || !my.startedAt) return viewMissed(id);   // 시험을 보지 않은 학생은 문제·정답·해설을 볼 수 없음
    const [sheetRec, keyRec, imgs, essay] = await Promise.all([
      be.get('sheets/' + id), be.get('keys/' + id), be.get('images/' + id), be.get(`essay/${id}/${sid}`),
    ]);
    const sheet = C.fixSheet(parse(sheetRec, [])), key = parse(keyRec, {});
    if (!sheet.length) return toast('문제를 불러오지 못했어요.');
    const answers = my.a || {};
    R = { id, mode, sheet, key, imgs: imgs || {}, answers, essay: essay || {}, idx: -1, onlyWrong: false, dir: '' };
    R.score = C.scoreStudent(sheet, key, answers, R.essay);
    view = 'review'; renderReview();
  } catch (e) { toast(/PERMISSION/i.test(String(e.code || e.message)) ? '아직 공개되지 않았어요.' : errText(e)); }
}
const reviewList = () => (R.onlyWrong ? R.sheet.filter(q => R.score.wrong.includes(q.id)) : R.sheet);
function renderReview() {
  const m = S.exams[R.id] || {}, sc = R.score;
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
  const list = reviewList();
  R.idx = Math.max(0, Math.min(R.idx, list.length - 1));
  const q = list[R.idx], k = R.key[q.id] || {}, a = R.answers[q.id], no = R.sheet.indexOf(q) + 1;
  const has = a !== undefined && a !== null && a !== '';
  const p = R.score.per[q.id];
  let body;
  if (C.hasOpts(q.k)) {
    const mineSet = q.k === 'check' ? C.unpackChecks(a) : (has ? [Number(a)] : []), good = q.k === 'check' ? (k.a || []) : [k.a];
    body = (q.k === 'check' ? '<div class="sm">맞는 것을 모두 고르는 문제입니다.</div>' : '') + q.opts.map((t, i) => {
      const mine = mineSet.includes(i), right = good.includes(i);
      return `<button class="opt ${q.k === 'check' ? 'sq' : ''} ${right ? 'right' : mine ? 'wrong' : ''}" disabled><span class="n">${i + 1}</span><span>${esc(t)}</span>${right ? `<span class="tag">정답${mine ? ' · 내 답' : ''}</span>` : mine ? '<span class="tag">내 답</span>' : ''}</button>`;
    }).join('') + (!mineSet.length ? '<div class="box warn">답을 고르지 않았습니다.</div>' : '');
  } else if (q.k === 'short') {
    body = `<div class="box ${p.ok ? 'ok' : 'no'}"><b>내 답 — ${p.ok ? '정답' : '오답'}</b>\n${esc(has ? a : '(답을 쓰지 않았습니다)')}</div><div class="box ok"><b>정답</b>\n${esc((k.answers || []).join(' / '))}</div>`;
  } else {
    body = `<div class="box info"><b>내 답</b>\n${esc(has ? a : '(답을 쓰지 않았습니다)')}</div><div class="box ${p.graded ? 'ok' : 'warn'}"><b>${p.graded ? `받은 점수 ${p.pts} / ${q.pts}점` : '아직 채점 전입니다'}</b></div>`;
  }
  const expl = `${q.k === 'long' && k.model ? `<div class="box ok"><b>모범 답안</b>\n${esc(k.model)}</div>` : ''}${k.why ? `<div class="box ok"><b>${q.k === 'long' ? '채점 기준' : '해설'}</b>\n${esc(k.why)}</div>` : ''}`;
  // 위: 틀린 문항만 | 전체 보기 · 점수   아래: 나가기 · 이전 · 다음 (옆으로 밀어도 넘어감)
  app.innerHTML = `<div class="phone"><div class="bar"><span>${R.onlyWrong ? '틀린 문항' : '해설'} ${R.idx + 1} / ${list.length}</span><button data-a="rv-top">점수</button></div>
    <div class="prog"><i style="width:${(R.idx + 1) / list.length * 100}%"></i></div>
    <div class="rvtabs"><button data-a="rv-wrong" class="${R.onlyWrong ? 'on' : ''}" ${sc.wrong.length ? '' : 'disabled'}>틀린 문항만</button><button data-a="rv-all" class="${R.onlyWrong ? '' : 'on'}">전체 보기</button></div>
    <div class="body qbody rvbody ${R.dir ? 'in-' + R.dir : ''}"><div class="chip">${no}번 · ${esc(typeChip(q))}${k.level ? ` · 난이도 ${esc(k.level)}` : ''}</div><div class="q">${esc(q.q)}</div>${media(q, R.imgs)}${body}${expl}</div>
    <div class="foot"><button class="btn gh" style="flex:0 0 28%" data-a="home">나가기</button><button class="btn gh" data-a="rv-prev" ${R.idx ? '' : 'disabled'}>이전</button><button class="btn" data-a="rv-next" ${R.idx < list.length - 1 ? '' : 'disabled'}>다음</button></div></div>`;
  R.dir = '';
}
function rvMove(d, swipe) {
  if (!R || R.idx < 0) return;
  const n = reviewList().length, to = R.idx + d;
  if (to < 0 || to >= n) return swipe ? bump(d > 0 ? '마지막 문항입니다' : '첫 문항입니다') : undefined;
  R.idx = to; R.dir = d > 0 ? 'next' : 'prev'; renderReview();
}
on('rv-goto', el => { R.onlyWrong = false; R.idx = R.sheet.findIndex(q => q.id === el.dataset.id); renderReview(); });
on('rv-wrong', () => { if (!R.onlyWrong || R.idx < 0) { R.onlyWrong = true; R.idx = 0; } renderReview(); });
on('rv-all', () => {
  if (R.onlyWrong && R.idx >= 0) { const q = reviewList()[R.idx]; R.onlyWrong = false; R.idx = Math.max(0, R.sheet.indexOf(q)); }   // 보던 문항 그대로
  else if (R.idx < 0) { R.onlyWrong = false; R.idx = 0; }
  renderReview();
});
on('rv-top', () => { R.idx = -1; renderReview(); });
on('rv-prev', () => rvMove(-1, false));
on('rv-next', () => rvMove(1, false));

boot();
