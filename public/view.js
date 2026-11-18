// 학생이 보는 문항 화면 조각 — 학생 화면(app.js)과 교수의 "학생 화면으로 보기"(prof.js)가 함께 씁니다.
import * as C from './core.js';
import { esc } from './ui.js';

export const imgSrc = (q, imgs) => !q.img ? '' : q.img.startsWith('img:') ? (imgs[q.img.slice(4)] || '') : q.img;
export function media(q, imgs) {
  let h = '';
  const src = imgSrc(q, imgs);
  if (src) h += `<div class="pic" data-a="zoom" role="button" aria-label="사진 크게 보기"><img src="${esc(src)}" alt="문제 사진" draggable="false"></div>`;
  if (q.video) {
    const y = C.youtubeId(q.video);
    h += y ? `<div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${y}?playsinline=1&rel=0&modestbranding=1" title="문제 영상" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
      : `<div class="vid"><video src="${esc(q.video)}" controls playsinline controlslist="nodownload"></video></div>`;
  }
  return h;
}
export const typeChip = q => `${q.t === 'image' || q.t === 'video' ? C.TYPE_NAME[q.t] + ' · ' : ''}${C.KIND_NAME[q.k] || '문제'} · ${q.pts}점`;

// 답하는 칸. o.opt 는 "화면 칸 → 원래 보기 번호", a 는 지금까지 저장된 답.
// pick/tick 은 눌렀을 때 불릴 동작 이름입니다(미리 보기에서는 다른 이름을 씁니다).
export function answerHtml(q, o, a, pick = 'pick', tick = 'tick') {
  let body;
  if (q.k === 'choice') body = o.opt.map((orig, slot) => `<button class="opt ${a === orig ? 'on' : ''}" data-a="${pick}" data-v="${orig}" aria-pressed="${a === orig}"><span class="n">${slot + 1}</span><span>${esc(q.opts[orig])}</span></button>`).join('');
  else if (q.k === 'check') { const sel = C.unpackChecks(a); body = '<div class="sm">맞는 것을 모두 고르세요.</div>' + o.opt.map((orig, slot) => `<button class="opt sq ${sel.includes(orig) ? 'on' : ''}" data-a="${tick}" data-v="${orig}" aria-pressed="${sel.includes(orig)}"><span class="n">${sel.includes(orig) ? '✓' : slot + 1}</span><span>${esc(q.opts[orig])}</span></button>`).join(''); }
  else if (q.k === 'dropdown') body = `<select class="in" id="dd" aria-label="답 고르기"><option value="">눌러서 고르세요</option>${o.opt.map(orig => `<option value="${orig}" ${a === orig ? 'selected' : ''}>${esc(q.opts[orig])}</option>`).join('')}</select>`;
  else if (q.k === 'short') body = `<input class="in" id="short" placeholder="답을 짧게 쓰세요" maxlength="100" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${esc(a || '')}">`;
  else body = `<textarea class="in ta" id="essay" placeholder="여기에 답을 쓰세요" maxlength="4000" autocomplete="off" autocorrect="off" spellcheck="false">${esc(a || '')}</textarea><div class="sm" id="count">${(a || '').length}자</div>`;
  return body;
}
