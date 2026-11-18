// 푸른시험 핵심 로직 — 화면·Firebase와 무관한 순수 함수만 둡니다. (tests/ 에서 자동 테스트)

export const LEVELS = ['상', '중', '하'];
// 답하는 방식 5가지 (구글 설문지와 같은 이름)
export const KINDS = ['short', 'long', 'choice', 'check', 'dropdown'];
export const KIND_NAME = { short: '단답형', long: '장문형', choice: '객관식', check: '체크박스', dropdown: '드롭다운' };
export const QTYPES = [...KINDS, 'image', 'video'];
export const TYPE_NAME = { intro: '안내', ...KIND_NAME, image: '그림 문제', video: '영상 문제', end: '마무리' };

export const isQuestion = p => !!p && QTYPES.includes(p.t);
// 답하는 방식: 그림·영상 문제는 ans 로 정하고, 없으면 내용으로 짐작합니다.
export function kindOf(p) {
  if (!isQuestion(p)) return '';
  if (KINDS.includes(p.t)) return p.t;
  if (KINDS.includes(p.ans)) return p.ans;
  if (Array.isArray(p.opts) && p.opts.length) return Array.isArray(p.a) ? 'check' : 'choice';
  return Array.isArray(p.answers) && p.answers.length ? 'short' : 'long';
}
export const hasOpts = k => k === 'choice' || k === 'check' || k === 'dropdown';
export const isManual = p => kindOf(p) === 'long';   // 교수가 직접 채점
// 단답형 비교: 띄어쓰기와 영문 대소문자를 무시합니다.
export const normAns = s => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, '').toLowerCase();
// 체크박스 답은 "0,2" 처럼 번호를 쉼표로 이어 저장합니다.
export const packChecks = arr => [...new Set(arr.map(Number).filter(Number.isInteger))].sort((a, b) => a - b).join(',');
export const unpackChecks = v => (v === undefined || v === null || v === '' ? [] : String(v).split(',').map(Number).filter(Number.isInteger));

/* ---------- 붙여 넣기 ---------- */
// AI가 코드 블록(```json … ```)으로 감싸거나 앞뒤에 설명을 붙여도 배열만 꺼냅니다.
export function parseBundle(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  let data;
  try { data = JSON.parse(s); } catch (e) {
    // 앞뒤에 설명이 붙어 있으면 첫 [ 와 짝이 맞는 ] 까지만 읽습니다.
    const a = s.indexOf('['); let b = -1, depth = 0, inStr = false;
    for (let i = a; a >= 0 && i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']' && --depth === 0) { b = i; break; }
    }
    try { data = JSON.parse(s.slice(a, b + 1)); } catch (e2) { throw new Error('JSON 형식이 아니에요. [ 로 시작해서 ] 로 끝나는 전체를 붙여 넣어 주세요.'); }
  }
  if (!Array.isArray(data)) data = [data];
  if (!data.length) throw new Error('문항이 하나도 없어요.');
  if (data.length > 200) throw new Error('한 번에 최대 200쪽까지만 넣을 수 있어요.');
  if (data.some(p => !p || typeof p !== 'object' || Array.isArray(p))) throw new Error('각 문항은 { } 로 감싼 형태여야 해요.');
  return data;
}

const str = v => (v == null ? '' : String(v)).trim();
export const newId = (rand = Math.random) => 'q' + Math.floor(rand() * 2176782336).toString(36).padStart(6, '0');
// 사진 값은 올린 사진(img:번호), 사진 자료(data:), 인터넷 주소(https://)만 받습니다. "(사진 있음)" 같은 글자는 버립니다.
export const validImg = v => /^(img:[A-Za-z0-9_-]+|data:image\/|https:\/\/)/.test(v || '');
const toInt = v => (Number.isInteger(v) ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? +v : null));

