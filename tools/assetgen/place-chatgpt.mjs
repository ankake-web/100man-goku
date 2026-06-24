#!/usr/bin/env node
// ============================================================
// place-chatgpt.mjs — チャッピー(ChatGPT)生成画像を正式名へ配置（中身で確定したマッピング版）
// ============================================================
//
// image/ の68枚を「実際に中身を目視確認して確定した index→正式キー」で配置する。
//   ・index は mtime昇順（montage.mjs と同一ソート）の通し番号 1..68。
//   ・グレーの色違いベース（砦/城/船/天守）は sharp.tint で朱/藍/紫/山吹へ自動着色。
//     無印グレーは汎用 settlement.png / city.png にも流用する。
//   ・#19 は「政トラック」の重複なので未使用。石工(card-sci-engineer)は未生成のため既存画像のまま。
//
// 使い方（tools/assetgen で実行）:
//   node place-chatgpt.mjs            # 変換して chatgpt-staged/ に出力＋ preview.html 生成
//   node place-chatgpt.mjs --commit   # OKなら src/assets/ へ本適用
//   オプション: --in=DIR(既定 ../../image) --stage=DIR --no-resize
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ASSETS = path.resolve(HERE, '..', '..', 'src', 'assets');
const META = new Map(ASSETS.map((a) => [a.key, a]));
const IMG_RE = /\.(png|jpe?g|webp)$/i;

// プレイヤー色（内部キー固定）→ tint色。tintは輝度を保ちつつ色相を載せるので、
// グレー(無彩色)ベースに最適。彩度はあとで少し持ち上げる。
const PLAYER_TINT = {
  red:    { r: 201, g: 32, b: 52 },   // 朱
  blue:   { r: 38,  g: 94, b: 162 },  // 藍（識別しやすいよう少し明るめの藍）
  purple: { r: 124, g: 86, b: 176 },  // 紫
  orange: { r: 232, g: 158, b: 54 },  // 山吹
};
const COLOR_JA = { red: '朱', blue: '藍', purple: '紫', orange: '山吹' };

// index(1-based) → 割り当て。中身を montage で目視確認して確定したもの。
//   文字列      = その正式キーへ（manifestの寸法/ext で処理）
//   {gray:base} = グレー色違いベース（無印＋4色に展開）
//   {skip:理由} = 未使用
const ASSIGN = {
  // ① 資源・物産（生成順がバラけているので中身で対応）
  1: 'res-grain',   // 米
  2: 'res-ore',     // 鉄（黒い金属塊）
  3: 'com-coin',    // 金（小判）
  4: 'res-lumber',  // 木材（丸太）
  5: 'res-brick',   // 石材（赤茶の方形石）
  6: 'res-wool',    // 馬
  7: 'com-paper',   // 紙（巻物）
  8: 'com-cloth',   // 絹（着物・反物）
  // ② コマ・敵・武将（順番通り）
  9: 'knight-basic', 10: 'knight-strong', 11: 'knight-mighty', 12: 'metropolis-gate',
  13: 'city-wall', 14: 'merchant', 15: 'robber', 16: 'pirate', 17: 'barbarian-ship', 18: 'defender-badge',
  // 重複
  19: { skip: '政トラックの重複（#31と被り）' },
  // ③ 建物・操作・枠（順番通り）
  20: 'bld-trading-house', 21: 'bld-bank', 22: 'bld-fortress', 23: 'bld-cathedral', 24: 'bld-aqueduct',
  25: 'bld-theater', 26: 'road', 27: 'bank-trade', 28: 'player-trade', 29: 'frame-decorative',
  // ④ トラック・カード裏・武将操作（順番通り）
  30: 'track-trade', 31: 'track-politics', 32: 'track-science',
  33: 'card-back-trade', 34: 'card-back-politics', 35: 'card-back-science',
  36: 'knight-activate', 37: 'knight-upgrade',
  // ⑤ 政策カード（順番通り）
  38: 'card-pol-bishop', 39: 'card-pol-diplomat', 40: 'card-pol-intrigue', 41: 'card-pol-deserter',
  42: 'card-pol-warlord', 43: 'card-pol-spy', 44: 'card-pol-saboteur', 45: 'card-pol-wedding', 46: 'card-pol-constitution',
  // ⑥ 兵学カード（石工が未生成なので 縄張 以降が1つ前倒し）
  47: 'card-sci-alchemist',     // 陰陽師
  48: 'card-sci-crane',         // 棟梁
  49: 'card-sci-inventor',      // 縄張（※石工は欠番）
  50: 'card-sci-irrigation',    // 用水
  51: 'card-sci-medicine',      // 医術
  52: 'card-sci-mining',        // 採掘
  53: 'card-sci-road-building', // 普請
  54: 'card-sci-smith',         // 鍛冶
  55: 'card-sci-printer',       // 感状
  // ⑦ 商策カード（順番通り）
  56: 'card-com-merchant', 57: 'card-com-merchant-fleet', 58: 'card-com-master-merchant',
  59: 'card-com-commercial-harbor', 60: 'card-com-resource-monopoly', 61: 'card-com-trade-monopoly',
  // ⑧ 背景（順番通り・不透明JPG）
  62: 'bg-title', 63: 'bg-victory', 64: 'bg-barbarian',
  // ⑨⑩ グレー色違いベース（私が4色へ着色）
  65: { gray: 'settlement' }, // 砦（無印＋朱藍紫山吹）
  66: { gray: 'city' },       // 城（無印＋朱藍紫山吹）
  67: { gray: 'ship' },       // 船（朱藍紫山吹）
  68: { gray: 'metropolis' }, // 天守（朱藍紫山吹）
  // 後から追加生成（⑥の欠番だった石工）
  69: 'card-sci-engineer',    // 石工（石垣を築く石工・木槌と鑿）
};

