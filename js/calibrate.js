import { createTracker, createPreview, Settings } from './tracker.js';
import { GazeModel, Filter2D, dist, median } from './gaze.js';

const $ = id => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() {
  const d = devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = W * d; canvas.height = H * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', resize); resize();

const tracker = createTracker();
const model = new GazeModel();
const gazeF = new Filter2D(1.5, 0.02);
let gazePx = null;            // 目前濾波後的視線 (px)
let collector = null;         // 定點模式：收集中的特徵
let trajSink = null;          // 軌跡模式：每個有效 frame 的回呼

const S = { mode: 'point', diameter: 60, speed: 1, path: 'lissa', showGaze: true, running: false, token: null };
const ball = { x: 0.5, y: 0.5, k: 1, visible: false, ring: 0 };
const radius = () => S.diameter / 2;

// ---------- 追蹤回呼 ----------
tracker.on(fr => {
  if (!fr.face) return;
  if (model.ready() && !fr.blinking) {
    const p = model.predict(fr.f);
    const [gx, gy] = gazeF.filter(p[0] * W, p[1] * H, fr.t);
    gazePx = [gx, gy];
  }
  if (fr.blinking) return;
  if (collector) collector.push(fr.f.slice());
  if (trajSink) trajSink(fr);
});

// ---------- 誤差指示條 ----------
let errShown = null;
function setErr(px) {
  errShown = px;
  const r = radius(), max = Math.max(r * 6, 150);
  $('errMax').textContent = Math.round(max) + ' px';
  $('errTick').style.left = (r / max * 100) + '%';
  const fill = $('errFill');
  if (px == null) { fill.style.width = '0'; $('errText').textContent = '—（尚無模型）'; return; }
  fill.style.width = Math.min(100, px / max * 100) + '%';
  fill.style.background = px <= r ? 'var(--good)' : px <= r * 2 ? 'var(--warn)' : 'var(--bad)';
  $('errText').textContent = `${px.toFixed(0)} px ＝ ${(px / r).toFixed(2)} × 球半徑 ${px <= r ? '✔ 已在球內' : ''}`;
}
function say(t, cls = '') { const m = $('msg'); m.textContent = t; m.className = 'msg ' + cls; }

// ---------- 工具 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));
async function tween(ms, fn, tok) {
  const t0 = performance.now();
  for (;;) {
    const k = Math.min(1, (performance.now() - t0) / ms);
    fn(k * k * (3 - 2 * k));
    if (k >= 1 || !tok.alive) return;
    await frame();
  }
}

// ---------- 定點校正 ----------
function gridPoints() {
  const xs = [0.07, 0.5, 0.93], ys = [0.1, 0.5, 0.9], pts = [];
  ys.forEach((y, j) => (j % 2 ? [...xs].reverse() : xs).forEach(x => pts.push([x, y])));
  return pts;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function nextAdaptive(history) {
  const m = 0.06;
  let p;
  const worst = history.slice(-10).sort((a, b) => b.err - a.err)[0];
  if (worst && Math.random() < 0.5) {
    p = [clamp(worst.x + (Math.random() - 0.5) * 0.16, m, 1 - m), clamp(worst.y + (Math.random() - 0.5) * 0.16, m, 1 - m)];
  } else p = [m + Math.random() * (1 - 2 * m), m + Math.random() * (1 - 2 * m)];
  return p;
}

const MAX_POINTS = 40, WINDOW = 8;
async function runPoints(tok) {
  const pts = gridPoints();
  const history = [];   // {x,y,err}
  let idx = 0, pid = 0;
  ball.visible = true;
  while (tok.alive) {
    const [tx, ty] = idx < pts.length ? pts[idx] : nextAdaptive(history);
    // 1. 移動到新位置（球先放大吸引注意，再縮到設定直徑）
    const fx = ball.x, fy = ball.y;
    await tween(450, k => { ball.x = fx + (tx - fx) * k; ball.y = fy + (ty - fy) * k; ball.k = 1 + 0.9 * Math.sin(k * Math.PI); }, tok);
    if (!tok.alive) return;
    // 2. 等待眼睛落定（球縮小）
    say(`請盯著圓球中心　第 ${history.length + 1} 點 / 上限 ${MAX_POINTS}`);
    await tween(550, k => { ball.k = 1.5 - 0.5 * k; }, tok);
    if (!tok.alive) return;
    // 3. 收集視線樣本
    collector = [];
    const liveSink = fr => {
      if (!model.ready() || !fr.face || fr.blinking) return;
      const p = model.predict(fr.f);
      const e = dist(p[0] * W, p[1] * H, tx * W, ty * H);
      setErr(errShown == null ? e : errShown * 0.85 + e * 0.15);
    };
    trajSink = liveSink;
    await tween(1000, k => { ball.k = 1 - 0.12 * Math.sin(k * 12); }, tok);
    trajSink = null;
    const feats = collector; collector = null;
    if (!tok.alive) return;
    if (feats.length < 10) { say('樣本不足（請正對鏡頭、避免眨眼），重試此點…', 'bad'); await sleep(700); continue; }

    // 4. 先驗證（用加入此點前的模型），再訓練
    let err = null;
    if (model.ready() && idx >= pts.length) {
      const px = median(feats.map(f => model.predict(f)[0])) * W, py = median(feats.map(f => model.predict(f)[1])) * H;
      err = dist(px, py, tx * W, ty * H);
      history.push({ x: tx, y: ty, err });
      const win = history.slice(-WINDOW);
      const mean = win.reduce((a, b) => a + b.err, 0) / win.length;
      setErr(mean);
      if (history.length >= WINDOW && mean <= radius() && win.every(h => h.err <= radius() * 1.6)) {
        feats.forEach(f => model.add(f, tx, ty, ++pid)); model.fit();
        return finish(tok, mean, true);
      }
    }
    feats.forEach(f => model.add(f, tx, ty, pid)); pid++;
    model.fit();
    idx++;
    if (history.length >= MAX_POINTS) {
      const win = history.slice(-WINDOW);
      return finish(tok, win.reduce((a, b) => a + b.err, 0) / win.length, false);
    }
  }
}

// ---------- 軌跡校正 ----------
const tri = s => 1 - Math.abs(2 * s - 1);
const PATHS = {
  lissa: s => [0.5 + 0.42 * Math.sin(2 * Math.PI * 3 * s), 0.5 + 0.38 * Math.sin(2 * Math.PI * 2 * s + 0.6)],
  circle: s => [0.5 + 0.42 * Math.cos(2 * Math.PI * s), 0.5 + 0.38 * Math.sin(2 * Math.PI * s)],
  snake: s => [0.5 + 0.42 * Math.sin(2 * Math.PI * 6 * s), 0.08 + 0.84 * tri(s)],
  rect: s => {
    const x0 = 0.07, x1 = 0.93, y0 = 0.1, y1 = 0.9, w = x1 - x0, h = y1 - y0, p = 2 * (w + h), d = s * p;
    if (d < w) return [x0 + d, y0];
    if (d < w + h) return [x1, y0 + d - w];
    if (d < 2 * w + h) return [x1 - (d - w - h), y1];
    return [x0, y1 - (d - 2 * w - h)];
  },
  spiral: s => { const r = 0.04 + 0.34 * (1 - tri(s)), a = 2 * Math.PI * 3 * s; return [0.5 + r * 1.25 * Math.cos(a), 0.5 + r * Math.sin(a)]; },
};
const LAG = 130;        // 視線落後圓球的反應延遲 (ms)
const BASE_PERIOD = 20; // 秒（速度 1×）

async function runTraj(tok) {
  const win = [];
  let n = 0, lastFit = 0, lastLap = 0;
  ball.visible = true; ball.k = 1;
  say('請用視線緊緊跟著圓球');
  // 倒數
  const p0 = PATHS[S.path](0);
  await tween(600, k => { ball.x += (p0[0] - ball.x) * k; ball.y += (p0[1] - ball.y) * k; }, tok);
  const start = performance.now();
  const startPos = tms => { const s = (((tms - start) / 1000 / (BASE_PERIOD / S.speed)) % 1 + 1) % 1; return PATHS[S.path](s); };
  trajSink = fr => {
    const [tx, ty] = startPos(fr.t - LAG);
    if (model.ready()) {
      const p = model.predict(fr.f);
      win.push(dist(p[0] * W, p[1] * H, tx * W, ty * H));
      if (win.length > 150) win.shift();
      setErr(win.reduce((a, b) => a + b, 0) / win.length);
    }
    model.add(fr.f, tx, ty, Math.floor(((fr.t - start) / 1000 / (BASE_PERIOD / S.speed)) * 90));
    n++;
    if (n - lastFit >= 15 && n >= 30) { lastFit = n; model.fit(); }
  };
  while (tok.alive) {
    await frame();
    const el = (performance.now() - start) / 1000, lap = el / (BASE_PERIOD / S.speed);
    const [bx, by] = startPos(performance.now());
    ball.x = bx; ball.y = by;
    if (Math.floor(lap) !== lastLap) { lastLap = Math.floor(lap); say(`第 ${lastLap + 1} 圈…持續跟著圓球`); }
    if (lap >= 2 && win.length >= 120) {
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      if (mean <= radius()) { trajSink = null; model.fit(); return finish(tok, mean, true); }
    }
    if (lap >= 8) { trajSink = null; model.fit(); return finish(tok, win.reduce((a, b) => a + b, 0) / (win.length || 1), false); }
  }
}

// ---------- 結束 ----------
function finish(tok, err, ok) {
  S.running = false; collector = null; trajSink = null;
  $('startBtn').textContent = '重新校正';
  ball.visible = false;
  setErr(err);
  model.accuracy = { err, radius: radius(), ok, mode: S.mode, time: Date.now(), screen: [W, H] };
  model.save();
  if (ok) say(`✅ 校正完成！平均誤差 ${err.toFixed(0)}px ≤ 球半徑 ${radius().toFixed(0)}px（已儲存，可到滑鼠/賽車使用）`, 'good');
  else say(`已達上限，平均誤差 ${err.toFixed(0)}px（球半徑 ${radius().toFixed(0)}px）。可加大圓球直徑、改善光線後再校正；結果已儲存。`, 'bad');
}

// ---------- 繪圖 ----------
function drawBall() {
  if (!ball.visible) return;
  const x = ball.x * W, y = ball.y * H, r = radius() * ball.k;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffe08a'); g.addColorStop(0.6, '#ff9f1c'); g.addColorStop(1, '#e85d04');
  ctx.save();
  ctx.shadowColor = 'rgba(255,160,40,.7)'; ctx.shadowBlur = r * 0.8;
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, r * 0.08), 0, 7); ctx.fill();
}
function drawPath() {
  if (S.mode !== 'traj') return;
  ctx.strokeStyle = 'rgba(120,150,255,.22)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.beginPath();
  for (let i = 0; i <= 400; i++) { const [x, y] = PATHS[S.path](i / 400); i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H); }
  ctx.stroke(); ctx.setLineDash([]);
}
function drawGaze() {
  if (!S.showGaze || !gazePx) return;
  const [x, y] = gazePx;
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(56,189,248,.25)';
  ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y); ctx.moveTo(x, y - 20); ctx.lineTo(x, y + 20); ctx.stroke();
}
(function loop() {
  ctx.clearRect(0, 0, W, H);
  drawPath(); drawBall(); drawGaze();
  requestAnimationFrame(loop);
})();

