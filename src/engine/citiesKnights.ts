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

import type {
  GameState, ResourceType, CommodityType, CommodityHand, ResourceHand, PlayerId, VertexId, CkTrack, Player,
  ProgressCard, TileType,
} from '../types';
import {
  RESOURCE_TYPES, TILE_RESOURCE_MAP, TILE_COMMODITY_MAP, COMMODITY_TYPES,
  makeCommodities, CK_COSTS, CK_TRACK_COMMODITY, CK_MAX_IMPROVEMENT, CK_METROPOLIS_LEVEL,
  CK_BARBARIAN_MAX, CK_MAX_WALLS, PIECE_LIMITS, improvementCost,
  PROGRESS_DECK_CARDS, PROGRESS_HAND_LIMIT,
} from '../constants';
import { calcVP } from './scoring';

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

// from と to を結ぶ辺ID（隣接時のみ）。
function edgeBetween(state: GameState, fromVid: VertexId, toVid: VertexId): string | null {
  const from = state.vertices[fromVid];
  if (!from) return null;
  for (const eid of from.adjacentEdgeIds) {
    const e = state.edges[eid];
    if (e && (e.vertexIds[0] === toVid || e.vertexIds[1] === toVid)) return eid;
  }
  return null;
}

/** 騎士を fromVid→toVid へ移動できるか。1ターン1回・隣接1歩・自分の道沿い・空きor弱い敵騎士(押し出し)。 */
export function canMoveKnight(state: GameState, pid: PlayerId, fromVid: VertexId, toVid: VertexId): boolean {
  if (!isCk(state) || state.knightMovedThisTurn) return false;
  const from = state.vertices[fromVid]; const to = state.vertices[toVid];
  if (!from?.knight || from.knight.playerId !== pid || !from.knight.active) return false;
  if (!to || fromVid === toVid) return false;
  if (!from.adjacentVertexIds.includes(toVid)) return false;     // 隣接1歩
  const eid = edgeBetween(state, fromVid, toVid);                 // 自分の道/船沿いに進む
  const e = eid ? state.edges[eid] : null;
  if (!(e?.road?.playerId === pid || e?.ship?.playerId === pid)) return false;
  if (to.building) return false;                                 // 建物の上には行けない
  if (to.knight) {
    if (to.knight.playerId === pid) return false;                // 自分の騎士の上は不可
    if (to.knight.strength >= from.knight.strength) return false;// 弱い敵騎士のみ押し出せる
  }
  return true;
}
export function isKnightMovable(state: GameState, pid: PlayerId, fromVid: VertexId): boolean {
  const from = state.vertices[fromVid];
  if (!from?.knight || from.knight.playerId !== pid || !from.knight.active) return false;
  return from.adjacentVertexIds.some(to => canMoveKnight(state, pid, fromVid, to));
}
export function playerHasMovableKnight(state: GameState, pid: PlayerId): boolean {
  if (!isCk(state) || state.knightMovedThisTurn) return false;
  return Object.keys(state.vertices).some(v => isKnightMovable(state, pid, v));
}
/** 騎士を移動（バリデーション済み前提）。押し出した敵騎士は供給へ戻る。1ターン1回。 */
export function moveKnight(state: GameState, pid: PlayerId, fromVid: VertexId, toVid: VertexId): GameState {
  const k = state.vertices[fromVid]!.knight!;
  return {
    ...state,
    knightMovedThisTurn: true,
    vertices: {
      ...state.vertices,
      [fromVid]: { ...state.vertices[fromVid]!, knight: null },
      [toVid]: { ...state.vertices[toVid]!, knight: { playerId: pid, strength: k.strength, active: k.active } },
    },
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

  // メトロポリス: そのツリーで Lv4以上かつ「現保持者より高いレベル」になった者が保持する。
  //   - 未保持 → Lv4到達で獲得（先着）。
  //   - 他者がLv4保持中に自分がLv5へ → 奪取（相手の都市は平の都市に戻る）。
  const holder = metropolis[track];
  const holderLvl = holder ? improvements(state.players[holder.playerId]!)[track] : 0;
  const shouldTake = newLvl >= CK_METROPOLIS_LEVEL
    && (!holder || (holder.playerId !== pid && newLvl > holderLvl));
  if (shouldTake) {
    const newVid = Object.keys(state.vertices).find(id =>
      state.vertices[id]!.building?.playerId === pid && state.vertices[id]!.building?.type === 'city' && !state.vertices[id]!.building?.metropolis);
    if (newVid) {
      // 奪取時は旧保持者のメトロポリスを平の都市へ戻す（勝利点4→2）。
      if (holder && holder.playerId !== pid) {
        const ov = vertices[holder.vertexId];
        if (ov?.building?.metropolis) {
          vertices = { ...vertices, [holder.vertexId]: { ...ov, building: { type: 'city', playerId: holder.playerId } } };
        }
      }
      vertices = { ...vertices, [newVid]: { ...vertices[newVid]!, building: { ...vertices[newVid]!.building!, metropolis: true } } };
      metropolis = { ...metropolis, [track]: { playerId: pid, vertexId: newVid } };
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

// 7の捨て札しきい値は robber.ts の discardThreshold が一元管理する
// （城壁/メトロポリス1つにつき+2）。ここでは重複定義しない。

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

// ============================================================
// 進歩カード
// ============================================================

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** ツリー別の進歩カード山札を生成（各カード3枚ずつシャッフル）。 */
export function buildProgressDecks(rng: () => number): Record<CkTrack, ProgressCard[]> {
  const decks = { trade: [], politics: [], science: [] } as Record<CkTrack, ProgressCard[]>;
  for (const track of ['trade', 'politics', 'science'] as CkTrack[]) {
    const cards: ProgressCard[] = [];
    let n = 0;
    for (const type of PROGRESS_DECK_CARDS[track]) {
      for (let i = 0; i < 3; i++) cards.push({ id: `${track}_${type}_${n++}`, type, deck: track });
    }
    decks[track] = shuffle(cards, rng);
  }
  return decks;
}

/** 色イベント面で、改善レベルが redDie 以上のプレイヤーが その色のカードを1枚引く（手札上限4）。 */
function drawProgressCards(state: GameState, color: CkTrack, redDie: number): GameState {
  const decks = state.progressDecks;
  if (!decks) return state;
  const deck = [...(decks[color] ?? [])];
  if (deck.length === 0) return state;
  const players = { ...state.players };
  let changed = false;
  for (const pid of state.playerOrder) {
    const p = players[pid]!;
    if ((p.improvements?.[color] ?? 0) < redDie) continue;
    const held = p.progressCards ?? [];
    if (held.length >= PROGRESS_HAND_LIMIT) continue;
    if (deck.length === 0) break;
    players[pid] = { ...p, progressCards: [...held, deck.shift()!] };
    changed = true;
  }
  if (!changed) return state;
  return { ...state, players, progressDecks: { ...decks, [color]: deck } };
}

function handTotalRes(p: Player): number {
  return RESOURCE_TYPES.reduce((s, r) => s + p.hand[r], 0);
}
function adjacentTerrainCount(state: GameState, pid: PlayerId, type: TileType): number {
  const tiles = new Set<string>();
  for (const v of Object.values(state.vertices)) {
    if (v.building?.playerId !== pid) continue;
    for (const tid of v.adjacentTileIds) if (state.tiles[tid]?.type === type) tiles.add(tid);
  }
  return tiles.size;
}
function discardLargest(hand: ResourceHand, n: number): ResourceHand {
  const h = { ...hand };
  for (let i = 0; i < n; i++) {
    const r = [...RESOURCE_TYPES].sort((a, b) => h[b] - h[a])[0]!;
    if (h[r] <= 0) break;
    h[r] -= 1;
  }
  return h;
}
function takeRandom(hand: ResourceHand, n: number, rng: () => number): { hand: ResourceHand; taken: Partial<ResourceHand> } {
  const h = { ...hand };
  const taken: Partial<ResourceHand> = {};
  for (let i = 0; i < n; i++) {
    const pool: ResourceType[] = [];
    for (const r of RESOURCE_TYPES) for (let k = 0; k < h[r]; k++) pool.push(r);
    if (pool.length === 0) break;
    const r = pool[Math.floor(rng() * pool.length)]!;
    h[r] -= 1; taken[r] = (taken[r] ?? 0) + 1;
  }
  return { hand: h, taken };
}
function addHand(hand: ResourceHand, add: Partial<ResourceHand>): ResourceHand {
  const h = { ...hand };
  for (const r of RESOURCE_TYPES) h[r] += add[r] ?? 0;
  return h;
}

/** 進歩カードを使用可能か（手札にあり、効果が成立する状況か）。 */
export function canPlayProgress(state: GameState, pid: PlayerId, cardId: string): boolean {
  if (!isCk(state)) return false;
  const p = state.players[pid]; if (!p) return false;
  const card = (p.progressCards ?? []).find(c => c.id === cardId);
  if (!card) return false;
  const opps = state.playerOrder.filter(o => o !== pid);
  const myVp = calcVP(state, pid);
  switch (card.type) {
    case 'smith':    return Object.values(state.vertices).some(v => v.knight?.playerId === pid && v.knight.strength < 3);
    case 'engineer': return wallCount(state, pid) < CK_MAX_WALLS && Object.values(state.vertices).some(v => v.building?.playerId === pid && v.building.type === 'city' && !v.building.metropolis && !(v.building as { wall?: boolean }).wall);
    case 'irrigation': return adjacentTerrainCount(state, pid, 'field') > 0;
    case 'mining':     return adjacentTerrainCount(state, pid, 'mountain') > 0;
    case 'resource_monopoly': return opps.some(o => handTotalRes(state.players[o]!) > 0);
    case 'trade_monopoly':    return opps.some(o => COMMODITY_TYPES.reduce((s, c) => s + commodities(state.players[o]!)[c], 0) > 0);
    case 'master_merchant':   return opps.some(o => handTotalRes(state.players[o]!) > 0);
    case 'warlord':  return Object.values(state.vertices).some(v => v.knight?.playerId === pid && !v.knight.active);
    case 'saboteur': return opps.some(o => calcVP(state, o) >= myVp && handTotalRes(state.players[o]!) > 0);
    case 'wedding':  return opps.some(o => calcVP(state, o) > myVp && handTotalRes(state.players[o]!) > 0);
    default: return false;
  }
}

/** 進歩カードを使用して効果を適用（バリデーション済み前提）。カードは手札から除去。 */
export function playProgress(state: GameState, pid: PlayerId, cardId: string, rng: () => number): GameState {
  const p0 = state.players[pid]!;
  const card = (p0.progressCards ?? []).find(c => c.id === cardId)!;
  const players: Record<string, Player> = { ...state.players, [pid]: { ...p0, progressCards: (p0.progressCards ?? []).filter(c => c.id !== cardId) } };
  let vertices = state.vertices;
  let bank = { ...state.bank };
  const opps = state.playerOrder.filter(o => o !== pid);
  const gainRes = (id: PlayerId, add: Partial<ResourceHand>): void => { players[id] = { ...players[id]!, hand: addHand(players[id]!.hand, add) }; };

  switch (card.type) {
    case 'smith': {
      const v2 = { ...vertices };
      const targets = Object.keys(v2)
        .filter(id => v2[id]!.knight?.playerId === pid && v2[id]!.knight!.strength < 3)
        .sort((a, b) => v2[a]!.knight!.strength - v2[b]!.knight!.strength).slice(0, 2);
      for (const id of targets) { const k = v2[id]!.knight!; v2[id] = { ...v2[id]!, knight: { ...k, strength: (k.strength + 1) as 1 | 2 | 3 } }; }
      vertices = v2; break;
    }
    case 'engineer': {
      const id = Object.keys(vertices).find(v => vertices[v]!.building?.playerId === pid && vertices[v]!.building?.type === 'city' && !vertices[v]!.building?.metropolis && !(vertices[v]!.building as { wall?: boolean }).wall);
      if (id) vertices = { ...vertices, [id]: { ...vertices[id]!, building: { ...vertices[id]!.building!, wall: true } } };
      break;
    }
    case 'irrigation': case 'mining': {
      const isIrr = card.type === 'irrigation';
      const r: ResourceType = isIrr ? 'grain' : 'ore';
      const amt = Math.min(adjacentTerrainCount(state, pid, isIrr ? 'field' : 'mountain') * 2, bank[r]);
      bank[r] -= amt; gainRes(pid, { [r]: amt }); break;
    }
    case 'resource_monopoly': {
      let best: ResourceType = 'wood', bt = -1;
      for (const r of RESOURCE_TYPES) { const t = opps.reduce((s, o) => s + players[o]!.hand[r], 0); if (t > bt) { bt = t; best = r; } }
      let gained = 0;
      for (const o of opps) { const take = Math.min(2, players[o]!.hand[best]); if (take > 0) { players[o] = { ...players[o]!, hand: { ...players[o]!.hand, [best]: players[o]!.hand[best] - take } }; gained += take; } }
      gainRes(pid, { [best]: gained }); break;
    }
    case 'trade_monopoly': {
      let best: CommodityType = 'coin', bt = -1;
      for (const c of COMMODITY_TYPES) { const t = opps.reduce((s, o) => s + commodities(players[o]!)[c], 0); if (t > bt) { bt = t; best = c; } }
      let gained = 0;
      for (const o of opps) { const take = Math.min(1, commodities(players[o]!)[best]); if (take > 0) { players[o] = { ...players[o]!, commodities: { ...commodities(players[o]!), [best]: commodities(players[o]!)[best] - take } }; gained += take; } }
      players[pid] = { ...players[pid]!, commodities: { ...commodities(players[pid]!), [best]: commodities(players[pid]!)[best] + gained } }; break;
    }
    case 'master_merchant': {
      const target = [...opps].filter(o => handTotalRes(players[o]!) > 0).sort((a, b) => calcVP(state, b) - calcVP(state, a))[0];
      if (target) { const { hand, taken } = takeRandom(players[target]!.hand, 2, rng); players[target] = { ...players[target]!, hand }; gainRes(pid, taken); }
      break;
    }
    case 'warlord': {
      const v2 = { ...vertices };
      for (const id of Object.keys(v2)) { const k = v2[id]!.knight; if (k?.playerId === pid && !k.active) v2[id] = { ...v2[id]!, knight: { ...k, active: true } }; }
      vertices = v2; break;
    }
    case 'saboteur': {
      const myVp = calcVP(state, pid);
      for (const o of opps) {
        if (calcVP(state, o) < myVp) continue;
        const tot = handTotalRes(players[o]!);
        const n = Math.floor(tot / 2);
        if (n <= 0) continue;
        const before = players[o]!.hand;
        const after = discardLargest(before, n);
        players[o] = { ...players[o]!, hand: after };
        for (const r of RESOURCE_TYPES) bank[r] += before[r] - after[r]; // 捨て札はバンクへ
      }
      break;
    }
    case 'wedding': {
      const myVp = calcVP(state, pid);
      for (const o of opps) {
        if (calcVP(state, o) <= myVp) continue;
        const { hand, taken } = takeRandom(players[o]!.hand, 2, rng);
        players[o] = { ...players[o]!, hand }; gainRes(pid, taken);
      }
      break;
    }
  }
  return { ...state, players, vertices, bank };
}

/**
 * ROLL_DICE後にイベントダイスを処理。
 *  - 蛮族船: 前進し、CK_BARBARIAN_MAX で襲来判定。
 *  - 色(交易/政治/科学): その色の改善レベルが赤ダイス(redDie)以上のプレイヤーが進歩カードを1枚引く。
 */
export function applyEventDie(state: GameState, rng: () => number, redDie: number): GameState {
  const face = rollEventDie(rng);
  const next: GameState = { ...state, lastEventDie: face };
  if (face === 'ship') {
    const pos = (next.barbarianPosition ?? 0) + 1;
    return pos >= CK_BARBARIAN_MAX ? resolveBarbarianAttack({ ...next, barbarianPosition: pos }) : { ...next, barbarianPosition: pos };
  }
  return drawProgressCards(next, face, redDie);
}

/** C&K産出を手札・銀行へ適用（資源＋商品）。computeCkProduction の結果を反映した新stateを返す。 */
export function distributeCkProduction(state: GameState, diceTotal: number): GameState {
  const { resources, commodities: comm } = computeCkProduction(state, diceTotal);
  const players = { ...state.players };
  const bank = { ...state.bank };
  for (const pid of state.playerOrder) {
    const rGain = resources[pid]; const cGain = comm[pid];
    const p = players[pid]!;
    const hand = { ...p.hand };
    let resGained = 0;
    if (rGain) for (const r of RESOURCE_TYPES) { const n = rGain[r] ?? 0; if (n) { hand[r] += n; bank[r] -= n; resGained += n; } }
    const newComm = { ...commodities(p) };
    if (cGain) for (const c of COMMODITY_TYPES) { const n = cGain[c] ?? 0; if (n) newComm[c] += n; }
    // 水道橋(科学Lv3): このロールで資源を1つも得られなかったプレイヤーは、資源を1枚もらえる
    //   （手動選択UIを避けるため、最も少ない資源を自動選択。バンク在庫で頭打ち）。
    if (resGained === 0 && (p.improvements?.science ?? 0) >= 3) {
      const r = [...RESOURCE_TYPES].sort((a, b) => (hand[a] - hand[b]) || (bank[b] - bank[a]))[0]!;
      if (bank[r] > 0) { hand[r] += 1; bank[r] -= 1; resGained = 1; }
    }
    if (resGained > 0 || (cGain && COMMODITY_TYPES.some(c => (cGain[c] ?? 0) > 0))) {
      players[pid] = { ...p, hand, commodities: newComm };
    }
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
