// 푸른시험 핵심 로직 — 화면·Firebase와 무관한 순수 함수만 둡니다. (tests/ 에서 자동 테스트)

export const LEVELS = ['상', '중', '하'];
export const QTYPES = ['choice', 'essay', 'image', 'video'];
export const TYPE_NAME = { intro: '안내', choice: '사지선다', essay: '서술형', image: '그림 문제', video: '영상 문제', end: '마무리' };

export const isQuestion = p => !!p && QTYPES.includes(p.t);
export const isChoice = p => isQuestion(p) && Array.isArray(p.opts) && p.opts.length >= 2;
export const isEssay = p => isQuestion(p) && !isChoice(p);

/* ---------- 붙여 넣기 ---------- */
// AI가 코드 블록(```json … ```)으로 감싸거나 앞뒤에 설명을 붙여도 배열만 꺼냅니다.
export function parseBundle(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  let data;
  try { data = JSON.parse(s); } catch (e) {
    const a = s.indexOf('['), b = s.lastIndexOf(']');
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

// 문항을 표준 모양으로 정리합니다. 모르는 값은 버리지 않고 안전한 기본값으로 바꿉니다.
export function normalizePage(p) {
  const t = str(p.t).toLowerCase();
  const o = { t };
  if (p.id && /^[A-Za-z0-9_-]{1,24}$/.test(String(p.id))) o.id = String(p.id);
  if (t === 'intro' || t === 'end') {
    o.title = str(p.title); o.body = str(p.body);
    return o;
  }
  o.q = str(p.q);
  if (Array.isArray(p.opts)) o.opts = p.opts.map(str);
  if (o.opts) o.a = Number.isInteger(p.a) ? p.a : (typeof p.a === 'string' && /^\d+$/.test(p.a.trim()) ? +p.a : null);
  if (str(p.model)) o.model = str(p.model);
  o.why = str(p.why);
  o.level = LEVELS.includes(str(p.level)) ? str(p.level) : '중';
  const pts = Number(p.pts);
  o.pts = Number.isFinite(pts) && pts > 0 ? pts : 0;
  if (str(p.img)) o.img = str(p.img);
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
  const stats = { n: 0, total: 0, byType: {}, byLevel: { 상: 0, 중: 0, 하: 0 }, choice: 0, essay: 0 };
  pages.forEach((p, i) => {
    const E = m => errors.push({ i, msg: m }), W = m => warnings.push({ i, msg: m });
    if (!['intro', 'end', ...QTYPES].includes(p.t)) { E(`유형(t)을 알 수 없어요: "${p.t || ''}"`); return; }
    if (!isQuestion(p)) return;
    stats.n++; stats.total += p.pts || 0;
    stats.byType[p.t] = (stats.byType[p.t] || 0) + 1;
    stats.byLevel[p.level] = (stats.byLevel[p.level] || 0) + 1;
    if (!p.q) E('문제(q)가 비어 있어요.');
    if (!p.pts) E('배점(pts)이 없어요.');
    if (p.t === 'choice' && !isChoice(p)) E('사지선다인데 보기(opts)가 없어요.');
    if (p.t === 'essay' && p.opts) E('서술형인데 보기(opts)가 들어 있어요.');
    if (isChoice(p)) {
      stats.choice++;
      if (p.opts.length > 6) E('보기는 6개까지만 넣을 수 있어요.');
      if (p.opts.some(x => !x)) E('비어 있는 보기가 있어요.');
      if (new Set(p.opts).size !== p.opts.length) E('똑같은 보기가 두 개 있어요.');
      if (!Number.isInteger(p.a) || p.a < 0 || p.a >= p.opts.length) E(`정답(a)은 0부터 ${p.opts.length - 1}까지의 숫자여야 해요.`);
      if (p.opts.some(x => /모두 (맞|옳|틀)|위의 (모두|전부)|[①-⑥]\s*(과|와|,)\s*[①-⑥]/.test(x))) W('보기 순서가 섞이므로 "모두 맞다"·"①과 ②" 같은 보기는 피하세요.');
    } else {
      stats.essay++;
      if (!p.model) W('서술형 모범 답안(model)이 없어요.');
    }
    if (!p.why) W('해설(why)이 없어요.');
    if (p.t === 'image' && !p.img) W('그림 문제인데 사진이 아직 없어요.');
    if (p.t === 'video' && !p.video) E('영상 문제인데 영상 주소(video)가 없어요.');
    if (p.video && !youtubeId(p.video) && !/^https:\/\//.test(p.video)) E('영상 주소는 https:// 로 시작해야 해요.');
  });
  if (!stats.n) errors.push({ i: -1, msg: '문제가 하나도 없어요.' });
  return { errors, warnings, stats };
}

/* ---------- 문제지 / 정답지 나누기 ---------- */
// 학생 기기로 내려가는 문제지(sheet)에는 정답·해설·난이도·모범 답안을 절대 넣지 않습니다.
export function splitExam(pages) {
  const intro = pages.find(p => p.t === 'intro') || {};
  const end = pages.find(p => p.t === 'end') || {};
  const sheet = [], key = {};
  for (const p of pages) {
    if (!isQuestion(p)) continue;
    const s = { id: p.id, t: p.t, q: p.q, pts: p.pts };
    if (isChoice(p)) s.opts = p.opts.slice();
    if (p.img) s.img = p.img;
    if (p.video) s.video = p.video;
    sheet.push(s);
    const k = { why: p.why || '', level: p.level || '중' };
    if (isChoice(p)) k.a = p.a; else k.model = p.model || '';
    key[p.id] = k;
  }
  return {
    notice: { title: intro.title || '', body: intro.body || '' },
    end: { title: end.title || '고생하셨습니다', body: end.body || '' },
    sheet, key,
  };
}

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
// answers: { 문항id: 원래 보기 번호(숫자) 또는 서술형 글(문자열) }, essay: { 문항id: 교수가 준 점수 }
export function scoreStudent(sheet, key, answers = {}, essay = {}) {
  const per = {}; let mc = 0, es = 0, max = 0, answered = 0, essayPending = 0;
  const wrong = [];
  for (const q of sheet) {
    const k = key[q.id] || {}, a = answers ? answers[q.id] : undefined;
    max += q.pts;
    const has = a !== undefined && a !== null && a !== '';
    if (has) answered++;
    if (q.opts) {
      const ok = has && Number(a) === k.a;
      per[q.id] = { ok, pts: ok ? q.pts : 0 };
      if (ok) mc += q.pts; else wrong.push(q.id);
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
  return { mc, essay: es, total: mc + es, max, per, wrong, answered, essayPending };
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

// 문항별 정답률. all: [{answers, essay}] (응시한 학생만)
export function questionStats(sheet, key, all) {
  return sheet.map((q, i) => {
    const k = key[q.id] || {};
    const row = { id: q.id, no: i + 1, q: q.q, pts: q.pts, level: k.level, n: all.length, choice: !!q.opts };
    if (q.opts) {
      const picks = q.opts.map(() => 0); let blank = 0, right = 0;
      for (const s of all) {
        const a = s.answers ? s.answers[q.id] : undefined;
        if (a === undefined || a === null || a === '') blank++;
        else { const n = Number(a); if (picks[n] !== undefined) picks[n]++; if (n === k.a) right++; }
      }
      let top = -1;
      picks.forEach((c, j) => { if (j !== k.a && c > 0 && (top < 0 || c > picks[top])) top = j; });
      Object.assign(row, { right, rate: all.length ? right / all.length : 0, picks, blank, topWrong: top, topWrongText: top >= 0 ? q.opts[top] : '', answerText: q.opts[k.a] });
    } else {
      let sum = 0, graded = 0;
      for (const s of all) { const g = s.essay ? s.essay[q.id] : undefined; if (typeof g === 'number') { sum += Math.min(q.pts, g); graded++; } }
      Object.assign(row, { graded, avg: graded ? sum / graded : 0, rate: graded && q.pts ? sum / graded / q.pts : 0 });
    }
    return row;
  });
}
export const mostMissed = (stats, n = 5) =>
  stats.filter(s => s.n > 0 && (s.choice || s.graded)).sort((a, b) => a.rate - b.rate).slice(0, n);

/* ---------- 이탈 기록 ---------- */
// ev: { pushId: {t:'leave'|'back'|'unpin'|..., at} } → 시각 순 목록과 이탈 횟수
export function leaveSummary(ev) {
  const list = Object.values(ev || {}).filter(e => e && e.t).sort((a, b) => (a.at || 0) - (b.at || 0));
  return { list, count: list.filter(e => e.t === 'leave' || e.t === 'unpin').length };
}

/* ---------- 명단 ---------- */
export const normSid = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
export const normName = s => String(s == null ? '' : s).replace(/\s+/g, '');
export const normCls = s => { const m = String(s == null ? '' : s).trim().toUpperCase().match(/^([A-Z])\s*반?$/); return m ? m[1] : ''; };
export const validSid = s => /^[A-Z0-9-]{4,20}$/.test(s);

// 엑셀에서 복사한 줄(탭·쉼표·공백 구분). 칸 순서는 상관없이 반(A/B) · 학번(숫자) · 이름을 알아봅니다.
export function parseRoster(text, defaultCls = '') {
  const rows = [], errors = [], seen = new Set();
  String(text || '').split(/\r?\n/).forEach((line, li) => {
    const cells = line.split(/[\t,;]+|\s{1,}/).map(c => c.trim()).filter(Boolean);
    if (!cells.length) return;
    let cls = '', sid = '', name = [];
    for (const c of cells) {
      if (!cls && normCls(c)) cls = normCls(c);
      else if (!sid && /^\d[\dA-Za-z-]{3,19}$/.test(c)) sid = normSid(c);
      else name.push(c);
    }
    const nm = normName(name.join(''));
    if (!sid && !cls && /학번|이름|성명/.test(line)) return; // 머리글 줄
    cls = cls || defaultCls;
    if (!sid || !nm || !cls) { errors.push({ line: li + 1, msg: `${li + 1}번째 줄을 읽지 못했어요: "${line.trim()}"` }); return; }
    if (seen.has(sid)) { errors.push({ line: li + 1, msg: `학번 ${sid} 이(가) 두 번 나와요.` }); return; }
    seen.add(sid);
    rows.push({ sid, name: nm, cls });
  });
  return { rows, errors };
}

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
  const cell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
// 고른 문항만 교체: sel(고른 위치들, 오름차순)에 fresh를 차례로 넣습니다. 문항 고유번호(id)는 자리의 것을 지킵니다.
export function replaceSelected(pages, sel, fresh) {
  if (sel.length !== fresh.length) throw new Error(`고른 문항은 ${sel.length}개인데 붙여 넣은 문항은 ${fresh.length}개예요. 개수를 맞춰 주세요.`);
  const out = pages.slice();
  sel.forEach((i, k) => { out[i] = { ...fresh[k], id: pages[i].id }; });
  return out;
}

/* ---------- 복사 버튼 부탁문 ---------- */
export const FORMAT_EXAMPLE = `[
 {"t":"intro", "title":"시험 제목", "body":"시험 시간과 주의사항"},
 {"t":"choice", "q":"문제", "opts":["보기1","보기2","보기3","보기4"], "a":0, "why":"왜 정답인지 해설", "level":"중", "pts":4},
 {"t":"essay", "q":"문제", "model":"모범 답안", "why":"채점 기준", "level":"상", "pts":10},
 {"t":"image", "q":"문제", "img":"", "opts":["보기1","보기2","보기3","보기4"], "a":2, "why":"해설", "level":"하", "pts":4},
 {"t":"video", "q":"문제", "video":"https://youtu.be/영상주소", "opts":["보기1","보기2","보기3","보기4"], "a":1, "why":"해설", "level":"중", "pts":4},
 {"t":"end", "title":"고생하셨습니다", "body":"결과는 교수님이 공개하면 볼 수 있습니다."}
]
- t: 쪽 유형 (intro 안내 / choice 사지선다 / essay 서술형 / image 그림 문제 / video 영상 문제 / end 마무리)
- a: 정답 위치. 0부터 셉니다 (첫 번째 보기가 0)
- level: 난이도 "상" · "중" · "하"
- pts: 배점
- image · video 쪽은 opts 가 있으면 사지선다, 없으면 서술형(model 필요)으로 채점합니다.`;

const b = v => (v === 0 || v) ? String(v) : ' ';
export function promptMake(o = {}) {
  return `[역할]
당신은 대학 ${o.subject || '[과목명]'} 과목의 시험 출제 위원입니다.

[가장 중요한 규칙]
- 내가 이 대화에 올린 강의 자료 범위 안에서만 출제합니다. 자료에 없는 내용, 수치, 용어는 쓰지 않습니다.
- 문항마다 근거가 된 자료의 위치(파일 이름과 쪽 번호)를 JSON 밖의 표로 따로 적습니다.
- 자료만으로 정답을 확정할 수 없는 문항은 만들지 않습니다.

[출제 조건]
- 사지선다 ${b(o.nChoice)}문항, 서술형 ${b(o.nEssay)}문항, 그림 문제 ${b(o.nImage)}문항, 영상 문제 ${b(o.nVideo)}문항
- 난이도 비율 — 상 ${b(o.hi)}% · 중 ${b(o.mid)}% · 하 ${b(o.lo)}%
- 배점 — 사지선다 ${b(o.ptsChoice)}점, 서술형 ${b(o.ptsEssay)}점, 합계 ${b(o.total)}점
- 사지선다는 정답이 하나뿐이어야 하고, 오답 보기는 그럴듯하지만 분명히 틀려야 합니다.
- "모두 맞다", "모두 틀리다", "①과 ②" 같은 보기는 쓰지 않습니다. 보기 순서가 학생마다 섞이기 때문입니다.
- 정답 위치(a)가 한 번호에 몰리지 않게 합니다.
- 문제는 스마트폰 한 화면에 들어가게 짧게 씁니다(문제 80자 안팎, 보기 30자 안팎).
- 해설(why)에는 왜 정답인지와 헷갈리기 쉬운 오답이 왜 틀린지를 2~3문장으로 씁니다.
- 서술형은 모범 답안(model)과 부분 점수 기준(why)을 씁니다.
- 그림 문제는 img를 빈 칸("")으로 두고, 필요한 사진 설명을 JSON 밖에 따로 적습니다.

[출력 형식]
아래 형식의 JSON 배열 하나를 코드 블록 하나에 담습니다. 첫 쪽은 intro, 마지막 쪽은 end입니다.
${FORMAT_EXAMPLE}

[절차]
먼저 출제 계획(단원별 문항 수, 난이도 배분)을 보여 주고 내 확인을 받은 뒤 문항을 씁니다.`;
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
- 정답: a가 가리키는 보기가 정말 정답인지 (a는 0부터 셉니다)
- 복수 정답: 정답으로 볼 수 있는 보기가 둘 이상인지, 정답이 하나도 없는지
- 해설: 설명이 사실과 맞는지, 정답과 어긋나지 않는지
- 난이도: 상·중·하 표시가 실제 난이도와 맞는지
- 범위: 강의 자료에 없는 내용을 묻는지
- 문장: 뜻이 두 가지로 읽히는지, 문제 안에 정답 힌트가 있는지
- 보기 순서가 섞여도 문제가 성립하는지
- 서술형: 모범 답안과 채점 기준이 맞는지

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
1. 문항마다 직접 풀어 보고, 당신의 답이 a와 같은지 확인합니다. (a는 0부터 셉니다)
2. 앞선 검토에서 지적된 곳이 실제로 고쳐졌는지 확인합니다.
3. 학생이 이의를 제기할 만한 문항(복수 정답, 모호한 표현, 범위 밖)을 찾습니다.
4. 오탈자, 단위, 기호를 확인합니다.
5. 배점 합계와 난이도 비율(상·중·하)을 계산해 적습니다.

[출력 형식]
- 첫 줄에 판정: "출제 가능" 또는 "수정 필요 ( )문항"
- 수정이 필요한 문항만: 문항 번호 | 이유 | 고친 문항 JSON
- 의견이 갈리는 문항은 양쪽 근거를 나란히 적고, 어느 쪽이 맞는지 이유와 함께 판정합니다.`;
}
