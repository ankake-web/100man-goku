// ============================================================
// src/engine/setup.ts — L-03: タイルランダム配置・数字トークン・港配置
// ============================================================

import type {
  AxialCoord, TileType, TileId, Tile,
  HarborType, Harbor, VertexId,
} from '../types';
import { TILE_COUNTS, NUMBER_TOKENS } from '../constants';
import { getAllTileCoords, getTileNeighbors, tileId, type BoardGeometry } from './board';

// ============================================================
// 港スロット定義（位置は固定、種別はシャッフル）
// ============================================================
// 各スロットは（タイル座標, edgeIndex）で表す。
//
// 【重要】フラットトップ六角形では edge i は方向 (6-i)%6 に面する。
//   境界方向 d に面する辺を指定するには edgeIndex = (6-d)%6 を使う。
//   例: 方向2（N）の境界辺 → edgeIndex = (6-2)%6 = 4
//
// 検証済み: 全9スロットが境界辺（隣接タイルが存在しない辺）であること。
const HARBOR_SLOTS: ReadonlyArray<{ readonly coord: AxialCoord; readonly edgeIndex: number }> = [
  { coord: { q:  0, r: -2 }, edgeIndex: 4 }, // 上（dir 2: N, edgeIndex=(6-2)%6=4）
  { coord: { q:  1, r: -2 }, edgeIndex: 5 }, // 右上（dir 1: NE, edgeIndex=(6-1)%6=5）
  { coord: { q:  2, r: -2 }, edgeIndex: 0 }, // 右上角（dir 0: SE, edgeIndex=(6-0)%6=0）
  { coord: { q:  2, r:  0 }, edgeIndex: 0 }, // 右（dir 0: SE, edgeIndex=0）
  { coord: { q:  1, r:  1 }, edgeIndex: 1 }, // 右下（dir 5: S, edgeIndex=(6-5)%6=1）
  { coord: { q:  0, r:  2 }, edgeIndex: 1 }, // 下（dir 5: S, edgeIndex=1）
  { coord: { q: -1, r:  2 }, edgeIndex: 2 }, // 左下（dir 4: SW, edgeIndex=(6-4)%6=2）
  { coord: { q: -2, r:  2 }, edgeIndex: 3 }, // 左下角（dir 3: NW, edgeIndex=(6-3)%6=3）
  { coord: { q: -2, r:  0 }, edgeIndex: 3 }, // 左（dir 3: NW, edgeIndex=3）
] as const;

const HARBOR_TYPE_POOL: HarborType[] = [
  'generic', 'generic', 'generic', 'generic',
  'wood', 'brick', 'wool', 'grain', 'ore',
];

// ============================================================
// ユーティリティ
// ============================================================

/**
 * シード値から決定論的乱数生成器を返す（mulberry32アルゴリズム）。
 * テスト時に createRng(seed) を渡すことで再現性を確保する。
 */