// グレーベース→展開する出力キー（無印を出すかどうかを含む）
const GRAY_EXPAND = {
  settlement: { generic: 'settlement', size: 384 },
  city:       { generic: 'city',       size: 384 },
  ship:       { generic: null,         size: 384 },
  metropolis: { generic: null,         size: 256 },
};

function parseArgs(argv) {
  const o = { in: path.resolve(HERE, '..', '..', 'image'), stage: path.join(HERE, 'chatgpt-staged'),
    commit: false, resize: true };
  for (const a of argv) {
    if (a === '--commit') o.commit = true;
    else if (a === '--no-resize') o.resize = false;
    else if (a.startsWith('--in=')) o.in = path.resolve(a.slice(5));
    else if (a.startsWith('--stage=')) o.stage = path.resolve(a.slice(8));
    else if (a.startsWith('--')) { console.error(`unknown option: ${a}`); process.exit(2); }
  }
  return o;
}

function sortedImages(dir) {
  return fs.readdirSync(dir).filter((f) => IMG_RE.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => a.m - b.m || (a.f < b.f ? -1 : 1))
    .map((x) => x.f);
}

// ChatGPT画像は白背景（透過なし）。縁につながった白だけ透明化し、中央の白
// （旗/紙/白壁など）は残す＝フラッドフィル方式。data は RGBA。T=近白しきい値。
// 「明るい無彩色（白〜薄グレー）」を背景とみなす。純白でなく薄グレー地(例:分国法)も抜けるよう
// 輝度しきい値T＋低彩度(spread<=18)で判定。色付きの被写体は spread が大きく保護される。
function isBgWhite(data, i, T) {
  const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn >= T && (mx - mn) <= 18;
}
function floodKeyWhite(data, W, H, T) {
  const N = W * H, removed = new Uint8Array(N), stack = [];
  const isW = (i) => isBgWhite(data, i, T);
  const push = (i) => { if (!removed[i] && isW(i)) { removed[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  for (let i = 0; i < N; i++) if (removed[i]) data[i * 4 + 3] = 0;
}
// 全体の近白を透明化（装飾枠＝中央も中空にしたいもの用。枠自体は金色なので安全）。
function globalKeyWhite(data, W, H, T) {
  const N = W * H;
  for (let i = 0; i < N; i++) if (isBgWhite(data, i, T)) data[i * 4 + 3] = 0;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));

  if (o.commit) {
    if (!fs.existsSync(o.stage)) { console.error('先に変換を実行してください（chatgpt-staged が無い）。'); process.exit(1); }
    const files = fs.readdirSync(o.stage).filter((f) => IMG_RE.test(f));
    for (const f of files) fs.copyFileSync(path.join(o.stage, f), path.join(SRC_ASSETS, f));
    console.log(`✓ ${files.length} 枚を src/assets/ へ適用。`);
    console.log('  石工(card-sci-engineer)も差し込み済み → 全82アセット完備。');
    return;
  }

  let sharp;
  try { sharp = (await import('sharp')).default; }
  catch { console.error('sharp が必要です。tools/assetgen で `npm install` 済みか確認。'); process.exit(1); }

  // 白背景を除去した PNG バッファを返す。mode: 'flood'(縁の白のみ) | 'global'(全近白) | 'none'。
  const WHITE_T = 226; // 薄グレー背景(分国法など)も抜けるよう少し低めに（低彩度判定が被写体を保護）
  const cutBuffer = async (src, mode) => {
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (mode === 'flood') floodKeyWhite(data, info.width, info.height, WHITE_T);
    else if (mode === 'global') globalKeyWhite(data, info.width, info.height, WHITE_T);
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  };

  const files = sortedImages(o.in);
  if (files.length !== 69) console.warn(`⚠ 画像枚数 ${files.length}（想定69）。マッピングは index 前提なので要確認。`);

  fs.rmSync(o.stage, { recursive: true, force: true });
  fs.mkdirSync(o.stage, { recursive: true });

  const rows = []; // プレビュー用
  const procPiece = (img, size) => o.resize && size
    ? img.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }) : img;

  for (let i = 0; i < files.length; i++) {
    const idx = i + 1;
    const src = path.join(o.in, files[i]);
    const a = ASSIGN[idx];
    if (!a) { console.warn(`! #${idx} 未割当: ${files[i]}`); continue; }

    if (typeof a === 'object' && a.skip) {
      rows.push({ idx, srcName: files[i], outs: [], note: `未使用（${a.skip}）` });
      console.log(`· #${idx} skip（${a.skip}）`);
      continue;
    }

    if (typeof a === 'object' && a.gray) {
      const ex = GRAY_EXPAND[a.gray];
      const baseCut = await cutBuffer(src, 'flood'); // 白背景を抜いたグレーベース
      const outs = [];
      // 無印（グレーのまま）— 汎用コマがある場合のみ
      if (ex.generic) {
        const out = `${ex.generic}.png`;
        await procPiece(sharp(baseCut), ex.size).png().toFile(path.join(o.stage, out));
        outs.push({ out, label: '無印(灰)' });
      }
      // 4色 tint（濃いめ：彩度↑・明度↓）
      for (const c of ['red', 'blue', 'purple', 'orange']) {
        const key = `${a.gray}-${c}`;
        if (!META.has(key)) continue;
        const size = META.get(key).size ?? ex.size;
        const out = `${key}.png`;
        await procPiece(sharp(baseCut), size)
          .tint(PLAYER_TINT[c]).modulate({ saturation: 1.7, brightness: 0.9 })
          .png().toFile(path.join(o.stage, out));
        outs.push({ out, label: COLOR_JA[c] });
      }
      rows.push({ idx, srcName: files[i], outs, note: `グレー${a.gray}→色分け` });
      console.log(`✓ #${idx} ${files[i]} → ${outs.map((x) => x.out).join(', ')}`);
      continue;
    }

    // 通常アセット
    const meta = META.get(a);
    if (!meta) { console.warn(`! #${idx} manifestに無いキー: ${a}`); continue; }
    const ext = meta.ext ?? 'png';
    const out = `${a}.${ext}`;
    let img;
    if (meta.kind === 'bg') {
      img = sharp(src); // 背景は不透明JPGのまま（白除去しない）
      const W = meta.width ?? 1024, H = meta.height ?? 576;
      if (o.resize) img = img.resize(W, H, { fit: 'cover' });
      img = img.flatten({ background: { r: 20, g: 24, b: 32 } }).jpeg({ quality: 90 });
    } else {
      // 装飾枠は中央も中空にしたいので全近白キー、その他は縁の白のみ
      const mode = a === 'frame-decorative' ? 'global' : 'flood';
      img = procPiece(sharp(await cutBuffer(src, mode)), meta.size).png();
    }
    await img.toFile(path.join(o.stage, out));
    rows.push({ idx, srcName: files[i], outs: [{ out, label: '' }], note: '' });
    console.log(`✓ #${String(idx).padStart(2, '0')} ${files[i]} → ${out}`);
  }

  writePreview(o, rows);
  console.log(`\n出力: ${path.relative(HERE, o.stage)}/  プレビュー: chatgpt-staged/preview.html`);
  console.log('OKなら:  node place-chatgpt.mjs --commit');
}

