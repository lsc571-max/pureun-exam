// 채점 · 랜덤 · 문항 분리 · 붙여 넣기 · 배점 배분 자동 테스트  (실행: npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.js';

const RAW = [
  { t: 'intro', title: '중간고사', body: '50분' },
  { t: 'choice', q: 'Q1', opts: ['a', 'b', 'c', 'd'], a: 1, why: 'w1', level: '상', pts: 4 },
  { t: 'dropdown', q: 'Q2', opts: ['e', 'f', 'g', 'h'], a: 0, why: 'w2', level: '중', pts: 4 },
  { t: 'image', q: 'Q3', img: '', opts: ['i', 'j', 'k', 'l'], a: 3, why: 'w3', level: '하', pts: 2 },
  { t: 'check', q: 'Q4', opts: ['m', 'n', 'o', 'p'], a: [2, 0], why: 'w4', level: '중', pts: 4 },
  { t: 'short', q: 'Q5', answers: ['사출금형', '사출 금형', 'Injection Mold', '사출금헝'], why: 'w5', level: '하', pts: 3 },
  { t: 'essay', q: 'Q6', model: '모범', why: '기준', level: '상', pts: 10 },   // 예전 이름 essay → long
  { t: 'end', title: '고생하셨습니다', body: '끝' },
];
let n = 0;
const seq = () => (n++ % 1000) / 1000;
const PAGES = C.ensureIds(RAW.map(C.normalizePage), seq);
const { sheet, key, notice, end } = C.splitExam(PAGES);
const ids = sheet.map(q => q.id);
const [Q1, Q2, Q3, Q4, Q5, Q6] = ids;

test('붙여 넣기: 코드 블록·앞뒤 설명이 있어도 읽는다', () => {
  const j = JSON.stringify(RAW);
  assert.equal(C.parseBundle(j).length, 8);
  assert.equal(C.parseBundle('아래는 문항입니다.\n```json\n' + j + '\n```\n감사합니다').length, 8);
  assert.equal(C.parseBundle('문항: ' + j + ' 끝').length, 8);
  assert.throws(() => C.parseBundle('안녕하세요'), /JSON/);
  assert.throws(() => C.parseBundle('[]'), /하나도/);
});

test('유형: 답하는 방식을 알아본다 (그림·영상 문제, 예전 형식 포함)', () => {
  assert.deepEqual(PAGES.filter(C.isQuestion).map(C.kindOf), ['choice', 'dropdown', 'choice', 'check', 'short', 'long']);
  assert.equal(PAGES[6].t, 'long');
  assert.equal(C.kindOf(C.normalizePage({ t: 'video', q: 'x', video: 'https://youtu.be/dQw4w9WgXcQ', ans: 'short', answers: ['a'] })), 'short');
  assert.equal(C.kindOf(C.normalizePage({ t: 'image', q: 'x', opts: ['a', 'b'], a: [0, 1] })), 'check');
  assert.equal(C.kindOf(C.normalizePage({ t: 'image', q: 'x', model: 'm' })), 'long');
  assert.deepEqual(C.normalizePage({ t: 'check', q: 'x', opts: ['a', 'b', 'c'], a: ['2', 0, 2] }).a, [0, 2]);
  assert.deepEqual(C.normalizePage({ t: 'short', q: 'x', answers: [' 금형 ', '금 형', 'GOLD', 'gold'] }).answers, ['금형', 'GOLD'], '같은 답은 한 번만');
});

