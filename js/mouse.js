import { createTracker, createPreview, Settings } from './tracker.js';
import { GazeModel, Filter2D } from './gaze.js';

const $ = id => document.getElementById(id);
const tracker = createTracker();
const model = GazeModel.load();
const filt = new Filter2D(1, 0.02);
const cur = $('cursor');
const S = { gain: 1.1, cooldown: 600, trail: false, x: innerWidth / 2, y: innerHeight / 2, lastClick: 0, l: 0, r: 0, t: 0 };

// ---------- 校正狀態 ----------
const st = $('calState');
if (tracker.mock) { st.textContent = '模擬模式（滑鼠=視線）'; st.className = 'status-pill ok'; }
else if (model.ready()) {
  const a = model.accuracy;
  st.textContent = a ? `已校正：誤差 ${a.err.toFixed(0)}px（球半徑 ${a.radius.toFixed(0)}px）` : '已有校正資料';
  st.className = 'status-pill ' + (a && a.ok ? 'ok' : 'no');
} else { st.innerHTML = '尚未校正 → <a href="calibrate.html">先去校正</a>'; st.className = 'status-pill no'; }
if (tracker.mock && !model.ready()) {
  // 模擬模式沒有校正資料：用簡單線性對應
  model.mean = [0, 0, 0, 0, 0, 0, 0]; model.std = [1, 1, 1, 1, 1, 1, 1];
  model.coef = Array.from({ length: 8 }, () => [0, 0]);
  model.coef[0] = [0.5, 0.5]; model.coef[1] = [1 / 0.38, 0]; model.coef[2] = [0, 1 / 0.22];
}

// ---------- 平台小方塊 ----------
const tiles = $('tiles');
const emojis = ['🍎', '🍊', '🍋', '🍇', '🍓', '🥝', '🍑', '🍒', '🥥', '🍍', '🍉', '🍐', '🌽', '🥕', '🍄', '🌶️', '🥑', '🍞'];
emojis.forEach(e => { const d = document.createElement('div'); d.className = 'tile'; d.textContent = e; tiles.appendChild(d); });

// ---------- 懸停 / 點擊（合成事件） ----------
let hovered = null;
const interactive = el => el?.closest?.('button, a, input, select, .tile, #ctxmenu div, .target');
function setHover(el) {
  if (el === hovered) return;
  hovered?.classList.remove('eye-hover');
  hovered = el; hovered?.classList.add('eye-hover');
}
function elAt(x, y) { return document.elementFromPoint(x, y); }

