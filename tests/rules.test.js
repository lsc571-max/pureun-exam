// 보안 규칙 자동 테스트 — Firebase 에뮬레이터에서 실행합니다. (실행: npm run test:rules, GitHub Actions에서 자동)
import test, { before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

let env;
const GOOGLE = { firebase: { sign_in_provider: 'google.com' } };
const ANON = { firebase: { sign_in_provider: 'anonymous' } };
const prof = () => env.authenticatedContext('prof', GOOGLE).database();
const stu = uid => env.authenticatedContext(uid, ANON).database();
const nobody = () => env.unauthenticatedContext().database();
const seed = data => env.withSecurityRulesDisabled(ctx => ctx.database().ref().update(data));
const enter = (uid, sid, name, cls) => stu(uid).ref().update({
  [`users/${uid}`]: { sid, name, cls, at: 1 },
  [`bind/${sid}`]: uid,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-pureun-exam',
    database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearDatabase();
  const now = Date.now();
  await seed({
    'admins/prof': true,
    'roster/20261234': { name: '홍길동', cls: 'A' },
    'roster/20261235': { name: '김철수', cls: 'B' },
    // 진행 중인 시험
    'exams/run': { title: '진행 중', status: 'running', startAt: now - 60000, endAt: now + 600000, released: false },
    'sheets/run': { data: '[]' }, 'keys/run': { data: '{}' }, 'images/run/i1': 'data:x',
    // 아직 시작 전
    'exams/wait': { title: '대기', status: 'open', released: false },
    'sheets/wait': { data: '[]' }, 'keys/wait': { data: '{}' },
    // 끝났고 결과 공개 전
    'exams/done': { title: '종료', status: 'ended', startAt: now - 7200000, endAt: now - 3600000, released: false },
    'sheets/done': { data: '[]' }, 'keys/done': { data: '{}' },
    // 끝났고 결과 공개됨
    'exams/open': { title: '공개', status: 'ended', startAt: now - 7200000, endAt: now - 3600000, released: true },
    'sheets/open': { data: '[]' }, 'keys/open': { data: '{}' },
    // 문제풀이 공개
    'exams/prac': { title: '연습', status: 'draft', practice: true },
    'sheets/prac': { data: '[]' }, 'keys/prac': { data: '{}' },
    'drafts/run': { data: '[]' },
  });
});

test('로그인하지 않으면 아무것도 못 읽는다', async () => {
  for (const p of ['exams', 'sheets/run', 'keys/open', 'roster', 'answers', 'users', 'bind', 'drafts'])
    await assertFails(nobody().ref(p).get());
});

test('교수: 처음 한 번만 관리자로 등록되고, 그 뒤 다른 계정은 못 한다', async () => {
  await env.clearDatabase();
  await assertFails(stu('s1').ref('admins/s1').set(true)); // 익명 로그인은 안 됨
  await assertFails(env.authenticatedContext('g1', GOOGLE).database().ref('admins/g2').set(true)); // 남의 자리
  await assertSucceeds(env.authenticatedContext('g1', GOOGLE).database().ref('admins/g1').set(true));
  await assertFails(env.authenticatedContext('g2', GOOGLE).database().ref('admins/g2').set(true)); // 이미 있음
  await assertFails(env.authenticatedContext('g2', GOOGLE).database().ref('drafts').get());
});

test('교수: 문제·정답·명단·전체 답안을 읽고 쓴다', async () => {
  for (const p of ['drafts', 'sheets/wait', 'keys/wait', 'roster', 'answers', 'users', 'bind', 'essay'])
    await assertSucceeds(prof().ref(p).get());
  await assertSucceeds(prof().ref().update({ 'drafts/x': { data: '[]' }, 'sheets/x': { data: '[]' }, 'keys/x': { data: '{}' }, 'exams/x/title': 't' }));
  await assertSucceeds(prof().ref('essay/run/20261234/q1').set(5));
});

test('입장: 반·학번·이름이 명단과 모두 맞아야 한다', async () => {
  await assertFails(enter('u1', '20261234', '홍길순', 'A')); // 이름 다름
  await assertFails(enter('u1', '20261234', '홍길동', 'B')); // 반 다름
  await assertFails(enter('u1', '20269999', '홍길동', 'A')); // 없는 학번
  await assertFails(stu('u1').ref('users/u1').set({ sid: '20261234', name: '홍길동', cls: 'A' })); // 기기 묶음 없이
  await assertFails(stu('u1').ref('bind/20261234').set('u1')); // 이름 확인 없이 묶기만
  await assertSucceeds(enter('u1', '20261234', '홍길동', 'A'));
  await assertSucceeds(stu('u1').ref('users/u1').get());
});

test('두 기기 금지: 이미 묶인 학번으로 다른 기기는 못 들어온다', async () => {
  await assertSucceeds(enter('u1', '20261234', '홍길동', 'A'));
  await assertFails(enter('u2', '20261234', '홍길동', 'A'));
  await assertFails(stu('u2').ref('bind/20261234').set('u2'));
  await assertFails(stu('u1').ref('bind/20261234').remove()); // 학생이 스스로 풀 수 없음
  await assertFails(stu('u1').ref('users/u1').remove());
  await assertFails(stu('u1').ref('users/u1/sid').set('20261235')); // 학번 바꿔치기
  // 교수가 풀어 주면 새 기기로 들어온다
  await assertSucceeds(prof().ref().update({ 'bind/20261234': null, 'users/u1': null }));
  await assertSucceeds(enter('u2', '20261234', '홍길동', 'A'));
});

test('학생은 명단·남의 정보·관리자 목록을 못 읽는다', async () => {
  await enter('u1', '20261234', '홍길동', 'A');
  for (const p of ['roster', 'roster/20261235', 'users', 'users/u2', 'bind', 'bind/20261235', 'admins', 'drafts', 'drafts/run'])
    await assertFails(stu('u1').ref(p).get());
  await assertSucceeds(stu('u1').ref('exams').get());
  await assertFails(stu('u1').ref('exams/run/status').set('ended'));
  await assertFails(stu('u1').ref('roster/20261234/name').set('x'));
});

test('문제지: 시작 전에는 못 읽고, 명단에 없는 사람도 못 읽는다', async () => {
  await assertFails(stu('ghost').ref('sheets/run').get()); // 입장 안 한 익명 사용자
  await enter('u1', '20261234', '홍길동', 'A');
  await assertFails(stu('u1').ref('sheets/wait').get());
  await assertFails(stu('u1').ref('sheets').get());
  await assertSucceeds(stu('u1').ref('sheets/run').get());
  await assertSucceeds(stu('u1').ref('images/run').get());
  await assertSucceeds(stu('u1').ref('sheets/done').get());
  await assertSucceeds(stu('u1').ref('sheets/prac').get());
  await assertFails(stu('u1').ref('sheets/run').set({ data: 'x' }));
});

test('정답지: 결과 공개 전에는 학생 기기로 내려가지 않는다', async () => {
  await enter('u1', '20261234', '홍길동', 'A');
  await assertFails(stu('u1').ref('keys/run').get());   // 시험 중
  await assertFails(stu('u1').ref('keys/done').get());  // 끝났지만 공개 전
  await assertFails(stu('u1').ref('keys/wait').get());
  await assertFails(stu('u1').ref('keys').get());
  await assertSucceeds(stu('u1').ref('keys/open').get()); // 공개 후
  await assertSucceeds(stu('u1').ref('keys/prac').get()); // 문제풀이
  await assertFails(stu('ghost').ref('keys/open').get());
  await assertFails(stu('u1').ref('keys/open').set({ data: 'x' }));
});

test('답안: 자기 것만 쓰고 읽는다', async () => {
  await enter('u1', '20261234', '홍길동', 'A');
  await enter('u2', '20261235', '김철수', 'B');
  await assertSucceeds(stu('u1').ref('answers/run/20261234').update({ 'a/q1': 2, 'a/q2': '서술형 답', startedAt: 1, sess: 'abc' }));
  await assertSucceeds(stu('u1').ref('answers/run/20261234/ev').push({ t: 'leave', at: 5 }));
  await assertSucceeds(stu('u1').ref('answers/run/20261234').get());
  await assertFails(stu('u2').ref('answers/run/20261234').get());
  await assertFails(stu('u2').ref('answers/run/20261234/a/q1').set(0));
  await assertFails(stu('u1').ref('answers/run').get());
  await assertFails(stu('u1').ref('answers/run/20261234/score').set(100)); // 정해진 칸만
  await assertFails(stu('u1').ref('answers/run/20261234/a/q1').set({ x: 1 }));
  await assertFails(stu('u1').ref('answers/run/20261234/a/q9').set('가'.repeat(5001)));
});

test('답안: 시작 전·종료 후·제출 후에는 못 고친다', async () => {
  await enter('u1', '20261234', '홍길동', 'A');
  await assertFails(stu('u1').ref('answers/wait/20261234/a/q1').set(1)); // 시작 전
  await assertFails(stu('u1').ref('answers/done/20261234/a/q1').set(1)); // 종료 후
  await seed({ 'exams/late': { status: 'running', startAt: 1, endAt: Date.now() - 60000 } });
  await assertFails(stu('u1').ref('answers/late/20261234/a/q1').set(1)); // 시간이 지남(교수가 종료를 안 눌러도)
  await seed({ 'exams/grace': { status: 'running', startAt: 1, endAt: Date.now() - 3000 } });
  await assertSucceeds(stu('u1').ref('answers/grace/20261234').update({ 'a/q1': 1, submittedAt: 9 })); // 자동 제출 여유 20초
  await assertSucceeds(stu('u1').ref('answers/run/20261234').update({ 'a/q1': 1, submittedAt: 9 }));
  await assertFails(stu('u1').ref('answers/run/20261234/a/q1').set(2)); // 제출 후
  await assertFails(stu('u1').ref('answers/run/20261234/submittedAt').remove());
  await assertSucceeds(prof().ref('answers/run/20261234/submittedAt').remove()); // 교수는 제출 취소 가능
  await assertSucceeds(stu('u1').ref('answers/run/20261234/a/q1').set(2));
});

test('서술형 점수: 공개 뒤 자기 것만 읽고, 학생은 못 쓴다', async () => {
  await enter('u1', '20261234', '홍길동', 'A');
  await enter('u2', '20261235', '김철수', 'B');
  await seed({ 'essay/done/20261234/q1': 7, 'essay/open/20261234/q1': 7, 'essay/open/20261235/q1': 3 });
  await assertFails(stu('u1').ref('essay/done/20261234').get());
  await assertSucceeds(stu('u1').ref('essay/open/20261234').get());
  await assertFails(stu('u1').ref('essay/open/20261235').get());
  await assertFails(stu('u1').ref('essay/open').get());
  await assertFails(stu('u1').ref('essay/open/20261234/q1').set(10));
});
