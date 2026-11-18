// 자동 화면 테스트용 가짜 서버 (localhost 에서 ?mock 으로만 켜지고, 배포에는 올라가지 않습니다)
// 데이터는 localStorage 에 두어 여러 탭(교수·학생)이 함께 봅니다. 로그인은 탭마다 따로(sessionStorage).

export async function createBackend(config, opts = {}) {
  const UKEY = 'mockuser' + (opts.name ? ':' + opts.name : '');
  const KEY = 'mockdb', bc = new BroadcastChannel('mockdb');
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const subs = new Set(), authCbs = new Set();
  const seg = p => String(p || '').split('/').filter(Boolean);
  const at = (o, p) => { for (const k of seg(p)) { if (o == null) return null; o = o[k]; } return o === undefined ? null : o; };
  const put = (o, p, v) => {
    const ks = seg(p); if (!ks.length) return;
    let cur = o; const trail = [];
    for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; trail.push([cur, k]); cur = cur[k]; }
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete cur[last]; else cur[last] = JSON.parse(JSON.stringify(v));
    for (let i = trail.length - 1; i >= 0; i--) { const [par, k] = trail[i]; if (par[k] && typeof par[k] === 'object' && !Object.keys(par[k]).length) delete par[k]; }
  };
  const fire = () => subs.forEach(s => { const v = JSON.stringify(at(load(), s.p)); if (v !== s.last) { s.last = v; s.cb(JSON.parse(v)); } });
  bc.onmessage = fire;
  const commit = db => { localStorage.setItem(KEY, JSON.stringify(db)); bc.postMessage(1); fire(); };
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem(UKEY) || 'null'); } catch (e) {}
  const setUser = u => { user = u; sessionStorage.setItem(UKEY, JSON.stringify(u)); authCbs.forEach(f => f(u)); };
  const deny = () => { const e = new Error('PERMISSION_DENIED'); e.code = 'PERMISSION_DENIED'; return e; };

  // 실제 보안 규칙 중 화면 흐름에 영향을 주는 것만 흉내 냅니다 (전체 규칙은 tests/rules.test.js 가 검사)
  function check(db, path, v) {
    const ks = seg(path); if (!user) throw deny();
    const prof = at(db, 'admins/' + user.uid) === true;
    if (prof) return;
    if (ks[0] === 'admins') { if (user.anon || at(db, 'admins')) throw deny(); return; }
    const open = !at(db, 'roster');   // 명단이 없으면 누구나 입장
    if (ks[0] === 'bind') { const r = at(db, 'roster/' + ks[1]); if ((!open && !r) || at(db, path) != null) throw deny(); return; }
    if (ks[0] === 'users') { const r = at(db, 'roster/' + (v && v.sid)); const code = at(db, 'entry/code'); if ((!open && (!r || r.name !== v.name || r.cls !== v.cls)) || at(db, path) != null || (code && (!v || v.code !== code))) throw deny(); return; }
    if (ks[0] === 'answers') {
      const ex = at(db, 'exams/' + ks[1]) || {}, mine = at(db, 'bind/' + ks[2]) === user.uid;
      const me = at(db, `answers/${ks[1]}/${ks[2]}`) || {}, own = me.until || (me.startedAt && ex.minutes ? me.startedAt + ex.minutes * 60000 + (ex.extra || 0) : Infinity);
      if (!mine || ex.status !== 'running' || Date.now() >= ex.endAt + 20000 || Date.now() >= own + 20000 || (ks[3] === 'until' || ks[3] === 'unlock') || at(db, `answers/${ks[1]}/${ks[2]}/submittedAt`) != null) throw deny();
      return;
    }
    throw deny();
  }
  const write = async (pairs) => {
    await null;
    if (localStorage.getItem('mockoffline') === '1') throw new Error('offline');
    const db = load();
    for (const [p, v] of pairs) check(db, p, v);
    for (const [p, v] of pairs) put(db, p, v);
    commit(db);
  };
  const join = (a, b) => [a, b].filter(Boolean).join('/');

  return {
    onAuth: cb => { authCbs.add(cb); Promise.resolve().then(() => cb(user)); return () => authCbs.delete(cb); },
    signInAnon: async () => setUser({ uid: 'anon' + Math.random().toString(36).slice(2, 8), anon: true, email: '' }),
    signInGoogle: async () => { const n = new URLSearchParams(location.search).get('as') || 'prof'; setUser({ uid: 'g_' + n, anon: false, email: n + '@example.com' }); },
    signOut: async () => setUser(null),
    get: async p => at(load(), p),
    set: (p, v) => write([[p, v]]),
    update: (p, obj) => write(Object.entries(obj).map(([k, v]) => [join(p, k), v])),
    push: (p, v) => write([[join(p, 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), v]]),
    remove: p => write([[p, null]]),
    on: (p, cb) => { const s = { p, cb, last: undefined }; subs.add(s); Promise.resolve().then(() => { s.last = JSON.stringify(at(load(), p)); cb(JSON.parse(s.last)); }); return () => subs.delete(s); },
    now: () => Date.now(),
    onConnected: cb => { cb(true); return () => {}; },
  };
}
