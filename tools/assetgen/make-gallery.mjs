// out/ の全画像を一覧する gallery.html を生成する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, GROUP_ORDER } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(HERE, 'out');

const GROUP_LABEL = {
  resources: '資源', products: '物産', pieces: '駒(砦/城/船/天守)', ck: '城下と武将',
  'knight-actions': '武将アクション', buildings: '改良建築', tracks: 'トラック',
  'card-backs': 'カード裏', 'cards-pol': '政策カード', 'cards-sci': '兵学カード',
  'cards-com': '商策カード', actions: '操作アイコン', frame: '装飾枠', backgrounds: '背景',
};

const byGroup = new Map(GROUP_ORDER.map((g) => [g, []]));
for (const a of ASSETS) (byGroup.get(a.group) || []).push(a);

let cards = '';
for (const g of GROUP_ORDER) {
  const items = byGroup.get(g) || [];
  if (!items.length) continue;
  cards += `<h2>${GROUP_LABEL[g] || g} <span class="cnt">(${items.length})</span></h2>\n<div class="grid">\n`;
  for (const a of items) {
    const file = `${a.key}.${a.ext}`;
    const exists = fs.existsSync(path.join(outDir, file));
    cards += `  <figure${exists ? '' : ' class="missing"'}>` +
      `<img src="./${file}" alt="${a.key}" loading="lazy">` +
      `<figcaption>${a.key}</figcaption></figure>\n`;
  }
  cards += `</div>\n`;
}

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>100万石 アセット一覧 (${ASSETS.length})</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 24px; background:#2b2b2b; color:#eee; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin: 28px 0 8px; border-bottom: 1px solid #555; padding-bottom: 4px; }
  .cnt { color:#999; font-weight: normal; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: 12px; }
  figure { margin: 0; text-align: center; background:
      repeating-conic-gradient(#3a3a3a 0% 25%, #333 0% 50%) 50% / 20px 20px;
      border:1px solid #444; border-radius:8px; padding:6px; }
  figure.missing { outline: 2px solid #c0392b; }
  img { width: 100%; height: auto; aspect-ratio: 1/1; object-fit: contain; display:block; }
  figcaption { font-size: 11px; color:#bbb; margin-top:4px; word-break: break-all; }
  .note { color:#aaa; font-size:12px; }
</style></head><body>
<h1>100万石 生成アセット一覧 — ${ASSETS.length}枚 <span class="note">（背景は当面白。市松＝透明予定の目安）</span></h1>
${cards}
</body></html>`;

const dest = path.join(outDir, 'gallery.html');
fs.writeFileSync(dest, html, 'utf8');
console.log('wrote', dest);
