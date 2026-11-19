// 여러 파일이 함께 쓰는 상태
export const S = {
  user: null,      // { uid, anon, email }
  role: '',        // 'student' | 'prof'
  me: null,        // 학생: { sid, name, cls }
  exams: {},       // 시험 정보 목록 (정답 없음)
  classes: ['A반', 'B반'],   // 교수가 정한 반 이름
  needCode: false,           // 입장 코드를 써야 하는지
  took: {},                  // 학생: 끝난 시험을 봤는지 (시험 id → true/false)
};
export let be = null;                 // 서버 창구 (fb.js 또는 테스트용 mock.js)
export const setBackend = b => { be = b; };
// 안드로이드 앱 안에서 열렸을 때만 있는 연결 통로 (3단계에서 앱이 넣어 줍니다)
export const APP = window.PureunApp || null;
export const parse = (rec, fallback) => { try { return rec && rec.data ? JSON.parse(rec.data) : fallback; } catch (e) { return fallback; } };
