import { createTracker, createPreview } from './tracker.js';
import { GazeModel, Filter2D } from './gaze.js';
import { carSprite, pineSprite, oakSprite, bushSprite, rockSprite, missileSprite } from './sprites.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', resize); resize();

// ================= 追蹤 / 輸入 =================
const tracker = createTracker();
const model = GazeModel.load();
const gazeF = new Filter2D(1.6, 0.03);
const input = { gx: 0.5, haveGaze: false, faceT: 0, kbDir: 0, kbOnly: false };
if (tracker.mock && !model.ready()) {
  model.mean = new Array(7).fill(0); model.std = new Array(7).fill(1);
  model.coef = Array.from({ length: 8 }, () => [0, 0]); model.coef[0] = [0.5, 0.5]; model.coef[1] = [1 / 0.38, 0]; model.coef[2] = [0, 1 / 0.22];
}
tracker.on(fr => {
  if (!fr.face) return;
  input.faceT = performance.now();
  if (fr.blinking || !model.ready()) return;           // 眨眼時凍結視線，避免車子亂跳
  const p = model.predict(fr.f);
  input.gx = gazeF.filter(Math.min(1, Math.max(0, p[0])), 0, fr.t)[0];
  input.haveGaze = true;
});
tracker.onBlink(() => fire());

addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') input.kbDir = -1;
  else if (e.key === 'ArrowRight' || e.key === 'd') input.kbDir = 1;
  else if (e.key === ' ') { fire(); e.preventDefault(); }
  else if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
});
addEventListener('keyup', e => {
  if ((e.key === 'ArrowLeft' || e.key === 'a') && input.kbDir < 0) input.kbDir = 0;
  if ((e.key === 'ArrowRight' || e.key === 'd') && input.kbDir > 0) input.kbDir = 0;
});

// ================= 音效 =================
const Audio = {
  ac: null, muted: false, eng: null,
  init() {
    if (this.ac) return;
    const ac = this.ac = new (window.AudioContext || window.webkitAudioContext)();
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const g = ac.createGain(); g.gain.value = 0.05;
    const o1 = ac.createOscillator(); o1.type = 'sawtooth'; const o2 = ac.createOscillator(); o2.type = 'square';
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(ac.destination); o1.start(); o2.start();
    this.eng = { o1, o2, g, lp };
    const len = ac.sampleRate * 1.2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  },
  engine(frac) {
    if (!this.eng) return;
    const f = 48 + frac * 110;
    this.eng.o1.frequency.value = f; this.eng.o2.frequency.value = f * 0.5; this.eng.lp.frequency.value = 350 + frac * 700;
    this.eng.g.gain.value = this.muted || state !== 'play' ? 0 : 0.045;
  },
  burst(kind) {
    if (!this.ac || this.muted) return;
    const ac = this.ac, src = ac.createBufferSource(); src.buffer = this.noise;
    const f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
    if (kind === 'boom') { f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.6); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); }
    else if (kind === 'crash') { f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(80, t + 0.8); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); }
    else { f.type = 'bandpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.35); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); }
    src.connect(f); f.connect(g); g.connect(ac.destination); src.start(t); src.stop(t + 1);
  },
};
function toggleMute() { Audio.muted = !Audio.muted; $('muteBtn').textContent = Audio.muted ? '🔇' : '🔊'; }

