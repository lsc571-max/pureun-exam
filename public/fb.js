// Firebase 연결 — 화면 코드(app.js)는 이 얇은 창구만 씁니다.
const V = 'https://www.gstatic.com/firebasejs/12.12.1/';

export async function createBackend(config) {
  const [{ initializeApp }, D, A] = await Promise.all([
    import(V + 'firebase-app.js'), import(V + 'firebase-database.js'), import(V + 'firebase-auth.js'),
  ]);
  const app = initializeApp(config), db = D.getDatabase(app), auth = A.getAuth(app);
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