export function createRng(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates シャッフル。元配列を変更せず新配列を返す。
 * rng 省略時は Math.random を使用。
 */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

// ============================================================
// プレイヤー手番順の決定
// ============================================================

export type PlayerOrderMode = 'random' | 'fixed';

/**
 * 与えられた spec が base の正しい順列か検証する。
 * - 長さが一致すること
 * - base に存在しない ID を含まないこと
 * - 重複が無いこと
 */
export function isValidOrderSpec<T>(base: readonly T[], spec: readonly T[] | undefined): boolean {
  if (!spec || spec.length !== base.length) return false;
  const baseSet = new Set(base);
  const seen = new Set<T>();
  for (const id of spec) {
    if (!baseSet.has(id)) return false; // 未知ID
    if (seen.has(id)) return false;      // 重複
    seen.add(id);
  }
  return true;
}

/**
 * プレイヤーのターン順（playerOrder）を決定する純粋関数。
 *
 * @param playerIds 参加する全プレイヤーID（人間+CPU の固定識別子。任意順）
 * @param mode      'random' = シャッフル / 'fixed' = spec の指定順を使用
 * @param spec      mode==='fixed' のときの指定順（playerIds の順列）
 * @param rng       シャッフル用乱数（テスト時に注入可能）
 * @returns ターン順に並んだ playerIds の順列（新しい配列）
 *
 * mode==='fixed' で spec が不正（長さ不一致・未知ID・重複）の場合は、
 * playerIds の元順にフォールバックする（エラーにはしない）。
 * mode==='random' は呼ぶたびに rng に応じて再シャッフルする
 * （= 再戦時に再ランダムになる）。
 */
export function resolvePlayerOrder<T>(
  playerIds: readonly T[],
  mode: PlayerOrderMode,
  spec?: readonly T[],
  rng: () => number = Math.random,
): T[] {
  if (mode === 'random') {
    return shuffle(playerIds, rng);
  }
  if (isValidOrderSpec(playerIds, spec)) {
    return [...(spec as readonly T[])];
  }
  return [...playerIds];
}

// ============================================================
// タイル種別配置
// ============================================================

/** TILE_COUNTS に従いタイル種別プールを生成してシャッフルする */
function buildTileTypePool(rng: () => number): TileType[] {
  const pool: TileType[] = [];
  for (const [type, count] of Object.entries(TILE_COUNTS) as [TileType, number][]) {
    for (let i = 0; i < count; i++) pool.push(type);
  }
  return shuffle(pool, rng);
}

/**
 * 全19タイルにランダムな種別を割り当てる。
 * 砂漠タイルには hasRobber = true を設定（強盗の初期位置）。
 */
export function assignTileTypes(
  coords: AxialCoord[],
  rng: () => number = Math.random,
): Record<TileId, Tile> {
  const types = buildTileTypePool(rng);
  const tiles: Record<TileId, Tile> = {};

  coords.forEach((coord, i) => {
    const id = tileId(coord);
    const type = types[i] as TileType;
    tiles[id] = {
      id,
      coord,
      type,
      number:    null,
      hasRobber: type === 'desert',
    };
  });

  return tiles;
}

// ============================================================
// 数字トークン配置
// ============================================================

/**
 * 指定タイルが赤トークン（6 or 8）かつ隣接タイルにも赤トークンがあるか確認する。
 * rules.md §2-2: 赤トークン同士は隣接配置禁止。
 */
function hasRedConflict(coord: AxialCoord, tiles: Record<TileId, Tile>): boolean {
  const tile = tiles[tileId(coord)];
  if (!tile || (tile.number !== 6 && tile.number !== 8)) return false;

  return getTileNeighbors(coord).some(n => {
    const neighbor = tiles[tileId(n)];
    return neighbor?.number === 6 || neighbor?.number === 8;
  });
}

/**
 * 18枚の数字トークンを砂漠以外の全タイルに配置する。
 *
 * 制約: 赤トークン（6 / 8）同士が隣接しない。
 * 最大 maxAttempts 回シャッフルしてリトライする。
 * 全て失敗した場合は制約なしで配置するフォールバックを実行する（実運用では未発生）。
 */
export function placeNumberTokens(
  tiles: Record<TileId, Tile>,
  rng: () => number = Math.random,
  maxAttempts = 200,
): void {
  const coords = getAllTileCoords();
  const nonDesert = coords.filter(c => tiles[tileId(c)]?.type !== 'desert');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tokens = shuffle(NUMBER_TOKENS, rng);

    nonDesert.forEach((coord, i) => {
      const tile = tiles[tileId(coord)];
      if (tile) tile.number = tokens[i] ?? null;
    });

    if (nonDesert.every(c => !hasRedConflict(c, tiles))) return; // 制約クリア
  }

  // フォールバック: 制約なしで最終シャッフル結果をそのまま使用
  const tokens = shuffle(NUMBER_TOKENS, rng);
  nonDesert.forEach((coord, i) => {
    const tile = tiles[tileId(coord)];
    if (tile) tile.number = tokens[i] ?? null;
  });
}

// ============================================================
// 港配置
// ============================================================

/**
 * 9箇所の固定スロットに港を配置する（種別はランダム）。
 * 港頂点の harborType を更新して交易レート計算（trade_spec.md §3-3）に使用できるようにする。
 */
export function createHarbors(
  geometry: BoardGeometry,
  rng: () => number = Math.random,
): Harbor[] {
  const types = shuffle(HARBOR_TYPE_POOL, rng);

  return HARBOR_SLOTS.map((slot, i) => {
    const tid = tileId(slot.coord);
    const edgeId = geometry.tileToEdges[tid]?.[slot.edgeIndex];
    if (edgeId == null) {
      throw new Error(`港スロットの辺が見つかりません: tile=${tid} edgeIndex=${slot.edgeIndex}`);
    }

    const edge = geometry.edges[edgeId];
    if (!edge) {
      throw new Error(`辺オブジェクトが見つかりません: ${edgeId}`);
    }

    const [va, vb] = edge.vertexIds;
    const harborType = types[i] as HarborType;

    // 頂点に港種別を記録（交易レート計算に使用）
    const vA = geometry.vertices[va];
    const vB = geometry.vertices[vb];
    if (vA) vA.harborType = harborType;
    if (vB) vB.harborType = harborType;

    return {
      id:        `harbor_${i}`,
      type:      harborType,
      vertexIds: [va, vb] as [VertexId, VertexId],
    };
  });
}

// ============================================================
// メイン: createRandomBoard
// ============================================================

export interface SetupResult {
  tiles:   Record<TileId, Tile>;
  harbors: Harbor[];
}

/**
 * L-03: カタンボードをランダムに初期化する。
 *
 * 処理順:
 *   1. タイル種別をシャッフル配置（砂漠に強盗を初期配置）
 *   2. 数字トークンを赤隣接制約付きで配置
 *   3. 港種別をシャッフルして固定スロットに配置
 *
 * @param geometry buildBoardGeometry() の結果（港頂点情報を内部で更新する）
 * @param rng 乱数生成器。省略時 Math.random、再現テスト時は createRng(seed) を渡す。
 */
export function createRandomBoard(
  geometry: BoardGeometry,
  rng: () => number = Math.random,
): SetupResult {
  const coords = getAllTileCoords();
  const tiles  = assignTileTypes(coords, rng);
  placeNumberTokens(tiles, rng);
  const harbors = createHarbors(geometry, rng);
  return { tiles, harbors };
}