// ================= 賽道（偽 3D） =================
const FPS_STEP = 1 / 60;
const ROAD_W = 2000, SEG_L = 200, RUMBLE = 3, LANES = 3, CAM_H = 1000, DRAW = 220, FOG_D = 5, FOV = 100;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z = CAM_H * CAM_DEPTH;
const MAX_SPEED = SEG_L * 60;
const COLORS = {
  light: { road: '#6c6c70', grass: '#4d9b46', rumble: '#e8e8e8', lane: '#e6e6e6' },
  dark: { road: '#646468', grass: '#44903f', rumble: '#c62828' },
};
const SKY_TOP = '#2f6fcf', SKY_HOR = '#cfe4f7';
const segments = [];
let L = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const lastY = () => (segments.length ? segments[segments.length - 1].p2.world.y : 0);
function addSegment(curve, y) {
  const n = segments.length;
  segments.push({
    index: n, curve, dyn: [], decor: [],
    p1: { world: { y: lastY(), z: n * SEG_L }, camera: {}, screen: {} },
    p2: { world: { y, z: (n + 1) * SEG_L }, camera: {}, screen: {} },
    dark: Math.floor(n / RUMBLE) % 2 === 1,
  });
}
function addRoad(enter, hold, leave, curve, y) {
  const startY = lastY(), endY = startY + y * SEG_L, total = enter + hold + leave;
  for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}

// ================= 精靈 =================
const SPR = {
  cars: {},
  rocks: [rockSprite(1), rockSprite(2, true), rockSprite(3), rockSprite(4, true)],
  pines: [pineSprite(0), pineSprite(1), pineSprite(2)],
  oaks: [oakSprite(0), oakSprite(1), oakSprite(2)],
  bush: bushSprite(), missile: missileSprite(),
  player: carSprite('#d62828', 'sport'),
};
const CAR_COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#2c3e50', '#16a085', '#c0392b'];
const TRUCK_COLORS = ['#f4f4f4', '#2e86de', '#e67e22', '#27ae60'];
function carImg(color, style) { const k = color + style; return SPR.cars[k] ||= carSprite(color, style); }

function decorate() {
  for (let i = 8; i < segments.length; i += 2) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.55) {
        const r = Math.random();
        const off = side * rnd(1.3, 4.5);
        if (r < 0.4) segments[i].decor.push({ img: SPR.pines[(Math.random() * 3) | 0], w: rnd(1400, 2100), off });
        else if (r < 0.7) segments[i].decor.push({ img: SPR.oaks[(Math.random() * 3) | 0], w: rnd(1500, 2300), off });
        else if (r < 0.88) segments[i].decor.push({ img: SPR.bush, w: rnd(500, 900), off: side * rnd(1.2, 2.4) });
        else segments[i].decor.push({ img: SPR.rocks[(Math.random() * 4) | 0], w: rnd(400, 800), off: side * rnd(1.25, 2.6) });
      }
    }
  }
}
function buildRoad() {
  segments.length = 0;
  const S = n => addRoad(n, n, n, 0, 0);
  S(25); addRoad(50, 50, 50, 2, 0); S(30); addRoad(40, 40, 40, 0, 30);
  addRoad(50, 50, 50, -4, 0); addRoad(25, 25, 25, 0, -18); addRoad(40, 40, 40, 4, 16);
  S(25); addRoad(50, 50, 50, -3, -14); addRoad(40, 40, 40, 0, 22); addRoad(30, 30, 30, 6, 0);
  S(20); addRoad(50, 50, 50, -6, 0); addRoad(40, 40, 40, 2, 0);
  addRoad(60, 60, 60, 0, -lastY() / SEG_L);
  S(20);
  L = segments.length * SEG_L;
  decorate();
}
buildRoad();

