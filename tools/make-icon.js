// 生成 Fit Tool 应用图标：苹果风格蓝色圆角方块 + 白色心率折线
// 纯 Node 实现（zlib 内置），零依赖：直接编码 PNG 并打包为多尺寸 .ico
// 用法：node tools/make-icon.js  （输出 fit-tool.ico 与 public/favicon.png）
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(pixels, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---------- 绘制 ----------
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 256; // 相对 256 设计稿的缩放
  const radius = 58 * S;
  const m = 4 * S;      // 四周留一点透明边距
  const inset = m + radius;

  // 心率折线（ECG 风格，256 设计稿坐标）
  const line = [
    [38, 140], [86, 140], [102, 122], [118, 140], [136, 140],
    [150, 84], [166, 198], [182, 140], [218, 140]
  ].map(([x, y]) => [x * S, y * S]);
  const lineR = 6.4 * S;

  const segDist = (px_, py_, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px_ - ax) * dx + (py_ - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px_ - cx, py_ - cy);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cxp = x + 0.5, cyp = y + 0.5;

      // 圆角方块 SDF → 抗锯齿 alpha
      const qx = Math.abs(cxp - size / 2) - (size / 2 - m - radius);
      const qy = Math.abs(cyp - size / 2) - (size / 2 - m - radius);
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) - radius;
      let alpha = Math.max(0, Math.min(1, 0.5 - dist));

      if (alpha <= 0) continue;

      // 蓝色纵向渐变（#0A84FF → #0064D2）
      const g = Math.max(0, Math.min(1, (cyp - m) / (size - 2 * m)));
      let r = Math.round(10 + (0 - 10) * g);
      let gc = Math.round(132 + (100 - 132) * g);
      let b = Math.round(255 + (210 - 255) * g);

      // 心率折线（白色，带抗锯齿）
      let dLine = Infinity;
      for (let k = 0; k < line.length - 1; k++) {
        dLine = Math.min(dLine, segDist(cxp, cyp,
          line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]));
      }
      const la = Math.max(0, Math.min(1, 0.5 + (lineR - dLine)));
      if (la > 0) {
        r = Math.round(r * (1 - la) + 255 * la);
        gc = Math.round(gc * (1 - la) + 255 * la);
        b = Math.round(b * (1 - la) + 255 * la);
        alpha = Math.max(alpha, la * alpha);
      }

      px[i] = r; px[i + 1] = gc; px[i + 2] = b; px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// 面积平均降采样（256 → 小尺寸，比单点采样平滑得多）
function downsample(src, srcSize, dstSize) {
  const px = Buffer.alloc(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * scale); sy < Math.floor((y + 1) * scale); sy++) {
        for (let sx = Math.floor(x * scale); sx < Math.floor((x + 1) * scale); sx++) {
          const i = (sy * srcSize + sx) * 4;
          const w = src[i + 3] / 255;
          r += src[i] * w; g += src[i + 1] * w; b += src[i + 2] * w;
          a += src[i + 3]; n++;
        }
      }
      const i = (y * dstSize + x) * 4;
      if (a > 0) {
        // 预乘加权的颜色平均
        px[i] = Math.round(r / (a / 255) / n);
        px[i + 1] = Math.round(g / (a / 255) / n);
        px[i + 2] = Math.round(b / (a / 255) / n);
      }
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

// ---------- 打包 .ico（PNG 条目，Win7+ 支持）----------
const base = drawIcon(256);
const sizes = [256, 48, 32, 16];
const pngs = new Map();
pngs.set(256, encodePNG(base, 256, 256));
for (const s of [48, 32, 16]) {
  pngs.set(s, encodePNG(downsample(base, 256, s), s, s));
}

const count = sizes.length;
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(count, 4);
const entries = [];
let offset = 6 + 16 * count;
for (const s of sizes) {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s;
  e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4);  // planes
  e.writeUInt16LE(32, 6); // bit count
  e.writeUInt32LE(pngs.get(s).length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs.get(s).length;
  entries.push(e);
}
const ico = Buffer.concat([dir, ...entries, ...sizes.map(s => pngs.get(s))]);
fs.writeFileSync(path.join(root, "fit-tool.ico"), ico);

// 浏览器 favicon
fs.writeFileSync(path.join(root, "public", "favicon.png"), pngs.get(256));

console.log("生成完成: fit-tool.ico (" + ico.length + " bytes) + public/favicon.png");