test('검사: 유형별 잘못을 잡아낸다', () => {
  assert.equal(C.validateBundle(PAGES).errors.length, 0);
  const bad = C.ensureIds([
    { t: 'choice', q: 'x', opts: ['a', 'b', 'c', 'd'], a: 4, pts: 4 },
    { t: 'choice', q: 'x', opts: ['a', 'b', 'c', 'd'], pts: 4 },
    { t: 'choice', q: '', opts: ['a', '', 'c', 'd'], a: 0, pts: 0 },
    { t: 'dropdown', q: 'x', opts: ['a', 'a', 'c', 'd'], a: 0, pts: 1 },
    { t: 'video', q: 'x', opts: ['a', 'b'], a: 0, pts: 1 },
    { t: 'quiz', q: 'x' },
    { t: 'check', q: 'x', opts: ['a', 'b', 'c'], a: [], pts: 1 },
    { t: 'check', q: 'x', opts: ['a', 'b', 'c'], a: [0, 5], pts: 1 },
    { t: 'short', q: 'x', answers: [], pts: 1 },
    { t: 'choice', q: 'x', opts: ['a'], a: 0, pts: 1 },
  ].map(C.normalizePage));
  const v = C.validateBundle(bad);
  const at = i => v.errors.filter(e => e.i === i).map(e => e.msg).join(' ');
  assert.match(at(0), /정답/); assert.match(at(1), /정답/);
  assert.match(at(2), /문제/); assert.match(at(2), /배점/); assert.match(at(2), /비어 있는 보기/);
  assert.match(at(3), /똑같은 보기/); assert.match(at(4), /영상 주소/); assert.match(at(5), /유형/);
  assert.match(at(6), /체크박스/); assert.match(at(7), /체크박스/); assert.match(at(8), /단답형/); assert.match(at(9), /2개 이상/);
});

test('검사: 문항 수·배점 합계·유형·난이도 집계', () => {
  const s = C.validateBundle(PAGES).stats;
  assert.deepEqual([s.n, s.total], [6, 27]);
  assert.deepEqual(s.byKind, { short: 1, long: 1, choice: 2, check: 1, dropdown: 1 });
  assert.deepEqual(s.byLevel, { 상: 2, 중: 2, 하: 2 });
});

test('문제지에는 정답·인정 답·해설·난이도·모범 답안이 한 글자도 없다', () => {
  const text = JSON.stringify(sheet);
  for (const q of sheet) for (const f of ['a', 'answers', 'why', 'level', 'model']) assert.equal(f in q, false, `${f} 가 문제지에 있음`);
  for (const secret of ['w1', 'w2', 'w3', 'w4', 'w5', '모범', '기준', '사출금형', 'Injection']) assert.equal(text.includes(secret), false, secret);
  assert.equal(sheet.length, 6);
  assert.deepEqual(sheet.map(q => q.k), ['choice', 'dropdown', 'choice', 'check', 'short', 'long']);
  assert.equal(key[Q1].a, 1); assert.deepEqual(key[Q4].a, [0, 2]); assert.equal(key[Q5].answers.length, 3, '띄어쓰기만 다른 인정 답은 하나로'); assert.equal(key[Q6].model, '모범');
  assert.equal(notice.title, '중간고사'); assert.equal(end.title, '고생하셨습니다');
});

test('고유번호: 겹치지 않고, 이미 있으면 그대로 둔다', () => {
  assert.equal(new Set(PAGES.map(p => p.id)).size, PAGES.length);
  assert.deepEqual(C.ensureIds(PAGES).map(p => p.id), PAGES.map(p => p.id));
  const dup = C.ensureIds([{ id: 'x1' }, { id: 'x1' }]);
  assert.notEqual(dup[0].id, dup[1].id);
});

test('랜덤: 같은 학생은 언제나 같은 순서', () => {
  assert.deepEqual(C.examOrder(sheet, 'ex1', '20261234'), C.examOrder(sheet, 'ex1', '20261234'));
});

test('랜덤: 문제와 보기가 빠지거나 겹치지 않는다', () => {
  for (let s = 0; s < 200; s++) {
    const o = C.examOrder(sheet, 'ex1', 'S' + s);
    assert.deepEqual(o.map(x => x.id).sort(), ids.slice().sort());
    for (const x of o) {
      const q = sheet.find(y => y.id === x.id);
      if (q.opts) assert.deepEqual(x.opt.slice().sort(), [0, 1, 2, 3]); else assert.equal(x.opt, null);
    }
  }
});