// ================= 背景 =================
const bg = {
  far: mkMountains(2048, 260, '#7f9bb8', '#a9bfd4', 3, 5, 11),
  near: mkMountains(2048, 200, '#4d6f57', '#6b8f6f', 5, 9, 23),
  clouds: Array.from({ length: 9 }, () => ({ x: Math.random(), y: rnd(0.05, 0.3), s: rnd(0.6, 1.4) })),
};
function mkMountains(w, h, c1, c2, f1, f2, ph) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const y = x => {
    const t = (x / w) * Math.PI * 2;
    return h * 0.55 - (Math.sin(t * f1 + ph) * 0.5 + Math.sin(t * f2 * 2 + ph * 2) * 0.28 + Math.sin(t * f2 * 5 + ph) * 0.12) * h * 0.4;
  };
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, y(x));
  g.lineTo(w, h); g.closePath(); g.fill();
  return c;
}
let bgScroll = 0;
function drawBackground() {
  const hor = H * 0.5;
  const g = ctx.createLinearGradient(0, 0, 0, hor + 20); g.addColorStop(0, SKY_TOP); g.addColorStop(1, SKY_HOR);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hor + 20);
  // 太陽
  const sx = W * 0.72 - bgScroll * 0.02 % W, sg = ctx.createRadialGradient(sx, hor * 0.5, 4, sx, hor * 0.5, 160);
  sg.addColorStop(0, 'rgba(255,250,220,1)'); sg.addColorStop(0.15, 'rgba(255,240,180,.9)'); sg.addColorStop(1, 'rgba(255,230,150,0)');
  ctx.fillStyle = sg; ctx.fillRect(sx - 170, hor * 0.5 - 170, 340, 340);
  // 雲
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (const c of bg.clouds) {
    const x = (((c.x * W * 1.6 - bgScroll * 0.05) % (W * 1.6)) + W * 1.6) % (W * 1.6) - W * 0.3, y = c.y * hor, s = c.s * W * 0.05;
    ctx.beginPath(); ctx.ellipse(x, y, s * 2, s * 0.6, 0, 0, 7); ctx.ellipse(x + s, y - s * 0.3, s * 1.3, s * 0.6, 0, 0, 7); ctx.ellipse(x - s, y - s * 0.1, s * 1.1, s * 0.5, 0, 0, 7); ctx.fill();
  }
  // 山
  const mh = hor * 0.62, drawLayer = (img, k, y) => {
    const iw = img.width * (mh / img.height) * 1.0, off = (((bgScroll * k) % iw) + iw) % iw;
    for (let x = -off; x < W; x += iw) ctx.drawImage(img, x, y, iw, mh);
  };
  drawLayer(bg.far, 0.12, hor - mh * 0.9); drawLayer(bg.near, 0.28, hor - mh * 0.7);
  // 地平線以下先填霧色
  ctx.fillStyle = SKY_HOR; ctx.fillRect(0, hor + 12, W, H);
}

// ================= 遊戲狀態 =================
let state = 'menu';
const G = {};
function reset() {
  Object.assign(G, {
    dist: 0, speed: MAX_SPEED * 0.45, playerX: 0, steerV: 0, score: 0, kills: 0, lives: 3, ammo: 5, ammoT: 0, fireT: 0,
    obstacles: [], missiles: [], boom: [], t: 0, spawnD: 0, invuln: 0, shake: 0, flash: 0, crashT: 0, lastLane: 1, bounce: 0,
  });
  G.nextSpawn = 14000;
  bgScroll = 0;
}
reset();

const LANE_X = [-0.62, 0, 0.62];
function spawnObstacle(lane, zOff = 0) {
  const r = Math.random(), z = G.dist + DRAW * SEG_L * 0.92 + zOff;
  const x = LANE_X[lane] + rnd(-0.08, 0.08);
  if (r < 0.46) {
    const style = ['sedan', 'sedan', 'suv', 'truck', 'sport'][(Math.random() * 5) | 0];
    const color = style === 'truck' ? TRUCK_COLORS[(Math.random() * 4) | 0] : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
    G.obstacles.push({ type: 'car', img: carImg(color, style), w: style === 'truck' ? 780 : 700, hw: style === 'truck' ? 0.2 : 0.17, x, z, v: MAX_SPEED * rnd(0.18, 0.4), pts: 50 });
  } else if (r < 0.74) {
    const big = Math.random() < 0.4;
    G.obstacles.push({ type: 'rock', img: SPR.rocks[(Math.random() * 4) | 0], w: big ? 820 : 620, hw: big ? 0.2 : 0.16, x, z, v: 0, pts: 30 });
  } else {
    const oak = Math.random() < 0.5;
    G.obstacles.push({ type: 'tree', img: oak ? SPR.oaks[(Math.random() * 3) | 0] : SPR.pines[(Math.random() * 3) | 0], w: 1050, hw: 0.12, x, z, v: 0, pts: 30 });
  }
}

