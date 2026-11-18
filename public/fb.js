// Firebase 연결 — 화면 코드(app.js)는 이 얇은 창구만 씁니다.
const V = 'https://www.gstatic.com/firebasejs/12.12.1/';

// opts.name 을 주면 기본 로그인과 따로 노는 두 번째 로그인을 만듭니다(교수 기기에서 '학생으로 테스트').
// opts.session 이면 로그인을 이 탭에만 기억합니다(탭마다 다른 테스트 학생).
export async function createBackend(config, opts = {}) {
  const [{ initializeApp }, D, A] = await Promise.all([
    import(V + 'firebase-app.js'), import(V + 'firebase-database.js'), import(V + 'firebase-auth.js'),
  ]);
  const app = opts.name ? initializeApp(config, opts.name) : initializeApp(config), db = D.getDatabase(app);
  const auth = opts.session ? A.initializeAuth(app, { persistence: A.browserSessionPersistence }) : A.getAuth(app);
  const R = p => (p ? D.ref(db, p) : D.ref(db));
  let offset = 0, connected = false; const connCbs = new Set();
  D.onValue(R('.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  D.onValue(R('.info/connected'), s => { connected = !!s.val(); connCbs.forEach(f => f(connected)); });

  return {
    onAuth: cb => A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, anon: u.isAnonymous, email: u.email || '' } : null)),
    signInAnon: () => A.signInAnonymously(auth),
    signInGoogle: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signOut: () => A.signOut(auth),
    get: async p => (await D.get(R(p))).val(),
    set: (p, v) => D.set(R(p), v),
    update: (p, obj) => D.update(R(p), obj),
    push: (p, v) => D.push(R(p), v),
    remove: p => D.remove(R(p)),
    on: (p, cb, onErr) => D.onValue(R(p), s => cb(s.val()), e => { if (onErr) onErr(e); }),
    now: () => Date.now() + offset,   // 기기 시계가 틀려도 서버 시각 기준
    onConnected: cb => { connCbs.add(cb); cb(connected); return () => connCbs.delete(cb); },
  };
}
