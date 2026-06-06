// ============================================================
// src/net/names.ts — 人間プレイヤーのランダム名（クライアント/サーバ共用・純粋）
// ============================================================
//
// 名前未入力時に、短くて人名っぽいカタカナ名を割り当てる。
// 要件: カタカナ2〜5文字 / アルファbaット・絵文字・記号なし / CPU名と紛れない /
//        ルーム内で重複しない（まず別候補を再抽選、尽きたら末尾数字）。

// 短い人名風のカタカナ候補（世界的に一般的な名前ベース）。CPU α/β/γ とは明確に別。
export const NAME_POOL: readonly string[] = [
  'ミナ', 'ルカ', 'ノア', 'レオ', 'エマ', 'ソラ', 'リン', 'カイ', 'サラ', 'ハル',
  'ユイ', 'アオ', 'ナギ', 'モモ', 'ヒナ', 'リオ', 'マヤ', 'ナオ', 'ケイ', 'アヤ',
  'ユウ', 'ミオ', 'レナ', 'ニコ', 'アンナ', 'エリ', 'ジン', 'マオ', 'ルイ', 'ココ',
];

function pickRandom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/**
 * 既存名と重複しないランダム名を1つ返す。
 * - まず未使用の候補から選ぶ。
 * - 候補が尽きていれば、適当な候補に末尾数字を付けて一意化する。
 */
export function generateRandomPlayerName(
  existing: readonly string[] = [],
  rng: () => number = Math.random,
): string {
  const used = new Set(existing);
  const free = NAME_POOL.filter(n => !used.has(n));
  if (free.length > 0) return pickRandom(free, rng);
  // すべて使用中: 候補にユニークな末尾数字を付ける
  const base = pickRandom(NAME_POOL, rng);
  return uniquifyWithNumber(base, used);
}

/**
 * 要求された名前をルーム内で一意にして返す。
 * - 重複しなければそのまま（明示入力した名前を尊重）。
 * - 重複し、かつ候補プール由来なら別の未使用候補へ再抽選。
 * - それでも不足/プール外なら「ミナ2」のように末尾数字を付ける。
 */
export function resolveUniqueName(
  requested: string,
  existing: readonly string[] = [],
  rng: () => number = Math.random,
): string {
  const used = new Set(existing);
  if (!used.has(requested)) return requested;
  // プール由来の名前は別候補を優先（再抽選）
  if (NAME_POOL.includes(requested)) {
    const free = NAME_POOL.filter(n => !used.has(n));
    if (free.length > 0) return pickRandom(free, rng);
  }
  return uniquifyWithNumber(requested, used);
}

// ============================================================
// CPU 名: ランダムな3文字カタカナ名（6通り）。ゲーム作成時に決定し state/room へ保存する。
// 同一ゲーム内では重複させない。表示名のみで、CPUロジック・強さには一切関与しない。
// ============================================================
export const CPU_NAME_POOL: readonly string[] = [
  'ハルト', 'ミナト', 'ソラノ', 'リクヤ', 'ナツキ', 'コハル',
];

/** 既存名と重複しない CPU 名を1つ返す（尽きたら末尾数字で一意化）。 */
export function pickCpuName(existing: readonly string[] = [], rng: () => number = Math.random): string {
  const used = new Set(existing);
  const free = CPU_NAME_POOL.filter(n => !used.has(n));
  if (free.length > 0) return pickRandom(free, rng);
  return uniquifyWithNumber(pickRandom(CPU_NAME_POOL, rng), used);
}

/** 重複しない CPU 名を count 個返す（人間名など existing も避ける）。 */
export function pickCpuNames(count: number, existing: readonly string[] = [], rng: () => number = Math.random): string[] {
  const out: string[] = [];
  const used = [...existing];
  for (let i = 0; i < count; i++) {
    const n = pickCpuName(used, rng);
    out.push(n);
    used.push(n);
  }
  return out;
}

function uniquifyWithNumber(base: string, used: Set<string>): string {
  let i = 2;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}