function fire() {
  if (state !== 'play') return;
  const now = performance.now();
  if (now - G.fireT < 320 || G.ammo < 1) return;
  G.fireT = now; G.ammo--;
  G.missiles.push({ x: G.playerX, z: G.dist + PLAYER_Z + 350, prev: G.dist + PLAYER_Z + 350, v: MAX_SPEED * 2.6 + G.speed, age: 0 });
  Audio.burst('launch'); G.muzzle = 0.12;
}

function explode(x, z, size = 1) {
  G.boom.push({ x, z, t: 0, size, sparks: Array.from({ length: 16 }, () => ({ a: rnd(0, Math.PI), v: rnd(0.5, 1.6) })) });
  Audio.burst('boom');
}

function crash(o) {
  explode(o.x, o.z, 1.3);
  G.obstacles.splice(G.obstacles.indexOf(o), 1);
  Audio.burst('crash');
  G.shake = 0.5; G.flash = 0.5; G.speed *= 0.45; G.invuln = 1.6; G.lives--;
  if (G.lives <= 0) gameOver();
}

function update(dt) {
  G.t += dt;
  // ---- 難度與速度 ----
  const level = Math.min(1, G.t / 120);
  const target = MAX_SPEED * (0.5 + 0.5 * level);
  const offroad = Math.abs(G.playerX) > 1.08;
  G.speed += (offroad ? Math.min(target, MAX_SPEED * 0.3) - G.speed : target - G.speed) * Math.min(1, dt * (offroad ? 2.5 : 0.8));
  G.dist += G.speed * dt;
  const sp = G.speed / MAX_SPEED;
  const seg = segments[Math.floor(((G.dist + PLAYER_Z) % L) / SEG_L)];

  // ---- 轉向：視線決定目標位置 ----
  let desired = null;
  if (input.kbDir) desired = G.playerX + input.kbDir * 0.9;
  else if (input.haveGaze && !input.kbOnly && performance.now() - input.faceT < 700) desired = Math.max(-1.05, Math.min(1.05, (input.gx - 0.5) * 2 * 1.25));
  const prev = G.playerX;
  if (desired !== null) {
    let dx = (desired - G.playerX) * (1 - Math.exp(-dt * 6));
    const maxStep = 2.4 * dt; dx = Math.max(-maxStep, Math.min(maxStep, dx));
    G.playerX += dx;
  }
  G.playerX -= (dt * 2 * sp) * seg.curve * sp * 0.22;      // 彎道離心力
  G.playerX = Math.max(-1.6, Math.min(1.6, G.playerX));
  G.steerV += ((G.playerX - prev) / Math.max(dt, 1e-3) - G.steerV) * Math.min(1, dt * 12);
  bgScroll += seg.curve * sp * dt * 900;

  // ---- 子彈/飛彈補給 ----
  G.ammoT += dt; if (G.ammoT > 1.5) { G.ammoT = 0; G.ammo = Math.min(5, G.ammo + 1); }
  if (G.muzzle) G.muzzle = Math.max(0, G.muzzle - dt);

  // ---- 生成障礙 ----
  G.spawnD += G.speed * dt;
  if (G.spawnD >= G.nextSpawn) {
    G.spawnD = 0; G.nextSpawn = rnd(9000, 16000) * (1.1 - 0.5 * level);
    let lane = (Math.random() * 3) | 0; if (lane === G.lastLane && Math.random() < 0.5) lane = (lane + 1 + ((Math.random() * 2) | 0)) % 3;
    G.lastLane = lane; spawnObstacle(lane);
    if (level > 0.25 && Math.random() < 0.3 + level * 0.3) spawnObstacle((lane + 1 + ((Math.random() * 2) | 0)) % 3, rnd(-2000, 2000));
  }
  const pz = G.dist + PLAYER_Z;
  for (const o of [...G.obstacles]) {
    o.z += o.v * dt;
    const dz = o.z - pz;
    if (dz < -3000) { G.obstacles.splice(G.obstacles.indexOf(o), 1); continue; }
    if (G.invuln <= 0 && Math.abs(dz) < 260 && Math.abs(o.x - G.playerX) < o.hw + 0.15) { crash(o); if (state !== 'play') return; }
  }

  // ---- 飛彈 ----
  for (const m of [...G.missiles]) {
    m.prev = m.z; m.z += m.v * dt; m.age += dt;
    let hit = null;
    for (const o of G.obstacles) {
      if (m.prev <= o.z + 260 && m.z >= o.z - 260 && Math.abs(m.x - o.x) < o.hw + 0.13) { hit = o; break; }
    }
    if (hit) {
      G.obstacles.splice(G.obstacles.indexOf(hit), 1); G.missiles.splice(G.missiles.indexOf(m), 1);
      explode(hit.x, hit.z, hit.type === 'car' ? 1.2 : 0.9); G.kills++; G.score += hit.pts;
    } else if (m.z - pz > DRAW * SEG_L * 0.95) G.missiles.splice(G.missiles.indexOf(m), 1);
  }
  for (const b of [...G.boom]) { b.t += dt; if (b.t > 0.9) G.boom.splice(G.boom.indexOf(b), 1); }

  G.invuln = Math.max(0, G.invuln - dt); G.shake = Math.max(0, G.shake - dt); G.flash = Math.max(0, G.flash - dt);
  G.score += (G.speed * dt) / 400;
  G.bounce = Math.sin(G.t * 28) * sp * 1.6 + (offroad ? Math.sin(G.t * 60) * 5 : 0);
  Audio.engine(sp);
}

