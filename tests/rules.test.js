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
// 학생 입장: 반·학번·이름을 쓰고, 그 학번을 이 기기에 묶습니다 (한 번에)
const enter = (uid, sid, name, cls, extra = {}) => stu(uid).ref().update({
  [`users/${uid}`]: { sid, name, cls, at: Date.now(), ...extra },
  [`bind/${sid}`]: uid,
});
const A = '20261234', B = '20261235';
const ans = (uid, exam, sid = A) => stu(uid).ref(`answers/${exam}/${sid}`);
const begin = (uid, exam, sid = A) => ans(uid, exam, sid).update({ startedAt: Date.now(), sess: 's1', dev: 'web test' });

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
    'classes/A반': 0, 'classes/B반': 1,
    // 진행 중인 시험
    'exams/run': { title: '진행 중', status: 'running', startAt: now - 60000, endAt: now + 600000, released: false },
    'sheets/run': { data: '[]' }, 'keys/run': { data: '{}' }, 'images/run/i1': 'data:x',
    // 아직 시작 전 (대기실)
    'exams/wait': { title: '대기', status: 'open', released: false },
    'sheets/wait': { data: '[]' }, 'keys/wait': { data: '{}' },
    // 끝났고 결과 공개 전
    'exams/done': { title: '종료', status: 'ended', startAt: now - 7200000, endAt: now - 3600000, released: false },
    'sheets/done': { data: '[]' }, 'keys/done': { data: '{}' },
    // 끝났고 결과 공개됨
    'exams/open': { title: '공개', status: 'ended', startAt: now - 7200000, endAt: now - 3600000, released: true },
    'sheets/open': { data: '[]' }, 'keys/open': { data: '{}' },
    // 문제풀이 공개 (시험으로 열지 않은 문항 묶음)
    'exams/prac': { title: '연습', status: 'draft', practice: true },
    'sheets/prac': { data: '[]' }, 'keys/prac': { data: '{}' },
    'drafts/run': { data: '[]' },
  });
});

test('로그인하지 않으면 아무것도 못 읽는다', async () => {
  for (const p of ['exams', 'classes', 'sheets/run', 'keys/open', 'answers', 'users', 'bind', 'drafts', 'entry', 'entry/need'])
    await assertFails(nobody().ref(p).get());
});

test('교수: 처음 한 번만 관리자로 등록되고, 그 뒤 다른 계정은 못 한다', async () => {
  await env.clearDatabase();
  await assertFails(stu('s1').ref('admins/s1').set(true)); // 익명 로그인은 안 됨
  await assertFails(env.authenticatedContext('g1', GOOGLE).database().ref('admins/g2').set(true)); // 남의 자리
  await assertSucceeds(env.authenticatedContext('g1', GOOGLE).database().ref('admins/g1').set(true));
  await assertFails(env.authenticatedContext('g2', GOOGLE).database().ref('admins/g2').set(true)); // 이미 있음
  await assertFails(env.authenticatedContext('g2', GOOGLE).database().ref('drafts').get());
  await assertFails(env.authenticatedContext('g2', GOOGLE).database().ref('admins/g1').remove());
});

test('교수: 문제·정답·전체 답안·입장한 학생을 읽고 쓴다', async () => {
  for (const p of ['drafts', 'sheets/wait', 'keys/wait', 'answers', 'users', 'bind', 'essay', 'entry'])
    await assertSucceeds(prof().ref(p).get());
  await assertSucceeds(prof().ref().update({ 'drafts/x': { data: '[]' }, 'sheets/x': { data: '[]' }, 'keys/x': { data: '{}' }, 'exams/x/title': 't' }));
  await assertSucceeds(prof().ref('essay/run/20261234/q1').set(5));
  await assertSucceeds(prof().ref('classes').set({ '기계과': 0 }));
});