test('랜덤: 학생마다 다르고 한쪽으로 쏠리지 않는다', () => {
  const big = Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i, opts: ['a', 'b', 'c', 'd'] }));
  const orders = new Set(), first = {}, optFirst = [0, 0, 0, 0];
  for (let s = 0; s < 400; s++) {
    const o = C.examOrder(big, 'ex1', String(20260000 + s));
    orders.add(o.map(x => x.id).join());
    first[o[0].id] = (first[o[0].id] || 0) + 1;
    optFirst[o[0].opt[0]]++;
  }
  assert.equal(orders.size, 400, '문제 순서가 겹침');
  assert.equal(Object.keys(first).length, 20, '맨 앞에 한 번도 안 나온 문제가 있음');
  for (const c of Object.values(first)) assert.ok(c > 5 && c < 50, '첫 문제 쏠림 ' + c);
  for (const c of optFirst) assert.ok(c > 60 && c < 140, '보기 쏠림 ' + c);
  assert.notDeepEqual(C.examOrder(big, 'ex1', '1'), C.examOrder(big, 'ex2', '1'), '시험이 달라도 순서가 같음');
});

test('문제풀이 모드는 섞지 않는다', () => {
  assert.deepEqual(C.plainOrder(sheet).map(x => x.id), ids);
  assert.deepEqual(C.plainOrder(sheet)[0].opt, [0, 1, 2, 3]);
});

const PERFECT = { [Q1]: 1, [Q2]: 0, [Q3]: 3, [Q4]: '0,2', [Q5]: '사출금형' };

test('채점: 보기가 섞여도 원래 번호로 채점한다', () => {
  for (let s = 0; s < 50; s++) {
    const o = C.examOrder(sheet, 'ex1', 'S' + s), ans = { [Q5]: '사출금형' };
    for (const x of o) {
      const q = sheet.find(y => y.id === x.id), k = key[x.id];
      if (q.k === 'check') ans[x.id] = C.packChecks(x.opt.filter(orig => k.a.includes(orig)));   // 화면 순서대로 눌러도
      else if (x.opt) ans[x.id] = x.opt[x.opt.indexOf(k.a)];
    }
    assert.equal(C.scoreStudent(sheet, key, ans, {}).mc, 17);
  }
});

test('채점: 객관식 · 드롭다운', () => {
  assert.equal(C.scoreStudent(sheet, key, { [Q1]: 1 }, {}).mc, 4);
  assert.equal(C.scoreStudent(sheet, key, { [Q1]: '1' }, {}).mc, 4, '숫자가 글자로 저장돼도 채점');
  assert.equal(C.scoreStudent(sheet, key, { [Q1]: 0 }, {}).mc, 0);
  assert.equal(C.scoreStudent(sheet, key, { [Q2]: 0 }, {}).mc, 4, '0번 보기가 정답인 문항');
});

test('채점: 체크박스는 정답을 전부 맞게 골라야 만점', () => {
  const sc = v => C.scoreStudent(sheet, key, { [Q4]: v }, {}).mc;
  assert.equal(sc('0,2'), 4); assert.equal(sc('2,0'), 4, '고른 순서는 상관없음');
  assert.equal(sc('0'), 0, '하나만 고름'); assert.equal(sc('0,1,2'), 0, '하나 더 고름'); assert.equal(sc('1,3'), 0); assert.equal(sc(''), 0);
  assert.equal(C.packChecks([2, 0, 2]), '0,2'); assert.deepEqual(C.unpackChecks('0,2'), [0, 2]); assert.deepEqual(C.unpackChecks(''), []);
});

test('채점: 단답형은 인정 답과 비교하고 띄어쓰기·대소문자를 무시한다', () => {
  const sc = v => C.scoreStudent(sheet, key, { [Q5]: v }, {}).mc;
  for (const ok of ['사출금형', ' 사출  금형 ', '사 출 금 형', 'injection mold', 'INJECTIONMOLD', '사출금헝']) assert.equal(sc(ok), 3, ok);
  for (const no of ['금형', '사출', '사출금형기', '', '   ']) assert.equal(sc(no), 0, no);
  assert.equal(C.normAns(' A  b\tC '), 'abc');
});

