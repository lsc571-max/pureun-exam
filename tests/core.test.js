// 채점 · 랜덤 · 문항 분리 · 명단 · 붙여 넣기 자동 테스트  (실행: npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.js';

const RAW = [
  { t: 'intro', title: '중간고사', body: '50분' },
  { t: 'choice', q: 'Q1', opts: ['a', 'b', 'c', 'd'], a: 1, why: 'w1', level: '상', pts: 4 },
  { t: 'choice', q: 'Q2', opts: ['e', 'f', 'g', 'h'], a: 0, why: 'w2', level: '중', pts: 4 },
  { t: 'image', q: 'Q3', img: '', opts: ['i', 'j', 'k', 'l'], a: 3, why: 'w3', level: '하', pts: 2 },
  { t: 'essay', q: 'Q4', model: '모범', why: '기준', level: '상', pts: 10 },
  { t: 'end', title: '고생하셨습니다', body: '끝' },
];
let n = 0;
const seq = () => (n++ % 1000) / 1000;
const PAGES = C.ensureIds(RAW.map(C.normalizePage), seq);
const { sheet, key, notice, end } = C.splitExam(PAGES);
const ids = sheet.map(q => q.id);

test('붙여 넣기: 코드 블록·앞뒤 설명이 있어도 읽는다', () => {
  const j = JSON.stringify(RAW);
  assert.equal(C.parseBundle(j).length, 6);
  assert.equal(C.parseBundle('아래는 문항입니다.\n```json\n' + j + '\n```\n감사합니다').length, 6);
  assert.equal(C.parseBundle('문항: ' + j + ' 끝').length, 6);
  assert.throws(() => C.parseBundle('안녕하세요'), /JSON/);
  assert.throws(() => C.parseBundle('[]'), /하나도/);
});

test('검사: 정답 누락·범위 밖·빈 보기를 잡아낸다', () => {
  assert.equal(C.validateBundle(PAGES).errors.length, 0);
  const bad = C.ensureIds([
    { t: 'choice', q: 'x', opts: ['a', 'b', 'c', 'd'], a: 4, pts: 4 },
    { t: 'choice', q: 'x', opts: ['a', 'b', 'c', 'd'], pts: 4 },
    { t: 'choice', q: '', opts: ['a', '', 'c', 'd'], a: 0, pts: 0 },
    { t: 'choice', q: 'x', opts: ['a', 'a', 'c', 'd'], a: 0, pts: 1 },
    { t: 'video', q: 'x', opts: ['a', 'b'], a: 0, pts: 1 },
    { t: 'quiz', q: 'x' },
  ].map(C.normalizePage));
  const v = C.validateBundle(bad);
  const at = i => v.errors.filter(e => e.i === i).map(e => e.msg).join(' ');
  assert.match(at(0), /정답/); assert.match(at(1), /정답/);
  assert.match(at(2), /문제/); assert.match(at(2), /배점/); assert.match(at(2), /비어 있는 보기/);
  assert.match(at(3), /똑같은 보기/); assert.match(at(4), /영상 주소/); assert.match(at(5), /유형/);
});

test('검사: 문항 수·배점 합계·난이도 집계', () => {
  const s = C.validateBundle(PAGES).stats;
  assert.deepEqual([s.n, s.total, s.choice, s.essay], [4, 20, 3, 1]);
  assert.deepEqual(s.byLevel, { 상: 2, 중: 1, 하: 1 });
});

test('문제지에는 정답·해설·난이도·모범 답안이 한 글자도 없다', () => {
  const text = JSON.stringify(sheet);
  for (const q of sheet) for (const f of ['a', 'why', 'level', 'model']) assert.equal(f in q, false, `${f} 가 문제지에 있음`);
  for (const secret of ['w1', 'w2', 'w3', '모범', '기준']) assert.equal(text.includes(secret), false);
  assert.equal(sheet.length, 4);
  assert.equal(key[ids[0]].a, 1); assert.equal(key[ids[3]].model, '모범');
  assert.equal(notice.title, '중간고사'); assert.equal(end.title, '고생하셨습니다');
});

test('고유번호: 겹치지 않고, 이미 있으면 그대로 둔다', () => {
  assert.equal(new Set(PAGES.map(p => p.id)).size, PAGES.length);
  const again = C.ensureIds(PAGES);
  assert.deepEqual(again.map(p => p.id), PAGES.map(p => p.id));
  const dup = C.ensureIds([{ id: 'x1' }, { id: 'x1' }]);
  assert.notEqual(dup[0].id, dup[1].id);
});

