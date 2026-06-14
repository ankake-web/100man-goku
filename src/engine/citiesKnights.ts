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

import type { GameState, ResourceType, CommodityType, CommodityHand, ResourceHand, PlayerId, VertexId, CkTrack, Player } from '../types';
import {
  RESOURCE_TYPES, TILE_RESOURCE_MAP, TILE_COMMODITY_MAP, COMMODITY_TYPES,
  makeCommodities, CK_COSTS, CK_TRACK_COMMODITY, CK_MAX_IMPROVEMENT, CK_METROPOLIS_LEVEL,
  CK_BARBARIAN_MAX, CK_MAX_WALLS, CK_WALL_DISCARD_BONUS, PIECE_LIMITS, improvementCost,
} from '../constants';

// ============================================================
// 小ヘルパ（資源・商品の支払い）
// ============================================================

export function isCk(state: GameState): boolean {
  return state.expansion === 'cities_knights';
}
function canPayRes(hand: ResourceHand, cost: ResourceHand): boolean {
  return RESOURCE_TYPES.every(r => hand[r] >= cost[r]);
}
function payRes(hand: ResourceHand, cost: ResourceHand): ResourceHand {
  const h = { ...hand };
  for (const r of RESOURCE_TYPES) h[r] -= cost[r];
  return h;
}
function commodities(p: Player): CommodityHand {
  return p.commodities ?? makeCommodities();
}
function improvements(p: Player): Record<CkTrack, number> {
  return p.improvements ?? { trade: 0, politics: 0, science: 0 };
}

// ============================================================
// 騎士の接続判定・建設
// ============================================================

/** 騎士を置ける頂点か: 空き(建物/騎士なし)で、自分の道/船が接している。 */
export function canPlaceKnightVertex(state: GameState, pid: PlayerId, vid: VertexId): boolean {
  const v = state.vertices[vid];
  if (!v) return false;
  if (v.building || v.knight) return false;
  return v.adjacentEdgeIds.some(eid => {
    const e = state.edges[eid];
    return e?.road?.playerId === pid || e?.ship?.playerId === pid;
  });
}

function knightCount(state: GameState, pid: PlayerId): number {
  return Object.values(state.vertices).filter(v => v.knight?.playerId === pid).length;
}

export function canBuildKnight(state: GameState, pid: PlayerId, vid: VertexId): boolean {
  if (!isCk(state)) return false;
  const p = state.players[pid]; if (!p) return false;
  if (knightCount(state, pid) >= PIECE_LIMITS.knights) return false;
  if (!canPayRes(p.hand, CK_COSTS.knightBuild)) return false;
  return canPlaceKnightVertex(state, pid, vid);
}
export function buildKnight(state: GameState, pid: PlayerId, vid: VertexId): GameState {
  const p = state.players[pid]!;
  return {
    ...state,
    vertices: { ...state.vertices, [vid]: { ...state.vertices[vid]!, knight: { playerId: pid, strength: 1, active: false } } },
    players: { ...state.players, [pid]: { ...p, hand: payRes(p.hand, CK_COSTS.knightBuild) } },
    bank: addRes(state.bank, CK_COSTS.knightBuild),
  };
}

export function canActivateKnight(state: GameState, pid: PlayerId, vid: VertexId): boolean {
  if (!isCk(state)) return false;
  const p = state.players[pid]; const k = state.vertices[vid]?.knight;
  if (!p || !k || k.playerId !== pid || k.active) return false;
  return canPayRes(p.hand, CK_COSTS.knightActivate);
}
export function activateKnight(state: GameState, pid: PlayerId, vid: VertexId): GameState {
  const p = state.players[pid]!; const k = state.vertices[vid]!.knight!;
  return {
    ...state,
    vertices: { ...state.vertices, [vid]: { ...state.vertices[vid]!, knight: { ...k, active: true } } },
    players: { ...state.players, [pid]: { ...p, hand: payRes(p.hand, CK_COSTS.knightActivate) } },
    bank: addRes(state.bank, CK_COSTS.knightActivate),
  };
}

export function canUpgradeKnight(state: GameState, pid: PlayerId, vid: VertexId): boolean {
  if (!isCk(state)) return false;
  const p = state.players[pid]; const k = state.vertices[vid]?.knight;
  if (!p || !k || k.playerId !== pid || k.strength >= 3) return false;
  // 最強(3)への昇格は政治Lv3(城塞)が必要。
  if (k.strength === 2 && improvements(p).politics < 3) return false;
  return canPayRes(p.hand, CK_COSTS.knightUpgrade);
}
export function upgradeKnight(state: GameState, pid: PlayerId, vid: VertexId): GameState {
  const p = state.players[pid]!; const k = state.vertices[vid]!.knight!;
  return {
    ...state,
    vertices: { ...state.vertices, [vid]: { ...state.vertices[vid]!, knight: { ...k, strength: (k.strength + 1) as 1 | 2 | 3 } } },
    players: { ...state.players, [pid]: { ...p, hand: payRes(p.hand, CK_COSTS.knightUpgrade) } },
    bank: addRes(state.bank, CK_COSTS.knightUpgrade),
  };
}