// ================= 繪製 =================
function project(p, camX, camY, camZ) {
  p.camera.x = (p.world.x || 0) - camX; p.camera.y = p.world.y - camY; p.camera.z = p.world.z - camZ;
  p.screen.scale = CAM_DEPTH / p.camera.z;
  p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
  p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
  p.screen.w = Math.round(p.screen.scale * ROAD_W * W / 2);
}
function poly(x1, y1, x2, y2, x3, y3, x4, y4, col) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
function renderSegment(x1, y1, w1, x2, y2, w2, fog, dark) {
  const c = dark ? COLORS.dark : COLORS.light;
  const r1 = w1 / Math.max(6, 2 * LANES), r2 = w2 / Math.max(6, 2 * LANES);
  const l1 = w1 / Math.max(32, 8 * LANES), l2 = w2 / Math.max(32, 8 * LANES);
  ctx.fillStyle = c.grass; ctx.fillRect(0, y2, W, y1 - y2 + 1);
  y1 += 1;   // 多畫 1px 避免相鄰區段之間出現縫隙
  poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, c.rumble);
  poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, c.rumble);
  poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, c.road);
  if (!dark) {
    const lw1 = (w1 * 2) / LANES, lw2 = (w2 * 2) / LANES;
    let lx1 = x1 - w1, lx2 = x2 - w2;
    for (let i = 1; i < LANES; i++) {
      lx1 += lw1; lx2 += lw2;
      poly(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, COLORS.light.lane);
    }
  }
  if (fog > 0.01) { ctx.globalAlpha = fog; ctx.fillStyle = SKY_HOR; ctx.fillRect(0, y2, W, y1 - y2 + 1); ctx.globalAlpha = 1; }
}
function drawSpr(img, wWorld, scale, x, y, clipY, alpha = 1) {
  const dw = wWorld * scale * W / 2, dh = dw * img.height / img.width;
  if (dw < 1) return;
  const dx = x - dw / 2, dy = y - dh, clipH = clipY ? Math.max(0, dy + dh - clipY) : 0;
  if (clipH >= dh) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, 0, 0, img.width, img.height - (img.height * clipH) / dh, dx, dy, dw, dh - clipH);
  ctx.globalAlpha = 1;
}
const lerp = (a, b, t) => a + (b - a) * t;