test('채점: 합계 · 틀린 문항 · 빈 답 · 장문형', () => {
  let r = C.scoreStudent(sheet, key, { ...PERFECT, [Q3]: 0, [Q6]: '내 답' }, {});   // Q3 틀림
  assert.deepEqual([r.mc, r.essay, r.total, r.max, r.answered, r.essayPending], [15, 0, 15, 27, 6, 1]);
  assert.deepEqual(r.wrong, [Q3]);
  r = C.scoreStudent(sheet, key, { ...PERFECT, [Q6]: '내 답' }, { [Q6]: 7 });
  assert.deepEqual([r.essay, r.total, r.essayPending], [7, 24, 0]);
  assert.ok(r.wrong.includes(Q6), '감점된 장문형은 틀린 문항에 포함');
  assert.equal(C.scoreStudent(sheet, key, PERFECT, { [Q6]: 99 }).essay, 10, '배점보다 큰 점수는 배점까지만');
  assert.equal(C.scoreStudent(sheet, key, undefined, undefined).total, 0);
  assert.equal(C.scoreStudent(sheet, key, {}, {}).wrong.length, 5, '안 푼 자동 채점 문항은 틀린 것');
});

test('순위: 동점은 같은 등수', () => {
  const r = C.ranked([{ sid: 'c', total: 80 }, { sid: 'a', total: 90 }, { sid: 'b', total: 90 }, { sid: 'd', total: 70 }]);
  assert.deepEqual(r.map(x => [x.sid, x.rank]), [['a', 1], ['b', 1], ['c', 3], ['d', 4]]);
});

test('문항별 응답 집계: 보기별 선택 수 · 단답형 답 모음 · 많이 틀린 문제', () => {
  const all = [
    { answers: { [Q1]: 1, [Q2]: 0, [Q3]: 0, [Q4]: '0,2', [Q5]: '사출금형' }, essay: { [Q6]: 10 } },
    { answers: { [Q1]: 1, [Q2]: 2, [Q3]: 0, [Q4]: '0,1', [Q5]: '사출 금형' }, essay: { [Q6]: 5 } },
    { answers: { [Q1]: 0, [Q2]: 2, [Q4]: '2', [Q5]: '금형' }, essay: {} },
    { answers: { [Q1]: 1, [Q2]: 0, [Q3]: 3, [Q5]: '금형' }, essay: {} },
  ];
  const st = C.questionStats(sheet, key, all);
  assert.equal(st[0].rate, 0.75); assert.equal(st[1].rate, 0.5); assert.equal(st[2].rate, 0.25);
  assert.equal(st[2].blank, 1); assert.equal(st[2].topWrong, 0); assert.equal(st[2].topWrongText, 'i');
  assert.deepEqual(st[1].picks, [2, 0, 2, 0]);
  assert.deepEqual(st[3].picks, [2, 1, 2, 0], '체크박스는 고른 보기마다 셈'); assert.equal(st[3].right, 1); assert.equal(st[3].answerText, 'm, o');
  assert.deepEqual(st[4].tally, [{ text: '금형', n: 2, ok: false }, { text: '사출금형', n: 2, ok: true }], '띄어쓰기만 다른 답은 한 종류');
  assert.equal(st[4].rate, 0.5); assert.equal(st[4].topWrongText, '금형');
  assert.equal(st[5].avg, 7.5); assert.equal(st[5].graded, 2);
  assert.deepEqual(C.mostMissed(st, 2).map(s => s.no), [3, 4]);
});

test('점수 분포', () => {
  const h = C.histogram([0, 5, 10, 55, 99, 100], 100, 10);
  assert.deepEqual(h.map(b => b.n), [2, 1, 0, 0, 0, 1, 0, 0, 0, 2]);
  assert.deepEqual([h[0].from, h[0].to, h[9].to], [0, 10, 100]);
  assert.equal(C.histogram([], 0, 5).length, 5);
});

test('이탈 기록: 횟수와 시각 순서', () => {
  const s = C.leaveSummary({ b: { t: 'back', at: 20 }, a: { t: 'leave', at: 10 }, c: { t: 'unpin', at: 30 }, d: { t: 'leave', at: 40 } });
  assert.equal(s.count, 3); assert.deepEqual(s.list.map(e => e.at), [10, 20, 30, 40]);
  assert.equal(C.leaveSummary(null).count, 0);
});

