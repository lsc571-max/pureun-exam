// 저장 · 이어 풀기 자동 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnswerStore } from '../public/save.js';

const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };
const tick = () => new Promise(r => setTimeout(r, 0));
// 서버 흉내: online=false 면 실패
function server() {
  const s = { data: {}, online: true, calls: 0, gate: null };
  s.send = async patch => { s.calls++; if (s.gate) await s.gate; if (!s.online) throw new Error('offline'); Object.assign(s.data, patch); };
  return s;
}

test('고르는 즉시 서버에 저장된다', async () => {
  const sv = server(), st = createAnswerStore({ key: 'k', storage: memStorage(), send: sv.send });
  st.load({});
  st.set('q1', 2); st.set('q2', '서술형');
  await tick(); await tick();
  assert.deepEqual(sv.data, { q1: 2, q2: '서술형' });
  assert.equal(st.status(), 'saved'); assert.equal(st.pending(), 0);
});

test('같은 답을 다시 눌러도 또 보내지 않는다', async () => {
  const sv = server(), st = createAnswerStore({ key: 'k', storage: memStorage(), send: sv.send });
  st.load({ q1: 2 });
  st.set('q1', 2); await tick();
  assert.equal(sv.calls, 0);
});

test('연결이 끊기면 기기에 남기고, 다시 연결되면 보낸다', async () => {
  const sv = server(), storage = memStorage(); let retry = null; const seen = [];
  const st = createAnswerStore({ key: 'k', storage, send: sv.send, onStatus: s => seen.push(s), timer: fn => { retry = fn; } });
  st.load({});
  sv.online = false;
  st.set('q1', 1); await tick();
  assert.equal(st.status(), 'offline'); assert.equal(st.pending(), 1); assert.deepEqual(sv.data, {});
  assert.deepEqual(JSON.parse(storage.m.get('k')).a, { q1: 1 });
  sv.online = true; await retry(); await tick();
  assert.deepEqual(sv.data, { q1: 1 }); assert.equal(st.status(), 'saved');
  assert.deepEqual(seen, ['saving', 'offline', 'saving', 'saved']);
});

test('앱이 꺼졌다 켜져도 이어서 푼다 (서버에 못 보낸 답 포함)', async () => {
  const sv = server(), storage = memStorage();
  let st = createAnswerStore({ key: 'k', storage, send: sv.send, timer: () => {} });
  st.load({});
  st.set('q1', 3); await tick();           // 서버까지 저장됨
  sv.online = false;
  st.set('q2', '쓰다 만 답'); await tick(); // 기기에만 있음
  // --- 앱 종료 후 다시 실행 ---
  sv.online = true;
  st = createAnswerStore({ key: 'k', storage, send: sv.send });
  const restored = st.load({ ...sv.data });
  assert.deepEqual(restored, { q1: 3, q2: '쓰다 만 답' });
  await tick(); await tick();
  assert.deepEqual(sv.data, { q1: 3, q2: '쓰다 만 답' });
});

test('다른 기기에서 저장한 답(서버)이 기기의 옛 백업보다 우선한다', () => {
  const storage = memStorage();
  storage.setItem('k', JSON.stringify({ a: { q1: 0, q2: 1 }, dirty: {} }));
  const st = createAnswerStore({ key: 'k', storage, send: async () => {} });
  assert.deepEqual(st.load({ q1: 3 }), { q1: 3 });
});

test('보내는 중에 답을 바꾸면 마지막 답이 저장된다', async () => {
  const sv = server(); let open; sv.gate = new Promise(r => { open = r; });
  const st = createAnswerStore({ key: 'k', storage: memStorage(), send: sv.send });
  st.load({});
  st.set('q1', 0); st.set('q1', 1); st.set('q1', 2);
  sv.gate = null; open();
  await tick(); await tick(); await tick();
  assert.equal(sv.data.q1, 2); assert.equal(st.pending(), 0); assert.equal(st.status(), 'saved');
});

test('제출 뒤에는 더 저장하지 않고 기기 백업을 지운다', async () => {
  const sv = server(), storage = memStorage();
  const st = createAnswerStore({ key: 'k', storage, send: sv.send });
  st.load({}); st.set('q1', 1); await tick();
  st.close();
  st.set('q1', 2); await tick();
  assert.equal(sv.data.q1, 1); assert.equal(storage.m.has('k'), false);
});

test('기기 저장 공간이 막혀 있어도 서버 저장은 된다', async () => {
  const sv = server();
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const st = createAnswerStore({ key: 'k', storage: broken, send: sv.send });
  st.load({ q0: 1 }); st.set('q1', 2); await tick(); await tick();
  assert.deepEqual(sv.data, { q1: 2 });
});

test('제출 직전: 보내는 중인 답까지 모두 들어간 뒤에야 끝난다', async () => {
  const sv = server(); let open; sv.gate = new Promise(r => { open = r; });
  const st = createAnswerStore({ key: 'k', storage: memStorage(), send: sv.send });
  st.load({});
  st.set('q1', '쓰는 중');            // 보내는 중(막혀 있음)
  st.set('q1', '쓰는 중 — 마지막 글자까지');
  setTimeout(() => { sv.gate = null; open(); }, 30);
  assert.equal(await st.drain(2000), true);
  assert.equal(sv.data.q1, '쓰는 중 — 마지막 글자까지'); assert.equal(st.pending(), 0);
});

test('제출 직전: 연결이 끊겨 있으면 기다리다 포기하고, 답은 기기에 남는다', async () => {
  const sv = server(), storage = memStorage();
  const st = createAnswerStore({ key: 'k', storage, send: sv.send, timer: () => {} });
  st.load({}); sv.online = false;
  st.set('q1', 1);
  assert.equal(await st.drain(300), false);
  assert.equal(st.pending(), 1); assert.deepEqual(JSON.parse(storage.m.get('k')).a, { q1: 1 });
  sv.online = true;
  assert.equal(await st.drain(1000), true); assert.deepEqual(sv.data, { q1: 1 });
});