function place(seg, z, off) {       // 取得物件在螢幕上的位置
  const pct = ((z % L) % SEG_L) / SEG_L;
  const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pct);
  return { sc, x: lerp(seg.p1.screen.x, seg.p2.screen.x, pct) + sc * off * ROAD_W * W / 2, y: lerp(seg.p1.screen.y, seg.p2.screen.y, pct) };
}

function drawExplosion(b, p, seg) {
  const base = 700 * b.size * p.sc * W / 2;        // 像素尺寸
  const k = b.t / 0.9, a = 1 - k;
  ctx.save();
  if (seg.clip) { ctx.beginPath(); ctx.rect(0, 0, W, seg.clip); ctx.clip(); }
  const r = base * (0.35 + k * 0.9), cy = p.y - base * 0.35 - k * base * 0.2;
  const g = ctx.createRadialGradient(p.x, cy, 1, p.x, cy, r);
  g.addColorStop(0, `rgba(255,255,230,${a})`); g.addColorStop(0.25, `rgba(255,210,70,${a * 0.95})`); g.addColorStop(0.6, `rgba(255,100,20,${a * 0.7})`); g.addColorStop(1, 'rgba(120,30,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, cy, r, 0, 7); ctx.fill();
  // 煙
  for (let i = 0; i < 5; i++) {
    const sx = p.x + Math.sin(i * 2.1) * r * 0.5, sy = cy - k * base * (0.4 + i * 0.12), sr = base * (0.18 + k * 0.3);
    ctx.fillStyle = `rgba(40,40,40,${0.35 * a})`; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
  }
  // 碎片火花
  for (const s of b.sparks) {
    const sx = p.x + Math.cos(s.a) * s.v * k * base * 1.6 * (s.a > 1.57 ? -1 : 1) * 0.6, sy = cy - (Math.sin(s.a) * s.v * k - 1.6 * k * k) * base * 1.1;
    ctx.fillStyle = `rgba(255,${180 + ((s.v * 40) | 0)},60,${a})`; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, base * 0.025), 0, 7); ctx.fill();
  }
  ctx.restore();
}

