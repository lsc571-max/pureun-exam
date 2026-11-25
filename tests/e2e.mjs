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
const watchdog = setTimeout(() => { console.error(`\n시간 초과 — 멈춘 단계: ${step}`); process.exit(1); }, 420000);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
await ctx.addInitScript(() => { window.__cdMs = 80; });   // 5·4·3·2·1 을 테스트에서는 빠르게
const errors = [];
const watch = (pg, name) => { pg.on('pageerror', e => errors.push(`${name}: ${e.message}`)); pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); }); };
// 교수 화면의 "잠금 해제"를 누르고 학생 화면이 풀릴 때까지 기다립니다(누르는 순간 표가 다시 그려지면 한 번 더 누름)
async function unlockAndWait(prof, stu, sid) {
  for (let i = 0; i < 6; i++) {
    const b = prof.locator(`[data-a="unlock"][data-sid="${sid}"]`);
    if (await b.count()) await b.click().catch(() => {});
    try { await stu.waitForFunction(() => document.getElementById('guard').hidden, null, { timeout: 1500 }); return; } catch (e) {}
  }
  throw new Error('잠금을 풀지 못함');
}
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const db = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '{}'));
const act = (pg, a, extra = '') => pg.click(`[data-a="${a}"]${extra}`);
const key = (pg, k) => pg.keyboard.press(k);
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
  // 이 테스트의 문항 묶음은 합계 23점이므로 배점 목표를 23점으로 둡니다(기본은 100점)
  await prof.evaluate(() => import('./state.js').then(async m => { const ex = await m.be.get('exams'); await m.be.update('exams/' + Object.keys(ex)[0], { ptsTarget: 23 }); }));

  say('잘못된 붙여 넣기는 알려 준다');
  await act(prof, 'ed-paste');
  await prof.fill('#p-text', '이건 JSON이 아님'); await act(prof, 'p-check');
  await prof.waitForSelector('#p-out .box.no');

  say('문항 묶음 붙여 넣기 (유형 5가지)');
  await prof.fill('#p-text', '```json\n' + JSON.stringify(BUNDLE) + '\n```'); await act(prof, 'p-check');
  assert.match(await prof.textContent('#p-out'), /문제 5개.*배점 합계 23점/s);
  await act(prof, 'p-apply', '[data-m="all"]');
  await prof.waitForSelector('.qrow');
  assert.equal(await prof.locator('#qlist .qrow').count(), 5);
  assert.equal(await prof.locator('.qrow.fixed').count(), 2, '안내·마무리 쪽은 고정 줄로 보여야 함');
  assert.equal(await prof.locator('.qrow.fixed [data-a]').count(), 0, '안내·마무리 쪽은 고치거나 지울 수 없어야 함');
  let d = await db(prof), pg; const exId = Object.keys(d.exams)[0];
  assert.equal(d.exams[exId].n, 5); assert.equal(d.exams[exId].total, 23);
  for (const secret of ['비밀', '사출금형', '"a":', 'answers']) assert.ok(!d.sheets[exId].data.includes(secret), '문제지에 ' + secret + ' 가 들어 있음');
  assert.ok(d.keys[exId].data.includes('비밀해설1')); assert.ok(d.keys[exId].data.includes('사출금형'));

  say('문항 고치기: 배점을 바꾸면 그 문항은 📌고정, 나머지가 합계(목표)에 맞춰 바뀐다');
  const pts0 = (await pages(prof, exId)).map(p => p.pts);
  await row(prof, '둘째 문제').locator('[data-a="ed-edit"]').click();
  await prof.waitForSelector('.edbar [data-a="f-save"]');
  await prof.fill('#f-pts', '6'); await act(prof, 'f-save');
  await prof.waitForFunction(() => /📌 고정/.test(document.getElementById('qlist').textContent));
  pg = await pages(prof, exId);
  assert.equal(pg.reduce((t, p) => t + p.pts, 0), 23, '합계가 목표에 맞지 않음'); assert.equal(pg[1].pts, 6); assert.ok(pg[1].fix);
  assert.match(await prof.textContent('#ed-sum'), /23점/);
  say('합계를 맞출 수 없으면 알려 주고, "맞추기" 버튼이 나온다');
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click(); await prof.fill('#f-pts', '20'); await act(prof, 'f-save');
  await prof.waitForSelector('[data-a="ed-scale"]');
  assert.match(await prof.textContent('#pmain'), /목표 23점과 달라요.*1점씩도/s);
  await prof.click('body', { position: { x: 5, y: 5 } }); await key(prof, 'Control+z');
  await prof.waitForFunction(() => !/ 20점/.test(document.getElementById('qlist').textContent));
  await key(prof, 'Control+z');
  await prof.waitForFunction(() => !/📌/.test(document.getElementById('qlist').textContent));
  assert.deepEqual((await pages(prof, exId)).map(p => p.pts), pts0, '되돌린 뒤 배점이 처음과 다름');

  say('보기는 4칸이 기본이고 "보기 추가"로 늘린다');
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click();
  await prof.waitForSelector('.f-opt');
  assert.equal(await prof.locator('.f-opt').count(), 4);
  await act(prof, 'f-optadd');
  assert.equal(await prof.locator('.f-opt').count(), 5);
  await prof.locator('.f-opt').nth(4).fill('마1');
  await shot(prof, 'p2-editq');
  await act(prof, 'f-save'); await prof.waitForFunction(() => document.getElementById('modal').hidden);
  assert.deepEqual((await pages(prof, exId))[0].opts, ['가1', '나1', '다1', '라1', '마1']);
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click(); await prof.waitForSelector('.f-opt');
  await prof.click('[data-a="f-optdel"][data-j="4"]');
  await act(prof, 'f-save'); await prof.waitForFunction(() => document.getElementById('modal').hidden);
  pg = await pages(prof, exId);
  assert.deepEqual(pg[0].opts, ['가1', '나1', '다1', '라1']); assert.equal(pg[0].a, 2, '보기를 빼도 정답 자리는 그대로');

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
  await prof.evaluate(() => { document.querySelector('.desk').scrollTop = 320; });   // 문항 목록이 화면 안에 오게
  await drag(4, 0, false);   // 서술 문제(5번째)를 첫째 문제 앞으로
  await prof.waitForFunction(() => /서술 문제/.test(document.querySelector('.qrow[data-i="0"]').textContent));
  assert.deepEqual((await pages(prof, exId)).map(p => p.q), ['서술 문제', ...QS.slice(0, 4)]);
  await drag(0, 4, true);    // 다시 맨 뒤로
  await prof.waitForFunction(() => /서술 문제/.test(document.querySelector('.qrow[data-i="4"]').textContent));
  assert.deepEqual((await pages(prof, exId)).map(p => p.q), QS);

  say('오른쪽 버튼 메뉴: 복제 · 지우기 · 되돌리기');
  await row(prof, '넷째 문제').click({ button: 'right' });
  await prof.waitForSelector('#ctx:not([hidden])');
  await shot(prof, 'p3-ctx');
  await prof.click('#ctx [data-a="ed-dup"]');
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 8);
  await prof.click('.qrow[data-i="4"] [data-a="ed-rm"]');   // 복제된 쪽 지우기
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 7);
  await act(prof, 'toast-act');                              // 되돌리기
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 8);
  await prof.click('.qrow[data-i="4"] [data-a="ed-rm"]');
  await prof.waitForFunction(() => document.querySelectorAll('.qrow').length === 7);
  assert.deepEqual((await pages(prof, exId)).map(p => p.q), QS);

  say('문항 편집 되돌리기 · 다시 하기 (Ctrl+Z · Ctrl+Y · 화면 버튼)');
  await prof.click('.qrow[data-i="1"] [data-a="ed-rm"]');            // 둘째 문제 지우기
  await prof.waitForFunction(() => document.querySelectorAll('#qlist .qrow').length === 4);
  await prof.click('body', { position: { x: 5, y: 5 } }); await key(prof, 'Control+z');
  await prof.waitForFunction(() => document.querySelectorAll('#qlist .qrow').length === 5);
  assert.deepEqual((await pages(prof, exId)).map(p => p.q), QS, 'Ctrl+Z 로 지운 문항이 제자리에 돌아오지 않음');
  await key(prof, 'Control+y');
  await prof.waitForFunction(() => document.querySelectorAll('#qlist .qrow').length === 4);
  await act(prof, 'h-undo');                                          // 화면 버튼(스마트폰용)
  await prof.waitForFunction(() => document.querySelectorAll('#qlist .qrow').length === 5);
  assert.deepEqual((await pages(prof, exId)).map(p => p.q), QS);
  assert.ok(await prof.isDisabled('#h-undo') === false && await prof.isDisabled('#h-redo') === false);

  say('고른 문항만 교체');
  await prof.check('.ed-sel[data-i="2"]');
  await act(prof, 'ed-replace');
  await prof.fill('#p-text', JSON.stringify([{ t: 'check', q: '셋째 문제', opts: ['가3', '나3', '다3', '라3'], a: [0, 3], why: '비밀해설3-수정', level: '상', pts: 2 }]));
  await act(prof, 'p-check'); await act(prof, 'p-apply', '[data-m="sel"]');
  await prof.waitForFunction(() => document.getElementById('modal').hidden);
  d = await db(prof); assert.ok(d.keys[exId].data.includes('비밀해설3-수정'));
  await shot(prof, 'p4-edit');

  say('학생 화면으로 보기: 저장하지 않고 학생 모양 그대로 넘겨 본다');
  await act(prof, 'pv-open', ':not([data-i])');
  await prof.waitForSelector('#pvphone');
  assert.match(await prof.textContent('#pvphone'), /시험 안내.*확인했습니다/s);
  await act(prof, 'pv-go', '[data-d="1"]');
  assert.match(await prof.textContent('#pvphone'), /첫째 문제/);
  assert.deepEqual(await prof.locator('#pvphone .opt span:nth-child(2)').allTextContents(), ['가1', '나1', '다1', '라1']);
  await prof.locator('#pvphone .opt', { hasText: '나1' }).click();
  assert.equal(await prof.locator('#pvphone .opt.on').count(), 1);
  await shot(prof, 'p4b-preview');
  for (let i = 0; i < 5; i++) await act(prof, 'pv-go', '[data-d="1"]');
  assert.match(await prof.textContent('#pvphone'), /고생하셨습니다/);
  await act(prof, 'modal-close');
  await row(prof, '둘째 문제').click({ button: 'right' }); await prof.click('#ctx [data-a="pv-open"]');   // 문항 하나만 바로 보기
  await prof.waitForSelector('#pvphone #dd');
  await act(prof, 'modal-close');
  d = await db(prof); assert.ok(!d.answers, '미리 보기에서 누른 답이 저장됨');

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
  assert.ok(!/"t":"intro"|"t":"end"/.test(made), '부탁문 형식에 안내·마무리 쪽이 들어 있음');
  assert.match(made, /기계공작법/); assert.match(made, /모두 13문항 — 객관식 10문항, 장문형 3문항/); assert.match(made, /하 30% · 중 50% · 상 20%/);
  await act(prof, 'modal-close');

  say('검토 부탁문 복사');
  await act(prof, 'cp', '[data-k="review"]');
  assert.match(await prof.textContent('pre.code'), /\/\* 1번 \*\/.*"a":2/s);
  await act(prof, 'modal-close');

  say('시험 설정 기본값: 카메라 켜짐 · 위아래 20 · 좌우 20 · 2초 · 경고 3회 · 앱으로만 켜짐, 문제풀이 공개 칸은 없음');
  await act(prof, 'p-tab', '[data-t="run"]'); await act(prof, 'ex-settings');
  assert.ok(await prof.locator('#s-app.on').count() && await prof.locator('#s-cam.on').count(), '카메라·앱 전용이 기본으로 켜져 있지 않음');
  assert.deepEqual(await Promise.all(['#s-leavelock', '#s-campitch', '#s-camyaw', '#s-camsec', '#s-camlock'].map(x => prof.inputValue(x))), ['2', '20', '20', '2', '3']);
  assert.equal(await prof.locator('.pgrid .pcell').first().locator('#s-leavelock').count(), 1, '화면 벗어남 칸이 각도 줄 맨 앞에 있지 않음');
  assert.equal(await prof.locator('#s-prac').count(), 0, '문제풀이 공개 칸이 남아 있음');
  await act(prof, 's-save');
  await prof.waitForFunction(() => document.getElementById('modal').hidden);
  d = await db(prof); assert.equal(d.exams[Object.keys(d.exams)[0]].appOnly, true);
  const droid = await browser.newContext({ viewport: { width: 412, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  // (다른 브라우저 창이라 가짜 서버 자료를 따로 넣어 줍니다)
  const dp = await droid.newPage(); await dp.goto(BASE + '/?mock=1');
  await dp.evaluate(v => localStorage.setItem('mockdb', v), JSON.stringify({ exams: { x1: { title: '앱 전용', minutes: 5, status: 'running', startAt: Date.now(), endAt: Date.now() + 300000, appOnly: true, n: 1 } } }));
  await dp.reload(); await dp.waitForFunction(() => /이 시험은 앱으로 봅니다/.test(document.body.textContent));
  assert.match(await dp.textContent('#app'), /안드로이드 앱 내려받기/);
  assert.equal(await dp.locator('#e-sid').count(), 0, '앱 전용 시험인데 인터넷 창에서 입장 칸이 보임');   // 여기서 입장하면 학번이 이 창에 묶여 버림
  await droid.close();
  const kakao = await browser.newContext({ viewport: { width: 412, height: 860 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.9.5' });
  const kp = await kakao.newPage(); await kp.goto(BASE + '/?mock=1');
  await kp.waitForFunction(() => /다른 창에서 열어 주세요/.test(document.body.textContent));   // 카카오톡 안의 창에서는 입장하지 않게
  await kakao.close();
  await act(prof, 'ex-settings'); await prof.click('#s-app'); await prof.click('#s-cam');   // 나머지 테스트는 웹으로, 카메라 없이 진행
  assert.equal(await prof.inputValue('#s-leavelock'), '2', '화면 벗어남 잠금 횟수의 기본값이 2가 아님');
  await prof.fill('#s-leavelock', '0'); await act(prof, 's-save');   // 이 학생들은 화면을 벗어나도 잠그지 않음(기록만)
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
  assert.equal(await stu.locator('.bar [data-a="upd"]').count(), 1, '학생 화면에 업데이트 버튼이 없음');

  say('입장 코드: 켜면 코드를 아는 학생만 들어온다');
  await act(prof, 'p-back'); await act(prof, 'people');
  await prof.fill('#code-in', '4821'); await act(prof, 'code-save');
  await prof.waitForFunction(() => /켜짐/.test(document.getElementById('codeBox').textContent));
  const coded = await ctx.newPage(); watch(coded, '코드 학생');
  await coded.goto(BASE + '/?mock=1'); await coded.waitForSelector('#e-code');
  await act(coded, 'cls', '[data-c="A반"]'); await coded.fill('#e-sid', '20261777'); await coded.fill('#e-name', '코드학생');
  await act(coded, 'enter'); await coded.waitForSelector('.box.no');                       // 코드를 안 씀
  await coded.fill('#e-code', '0000'); await act(coded, 'enter');
  await coded.waitForFunction(() => /입장 코드가 틀렸거나/.test(document.body.textContent));
  await coded.fill('#e-code', '4821'); await act(coded, 'enter');
  await coded.waitForSelector('[data-a="open-exam"]');
  await coded.close();
  say('입장 코드는 시험 안 화면 맨 위에도, 어느 탭에서나 보인다');
  await act(prof, 'modal-close'); await act(prof, 'p-open'); await prof.waitForSelector('#phead [data-a="p-back"]');
  assert.match(await prof.textContent('#phead'), /입장 코드 4821/);
  await act(prof, 'p-tab', '[data-t="grade"]'); assert.match(await prof.textContent('#phead'), /입장 코드 4821/);
  await act(prof, 'p-tab', '[data-t="run"]');
  await act(prof, 'p-back'); await act(prof, 'people');
  await act(prof, 'code-off');
  await prof.waitForFunction(() => /꺼짐/.test(document.getElementById('codeBox').textContent));
  await prof.click('#peopleBox tr:has-text("코드학생") [data-a="unbind"]'); await act(prof, 'dlg-yes');   // 나머지 테스트에 영향이 없게 입장 취소
  await prof.waitForFunction(() => !/코드학생/.test(document.getElementById('peopleBox').textContent));
  await act(prof, 'modal-close'); await act(prof, 'p-open');
  await prof.waitForSelector('[data-a="ex-start"]');
  assert.match(await prof.textContent('#phead'), /입장 코드 꺼짐/, '코드를 끄면 회색으로 "입장 코드 꺼짐"이 보여야 함');
  say('입장 코드 표시를 세 번 누르면 바로 바꾸는 창이 뜬다');
  for (let i = 0; i < 2; i++) await prof.click('#phead [data-a="code-tap"]');
  assert.ok(await prof.evaluate(() => document.getElementById('modal').hidden), '두 번만 눌렀는데 창이 뜸');
  await prof.click('#phead [data-a="code-tap"]');
  await prof.waitForSelector('#modal #code-in');
  await prof.fill('#code-in', '303'); await act(prof, 'code-save');
  await prof.waitForFunction(() => /입장 코드 303/.test(document.getElementById('phead').textContent));
  await act(prof, 'code-off'); await act(prof, 'modal-close');
  await prof.waitForFunction(() => /입장 코드 꺼짐/.test(document.getElementById('phead').textContent));

  say('두 번째 기기는 같은 학번으로 못 들어온다');
  const stu2 = await ctx.newPage(); watch(stu2, '학생2');
  await enter(stu2, 'A반', '20261234', '홍길동');
  await stu2.waitForSelector('.box.no');
  assert.match(await stu2.textContent('.box.no'), /다른 기기/);

  say('입장 취소: 학생 화면이 껐다 켜지 않아도 바로 입장 화면으로 돌아가고, 다시 들어올 수 있다');
  await prof.click('#pmain tr:has-text("홍길동") [data-a="unbind"]'); await act(prof, 'dlg-yes');
  await stu.waitForFunction(() => /입장이 취소되었습니다/.test(document.body.textContent) && document.getElementById('e-sid'), null, { timeout: 8000 });
  assert.equal(await stu.inputValue('#e-sid'), '20261234', '입장 취소 뒤 학번을 다시 써야 함'); assert.equal(await stu.inputValue('#e-name'), '홍길동');
  await act(stu, 'cls', '[data-c="A반"]'); await stu.fill('#e-sid', '20261234'); await stu.fill('#e-name', '홍길동'); await act(stu, 'enter');
  await stu.waitForSelector('[data-a="open-exam"]');
  assert.match(await stu.textContent('.who'), /A반 20261234 홍길동/);

  say('안내 쪽: 시작 전에는 버튼이 꺼져 있다');
  await act(stu, 'open-exam');
  await stu.waitForSelector('[data-a="start"]');
  assert.ok(await stu.isDisabled('[data-a="start"]'));
  await act(stu, 'agree');
  assert.ok(await stu.isDisabled('[data-a="start"]'), '교수가 시작하기 전인데 버튼이 켜짐');
  await shot(stu, 's2-notice');

  say('대기실에서 확인을 마치고 기다리면, 교수가 시작할 때 5·4·3·2·1 뒤 모두 함께 시작된다');
  assert.match(await stu.textContent('[data-a="start"]'), /교수님이 시작하면/);
  await act(prof, 'ex-start'); await act(prof, 'dlg-yes');
  await prof.waitForSelector('.cdown');                       // 교수 화면에도 5·4·3·2·1
  await stu.waitForSelector('.cdown');
  await stu.waitForSelector('#clock');
  await prof.waitForSelector('[data-a="ex-end"]');
  assert.match(await prof.textContent('[data-a="ex-end"]'), /강제 종료/);

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
  const tm = (await db(prof)).answers[Object.keys((await db(prof)).exams)[0]]['20261234'].tm || {};
  // (테스트는 문항을 0.1초 만에 넘기기도 하므로 0초도 정상입니다)
  assert.ok(Object.keys(tm).length >= 4 && Object.values(tm).every(v => v >= 0 && v < 60) && Object.values(tm).some(v => v > 0), '문항별 풀이 시간이 기록되지 않음: ' + JSON.stringify(tm));
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

  say('손으로 옆으로 밀어 넘긴다. 맨 끝에서 밀어도 제출되지 않는다');
  const swipeX = (pg, dx) => pg.evaluate(dx => {
    const el = document.querySelector('.qbody .q'), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + 5;
    const mk = (type, cx) => { const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
    mk('touchstart', x); mk('touchend', x + dx);
  }, dx);
  const pos = async pg => (await pg.textContent('.bar span')).trim();
  await act(stu, 'qlist'); await stu.click('.grid button >> nth=0');
  await swipeX(stu, -120); assert.equal(await pos(stu), '2 / 5');
  await swipeX(stu, 120); assert.equal(await pos(stu), '1 / 5');
  await swipeX(stu, 120); assert.equal(await pos(stu), '1 / 5', '첫 문제에서 더 밀었는데 움직임');
  await swipeX(stu, -30); assert.equal(await pos(stu), '1 / 5', '조금만 움직였는데 넘어감');
  await act(stu, 'qlist'); await stu.click('.grid button >> nth=4');
  await swipeX(stu, -120); await stu.waitForTimeout(300);
  assert.equal(await pos(stu), '5 / 5');
  assert.ok(await stu.evaluate(() => document.getElementById('modal').hidden), '마지막에서 밀었더니 창이 뜸');
  assert.ok(!(await db(prof)).answers[exId]['20261234'].submittedAt, '마지막에서 밀었더니 제출됨');
  await goTo(stu, '셋째 문제');

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
  await prof.click('#pmain tr:has-text("홍길동") [data-a="stu-del"]');            // 시험 보는 중인 학생은 지울 수 없음
  await prof.waitForFunction(() => /시험을 보는 중인 학생은 지울 수 없어요/.test(document.getElementById('toast').textContent));
  assert.ok((await db(prof)).answers[exId]['20261234'].startedAt, '시험 중인 학생이 지워짐');
  assert.match(await prof.textContent('#pmain [data-dl]'), /^0[0-5]:\d\d$/, '학생별 남은 시간이 보이지 않음');
  say('시험 중 띠: 다른 탭에서도 진행 상황이 보이고, 누르면 진행 탭으로 간다');
  await act(prof, 'p-tab', '[data-t="edit"]');
  await prof.waitForSelector('#pband:not([hidden])');
  assert.match(await prof.textContent('#pband'), /시험 중.*기본 종료까지.*응시 중 1명.*제출 0명.*이탈 1명.*평균 \d/s);
  await row(prof, '첫째 문제').locator('[data-a="ed-edit"]').click();
  assert.match(await prof.textContent('#modal'), /시험이 진행 중입니다/);   // 시험 중에 고치려 하면 경고
  await act(prof, 'modal-close');
  await shot(prof, 'p6b-band');
  await act(prof, 'p-band');
  await prof.waitForSelector('.donut');
  await shot(prof, 'p6-run');

  say('시간이 끝나면 자동으로 제출된다');
  await act(stu2, 'cls', '[data-c="B반"]'); await stu2.fill('#e-sid', '20261301'); await stu2.fill('#e-name', '김철수'); await act(stu2, 'enter');
  await stu2.waitForSelector('[data-a="open-exam"]'); await act(stu2, 'open-exam');
  await stu2.waitForSelector('[data-a="agree"]');
  assert.ok(!((await db(prof)).answers[exId] || {})['20261301'], '안내 화면에서 벌써 시간이 흐름');   // 확인을 마치고 시작을 눌러야 시간이 흐른다
  await act(stu2, 'agree'); await act(stu2, 'start');
  await stu2.waitForSelector('.cdown');
  await stu2.waitForSelector('#clock');
  // 교수가 시작을 누른 지 한참 뒤에 시작했어도, 이 학생의 5분은 지금부터 흐른다
  assert.match(await stu2.textContent('#clock'), /^(05:00|04:5\d)$/, '늦게 시작한 학생이 시험 시간을 온전히 받지 못함');
  d = await db(prof);
  assert.ok(d.answers[exId]['20261301'].startedAt - d.answers[exId]['20261234'].startedAt > 3000);

  // (먼저 시작한 학생이 제출해도 다른 학생이 아직 풀고 있으므로 시험은 닫히지 않는다)
  say('문항 목록과 제출');
  await act(stu, 'qlist');
  assert.match(await stu.textContent('#modal h2'), /모든 문항/);
  await shot(stu, 's6-list');
  await act(stu, 'submit'); await act(stu, 'dlg-yes');
  await stu.waitForFunction(() => /고생하셨습니다/.test(document.body.textContent));
  assert.ok(!/점수와 해설 보기/.test(await stu.textContent('#app')), '공개 전인데 결과 버튼이 보임');
  await shot(stu, 's7-done');
  d = await db(prof); assert.ok(d.answers[exId]['20261234'].submittedAt > 0);

  assert.equal((await db(prof)).exams[exId].status, 'running', '아직 푸는 학생이 있는데 시험이 닫힘');
  say('교수 화면: 시작 · 기본 종료와, 흐리게 마지막 입장 학생 기준 전체 마감');
  await prof.waitForFunction(() => /시작 .*기본 종료 .*전체 마감 .*김철수/.test(document.getElementById('ptimes').textContent));
  assert.ok(await prof.locator('#ptimes .dim').count(), '전체 마감이 흐리게 표시되지 않음');
  const first = await qText(stu2);
  await answer(stu2, { '첫째 문제': '나1', '둘째 문제': '나2', '셋째 문제': ['가3', '라3'], '넷째 문제': '금형', '서술 문제': '김철수 답' });
  say('"더 풀기" → 안 푼 문제의 맨 앞으로, "다음"은 안 푼 문제만');
  await act(stu2, 'qlist'); await act(stu2, 'submit'); await act(stu2, 'dlg-no');
  await stu2.waitForSelector('.onlyband');
  assert.match(await stu2.textContent('.onlyband'), /4개 남음/);
  const left1 = await qText(stu2); assert.notEqual(left1, first, '푼 문제로 감');
  const seenLeft = [left1];
  for (let i = 0; i < 3; i++) { await act(stu2, 'next'); seenLeft.push(await qText(stu2)); }
  assert.ok(!seenLeft.includes(first) && new Set(seenLeft).size === 4, '안 푼 문제만 돌지 않음: ' + seenLeft.join(','));
  await act(stu2, 'next'); assert.equal(await qText(stu2), left1, '다시 처음 안 푼 문제로 돌아오지 않음');
  await act(stu2, 'only-off'); assert.equal(await stu2.locator('.onlyband').count(), 0);
  // 이 학생의 시간을 곧 끝나게 함 → 이 학생이 끝나면 시작한 학생이 모두 끝났으므로 기본 종료 전이라도 시험이 저절로 닫힘
  await prof.evaluate(id => import('./state.js').then(m => m.be.update('', { [`answers/${id}/20261301/until`]: Date.now() + 1500 })), exId);
  await stu2.waitForFunction(() => /답안이 제출되었습니다/.test(document.body.textContent), null, { timeout: 8000 });
  d = await db(prof);
  assert.ok(d.answers[exId]['20261301'].submittedAt > 0, '자동 제출이 기록되지 않음');
  assert.equal(Object.keys(d.answers[exId]['20261301'].a).length, 1);

  /* ---------- 교수: 종료, 채점, 결과 ---------- */
  say('시작한 학생이 모두 끝나면 기본 종료 전이라도 시험이 저절로 닫히고, 교수 화면에 표시된다');
  await prof.waitForFunction(() => /제출 \d\d:/.test(document.getElementById('pmain').textContent));
  await prof.waitForSelector('[data-a="ex-release"]', { timeout: 20000 });
  assert.equal((await db(prof)).exams[exId].status, 'ended');
  assert.ok((await db(prof)).exams[exId].autoEnd > 0, '모든 학생이 끝나서 닫힌 것이 아님');
  assert.match(await prof.textContent('#pmain'), /모든 학생이 끝나 .*자동으로 종료되었습니다/);

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
  say('학생별 상세: 무엇을 틀렸는지 보고, 그 학생만 PDF로');
  await prof.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await prof.click('[data-a="stu-detail"][data-sid="20261234"]');
  await prof.waitForSelector('.dtab');
  assert.equal(await prof.locator('.dtab tr').count(), 6);                       // 머리글 + 5문항
  const badRow = await prof.locator('.dtab tr.bad', { hasText: '셋째 문제' }).textContent();
  assert.match(badRow, /가3/); assert.match(badRow, /가3, 라3/); assert.match(badRow, /틀림/);   // 학생의 답 · 정답 · 결과
  assert.match(await prof.locator('.dtab tr', { hasText: '넷째 문제' }).textContent(), /사출 금헝.*맞음/s);
  await shot(prof, 'p9b-detail');
  await prof.click('[data-a="d-filter"][data-w="1"]');
  assert.equal(await prof.locator('.dtab tr').count(), 3);                       // 틀린 체크박스 + 감점된 장문형
  await act(prof, 'pdf-one');
  await prof.waitForFunction(() => window.__printed === 1);
  let pr = await prof.textContent('#print');
  assert.match(pr, /개인 결과/); assert.match(pr, /A반 · 20261234 · 홍길동/); assert.match(pr, /18 \/ 23점/); assert.ok(!/김철수/.test(pr), '개인 PDF에 다른 학생이 들어 있음');
  await act(prof, 'modal-close');
  say('전체 결과 PDF · 학생별 결과 PDF');
  await act(prof, 'pdf-all');
  await prof.waitForFunction(() => window.__printed === 2);
  pr = await prof.textContent('#print');
  assert.match(pr, /전체 결과/); assert.match(pr, /홍길동/); assert.match(pr, /김철수/); assert.match(pr, /미응시/); assert.match(pr, /문항별 결과/);
  await act(prof, 'pdf-each');
  await prof.waitForFunction(() => window.__printed === 3);
  assert.equal(await prof.locator('#print .pr-page').count(), 2);                // 응시한 학생마다 한 쪽
  assert.equal(await prof.evaluate(() => getComputedStyle(document.getElementById('print')).display), 'none', '인쇄용 내용이 화면에 보임');
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

  say('입장 취소해도 결과에 이름이 남는다');
  await act(prof, 'p-tab', '[data-t="run"]');
  await prof.click('#pmain tr:has-text("김철수") [data-a="unbind"]'); await act(prof, 'dlg-yes');
  await prof.waitForFunction(() => /입장 취소됨/.test([...document.querySelectorAll('#pmain tr')].find(r => /20261301/.test(r.textContent))?.textContent || ''));
  assert.match(await prof.locator('#pmain tr', { hasText: '20261301' }).textContent(), /김철수/);
  await act(prof, 'p-tab', '[data-t="result"]'); await act(prof, 'r-tab', '[data-t="rank"]');
  assert.match(await prof.locator('#pmain tr', { hasText: '20261301' }).textContent(), /김철수/, '입장 취소한 학생의 이름이 결과에서 사라짐');

  say('학생 지우기: 확인 창 → 휴지통, Ctrl+Z 로 되살리고 Ctrl+Y 로 다시 지움, 휴지통에서 되살리기');
  await prof.click('#pmain tr:has-text("김철수") [data-a="stu-del"]');
  assert.match(await prof.textContent('#modal'), /김철수 학생을 지울까요\?.*휴지통/s);
  await act(prof, 'dlg-yes');
  await prof.waitForFunction(() => !/김철수/.test(document.getElementById('pmain').textContent));
  d = await db(prof);
  assert.ok(!d.answers[exId]['20261301'], '지웠는데 답안이 남아 있음'); assert.ok(Object.values(d.trash[exId]).find(t => t.sid === '20261301').answers.submittedAt > 0, '휴지통에 답안이 없음');
  await prof.click('body', { position: { x: 5, y: 5 } }); await key(prof, 'Control+z');
  await prof.waitForFunction(() => /김철수/.test(document.getElementById('pmain').textContent));
  d = await db(prof); assert.ok(d.answers[exId]['20261301'].submittedAt > 0); assert.ok(!(d.trash && d.trash[exId]), 'Ctrl+Z 뒤에도 휴지통에 남음');
  await key(prof, 'Control+y');
  await prof.waitForFunction(() => !/김철수/.test(document.getElementById('pmain').textContent));
  await act(prof, 'r-tab', '[data-t="trash"]');
  assert.match(await prof.textContent('#pmain'), /20261301.*김철수/s);
  await shot(prof, 'p12-trash');
  await act(prof, 'trash-back');
  await prof.waitForFunction(() => /휴지통이 비어 있습니다/.test(document.getElementById('pmain').textContent));
  d = await db(prof); assert.ok(d.answers[exId]['20261301'].submittedAt > 0, '휴지통에서 되살리지 못함');
  await act(prof, 'r-tab', '[data-t="rank"]');
  assert.match(await prof.textContent('#pmain'), /김철수/);

  say('끝난 시험 다시 열기: 못 본 학생만 응시한다');
  await act(prof, 'p-tab', '[data-t="run"]');
  await act(prof, 'ex-settings'); await prof.click('#s-cam');   // 다시 여는 시험은 카메라 얼굴 확인을 켬
  await prof.fill('#s-leavelock', '2'); await prof.fill('#s-camyaw', '35'); await prof.fill('#s-camsec', '2');
  assert.equal(await prof.inputValue('#s-camlock'), '3', '잠그는 경고 횟수의 기본값이 3이 아님');
  await prof.fill('#s-camlock', '3'); await act(prof, 's-save');
  assert.equal((await db(prof)).exams[exId].camLock, 3);
  { const ex = (await db(prof)).exams[exId]; assert.deepEqual([ex.camYaw, ex.camSec, ex.leaveLock], [35, 2, 2]); }
  await prof.waitForFunction(() => document.getElementById('modal').hidden);
  await act(prof, 'ex-resume');
  await prof.fill('#rs-min', '3'); await act(prof, 'rs-go');
  await prof.waitForSelector('[data-a="ex-end"]');
  d = await db(prof);
  assert.equal(d.exams[exId].status, 'running'); assert.ok(d.exams[exId].endAt > Date.now() + 120000);
  // 늦게 온 학생은 "안드로이드 앱"으로 응시한다고 보고, 앱이 해 주는 일을 흉내 냅니다.
  const late = await ctx.newPage(); watch(late, '늦은 학생(앱)');
  const unlockLate = () => unlockAndWait(prof, late, '20261302');
  await late.addInitScript(() => {
    const st = window.__app = { dnd: false, auto: false, calls: [], hot: 0, face: { face: true, yaw: 0 } };
    window.__fakeFace = () => st.face;   // 카메라와 얼굴 감지기를 대신함
    window.PureunApp = { thermalStatus: () => st.hot, isDndOn: () => st.dnd, canAutoDnd: () => st.auto, requestDndAccess: () => st.calls.push('requestDndAccess'), startLock: () => st.calls.push('startLock'), stopLock: () => st.calls.push('stopLock'), isPinned: () => !!st.pinned, updateAvailable: () => !!st.upd, installUpdate: () => st.calls.push('installUpdate') };
  });
  await enter(late, 'B반', '20261302', '이영희');
  await late.waitForSelector('[data-a="open-exam"]');
  say('앱: 새 앱 버전이 있으면 목록 위에 "새 버전 설치"가 뜨고, 누르면 앱에 설치를 부탁한다');
  await late.evaluate(() => { window.__app.upd = true; window.onPureunEvent('update-ready'); });
  await late.waitForSelector('.btn[data-a="upd"]');
  await late.click('.btn[data-a="upd"]');
  assert.deepEqual(await late.evaluate(() => window.__app.calls), ['installUpdate']);
  assert.equal((await db(prof)).answers[exId]['20261302'], undefined, '업데이트 알림이 이탈로 기록됨');
  await late.evaluate(() => { window.__app.upd = false; window.__app.calls = []; });
  await act(late, 'open-exam');
  await late.waitForSelector('[data-a="agree"]'); await act(late, 'agree');
  say('앱: 방해 금지를 켤 수 없으면 시작 버튼이 눌리지 않는다');
  assert.ok(await late.isDisabled('[data-a="start"]'), '방해 금지가 꺼져 있는데 시작이 됨');
  await act(late, 'dnd');
  assert.deepEqual(await late.evaluate(() => window.__app.calls), ['requestDndAccess']);
  await late.evaluate(() => { window.__app.auto = true; });          // 학생이 허용하고 돌아옴
  await late.waitForFunction(() => /자동으로 켜지고/.test(document.body.textContent), null, { timeout: 5000 });
  assert.ok(await late.isDisabled('[data-a="start"]'), '카메라를 확인하지 않았는데 시작이 됨');
  await act(late, 'cam-test');
  await late.waitForSelector('.campv');                                 // 화면 가득 내 얼굴(테스트에서는 짧게)
  await late.waitForSelector('.campv', { state: 'detached', timeout: 5000 });
  say('앱: 화면을 고정하지 않으면 시험을 시작할 수 없다');
  await late.waitForSelector('[data-a="pin-now"]');
  assert.match(await late.textContent('#app'), /화면을 고정해야 시험을 볼 수 있습니다/);
  assert.ok(await late.isDisabled('[data-a="start"]'), '고정하지 않았는데 시작이 됨');
  await act(late, 'pin-now');                                           // 고정 창이 뜨고, 학생이 "고정 안 함"을 누름
  assert.ok((await late.evaluate(() => window.__app.calls)).includes('startLock'), '고정을 요청하지 않음');
  await late.waitForTimeout(900);
  assert.ok(await late.isDisabled('[data-a="start"]'), '고정을 거절했는데 시작이 됨');
  await late.evaluate(() => { window.__app.pinned = true; });           // 이번에는 "고정"을 누름
  await late.waitForFunction(() => !document.querySelector('[data-a="start"]').disabled, null, { timeout: 5000 });
  assert.match(await late.textContent('#app'), /화면이 고정되었습니다/);
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
  assert.equal((await late.evaluate(() => window.__app.calls)).filter(c => c === 'startLock').length, 3);   // 안내 화면 · 시험 시작 · 다시 고정
  await late.evaluate(() => window.onPureunEvent('pinned'));
  await late.waitForSelector('#guard:not([hidden]) [data-a="guard-ok"]');
  assert.match(await late.textContent('#guard'), /1회.*한 번 더 벗어나면 화면이 잠깁니다/s);
  assert.ok(await late.evaluate(() => document.getElementById('guard').classList.contains('black')), '돌아왔을 때 화면이 검게 가려지지 않음');
  await act(late, 'guard-ok');
  d = await db(prof);
  assert.deepEqual(Object.values(d.answers[exId]['20261302'].ev).map(e => e.t).sort(), ['back', 'unpin']);
  assert.match(d.answers[exId]['20261302'].dev, /^app /);
  say('카메라: 얼굴이 3초 넘게 안 보이면 화면을 가리고 경고, 돌아오면 저절로 풀린다');
  assert.match(await late.textContent('.bar .watch'), /부정행위 감시 중/);
  await late.evaluate(() => { window.__app.face = { face: false, yaw: 0 }; });
  await late.waitForFunction(() => { const g = document.getElementById('guard'); return !g.hidden && g.classList.contains('black') && /얼굴이 보이지 않습니다.*경고 1회/s.test(g.textContent); }, null, { timeout: 8000 });
  await late.evaluate(() => { window.__app.face = { face: true, yaw: 10 }; });
  await late.waitForFunction(() => document.getElementById('guard').hidden, null, { timeout: 4000 });
  say('카메라: 고개를 30도 넘게 돌려 경고 3회가 되면 잠기고, 교수가 풀어 준다');
  await late.evaluate(() => { window.__app.face = { face: true, yaw: 0, pitch: 35 }; });   // 고개를 숙임(위아래)
  await late.waitForFunction(() => { const g = document.getElementById('guard'); return !g.hidden && /고개를 숙이거나 들고 있습니다.*경고 2회.*한 번 더/s.test(g.textContent); }, null, { timeout: 8000 });   // 2회는 경고만
  await late.evaluate(() => { window.__app.face = { face: true, yaw: 0 }; });
  await late.waitForFunction(() => document.getElementById('guard').hidden, null, { timeout: 4000 });
  await late.evaluate(() => { window.__app.face = { face: true, yaw: 45 }; });
  await late.waitForFunction(() => /화면이 잠겼습니다.*교수님께 확인받으세요/s.test(document.getElementById('guard').textContent) && !document.getElementById('guard').hidden, null, { timeout: 8000 });
  await late.evaluate(() => { window.__app.face = { face: true, yaw: 0 }; window.onPureunEvent('leave'); window.onPureunEvent('back'); });
  await late.waitForTimeout(1500);
  assert.match(await late.textContent('#guard'), /화면이 잠겼습니다/, '얼굴이 돌아오거나 앱에 돌아온 것만으로 잠금이 풀림');
  await late.reload(); await late.evaluate(() => { window.__app.pinned = true; }); await late.waitForSelector('[data-a="open-exam"]'); await act(late, 'open-exam');   // 앱을 껐다 켜도 잠금은 그대로
  await late.waitForFunction(() => /화면이 잠겼습니다/.test(document.getElementById('guard').textContent) && !document.getElementById('guard').hidden);
  await prof.waitForSelector('#pband .alarm');
  assert.match(await prof.textContent('#pband'), /잠긴 학생 1명/);
  await shot(late, 's11-lock'); await shot(prof, 'p11-locked');
  await unlockLate();
  d = await db(prof);
  const lateEv = Object.values(d.answers[exId]['20261302'].ev).map(e => e.t);
  assert.equal(lateEv.filter(t => t === 'face').length, 3); assert.equal(lateEv.filter(t => t === 'lock').length, 1); assert.ok(lateEv.includes('faceok'));
  assert.equal(d.answers[exId]['20261302'].unlock, 1);
  assert.match(await prof.locator('#pmain tr', { hasText: '이영희' }).textContent(), /3회.*1회/s);   // 카메라 경고 3회 · 잠금 1회
  say('화면 벗어남: 1회는 경고, 2회째에 잠기고 교수가 풀어 준다 (잠금을 푼 뒤 다시 셈)');
  await late.evaluate(() => { window.onPureunEvent('leave'); window.onPureunEvent('back'); });
  await late.waitForFunction(() => /한 번 더 벗어나면/.test(document.getElementById('guard').textContent) && !document.getElementById('guard').hidden);
  await act(late, 'guard-ok');
  await late.evaluate(() => { window.onPureunEvent('leave'); window.onPureunEvent('back'); });
  await late.waitForFunction(() => /화면이 잠겼습니다.*시험 화면을 2번 벗어났습니다/s.test(document.getElementById('guard').textContent) && !document.getElementById('guard').hidden);
  await shot(late, 's12-lockout');
  await prof.waitForSelector('#pband .alarm');   // 교수 화면에 잠김이 보인 뒤에 풂
  await unlockLate();
  assert.ok(Object.values((await db(prof)).answers[exId]['20261302'].ev).some(e => e.t === 'lockout'));
  say('카메라: 기기가 뜨거워지면 저절로 꺼지고, "감시 중" 표시는 남는다');
  await late.evaluate(() => { window.__app.hot = 3; });
  await late.waitForFunction(id => Object.values(JSON.parse(localStorage.getItem('mockdb')).answers[id]['20261302'].ev).some(x => x.t === 'camoff'), exId, { timeout: 30000 });   // 발열 확인은 20초마다
  await late.evaluate(() => { window.__app.face = { face: false, yaw: 0 }; });
  await late.waitForTimeout(4500);
  assert.ok(await late.isHidden('#guard'), '카메라가 꺼졌는데 화면이 가려짐: ' + (await late.textContent('#guard')) + ' / ' + JSON.stringify(Object.values((await db(prof)).answers[exId]['20261302'].ev).map(e => e.t)));
  assert.match(await late.textContent('.bar .watch'), /부정행위 감시 중/);
  await prof.waitForFunction(() => /카메라 꺼짐/.test([...document.querySelectorAll('#pmain tr')].find(r => /이영희/.test(r.textContent))?.textContent || ''));
  say('앱: 시험 중 고정이 풀리면 바로 가려지고, 고정이 안 되는 폰은 교수가 "고정 면제"를 눌러 이어서 풀게 한다');
  await late.evaluate(() => { window.__app.pinned = false; });
  await late.waitForSelector('#guard:not([hidden]) [data-a="repin"]', { timeout: 5000 });
  assert.match(await late.textContent('#guard'), /교수님께 말씀하세요/);
  assert.equal(await late.locator('[data-a="nopin"]').count(), 0, '학생이 혼자 고정 없이 넘어가는 버튼이 남아 있음');
  await prof.click('[data-a="pinfree"][data-sid="20261302"]'); await act(prof, 'dlg-yes');
  await late.waitForFunction(() => document.getElementById('guard').hidden, null, { timeout: 5000 });
  await prof.waitForSelector('[data-a="pinfree"][data-sid="20261302"][data-v="0"]');
  await late.waitForTimeout(1200);
  assert.ok(await late.isHidden('#guard'), '고정 면제 뒤에도 다시 가려짐');
  assert.ok(Object.values((await db(prof)).answers[exId]['20261302'].ev).some(e => e.t === 'nopin'), '고정 면제가 기록되지 않음');
  await stu.reload(); await stu.waitForSelector('[data-a="open-exam"]'); await act(stu, 'open-exam');
  await stu.waitForFunction(() => /답안이 제출되었습니다/.test(document.body.textContent)); // 제출한 학생은 다시 못 풂
  await act(prof, 'ex-end'); await act(prof, 'dlg-yes'); await prof.waitForSelector('[data-a="ex-release"]');
  // "시험 종료"를 누르면 남은 시간이 0이 되어, 응시 중이던 학생의 답안이 자동 제출된 뒤 시험이 닫힙니다
  await late.waitForFunction(() => /답안이 제출되었습니다/.test(document.body.textContent), null, { timeout: 15000 });
  assert.ok((await db(prof)).answers[exId]['20261302'].submittedAt > 0, '교수가 종료했을 때 응시 중이던 학생이 제출 처리되지 않음');
  assert.ok((await late.evaluate(() => window.__app.calls)).includes('stopLock'), '시험이 끝났는데 화면 고정·방해 금지를 풀지 않음');
  await late.close();
  await prof.waitForSelector('[data-a="ex-release"]', { timeout: 20000 });
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
  assert.equal(await stu.locator('.foot [data-a="home"]').count(), 1, '해설 화면에 나가기가 없음');
  assert.equal(await stu.locator('.rvtabs [data-a="rv-wrong"]').count(), 1, '해설 화면 위에 틀린 문항만 탭이 없음');
  const shortPage = await stu.textContent('#app');
  assert.match(shortPage, /넷째 문제/); assert.match(shortPage, /내 답 — 정답/); assert.match(shortPage, /사출금형/);

  say('시험을 보지 않은 학생은 결과가 공개돼도 "미응시"이고 문제를 볼 수 없다');
  await act(prof, 'p-tab', '[data-t="run"]');
  await act(stu, 'home');
  const nob = await ctx.newPage(); watch(nob, '미응시 학생');
  await enter(nob, 'B반', '20261999', '안본학생');
  await nob.waitForFunction(() => /미응시/.test(document.body.textContent));
  await act(nob, 'open-exam');
  await nob.waitForFunction(() => /이 시험을 보지 않아 결과가 없습니다/.test(document.body.textContent));
  assert.ok(!/첫째 문제|비밀해설/.test(await nob.textContent('#app')), '안 본 학생에게 문제가 보임');
  assert.equal(await nob.locator('[data-a="open-practice"]').count(), 0);
  await nob.close();

  say('시험 복사: 문항만 복사되고 답안은 복사되지 않는다');
  await act(prof, 'ex-copy'); await act(prof, 'dlg-yes');
  await prof.waitForFunction(() => /\(재시험\)/.test(document.getElementById('phead').textContent));
  assert.equal(await prof.locator('#qlist .qrow').count(), 5);
  d = await db(prof);
  const copyId = Object.keys(d.exams).find(k => k !== exId);
  assert.equal(d.exams[copyId].status, 'draft'); assert.equal(d.exams[copyId].n, 5);
  assert.equal(d.sheets[copyId].data, d.sheets[exId].data); assert.equal(d.keys[copyId].data, d.keys[exId].data);
  assert.ok(!(d.answers && d.answers[copyId]), '답안까지 복사됨');
  assert.ok(Object.keys(d.answers[exId]).length >= 2, '원래 시험의 답안이 사라짐');

  say('학생으로 테스트: 새 탭에 테스트 학생이 따로 로그인하고, 교수 로그인은 그대로');
  const [tp] = await Promise.all([ctx.waitForEvent('page'), act(prof, 'test-open')]);
  watch(tp, '테스트 학생'); await tp.waitForSelector('#e-sid');
  assert.match(await tp.textContent('.testband'), /테스트 학생/);
  const tsid = await tp.inputValue('#e-sid'); assert.match(tsid, /^TEST\d+$/);
  await act(tp, 'cls', '[data-c="A반"]'); await act(tp, 'enter');
  await tp.waitForSelector('[data-a="open-exam"], .card, .box.info');
  assert.match(await prof.textContent('#phead'), /재시험/, '테스트 탭을 연 뒤 교수 화면이 풀림');
  await tp.close();

  say('"푸른시험"(시험 이름)을 5번 누르면 교수 ↔ 테스트 학생 화면이 번갈아 바뀐다');
  for (let i = 0; i < 5; i++) await prof.click('#phead h1[data-a="brand"]');
  await prof.waitForSelector('#e-sid');
  const mySid = await prof.inputValue('#e-sid');
  await act(prof, 'cls', '[data-c="B반"]'); await act(prof, 'enter');
  await prof.waitForSelector('.bar [data-a="brand"]');
  for (let i = 0; i < 5; i++) await prof.click('.bar [data-a="brand"]');
  await prof.waitForSelector('[data-a="new-exam"]');                 // 교수 화면 (로그인 유지)
  for (let i = 0; i < 5; i++) await prof.click('header h1[data-a="brand"]');
  await prof.waitForSelector('.bar [data-a="brand"]');               // 같은 테스트 학생으로 돌아옴(입장 화면이 아님)
  assert.match(await prof.textContent('.who'), new RegExp(mySid));
  for (let i = 0; i < 5; i++) await prof.click('.bar [data-a="brand"]');
  await prof.waitForSelector('[data-a="new-exam"]');
  const realStu = await ctx.newPage(); await realStu.goto(BASE + '/?mock=1');   // 어느 기기든 학생 화면의 '푸른시험'을 5번 누르면 교수 로그인 화면(로그인해야 들어감)
  await realStu.evaluate(() => localStorage.removeItem('pureun:prof')); await realStu.reload(); await realStu.waitForSelector('#e-sid');
  assert.equal(await realStu.locator('a[href*="prof"]').count(), 0, '학생 화면에 교수용 링크가 남아 있음');
  for (let i = 0; i < 4; i++) await realStu.click('[data-a="brand"]');
  await realStu.waitForTimeout(300); assert.ok(await realStu.isVisible('#e-sid'), '4번만 눌렀는데 넘어감');
  await realStu.click('[data-a="brand"]');
  await realStu.waitForSelector('[data-a="glogin"]');
  await realStu.close();
  await prof.evaluate(() => localStorage.setItem('pureun:prof', '1'));

  say('테스트 학생 정리 (되돌리기 가능), 실제 학생은 그대로');
  await act(prof, 'people');
  assert.ok(await prof.locator('#peopleBox .pill', { hasText: '테스트' }).count() >= 2);
  await act(prof, 'test-clean'); await act(prof, 'dlg-yes');
  await prof.waitForFunction(() => !/TEST/.test(document.getElementById('peopleBox')?.textContent || 'TEST'), null, { timeout: 5000 });
  d = await db(prof);
  assert.ok(!Object.values(d.users || {}).some(u => /^TEST/.test(u.sid)), '테스트 학생이 남음');
  assert.ok(Object.values(d.users || {}).some(u => u.sid === '20261234'), '실제 학생까지 지워짐');
  await act(prof, 'modal-close');
  await prof.click('body', { position: { x: 5, y: 5 } }); await key(prof, 'Control+z');
  await prof.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('mockdb')).users || {}).some(u => /^TEST/.test(u.sid)));
  await key(prof, 'Control+y');
  await prof.waitForFunction(() => !Object.values(JSON.parse(localStorage.getItem('mockdb')).users || {}).some(u => /^TEST/.test(u.sid)));

  say('교수용과 학생용은 로그인이 따로: 같은 탭에서 학생 주소를 열면 학생 화면, 교수 주소로 돌아오면 교수 로그인 그대로');
  await prof.goto(BASE + '/?mock=1');
  await prof.waitForSelector('#e-sid');                                  // 교수 화면이 아니라 학생 입장 화면
  assert.equal(await prof.locator('[data-a="new-exam"]').count(), 0);
  await prof.goto(BASE + '/?prof=1&mock=1');
  await prof.waitForSelector('[data-a="new-exam"]');                     // 교수 로그인은 그대로

  assert.deepEqual(errors, [], '브라우저 오류');
  console.log('\n화면 테스트 통과');
} catch (e) {
  console.error(`\n실패한 단계: ${step}\n`, e);
  if (SHOTS) for (const [i, pg] of ctx.pages().entries()) await pg.screenshot({ path: path.join(SHOTS, `fail-${i}.png`) }).catch(() => {});
  if (errors.length) console.error('브라우저 오류:', errors);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await browser.close(); server.close(); server.closeAllConnections?.();
}
