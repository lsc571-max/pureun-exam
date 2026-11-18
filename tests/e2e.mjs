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

const BUNDLE = [
  { t: 'intro', title: '모의시험', body: '연습용 시험입니다.' },
  { t: 'choice', q: '첫째 문제', opts: ['가1', '나1', '다1', '라1'], a: 2, why: '비밀해설1', level: '중', pts: 4 },
  { t: 'choice', q: '둘째 문제', opts: ['가2', '나2', '다2', '라2'], a: 0, why: '비밀해설2', level: '하', pts: 4 },
  { t: 'choice', q: '셋째 문제', opts: ['가3', '나3', '다3', '라3'], a: 3, why: '비밀해설3', level: '상', pts: 2 },
  { t: 'essay', q: '서술 문제', model: '비밀모범답안', why: '비밀채점기준', level: '상', pts: 10 },
  { t: 'end', title: '고생하셨습니다', body: '수고했어요.' },
];
const RIGHT = { '첫째 문제': '다1', '둘째 문제': '가2', '셋째 문제': '라3' };

let step = '';
// 어디선가 멈추면 끝없이 기다리지 않고 실패로 끝냅니다
const watchdog = setTimeout(() => { console.error(`\n시간 초과 — 멈춘 단계: ${step}`); process.exit(1); }, 150000);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
const errors = [];
const watch = (pg, name) => { pg.on('pageerror', e => errors.push(`${name}: ${e.message}`)); pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); }); };
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const db = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('mockdb') || '{}'));
const act = (pg, a, extra = '') => pg.click(`[data-a="${a}"]${extra}`);
const say = s => { step = s; console.log('· ' + s); };