function writePreview(o, rows) {
  const card = (r) => {
    const srcRel = path.relative(o.stage, path.join(o.in, r.srcName)).replace(/\\/g, '/');
    const outs = r.outs.map((x) =>
      `<div class="out"><div class="cell"><img src="./${x.out}" loading="lazy"></div><code>${x.label ? x.label + ' ' : ''}${x.out}</code></div>`).join('');
    return `<figure>
      <div class="pair">
        <div class="src"><div class="cell"><img src="${srcRel}" loading="lazy"></div><code>#${r.idx}</code></div>
        <div class="arrow">→</div>
        <div class="outs">${outs || '<span class="skip">' + r.note + '</span>'}</div>
      </div>
      ${r.note && r.outs.length ? `<figcaption>${r.note}</figcaption>` : ''}
    </figure>`;
  };
  const html = `<!doctype html><meta charset="utf-8"><title>チャッピー画像 対応プレビュー</title>
<style>
 body{font-family:system-ui,sans-serif;margin:18px;background:#2b2b2b;color:#eee}
 h1{font-size:18px}.note{color:#f5b740;margin:6px 0 14px;line-height:1.6}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
 figure{margin:0;background:#1c1c1c;border:1px solid #444;border-radius:10px;padding:8px}
 .pair{display:flex;align-items:center;gap:8px}
 .outs{display:flex;flex-wrap:wrap;gap:6px;flex:1}
 .src,.out{display:flex;flex-direction:column;align-items:center;gap:3px}
 .cell{width:84px;height:84px;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden;
   background:repeating-conic-gradient(#bbb 0% 25%,#fff 0% 50%) 0/14px 14px}
 .cell img{max-width:100%;max-height:100%}
 code{color:#9cf;font-size:10px;text-align:center} .arrow{color:#888;font-size:20px}
 .skip{color:#e88;font-size:12px} figcaption{margin-top:5px;font-size:11px;color:#bbb}
</style>
<h1>チャッピー画像 → 正式名 対応プレビュー（左=届いた画像 / 右=変換後）</h1>
<div class="note">この順番（リスト①→⑩）で中身が合っているか確認してください。<br>
特に <b>①資源・物産（生成順がバラけているので中身判定）</b> と <b>城/天守の取り違え</b>、<b>グレー駒の色分けの見た目</b> を重点チェック。<br>
※ #19=政トラックの重複（未使用） / #69=石工(card-sci-engineer)＝後から追加生成。</div>
<div class="grid">${rows.map(card).join('\n')}</div>`;
  fs.writeFileSync(path.join(o.stage, 'preview.html'), html);
}

main().catch((e) => { console.error(e); process.exit(1); });