function addRes(bank: ResourceHand, cost: ResourceHand): ResourceHand {
  const b = { ...bank };
  for (const r of RESOURCE_TYPES) b[r] += cost[r];
  return b;
}

// ============================================================
// 都市改善（3ツリー）＋メトロポリス
// ============================================================

function playerHasPlainCity(state: GameState, pid: PlayerId): boolean {
  return Object.values(state.vertices).some(v => v.building?.playerId === pid && v.building.type === 'city' && !v.building.metropolis);
}

export function canBuildImprovement(state: GameState, pid: PlayerId, track: CkTrack): boolean {
  if (!isCk(state)) return false;
  const p = state.players[pid]; if (!p) return false;
  const lvl = improvements(p)[track];
  if (lvl >= CK_MAX_IMPROVEMENT) return false;
  // 都市改善は都市が1つ以上必要。
  if (!Object.values(state.vertices).some(v => v.building?.playerId === pid && v.building.type === 'city')) return false;
  const c = CK_TRACK_COMMODITY[track];
  return commodities(p)[c] >= improvementCost(lvl);
}
export function buildImprovement(state: GameState, pid: PlayerId, track: CkTrack): GameState {
  const p = state.players[pid]!;
  const lvl = improvements(p)[track];
  const c = CK_TRACK_COMMODITY[track];
  const newComm = { ...commodities(p), [c]: commodities(p)[c] - improvementCost(lvl) };
  const newLvl = lvl + 1;
  let players = { ...state.players, [pid]: { ...p, commodities: newComm, improvements: { ...improvements(p), [track]: newLvl } } };
  let vertices = state.vertices;
  let metropolis = state.metropolis ?? {};

  // Lv4到達 & そのツリーのメトロポリス未保持 & 平の都市あり → 都市1つをメトロポリス化(勝利点4)。
  if (newLvl >= CK_METROPOLIS_LEVEL && !metropolis[track] && playerHasPlainCity(state, pid)) {
    const vid = Object.keys(state.vertices).find(id =>
      state.vertices[id]!.building?.playerId === pid && state.vertices[id]!.building?.type === 'city' && !state.vertices[id]!.building?.metropolis);
    if (vid) {
      vertices = { ...vertices, [vid]: { ...vertices[vid]!, building: { ...vertices[vid]!.building!, metropolis: true } } };
      metropolis = { ...metropolis, [track]: pid };
    }
  }
  return { ...state, players, vertices, metropolis };
}

// ============================================================
// 城壁（手札上限+2、最大3）
// ============================================================

function wallCount(state: GameState, pid: PlayerId): number {
  // メトロポリスは要塞化済み扱いで城壁1相当。明示的な城壁(building.wall)も数える。
  return Object.values(state.vertices).filter(v =>
    v.building?.playerId === pid && (v.building.metropolis || (v.building as { wall?: boolean }).wall)).length;
}
export function canBuildCityWall(state: GameState, pid: PlayerId, vid: VertexId): boolean {
  if (!isCk(state)) return false;
  const p = state.players[pid]; const b = state.vertices[vid]?.building;
  if (!p || !b || b.playerId !== pid || b.type !== 'city') return false;
  if (b.metropolis || (b as { wall?: boolean }).wall) return false; // 既に城壁/メトロポリス
  if (wallCount(state, pid) >= CK_MAX_WALLS) return false;
  return canPayRes(p.hand, CK_COSTS.cityWall);
}
export function buildCityWall(state: GameState, pid: PlayerId, vid: VertexId): GameState {
  const p = state.players[pid]!; const b = state.vertices[vid]!.building!;
  return {
    ...state,
    vertices: { ...state.vertices, [vid]: { ...state.vertices[vid]!, building: { ...b, wall: true } as typeof b } },
    players: { ...state.players, [pid]: { ...p, hand: payRes(p.hand, CK_COSTS.cityWall) } },
    bank: addRes(state.bank, CK_COSTS.cityWall),
  };
}

/** 7の捨て札のしきい値（手札がこの枚数以上で半数捨て）。城壁1つにつき+2。 */
export function ckDiscardThreshold(state: GameState, pid: PlayerId): number {
  if (!isCk(state)) return 8;
  return 8 + CK_WALL_DISCARD_BONUS * wallCount(state, pid);
}

