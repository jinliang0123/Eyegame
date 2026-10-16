// 眼球追蹤：MediaPipe Face Landmarker（含虹膜）→ 特徵向量 + 眨眼偵測
// 也提供 MockTracker（滑鼠當視線、鍵盤當眨眼），方便沒有鏡頭時測試。
const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const Settings = {
  get swapEyes() { try { return localStorage.getItem('eyegame.swapEyes') === '1'; } catch { return false; } },
  set swapEyes(v) { try { localStorage.setItem('eyegame.swapEyes', v ? '1' : '0'); } catch { /* ignore */ } },
};

// ---------- 眨眼偵測 ----------
export class BlinkDetector {
  constructor() {
    this.closeTh = 0.55; this.openTh = 0.38;
    this.winkMs = 140;    // 單眼閉合超過此時間才算「眨單眼」（排除自然眨眼）
    this.bothMs = 70;     // 雙眼閉合超過此時間算「雙眼眨」
    this.otherOpenTh = 0.4;
    this.L = { closed: false, since: 0, fired: false, tainted: false, v: 0 };
    this.R = { closed: false, since: 0, fired: false, tainted: false, v: 0 };
    this.bothFired = false;
    this.lastBlinkT = -1e9;
    this.blinking = false;
    this.listeners = [];
  }
  on(fn) { this.listeners.push(fn); }
  _emit(type, t) { for (const fn of this.listeners) fn(type, t); }

  update(t, l, r) {
    this.L.v = l; this.R.v = r;
    for (const [e, v] of [[this.L, l], [this.R, r]]) {
      if (!e.closed && v > this.closeTh) { e.closed = true; e.since = t; e.fired = false; e.tainted = false; }
      else if (e.closed && v < this.openTh) { e.closed = false; }
    }
    if (l > 0.3 || r > 0.3) this.lastBlinkT = t;
    this.blinking = (t - this.lastBlinkT) < 160;       // 眨眼期間與之後 160ms 凍結視線

    if (this.L.closed && this.R.closed) {
      this.L.tainted = this.R.tainted = true;
      const since = Math.max(this.L.since, this.R.since);
      if (!this.bothFired && t - since >= this.bothMs) { this.bothFired = true; this._emit('both', t); }
    } else if (!this.L.closed && !this.R.closed) {
      this.bothFired = false;
    }
    for (const [e, o, ov, name] of [[this.L, this.R, r, 'left'], [this.R, this.L, l, 'right']]) {
      if (e.closed && !o.closed && ov < this.otherOpenTh && !e.tainted && !e.fired && t - e.since >= this.winkMs) {
        e.fired = true;
        this._emit(name, t);
      }
    }
  }
}

// ---------- 特徵計算 ----------
const EYE = {
  // 影像左側那隻眼 = 受測者右眼
  A: { left: 33, right: 133, iris: 468, up: 159, low: 145 },
  // 影像右側那隻眼 = 受測者左眼
  B: { left: 362, right: 263, iris: 473, up: 386, low: 374 },
};

function eyeRatios(lm, e, W, H) {
  const P = i => [lm[i].x * W, lm[i].y * H];
  const a = P(e.left), b = P(e.right), ir = P(e.iris), up = P(e.up), lo = P(e.low);
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const w = Math.hypot(ux, uy) || 1;
  const u = [ux / w, uy / w], n = [-u[1], u[0]];
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  const lx = (up[0] + lo[0]) / 2, ly = (up[1] + lo[1]) / 2;
  const hr = ((ir[0] - cx) * u[0] + (ir[1] - cy) * u[1]) / w;
  const vr = ((ir[0] - lx) * n[0] + (ir[1] - ly) * n[1]) / w;
  return [hr, vr, w];
}

export function computeFeatures(lm, matrix, W, H) {
  const [h1, v1, w1] = eyeRatios(lm, EYE.A, W, H);
  const [h2, v2, w2] = eyeRatios(lm, EYE.B, W, H);
  let yaw = 0, pitch = 0;
  if (matrix) {
    const d = matrix;                // column-major 4x4
    const r02 = d[8], r12 = d[9], r22 = d[10];
    yaw = Math.atan2(r02, r22);
    pitch = Math.atan2(-r12, Math.hypot(r02, r22));
  }
  const nose = lm[168];
  const iod = Math.hypot((lm[33].x - lm[263].x) * W, (lm[33].y - lm[263].y) * H) / W;
  return [(h1 + h2) / 2, (v1 + v2) / 2, yaw, pitch, nose.x, nose.y, iod];
}

// ---------- 真實追蹤器 ----------
export class EyeTracker {
  constructor() {
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', ''); this.video.muted = true; this.video.autoplay = true;
    this.listeners = [];
    this.blink = new BlinkDetector();
    this.running = false;
    this.last = null;
    this.mock = false;
    this.fps = 0;
  }
  on(fn) { this.listeners.push(fn); }
  onBlink(fn) { this.blink.on(fn); }

