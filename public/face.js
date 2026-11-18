// 전면 카메라 얼굴 확인 — 영상은 어디에도 저장하거나 보내지 않고, 기기 안에서 "얼굴이 보이는지"만 봅니다.
// 발열과 배터리 부담을 줄이려고 낮은 해상도로 1초에 두 번이 안 되게 확인합니다.
import { faceYaw, faceRatio, facePitch } from './core.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = './vendor/blaze_face_short_range.tflite';
export const YAW_LIMIT = 30;      // 고개가 이 각도보다 더 돌아가면 "벗어남"
export const AWAY_MS = 3000;      // 이만큼 계속되면 경고
const EVERY_MS = 600;

// 자동 테스트에서는 window.__fakeFace 가 카메라와 감지기를 대신합니다.
const fake = () => (typeof window.__fakeFace === 'function' ? window.__fakeFace : null);

let detectorP = null;
function loadDetector() {
  if (!detectorP) detectorP = (async () => {
    const m = await import(LIB + '/vision_bundle.mjs');
    const files = await m.FilesetResolver.forVisionTasks(LIB + '/wasm');
    return m.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 });
  })().catch(e => { detectorP = null; throw e; });
  return detectorP;
}
const openCamera = () => navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 5, max: 10 } } });

// 안내 쪽에서: 카메라를 켤 수 있는지 한 번 확인하고 바로 끕니다. 감지기도 미리 받아 둡니다.
export async function testCamera() {
  if (fake()) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocamera');
  const s = await openCamera();
  s.getTracks().forEach(t => t.stop());
  loadDetector().catch(() => {});
  return true;
}

// 감시 시작. onAway(why): 얼굴이 AWAY_MS 동안 안 보이거나('gone') 돌아가 있음('turn'). onBack(): 다시 보임.
// 돌려주는 stop() 을 부르면 카메라가 꺼집니다.
export async function startWatch({ onAway, onBack, yawLimit = YAW_LIMIT, pitchLimit = 25, awayMs = AWAY_MS }) {
  const bases = []; let base = null;   // 정면일 때의 위아래 비율 (처음 정면을 본 몇 번으로 정함)
  const f = fake();
  let stream = null, video = null, det = null;
  if (!f) {
    stream = await openCamera();
    try {
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.srcObject = stream;
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;bottom:0';   // 학생에게 보이지 않게
      document.body.appendChild(video);
      await video.play();
      det = await loadDetector();
    } catch (e) { stream.getTracks().forEach(t => t.stop()); if (video) video.remove(); throw e; }
  }
  let badSince = 0, away = false, stopped = false, fails = 0;
  const look = () => {
    if (f) return f();
    if (video.readyState < 2) return null;
    const r = det.detectForVideo(video, performance.now());
    const d = r && r.detections && r.detections[0];
    if (!d) return { face: false, yaw: 0, pitch: 0 };
    const kp = d.keypoints || [], yaw = faceYaw(kp), ratio = faceRatio(kp);
    if (base === null && ratio !== null && Math.abs(yaw) < 15) { bases.push(ratio); if (bases.length >= 5) base = bases.slice().sort((a, b) => a - b)[2]; }
    return { face: true, yaw, pitch: facePitch(ratio, base) };
  };
  const timer = setInterval(() => {
    if (stopped || document.hidden) { badSince = 0; return; }   // 화면이 가려진 동안은 따로(이탈로) 기록됩니다
    let r;
    try { r = look(); fails = 0; } catch (e) { if (++fails > 10) { badSince = 0; } return; }
    if (!r) return;
    const why = !r.face ? 'gone' : Math.abs(r.yaw) > yawLimit ? 'turn' : Math.abs(r.pitch || 0) > pitchLimit ? 'tilt' : '';
    const now = Date.now();
    if (why) {
      if (!badSince) badSince = now;
      if (!away && now - badSince >= awayMs) { away = true; onAway(why); }
    } else {
      badSince = 0;
      if (away) { away = false; onBack(); }
    }
  }, EVERY_MS);
  return {
    stop() { stopped = true; clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); if (video) video.remove(); },
    // 경고를 처리한 뒤 다시 처음부터 세게 합니다
    reset() { badSince = 0; away = false; },
  };
}