function fire(el, type, x, y, button, buttons) {
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons, view: window };
  const ev = type.startsWith('pointer') ? new PointerEvent(type, { ...opts, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(type, opts);
  return el.dispatchEvent(ev);
}
function ripple(x, y, cls) {
  const d = document.createElement('div'); d.className = 'ripple ' + cls; d.style.left = x + 'px'; d.style.top = y + 'px';
  document.body.appendChild(d); setTimeout(() => d.remove(), 600);
}
const menu = $('ctxmenu');
function hideMenu() { menu.style.display = 'none'; }

function click(which) {
  const now = performance.now();
  if (now - S.lastClick < S.cooldown) return;
  S.lastClick = now;
  const { x, y } = S;
  const el = elAt(x, y) || document.body;
  if (which === 'left') {
    fire(el, 'pointerdown', x, y, 0, 1); fire(el, 'mousedown', x, y, 0, 1);
    fire(el, 'pointerup', x, y, 0, 0); fire(el, 'mouseup', x, y, 0, 0);
    fire(el, 'click', x, y, 0, 0);
    if (!el.closest('#ctxmenu')) hideMenu();
    S.l++; $('cL').textContent = S.l;
    const t = interactive(el);
    if (t?.classList.contains('tile')) { t.classList.add('l'); setTimeout(() => t.classList.remove('l'), 350); }
    if (t?.classList.contains('target')) hitTarget(t);
    if (el.closest('#ctxmenu div')) hideMenu();
    ripple(x, y, 'l'); log(`左眼眨 → 左鍵 (${x | 0}, ${y | 0}) ${label(el)}`);
  } else {
    fire(el, 'pointerdown', x, y, 2, 2); fire(el, 'mousedown', x, y, 2, 2);
    fire(el, 'pointerup', x, y, 2, 0); fire(el, 'mouseup', x, y, 2, 0);
    const ok = fire(el, 'contextmenu', x, y, 2, 0);
    S.r++; $('cR').textContent = S.r;
    const t = interactive(el);
    if (t?.classList.contains('tile')) { t.classList.add('r'); setTimeout(() => t.classList.remove('r'), 350); }
    if (ok) { /* 頁面沒有攔截 contextmenu：顯示自訂選單 */ }
    menu.style.left = Math.min(x, innerWidth - 170) + 'px'; menu.style.top = Math.min(y, innerHeight - 140) + 'px'; menu.style.display = 'block';
    ripple(x, y, 'r'); log(`右眼眨 → 右鍵 (${x | 0}, ${y | 0}) ${label(el)}`);
  }
}
const label = el => { const t = interactive(el); return t ? '→ ' + (t.textContent || t.tagName).trim().slice(0, 12) : ''; };
function log(t) { $('log').textContent = t; }
addEventListener('contextmenu', e => { if (e.isTrusted) e.preventDefault(); });   // 不要跳出瀏覽器原生選單

// ---------- 打靶練習 ----------
let targetEl = null;
function spawnTarget() {
  targetEl?.remove();
  const size = 56 + Math.random() * 30, f = $('field').getBoundingClientRect();
  targetEl = document.createElement('div'); targetEl.className = 'target';
  targetEl.style.cssText = `width:${size}px;height:${size}px;left:${320 + Math.random() * (innerWidth - 420 - size)}px;top:${110 + Math.random() * (innerHeight - 200 - size)}px;position:fixed;z-index:50`;
  document.body.appendChild(targetEl);
}
function hitTarget() { S.t++; $('cT').textContent = S.t; spawnTarget(); }
$('targetBtn').onclick = () => { if (targetEl) { targetEl.remove(); targetEl = null; } else spawnTarget(); };

// ---------- 追蹤迴圈 ----------
let frozen = false, tx = S.x, ty = S.y, ctx2 = null, trailPts = [];
tracker.on(fr => {
  if (!fr.face || !model.ready()) return;
  frozen = fr.blinking;
  cur.classList.toggle('frozen', frozen);
  if (frozen) return;
  const p = model.predict(fr.f);
  let gx = 0.5 + (p[0] - 0.5) * S.gain, gy = 0.5 + (p[1] - 0.5) * S.gain;
  gx = Math.min(1, Math.max(0, gx)); gy = Math.min(1, Math.max(0, gy));
  const [fx, fy] = filt.filter(gx * innerWidth, gy * innerHeight, fr.t);
  tx = fx; ty = fy;
});
tracker.onBlink(type => {
  if (type === 'left') click('left');
  else if (type === 'right') click('right');
});
(function loop() {
  S.x += (tx - S.x) * 0.5; S.y += (ty - S.y) * 0.5;
  cur.style.transform = `translate(${S.x}px, ${S.y}px)`;
  const el = elAt(S.x, S.y);
  setHover(interactive(el) || null);
  if (S.trail) {
    ctx2 ||= $('trail').getContext('2d');
    trailPts.push([S.x, S.y]); if (trailPts.length > 40) trailPts.shift();
    ctx2.clearRect(0, 0, innerWidth, innerHeight);
    ctx2.strokeStyle = 'rgba(91,140,255,.6)'; ctx2.lineWidth = 3; ctx2.beginPath();
    trailPts.forEach(([x, y], i) => (i ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y))); ctx2.stroke();
  }
  requestAnimationFrame(loop);
})();

// ---------- UI ----------
const tr = $('trail'); function rs() { tr.width = innerWidth; tr.height = innerHeight; } addEventListener('resize', rs); rs();
function smoothApply() {
  const v = +$('smooth').value / 100;         // 0 = 即時, 1 = 很平滑
  const min = 4.0 - 3.6 * v;                   // Hz
  filt.set(min, 0.04 - 0.03 * v);
  $('smoothV').textContent = $('smooth').value;
}
$('smooth').oninput = smoothApply; smoothApply();
$('gain').oninput = e => { S.gain = e.target.value / 100; $('gainV').textContent = S.gain.toFixed(2); };
$('wink').oninput = e => { tracker.blink.winkMs = +e.target.value; $('winkV').textContent = e.target.value + 'ms'; };
$('cool').oninput = e => { S.cooldown = +e.target.value; $('coolV').textContent = e.target.value + 'ms'; };
$('trailOn').onchange = e => { S.trail = e.target.checked; if (!S.trail) $('trail').getContext('2d').clearRect(0, 0, innerWidth, innerHeight); };
$('swap').checked = Settings.swapEyes; $('swap').onchange = e => { Settings.swapEyes = e.target.checked; };
$('fsBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$('startBtn').onclick = async () => {
  const b = $('startBtn'); b.disabled = true;
  try {
    await tracker.start(t => { b.textContent = t; });
    createPreview(tracker, $('previewHost'));
    b.textContent = '追蹤中'; log('眼控已啟動：看哪游標去哪；閉左眼=左鍵、閉右眼=右鍵');
  } catch (e) { b.textContent = '失敗：' + e.message; b.disabled = false; }
};