// 문항을 표준 모양으로 정리합니다. 모르는 값은 버리지 않고 안전한 기본값으로 바꿉니다.
export function normalizePage(p) {
  let t = str(p.t).toLowerCase();
  if (t === 'essay') t = 'long';                       // 예전 이름
  const o = { t };
  if (p.id && /^[A-Za-z0-9_-]{1,24}$/.test(String(p.id))) o.id = String(p.id);
  if (t === 'intro' || t === 'end') { o.title = str(p.title); o.body = str(p.body); return o; }
  o.q = str(p.q);
  const k = kindOf({ ...p, t });
  if (t === 'image' || t === 'video') o.ans = k;
  if (hasOpts(k)) {
    o.opts = Array.isArray(p.opts) ? p.opts.map(str) : [];
    if (k === 'check') o.a = [...new Set((Array.isArray(p.a) ? p.a : [p.a]).map(toInt).filter(v => v !== null))].sort((x, y) => x - y);
    else o.a = toInt(Array.isArray(p.a) ? p.a[0] : p.a);
  } else if (k === 'short') {
    const list = Array.isArray(p.answers) ? p.answers : (p.answers != null ? [p.answers] : (p.a != null && !Array.isArray(p.a) ? [p.a] : []));
    const seen = new Set(); o.answers = [];
    for (const x of list.map(str).filter(Boolean)) { const n = normAns(x); if (!seen.has(n)) { seen.add(n); o.answers.push(x); } }
  } else if (str(p.model)) o.model = str(p.model);
  o.why = str(p.why);
  o.level = LEVELS.includes(str(p.level)) ? str(p.level) : '중';
  const pts = Number(p.pts);
  o.pts = Number.isFinite(pts) && pts > 0 ? pts : 0;
  if (validImg(str(p.img))) o.img = str(p.img);
  if (str(p.video)) o.video = str(p.video);
  return o;
}

export function ensureIds(pages, rand = Math.random) {
  const used = new Set();
  return pages.map(p => {
    let id = p.id;
    while (!id || used.has(id)) id = newId(rand);
    used.add(id);
    return { ...p, id };
  });
}