function render() {
  const sx = G.shake > 0 ? (Math.random() - 0.5) * 14 * G.shake : 0, sy = G.shake > 0 ? (Math.random() - 0.5) * 10 * G.shake : 0;
  ctx.save(); ctx.translate(sx, sy);
  drawBackground();
  const pos = G.dist % L;
  const base = segments[Math.floor(pos / SEG_L) % segments.length], basePct = (pos % SEG_L) / SEG_L;
  const pSeg = segments[Math.floor(((pos + PLAYER_Z) % L) / SEG_L)], pPct = (((pos + PLAYER_Z) % L) % SEG_L) / SEG_L;
  const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
  for (const s of segments) s.dyn.length = 0;

  // 動態物件分桶
  const bucket = (arr, kind) => {
    for (const o of arr) {
      const rel = o.z - G.dist;
      if (rel <= PLAYER_Z * 0.4 || rel > DRAW * SEG_L) continue;
      segments[Math.floor((o.z % L) / SEG_L)].dyn.push({ kind, o });
    }
  };
  bucket(G.obstacles, 'obs'); bucket(G.missiles, 'mis'); bucket(G.boom, 'boom');

  let x = 0, dx = -(base.curve * basePct), maxy = H;
  const camX = G.playerX * ROAD_W;
  for (let n = 0; n < DRAW; n++) {
    const seg = segments[(base.index + n) % segments.length];
    const looped = seg.index < base.index;
    seg.fog = 1 - 1 / Math.exp((n / DRAW) * (n / DRAW) * FOG_D);
    seg.clip = maxy;
    project(seg.p1, camX - x, playerY + CAM_H, pos - (looped ? L : 0));
    project(seg.p2, camX - x - dx, playerY + CAM_H, pos - (looped ? L : 0));
    x += dx; dx += seg.curve;
    if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) { seg.skip = true; continue; }
    seg.skip = false;
    renderSegment(seg.p1.screen.x, seg.p1.screen.y, seg.p1.screen.w, seg.p2.screen.x, seg.p2.screen.y, seg.p2.screen.w, seg.fog, seg.dark);
    maxy = seg.p1.screen.y;
  }
  // 由遠到近畫精靈
  for (let n = DRAW - 1; n >= 0; n--) {
    const seg = segments[(base.index + n) % segments.length];
    if (seg.p1.camera.z <= CAM_DEPTH) continue;
    const al = 1 - seg.fog * 0.9;
    for (const d of seg.decor) {
      const sc = seg.p1.screen.scale;
      drawSpr(d.img, d.w, sc, seg.p1.screen.x + sc * d.off * ROAD_W * W / 2, seg.p1.screen.y, seg.clip, al);
    }
    for (const d of seg.dyn) {
      const p = place(seg, d.o.z, d.o.x);
      if (d.kind === 'obs') {
        // 腳下陰影已畫在精靈中；稍微依速度差顯示
        drawSpr(d.o.img, d.o.w, p.sc, p.x, p.y, seg.clip, al);
      } else if (d.kind === 'mis') {
        drawSpr(SPR.missile, 420, p.sc, p.x, p.y + 140 * p.sc * W / 2 * 0.0 + 0, seg.clip, 1);
        // 簡易火焰尾跡
        ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffb347'; const tr = 100 * p.sc * W / 2; ctx.beginPath(); ctx.arc(p.x, p.y - tr * 0.6, tr * 0.9, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } else drawExplosion(d.o, p, seg);
    }
  }
  drawPlayer();
  ctx.restore();
  if (G.flash > 0) { ctx.fillStyle = `rgba(255,30,30,${G.flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
  drawHUD();
}

function drawPlayer() {
  const sc = 1 / CAM_H, dw = 600 * sc * W / 2, dh = dw * SPR.player.height / SPR.player.width;
  const y = H * 0.985 + G.bounce, x = W / 2;
  if (G.invuln > 0 && Math.floor(G.t * 14) % 2 === 0) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(Math.max(-0.07, Math.min(0.07, G.steerV * 0.05)));
  // 後輪揚起的塵/煙（偏離路面時）
  if (Math.abs(G.playerX) > 1.08) { ctx.fillStyle = 'rgba(180,150,110,.35)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(rnd(-dw * 0.5, dw * 0.5), -rnd(0, dh * 0.3), rnd(10, 30), 0, 7); ctx.fill(); } }
  ctx.drawImage(SPR.player, -dw / 2, -dh, dw, dh);
  if (G.muzzle) { const g = ctx.createRadialGradient(0, -dh * 0.55, 2, 0, -dh * 0.55, dw * 0.35); g.addColorStop(0, 'rgba(255,240,170,.9)'); g.addColorStop(1, 'rgba(255,140,0,0)'); ctx.fillStyle = g; ctx.fillRect(-dw / 2, -dh, dw, dh); }
  ctx.restore();
}

function text(t, x, y, size, col = '#fff', align = 'left') {
  ctx.font = `700 ${size}px system-ui, "Noto Sans TC", sans-serif`; ctx.textAlign = align;
  ctx.lineWidth = size / 6; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y);
}
function drawHUD() {
  if (state === 'menu') return;
  const u = Math.max(14, Math.min(W, H) / 30);
  text(`分數 ${Math.floor(G.score)}`, 16, 16 + u * 1.3, u * 1.4);
  text(`擊毀 ${G.kills}`, 16, 16 + u * 2.9, u);
  for (let i = 0; i < 3; i++) text(i < G.lives ? '❤' : '♡', W / 2 - u * 2.2 + i * u * 2, 16 + u * 1.5, u * 1.6, i < G.lives ? '#ff4d5e' : '#aaa', 'center');
  // 彈藥
  for (let i = 0; i < 5; i++) {
    const x = 16 + i * u * 1.1, y = H - 20 - u * 1.4, on = i < G.ammo;
    ctx.fillStyle = on ? '#fbbf24' : 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.roundRect(x, y, u * 0.7, u * 1.4, 4); ctx.fill();
    ctx.fillStyle = on ? '#ef4444' : 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + u * 0.35, y - u * 0.5); ctx.lineTo(x + u * 0.7, y); ctx.fill();
  }
  text('眨眼發射', 16, H - 20 - u * 1.9, u * 0.8, '#fde68a');
  text(`${Math.round((G.speed / MAX_SPEED) * 240)} km/h`, W - 16, 92 + u * 1.4, u * 1.4, '#fff', 'right');
  // 視線指示條
  const bw = Math.min(W * 0.5, 600), bx = (W - bw) / 2, by = H - 16;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.roundRect(bx, by - 8, bw, 8, 4); ctx.fill();
  ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(bx + bw * (input.kbDir ? (G.playerX / 2.5 + 0.5) : input.gx), by - 4, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(bx + bw / 2 - 1, by - 14, 2, 20);
  if (!tracker.mock && !input.kbOnly && performance.now() - input.faceT > 800 && state === 'play') text('⚠ 沒有偵測到臉部', W / 2, H * 0.25, u * 1.6, '#fbbf24', 'center');
}

// ================= 流程 =================
let last = 0, acc = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
  if (state === 'play') { acc += dt; while (acc >= FPS_STEP) { update(FPS_STEP); acc -= FPS_STEP; if (state !== 'play') break; } }
  render();
  requestAnimationFrame(frame);
}
function startGame() {
  Audio.init(); Audio.ac?.resume();
  reset(); $('menu').classList.add('hidden'); $('over').classList.add('hidden'); state = 'play';
}
function gameOver() {
  state = 'over'; Audio.engine(0);
  let best = 0; try { best = +localStorage.getItem('eyegame.race.best') || 0; } catch { /* ignore */ }
  const s = Math.floor(G.score); if (s > best) { best = s; try { localStorage.setItem('eyegame.race.best', s); } catch { /* ignore */ } }
  $('finalScore').textContent = s;
  $('finalInfo').textContent = `擊毀 ${G.kills} 個障礙　最高分 ${best}`;
  setTimeout(() => $('over').classList.remove('hidden'), 500);
}
function togglePause() { if (state === 'play') { state = 'pause'; $('pauseBtn').textContent = '繼續 (P)'; } else if (state === 'pause') { state = 'play'; $('pauseBtn').textContent = '暫停 (P)'; } }

$('pauseBtn').onclick = togglePause;
$('muteBtn').onclick = toggleMute;
$('fsBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
$('againBtn').onclick = startGame;
$('kbBtn').onclick = () => { input.kbOnly = true; startGame(); };
$('goBtn').onclick = async () => {
  $('goBtn').disabled = true;
  try {
    await tracker.start(t => { $('loadMsg').textContent = t; });
    createPreview(tracker, $('previewHost'));
    startGame();
  } catch (e) { console.error(e); $('loadMsg').textContent = '無法啟動：' + e.message; $('goBtn').disabled = false; }
};
const ci = $('calInfo');
if (tracker.mock) ci.textContent = '模擬模式：滑鼠左右移動=視線，Z / X / 空白 = 眨眼（發射）';
else if (!model.ready()) ci.innerHTML = '⚠ 尚未校正視線 → <a href="calibrate.html">先去校正</a>（或按「只用鍵盤試玩」）';
else ci.innerHTML = `已載入校正資料${model.accuracy ? `（誤差 ${model.accuracy.err.toFixed(0)}px）` : ''}　<a href="calibrate.html">重新校正</a>`;
requestAnimationFrame(frame);
window.__race = { G, get state() { return state; }, fire, startGame };   // 除錯/測試用