test('입장: 반·학번·이름을 입력하면 들어오고, 형식이 틀리면 못 들어온다', async () => {
  await assertFails(enter('u1', '12', '홍길동', 'A반'));              // 학번이 너무 짧음
  await assertFails(enter('u1', '2026/1234', '홍길동', 'A반'));       // 학번에 쓸 수 없는 글자
  await assertFails(enter('u1', A, '', 'A반'));                       // 이름 없음
  await assertFails(enter('u1', A, '가'.repeat(21), 'A반'));          // 이름이 너무 김
  await assertFails(enter('u1', A, '홍길동', ''));                    // 반 없음
  await assertFails(enter('u1', A, '홍길동', 'C반'));                 // 교수가 만들지 않은 반
  await assertFails(enter('u1', A, '홍길동', 'A반', { at: 'x'.repeat(1000) }));   // 시각 자리에 큰 글자
  await assertFails(enter('u1', A, '홍길동', 'A반', { role: 'admin' }));          // 정해지지 않은 칸
  await assertFails(stu('u1').ref('users/u1').set({ sid: A, name: '홍길동', cls: 'A반' })); // 기기 묶음 없이
  await assertFails(stu('u1').ref(`bind/${A}`).set('u1'));            // 이름 없이 묶기만
  await assertFails(stu('u1').ref('classes/C반').set(2));             // 학생은 반을 못 만든다
  await assertSucceeds(enter('u1', A, '홍길동', 'A반'));
  await assertSucceeds(stu('u1').ref('users/u1').get());
  await assertSucceeds(stu('u1').ref('classes').get());
});

test('입장 코드: 교수가 켜 두면 코드를 아는 학생만 들어온다', async () => {
  await seed({ 'entry/code': '4821', 'entry/need': true });
  await assertSucceeds(stu('u1').ref('entry/need').get());            // 코드가 필요한지는 알 수 있지만
  await assertFails(stu('u1').ref('entry/code').get());               // 코드는 읽을 수 없다
  await assertFails(stu('u1').ref('entry').get());
  await assertFails(enter('u1', A, '홍길동', 'A반'));
  await assertFails(enter('u1', A, '홍길동', 'A반', { code: '0000' }));
  await assertSucceeds(enter('u1', A, '홍길동', 'A반', { code: '4821' }));
  await assertFails(stu('u1').ref('entry/code').set('1111'));
});

test('두 기기 금지: 이미 묶인 학번으로 다른 기기는 못 들어온다', async () => {
  await assertSucceeds(enter('u1', A, '홍길동', 'A반'));
  await assertFails(enter('u2', A, '홍길동', 'A반'));
  await assertFails(stu('u2').ref(`bind/${A}`).set('u2'));
  await assertFails(enter('u1', '20269999', '홍길동', 'A반'));       // 한 기기로 두 학번
  await assertFails(stu('u1').ref(`bind/${A}`).remove());             // 학생이 스스로 풀 수 없음
  await assertFails(stu('u1').ref('users/u1').remove());
  await assertFails(stu('u1').ref('users/u1/sid').set(B));            // 학번 바꿔치기
  // 교수가 입장을 취소하면 새 기기로 들어온다
  await assertSucceeds(prof().ref().update({ [`bind/${A}`]: null, 'users/u1': null }));
  await assertSucceeds(enter('u2', A, '홍길동', 'A반'));
});

test('학생은 남의 정보·관리자 목록·원본 문항을 못 읽는다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  for (const p of ['users', 'users/u2', 'bind', `bind/${B}`, 'admins', 'drafts', 'drafts/run'])
    await assertFails(stu('u1').ref(p).get());
  await assertSucceeds(stu('u1').ref('exams').get());
  await assertFails(stu('u1').ref('exams/run/status').set('ended'));
  await assertFails(stu('u1').ref('exams/run/endAt').set(Date.now() + 9e9));
});

