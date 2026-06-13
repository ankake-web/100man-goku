// ============================================================
// src/constants.ts — ゲーム定数
// ============================================================

import type { AxialCoord, ResourceType, TileType, DevCardType, ResourceHand } from './types';

// ---- リソース ----

export const RESOURCE_TYPES: ResourceType[] = ['wood', 'brick', 'wool', 'grain', 'ore'];

export const TILE_RESOURCE_MAP: Record<TileType, ResourceType | null> = {
  forest:   'wood',
  field:    'grain',
  pasture:  'wool',
  hill:     'brick',
  mountain: 'ore',
  desert:   null,
  sea:      null, // 海は産出なし
  gold:     null, // 金は任意資源（産出時に選択。固定の対応資源は持たない）
};

export const TILE_COUNTS: Record<TileType, number> = {
  forest: 4, field: 4, pasture: 4, hill: 3, mountain: 3, desert: 1,
  // 基本盤には存在しない（航海者シナリオ側で個別に配置する）
  sea: 0, gold: 0,
};

// ---- 建設コスト ----

/** 全リソースキーを含む ResourceHand を生成。省略キーは 0 として扱う。 */
export function makeHand(partial: Partial<ResourceHand> = {}): ResourceHand {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...partial };
}

// Partial<ResourceHand> ではなく ResourceHand を使用（undefined − n = NaN を防ぐ）
export const BUILD_COSTS: Record<'road' | 'ship' | 'settlement' | 'city' | 'dev_card', ResourceHand> = {
  road:       makeHand({ wood: 1, brick: 1 }),
  ship:       makeHand({ wood: 1, wool: 1 }), // 航海者: 船＝木＋羊
  settlement: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
  city:       makeHand({ grain: 2, ore: 3 }),
  dev_card:   makeHand({ wool: 1, grain: 1, ore: 1 }),
};

export const PIECE_LIMITS = {
  roads: 15,
  ships: 15,
  settlements: 5,
  cities: 4,
} as const;

// ---- バンク初期値 ----

export const BANK_INITIAL: ResourceHand = makeHand({
  wood: 19, brick: 19, wool: 19, grain: 19, ore: 19,
});

// ---- 発展カード ----

export const DEV_CARD_COUNTS: Record<DevCardType, number> = {
  knight:         14,
  road_building:   2,
  year_of_plenty:  2,
  monopoly:        2,
  victory_point:   5,
};

// ---- 勝利点 ----

export const VP_TABLE = {
  settlement:   1,
  city:         2,
  longestRoad:  2,
  largestArmy:  2,
  victoryPoint: 1,
  island:       2, // 航海者: 新しい島への最初の入植ボーナス
  target:       10,
} as const;

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

// ---- 強盗 ----

export const DICE_ROBBER_NUMBER      = 7;
export const ROBBER_HAND_DISCARD_MIN = 8; // 手札がこの枚数以上で半数捨て

// ---- 交易タイムアウト ----

export const TRADE_TIMEOUT_HUMAN_MS = 60_000;
export const TRADE_TIMEOUT_AI_MS    =  3_000;

// ---- ボード ----

export const HEX_SIZE = 60; // SVGピクセル単位

// フラットトップ六角形の6方向ベクトル（0°から60°刻み）
// ピクセル上の方向: dir0=SE, dir1=NE, dir2=N, dir3=NW, dir4=SW, dir5=S
export const HEX_DIRECTIONS: readonly AxialCoord[] = [
  { q:  1, r:  0 }, // 0: q+1      → 画面右下 (SE)
  { q:  1, r: -1 }, // 1: q+1, r-1 → 画面右上 (NE)
  { q:  0, r: -1 }, // 2: r-1      → 画面上   (N)
  { q: -1, r:  0 }, // 3: q-1      → 画面左上 (NW)
  { q: -1, r:  1 }, // 4: q-1, r+1 → 画面左下 (SW)
  { q:  0, r:  1 }, // 5: r+1      → 画面下   (S)
] as const;

// 数字トークン配置（アルファベット順：2〜12、7除く）
export const NUMBER_TOKENS: readonly number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];