// ============================================================
// イベントダイス・蛮族
// ============================================================

/** イベントダイス: 6面中3面が蛮族船、残り3面が交易/政治/科学。 */
export function rollEventDie(rng: () => number): 'ship' | CkTrack {
  const r = Math.floor(rng() * 6);
  if (r < 3) return 'ship';
  return (['trade', 'politics', 'science'] as CkTrack[])[r - 3]!;
}

/** 蛮族襲来の判定。騎士の総力 vs 盤面の都市数。守護VP付与 or 最弱が都市喪失。終了後 全騎士を非起動・蛮族を0に。 */
export function resolveBarbarianAttack(state: GameState): GameState {
  let cities = 0;
  const knightStr: Record<string, number> = {};
  for (const v of Object.values(state.vertices)) {
    if (v.building?.type === 'city') cities += 1; // メトロポリスも都市1としてカウント
    if (v.knight?.active) knightStr[v.knight.playerId] = (knightStr[v.knight.playerId] ?? 0) + v.knight.strength;
  }
  const total = Object.values(knightStr).reduce((s, n) => s + n, 0);

  let players = { ...state.players };
  let vertices = { ...state.vertices };

  if (total >= cities) {
    // 防衛成功: 最大貢献プレイヤーに守護者VP +1（同点は各自+1）。
    const max = Math.max(0, ...state.playerOrder.map(p => knightStr[p] ?? 0));
    if (max > 0) {
      for (const p of state.playerOrder) {
        if ((knightStr[p] ?? 0) === max) players[p] = { ...players[p]!, defenderVP: (players[p]!.defenderVP ?? 0) + 1 };
      }
    }
  } else {
    // 防衛失敗: 平の都市を持つプレイヤーのうち最弱(同点は全員)が都市1つを開拓地に格下げ。
    const owners = state.playerOrder.filter(p => playerHasPlainCity({ ...state, vertices }, p));
    if (owners.length > 0) {
      const minStr = Math.min(...owners.map(p => knightStr[p] ?? 0));
      for (const p of owners) {
        if ((knightStr[p] ?? 0) !== minStr) continue;
        const vid = Object.keys(vertices).find(id =>
          vertices[id]!.building?.playerId === p && vertices[id]!.building?.type === 'city' && !vertices[id]!.building?.metropolis);
        if (vid) {
          vertices[vid] = { ...vertices[vid]!, building: { type: 'settlement', playerId: p } };
          players[p] = { ...players[p]!, remainingCities: players[p]!.remainingCities + 1, remainingSettlements: Math.max(0, players[p]!.remainingSettlements - 1) };
        }
      }
    }
  }

  // 全騎士を非起動に戻す。
  for (const id of Object.keys(vertices)) {
    const k = vertices[id]!.knight;
    if (k?.active) vertices[id] = { ...vertices[id]!, knight: { ...k, active: false } };
  }

  return { ...state, players, vertices, barbarianPosition: 0, barbarianAttacks: (state.barbarianAttacks ?? 0) + 1 };
}

/** ROLL_DICE後にイベントダイスを処理（蛮族前進・襲来）。色面は当面効果なし(進歩カードは後続)。 */
export function applyEventDie(state: GameState, rng: () => number): GameState {
  const face = rollEventDie(rng);
  let next: GameState = { ...state, lastEventDie: face };
  if (face === 'ship') {
    const pos = (next.barbarianPosition ?? 0) + 1;
    if (pos >= CK_BARBARIAN_MAX) {
      next = resolveBarbarianAttack({ ...next, barbarianPosition: pos });
    } else {
      next = { ...next, barbarianPosition: pos };
    }
  }
  return next;
}

/** C&K産出を手札・銀行へ適用（資源＋商品）。computeCkProduction の結果を反映した新stateを返す。 */
export function distributeCkProduction(state: GameState, diceTotal: number): GameState {
  const { resources, commodities: comm } = computeCkProduction(state, diceTotal);
  const players = { ...state.players };
  const bank = { ...state.bank };
  for (const pid of state.playerOrder) {
    const rGain = resources[pid]; const cGain = comm[pid];
    if (!rGain && !cGain) continue;
    const p = players[pid]!;
    const hand = { ...p.hand };
    if (rGain) for (const r of RESOURCE_TYPES) { const n = rGain[r] ?? 0; if (n) { hand[r] += n; bank[r] -= n; } }
    const newComm = { ...commodities(p) };
    if (cGain) for (const c of COMMODITY_TYPES) { const n = cGain[c] ?? 0; if (n) newComm[c] += n; }
    players[pid] = { ...p, hand, commodities: newComm };
  }
  return { ...state, players, bank };
}

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