test('카메라 경고 · 잠금 횟수와 카메라 상태', () => {
  const ev = (...ts) => Object.fromEntries(ts.map((t, i) => ['k' + i, { t, at: i + 1 }]));
  let s = C.leaveSummary(ev('leave', 'back', 'face', 'faceok'));
  assert.deepEqual([s.count, s.face, s.locks, s.warn, s.camOff], [1, 1, 0, 1, false]);
  s = C.leaveSummary(ev('face', 'face', 'lock', 'face', 'unlocked', 'face'));
  assert.deepEqual([s.face, s.locks, s.warn], [4, 1, 1], '잠긴 동안의 경고는 세지 않고, 풀린 뒤 다시 1회부터 셈');
  s = C.leaveSummary(ev('leave', 'back', 'unpin', 'back', 'lockout', 'leave', 'unlocked', 'leave', 'face'));
  assert.deepEqual([s.count, s.locks, s.lwarn, s.warn], [4, 1, 1, 1], '화면 벗어남 잠금도 잠금 횟수에 들어가고, 잠긴 뒤 다시 셈');
  assert.equal(C.leaveSummary(ev('camoff')).camOff, true); assert.equal(C.leaveSummary(ev('camoff', 'camon')).camOff, false);
  assert.equal(C.leaveSummary(ev('nocam', 'leave')).camOff, true); assert.equal(C.leaveSummary(ev('leave')).camOff, false);
  for (const t of ['leave', 'unpin', 'face', 'lock', 'camoff', 'camfail', 'nocam']) assert.ok(C.EV_NAME[t], t);
});

test('고개 돌린 각도 어림: 정면은 0도, 30도를 넘으면 걸러진다', () => {
  // 머리를 위에서 본 원으로 보고 점을 만듭니다: 귀는 양옆, 코는 앞쪽으로 조금 나와 있음
  const face = deg => { const t = deg * Math.PI / 180, cx = 0.5, r = 0.15; return [{ x: cx - 0.05 }, { x: cx + 0.05 }, { x: cx + 1.1 * r * Math.sin(t) }, { x: cx }, { x: cx - r * Math.cos(t) }, { x: cx + r * Math.cos(t) }]; };
  for (const d of [0, 10, 20, 29, 31, -20, -35]) assert.ok(Math.abs(C.faceYaw(face(d)) - d) < 0.5, `${d}도 → ${C.faceYaw(face(d))}`);
  for (const d of [45, 60, 80, -50]) assert.ok(Math.abs(C.faceYaw(face(d))) > 30 && Math.sign(C.faceYaw(face(d))) === Math.sign(d), `${d}도`);   // 많이 돌리면 코가 귀를 넘어가 옆얼굴로 봄
  assert.ok(Math.abs(C.faceYaw(face(29))) <= 30); assert.ok(Math.abs(C.faceYaw(face(31))) > 30);
  assert.equal(Math.abs(C.faceYaw([{ x: 0 }, { x: 0 }, { x: 0.9 }, { x: 0 }, { x: 0.4 }, { x: 0.6 }])), 90, '코가 귀 바깥이면 옆얼굴');
  assert.equal(C.faceYaw([]), 0);
  assert.equal(C.fmtDur(200), '3분 20초'); assert.equal(C.fmtDur(45), '45초'); assert.equal(C.fmtDur(120), '2분'); assert.equal(C.fmtDur(undefined), '0초');
});

test('고개 위아래 어림: 정면은 0도, 숙이거나 들면 각도가 커진다', () => {
  // 옆에서 본 얼굴: 눈(높이 0, 앞 0) · 코끝(높이 0.5H, 앞으로 0.55H) · 입(높이 H, 앞 0). 고개를 p도 숙인 모습을 화면에 비춤
  const face = deg => { const p = deg * Math.PI / 180, H = 0.2, y = (h, z) => 0.3 + h * Math.cos(p) + z * Math.sin(p);
    return [{ x: 0.45, y: y(0, 0) }, { x: 0.55, y: y(0, 0) }, { x: 0.5, y: y(0.5 * H, C.NOSE_DEPTH * H) }, { x: 0.5, y: y(H, 0) }]; };
  const base = C.faceRatio(face(0));
  assert.ok(Math.abs(base - 0.5) < 1e-9);
  for (const d of [0, 10, 20, 30, -15, -30]) assert.ok(Math.abs(C.facePitch(C.faceRatio(face(d)), base) - d) < 0.5, `${d}도 → ${C.facePitch(C.faceRatio(face(d)), base)}`);
  assert.equal(C.facePitch(null, base), 0); assert.equal(C.facePitch(0.6, null), 0); assert.equal(C.faceRatio([]), null);
});

