// image/ の全PNGを mtime順に連番付きコンタクトシート化（中身を目視で対応づけるため）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sharp = (await import('sharp')).default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const inDir = path.resolve(HERE, '..', '..', 'image');
const outDir = path.join(HERE, 'montage');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inDir).filter((f) => /\.png$/i.test(f))
  .map((f) => ({ f, m: fs.statSync(path.join(inDir, f)).mtimeMs }))
  .sort((a, b) => a.m - b.m || (a.f < b.f ? -1 : 1))
  .map((x) => x.f);

// 連番→ファイル名の対応も書き出しておく（後段の mapping 作成に使う）
fs.writeFileSync(path.join(outDir, 'order.json'), JSON.stringify(files, null, 0));

const THUMB = 230, PAD = 8, LABEL = 40, COLS = 4, ROWS = 4, PER = COLS * ROWS;
const CW = THUMB + PAD * 2, CH = THUMB + LABEL + PAD;

for (let s = 0; s * PER < files.length; s++) {
  const batch = files.slice(s * PER, (s + 1) * PER);
  const W = COLS * CW, H = ROWS * CH;
  const comp = [];
  for (let i = 0; i < batch.length; i++) {
    const idx = s * PER + i + 1;
    const col = i % COLS, row = Math.floor(i / COLS);
    const thumb = await sharp(path.join(inDir, batch[i]))
      .resize(THUMB, THUMB, { fit: 'contain', background: { r: 230, g: 230, b: 230 } })
      .png().toBuffer();
    comp.push({ input: thumb, left: col * CW + PAD, top: row * CH + LABEL });
    const tail = batch[i].replace(/^ChatGPT Image \S+ /, '').replace(/\.png$/i, '');
    const svg = `<svg width="${CW}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#1c2330"/>
      <text x="8" y="28" font-size="26" font-family="sans-serif" font-weight="bold" fill="#ffd84a">#${idx}</text>
      <text x="62" y="27" font-size="15" font-family="sans-serif" fill="#9fd0ff">${tail}</text></svg>`;
    comp.push({ input: Buffer.from(svg), left: col * CW, top: row * CH });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 244, g: 244, b: 244 } } })
    .composite(comp).png().toFile(path.join(outDir, `sheet-${s + 1}.png`));
}
console.log(`${files.length} 枚 → ${Math.ceil(files.length / PER)} シート: ${outDir}`);
