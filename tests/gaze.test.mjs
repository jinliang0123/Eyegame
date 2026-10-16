// node tests/gaze.test.mjs —— 驗證視線迴歸模型與眨眼偵測邏輯
import assert from 'node:assert/strict';
import { GazeModel } from '../js/gaze.js';

// 合成資料：特徵與螢幕位置為非線性關係 + 雜訊
const rnd = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;
const feat = (x, y) => [(x - 0.5) * 0.4 + gauss() * 0.002, (y - 0.5) * 0.25 + 0.05 * (x - 0.5) ** 2 + gauss() * 0.002, (x - 0.5) * 0.1, (y - 0.5) * 0.08, 0.5, 0.5, 0.16];

const m = new GazeModel();
for (let i = 0; i < 400; i++) { const x = rnd(), y = rnd(); m.add(feat(x, y), x, y, i % 30); }
assert.ok(m.fit());
let err = 0, n = 300;
for (let i = 0; i < n; i++) {
  const x = rnd(), y = rnd(), p = m.predict(feat(x, y));
  err += Math.hypot((p[0] - x) * 1920, (p[1] - y) * 1080);
}
err /= n;
console.log('平均誤差(px):', err.toFixed(1), 'quad:', m.quad);
assert.ok(err < 40, '誤差過大: ' + err);

// 序列化往返
const m2 = GazeModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
const f = feat(0.3, 0.7);
assert.deepEqual(m2.predict(f), m.predict(f));
console.log('OK');
