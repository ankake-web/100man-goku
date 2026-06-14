// ============================================================
// src/engine/citiesKnights.ts — 騎士と商人(Cities & Knights)拡張のルール（純関数）
// ============================================================
//
// フェーズ1: 都市の産出を拡張する。
//   - 開拓地: 隣接地形の資源を1個（基本どおり）。
//   - 都市（森/牧草/山）: 資源1個 ＋ 対応する商品(紙/布/金貨)1個。
//   - 都市（丘/畑）: 資源2個（商品なし）。
//   - 砂漠/海/金タイルは産出なし。盗賊のいるタイルは産出しない。7は対象外。
//
// 資源はバンク枯渇ルールを基本ゲームと同様に適用する。商品は当面ふんだんにあるものとして
// 枯渇を扱わない（公式でも商品が尽きることは稀）。基本/航海者には一切影響しない純粋関数。

import type { GameState, ResourceType, CommodityType } from '../types';
import { RESOURCE_TYPES, TILE_RESOURCE_MAP, TILE_COMMODITY_MAP } from '../constants';

export interface CkProduction {
  resources: Record<string, Partial<Record<ResourceType, number>>>;
  commodities: Record<string, Partial<Record<CommodityType, number>>>;
}

/**
 * Cities & Knights の出目一致による産出（資源＋商品）をプレイヤー別に計算する純関数。
 * 基本の computeDiceProduction と違い、都市は商品地形では「資源1＋商品1」、丘/畑では「資源2」。
 */
export function computeCkProduction(state: GameState, diceTotal: number): CkProduction {
  const resources: CkProduction['resources'] = {};
  const commodities: CkProduction['commodities'] = {};
  if (diceTotal === 7) return { resources, commodities };

  // resource → playerId → 総需要量（バンク枯渇判定に使う）
  const resDemand: Record<ResourceType, Record<string, number>> = {
    wood: {}, brick: {}, wool: {}, grain: {}, ore: {},
  };
  // commodity は枯渇を扱わないので直接 commodities に積む。
  const addCommodity = (pid: string, c: CommodityType, n: number): void => {
    if (!commodities[pid]) commodities[pid] = {};
    commodities[pid]![c] = (commodities[pid]![c] ?? 0) + n;
  };

  for (const tile of Object.values(state.tiles)) {
    if (tile.number !== diceTotal) continue;
    if (tile.hasRobber) continue;
    const resource = TILE_RESOURCE_MAP[tile.type];
    if (resource == null) continue; // 砂漠/海/金は産出なし
    const commodity = TILE_COMMODITY_MAP[tile.type]; // 森/牧草/山なら紙/布/金貨

    for (const vid of state.tileToVertices[tile.id] ?? []) {
      const building = state.vertices[vid]?.building;
      if (!building) continue;
      const { playerId, type } = building;
      if (type === 'settlement') {
        resDemand[resource][playerId] = (resDemand[resource][playerId] ?? 0) + 1;
      } else {
        // 都市
        if (commodity) {
          resDemand[resource][playerId] = (resDemand[resource][playerId] ?? 0) + 1;
          addCommodity(playerId, commodity, 1);
        } else {
          resDemand[resource][playerId] = (resDemand[resource][playerId] ?? 0) + 2;
        }
      }
    }
  }

  // 資源にバンク枯渇ルールを適用（基本ゲームと同じ）。
  const bankLeft = { ...state.bank };
  for (const resource of RESOURCE_TYPES) {
    const demand = resDemand[resource];
    const pids = Object.keys(demand);
    if (pids.length === 0) continue;
    const totalDemand = pids.reduce((s, p) => s + (demand[p] ?? 0), 0);
    if (pids.length > 1 && totalDemand > bankLeft[resource]) continue; // 複数需要が在庫超→誰も貰えない
    for (const pid of state.playerOrder) {
      const needed = demand[pid] ?? 0;
      if (needed === 0) continue;
      const actual = Math.min(needed, bankLeft[resource]);
      if (actual <= 0) continue;
      bankLeft[resource] -= actual;
      if (!resources[pid]) resources[pid] = {};
      resources[pid]![resource] = (resources[pid]![resource] ?? 0) + actual;
    }
  }

  return { resources, commodities };
}
