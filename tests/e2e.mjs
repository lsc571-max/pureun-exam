// 화면 자동 테스트 — 실제 브라우저에서 교수·학생 흐름 전체를 돌려 봅니다. (실행: npm run test:e2e)
// 서버는 가짜(public/mock.js)를 쓰고, 진짜 보안 규칙은 tests/rules.test.js 가 따로 검사합니다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SHOTS = process.env.SHOTS || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) throw 0;
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// 질문 유형 5가지를 하나씩 담은 시험 (합계 23점)
const BUNDLE = [
  { t: 'intro', title: '모의시험', body: '연습용 시험입니다.' },
  { t: 'choice', q: '첫째 문제', opts: ['가1', '나1', '다1', '라1'], a: 2, why: '비밀해설1', level: '중', pts: 4 },
  { t: 'dropdown', q: '둘째 문제', opts: ['가2', '나2', '다2', '라2'], a: 0, why: '비밀해설2', level: '하', pts: 4 },
  { t: 'check', q: '셋째 문제', opts: ['가3', '나3', '다3', '라3'], a: [0, 3], why: '비밀해설3', level: '상', pts: 2 },
  { t: 'short', q: '넷째 문제', answers: ['사출금형'], why: '비밀해설4', level: '중', pts: 3 },
  { t: 'essay', q: '서술 문제', model: '비밀모범답안', why: '비밀채점기준', level: '상', pts: 10 },
  { t: 'end', title: '고생하셨습니다', body: '수고했어요.' },
];
const QS = ['첫째 문제', '둘째 문제', '셋째 문제', '넷째 문제', '서술 문제'];

let step = '';
// 어디선가 멈추면 끝없이 기다리지 않고 실패로 끝냅니다
const watchdog = setTimeout(() => { console.error(`\n시간 초과 — 멈춘 단계: ${step}`); process.exit(1); }, 170000);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
const errors = [];
const watch = (pg, name) => { pg.on('pageerror', e => errors.push(`${name}: ${e.message}`)); pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); }); };
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const db = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '{}'));
const act = (pg, a, extra = '') => pg.click(`[data-a="${a}"]${extra}`);
const say = s => { step = s; console.log('· ' + s); };
const saved = pg => pg.waitForFunction(() => /저장됨/.test(document.getElementById('save').textContent), null, { timeout: 8000 });
const qText = async pg => (await pg.textContent('.q')).trim();
const setNum = async (pg, sel, v) => { await pg.fill(sel, String(v)); await pg.dispatchEvent(sel, 'change'); };
const pages = async (pg, id) => JSON.parse((await db(pg)).drafts[id].data);
const row = (pg, text) => pg.locator('.qrow', { hasText: text });
// 학생이 지금 보이는 문항에 답합니다. how: 문항별로 고를 답
async function answer(pg, how) {
  const q = await qText(pg), h = how[q];
  if (q === '첫째 문제') await pg.locator('.opt', { hasText: h }).click();
  else if (q === '둘째 문제') await pg.selectOption('#dd', { label: h });
  else if (q === '셋째 문제') for (const t of h) await pg.locator('.opt', { hasText: t }).click();
  else if (q === '넷째 문제') await pg.fill('#short', h);
  else await pg.fill('#essay', h);
  await saved(pg);
  return q;
}
async function enter(pg, cls, sid, name) {
  await pg.goto(BASE + '/?mock=1'); await pg.waitForSelector('#e-sid');
  await act(pg, 'cls', `[data-c="${cls}"]`); await pg.fill('#e-sid', sid); await pg.fill('#e-name', name); await act(pg, 'enter');
}

