#!/usr/bin/env node
// 100万石 アセット生成ツール
//   Gemini（無料APIキー）で画像生成 → 背景除去でアルファ化 → 指定寸法へ縮小 → out/ に保存
//
// 使い方（PowerShell 例）:
//   cd tools/assetgen
//   npm install
//   $env:GEMINI_API_KEY = "xxxxx"     # または .env に GEMINI_API_KEY=xxxxx
//   npm run gen                       # 既定: 資源5＋物産3 を試作
//   node generate.mjs --all           # 全部
//   node generate.mjs --group=pieces  # グループ指定
//   node generate.mjs res-lumber settlement-red   # キー直接指定
//   node generate.mjs --list          # 生成対象を一覧（API不要・依存不要）
//   node generate.mjs --dry-run       # プロンプトだけ表示（API不要・依存不要）
//
// 主なオプション:
//   --all / --group=a,b / <key...>    対象選択（既定は DEFAULT_GROUPS）
//   --out=DIR                         出力先（既定 ./out）
//   --no-bgremove                     背景除去をスキップ（生成画像そのまま）
//   --model=NAME                      モデル上書き（既定 gemini-2.5-flash-image）
//   --concurrency=N                   並列数（既定 3。無料枠のレート制限に合わせ低め）
//   --overwrite                       out/ に既存の同名があっても作り直す（既定はスキップ）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, GROUP_ORDER, DEFAULT_GROUPS, buildPrompt } from './manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 引数パース -------------------------------------------------------------
function parseArgs(argv) {
  const o = { groups: null, keys: [], all: false, out: path.join(HERE, 'out'),
    bgremove: true, backend: process.env.ASSETGEN_BACKEND || 'pollinations',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image',
    seed: 42, concurrency: null, overwrite: false, list: false, dryRun: false };
  for (const a of argv) {
    if (a === '--all') o.all = true;
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-bgremove') o.bgremove = false;
    else if (a === '--overwrite') o.overwrite = true;
    else if (a.startsWith('--group=')) o.groups = a.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--out=')) o.out = path.resolve(a.slice(6));
    else if (a.startsWith('--backend=')) o.backend = a.slice(10);
    else if (a.startsWith('--model=')) o.model = a.slice(8);
    else if (a.startsWith('--seed=')) o.seed = Number(a.slice(7)) || 42;
    else if (a.startsWith('--concurrency=')) o.concurrency = Math.max(1, Number(a.slice(14)) || 1);
    else if (a.startsWith('--')) { console.error(`unknown option: ${a}`); process.exit(2); }
    else o.keys.push(a);
  }
  // バックエンド既定の並列数（Pollinations匿名枠は同時1リクエストのみ＝必ず逐次）
  if (o.concurrency == null) o.concurrency = o.backend === 'pollinations' ? 1 : 3;
  return o;
}

// ---- 対象アイテムを決定 -----------------------------------------------------
function selectItems(o) {
  let items;
  if (o.keys.length) {
    const byKey = new Map(ASSETS.map((it) => [it.key, it]));
    items = o.keys.map((k) => byKey.get(k)).filter(Boolean);
    const miss = o.keys.filter((k) => !byKey.has(k));
    if (miss.length) console.warn(`⚠ 未知のキー: ${miss.join(', ')}`);
  } else {
    const groups = o.all ? GROUP_ORDER : (o.groups || DEFAULT_GROUPS);
    const set = new Set(groups);
    items = ASSETS.filter((it) => set.has(it.group));
  }
  // 出力順を GROUP_ORDER に沿って安定化
  const rank = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  return items.slice().sort((a, b) => (rank.get(a.group) - rank.get(b.group)));
}

