// ============================================================
// src/net/names.ts — 人間プレイヤーのランダム名（クライアント/サーバ共用・純粋）
// ============================================================
//
// 名前未入力時に、短くて人名っぽいカタカナ名を割り当てる。
// 要件: カタカナ2〜5文字 / アルファbaット・絵文字・記号なし / CPU名と紛れない /
//        ルーム内で重複しない（まず別候補を再抽選、尽きたら末尾数字）。

// 戦国武将ふうの短いカタカナ名（戦国テーマのリスキン）。すべて清音始まりにして、
// 濁音/半濁音始まりの CPU 名プール(CPU_NAME_POOL)と一目で住み分ける。
// （百万石＝加賀百万石なので前田家のマエダ/トシイエも入れている。）
export const NAME_POOL: readonly string[] = [
  'ノブナガ', 'ヒデヨシ', 'イエヤス', 'シンゲン', 'ケンシン', 'マサムネ', 'ユキムラ', 'ミツヒデ',
  'カツイエ', 'モトナリ', 'ヨシモト', 'ハンベエ', 'ナガマサ', 'ウジヤス', 'ソウリン', 'カゲトラ',
  'サナダ', 'アケチ', 'マエダ', 'トシイエ', 'カネツグ', 'ナオエ', 'ハットリ', 'サイトウ',
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
 * - それでも不足/プール外なら「ノブナガ2」のように末尾数字を付ける。
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
// CPU 名: 同卓の CPU 同士が一目で区別できるよう、字面・長さ・先頭文字を散らした
// キュレーション済みプール。ゲーム作成時に決定し state/room へ保存する。
// 設計方針:
//   - 先頭文字が全員バラバラ（同卓で同じ文字始まりを選ばない＝下の距離ガード）。
//   - すべて濁音/半濁音始まりにし、清音始まりの人間名プール(NAME_POOL)と住み分け
//     （CPU と人間も一目で別物に見える）。
//   - 戦国の異名・武将ふうのカタカナ名で揃える（婆娑羅・毘沙門・弾正・五右衛門など）。
//   - 長さ2〜5文字で変化をつけ、近い綴り・近い読み(ニアホモフォン)のペアを避ける。
// 表示名のみで、CPUロジック・強さには一切関与しない。
// ============================================================
export const CPU_NAME_POOL: readonly string[] = [
  'ガモウ', 'ゴエモン', 'ドウサン', 'ゲンバ', 'バサラ', 'ビシャモン', 'ダンジョウ', 'ベッショ',
];

// 先頭の1文字（サロゲートペア安全に）。同卓 CPU の先頭文字重複回避に使う。
function firstChar(name: string): string {
  return [...name][0] ?? '';
}

/**
 * 既存名と重複せず、かつ先頭文字も既存と被らない CPU 名を1つ返す。
 * - まず「名前未使用 かつ 先頭文字未使用」の候補から選ぶ（一目で区別できる）。
 * - 先頭文字条件で尽きたら「名前未使用」だけで選ぶ（最低限の一意性は担保）。
 * - プールが尽きたら末尾数字で一意化する。
 */
export function pickCpuName(existing: readonly string[] = [], rng: () => number = Math.random): string {
  const usedNames = new Set(existing);
  const usedFirst = new Set(existing.map(firstChar));
  const distinct = CPU_NAME_POOL.filter(n => !usedNames.has(n) && !usedFirst.has(firstChar(n)));
  if (distinct.length > 0) return pickRandom(distinct, rng);
  const free = CPU_NAME_POOL.filter(n => !usedNames.has(n));
  if (free.length > 0) return pickRandom(free, rng);
  return uniquifyWithNumber(pickRandom(CPU_NAME_POOL, rng), usedNames);
}

/** 重複しない CPU 名を count 個返す（人間名など existing も避ける／先頭文字も散らす）。 */
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