test('랜덤: 같은 학생은 언제나 같은 순서', () => {
  const a = C.examOrder(sheet, 'ex1', '20261234'), b = C.examOrder(sheet, 'ex1', '20261234');
  assert.deepEqual(a, b);
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

test('채점: 보기가 섞여도 원래 번호로 채점한다', () => {
  // 화면에서 정답 보기를 누른 학생: 화면 칸 → 원래 번호로 바꿔 저장
  for (let s = 0; s < 50; s++) {
    const o = C.examOrder(sheet, 'ex1', 'S' + s), ans = {};
    for (const x of o) if (x.opt) { const slot = x.opt.indexOf(key[x.id].a); ans[x.id] = x.opt[slot]; }
    const r = C.scoreStudent(sheet, key, ans, {});
    assert.equal(r.mc, 10); assert.equal(r.wrong.length, 0 + 0); // 서술형은 미채점이라 wrong 아님
  }
});

test('채점: 점수 · 틀린 문항 · 빈 답 · 서술형', () => {
  const ans = { [ids[0]]: 1, [ids[1]]: 3, [ids[3]]: '내 답' }; // Q1 맞음, Q2 틀림, Q3 안 풂
  let r = C.scoreStudent(sheet, key, ans, {});
  assert.deepEqual([r.mc, r.essay, r.total, r.max, r.answered, r.essayPending], [4, 0, 4, 20, 3, 1]);
  assert.deepEqual(r.wrong, [ids[1], ids[2]]);
  r = C.scoreStudent(sheet, key, ans, { [ids[3]]: 7 });
  assert.deepEqual([r.essay, r.total, r.essayPending], [7, 11, 0]);
  assert.ok(r.wrong.includes(ids[3]));
  assert.equal(C.scoreStudent(sheet, key, ans, { [ids[3]]: 99 }).essay, 10, '배점보다 큰 점수는 배점까지만');
  assert.equal(C.scoreStudent(sheet, key, { [ids[0]]: '1' }, {}).mc, 4, '숫자가 글자로 저장돼도 채점');
  assert.equal(C.scoreStudent(sheet, key, undefined, undefined).total, 0);
  assert.equal(C.scoreStudent(sheet, key, { [ids[1]]: 0 }, {}).mc, 4, '0번 보기가 정답인 문항');
});

test('순위: 동점은 같은 등수', () => {
  const r = C.ranked([{ sid: 'c', total: 80 }, { sid: 'a', total: 90 }, { sid: 'b', total: 90 }, { sid: 'd', total: 70 }]);
  assert.deepEqual(r.map(x => [x.sid, x.rank]), [['a', 1], ['b', 1], ['c', 3], ['d', 4]]);
});

test('문항별 정답률과 많이 틀린 문제', () => {
  const all = [
    { answers: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 }, essay: { [ids[3]]: 10 } },
    { answers: { [ids[0]]: 1, [ids[1]]: 2, [ids[2]]: 0 }, essay: { [ids[3]]: 5 } },
    { answers: { [ids[0]]: 0, [ids[1]]: 2 }, essay: {} },
    { answers: { [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 3 }, essay: {} },
  ];
  const st = C.questionStats(sheet, key, all);
  assert.equal(st[0].rate, 0.75); assert.equal(st[1].rate, 0.5); assert.equal(st[2].rate, 0.25);
  assert.equal(st[2].blank, 1); assert.equal(st[2].topWrong, 0); assert.equal(st[2].topWrongText, 'i');
  assert.deepEqual(st[1].picks, [2, 0, 2, 0]);
  assert.equal(st[3].avg, 7.5); assert.equal(st[3].graded, 2);
  assert.deepEqual(C.mostMissed(st, 2).map(s => s.no), [3, 2]);
});

test('이탈 기록: 횟수와 시각 순서', () => {
  const s = C.leaveSummary({ b: { t: 'back', at: 20 }, a: { t: 'leave', at: 10 }, c: { t: 'unpin', at: 30 }, d: { t: 'leave', at: 40 } });
  assert.equal(s.count, 3); assert.deepEqual(s.list.map(e => e.at), [10, 20, 30, 40]);
  assert.equal(C.leaveSummary(null).count, 0);
});

test('명단: 엑셀 붙여 넣기 (칸 순서 무관, 머리글·빈 줄 무시)', () => {
  const r = C.parseRoster('반\t학번\t이름\nA\t20261234\t홍길동\n20261235, 김 철수, B반\n\nb 20261236 이영희\n');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, [
    { sid: '20261234', name: '홍길동', cls: 'A반' },
    { sid: '20261235', name: '김철수', cls: 'B반' },
    { sid: '20261236', name: '이영희', cls: 'B반' },
  ]);
  const bad = C.parseRoster('A 20261234 홍길동\nA 20261234 홍길순\n홍길동만\nC반 20261240 박민수\n');
  assert.equal(bad.rows.length, 1); assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[2].msg, /반 이름/);
});