try {
  /* ---------- 교수: 로그인, 반, 시험 만들기, 붙여 넣기 ---------- */
  const prof = await ctx.newPage(); watch(prof, '교수');
  await prof.setViewportSize({ width: 1100, height: 900 });
  await prof.goto(BASE + '/?prof=1&mock=1');
  say('교수 로그인');
  await act(prof, 'glogin');
  await prof.waitForSelector('[data-a="new-exam"]');

  say('학생은 반·학번·이름만 입력해 입장한다 (명단 없음)');
  const free = await ctx.newPage(); watch(free, '학생(자유입장)');
  await free.goto(BASE + '/?mock=1'); await free.waitForSelector('#e-sid');
  await shot(free, 's1-entry');
  await act(free, 'enter'); await free.waitForSelector('.box.no');                       // 반을 안 고름
  await act(free, 'cls', '[data-c="B반"]'); await free.fill('#e-sid', '12'); await free.fill('#e-name', '자유입장'); await act(free, 'enter');
  await free.waitForSelector('.box.no');                                                 // 학번이 너무 짧음
  await free.fill('#e-sid', '20269999'); await act(free, 'enter');
  await free.waitForFunction(() => /B반 20269999 자유입장/.test(document.body.textContent));
  await prof.waitForFunction(() => /\(1명\)/.test(document.querySelector('[data-a="people"]').textContent));
  await free.close();

  say('반 추가·삭제: 학생 입장 화면에 바로 반영된다');
  await act(prof, 'people');
  await prof.waitForFunction(() => document.querySelectorAll('#peopleBox tr').length === 2);
  await prof.fill('#c-new', ' 1학년  C반 '); await act(prof, 'c-add');
  await prof.waitForFunction(() => /1학년 C반/.test(document.getElementById('clsBox').textContent));
  const peek = await ctx.newPage(); await peek.goto(BASE + '/?mock=1'); await peek.waitForSelector('#e-sid');
  assert.deepEqual(await peek.locator('.seg button').allTextContents(), ['A반', 'B반', '1학년 C반']);
  await peek.fill('#e-sid', '2026'); await prof.click('[data-a="c-del"][data-c="1학년 C반"]');
  await peek.waitForFunction(() => document.querySelectorAll('.seg button').length === 2);
  assert.equal(await peek.inputValue('#e-sid'), '2026', '반 목록이 바뀔 때 입력하던 학번이 지워짐');
  await peek.close();
  await shot(prof, 'p1-people');
  await act(prof, 'modal-close');

  say('시험 만들기');
  await prof.fill('#n-title', '모의시험'); await prof.fill('#n-min', '5');
  await act(prof, 'new-exam');
  await prof.waitForSelector('[data-a="ed-paste"]');

  say('잘못된 붙여 넣기는 알려 준다');
  await act(prof, 'ed-paste');
  await prof.fill('#p-text', '이건 JSON이 아님'); await act(prof, 'p-check');
  await prof.waitForSelector('#p-out .box.no');

  say('문항 묶음 붙여 넣기 (유형 5가지)');
  await prof.fill('#p-text', '```json\n' + JSON.stringify(BUNDLE) + '\n```'); await act(prof, 'p-check');
  assert.match(await prof.textContent('#p-out'), /문제 5개.*배점 합계 23점/s);
  await act(prof, 'p-apply', '[data-m="all"]');
  await prof.waitForSelector('.qrow');
  assert.equal(await prof.locator('.qrow').count(), 7);
  let d = await db(prof); const exId = Object.keys(d.exams)[0];
  assert.equal(d.exams[exId].n, 5); assert.equal(d.exams[exId].total, 23);
  for (const secret of ['비밀', '사출금형', '"a":', 'answers']) assert.ok(!d.sheets[exId].data.includes(secret), '문제지에 ' + secret + ' 가 들어 있음');
  assert.ok(d.keys[exId].data.includes('비밀해설1')); assert.ok(d.keys[exId].data.includes('사출금형'));

  say('문항 고치기: 저장·취소가 맨 위에 있고 배점이 바뀐다');
  await row(prof, '둘째 문제').locator('[data-a="ed-edit"]').click();
  await prof.waitForSelector('.edbar [data-a="f-save"]');
  await prof.fill('#f-pts', '6'); await act(prof, 'f-save');
  await prof.waitForFunction(() => /25점/.test(document.getElementById('ed-sum').textContent));
  await row(prof, '둘째 문제').locator('[data-a="ed-edit"]').click(); await prof.fill('#f-pts', '4'); await act(prof, 'f-save');
  await prof.waitForFunction(() => /23점/.test(document.getElementById('ed-sum').textContent));

  say('보기는 4칸이 기본이고 "보기 추가"로 늘린다');
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click();
  await prof.waitForSelector('.f-opt');
  assert.equal(await prof.locator('.f-opt').count(), 4);
  await act(prof, 'f-optadd');
  assert.equal(await prof.locator('.f-opt').count(), 5);
  await prof.locator('.f-opt').nth(4).fill('마1');
  await shot(prof, 'p2-editq');
  await act(prof, 'f-save'); await prof.waitForFunction(() => document.getElementById('modal').hidden);
  assert.deepEqual((await pages(prof, exId))[1].opts, ['가1', '나1', '다1', '라1', '마1']);
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click(); await prof.waitForSelector('.f-opt');
  await prof.click('[data-a="f-optdel"][data-j="4"]');
  await act(prof, 'f-save'); await prof.waitForFunction(() => document.getElementById('modal').hidden);
  let pg = await pages(prof, exId);
  assert.deepEqual(pg[1].opts, ['가1', '나1', '다1', '라1']); assert.equal(pg[1].a, 2, '보기를 빼도 정답 자리는 그대로');

  say('답하는 방식을 바꾼다 (객관식 → 단답형 → 객관식)');
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click(); await prof.waitForSelector('#f-kind');
  await prof.selectOption('#f-kind', 'short'); await prof.waitForSelector('#f-answers');
  await prof.selectOption('#f-kind', 'choice'); await prof.waitForSelector('.f-opt');
  assert.deepEqual(await prof.locator('.f-opt').evaluateAll(els => els.map(e => e.value)), ['가1', '나1', '다1', '라1'], '방식을 바꿔도 쓰던 보기가 남음');
  assert.equal(await prof.locator('.f-right:checked').getAttribute('value'), '2');
  await act(prof, 'modal-close');

  say('끌어서 순서 바꾸기');
  const grip = async i => { const b = await prof.locator(`[data-grip="${i}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const drag = async (from, toRow, after) => {
    const g = await grip(from), t = await prof.locator(`.qrow[data-i="${toRow}"]`).boundingBox();
    await prof.mouse.move(g.x, g.y); await prof.mouse.down();
    await prof.mouse.move(g.x, (g.y + t.y) / 2, { steps: 4 });
    await prof.mouse.move(g.x, t.y + (after ? t.height - 4 : 4), { steps: 4 });
    await prof.mouse.up();
  };
  await drag(5, 1, false);   // 서술 문제(6번째 쪽)를 첫째 문제 앞으로
  await prof.waitForFunction(() => /서술 문제/.test(document.querySelector('.qrow[data-i="1"]').textContent));
  assert.deepEqual((await pages(prof, exId)).map(p => p.q || p.t), ['intro', '서술 문제', ...QS.slice(0, 4), 'end']);
  await drag(1, 5, true);    // 다시 맨 뒤 문제 자리로
  await prof.waitForFunction(() => /서술 문제/.test(document.querySelector('.qrow[data-i="5"]').textContent));
  assert.deepEqual((await pages(prof, exId)).map(p => p.q || p.t), ['intro', ...QS, 'end']);

  say('오른쪽 버튼 메뉴: 복제 · 지우기 · 되돌리기');
  await row(prof, '넷째 문제').click({ button: 'right' });
  await prof.waitForSelector('#ctx:not([hidden])');
  await shot(prof, 'p3-ctx');
  await prof.click('#ctx [data-a="ed-dup"]');
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 8);
  await prof.click('.qrow[data-i="5"] [data-a="ed-rm"]');   // 복제된 쪽 지우기
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 7);
  await act(prof, 'toast-act');                              // 되돌리기
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 8);
  await prof.click('.qrow[data-i="5"] [data-a="ed-rm"]');
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 7);
  assert.deepEqual((await pages(prof, exId)).map(p => p.q || p.t), ['intro', ...QS, 'end']);

  say('고른 문항만 교체');
  await prof.check('.ed-sel[data-i="3"]');
  await act(prof, 'ed-replace');
  await prof.fill('#p-text', JSON.stringify([{ t: 'check', q: '셋째 문제', opts: ['가3', '나3', '다3', '라3'], a: [0, 3], why: '비밀해설3-수정', level: '상', pts: 2 }]));
  await act(prof, 'p-check'); await act(prof, 'p-apply', '[data-m="sel"]');
  await prof.waitForFunction(() => document.getElementById('modal').hidden);
  d = await db(prof); assert.ok(d.keys[exId].data.includes('비밀해설3-수정'));
  await shot(prof, 'p4-edit');

  say('문제 만들기 부탁문: 객관식·하는 자동, 배점은 합계에 맞춰 자동');
  await act(prof, 'cp', '[data-k="make"]');
  await prof.waitForSelector('#mk-choice');
  assert.equal(await prof.textContent('#mk-choice'), '25'); assert.equal(await prof.textContent('#mk-lo'), '60%');
  assert.match(await prof.textContent('#mk-sum'), /모두 25문항 · 합계 100점.*각 4점/s);
  await prof.fill('#mk-subject', '기계공작법');
  await setNum(prof, '.mk[data-k="n"]', 13); await setNum(prof, '.mk[data-k="nLong"]', 3);
  assert.equal(await prof.textContent('#mk-choice'), '10', '다른 유형을 늘리면 객관식이 줄어듦');
  await setNum(prof, '.mk[data-k="mid"]', 50); await setNum(prof, '.mk[data-k="hi"]', 20);
  assert.equal(await prof.textContent('#mk-lo'), '30%');
  await setNum(prof, '.mk[data-k="mid"]', 90);
  assert.ok(await prof.isDisabled('[data-a="mk-copy"]'), '난이도 합이 100%를 넘는데 복사가 됨');
  await setNum(prof, '.mk[data-k="mid"]', 50);
  assert.match(await prof.textContent('#mk-sum'), /13문항\(객관식 10 · 장문형 3\): 4문항은 7점, 난이도가 높은 9문항은 8점/);
  await setNum(prof, '.mk[data-p="long"]', 10);
  assert.match(await prof.textContent('#mk-sum'), /장문형 3문항: 각 10점.*나머지 10문항\(객관식 10\): 각 7점/s);
  await shot(prof, 'p5-make');
  await act(prof, 'mk-copy');
  const made = await prof.textContent('pre.code');
  assert.match(made, /기계공작법/); assert.match(made, /모두 13문항 — 객관식 10문항, 장문형 3문항/); assert.match(made, /하 30% · 중 50% · 상 20%/);
  await act(prof, 'modal-close');

  say('검토 부탁문 복사');
  await act(prof, 'cp', '[data-k="review"]');
  assert.match(await prof.textContent('pre.code'), /\/\* 2번 \*\/.*"a":2/s);
  await act(prof, 'modal-close');

  say('"안드로이드는 앱으로만 응시" 스위치');
  await act(prof, 'p-tab', '[data-t="run"]'); await act(prof, 'ex-settings'); await prof.click('#s-app'); await act(prof, 's-save');
  await prof.waitForFunction(() => document.getElementById('modal').hidden);
  d = await db(prof); assert.equal(d.exams[Object.keys(d.exams)[0]].appOnly, true);
  const droid = await browser.newContext({ viewport: { width: 412, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  // (다른 브라우저 창이라 가짜 서버 자료를 따로 넣어 줍니다)
  const dp = await droid.newPage(); await dp.goto(BASE + '/?mock=1');
  await dp.evaluate(v => localStorage.setItem('mockdb', v), JSON.stringify({ exams: { x1: { title: '앱 전용', minutes: 5, status: 'running', startAt: Date.now(), endAt: Date.now() + 300000, appOnly: true, n: 1 } } }));
  await dp.reload(); await dp.waitForSelector('#e-sid');
  assert.match(await dp.textContent('#app'), /안드로이드 앱 내려받기/);
  await act(dp, 'cls', '[data-c="A반"]'); await dp.fill('#e-sid', '20260001'); await dp.fill('#e-name', '테스트'); await act(dp, 'enter');
  await dp.waitForSelector('[data-a="open-exam"]'); await act(dp, 'open-exam');
  await dp.waitForSelector('[data-a="agree"]'); await act(dp, 'agree');
  assert.ok(await dp.isDisabled('[data-a="start"]'), '앱 전용 시험인데 안드로이드 웹에서 시작이 됨');
  assert.match(await dp.textContent('#app'), /앱으로만 볼 수 있습니다/);
  await droid.close();
  await act(prof, 'ex-settings'); await prof.click('#s-app'); await act(prof, 's-save');   // 나머지 테스트는 웹으로 진행
  await prof.waitForFunction(() => document.getElementById('modal').hidden);

  say('대기실 열기');
  await act(prof, 'ex-status', '[data-s="open"]');
  await prof.waitForSelector('[data-a="ex-start"]');

  /* ---------- 학생: 입장 ---------- */
  const stu = await ctx.newPage(); watch(stu, '학생');
  say('학생 입장');
  await stu.goto(BASE + '/?mock=1'); await stu.waitForSelector('#e-sid');
  await act(stu, 'cls', '[data-c="A반"]'); await stu.fill('#e-sid', ' 2026 1234 '); await stu.fill('#e-name', '홍 길동'); await act(stu, 'enter');
  await stu.waitForSelector('[data-a="open-exam"]');
  assert.match(await stu.textContent('.who'), /A반 20261234 홍길동/);

  say('두 번째 기기는 같은 학번으로 못 들어온다');
  const stu2 = await ctx.newPage(); watch(stu2, '학생2');
  await enter(stu2, 'A반', '20261234', '홍길동');
  await stu2.waitForSelector('.box.no');
  assert.match(await stu2.textContent('.box.no'), /다른 기기/);

  say('안내 쪽: 시작 전에는 버튼이 꺼져 있다');
  await act(stu, 'open-exam');
  await stu.waitForSelector('[data-a="start"]');
  assert.ok(await stu.isDisabled('[data-a="start"]'));
  await act(stu, 'agree');
  assert.ok(await stu.isDisabled('[data-a="start"]'), '교수가 시작하기 전인데 버튼이 켜짐');
  await shot(stu, 's2-notice');

  say('교수가 시작하면 버튼이 켜진다');
  await act(prof, 'ex-start'); await act(prof, 'dlg-yes');
  await stu.waitForFunction(() => !document.querySelector('[data-a="start"]').disabled);
  await stu.reload(); await stu.waitForSelector('[data-a="open-exam"]');   // 새로 고쳐도 입장 정보가 남는다
  await act(stu, 'open-exam'); await stu.waitForSelector('[data-a="start"]');
  assert.ok(await stu.isDisabled('[data-a="start"]'), '"확인했습니다"를 안 눌렀는데 켜짐');
  await act(stu, 'agree'); await act(stu, 'start');
  await stu.waitForSelector('#clock');

  /* ---------- 학생: 시험 ---------- */
  say('문제 풀기: 객관식 · 드롭다운 · 체크박스 · 단답형 · 장문형');
  const HOW = { '첫째 문제': '다1', '둘째 문제': '가2', '셋째 문제': ['가3'], '넷째 문제': '사출 금헝', '서술 문제': '서술형 답안입니다' };
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const q = await answer(stu, HOW); seen.push(q);
    if (q === '첫째 문제') await shot(stu, 's3-choice');
    if (q === '둘째 문제') await shot(stu, 's3-dropdown');
    if (q === '셋째 문제') await shot(stu, 's3-check');
    if (q === '넷째 문제') await shot(stu, 's3-short');
    if (q === '서술 문제') await shot(stu, 's4-long');
    if (i < 4) await act(stu, 'next');
  }
  assert.deepEqual(seen.slice().sort(), QS.slice().sort(), '문제가 빠지거나 겹침');
  d = await db(prof);
  const sheet = JSON.parse(d.sheets[exId].data), idOf = t => sheet.find(q => q.q === t).id;
  let ans = d.answers[exId]['20261234'].a;
  assert.equal(ans[idOf('첫째 문제')], 2, '보기가 섞여도 원래 번호로 저장'); assert.equal(ans[idOf('둘째 문제')], 0);
  assert.equal(ans[idOf('셋째 문제')], '0'); assert.equal(ans[idOf('넷째 문제')], '사출 금헝'); assert.equal(ans[idOf('서술 문제')], '서술형 답안입니다');

  say('체크박스는 여러 개를 골랐다 뺄 수 있다');
  const goTo = async (pgx, text) => { for (let i = 0; i < 5; i++) { await act(pgx, 'qlist'); await pgx.click(`.grid button >> nth=${i}`); if ((await qText(pgx)) === text) return; } throw new Error(text + ' 문항을 찾지 못함'); };
  await goTo(stu, '셋째 문제');
  assert.equal(await stu.locator('.opt.on').count(), 1, '고른 답 표시가 사라짐');
  await stu.locator('.opt', { hasText: '라3' }).click(); await saved(stu);
  assert.equal((await db(prof)).answers[exId]['20261234'].a[idOf('셋째 문제')], '0,3');
  await stu.locator('.opt', { hasText: '라3' }).click(); await saved(stu);
  assert.equal((await db(prof)).answers[exId]['20261234'].a[idOf('셋째 문제')], '0');   // 일부러 틀리게 둠

  say('앱이 꺼졌다 켜져도 이어서 푼다');
  await stu.reload(); await stu.waitForSelector('[data-a="open-exam"]');
  await act(stu, 'open-exam'); await stu.waitForSelector('#clock');   // 안내 쪽을 건너뛰고 바로 이어짐
  assert.equal(await qText(stu), '셋째 문제', '보던 문항으로 돌아오지 않음');
  await goTo(stu, '둘째 문제'); assert.equal(await stu.inputValue('#dd'), '0', '드롭다운에서 고른 답이 사라짐');
  await goTo(stu, '넷째 문제'); assert.equal(await stu.inputValue('#short'), '사출 금헝');

  say('연결이 끊겨도 답이 남고, 다시 연결되면 저장된다');
  await goTo(stu, '첫째 문제');
  await stu.evaluate(() => localStorage.setItem('mockoffline', '1'));
  await stu.locator('.opt', { hasText: '나1' }).click();
  await stu.waitForFunction(() => /연결 끊김/.test(document.getElementById('save').textContent));
  await stu.evaluate(() => localStorage.removeItem('mockoffline'));
  await stu.locator('.opt', { hasText: '다1' }).click(); await saved(stu);
  assert.equal((await db(prof)).answers[exId]['20261234'].a[idOf('첫째 문제')], 2);

  say('화면을 벗어나면 기록된다');
  await stu.evaluate(() => { window.onPureunEvent('leave'); window.onPureunEvent('back'); });
  await stu.waitForSelector('#guard:not([hidden])');
  assert.match(await stu.textContent('#guard'), /2회/);   // 앞에서 화면을 새로 고친 것(앱을 끈 것)도 1회로 기록됨
  await shot(stu, 's5-leave');
  await act(stu, 'guard-ok');
  d = await db(prof);
  assert.deepEqual(Object.values(d.answers[exId]['20261234'].ev).map(e => e.t).sort(), ['back', 'leave', 'leave']);

  say('복사·붙여 넣기가 막힌다');
  const blocked = await stu.evaluate(() => { const e = new ClipboardEvent('copy', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); const p = new ClipboardEvent('paste', { cancelable: true, bubbles: true }); document.body.dispatchEvent(p); return e.defaultPrevented && p.defaultPrevented; });
  assert.ok(blocked);
  assert.equal(await stu.evaluate(() => getComputedStyle(document.querySelector('.q')).userSelect), 'none');

  say('교수 화면: 응시 현황과 그래프');
  await prof.waitForFunction(() => /응시 중/.test(document.getElementById('pmain').textContent) && /5 \/ 5/.test(document.getElementById('pmain').textContent));
  await prof.waitForSelector('[data-a="lv-show"]');
  await prof.waitForSelector('.donut'); await prof.waitForSelector('.hist');
  await shot(prof, 'p6-run');

  say('문항 목록과 제출');
  await act(stu, 'qlist');
  assert.match(await stu.textContent('#modal h2'), /모든 문항/);
  await shot(stu, 's6-list');
  await act(stu, 'submit'); await act(stu, 'dlg-yes');
  await stu.waitForFunction(() => /고생하셨습니다/.test(document.body.textContent));
  assert.ok(!/점수와 해설 보기/.test(await stu.textContent('#app')), '공개 전인데 결과 버튼이 보임');
  await shot(stu, 's7-done');
  d = await db(prof); assert.ok(d.answers[exId]['20261234'].submittedAt > 0);

  say('시간이 끝나면 자동으로 제출된다');
  await act(stu2, 'cls', '[data-c="B반"]'); await stu2.fill('#e-sid', '20261301'); await stu2.fill('#e-name', '김철수'); await act(stu2, 'enter');
  await stu2.waitForSelector('[data-a="open-exam"]'); await act(stu2, 'open-exam');
  await stu2.waitForSelector('[data-a="agree"]'); await act(stu2, 'agree'); await act(stu2, 'start');
  await stu2.waitForSelector('#clock');
  await answer(stu2, { '첫째 문제': '나1', '둘째 문제': '나2', '셋째 문제': ['가3', '라3'], '넷째 문제': '금형', '서술 문제': '김철수 답' });
  await prof.evaluate(id => import('./state.js').then(m => m.be.update('exams/' + id, { endAt: Date.now() + 1500 })), exId);
  await stu2.waitForFunction(() => /답안이 제출되었습니다/.test(document.body.textContent), null, { timeout: 8000 });
  d = await db(prof);
  assert.ok(d.answers[exId]['20261301'].submittedAt > 0, '자동 제출이 기록되지 않음');
  assert.equal(Object.keys(d.answers[exId]['20261301'].a).length, 1);

  /* ---------- 교수: 종료, 채점, 결과 ---------- */
  say('시험 종료');
  await prof.waitForFunction(() => /제출 \d\d:/.test(document.getElementById('pmain').textContent));
  await act(prof, 'ex-end'); await act(prof, 'dlg-yes');
  await prof.waitForSelector('[data-a="ex-release"]');

  say('단답형: 학생이 쓴 답을 모아 보고 정답으로 인정한다');
  await act(prof, 'p-tab', '[data-t="grade"]');
  await prof.waitForSelector('[data-a="g-accept"]');
  const tr = prof.locator('#pmain tr', { hasText: '사출 금헝' });
  assert.match(await tr.textContent(), /오답/);
  await shot(prof, 'p7-short');
  await tr.locator('[data-a="g-accept"]').click();
  await prof.waitForFunction(() => /정답/.test([...document.querySelectorAll('#pmain tr')].find(r => /사출 금헝/.test(r.textContent)).querySelector('.pill').textContent));
  d = await db(prof); assert.ok(d.keys[exId].data.includes('사출 금헝'), '인정한 답이 정답지에 없음');
  assert.ok(!d.sheets[exId].data.includes('사출'), '인정한 답이 문제지로 새어 나감');

  say('장문형 채점 (이름 가림)');
  await prof.locator('[data-a="g-q"]', { hasText: '장문형' }).click();
  await prof.waitForSelector('[data-a="g-set"]');
  assert.match(await prof.textContent('#pmain'), /서술형 답안입니다/);
  assert.ok(!/홍길동/.test(await prof.textContent('#pmain')), '이름 가리기가 안 됨');
  const card = prof.locator('.panel[data-sid]', { hasText: '서술형 답안입니다' });   // 이름이 가려져 있으므로 답안 내용으로 찾음
  await card.locator('[data-a="g-set"][data-v="7"]').click();
  await prof.waitForFunction(() => document.querySelector('.panel[data-sid="20261234"] [data-a="g-set"][data-v="7"]').classList.contains('on'));
  await shot(prof, 'p8-grade');

  say('결과: 순위 · 그래프 · 많이 틀린 문제 · 이탈 · CSV');
  await act(prof, 'p-tab', '[data-t="result"]');
  await prof.waitForFunction(() => /홍길동/.test(document.getElementById('pmain').textContent));
  const rankRow = await prof.textContent('#pmain table tr:nth-child(2)');
  assert.match(rankRow.replace(/\s+/g, ' '), /1\s*A반\s*20261234\s*홍길동\s*18\s*11\s*7/, '순위표: ' + rankRow);   // 4+4+0+3 + 장문형 7
  assert.equal(await prof.locator('.pill.no', { hasText: '미응시' }).count(), 1);   // 자유입장
  await shot(prof, 'p9-rank');
  await act(prof, 'r-tab', '[data-t="chart"]');
  await prof.waitForSelector('.qchart');
  assert.equal(await prof.locator('.qchart').count(), 5);
  assert.match(await prof.textContent('#pmain'), /정답률 \d+%/);
  assert.match(await prof.locator('.qchart', { hasText: '넷째 문제' }).textContent(), /사출 금헝/);
  assert.ok(await prof.locator('.hbar.good').count() >= 4);
  await shot(prof, 'p10-chart');
  await act(prof, 'r-tab', '[data-t="miss"]'); assert.match(await prof.textContent('#pmain'), /셋째 문제/);
  await act(prof, 'r-tab', '[data-t="leave"]'); assert.match(await prof.textContent('#pmain'), /홍길동/);
  const [dl] = await Promise.all([prof.waitForEvent('download'), act(prof, 'csv')]);
  const csv = await readFile(await dl.path(), 'utf8');
  assert.match(csv, /순위,반,학번,이름,총점/); assert.match(csv, /1,A반,20261234,홍길동,18,23,11,7,5,2,/); assert.match(csv, /미응시/);

  say('끝난 시험 다시 열기: 못 본 학생만 응시한다');
  await act(prof, 'p-tab', '[data-t="run"]'); await act(prof, 'ex-resume');
  await prof.fill('#rs-min', '3'); await act(prof, 'rs-go');
  await prof.waitForSelector('[data-a="ex-end"]');
  d = await db(prof);
  assert.equal(d.exams[exId].status, 'running'); assert.ok(d.exams[exId].endAt > Date.now() + 120000);
  // 늦게 온 학생은 "안드로이드 앱"으로 응시한다고 보고, 앱이 해 주는 일을 흉내 냅니다.
  const late = await ctx.newPage(); watch(late, '늦은 학생(앱)');
  await late.addInitScript(() => {
    const st = window.__app = { dnd: false, auto: false, calls: [] };
    window.PureunApp = { isDndOn: () => st.dnd, canAutoDnd: () => st.auto, requestDndAccess: () => st.calls.push('requestDndAccess'), startLock: () => st.calls.push('startLock'), stopLock: () => st.calls.push('stopLock') };
  });
  await enter(late, 'B반', '20261302', '이영희');
  await late.waitForSelector('[data-a="open-exam"]'); await act(late, 'open-exam');
  await late.waitForSelector('[data-a="agree"]'); await act(late, 'agree');
  say('앱: 방해 금지를 켤 수 없으면 시작 버튼이 눌리지 않는다');
  assert.ok(await late.isDisabled('[data-a="start"]'), '방해 금지가 꺼져 있는데 시작이 됨');
  await act(late, 'dnd');
  assert.deepEqual(await late.evaluate(() => window.__app.calls), ['requestDndAccess']);
  await late.evaluate(() => { window.__app.auto = true; });          // 학생이 허용하고 돌아옴
  await late.waitForFunction(() => !document.querySelector('[data-a="start"]').disabled, null, { timeout: 5000 });
  assert.match(await late.textContent('#app'), /자동으로 켜지고/);
  await act(late, 'start');
  await late.waitForSelector('#clock');                                // 못 본 학생은 응시 가능
  assert.ok((await late.evaluate(() => window.__app.calls)).includes('startLock'), '시험 시작 때 화면 고정을 요청하지 않음');
  say('앱: 화면 고정이 풀리면 기록되고, 다시 고정할 때까지 문제가 가려진다');
  await late.evaluate(() => window.onPureunEvent('unpin'));
  await late.waitForSelector('#guard:not([hidden]) [data-a="repin"]');
  await late.evaluate(() => window.onPureunEvent('back'));             // 앱으로 돌아오기만 해서는 가림이 안 풀림
  assert.ok(await late.isVisible('[data-a="repin"]'));
  await act(late, 'repin');
  assert.equal((await late.evaluate(() => window.__app.calls)).filter(c => c === 'startLock').length, 2);
  await late.evaluate(() => window.onPureunEvent('pinned'));
  await late.waitForSelector('#guard:not([hidden]) [data-a="guard-ok"]');
  assert.match(await late.textContent('#guard'), /1회/);
  await act(late, 'guard-ok');
  d = await db(prof);
  assert.deepEqual(Object.values(d.answers[exId]['20261302'].ev).map(e => e.t).sort(), ['back', 'unpin']);
  assert.match(d.answers[exId]['20261302'].dev, /^app /);
  await stu.reload(); await stu.waitForSelector('[data-a="open-exam"]'); await act(stu, 'open-exam');
  await stu.waitForFunction(() => /답안이 제출되었습니다/.test(document.body.textContent)); // 제출한 학생은 다시 못 풂
  await act(prof, 'ex-end'); await act(prof, 'dlg-yes'); await prof.waitForSelector('[data-a="ex-release"]');
  await late.waitForFunction(() => /시험이 끝났습니다/.test(document.body.textContent));
  assert.ok((await late.evaluate(() => window.__app.calls)).includes('stopLock'), '시험이 끝났는데 화면 고정·방해 금지를 풀지 않음');
  await late.close();
  await act(prof, 'p-tab', '[data-t="result"]'); await prof.waitForSelector('[data-a="csv"]');

  say('결과 공개 → 학생이 점수와 해설을 본다');
  await act(prof, 'ex-release'); await act(prof, 'dlg-yes');
  await stu.waitForSelector('[data-a="open-result"]');
  await act(stu, 'open-result');
  await stu.waitForSelector('.big');
  assert.match((await stu.textContent('.big')).replace(/\s+/g, ' '), /18 \/ 23점/);
  await shot(stu, 's8-result');
  await act(stu, 'rv-wrong');
  const wrongPage = await stu.textContent('#app');
  assert.match(wrongPage, /셋째 문제/); assert.match(wrongPage, /비밀해설3-수정/); assert.match(wrongPage, /정답/);
  assert.equal(await stu.locator('.opt.right').count(), 2, '체크박스의 정답 두 개가 표시되지 않음');
  await shot(stu, 's9-explain');
  await act(stu, 'rv-next');
  assert.match(await stu.textContent('#app'), /받은 점수 7 \/ 10점/);
  await act(stu, 'rv-top'); await act(stu, 'rv-all');
  for (let i = 0; i < 3; i++) await act(stu, 'rv-next');
  const shortPage = await stu.textContent('#app');
  assert.match(shortPage, /넷째 문제/); assert.match(shortPage, /내 답 — 정답/); assert.match(shortPage, /사출금형/);

  say('문제풀이 모드: 순서대로, 해설 바로 확인');
  await act(prof, 'p-tab', '[data-t="run"]'); await act(prof, 'ex-settings'); await act(prof, 's-practice'); await act(prof, 's-save'); await act(prof, 'dlg-yes');
  await act(stu, 'rv-top'); await act(stu, 'home');
  await stu.waitForSelector('[data-a="open-practice"]'); await act(stu, 'open-practice');
  await stu.waitForSelector('[data-a="pr-pick"]');
  assert.equal(await qText(stu), '첫째 문제', '문제풀이는 섞지 않음');
  assert.deepEqual(await stu.locator('.opt span:nth-child(2)').allTextContents(), ['가1', '나1', '다1', '라1']);
  assert.ok(!/비밀해설1/.test(await stu.textContent('#app')), '풀기 전인데 해설이 보임');
  await stu.locator('.opt', { hasText: '나1' }).click();
  await stu.waitForSelector('.opt.right');
  assert.match(await stu.textContent('#app'), /비밀해설1/);
  await shot(stu, 's10-practice');
  await act(stu, 'rv-next'); await act(stu, 'rv-next');   // 셋째(체크박스): 고르고 "정답 확인"
  await stu.locator('.opt', { hasText: '가3' }).click(); await stu.locator('.opt', { hasText: '라3' }).click();
  assert.ok(!/비밀해설3/.test(await stu.textContent('#app')), '확인 전인데 해설이 보임');
  await act(stu, 'pr-show');
  assert.equal(await stu.locator('.opt.right').count(), 2); assert.equal(await stu.locator('.opt.wrong').count(), 0);
  await act(stu, 'rv-next');                               // 넷째(단답형)
  await stu.fill('#pr-text', '사출 금형'); await act(stu, 'pr-show');
  assert.match(await stu.textContent('#app'), /내 답 — 정답/);

  say('시험 복사: 문항만 복사되고 답안은 복사되지 않는다');
  await act(prof, 'ex-copy'); await act(prof, 'dlg-yes');
  await prof.waitForFunction(() => /\(재시험\)/.test(document.getElementById('phead').textContent));
  assert.equal(await prof.locator('.qrow').count(), 7);
  d = await db(prof);
  const copyId = Object.keys(d.exams).find(k => k !== exId);
  assert.equal(d.exams[copyId].status, 'draft'); assert.equal(d.exams[copyId].n, 5);
  assert.equal(d.sheets[copyId].data, d.sheets[exId].data); assert.equal(d.keys[copyId].data, d.keys[exId].data);
  assert.ok(!(d.answers && d.answers[copyId]), '답안까지 복사됨');
  assert.ok(Object.keys(d.answers[exId]).length >= 2, '원래 시험의 답안이 사라짐');

  assert.deepEqual(errors, [], '브라우저 오류');
  console.log('\n화면 테스트 통과');
} catch (e) {
  console.error(`\n실패한 단계: ${step}\n`, e);
  if (errors.length) console.error('브라우저 오류:', errors);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await browser.close(); server.close(); server.closeAllConnections?.();
}