// ---------- UI ----------
function start() {
  if (S.running) { S.token.alive = false; }
  const tok = { alive: true };
  S.token = tok; S.running = true;
  if (model.count === 0 || S.mode === 'point') { /* 沿用已累積資料 */ }
  gazeF.reset();
  $('startBtn').textContent = '停止';
  (S.mode === 'point' ? runPoints(tok) : runTraj(tok)).catch(e => { console.error(e); say('發生錯誤：' + e.message, 'bad'); });
}
function stop() { if (S.token) S.token.alive = false; S.running = false; collector = null; trajSink = null; ball.visible = false; $('startBtn').textContent = '開始校正'; say('已停止。'); }

$('startBtn').onclick = () => (S.running ? stop() : start());
$('fsBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$('clearBtn').onclick = () => { stop(); model.reset(); GazeModel.clearSaved(); gazePx = null; setErr(null); say('已清除校正資料。'); };
$('dia').oninput = e => { S.diameter = +e.target.value; $('diaV').textContent = S.diameter + 'px'; setErr(errShown); };
$('spd').oninput = e => { S.speed = +e.target.value; $('spdV').textContent = S.speed.toFixed(1) + '×'; };
$('path').onchange = e => { S.path = e.target.value; };
$('showGaze').onchange = e => { S.showGaze = e.target.checked; };
$('swap').checked = Settings.swapEyes; $('swap').onchange = e => { Settings.swapEyes = e.target.checked; };
$('modeSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (S.running) stop();
  S.mode = b.dataset.m;
  [...$('modeSeg').children].forEach(x => x.classList.toggle('on', x === b));
  $('trajOpts').classList.toggle('hidden', S.mode !== 'traj');
};
setErr(null);

$('goBtn').onclick = async () => {
  $('goBtn').disabled = true;
  try {
    await tracker.start(t => { $('loadMsg').textContent = t; });
    createPreview(tracker, $('previewHost'));
    $('startOverlay').classList.add('hidden');
    say('相機已啟動。按「開始校正」（建議先按全螢幕）。');
  } catch (e) {
    console.error(e);
    $('loadMsg').textContent = '無法啟動：' + e.message;
    $('goBtn').disabled = false;
  }
};
window.__cal = { ball, S, model, get err() { return errShown; } };