test('문제지: 시험을 시작한 학생만 받는다', async () => {
  await assertFails(stu('ghost').ref('sheets/run').get());            // 입장 안 한 익명 사용자
  await enter('u1', A, '홍길동', 'A반');
  await assertFails(stu('u1').ref('sheets/wait').get());              // 대기실
  await assertFails(stu('u1').ref('sheets').get());
  await assertFails(stu('u1').ref('sheets/run').get());               // 입장만 하고 시작 기록이 없으면 못 받음
  await assertFails(stu('u1').ref('images/run').get());
  await assertSucceeds(begin('u1', 'run'));
  await assertSucceeds(stu('u1').ref('sheets/run').get());
  await assertSucceeds(stu('u1').ref('images/run').get());
  await assertFails(stu('u1').ref('sheets/done').get());              // 응시하지 않은 끝난 시험
  await seed({ [`answers/open/${A}/startedAt`]: Date.now() - 5000000 });
  await assertSucceeds(stu('u1').ref('sheets/open').get());           // 응시했던 시험은 결과 볼 때 다시 받음
  await assertSucceeds(stu('u1').ref('sheets/prac').get());           // 문제풀이
  await assertFails(stu('u1').ref('sheets/run').set({ data: 'x' }));
});

test('정답지: 결과 공개 전에는 학생 기기로 내려가지 않는다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  await begin('u1', 'run');
  await assertFails(stu('u1').ref('keys/run').get());   // 시험 중
  await assertFails(stu('u1').ref('keys/done').get());  // 끝났지만 공개 전
  await assertFails(stu('u1').ref('keys/wait').get());
  await assertFails(stu('u1').ref('keys').get());
  await assertSucceeds(stu('u1').ref('keys/open').get()); // 공개 후
  await assertSucceeds(stu('u1').ref('keys/prac').get()); // 문제풀이
  await assertFails(stu('ghost').ref('keys/open').get());
  await assertFails(stu('u1').ref('keys/open').set({ data: 'x' }));
});

test('문제풀이 공개가 켜진 채로 시험을 열어도 정답은 새지 않는다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  await seed({ 'exams/wait/practice': true, 'exams/run/practice': true });
  await assertFails(stu('u1').ref('keys/wait').get());   // 대기실
  await assertFails(stu('u1').ref('sheets/wait').get());
  await assertFails(stu('u1').ref('keys/run').get());    // 진행 중
  await begin('u1', 'run');
  await assertFails(stu('u1').ref('keys/run').get());
});

test('답안: 자기 것만 쓰고 읽는다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  await enter('u2', B, '김철수', 'B반');
  await assertSucceeds(begin('u1', 'run'));
  await assertSucceeds(ans('u1', 'run').update({ 'a/q1': 2, 'a/q2': '서술형 답', 'a/q3': '0,2' }));
  await assertSucceeds(ans('u1', 'run').child('ev').push({ t: 'leave', at: Date.now() }));
  await assertSucceeds(ans('u1', 'run').get());
  await assertFails(ans('u2', 'run').get());
  await assertFails(ans('u2', 'run').child('a/q1').set(0));
  await assertFails(ans('u2', 'run').child('submittedAt').set(Date.now()));   // 남을 대신 제출
  await assertFails(stu('u1').ref('answers/run').get());
  await assertFails(ans('u1', 'run').child('score').set(100));               // 정해진 칸만
  await assertFails(ans('u1', 'run').child('a/q1').set({ x: 1 }));
  await assertFails(ans('u1', 'run').child('a/q9').set('가'.repeat(5001)));
  await assertFails(ans('u1', 'run').child('a/' + 'k'.repeat(25)).set(1));    // 문항 번호 자리에 긴 글자
  await assertFails(ans('u1', 'run').child('a').set('한 덩어리'));
});