test('반 이름 · 학번 · 이름 다듬기', () => {
  assert.equal(C.normSid(' 2026 1234 '), '20261234'); assert.equal(C.normName(' 홍 길동 '), '홍길동');
  assert.equal(C.normCls('  1학년   A반 '), '1학년 A반');
  assert.ok(C.validCls('1학년 A반')); assert.ok(!C.validCls('')); assert.ok(!C.validCls('a/b')); assert.ok(!C.validCls('가'.repeat(21)));
  assert.deepEqual(C.classList(null), ['A반', 'B반']);
  assert.deepEqual(C.classList({ 'C반': 2, '1학년 A반': 0, 'B반': 1 }), ['1학년 A반', 'B반', 'C반']);
  assert.ok(C.validSid('20261234')); assert.ok(!C.validSid('12')); assert.ok(!C.validSid('a/b.c'));
});

test('고른 문항만 교체: 자리와 고유번호를 지킨다', () => {
  const fresh = [{ t: 'choice', q: 'NEW1' }, { t: 'long', q: 'NEW2' }];
  const out = C.replaceSelected(PAGES, [1, 4], fresh);
  assert.equal(out[1].q, 'NEW1'); assert.equal(out[4].q, 'NEW2');
  assert.equal(out[1].id, PAGES[1].id); assert.equal(out[2], PAGES[2]); assert.equal(out.length, PAGES.length);
  assert.throws(() => C.replaceSelected(PAGES, [1], fresh), /개수/);
});

test('고른 문항만 교체: 원래 사진을 지키고, 사진 자리에 엉뚱한 글자는 받지 않는다', () => {
  const withImg = PAGES.map((p, i) => (i === 3 ? { ...p, img: 'img:abc123' } : p));
  const back = C.normalizePage({ t: 'image', q: 'NEW', img: '(사진 있음)', opts: ['a', 'b'], a: 0, pts: 2 });   // 부탁문에 들어갔던 표시가 그대로 돌아옴
  assert.equal(back.img, undefined);
  assert.equal(C.replaceSelected(withImg, [3], [back])[3].img, 'img:abc123');
  assert.equal(C.replaceSelected(withImg, [3], [{ ...back, img: 'https://example.com/x.png' }])[3].img, 'https://example.com/x.png');
  for (const ok of ['img:q0abc1', 'data:image/jpeg;base64,AAAA', 'https://example.com/a.png']) assert.ok(C.validImg(ok));
  for (const no of ['(사진 있음)', 'javascript:alert(1)', 'http://example.com/a.png', '']) assert.ok(!C.validImg(no));
});

test('CSV: 수식처럼 보이는 이름은 글자로 바꿔 내보낸다', () => {
  const csv = C.toCSV([['이름', '점수'], ["=cmd|'/c calc'!A1", -3], ['+82', 5], ['@x', 0], ['홍길동', 4]]);
  assert.ok(csv.includes("'=cmd|'/c calc'!A1,-3")); assert.ok(csv.includes("'+82,5")); assert.ok(csv.includes("'@x,0")); assert.ok(csv.includes('홍길동,4'));
});

test('영상 주소 · 시계 · CSV', () => {
  for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'])
    assert.equal(C.youtubeId(u), 'dQw4w9WgXcQ');
  assert.equal(C.youtubeId('https://example.com/a.mp4'), '');
  assert.equal(C.fmtClock(38 * 60000 + 12000), '38:12'); assert.equal(C.fmtClock(-5), '00:00'); assert.equal(C.fmtClock(3661000), '1:01:01');
  assert.equal(C.fmtClock(500), '00:01');
  assert.equal(C.toCSV([['이름', '점수'], ['홍,길동', 'a"b'], ['x', 3]]), '﻿이름,점수\r\n"홍,길동","a""b"\r\nx,3\r\n');
});