  async start(status = () => {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('瀏覽器不支援相機（需要 HTTPS 或 localhost）');
    status('要求相機權限…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
    this.video.srcObject = stream;
    await this.video.play();
    status('載入眼動模型（首次約 10 秒）…');
    const { FaceLandmarker, FilesetResolver } = await import(`${VISION_URL}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
    const opts = delegate => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    try { this.lm = await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { this.lm = await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
    this.running = true;
    status('追蹤中');
    this._loop();
  }

  stop() {
    this.running = false;
    this.video.srcObject?.getTracks().forEach(t => t.stop());
  }

  _loop = () => {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this._lastVT) {
      this._lastVT = v.currentTime;
      const now = performance.now();
      const res = this.lm.detectForVideo(v, now);
      this._handle(res, now, v.videoWidth, v.videoHeight);
    }
    requestAnimationFrame(this._loop);
  };

  _handle(res, now, W, H) {
    const lm = res.faceLandmarks?.[0];
    let frame;
    if (!lm) {
      frame = { t: now, face: false, f: null, blinkL: 0, blinkR: 0, blinking: true, lm: null };
    } else {
      const cats = res.faceBlendshapes?.[0]?.categories || [];
      const get = n => cats.find(c => c.categoryName === n)?.score ?? 0;
      let bl = get('eyeBlinkLeft'), br = get('eyeBlinkRight');
      if (Settings.swapEyes) [bl, br] = [br, bl];
      const m = res.facialTransformationMatrixes?.[0]?.data;
      this.blink.update(now, bl, br);
      frame = { t: now, face: true, f: computeFeatures(lm, m, W, H), blinkL: bl, blinkR: br, blinking: this.blink.blinking, lm };
    }
    if (this.last) this.fps = this.fps * 0.9 + 0.1 * (1000 / Math.max(1, now - this.last.t));
    this.last = frame;
    for (const fn of this.listeners) fn(frame);
  }
}

// ---------- 模擬追蹤器：滑鼠 = 視線；Z=左眼眨、X=右眼眨、空白鍵=雙眼眨 ----------
export class MockTracker {
  constructor() {
    this.listeners = []; this.blink = new BlinkDetector(); this.mock = true;
    this.video = null; this.running = false; this.last = null; this.fps = 30;
    this.mx = 0.5; this.my = 0.5; this.keys = { z: false, x: false, ' ': false };
  }
  on(fn) { this.listeners.push(fn); }
  onBlink(fn) { this.blink.on(fn); }
  async start(status = () => {}) {
    addEventListener('mousemove', e => { this.mx = e.clientX / innerWidth; this.my = e.clientY / innerHeight; });
    addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (k in this.keys) { this.keys[k] = true; if (k === ' ') e.preventDefault(); } });
    addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in this.keys) this.keys[k] = false; });
    this.running = true;
    status('模擬模式：滑鼠=視線，Z/X/空白=左/右/雙眼眨');
    this._timer = setInterval(() => this._tick(), 1000 / 30);
  }
  stop() { this.running = false; clearInterval(this._timer); }
  _tick() {
    const now = performance.now();
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.004;  // 近似高斯雜訊
    const hx = this.mx - 0.5, hy = this.my - 0.5;
    const f = [hx * 0.38 + g(), hy * 0.22 + 0.03 * hx * hx + g(), hx * 0.12 + g() * 3, hy * 0.08 + g() * 3, 0.5 + g(), 0.5 + g(), 0.16 + g() * 0.2];
    const both = this.keys[' '];
    const bl = (this.keys.z || both) ? 0.9 : 0.05, br = (this.keys.x || both) ? 0.9 : 0.05;
    this.blink.update(now, bl, br);
    const frame = { t: now, face: true, f, blinkL: bl, blinkR: br, blinking: this.blink.blinking, lm: null };
    this.last = frame;
    for (const fn of this.listeners) fn(frame);
  }
}

export function createTracker() {
  const mock = new URLSearchParams(location.search).has('mock');
  return mock ? new MockTracker() : new EyeTracker();
}

// ---------- 小型相機預覽（含虹膜點與眨眼量表） ----------
export function createPreview(tracker, parent) {
  const box = document.createElement('div');
  box.className = 'preview';
  box.innerHTML = `
    <div class="pv-video"><canvas width="320" height="240"></canvas></div>
    <div class="pv-bars">
      <label>左眼<span class="bar"><i data-k="l"></i></span></label>
      <label>右眼<span class="bar"><i data-k="r"></i></span></label>
    </div>
    <div class="pv-state">尚未啟動</div>`;
  parent.appendChild(box);
  const cv = box.querySelector('canvas'), c = cv.getContext('2d');
  const bl = box.querySelector('[data-k=l]'), br = box.querySelector('[data-k=r]'), st = box.querySelector('.pv-state');
  let lastDraw = 0;
  tracker.on(fr => {
    bl.style.width = (fr.blinkL * 100) + '%'; br.style.width = (fr.blinkR * 100) + '%';
    bl.classList.toggle('on', fr.blinkL > 0.55); br.classList.toggle('on', fr.blinkR > 0.55);
    st.textContent = fr.face ? (fr.blinking ? '眨眼中…' : '偵測到臉部') : '沒有偵測到臉部';
    st.className = 'pv-state ' + (fr.face ? 'ok' : 'bad');
    if (fr.t - lastDraw < 33) return; lastDraw = fr.t;
    c.clearRect(0, 0, 320, 240);
    if (fr.lm) {
      c.fillStyle = '#4ade80';
      for (const i of [468, 473]) { const p = fr.lm[i]; c.beginPath(); c.arc(p.x * 320, p.y * 240, 3, 0, 7); c.fill(); }
      c.fillStyle = '#38bdf8';
      for (const i of [33, 133, 362, 263, 159, 145, 386, 374]) { const p = fr.lm[i]; c.fillRect(p.x * 320 - 1, p.y * 240 - 1, 2, 2); }
    }
  });
  if (tracker.video) box.querySelector('.pv-video').prepend(tracker.video);
  return box;
}