test('이탈 기록과 시작 기록은 학생이 지우거나 고칠 수 없다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  await begin('u1', 'run');
  const ev = ans('u1', 'run').child('ev').push();
  await assertSucceeds(ev.set({ t: 'leave', at: Date.now() }));
  await assertFails(ev.remove());                                             // 지우기
  await assertFails(ev.set({ t: 'back', at: Date.now() }));                   // 덮어쓰기
  await assertFails(ev.child('t').set('back'));
  await assertFails(ans('u1', 'run').child('ev').remove());
  await assertFails(ans('u1', 'run').update({ ev: null }));
  await assertFails(ans('u1', 'run').child('ev').set('없음'));
  await assertFails(ans('u1', 'run').child('ev').push({ t: 'leave', at: 5 }));               // 엉뚱한 시각
  await assertFails(ans('u1', 'run').child('ev').push({ t: 'leave', at: Date.now(), x: 'y' })); // 덧붙인 칸
  await assertFails(ans('u1', 'run').remove());                               // 답안 통째로 지워 "미응시"로 위장
  await assertFails(ans('u1', 'run').child('startedAt').remove());
  await assertFails(ans('u1', 'run').child('startedAt').set(Date.now()));     // 시작 시각 고치기
  await assertFails(stu('u1').ref('answers/run').remove());
  await assertSucceeds(prof().ref(`answers/run/${A}`).remove());              // 교수는 초기화할 수 있다
  await assertFails(ans('u1', 'run').update({ startedAt: 12345 }));           // 처음 쓰는 것이라도 엉뚱한 시각은 안 됨
});

test('답안: 시작 전·종료 후·제출 후에는 못 고친다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  await assertFails(ans('u1', 'wait').child('a/q1').set(1));   // 시작 전
  await assertFails(begin('u1', 'wait'));
  await assertFails(ans('u1', 'done').child('a/q1').set(1));   // 종료 후
  await seed({ 'exams/late': { status: 'running', startAt: 1, endAt: Date.now() - 60000 } });
  await assertFails(ans('u1', 'late').child('a/q1').set(1));   // 시간이 지남(교수가 종료를 안 눌러도)
  await seed({ 'exams/grace': { status: 'running', startAt: 1, endAt: Date.now() - 3000 } });
  await assertSucceeds(ans('u1', 'grace').update({ 'a/q1': 1, submittedAt: Date.now() })); // 자동 제출 여유 20초
  await begin('u1', 'run');
  await assertFails(ans('u1', 'run').update({ submittedAt: 9 }));             // 엉뚱한 제출 시각
  await assertSucceeds(ans('u1', 'run').update({ 'a/q1': 1, submittedAt: Date.now() }));
  await assertFails(ans('u1', 'run').child('a/q1').set(2));    // 제출 후
  await assertFails(ans('u1', 'run').child('ev').push({ t: 'leave', at: Date.now() }));
  await assertFails(ans('u1', 'run').child('submittedAt').remove());
  await assertSucceeds(prof().ref(`answers/run/${A}/submittedAt`).remove()); // 교수는 제출 취소 가능
  await assertSucceeds(ans('u1', 'run').child('a/q1').set(2));
  await assertSucceeds(prof().ref(`answers/run/${B}/submittedAt`).set(Date.now())); // 교수의 "제출 처리"
});

test('장문형 점수: 공개 뒤 자기 것만 읽고, 학생은 못 쓴다', async () => {
  await enter('u1', A, '홍길동', 'A반');
  await enter('u2', B, '김철수', 'B반');
  await seed({ [`essay/done/${A}/q1`]: 7, [`essay/open/${A}/q1`]: 7, [`essay/open/${B}/q1`]: 3 });
  await assertFails(stu('u1').ref(`essay/done/${A}`).get());
  await assertSucceeds(stu('u1').ref(`essay/open/${A}`).get());
  await assertFails(stu('u1').ref(`essay/open/${B}`).get());
  await assertFails(stu('u1').ref('essay/open').get());
  await assertFails(stu('u1').ref(`essay/open/${A}/q1`).set(10));
});