// 반환: { errors:[{i,msg}], warnings:[{i,msg}], stats }
export function validateBundle(pages) {
  const errors = [], warnings = [];
  const stats = { n: 0, total: 0, byType: {}, byKind: { short: 0, long: 0, choice: 0, check: 0, dropdown: 0 }, byLevel: { 상: 0, 중: 0, 하: 0 } };
  pages.forEach((p, i) => {
    const E = m => errors.push({ i, msg: m }), W = m => warnings.push({ i, msg: m });
    if (!['intro', 'end', ...QTYPES].includes(p.t)) { E(`유형(t)을 알 수 없어요: "${p.t || ''}"`); return; }
    if (!isQuestion(p)) return;
    const k = kindOf(p);
    stats.n++; stats.total += p.pts || 0;
    stats.byType[p.t] = (stats.byType[p.t] || 0) + 1;
    stats.byKind[k]++; stats.byLevel[p.level] = (stats.byLevel[p.level] || 0) + 1;
    if (!p.q) E('문제(q)가 비어 있어요.');
    if (!p.pts) E('배점(pts)이 없어요.');
    if (hasOpts(k)) {
      const o = p.opts || [];
      if (o.length < 2) E('보기(opts)가 2개 이상 있어야 해요.');
      if (o.length > 6) E('보기는 6개까지만 넣을 수 있어요.');
      if (o.some(x => !x)) E('비어 있는 보기가 있어요.');
      if (new Set(o).size !== o.length) E('똑같은 보기가 두 개 있어요.');
      const inRange = v => Number.isInteger(v) && v >= 0 && v < o.length;
      if (k === 'check') {
        if (!Array.isArray(p.a) || !p.a.length || !p.a.every(inRange)) E(`체크박스의 정답(a)은 [0, 2] 처럼 0부터 ${Math.max(0, o.length - 1)}까지의 번호 묶음이어야 해요.`);
      } else if (!inRange(p.a)) E(`정답(a)은 0부터 ${Math.max(0, o.length - 1)}까지의 숫자여야 해요.`);
      if (o.some(x => /모두 (맞|옳|틀)|위의 (모두|전부)|[①-⑥]\s*(과|와|,)\s*[①-⑥]/.test(x))) W('보기 순서가 섞이므로 "모두 맞다"·"①과 ②" 같은 보기는 피하세요.');
    } else if (k === 'short') {
      if (!p.answers || !p.answers.length) E('단답형의 정답(answers)이 없어요.');
      else if (p.answers.some(x => x.length > 60)) W('단답형 정답이 너무 길어요. 긴 답은 장문형이 알맞습니다.');
    } else if (!p.model) W('장문형 모범 답안(model)이 없어요.');
    if (!p.why) W('해설(why)이 없어요.');
    if (p.t === 'image' && !p.img) W('그림 문제인데 사진이 아직 없어요.');
    if (p.t === 'video' && !p.video) E('영상 문제인데 영상 주소(video)가 없어요.');
    if (p.video && !youtubeId(p.video) && !/^https:\/\//.test(p.video)) E('영상 주소는 https:// 로 시작해야 해요.');
  });
  if (!stats.n) errors.push({ i: -1, msg: '문제가 하나도 없어요.' });
  return { errors, warnings, stats };
}

/* ---------- 문제지 / 정답지 나누기 ---------- */
// 학생 기기로 내려가는 문제지(sheet)에는 정답·인정 답·해설·난이도·모범 답안을 절대 넣지 않습니다.
export function splitExam(pages) {
  const intro = pages.find(p => p.t === 'intro') || {};
  const end = pages.find(p => p.t === 'end') || {};
  const sheet = [], key = {};
  for (const p of pages) {
    if (!isQuestion(p)) continue;
    const k = kindOf(p);
    const s = { id: p.id, t: p.t, k, q: p.q, pts: p.pts };
    if (hasOpts(k)) s.opts = (p.opts || []).slice();
    if (p.img) s.img = p.img;
    if (p.video) s.video = p.video;
    sheet.push(s);
    const kk = { k, why: p.why || '', level: p.level || '중' };
    if (hasOpts(k)) kk.a = k === 'check' ? (p.a || []).slice() : p.a;
    else if (k === 'short') kk.answers = (p.answers || []).slice();
    else kk.model = p.model || '';
    key[p.id] = kk;
  }
  return {
    notice: { title: intro.title || '', body: intro.body || '' },
    end: { title: end.title || '고생하셨습니다', body: end.body || '' },
    sheet, key,
  };
}

// 예전에 저장된 문제지에는 답하는 방식(k)이 없으므로 채워 줍니다.
export const fixSheet = sheet => (sheet || []).map(q => (q.k ? q : { ...q, k: q.opts ? 'choice' : 'long' }));

/* ---------- 랜덤 (학생마다 다르고, 같은 학생은 언제나 같은 순서) ---------- */
export function hashStr(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}
export function rng(seedStr) {
  let a = hashStr(seedStr) >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled(arr, seedStr) {
  const a = arr.slice(), r = rng(seedStr);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 시험 모드의 문제 순서와 보기 순서. opt 는 "화면 칸 → 원래 보기 번호" 입니다.
export function examOrder(sheet, examId, sid) {
  return shuffled(sheet, `${examId}|${sid}|q`).map(q => ({
    id: q.id,
    opt: q.opts ? shuffled(q.opts.map((_, i) => i), `${examId}|${sid}|${q.id}`) : null,
  }));
}
export const plainOrder = sheet => sheet.map(q => ({ id: q.id, opt: q.opts ? q.opts.map((_, i) => i) : null }));

/* ---------- 채점 ---------- */
const blank = a => a === undefined || a === null || a === '';
// 자동 채점되는 문항 하나가 맞았는지
export function isRight(q, k, a) {
  if (blank(a) || !k) return false;
  if (q.k === 'check') return packChecks(unpackChecks(a)) === packChecks(k.a || []);
  if (q.k === 'short') { const n = normAns(a); return !!n && (k.answers || []).some(x => normAns(x) === n); }
  if (q.k === 'long') return false;
  return Number(a) === k.a;
}
// answers: { 문항id: 번호(객관식·드롭다운) | "0,2"(체크박스) | 글(단답형·장문형) }, essay: { 문항id: 교수가 준 점수 }
export function scoreStudent(sheet, key, answers = {}, essay = {}) {
  const per = {}; let auto = 0, es = 0, max = 0, answered = 0, essayPending = 0;
  const wrong = [];
  for (const q of sheet) {
    const k = key[q.id] || {}, a = answers ? answers[q.id] : undefined;
    max += q.pts;
    const has = !blank(a);
    if (has) answered++;
    if (q.k !== 'long') {
      const ok = isRight(q, k, a);
      per[q.id] = { ok, pts: ok ? q.pts : 0 };
      if (ok) auto += q.pts; else wrong.push(q.id);
    } else {
      const g = essay ? essay[q.id] : undefined;
      const graded = typeof g === 'number' && Number.isFinite(g);
      const pts = graded ? Math.max(0, Math.min(q.pts, g)) : 0;
      per[q.id] = { ok: graded ? pts >= q.pts : null, pts, graded };
      es += pts;
      if (!graded && has) essayPending++;
      if (graded && pts < q.pts) wrong.push(q.id);
    }
  }
  return { mc: auto, essay: es, total: auto + es, max, per, wrong, answered, essayPending };
}

// rows: [{sid,total,...}] → 점수 높은 순, 동점은 같은 등수(1,1,3 방식)
export function ranked(rows) {
  const s = rows.slice().sort((a, b) => b.total - a.total || String(a.sid).localeCompare(String(b.sid)));
  let rank = 0, prev = null;
  return s.map((r, i) => {
    if (prev === null || r.total !== prev) rank = i + 1;
    prev = r.total;
    return { ...r, rank };
  });
}

// 문항별 응답 집계. all: [{answers, essay}] (응시한 학생만)
export function questionStats(sheet, key, all) {
  return sheet.map((q, i) => {
    const k = key[q.id] || {};
    const row = { id: q.id, no: i + 1, q: q.q, pts: q.pts, level: k.level, n: all.length, k: q.k, auto: q.k !== 'long', choice: hasOpts(q.k) };
    const ans = all.map(s => (s.answers ? s.answers[q.id] : undefined));
    if (q.k === 'long') {
      let sum = 0, graded = 0;
      for (const s of all) { const g = s.essay ? s.essay[q.id] : undefined; if (typeof g === 'number') { sum += Math.min(q.pts, g); graded++; } }
      return Object.assign(row, { graded, avg: graded ? sum / graded : 0, rate: graded && q.pts ? sum / graded / q.pts : 0, blank: ans.filter(blank).length });
    }
    const right = ans.filter(a => isRight(q, k, a)).length;
    Object.assign(row, { right, rate: all.length ? right / all.length : 0, blank: ans.filter(blank).length });
    if (hasOpts(q.k)) {
      const picks = q.opts.map(() => 0), good = q.k === 'check' ? (k.a || []) : [k.a];
      for (const a of ans) if (!blank(a)) for (const n of (q.k === 'check' ? unpackChecks(a) : [Number(a)])) if (picks[n] !== undefined) picks[n]++;
      let top = -1;
      picks.forEach((c, j) => { if (!good.includes(j) && c > 0 && (top < 0 || c > picks[top])) top = j; });
      Object.assign(row, { picks, good, topWrong: top, topWrongText: top >= 0 ? q.opts[top] : '', answerText: good.map(j => q.opts[j]).join(', ') });
    } else {
      // 단답형: 학생들이 쓴 답을 종류별로 모읍니다 (띄어쓰기·대소문자만 다른 답은 한 종류)
      const m = new Map();
      for (const a of ans) if (!blank(a)) { const n = normAns(a); if (!n) continue; const e = m.get(n) || { text: String(a).trim(), n: 0, ok: isRight(q, k, a) }; e.n++; m.set(n, e); }
      const tally = [...m.values()].sort((x, y) => y.n - x.n || x.text.localeCompare(y.text));
      const tw = tally.find(t => !t.ok);
      Object.assign(row, { tally, topWrongText: tw ? tw.text : '', topWrongN: tw ? tw.n : 0, answerText: (k.answers || [])[0] || '' });
    }
    return row;
  });
}
export const mostMissed = (stats, n = 5) =>
  stats.filter(s => s.n > 0 && (s.auto || s.graded)).sort((a, b) => a.rate - b.rate).slice(0, n);
// 점수 분포: 만점을 bins 칸으로 나눠 칸마다 학생 수를 셉니다.
export function histogram(totals, max, bins = 10) {
  const step = max > 0 ? max / bins : 1;
  const out = Array.from({ length: bins }, (_, i) => ({ from: Math.round(i * step * 10) / 10, to: Math.round((i + 1) * step * 10) / 10, n: 0 }));
  for (const t of totals) out[Math.min(bins - 1, Math.max(0, Math.floor(t / step)))].n++;
  return out;
}

/* ---------- 이탈 기록 ---------- */
// ev: { pushId: {t:'leave'|'back'|'unpin'|..., at} } → 시각 순 목록과 이탈 횟수
export function leaveSummary(ev) {
  const list = Object.values(ev || {}).filter(e => e && e.t).sort((a, b) => (a.at || 0) - (b.at || 0));
  let warn = 0;   // 마지막 잠금 뒤에 받은 카메라 경고 수 (2회가 되면 잠깁니다)
  for (const e of list) { if (e.t === 'lock') warn = 0; else if (e.t === 'face') warn++; }
  const cam = list.filter(e => ['camoff', 'camon', 'camfail', 'nocam'].includes(e.t)).pop();
  return {
    list, count: list.filter(e => e.t === 'leave' || e.t === 'unpin').length,
    face: list.filter(e => e.t === 'face').length,     // 카메라 경고 횟수
    locks: list.filter(e => e.t === 'lock').length,    // 화면이 잠긴 횟수
    warn, camOff: !!cam && cam.t !== 'camon',          // 지금 카메라가 꺼져 있는지
  };
}
export const EV_NAME = { leave: '화면을 벗어남', back: '돌아옴', unpin: '화면 고정이 풀림', nopin: '화면 고정 없이 계속함', face: '카메라 경고 (얼굴이 벗어남)', faceok: '얼굴이 다시 보임', lock: '화면 잠김 (경고 3회)',
  camoff: '카메라 자동 꺼짐 (발열·배터리)', camon: '카메라 다시 켜짐', camfail: '카메라를 켜지 못함', nocam: '카메라 없이 시작' };
// 얼굴 감지기가 주는 점(오른쪽 눈, 왼쪽 눈, 코끝, 입, 오른쪽 귀, 왼쪽 귀; x는 0~1)으로 고개가 좌우로 돌아간 각도를 어림합니다.
// 정면이면 코가 두 귀의 한가운데에 있고, 고개를 돌릴수록 한쪽 귀에 가까워집니다.
export function faceYaw(kp) {
  if (!kp || kp.length < 6) return 0;
  const nose = kp[2].x, dR = Math.abs(nose - kp[4].x), dL = Math.abs(kp[5].x - nose);
  if (dR + dL < 1e-6) return 0;
  const between = (nose - kp[4].x) * (kp[5].x - nose) >= 0;                 // 코가 두 귀 사이에 있는가
  if (!between) return 90 * Math.sign(dR - dL || 1);                        // 귀 바깥으로 나갔으면 옆얼굴
  return Math.atan((dR - dL) / (dR + dL) / 1.1) * 180 / Math.PI;
}
// 풀이 시간(초)을 "3분 20초"처럼
export const fmtDur = sec => { sec = Math.max(0, Math.round(sec || 0)); const m = Math.floor(sec / 60), r = sec % 60; return m ? `${m}분${r ? ' ' + r + '초' : ''}` : `${r}초`; };

/* ---------- 명단 ---------- */
export const normSid = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
export const normName = s => String(s == null ? '' : s).replace(/\s+/g, '');
// 반 이름은 교수가 정합니다 (예: "A반", "1학년 A반", "C반"). 정하지 않으면 A반·B반.
export const DEFAULT_CLASSES = ['A반', 'B반'];
export const normCls = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
export const validCls = s => s.length >= 1 && s.length <= 20 && !/[.#$\[\]\/]/.test(s);
// 서버에 저장된 { 반이름: 순서 } 를 순서대로 늘어놓습니다.
export const classList = v => { const a = Object.entries(v || {}).sort((x, y) => (x[1] || 0) - (y[1] || 0)).map(x => x[0]); return a.length ? a : DEFAULT_CLASSES.slice(); };
export const validSid = s => /^[A-Z0-9-]{4,20}$/.test(s);

/* ---------- 그 밖 ---------- */
export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}
export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}
export function toCSV(rows) {
  // 글자 칸이 = + - @ 로 시작하면 엑셀이 수식으로 실행하므로 앞에 ' 를 붙여 글자로 만듭니다.
  const cell = v => { let s = v == null ? '' : String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
// 고른 문항만 교체: sel(고른 위치들, 오름차순)에 fresh를 차례로 넣습니다. 문항 고유번호(id)는 자리의 것을 지킵니다.
export function replaceSelected(pages, sel, fresh) {
  if (sel.length !== fresh.length) throw new Error(`고른 문항은 ${sel.length}개인데 붙여 넣은 문항은 ${fresh.length}개예요. 개수를 맞춰 주세요.`);
  const out = pages.slice();
  sel.forEach((i, k) => {
    const next = { ...fresh[k], id: pages[i].id };
    if (!next.img && pages[i].img) next.img = pages[i].img;   // AI가 돌려준 문항에는 사진이 없으므로 원래 사진을 지킵니다
    out[i] = next;
  });
  return out;
}

/* ---------- 복사 버튼 부탁문 ---------- */
export const FORMAT_EXAMPLE = `[
 {"t":"choice", "q":"문제", "opts":["보기1","보기2","보기3","보기4"], "a":0, "why":"왜 정답인지 해설", "level":"중", "pts":4},
 {"t":"check", "q":"옳은 것을 모두 고르시오", "opts":["보기1","보기2","보기3","보기4"], "a":[0,2], "why":"해설", "level":"상", "pts":4},
 {"t":"dropdown", "q":"문제", "opts":["보기1","보기2","보기3","보기4"], "a":1, "why":"해설", "level":"하", "pts":4},
 {"t":"short", "q":"문제", "answers":["정답","같은 뜻의 다른 표기","흔한 오타"], "why":"해설", "level":"중", "pts":4},
 {"t":"long", "q":"문제", "model":"모범 답안", "why":"채점 기준", "level":"상", "pts":10},
 {"t":"image", "q":"문제", "img":"", "ans":"choice", "opts":["보기1","보기2","보기3","보기4"], "a":2, "why":"해설", "level":"하", "pts":4},
 {"t":"video", "q":"문제", "video":"https://youtu.be/영상주소", "ans":"short", "answers":["정답"], "why":"해설", "level":"중", "pts":4}
]
- t: 문항 유형 (choice 객관식 / check 체크박스 / dropdown 드롭다운 / short 단답형 / long 장문형 / image 그림 문제 / video 영상 문제)
- a: 정답 위치. 0부터 셉니다 (첫 번째 보기가 0). 체크박스는 [0,2] 처럼 정답 번호를 모두 적습니다.
- answers: 단답형에서 정답으로 인정할 표기를 모두 적습니다. 첫 번째가 대표 정답입니다. 띄어쓰기와 영문 대소문자 차이는 자동으로 같은 답으로 봅니다.
- ans: 그림·영상 문제의 답하는 방식 (choice / check / dropdown / short / long)
- level: 난이도 "상" · "중" · "하"
- pts: 배점 (정수)`;

// 문제 만들기 창에서 고른 값 → 문항 수 · 난이도 · 배점
export const PROMPT_DEFAULTS = { subject: '', n: 25, nCheck: 0, nDropdown: 0, nShort: 0, nLong: 0, nImage: 0, nVideo: 0, mid: 30, hi: 10, total: 100, pts: {} };
export const PROMPT_TYPES = [['choice', '객관식', ''], ['check', '체크박스', 'nCheck'], ['dropdown', '드롭다운', 'nDropdown'], ['short', '단답형', 'nShort'], ['long', '장문형', 'nLong'], ['image', '그림 문제', 'nImage'], ['video', '영상 문제', 'nVideo']];
// 객관식 수 = 총 문항 수 − 나머지 유형, 난이도 하 = 100 − 중 − 상
export function promptPlan(o = {}) {
  const v = { ...PROMPT_DEFAULTS, ...o }, num = x => Math.max(0, Math.round(Number(x) || 0));
  const counts = {}; let others = 0;
  for (const [t, , f] of PROMPT_TYPES) if (f) { counts[t] = num(v[f]); others += counts[t]; }
  const n = num(v.n); counts.choice = n - others;
  const mid = num(v.mid), hi = num(v.hi), lo = 100 - mid - hi, total = num(v.total);
  const errs = [];
  if (n < 1) errs.push('총 문항 수를 1 이상으로 정해 주세요.');
  if (counts.choice < 0) errs.push(`다른 유형의 합(${others})이 총 문항 수(${n})보다 많아요.`);
  if (lo < 0) errs.push('난이도 중과 상의 합이 100%를 넘어요.');
  // 배점: 따로 정한 유형은 그 점수, 나머지 문항은 남은 점수를 똑같이 나누고 남는 점수는 어려운 문항부터 1점씩
  const fixed = [], free = []; let used = 0, freeN = 0;
  for (const [t, name] of PROMPT_TYPES) {
    const c = Math.max(0, counts[t]); if (!c) continue;
    const p = Number((v.pts || {})[t]);
    if (Number.isFinite(p) && p > 0) { fixed.push({ t, name, count: c, pts: Math.round(p) }); used += c * Math.round(p); }
    else { free.push({ t, name, count: c }); freeN += c; }
  }
  const rest = total - used, base = freeN ? Math.floor(rest / freeN) : 0, extra = freeN ? rest - base * freeN : 0;
  if (!errs.length) {
    if (freeN && base < 1) errs.push(`따로 정한 배점이 너무 커서 나머지 ${freeN}문항에 줄 점수가 모자라요.`);
    if (!freeN && rest !== 0) errs.push(`따로 정한 배점의 합(${used}점)이 총 합계(${total}점)와 달라요. 한 유형은 비워 두면 자동으로 맞춥니다.`);
  }
  return { n, counts, mid, hi, lo, total, fixed, free, freeN, base, extra, errors: errs, ok: !errs.length };
}
export function promptPointsText(pl) {
  const lines = pl.fixed.map(f => `- ${f.name} ${f.count}문항: 각 ${f.pts}점`);
  if (pl.freeN) {
    const who = pl.free.map(f => `${f.name} ${f.count}`).join(' · ');
    lines.push(pl.extra
      ? `- ${pl.fixed.length ? '나머지 ' : ''}${pl.freeN}문항(${who}): ${pl.freeN - pl.extra}문항은 ${pl.base}점, 난이도가 높은 ${pl.extra}문항은 ${pl.base + 1}점`
      : `- ${pl.fixed.length ? '나머지 ' : ''}${pl.freeN}문항(${who}): 각 ${pl.base}점`);
  }
  return lines.join('\n');
}
export function promptMake(o = {}) {
  const pl = promptPlan(o), c = pl.counts;
  const types = PROMPT_TYPES.filter(([t]) => c[t] > 0).map(([t, name]) => `${name} ${c[t]}문항`).join(', ');
  return `[역할]
당신은 대학 ${o.subject || '[과목명]'} 과목의 시험 출제 위원입니다.

[가장 중요한 규칙]
- 내가 이 대화에 올린 강의 자료 범위 안에서만 출제합니다. 자료에 없는 내용, 수치, 용어는 쓰지 않습니다.
- 문항마다 근거가 된 자료의 위치(파일 이름과 쪽 번호)를 JSON 밖의 표로 따로 적습니다.
- 자료만으로 정답을 확정할 수 없는 문항은 만들지 않습니다.

[출제 조건]
- 모두 ${pl.n}문항 — ${types}
- 난이도 비율 — 하 ${pl.lo}% · 중 ${pl.mid}% · 상 ${pl.hi}% (문항 수는 이 비율에 가장 가깝게 맞추고 level 값으로 표시)
- 배점 — 합계가 정확히 ${pl.total}점이 되어야 합니다. 모든 배점은 정수입니다.
${promptPointsText(pl)}
- 객관식·드롭다운은 정답이 하나뿐이어야 하고, 오답 보기는 그럴듯하지만 분명히 틀려야 합니다.
- 체크박스는 정답이 둘 이상이며, 문제에 "모두 고르시오"라고 씁니다. 정답을 전부 맞게 골라야 점수를 받습니다.
- "모두 맞다", "모두 틀리다", "①과 ②" 같은 보기는 쓰지 않습니다. 보기 순서가 학생마다 섞이기 때문입니다.
- 정답 위치(a)가 한 번호에 몰리지 않게 합니다.
- 단답형은 한 낱말이나 짧은 구로 답이 정해지는 문제만 냅니다. answers 에는 대표 정답과 함께 같은 뜻의 다른 표기, 학생이 흔히 쓰는 오타까지 적습니다.
- 문제는 스마트폰 한 화면에 들어가게 짧게 씁니다(문제 80자 안팎, 보기 30자 안팎).
- 해설(why)에는 왜 정답인지와 헷갈리기 쉬운 오답이 왜 틀린지를 2~3문장으로 씁니다.
- 장문형은 모범 답안(model)과 부분 점수 기준(why)을 씁니다.
- 그림 문제는 img를 빈 칸("")으로 두고, 필요한 사진 설명을 JSON 밖에 따로 적습니다.

[출력 형식]
아래 형식의 JSON 배열 하나를 코드 블록 하나에 담습니다. 배열에는 문제만 넣습니다(안내문·맺음말은 넣지 않습니다). 배열의 첫 번째가 1번 문항입니다.
${FORMAT_EXAMPLE}

[절차]
먼저 출제 계획(단원별 문항 수, 난이도 배분, 배점)을 보여 주고 내 확인을 받은 뒤 문항을 씁니다.`;
}
// 사진 자료(data: 주소)는 너무 길어서 부탁문에서는 뺍니다.
const forPrompt = pages => pages.map((p, i) => {
  const c = { ...p }; delete c.id;
  if (c.img) c.img = '(사진 있음)';
  return `/* ${i + 1}번 */ ` + JSON.stringify(c);
}).join(',\n');
export function promptReview(pages, o = {}) {
  return `[역할]
당신은 ${o.subject || '[과목명]'} 전문가이자 시험 문항 검토자입니다. 아래 문항을 가장 비판적인 시각으로 검토합니다. 출제자를 배려하지 않습니다.

[자료]
이 대화에 올린 강의 자료가 출제 범위입니다.

[대상 문항] — 문항 번호는 각 줄 앞 주석과 같습니다
[
${forPrompt(pages)}
]

[검토 항목]
- 정답: a가 가리키는 보기가 정말 정답인지 (a는 0부터 셉니다. 체크박스는 정답 번호 묶음)
- 단답형: answers 의 표기가 모두 정답으로 인정할 만한지, 빠진 표기(동의어·흔한 오타)는 없는지
- 복수 정답: 정답으로 볼 수 있는 보기가 둘 이상인지, 정답이 하나도 없는지
- 해설: 설명이 사실과 맞는지, 정답과 어긋나지 않는지
- 난이도: 상·중·하 표시가 실제 난이도와 맞는지
- 범위: 강의 자료에 없는 내용을 묻는지
- 문장: 뜻이 두 가지로 읽히는지, 문제 안에 정답 힌트가 있는지
- 보기 순서가 섞여도 문제가 성립하는지
- 장문형: 모범 답안과 채점 기준이 맞는지

[출력 형식]
문항 번호 | 문제점 | 고친 내용 | 근거(자료 위치) | 확신도(높음·중간·낮음)
- 문제가 없는 문항은 번호만 모아 "이상 없음"이라고 씁니다.
- 추측으로 고치지 않습니다. 확신이 없으면 확신도를 "낮음"으로 적습니다.
- 마지막에 고친 문항만 같은 JSON 형식의 배열로 다시 써 줍니다(앱의 "고른 문항만 교체 붙여 넣기"에 넣습니다).`;
}
export function promptFinal(pages, o = {}) {
  return `[역할]
당신은 시험 직전 마지막 확인을 맡은 ${o.subject || '[과목명]'} 전문가입니다. 새로 고치는 것이 아니라, 이대로 시험을 내도 되는지 판정합니다.

[최종 문항] — 문항 번호는 각 줄 앞 주석과 같습니다
[
${forPrompt(pages)}
]

[앞선 검토 의견] — 있으면 붙여 넣습니다
(여기에 붙여 넣기)

[확인할 것]
1. 문항마다 직접 풀어 보고, 당신의 답이 a(단답형은 answers)와 같은지 확인합니다. (a는 0부터 셉니다)
2. 앞선 검토에서 지적된 곳이 실제로 고쳐졌는지 확인합니다.
3. 학생이 이의를 제기할 만한 문항(복수 정답, 모호한 표현, 범위 밖)을 찾습니다.
4. 오탈자, 단위, 기호를 확인합니다.
5. 배점 합계와 난이도 비율(상·중·하)을 계산해 적습니다.

[출력 형식]
- 첫 줄에 판정: "출제 가능" 또는 "수정 필요 ( )문항"
- 수정이 필요한 문항만: 문항 번호 | 이유 | 고친 문항 JSON
- 의견이 갈리는 문항은 양쪽 근거를 나란히 적고, 어느 쪽이 맞는지 이유와 함께 판정합니다.`;
}