try {
  /* ---------- 교수: 로그인, 명단, 시험 만들기, 붙여 넣기 ---------- */
  const prof = await ctx.newPage(); watch(prof, '교수');
  await prof.setViewportSize({ width: 1100, height: 900 });
  await prof.goto(BASE + '/?prof=1&mock=1');
  say('교수 로그인');
  await act(prof, 'glogin');
  await prof.waitForSelector('[data-a="new-exam"]');

  say('명단이 없으면 반·학번·이름만 입력해 입장한다');
  const free = await ctx.newPage(); watch(free, '명단 없는 학생');
  await free.goto(BASE + '/?mock=1'); await free.waitForSelector('#e-sid');
  await act(free, 'enter'); await free.waitForSelector('.box.no');                       // 반을 안 고름
  await act(free, 'cls', '[data-c="B반"]'); await free.fill('#e-sid', '20269999'); await free.fill('#e-name', '자유입장'); await act(free, 'enter');
  await free.waitForFunction(() => /B반 20269999 자유입장/.test(document.body.textContent));
  await prof.waitForFunction(() => /학생 \(1명\)/.test(document.querySelector('[data-a="roster"]').textContent));
  await free.close();

  say('명단 붙여 넣기');
  await act(prof, 'roster');
  await prof.fill('#r-text', '반\t학번\t이름\nA\t20261234\t홍길동\nB\t20261301\t김철수\nB\t20261302\t이영희');
  await act(prof, 'r-add');
  await prof.waitForFunction(() => document.querySelectorAll('#rosterBox tr').length === 5);
  say('반 추가: 학생 입장 화면에 바로 나타난다');
  await prof.fill('#c-new', ' 1학년  C반 '); await act(prof, 'c-add');
  await prof.waitForFunction(() => /1학년 C반/.test(document.getElementById('clsBox').textContent));
  const peek = await ctx.newPage(); await peek.goto(BASE + '/?mock=1'); await peek.waitForSelector('#e-sid');
  assert.deepEqual(await peek.locator('.seg button').allTextContents(), ['A반', 'B반', '1학년 C반']);
  await peek.fill('#e-sid', '2026'); await prof.click('[data-a="c-del"][data-c="1학년 C반"]');
  await peek.waitForFunction(() => document.querySelectorAll('.seg button').length === 2);
  assert.equal(await peek.inputValue('#e-sid'), '2026', '반 목록이 바뀔 때 입력하던 학번이 지워짐');
  await peek.close();
  await shot(prof, 'p1-roster');
  await act(prof, 'modal-close');

  say('시험 만들기');
  await prof.fill('#n-title', '모의시험'); await prof.fill('#n-min', '5');
  await act(prof, 'new-exam');
  await prof.waitForSelector('[data-a="ed-paste"]');

  say('잘못된 붙여 넣기는 알려 준다');
  await act(prof, 'ed-paste');
  await prof.fill('#p-text', '이건 JSON이 아님'); await act(prof, 'p-check');
  await prof.waitForSelector('#p-out .box.no');

  say('문항 묶음 붙여 넣기');
  await prof.fill('#p-text', '```json\n' + JSON.stringify(BUNDLE) + '\n```'); await act(prof, 'p-check');
  assert.match(await prof.textContent('#p-out'), /문제 4개.*배점 합계 20점/s);
  await act(prof, 'p-apply', '[data-m="all"]');
  await prof.waitForSelector('.qrow');
  assert.equal(await prof.locator('.qrow').count(), 6);
  await shot(prof, 'p2-edit');
  let d = await db(prof); const exId = Object.keys(d.exams)[0];
  assert.equal(d.exams[exId].n, 4); assert.equal(d.exams[exId].total, 20);
  for (const secret of ['비밀해설', '비밀모범답안', '비밀채점기준', '"a":']) assert.ok(!d.sheets[exId].data.includes(secret), '문제지에 ' + secret + ' 가 들어 있음');
  assert.ok(d.keys[exId].data.includes('비밀해설1'));

  say('문항 하나 고치기');
  await prof.click('.qrow:nth-child(4) [data-a="ed-edit"]');   // 둘째 문제 (패널 다음이라 nth-child 4)
  await prof.fill('#f-pts', '6'); await act(prof, 'f-save');
  await prof.waitForFunction(() => /22점/.test(document.querySelector('#pmain h2').textContent));
  await prof.click('.qrow:nth-child(4) [data-a="ed-edit"]'); await prof.fill('#f-pts', '4'); await act(prof, 'f-save');
  await prof.waitForFunction(() => /20점/.test(document.querySelector('#pmain h2').textContent));

  say('고른 문항만 교체');
  await prof.check('.ed-sel[data-i="3"]');
  await act(prof, 'ed-replace');
  await prof.fill('#p-text', JSON.stringify([{ t: 'choice', q: '셋째 문제', opts: ['가3', '나3', '다3', '라3'], a: 3, why: '비밀해설3-수정', level: '상', pts: 2 }]));
  await act(prof, 'p-check'); await act(prof, 'p-apply', '[data-m="sel"]');
  await prof.waitForFunction(() => document.getElementById('modal').hidden);
  d = await db(prof); assert.ok(d.keys[exId].data.includes('비밀해설3-수정'));

  say('문제 만들기 부탁문: 유형·난이도별 문항 수를 골라서 만든다');
  await act(prof, 'cp', '[data-k="make"]');
  await prof.fill('#po-subject', '기계공작법');
  await prof.selectOption('.po[data-k="nChoice"]', '10'); await prof.selectOption('.po[data-k="nEssay"]', '3');
  await prof.selectOption('.po[data-k="hi"]', '2'); await prof.selectOption('.po[data-k="mid"]', '7'); await prof.selectOption('.po[data-k="lo"]', '3');
  assert.ok(await prof.isDisabled('[data-a="po-copy"]'), '난이도 합이 안 맞는데 복사가 됨');   // 2+7+3=12, 문항은 13
  await prof.selectOption('.po[data-k="lo"]', '4');
  assert.match(await prof.textContent('#po-sum'), /모두 13문항 · 합계 70점/);
  await act(prof, 'po-copy');
  const made = await prof.textContent('pre.code');
  assert.match(made, /기계공작법/); assert.match(made, /사지선다 10문항, 서술형 3문항/); assert.match(made, /상 2문항 · 중 7문항 · 하 4문항/);
  await act(prof, 'modal-close');

  say('부탁문 복사 버튼');
  await act(prof, 'cp', '[data-k="review"]');
  assert.match(await prof.textContent('pre.code'), /\/\* 2번 \*\/.*"a":2/s);
  await act(prof, 'modal-close');

  say('대기실 열기');
  await act(prof, 'p-tab', '[data-t="run"]');
  await act(prof, 'ex-status', '[data-s="open"]');
  await prof.waitForSelector('[data-a="ex-start"]');

  /* ---------- 학생: 입장 ---------- */
  const stu = await ctx.newPage(); watch(stu, '학생');
  await stu.goto(BASE + '/?mock=1');
  await stu.waitForSelector('#e-sid');
  await shot(stu, 's1-entry');
  say('명단과 다르면 입장 불가');
  await act(stu, 'cls', '[data-c="A반"]'); await stu.fill('#e-sid', '20261234'); await stu.fill('#e-name', '홍길순'); await act(stu, 'enter');
  await stu.waitForSelector('.box.no');
  await act(stu, 'cls', '[data-c="B반"]'); await stu.fill('#e-name', '홍길동'); await act(stu, 'enter');   // 반이 다름
  await stu.waitForSelector('.box.no');
  say('맞으면 입장');
  await act(stu, 'cls', '[data-c="A반"]'); await stu.fill('#e-sid', ' 2026 1234 '); await stu.fill('#e-name', '홍 길동'); await act(stu, 'enter');
  await stu.waitForSelector('[data-a="open-exam"]');
  assert.match(await stu.textContent('.who'), /A반 20261234 홍길동/);

  say('두 번째 기기는 같은 학번으로 못 들어온다');
  const stu2 = await ctx.newPage(); watch(stu2, '학생2');
  await stu2.goto(BASE + '/?mock=1'); await stu2.waitForSelector('#e-sid');
  await act(stu2, 'cls', '[data-c="A반"]'); await stu2.fill('#e-sid', '20261234'); await stu2.fill('#e-name', '홍길동'); await act(stu2, 'enter');
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
  say('문제 풀기 (정답 2개, 오답 1개, 서술형)');
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const q = (await stu.textContent('.q')).trim(); seen.push(q);
    if (i === 0) await shot(stu, 's3-question');
    if (RIGHT[q]) {
      const want = q === '셋째 문제' ? '가3' : RIGHT[q];       // 셋째 문제는 일부러 틀림
      await stu.locator('.opt', { hasText: want }).click();
      await stu.waitForFunction(() => /저장됨/.test(document.getElementById('save').textContent));
    } else {
      await stu.fill('#essay', '서술형 답안입니다');
      await stu.waitForFunction(() => /저장됨/.test(document.getElementById('save').textContent), null, { timeout: 5000 });
      await shot(stu, 's4-essay');
    }
    if (i < 3) await act(stu, 'next');
  }
  assert.deepEqual(seen.slice().sort(), ['둘째 문제', '서술 문제', '셋째 문제', '첫째 문제'], '문제가 빠지거나 겹침');
  d = await db(prof);
  const sheet = JSON.parse(d.sheets[exId].data), idOf = t => sheet.find(q => q.q === t).id;
  let saved = d.answers[exId]['20261234'].a;
  assert.equal(saved[idOf('첫째 문제')], 2, '보기가 섞여도 원래 번호로 저장'); assert.equal(saved[idOf('둘째 문제')], 0); assert.equal(saved[idOf('셋째 문제')], 0);
  assert.equal(saved[idOf('서술 문제')], '서술형 답안입니다');

  say('앱이 꺼졌다 켜져도 이어서 푼다');
  await stu.reload(); await stu.waitForSelector('[data-a="open-exam"]');
  await act(stu, 'open-exam'); await stu.waitForSelector('#clock');   // 안내 쪽을 건너뛰고 바로 이어짐
  assert.equal((await stu.textContent('.q')).trim(), seen[3], '보던 문항으로 돌아오지 않음');
  await act(stu, 'prev');
  const prevQ = (await stu.textContent('.q')).trim();
  if (RIGHT[prevQ]) assert.equal(await stu.locator('.opt.on').count(), 1, '고른 답 표시가 사라짐');

  say('연결이 끊겨도 답이 남고, 다시 연결되면 저장된다');
  await stu.evaluate(() => localStorage.setItem('mockoffline', '1'));
  await act(stu, 'qlist'); await stu.click('.grid button:has-text("1")');
  const q1 = (await stu.textContent('.q')).trim();
  if (RIGHT[q1]) {
    await stu.locator('.opt', { hasText: q1 === '첫째 문제' ? '나1' : q1 === '둘째 문제' ? '나2' : '나3' }).click();
    await stu.waitForFunction(() => /연결 끊김/.test(document.getElementById('save').textContent));
    await stu.evaluate(() => localStorage.removeItem('mockoffline'));
    await stu.locator('.opt', { hasText: q1 === '셋째 문제' ? '가3' : RIGHT[q1] }).click();   // 원래 답으로 되돌림
    await stu.waitForFunction(() => /저장됨/.test(document.getElementById('save').textContent), null, { timeout: 8000 });
  } else await stu.evaluate(() => localStorage.removeItem('mockoffline'));
  d = await db(prof); saved = d.answers[exId]['20261234'].a;
  assert.equal(saved[idOf('첫째 문제')], 2); assert.equal(saved[idOf('셋째 문제')], 0);

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

  say('교수 화면에 응시 현황이 보인다');
  await prof.waitForFunction(() => /응시 중/.test(document.getElementById('pmain').textContent) && /4 \/ 4/.test(document.getElementById('pmain').textContent));
  await prof.waitForSelector('[data-a="lv-show"]');
  await shot(prof, 'p3-run');

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
  const order2 = [(await stu2.textContent('.q')).trim()];
  if (await stu2.locator('.opt').count()) await stu2.locator('.opt').first().click(); else await stu2.fill('#essay', '김철수 답');
  await stu2.waitForFunction(() => /저장됨/.test(document.getElementById('save').textContent), null, { timeout: 5000 });
  for (let i = 1; i < 4; i++) { await act(stu2, 'next'); order2.push((await stu2.textContent('.q')).trim()); }
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

  say('서술형 채점');
  await act(prof, 'p-tab', '[data-t="grade"]');
  await prof.waitForSelector('[data-a="g-set"]');
  assert.match(await prof.textContent('#pmain'), /서술형 답안입니다/);
  assert.ok(!/홍길동/.test(await prof.textContent('#pmain')), '이름 가리기가 안 됨');
  const card = prof.locator('.panel[data-sid]', { hasText: '서술형 답안입니다' });   // 이름이 가려져 있으므로 답안 내용으로 찾음
  await card.locator('[data-a="g-set"][data-v="7"]').click();
  await prof.waitForFunction(() => document.querySelector('.panel[data-sid="20261234"] [data-a="g-set"][data-v="7"]').classList.contains('on'));
  await shot(prof, 'p4-grade');

  say('결과: 순위 · 정답률 · 이탈');
  await act(prof, 'p-tab', '[data-t="result"]');
  await prof.waitForFunction(() => /홍길동/.test(document.getElementById('pmain').textContent));
  const rankRow = await prof.textContent('#pmain table tr:nth-child(2)');
  assert.match(rankRow.replace(/\s+/g, ' '), /1\s*A반\s*20261234\s*홍길동\s*15\s*8\s*7/, '순위표: ' + rankRow);   // 4+4+0 + 서술 7
  assert.equal(await prof.locator('.pill.no', { hasText: '미응시' }).count(), 2);   // 이영희 · 자유입장
  await shot(prof, 'p5-result');
  await act(prof, 'r-tab', '[data-t="q"]'); assert.match(await prof.textContent('#pmain'), /\d+%/);
  await act(prof, 'r-tab', '[data-t="miss"]'); assert.match(await prof.textContent('#pmain'), /셋째 문제/);
  await shot(prof, 'p6-missed');
  await act(prof, 'r-tab', '[data-t="leave"]'); assert.match(await prof.textContent('#pmain'), /홍길동/);
  const [dl] = await Promise.all([prof.waitForEvent('download'), act(prof, 'csv')]);
  const csv = await readFile(await dl.path(), 'utf8');
  assert.match(csv, /순위,반,학번,이름,총점/); assert.match(csv, /1,A반,20261234,홍길동,15,20,8,7,4,2,/); assert.match(csv, /미응시/);

  say('끝난 시험 다시 열기: 못 본 학생만 응시한다');
  await act(prof, 'p-tab', '[data-t="run"]'); await act(prof, 'ex-resume');
  await prof.fill('#rs-min', '3'); await act(prof, 'rs-go');
  await prof.waitForSelector('[data-a="ex-end"]');
  d = await db(prof);
  assert.equal(d.exams[exId].status, 'running'); assert.ok(d.exams[exId].endAt > Date.now() + 120000);
  const late = await ctx.newPage(); watch(late, '늦은 학생');
  await late.goto(BASE + '/?mock=1'); await late.waitForSelector('#e-sid');
  await act(late, 'cls', '[data-c="B반"]'); await late.fill('#e-sid', '20261302'); await late.fill('#e-name', '이영희'); await act(late, 'enter');
  await late.waitForSelector('[data-a="open-exam"]'); await act(late, 'open-exam');
  await late.waitForSelector('[data-a="agree"]'); await act(late, 'agree'); await act(late, 'start');
  await late.waitForSelector('#clock');                                                   // 못 본 학생은 응시 가능
  await stu.reload(); await stu.waitForSelector('[data-a="open-exam"]'); await act(stu, 'open-exam');
  await stu.waitForFunction(() => /답안이 제출되었습니다/.test(document.body.textContent)); // 제출한 학생은 다시 못 풂
  await late.close();
  await act(prof, 'ex-end'); await act(prof, 'dlg-yes'); await prof.waitForSelector('[data-a="ex-release"]');
  await act(prof, 'p-tab', '[data-t="result"]'); await prof.waitForSelector('[data-a="csv"]');

  say('결과 공개 → 학생이 점수와 해설을 본다');
  await act(prof, 'ex-release'); await act(prof, 'dlg-yes');
  await stu.waitForSelector('[data-a="open-result"]');
  await act(stu, 'open-result');
  await stu.waitForSelector('.big');
  assert.match((await stu.textContent('.big')).replace(/\s+/g, ' '), /15 \/ 20점/);
  await shot(stu, 's8-result');
  await act(stu, 'rv-wrong');
  const wrongPage = await stu.textContent('#app');
  assert.match(wrongPage, /셋째 문제/); assert.match(wrongPage, /비밀해설3-수정/); assert.match(wrongPage, /정답/);
  await shot(stu, 's9-explain');
  await act(stu, 'rv-next');
  assert.match(await stu.textContent('#app'), /받은 점수 7 \/ 10점/);

  say('문제풀이 모드: 순서대로, 해설 바로 확인');
  await act(prof, 'p-tab', '[data-t="run"]'); await act(prof, 'ex-settings'); await act(prof, 's-practice'); await act(prof, 's-save'); await act(prof, 'dlg-yes');
  await act(stu, 'rv-top'); await act(stu, 'home');
  await stu.waitForSelector('[data-a="open-practice"]'); await act(stu, 'open-practice');
  await stu.waitForSelector('[data-a="pr-pick"]');
  assert.equal((await stu.textContent('.q')).trim(), '첫째 문제', '문제풀이는 섞지 않음');
  assert.deepEqual(await stu.locator('.opt span:nth-child(2)').allTextContents(), ['가1', '나1', '다1', '라1']);
  assert.ok(!/비밀해설1/.test(await stu.textContent('#app')), '풀기 전인데 해설이 보임');
  await stu.locator('.opt', { hasText: '나1' }).click();
  await stu.waitForSelector('.opt.right');
  assert.match(await stu.textContent('#app'), /비밀해설1/);
  await shot(stu, 's10-practice');

  say('시험 복사: 문항만 복사되고 답안은 복사되지 않는다');
  await act(prof, 'ex-copy'); await act(prof, 'dlg-yes');
  await prof.waitForFunction(() => /\(재시험\)/.test(document.getElementById('phead').textContent));
  assert.equal(await prof.locator('.qrow').count(), 6);
  d = await db(prof);
  const copyId = Object.keys(d.exams).find(k => k !== exId);
  assert.equal(d.exams[copyId].status, 'draft'); assert.equal(d.exams[copyId].n, 4);
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