test('명단: 교수가 정한 반 이름 (띄어쓰기 있는 이름, 반이 하나뿐일 때)', () => {
  const cls = ['1학년 A반', '2학년 B반', 'C반'];
  const r = C.parseRoster('1학년 A반\t20261234\t홍길동\n20261235 김철수 2학년B반\nc, 20261236, 이영희\n2학년 b반 20261237 최지우', cls);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map(x => x.cls), ['1학년 A반', '2학년 B반', 'C반', '2학년 B반']);
  assert.deepEqual(r.rows.map(x => x.name), ['홍길동', '김철수', '이영희', '최지우']);
  assert.equal(C.parseRoster('20261234 홍길동', ['기계과']).rows[0].cls, '기계과', '반이 하나면 안 써도 됨');
  assert.equal(C.parseRoster('20261234 홍길동', cls).errors.length, 1, '반이 여럿이면 써야 함');
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
  const fresh = [{ t: 'choice', q: 'NEW1' }, { t: 'essay', q: 'NEW2' }];
  const out = C.replaceSelected(PAGES, [1, 4], fresh);
  assert.equal(out[1].q, 'NEW1'); assert.equal(out[4].q, 'NEW2');
  assert.equal(out[1].id, PAGES[1].id); assert.equal(out[2], PAGES[2]); assert.equal(out.length, PAGES.length);
  assert.throws(() => C.replaceSelected(PAGES, [1], fresh), /개수/);
});

test('영상 주소 · 시계 · CSV', () => {
  for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'])
    assert.equal(C.youtubeId(u), 'dQw4w9WgXcQ');
  assert.equal(C.youtubeId('https://example.com/a.mp4'), '');
  assert.equal(C.fmtClock(38 * 60000 + 12000), '38:12'); assert.equal(C.fmtClock(-5), '00:00'); assert.equal(C.fmtClock(3661000), '1:01:01');
  assert.equal(C.fmtClock(500), '00:01');
  const csv = C.toCSV([['이름', '점수'], ['홍,길동', 'a"b'], ['x', 3]]);
  assert.equal(csv, '﻿이름,점수\r\n"홍,길동","a""b"\r\nx,3\r\n');
});

test('부탁문: 형식 예시가 들어가고, 사진 자료와 고유번호는 빠진다', () => {
  assert.ok(C.promptMake({ subject: '기계공작법', nChoice: 20 }).includes('사지선다 20문항'));
  assert.ok(C.promptMake().includes('"t":"choice"'));
  const o = { subject: '기계공작법', nChoice: 20, nEssay: 2, nImage: 2, nVideo: 1, hi: 5, mid: 12, lo: 8, ptsChoice: 4, ptsEssay: 4 };
  assert.deepEqual(C.promptTotals(o), { count: 25, levels: 25, total: 100 });
  assert.ok(C.promptMake(o).includes('난이도 — 상 5문항 · 중 12문항 · 하 8문항'));
  assert.ok(C.promptMake(o).includes('합계 100점'));
  const p = C.promptReview([{ ...PAGES[1], img: 'data:image/jpeg;base64,AAAA' }], { subject: '기계공작법' });
  assert.ok(p.includes('/* 1번 */')); assert.ok(p.includes('"a":1')); assert.ok(!p.includes('base64')); assert.ok(!p.includes(PAGES[1].id));
  assert.ok(C.promptFinal(PAGES).includes('출제 가능'));
  // 형식 예시는 그대로 붙여 넣어도 통과해야 한다
  const ex = C.ensureIds(C.parseBundle(C.FORMAT_EXAMPLE).map(C.normalizePage));
  assert.equal(C.validateBundle(ex).errors.length, 0);
});