test('문제 만들기: 객관식 수와 난이도 하는 자동으로 정해진다', () => {
  let p = C.promptPlan();
  assert.deepEqual([p.n, p.counts.choice, p.lo, p.mid, p.hi, p.total], [25, 25, 60, 30, 10, 100]);
  p = C.promptPlan({ n: 25, nLong: 2, nShort: 3, nImage: 1 });
  assert.equal(p.counts.choice, 19, '다른 유형을 늘리면 객관식이 줄어듦');
  p = C.promptPlan({ mid: 50, hi: 20 }); assert.equal(p.lo, 30);
  assert.ok(!C.promptPlan({ n: 5, nLong: 6 }).ok); assert.ok(!C.promptPlan({ mid: 70, hi: 40 }).ok); assert.ok(!C.promptPlan({ n: 0 }).ok);
});

test('문제 만들기: 배점은 언제나 정수이고 합계가 정확히 맞는다', () => {
  const sum = p => p.fixed.reduce((s, f) => s + f.count * f.pts, 0) + (p.freeN - p.extra) * p.base + p.extra * (p.base + 1);
  let p = C.promptPlan({ n: 25, total: 100 });
  assert.deepEqual([p.base, p.extra], [4, 0]); assert.equal(sum(p), 100);
  p = C.promptPlan({ n: 30, total: 100 });
  assert.deepEqual([p.base, p.extra], [3, 10], '남는 10점은 10문항에 1점씩'); assert.equal(sum(p), 100);
  p = C.promptPlan({ n: 25, nLong: 2, total: 100, pts: { long: 10 } });
  assert.deepEqual([p.freeN, p.base, p.extra], [23, 3, 11]); assert.equal(sum(p), 100);
  for (let n = 1; n <= 60; n++) for (const total of [50, 100, 120]) {
    const q = C.promptPlan({ n, total, nLong: Math.min(2, n - 1 < 0 ? 0 : Math.floor(n / 10)), pts: { long: 8 } });
    if (q.ok) { assert.equal(sum(q), total, `${n}문항 ${total}점`); assert.ok(q.base >= 1); }
  }
  assert.ok(!C.promptPlan({ n: 10, nLong: 2, total: 100, pts: { long: 60 } }).ok, '따로 정한 배점이 합계를 넘음');
  assert.ok(!C.promptPlan({ n: 4, total: 100, pts: { choice: 20 } }).ok, '모두 따로 정했는데 합계와 다름');
  assert.ok(C.promptPlan({ n: 4, total: 100, pts: { choice: 25 } }).ok);
});

test('부탁문: 고른 값과 형식 예시가 들어가고, 사진 자료와 고유번호는 빠진다', () => {
  const m = C.promptMake({ subject: '기계공작법', n: 25, nLong: 2, nShort: 3, pts: { long: 10 } });
  assert.ok(m.includes('기계공작법')); assert.ok(m.includes('모두 25문항 — 객관식 20문항, 단답형 3문항, 장문형 2문항'));
  assert.ok(m.includes('하 60% · 중 30% · 상 10%')); assert.ok(m.includes('합계가 정확히 100점'));
  assert.ok(m.includes('장문형 2문항: 각 10점')); assert.ok(m.includes('나머지 23문항(객관식 20 · 단답형 3): 12문항은 3점, 난이도가 높은 11문항은 4점'));
  assert.ok(C.promptMake().includes('25문항(객관식 25): 각 4점'));
  assert.ok(C.promptMake().includes('"t":"short"'));
  const p = C.promptReview([{ ...PAGES[1], img: 'data:image/jpeg;base64,AAAA' }], { subject: '기계공작법' });
  assert.ok(p.includes('/* 1번 */')); assert.ok(p.includes('"a":1')); assert.ok(!p.includes('base64')); assert.ok(!p.includes(PAGES[1].id));
  assert.ok(C.promptFinal(PAGES).includes('출제 가능'));
  // 형식 예시는 그대로 붙여 넣어도 통과해야 한다
  const ex = C.ensureIds(C.parseBundle(C.FORMAT_EXAMPLE).map(C.normalizePage));
  assert.equal(C.validateBundle(ex).errors.length, 0);
  assert.deepEqual(ex.filter(C.isQuestion).map(C.kindOf), ['choice', 'check', 'dropdown', 'short', 'long', 'choice', 'short']);
  assert.ok(ex.every(C.isQuestion), '형식 예시에는 문제만 있어야 함(안내·마무리 쪽 없음) — AI가 문항 번호를 하나씩 밀려 쓰지 않게');
  assert.ok(!C.promptMake().includes('intro'));
});
