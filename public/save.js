// 답안 저장소 — 고르는 즉시 기기에 적어 두고(백업), 서버에 보냅니다.
// 보내는 중에 앱이 꺼져도 다음에 켜면 기기에 남은 답을 다시 보냅니다. (tests/save.test.js)

export function createAnswerStore({ key, storage, send, onStatus = () => {}, retryMs = 4000, timer = setTimeout }) {
  let answers = {}, dirty = {}, sending = false, closed = false, status = 'saved';
  const read = () => { try { return JSON.parse(storage.getItem(key) || 'null') || {}; } catch (e) { return {}; } };
  const persist = () => { try { storage.setItem(key, JSON.stringify({ a: answers, dirty })); } catch (e) { /* 저장 공간이 없어도 서버 저장은 계속 */ } };
  const setStatus = s => { if (s !== status) { status = s; onStatus(s); } };

  async function flush() {
    if (sending || closed) return;
    const ids = Object.keys(dirty);
    if (!ids.length) { setStatus('saved'); return; }
    sending = true; setStatus('saving');
    const sent = {}; for (const id of ids) sent[id] = answers[id];
    let ok = false;
    try { await send(sent); ok = true; } catch (e) { ok = false; }
    sending = false;
    if (ok) {
      // 보내는 사이에 다시 고친 답은 dirty 로 남겨 둡니다.
      for (const id of ids) if (answers[id] === sent[id]) delete dirty[id];
      persist();
      if (Object.keys(dirty).length) return flush();
      setStatus('saved');
    } else {
      setStatus('offline');
      if (!closed) timer(flush, retryMs);
    }
  }

  return {
    // remote: 서버에 저장돼 있던 답. 기기에만 남아 있던(dirty) 답이 있으면 그것을 우선해 다시 보냅니다.
    load(remote) {
      const local = read();
      answers = { ...(remote || {}) }; dirty = {};
      for (const id of Object.keys(local.dirty || {})) {
        if (local.a && id in local.a) { answers[id] = local.a[id]; dirty[id] = true; }
      }
      persist();
      if (Object.keys(dirty).length) flush();
      return { ...answers };
    },
    get: id => answers[id],
    all: () => ({ ...answers }),
    set(id, val) {
      if (closed) return;
      if (answers[id] === val) return;
      answers[id] = val; dirty[id] = true;
      persist(); setStatus('saving');
      flush();
    },
    flush,
    // 남은 답이 모두 서버에 들어갈 때까지 기다립니다 (최대 ms). 다 들어갔으면 true.
    async drain(ms = 6000, sleep = t => new Promise(r => setTimeout(r, t))) {
      const until = Date.now() + ms;
      while (Object.keys(dirty).length && Date.now() < until) { await flush(); if (Object.keys(dirty).length) await sleep(120); }
      return !Object.keys(dirty).length;
    },
    pending: () => Object.keys(dirty).length,
    status: () => status,
    // 제출 뒤에는 더 보내지 않습니다. 기기 백업도 지웁니다.
    close(clear = true) { closed = true; if (clear) { try { storage.removeItem(key); } catch (e) {} } },
  };
}
