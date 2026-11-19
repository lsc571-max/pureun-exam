// 화면 공통 도구: 글자 안전 처리, 알림, 겹쳐 뜨는 창, 사진 확대, 버튼 연결
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

let toastT = 0, toastFn = null;
export function hideToast() { clearTimeout(toastT); toastFn = null; $('toast').hidden = true; }
// action: { label, fn } 을 주면 알림 안에 누를 수 있는 버튼이 생깁니다 (예: 되돌리기)
export function toast(msg, ms = 2600, action = null) {
  const t = $('toast'); toastFn = action ? action.fn : null;
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-a="toast-act">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; toastFn = null; }, ms);
}

/* 버튼 연결: <button data-a="이름"> 을 누르면 등록한 함수가 불립니다 */
const acts = {};
export const on = (name, fn) => { acts[name] = fn; };
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = acts[el.dataset.a];
  if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch(err => { console.error(err); toast(errText(err)); }); }
});
export function errText(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/PERMISSION_DENIED|permission_denied/i.test(m)) return '권한이 없거나 지금은 할 수 없는 작업이에요.';
  if (/network|offline|disconnected/i.test(m)) return '인터넷 연결을 확인해 주세요.';
  return (e && e.message) || '문제가 생겼어요. 다시 해 보세요.';
}

/* 겹쳐 뜨는 창 */
export function modal(html, { wide = false, sticky = false } = {}) {
  const m = $('modal');
  m.innerHTML = `<div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false; m.dataset.sticky = sticky ? '1' : '';
  return m.firstElementChild;
}
export function closeModal() { const m = $('modal'); m.hidden = true; m.innerHTML = ''; if (pending) { const p = pending; pending = null; p(false); } }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('modal').dataset.sticky) closeModal(); });
let pending = null;
export function confirmBox(title, body = '', okLabel = '확인', { danger = false, cancel = '취소' } = {}) {
  return new Promise(res => {
    modal(`<h2>${esc(title)}</h2>${body ? `<div class="txt">${body}</div>` : ''}
      <div class="row"><button class="btn gh" data-a="dlg-no">${esc(cancel)}</button><button class="btn ${danger ? 'red' : ''}" data-a="dlg-yes">${esc(okLabel)}</button></div>`, { sticky: true });
    pending = res;
  });
}
on('toast-act', () => { const f = toastFn; toastFn = null; $('toast').hidden = true; if (f) return f(); });
on('dlg-yes', () => { const p = pending; pending = null; closeModal(); if (p) p(true); });
on('dlg-no', () => closeModal());
on('modal-close', () => closeModal());

/* 사진 확대: 누르면 크게, 한 번 더 누르면 2.5배(끌어서 이동), 또 누르면 닫힘 */
export function zoom(src) { const z = $('zoom'); z.querySelector('img').src = src; z.classList.remove('z'); z.hidden = false; z.scrollTo(0, 0); }
$('zoom').addEventListener('click', () => { const z = $('zoom'); if (z.classList.contains('z')) { z.hidden = true; z.classList.remove('z'); } else { z.classList.add('z'); z.scrollTo((z.scrollWidth - z.clientWidth) / 2, (z.scrollHeight - z.clientHeight) / 2); } });
export const closeZoom = () => { $('zoom').hidden = true; };

export const hhmmss = ts => { if (!ts) return ''; const d = new Date(ts), p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
export function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} ta.remove(); return ok;
  }
}
// 사진을 긴 쪽 1280px 이하 JPEG 로 줄입니다 (무료 요금제 저장·전송량 절약)
export function shrinkImage(file, max = 1280, q = 0.82) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했어요.')); };
    img.src = url;
  });
}

/* 5 · 4 · 3 · 2 · 1 — 화면 가운데에 크게, 연하게 보여 준 뒤 끝나면 이어서 진행합니다 */
export function countdown(n = 5) {
  const step = window.__cdMs || 1000;   // (자동 테스트에서는 짧게)
  return new Promise(done => {
    const el = document.createElement('div'); el.className = 'cdown'; el.setAttribute('role', 'status');
    document.body.appendChild(el);
    let i = n;
    const show = () => { el.innerHTML = `<div><span class="num">${i}</span><span class="lbl">곧 시작합니다</span></div>`; };
    show();
    const t = setInterval(() => {
      if (--i > 0) return show();
      clearInterval(t); el.classList.add('out');
      setTimeout(() => { el.remove(); done(); }, 260);
    }, step);
  });
}
