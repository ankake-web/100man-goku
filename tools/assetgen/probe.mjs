// 1枚だけ生成して、成否と「エラー全文」を表示する診断スクリプト。
//   node probe.mjs            # responseModalities=['IMAGE'] で試す
//   node probe.mjs --both     # ['TEXT','IMAGE'] で試す
//   node probe.mjs --none     # config無しで試す
// キーは env (GEMINI_API_KEY/GOOGLE_API_KEY) か ./.env から読む。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  try {
    let txt = fs.readFileSync(path.join(HERE, '.env'), 'utf8').replace(/^﻿/, ''); // strip BOM
    const m = txt.match(/^\s*(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    // KEY= プレフィックスが無く、鍵だけが書かれている .env も許容
    const bare = txt.trim().replace(/^["']|["']$/g, '');
    if (bare && !bare.includes('=') && !/\s/.test(bare)) return bare;
  } catch {}
  return null;
}

const arg = process.argv[2];
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const key = loadKey();
console.log('key:', key ? `見つかった(${key.slice(0, 4)}…${key.slice(-3)}, len=${key.length})` : '★なし★');
console.log('model:', model);
if (!key) { console.log('→ キーがありません。.env か $env:GEMINI_API_KEY を設定してください。'); process.exit(1); }

const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: key });

const req = { model, contents: 'cute 3D figurine-style game icon of a stack of rope-tied timber logs, plain pale background, no text' };
if (arg === '--both') req.config = { responseModalities: ['TEXT', 'IMAGE'] };
else if (arg === '--none') { /* config無し */ }
else req.config = { responseModalities: ['IMAGE'] };

console.log('config:', JSON.stringify(req.config ?? null));
try {
  const res = await ai.models.generateContent(req);
  const parts = res?.candidates?.[0]?.content?.parts ?? [];
  console.log('OK: parts =', parts.length, '| 種類 =', parts.map((p) => (p.inlineData ? `image(${p.inlineData.mimeType})` : p.text ? 'text' : 'other')).join(', '));
  const img = parts.find((p) => p?.inlineData?.data);
  if (img) {
    fs.writeFileSync(path.join(HERE, 'probe.png'), Buffer.from(img.inlineData.data, 'base64'));
    console.log('→ probe.png を書き出しました（成功）。');
  } else {
    console.log('→ 画像パートが無い。テキスト応答:', parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 300));
    console.log('  promptFeedback:', JSON.stringify(res?.promptFeedback ?? null));
  }
} catch (e) {
  console.log('\n★ ERROR 全文 ★');
  console.log('name   :', e?.name);
  console.log('status :', e?.status, '| code:', e?.code);
  console.log('message:', e?.message);
  if (e?.response) { try { console.log('response:', JSON.stringify(e.response).slice(0, 800)); } catch {} }
  try { console.log('JSON   :', JSON.stringify(e, Object.getOwnPropertyNames(e)).slice(0, 1200)); } catch {}
}
