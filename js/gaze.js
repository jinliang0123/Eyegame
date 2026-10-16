// 視線模型：把眼球/頭部特徵向量映射到螢幕座標 (0..1)，並提供濾波器與儲存
export const STORE_KEY = 'eyegame.calibration.v1';
export const FEATURE_NAMES = ['虹膜水平', '虹膜垂直', '頭部偏轉', '頭部俯仰', '臉部X', '臉部Y', '臉部大小'];
const D = 7;          // 特徵維度
const QUAD_DIMS = 4;  // 前 4 維做二次項

// ---------- One-Euro 濾波器（低延遲平滑） ----------
class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.01, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0; this.t = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() { this.x = null; this.t = null; this.dx = 0; }
  filter(v, tMs) {
    if (this.x === null) { this.x = v; this.t = tMs; return v; }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

export class Filter2D {
  constructor(minCutoff = 1.2, beta = 0.015) {
    this.fx = new OneEuro(minCutoff, beta);
    this.fy = new OneEuro(minCutoff, beta);
  }
  set(minCutoff, beta) {
    for (const f of [this.fx, this.fy]) { f.minCutoff = minCutoff; if (beta != null) f.beta = beta; }
  }
  reset() { this.fx.reset(); this.fy.reset(); }
  filter(x, y, tMs) { return [this.fx.filter(x, tMs), this.fy.filter(y, tMs)]; }
}

// ---------- 線性代數：解 (A) w = b ----------
function solve(A, B) {
  // A: n×n, B: n×m ；高斯消去（部分主元）
  const n = A.length, m = B[0].length;
  const M = A.map((row, i) => row.concat(B[i]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let k = c; k < n + m; k++) M[c][k] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map(row => row.slice(n));
}

// ---------- 視線模型（嶺迴歸） ----------
export class GazeModel {
  constructor() { this.reset(); }

  reset() {
    this.samples = [];      // {f:[D], x, y, pid}
    this.maxSamples = 3500;
    this.coef = null;       // [terms][2]
    this.mean = null; this.std = null;
    this.quad = false;
    this.accuracy = null;   // {err, radius, mode, time}
  }

  add(f, x, y, pid = 0) {
    this.samples.push({ f: f.slice(), x, y, pid });
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
  }

  get count() { return this.samples.length; }
  ready() { return !!this.coef; }

  _expand(z) {
    const out = [1];
    for (let i = 0; i < D; i++) out.push(z[i]);
    if (this.quad) for (let i = 0; i < QUAD_DIMS; i++) for (let j = i; j < QUAD_DIMS; j++) out.push(z[i] * z[j]);
    return out;
  }

  fit() {
    const n = this.samples.length;
    if (n < 12) return false;
    const mean = new Array(D).fill(0), std = new Array(D).fill(0);
    for (const s of this.samples) for (let i = 0; i < D; i++) mean[i] += s.f[i];
    for (let i = 0; i < D; i++) mean[i] /= n;
    for (const s of this.samples) for (let i = 0; i < D; i++) std[i] += (s.f[i] - mean[i]) ** 2;
    for (let i = 0; i < D; i++) std[i] = Math.sqrt(std[i] / n) || 1;
    this.mean = mean; this.std = std;
    const pids = new Set(this.samples.map(s => s.pid));
    this.quad = pids.size >= 14 && n >= 100;
    const X = this.samples.map(s => this._expand(s.f.map((v, i) => (v - mean[i]) / std[i])));
    const T = X[0].length;
    const lambda = (this.quad ? 0.03 : 0.01) * n;
    const A = Array.from({ length: T }, () => new Array(T).fill(0));
    const B = Array.from({ length: T }, () => [0, 0]);
    for (let k = 0; k < n; k++) {
      const x = X[k], s = this.samples[k];
      for (let i = 0; i < T; i++) {
        const xi = x[i];
        B[i][0] += xi * s.x; B[i][1] += xi * s.y;
        const Ai = A[i];
        for (let j = i; j < T; j++) Ai[j] += xi * x[j];
      }
    }
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < i; j++) A[i][j] = A[j][i];
      if (i > 0) A[i][i] += lambda; // 偏置不懲罰
    }
    this.coef = solve(A, B);
    return true;
  }

  predict(f) {
    if (!this.coef) return null;
    const z = f.map((v, i) => (v - this.mean[i]) / this.std[i]);
    const e = this._expand(z);
    let x = 0, y = 0;
    for (let i = 0; i < e.length; i++) { x += e[i] * this.coef[i][0]; y += e[i] * this.coef[i][1]; }
    return [Math.max(-0.2, Math.min(1.2, x)), Math.max(-0.2, Math.min(1.2, y))];
  }

  toJSON() {
    return { v: 1, coef: this.coef, mean: this.mean, std: this.std, quad: this.quad, accuracy: this.accuracy, savedAt: Date.now() };
  }

  static fromJSON(o) {
    const m = new GazeModel();
    if (!o || !o.coef) return m;
    m.coef = o.coef; m.mean = o.mean; m.std = o.std; m.quad = o.quad; m.accuracy = o.accuracy || null;
    return m;
  }

  save(storage = globalThis.localStorage) {
    try { storage.setItem(STORE_KEY, JSON.stringify(this.toJSON())); return true; } catch { return false; }
  }

  static load(storage = globalThis.localStorage) {
    try {
      const raw = storage.getItem(STORE_KEY);
      return raw ? GazeModel.fromJSON(JSON.parse(raw)) : new GazeModel();
    } catch { return new GazeModel(); }
  }

  static clearSaved(storage = globalThis.localStorage) {
    try { storage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }
}

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
