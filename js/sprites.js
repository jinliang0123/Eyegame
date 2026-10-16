// 程式繪製的擬真精靈圖（賽車後視、樹、石頭、飛彈）。所有精靈預先渲染到離屏 canvas。
function mk(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h); return c;
}
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function vgrad(c, y0, y1, stops) { const g = c.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; }

function tire(c, x, y, w, h) {
  rr(c, x, y, w, h, 14); c.fillStyle = vgrad(c, y, y + h, [[0, '#2a2a2e'], [0.5, '#101012'], [1, '#050506']]); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 2;
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(x + 4, y + (h * i) / 4); c.lineTo(x + w - 4, y + (h * i) / 4); c.stroke(); }
}
function tailLight(c, x, y, w, h, glow) {
  c.save();
  c.shadowColor = 'rgba(255,40,40,.95)'; c.shadowBlur = glow;
  rr(c, x, y, w, h, 9); c.fillStyle = vgrad(c, y, y + h, [[0, '#ff6b6b'], [0.5, '#e11d2e'], [1, '#7f0a14']]); c.fill();
  c.restore();
  rr(c, x + 4, y + 4, w - 8, h * 0.28, 5); c.fillStyle = 'rgba(255,255,255,.35)'; c.fill();
}

// style: 'sedan' | 'suv' | 'truck' | 'sport'
export function carSprite(color, style = 'sedan') {
  if (style === 'truck') return truckSprite(color);
  const tall = style === 'suv';
  const H = tall ? 340 : 300, W = 400;
  return mk(W, H, (c) => {
    const bodyTop = tall ? 120 : 150, bodyH = tall ? 135 : 108;
    // 地面陰影
    const sh = c.createRadialGradient(200, H - 14, 10, 200, H - 14, 200);
    sh.addColorStop(0, 'rgba(0,0,0,.65)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.scale(1, 0.11); c.fillStyle = sh; c.beginPath(); c.arc(200, (H - 14) / 0.11, 205, 0, 7); c.fill(); c.restore();
    // 輪胎
    tire(c, 14, H - 98, 62, 84); tire(c, 324, H - 98, 62, 84);
    // 車艙（後窗）
    const cabTop = tall ? 28 : 62, cabBot = bodyTop + 6;
    c.beginPath();
    c.moveTo(78, cabBot); c.quadraticCurveTo(88, cabBot - 22, 112, cabTop + 18); c.quadraticCurveTo(122, cabTop, 150, cabTop);
    c.lineTo(250, cabTop); c.quadraticCurveTo(278, cabTop, 288, cabTop + 18); c.quadraticCurveTo(312, cabBot - 22, 322, cabBot); c.closePath();
    c.fillStyle = vgrad(c, cabTop, cabBot, [[0, shade(color, 0.25)], [1, shade(color, -0.25)]]); c.fill();
    // 後窗玻璃
    c.beginPath();
    c.moveTo(98, cabBot - 6); c.quadraticCurveTo(106, cabBot - 24, 124, cabTop + 24); c.quadraticCurveTo(130, cabTop + 12, 152, cabTop + 12);
    c.lineTo(248, cabTop + 12); c.quadraticCurveTo(270, cabTop + 12, 276, cabTop + 24); c.quadraticCurveTo(294, cabBot - 24, 302, cabBot - 6); c.closePath();
    c.fillStyle = vgrad(c, cabTop, cabBot, [[0, '#4b6a86'], [0.55, '#1c2a3a'], [1, '#0d141d']]); c.fill();
    c.save(); c.clip();
    c.fillStyle = 'rgba(255,255,255,.16)'; c.beginPath(); c.moveTo(120, cabBot); c.lineTo(190, cabTop); c.lineTo(222, cabTop); c.lineTo(152, cabBot); c.fill();
    c.restore();
    // 第三煞車燈
    rr(c, 160, cabTop + 20, 80, 7, 3); c.fillStyle = '#ff2b2b'; c.fill();
    // 車身
    rr(c, 20, bodyTop, 360, bodyH, 34);
    c.fillStyle = vgrad(c, bodyTop, bodyTop + bodyH, [[0, shade(color, 0.3)], [0.3, color], [0.75, shade(color, -0.3)], [1, shade(color, -0.55)]]); c.fill();
    // 行李箱蓋高光與分隔線
    rr(c, 36, bodyTop + 6, 328, 14, 7); c.fillStyle = 'rgba(255,255,255,.28)'; c.fill();
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 2; c.beginPath(); c.moveTo(40, bodyTop + 52); c.lineTo(360, bodyTop + 52); c.stroke();
    // 尾燈 + 連接飾條
    tailLight(c, 34, bodyTop + 24, 104, 30, 28); tailLight(c, 262, bodyTop + 24, 104, 30, 28);
    rr(c, 138, bodyTop + 33, 124, 12, 5); c.fillStyle = '#3a0b10'; c.fill();
    // 後保桿 + 車牌
    rr(c, 24, bodyTop + bodyH - 40, 352, 44, 18);
    c.fillStyle = vgrad(c, bodyTop + bodyH - 40, bodyTop + bodyH + 4, [[0, '#2a2d33'], [1, '#0c0d10']]); c.fill();
    rr(c, 154, bodyTop + 62, 92, 36, 5); c.fillStyle = '#f5f5f0'; c.fill(); c.strokeStyle = '#333'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#334'; for (let i = 0; i < 6; i++) c.fillRect(162 + i * 13, bodyTop + 72, 8, 16);
    // 排氣管
    for (const x of [92, 308]) { c.fillStyle = '#9aa0a6'; c.beginPath(); c.ellipse(x, bodyTop + bodyH + 1, 17, 8, 0, 0, 7); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.ellipse(x, bodyTop + bodyH + 1, 11, 5, 0, 0, 7); c.fill(); }
    // 後視鏡
    for (const x of [58, 342]) { rr(c, x - 18, cabBot - 30, 36, 20, 8); c.fillStyle = shade(color, -0.3); c.fill(); }
    // 跑車尾翼
    if (style === 'sport') {
      rr(c, 30, bodyTop - 28, 340, 16, 6); c.fillStyle = vgrad(c, bodyTop - 28, bodyTop - 12, [[0, '#2b2f36'], [1, '#08090b']]); c.fill();
      c.fillStyle = '#0d0e11'; rr(c, 60, bodyTop - 14, 18, 28, 3); c.fill(); rr(c, 322, bodyTop - 14, 18, 28, 3); c.fill();
      // 賽車條紋
      c.save(); rr(c, 20, bodyTop, 360, bodyH, 34); c.clip();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(178, bodyTop, 14, 52); c.fillRect(208, bodyTop, 14, 52); c.restore();
    }
    // 輪拱陰影
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(16, bodyTop + bodyH - 10, 70, 8); c.fillRect(314, bodyTop + bodyH - 10, 70, 8);
  });
}

function truckSprite(color) {
  const W = 400, H = 430;
  return mk(W, H, (c) => {
    const sh = c.createRadialGradient(200, H - 14, 10, 200, H - 14, 200);
    sh.addColorStop(0, 'rgba(0,0,0,.65)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.scale(1, 0.1); c.fillStyle = sh; c.beginPath(); c.arc(200, (H - 14) / 0.1, 205, 0, 7); c.fill(); c.restore();
    tire(c, 12, H - 96, 58, 82); tire(c, 330, H - 96, 58, 82);
    tire(c, 64, H - 96, 40, 82); tire(c, 296, H - 96, 40, 82);
    // 貨櫃
    rr(c, 22, 14, 356, 290, 10);
    c.fillStyle = vgrad(c, 14, 304, [[0, shade(color, 0.35)], [0.5, color], [1, shade(color, -0.4)]]); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 3;
    for (let x = 52; x < 380; x += 30) { c.beginPath(); c.moveTo(x, 20); c.lineTo(x, 298); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2;
    for (let x = 55; x < 380; x += 30) { c.beginPath(); c.moveTo(x, 20); c.lineTo(x, 298); c.stroke(); }
    // 後門把手與鎖桿
    c.fillStyle = '#888'; c.fillRect(196, 60, 8, 200); c.fillRect(170, 150, 16, 10); c.fillRect(214, 150, 16, 10);
    // 底盤
    rr(c, 30, 304, 340, 46, 8); c.fillStyle = vgrad(c, 304, 350, [[0, '#3b3f46'], [1, '#14161a']]); c.fill();
    // 反光條 + 尾燈
    c.fillStyle = '#ffd400'; for (let x = 50; x < 350; x += 40) c.fillRect(x, 322, 24, 8);
    tailLight(c, 26, 296, 40, 38, 24); tailLight(c, 334, 296, 40, 38, 24);
    // 保桿 + 車牌
    rr(c, 24, 350, 352, 28, 8); c.fillStyle = '#d6d8dc'; c.fill();
    c.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 30; x < 370; x += 30) c.fillRect(x, 352, 14, 24);
    rr(c, 160, 326, 80, 30, 4); c.fillStyle = '#f5f5f0'; c.fill();
    // 擋泥板
    c.fillStyle = '#0b0b0d'; rr(c, 40, 380, 50, 36, 6); c.fill(); rr(c, 310, 380, 50, 36, 6); c.fill();
  });
}

// ---------- 樹 ----------
export function pineSprite(seed = 0) {
  return mk(280, 520, (c) => {
    const r = ((seed * 9301 + 49297) % 233280) / 233280;
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(140, 510, 90, 10, 0, 0, 7); c.fill();
    c.fillStyle = vgrad(c, 400, 510, [[0, '#5b3a21'], [1, '#2a1a0e']]); c.fillRect(124, 400, 32, 110);
    const layers = 5, base = ['#1d5c33', '#14452a', '#1f6b3a'][seed % 3];
    for (let i = 0; i < layers; i++) {
      const y = 400 - i * 70, w = 130 - i * 20 + r * 8;
      const g = c.createLinearGradient(140 - w, 0, 140 + w, 0);
      g.addColorStop(0, shade(base, 0.22)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -0.5));
      c.fillStyle = g; c.beginPath(); c.moveTo(140, y - 120); c.lineTo(140 + w, y); c.lineTo(140 - w, y); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.moveTo(140, y - 120); c.lineTo(140 - w * 0.55, y - 20); c.lineTo(140 - w * 0.1, y - 40); c.fill();
    }
  });
}
export function oakSprite(seed = 0) {
  return mk(320, 440, (c) => {
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(160, 432, 100, 10, 0, 0, 7); c.fill();
    const tg = c.createLinearGradient(130, 0, 190, 0); tg.addColorStop(0, '#6d4a2b'); tg.addColorStop(0.6, '#4a2f18'); tg.addColorStop(1, '#2b1a0c');
    c.fillStyle = tg; c.beginPath(); c.moveTo(134, 432); c.lineTo(146, 240); c.lineTo(176, 240); c.lineTo(188, 432); c.fill();
    const base = ['#3f8f3a', '#4c9a2f', '#2f7a43'][seed % 3];
    const blobs = [[160, 150, 100], [90, 200, 70], [230, 200, 74], [120, 110, 70], [205, 110, 72], [160, 230, 70]];
    for (const [x, y, rad] of blobs) {
      const g = c.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
      g.addColorStop(0, shade(base, 0.35)); g.addColorStop(0.55, base); g.addColorStop(1, shade(base, -0.55));
      c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
    }
  });
}
export function bushSprite() {
  return mk(220, 120, (c) => {
    for (const [x, y, r, col] of [[60, 80, 50, '#2d6a36'], [120, 66, 58, '#357a3d'], [170, 82, 46, '#2d6a36']]) {
      const g = c.createRadialGradient(x - r * 0.3, y - r * 0.4, 4, x, y, r);
      g.addColorStop(0, shade(col, 0.3)); g.addColorStop(1, shade(col, -0.5)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
  });
}

// ---------- 石頭（多面體光影） ----------
export function rockSprite(seed = 1, big = false) {
  const W = 320, H = 260;
  return mk(W, H, (c) => {
    let s = seed * 7919 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(160, H - 12, 140, 14, 0, 0, 7); c.fill();
    const n = 11, cx = 160, cy = H - 100, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rx = (120 + rnd() * 30) * (big ? 1 : 0.9), ry = (80 + rnd() * 25);
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry * (Math.sin(a) > 0 ? 0.95 : 1.1)]);
    }
    const top = [cx - 18 + rnd() * 30, cy - 70];
    const light = [-0.6, -0.8];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const mx = (a[0] + b[0]) / 2 - cx, my = (a[1] + b[1]) / 2 - cy, len = Math.hypot(mx, my) || 1;
      const lit = (mx / len) * light[0] + (my / len) * light[1];
      const v = 92 + lit * 70 + rnd() * 18;
      c.fillStyle = `rgb(${v | 0},${(v * 0.97) | 0},${(v * 0.92) | 0})`;
      c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1.5; c.stroke();
    }
    // 底部暗化與裂紋
    c.save(); c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(0, cy - 60, 0, cy + 90); g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
    c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2;
    for (let i = 0; i < 3; i++) { c.beginPath(); let x = 100 + rnd() * 120, y = cy - 40 + rnd() * 40; c.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (rnd() - 0.5) * 40; y += 14 + rnd() * 16; c.lineTo(x, y); } c.stroke(); }
  });
}

// ---------- 飛彈（後視） ----------
export function missileSprite() {
  return mk(140, 140, (c) => {
    const f = c.createRadialGradient(70, 78, 4, 70, 78, 62);
    f.addColorStop(0, 'rgba(255,255,220,1)'); f.addColorStop(0.3, 'rgba(255,190,60,.95)'); f.addColorStop(0.7, 'rgba(255,90,20,.5)'); f.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = f; c.beginPath(); c.arc(70, 78, 62, 0, 7); c.fill();
    const g = c.createRadialGradient(62, 64, 2, 70, 70, 24);
    g.addColorStop(0, '#f0f3f7'); g.addColorStop(0.6, '#8a929c'); g.addColorStop(1, '#30343b');
    c.fillStyle = g; c.beginPath(); c.arc(70, 70, 24, 0, 7); c.fill();
    c.fillStyle = '#c0392b'; for (let i = 0; i < 4; i++) { c.save(); c.translate(70, 70); c.rotate((i * Math.PI) / 2 + Math.PI / 4); c.fillRect(-4, 20, 8, 22); c.restore(); }
    c.fillStyle = '#fff3b0'; c.beginPath(); c.arc(70, 70, 10, 0, 7); c.fill();
  });
}