// ---- APIキー読み込み（env → ./.env）----------------------------------------
function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  try {
    let txt = fs.readFileSync(path.join(HERE, '.env'), 'utf8').replace(/^﻿/, ''); // strip BOM
    const m = txt.match(/^\s*(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    // KEY= プレフィックスが無く、鍵だけが書かれている .env も許容
    const bare = txt.trim().replace(/^["']|["']$/g, '');
    if (bare && !bare.includes('=') && !/\s/.test(bare)) return bare;
  } catch { /* no .env */ }
  return null;
}

// ---- Gemini 1枚生成（リトライ付き）------------------------------------------
async function generateOne(ai, model, item) {
  const prompt = buildPrompt(item);
  const config = { responseModalities: ['IMAGE'] };
  if (item.aspect && item.aspect !== '1:1') config.imageConfig = { aspectRatio: item.aspect };

  const tries = 4;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await ai.models.generateContent({ model, contents: prompt, config });
      const parts = res?.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => p?.inlineData?.data);
      if (!img) {
        const txt = parts.map((p) => p?.text).filter(Boolean).join(' ').slice(0, 200);
        throw new Error(`画像パートなし${txt ? `（応答: ${txt}）` : ''}`);
      }
      return Buffer.from(img.inlineData.data, 'base64');
    } catch (e) {
      lastErr = e;
      const status = e?.status ?? e?.code;
      const rateLimited = status === 429 || /quota|rate|RESOURCE_EXHAUSTED/i.test(String(e?.message || e));
      if (attempt < tries - 1) {
        const wait = 1500 * (attempt + 1) + (rateLimited ? 12000 : 0);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// ---- Pollinations 1枚生成（APIキー不要・リトライ付き）-----------------------
async function generatePollinations(item, o) {
  const prompt = buildPrompt(item);
  const [w, h] = item.kind === 'bg' ? [item.width, item.height] : [1024, 1024];
  const params = new URLSearchParams({
    width: String(w), height: String(h), model: 'flux',
    nologo: 'true', private: 'true', seed: String(o.seed),
  });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;

  const tries = 5;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180000), headers: { accept: 'image/*' } });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        const err = new Error(`HTTP ${r.status} ${body.slice(0, 160)}`);
        err.status = r.status;
        throw err;
      }
      const ct = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer());
      if (!ct.startsWith('image/') || buf.length < 1000) {
        throw new Error(`非画像応答 (content-type=${ct}, bytes=${buf.length})`);
      }
      return buf;
    } catch (e) {
      lastErr = e;
      const busy = e?.status === 429 || e?.status >= 500 || e?.name === 'TimeoutError';
      if (attempt < tries - 1) await sleep((busy ? 6000 : 3000) * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---- 後処理（背景除去 → 縮小 → ファイル保存）-------------------------------
async function postProcess(rawBuf, item, o, libs) {
  const { removeBackground, sharp } = libs;
  // 生成元（Pollinations=JPEG等）を PNG に正規化しておく
  let buf = await sharp(rawBuf).png().toBuffer();

  const doRemove = o.bgremove && item.transparent && item.bgremove !== false;
  if (doRemove) {
    try {
      // ★ 型付き Blob で渡す。Buffer/ArrayBuffer をそのまま渡すと
      //   ライブラリ内部で type 無し Blob に包まれ "Unsupported format" になる。
      const inputBlob = new Blob([buf], { type: 'image/png' });
      const blob = await removeBackground(inputBlob, { output: { format: 'image/png' } });
      buf = Buffer.from(await blob.arrayBuffer());
    } catch (e) {
      console.warn(`   ⚠ 背景除去に失敗（生成画像のまま保存）: ${e?.message || e}`);
    }
  }

  let img = sharp(buf);
  if (item.kind === 'bg') {
    img = img.resize(item.width, item.height, { fit: 'cover' }).jpeg({ quality: 90 });
  } else {
    img = img.resize(item.size, item.size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png();
  }
  const outPath = path.join(o.out, `${item.key}.${item.ext}`);
  await img.toFile(outPath);
  return outPath;
}

// ---- 並列ワーカープール -----------------------------------------------------
async function runPool(items, concurrency, worker) {
  let i = 0;
  const results = new Array(items.length);
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await worker(items[idx], idx) }; }
      catch (e) { results[idx] = { ok: false, error: e, item: items[idx] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

// ---- メイン -----------------------------------------------------------------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const items = selectItems(o);

  if (!items.length) { console.error('対象アイテムがありません。--list で確認してください。'); process.exit(1); }

  if (o.list) {
    console.log(`生成対象 ${items.length} 件:`);
    for (const it of items) {
      const dim = it.kind === 'bg' ? `${it.width}x${it.height} ${it.ext}` : `${it.size}² ${it.ext}`;
      console.log(`  [${it.group}] ${it.key}.${it.ext}  (${dim})`);
    }
    return;
  }
  if (o.dryRun) {
    console.log(`=== DRY RUN: ${items.length} 件のプロンプト ===\n`);
    for (const it of items) console.log(`# ${it.key}.${it.ext}\n${buildPrompt(it)}\n`);
    return;
  }

  // 依存は遅延ロード（--list / --dry-run は依存なしで動かすため）
  let GoogleGenAI, removeBackground, sharp;
  try {
    sharp = (await import('sharp')).default;
    if (o.bgremove) ({ removeBackground } = await import('@imgly/background-removal-node'));
    if (o.backend === 'gemini') ({ GoogleGenAI } = await import('@google/genai'));
  } catch (e) {
    console.error('依存パッケージが見つかりません。`cd tools/assetgen && npm install` を実行してください。');
    console.error(String(e?.message || e));
    process.exit(1);
  }

  // Gemini バックエンドのみ APIキーが必要
  let ai = null;
  if (o.backend === 'gemini') {
    const apiKey = loadApiKey();
    if (!apiKey) {
      console.error([
        'APIキーが見つかりません（--backend=gemini）。次のいずれかで設定してください:',
        '  PowerShell:  $env:GEMINI_API_KEY = "あなたのキー"',
        '  または tools/assetgen/.env に  GEMINI_API_KEY=あなたのキー',
      ].join('\n'));
      process.exit(1);
    }
    ai = new GoogleGenAI({ apiKey });
  }

  fs.mkdirSync(o.out, { recursive: true });

  const engine = o.backend === 'gemini' ? `gemini(${o.model})` : `pollinations(flux, seed=${o.seed})`;
  console.log(`▶ 供給元: ${engine} / 対象: ${items.length}件 / 並列: ${o.concurrency} / 出力: ${o.out}`);
  console.log(`  背景除去: ${o.bgremove ? 'ON' : 'OFF'}  上書き: ${o.overwrite ? 'ON' : 'OFF'}\n`);

  const t0 = Date.now();
  const results = await runPool(items, o.concurrency, async (item, idx) => {
    const dest = path.join(o.out, `${item.key}.${item.ext}`);
    if (!o.overwrite && fs.existsSync(dest)) {
      console.log(`• [${idx + 1}/${items.length}] skip（既存）: ${item.key}.${item.ext}`);
      return { skipped: true };
    }
    const raw = o.backend === 'gemini'
      ? await generateOne(ai, o.model, item)
      : await generatePollinations(item, o);
    const out = await postProcess(raw, item, o, { removeBackground, sharp });
    console.log(`✓ [${idx + 1}/${items.length}] ${path.basename(out)}`);
    return { out };
  });

  const ok = results.filter((r) => r.ok && !r.value?.skipped).length;
  const skip = results.filter((r) => r.ok && r.value?.skipped).length;
  const fail = results.filter((r) => !r.ok);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n── 完了: 成功 ${ok} / スキップ ${skip} / 失敗 ${fail.length}（${secs}s）`);
  for (const f of fail) console.log(`  ✗ ${f.item.key}: ${f.error?.message || f.error}`);

  console.log(`\n出力先: ${o.out}`);
  console.log('画風を確認したら、src/assets へコピーして反映してください:');
  console.log('  PowerShell:  Copy-Item tools/assetgen/out/* src/assets/ -Force');
  console.log('  確認:        npm run dev  →「🖼 コマ・カード図鑑」で目視');

  if (fail.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
