// ============================================================
// src/engine/ai.ts — AIプレイヤー（難易度対応）
// ============================================================

import type { GameState, Action, PlayerId, ResourceType, AiDifficulty, ResourceHand, DevCardType } from '../types';
import { RESOURCE_TYPES, BUILD_COSTS, VP_TABLE, TILE_RESOURCE_MAP } from '../constants';
import { canBuildRoad, canBuildSettlement, canBuildCity, hasEnoughResources } from './actions';
import { canBankTrade, getEffectiveTradeRate } from './trade';
import { calcVP } from './scoring';

// ============================================================
// 確率テーブル（数字トークンの出目確率 /36）
// ============================================================

const NUMBER_PROB: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
  8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

// CPU→人間 交易提案を「試みる」確率（建設不能ターンに1回だけ判定）。
// 実際に提案が出るのは findCpuTradeOpportunity が機会を返したときのみ。
// テンポ悪化を避けるため控えめに設定。弱CPUは提案しない（0扱い）。
const CPU_TRADE_OFFER_CHANCE = {
  normal: 0.22,
  strong: 0.28,
} as const;

// ============================================================
// ユーティリティ
// ============================================================

function vertexProductionScore(state: GameState, vertexId: string): number {
  return (state.vertices[vertexId]?.adjacentTileIds ?? []).reduce((sum, tid) => {
    const n = state.tiles[tid]?.number;
    return sum + (n ? (NUMBER_PROB[n] ?? 0) : 0);
  }, 0);
}

// 頂点に隣接するタイルの産出資源（砂漠は除外）。
function adjacentResources(state: GameState, vertexId: string): ResourceType[] {
  const out: ResourceType[] = [];
  for (const tid of state.vertices[vertexId]?.adjacentTileIds ?? []) {
    const t = state.tiles[tid];
    const r = t ? TILE_RESOURCE_MAP[t.type] : null;
    if (r) out.push(r);
  }
  return out;
}

// 頂点に隣接するタイルの数字（砂漠/未設定は除外）。
function adjacentNumbers(state: GameState, vertexId: string): number[] {
  const out: number[] = [];
  for (const tid of state.vertices[vertexId]?.adjacentTileIds ?? []) {
    const n = state.tiles[tid]?.number;
    if (n != null) out.push(n);
  }
  return out;
}

// 初期配置ヒューリスティックの重み（チューニングはここ1か所に集約）。
const SETUP_WEIGHTS = {
  pip: 1.0,          // 隣接3ヘックスの pip(出目確率) 合計の基礎重み
  diversity: 1.5,    // 異なる資源1種ごとの加点（資源の多様性）
  oreWheat: 2.0,     // ore と wheat(grain) の両方に触れる（都市化に重要）
  woodBrick: 1.5,    // wood と brick の両方に触れる（序盤拡張に重要）
  harbor: 1.0,       // 港に接する小加点
  numberSpread: 1.0, // 隣接数字が全て異なるときの加点（同じ数字への偏りを避ける）
  newResource: 2.0,  // (2軒目) 1軒目に無い資源1種ごとの加点
  newNumber: 0.5,    // (2軒目) 1軒目と異なる数字1個ごとの加点
} as const;

/**
 * 初期配置（開拓地）の頂点評価。高いほど良い。純粋関数。
 * 基礎 = 隣接 pip 合計。補正 = 資源多様性 / ore+wheat / wood+brick / 港 / 数字分散。
 * ownFirstSettlement を渡すと（2軒目想定）1軒目に無い資源・別数字を補完するほど加点する。
 */
export function evaluateVertexForSetup(
  state: GameState,
  vertexId: string,
  ownFirstSettlement?: string,
): number {
  if (!state.vertices[vertexId]) return -Infinity;
  const resources = adjacentResources(state, vertexId);
  const uniqueRes = new Set(resources);
  const numbers = adjacentNumbers(state, vertexId);
  const uniqueNums = new Set(numbers);

  let score = vertexProductionScore(state, vertexId) * SETUP_WEIGHTS.pip;
  score += uniqueRes.size * SETUP_WEIGHTS.diversity;
  if (uniqueRes.has('ore') && uniqueRes.has('grain')) score += SETUP_WEIGHTS.oreWheat;
  if (uniqueRes.has('wood') && uniqueRes.has('brick')) score += SETUP_WEIGHTS.woodBrick;
  if (state.vertices[vertexId]?.harborType) score += SETUP_WEIGHTS.harbor;
  if (numbers.length > 0 && uniqueNums.size === numbers.length) score += SETUP_WEIGHTS.numberSpread;

  if (ownFirstSettlement) {
    const firstRes = new Set(adjacentResources(state, ownFirstSettlement));
    const firstNums = new Set(adjacentNumbers(state, ownFirstSettlement));
    for (const r of uniqueRes) if (!firstRes.has(r)) score += SETUP_WEIGHTS.newResource;
    for (const n of uniqueNums) if (!firstNums.has(n)) score += SETUP_WEIGHTS.newNumber;
  }
  return score;
}

// スコア最大の要素を選ぶ。最大が拮抗（eps以内）する場合のみ seed RNG でタイブレーク。
function pickByScore<T>(items: T[], scoreFn: (t: T) => number, rng: () => number, eps = 0.01): T {
  const scored = items.map(it => ({ it, s: scoreFn(it) }));
  const best = scored.reduce((m, x) => Math.max(m, x.s), -Infinity);
  const top = scored.filter(x => x.s >= best - eps).map(x => x.it);
  return top.length === 1 ? top[0]! : top[Math.floor(rng() * top.length)]!;
}

// ============================================================
// 手番方策（A-3）の評価ヘルパー
// ============================================================

// 資源の戦略的重み。都市化で生産が倍になる ore/wheat(grain) を重視する。
const RESOURCE_WEIGHT: Record<ResourceType, number> = {
  ore: 1.3, grain: 1.3, wool: 1.0, wood: 1.0, brick: 1.0,
};

// 頂点の重み付き生産価値 = Σ pip(隣接タイル) × 資源重み。都市化先・開拓地先の良し悪し。
export function weightedProduction(state: GameState, vertexId: string): number {
  let v = 0;
  for (const tid of state.vertices[vertexId]?.adjacentTileIds ?? []) {
    const t = state.tiles[tid];
    const r = t ? TILE_RESOURCE_MAP[t.type] : null;
    if (!r) continue;
    v += (t!.number ? (NUMBER_PROB[t!.number] ?? 0) : 0) * RESOURCE_WEIGHT[r];
  }
  return v;
}

// pid が既に産出している資源の集合（建物の隣接タイルから導出）。
function playerResourceCoverage(state: GameState, pid: PlayerId): Set<ResourceType> {
  const cov = new Set<ResourceType>();
  for (const v of Object.values(state.vertices)) {
    if (v.building?.playerId !== pid) continue;
    for (const r of adjacentResources(state, v.id)) cov.add(r);
  }
  return cov;
}

// MAIN フェーズの開拓地先評価 = 重み付き生産 + 未保有資源の補完 + 港小加点。
const EXPANSION_NEW_RESOURCE = 2.0;
const EXPANSION_HARBOR = 1.0;
export function evaluateExpansionVertex(state: GameState, pid: PlayerId, vertexId: string): number {
  let score = weightedProduction(state, vertexId);
  const cov = playerResourceCoverage(state, pid);
  for (const r of new Set(adjacentResources(state, vertexId))) if (!cov.has(r)) score += EXPANSION_NEW_RESOURCE;
  if (state.vertices[vertexId]?.harborType) score += EXPANSION_HARBOR;
  return score;
}

// 建設可能な都市化先のうち最良（重み付き生産最大、ore/wheat重視）。無ければ null。
function bestCityVertex(state: GameState, pid: PlayerId, rng: () => number): string | null {
  const verts = Object.keys(state.vertices).filter(v => canBuildCity(state, pid, v));
  return verts.length > 0 ? pickByScore(verts, v => weightedProduction(state, v), rng) : null;
}

// 建設可能な開拓地先のうち最良（生産＋資源補完）。無ければ null。
function bestSettlementVertex(state: GameState, pid: PlayerId, rng: () => number): string | null {
  const verts = Object.keys(state.vertices).filter(v => canBuildSettlement(state, pid, v));
  return verts.length > 0 ? pickByScore(verts, v => evaluateExpansionVertex(state, pid, v), rng) : null;
}

// 道の価値 = その辺が開く（空き）頂点の最良 evaluateExpansionVertex。
// 良い拡張先へ向かう道を優先する（行き止まりの道を避ける）。
function roadEdgeValue(state: GameState, pid: PlayerId, edgeId: string): number {
  const e = state.edges[edgeId];
  if (!e) return 0;
  let best = 0;
  for (const vid of e.vertexIds) {
    if (state.vertices[vid]?.building) continue; // 既に建物がある頂点は開かない
    best = Math.max(best, evaluateExpansionVertex(state, pid, vid));
  }
  return best;
}

// 建設可能な道のうち最良の拡張先へ向かう辺。無ければ null。
function bestRoadEdge(state: GameState, pid: PlayerId, rng: () => number): string | null {
  const edges = Object.keys(state.edges).filter(eid => canBuildRoad(state, pid, eid));
  return edges.length > 0 ? pickByScore(edges, eid => roadEdgeValue(state, pid, eid), rng) : null;
}

function playerHandTotal(state: GameState, pid: PlayerId): number {
  const h = state.players[pid]?.hand;
  return h ? RESOURCE_TYPES.reduce((s, r) => s + h[r], 0) : 0;
}

function getDifficulty(state: GameState, pid: PlayerId): AiDifficulty {
  return state.players[pid]?.aiDifficulty ?? 'normal';
}

/** 強盗の現在地以外の最初のタイルIDを返す（フォールバック用）。 */
function fallbackTileId(state: GameState, excludeId: string | undefined): string {
  return (
    Object.keys(state.tiles).find(tid => tid !== excludeId) ??
    Object.keys(state.tiles)[0]!
  );
}

// ============================================================
// CPU→人間 交易機会検出
// ============================================================

/**
 * CPUが人間プレイヤーに1:1交易を提案できる機会を探す。
 * CPUが建設目標（都市 > 開拓地 > 発展カード）に対して 1 枚だけ不足しており、
 * 自分の余剰資源を1枚渡せる場合に提案内容を返す。条件を満たさない場合は null。
 *
 * 重要: CPUは**自分の手札のみ**を参照する。人間（相手）の手札内容は一切見ない。
 * 「相手が持っているかは分からないが、欲しいので提案する」という挙動とする。
 * 人間が要求資源を持っているかの判定は UI 側（人間本人の手札）と
 * confirmTrade の最終バリデーションに委ねる。
 */
export function findCpuTradeOpportunity(
  state: GameState,
  cpuPid: PlayerId,
): { give: ResourceType; receive: ResourceType; humanPid: PlayerId } | null {
  const cpu = state.players[cpuPid];
  if (!cpu || cpu.type !== 'ai') return null; // 提案を出すのは AI プレイヤーのみ

  const humanPid = state.playerOrder.find(
    p => p !== cpuPid && state.players[p]?.type === 'human',
  ) as PlayerId | undefined;
  if (!humanPid) return null;

  for (const cost of [BUILD_COSTS.city, BUILD_COSTS.settlement, BUILD_COSTS.dev_card] as ResourceHand[]) {
    if (hasEnoughResources(cpu.hand, cost)) continue; // 既に建設可能

    for (const receive of RESOURCE_TYPES) {
      const deficit = (cost[receive] ?? 0) - cpu.hand[receive];
      if (deficit !== 1) continue;           // ちょうど 1 枚不足のみ
      // 人間の手札は参照しない（CPUは相手が持っているか知らない）

      for (const give of RESOURCE_TYPES) {
        if (give === receive) continue;
        // 建設コスト分を残しても give が 1 枚以上余る（自分の手札のみ参照）
        const surplus = cpu.hand[give] - (cost[give] ?? 0);
        if (surplus < 1) continue;
        return { give, receive, humanPid };
      }
    }
  }
  return null;
}

// ============================================================
// メインエントリポイント
// ============================================================

export interface AiOpts {
  /** true の場合、このターンのプレイヤー間交易提案をスキップ */
  skipPlayerTrade?: boolean;
  /** 乱数生成器（テスト/LAN で注入可能。未指定は Math.random）。CPU判断を再現可能にする。 */
  rng?: () => number;
}

export function chooseAction(state: GameState, pid: PlayerId, opts?: AiOpts): Action | null {
  if (state.phase === 'GAME_OVER') return null;
  const rng = opts?.rng ?? Math.random;

  if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
    if (state.playerOrder[state.currentPlayerIndex] !== pid) return null;
    return chooseSetupAction(state, pid, rng);
  }

  if (state.phase !== 'MAIN') return null;

  if (state.turnPhase === 'DISCARD') {
    return chooseDiscard(state, pid, rng);
  }

  if (state.playerOrder[state.currentPlayerIndex] !== pid) return null;

  const player = state.players[pid];
  if (!player) return null;

  switch (state.turnPhase) {
    case 'PRE_ROLL':    return choosePreRollAction(state, pid);
    case 'ROBBER':      return chooseRobberAction(state, pid, rng);
    case 'TRADE_BUILD': return chooseTradeBuildAction(state, pid, opts?.skipPlayerTrade ?? false, rng);
    default:            return null;
  }
}

// ============================================================
// セットアップフェーズ
// ============================================================

function chooseSetupAction(state: GameState, pid: PlayerId, rng: () => number): Action | null {
  const difficulty = getDifficulty(state, pid);

  if (state.setupSubPhase === 'PLACE_SETTLEMENT') {
    const valid = Object.keys(state.vertices).filter(vid =>
      canBuildSettlement(state, pid, vid),
    );
    if (valid.length === 0) return null;

    if (difficulty === 'weak') {
      return { type: 'BUILD_SETTLEMENT', vertexId: valid[Math.floor(rng() * valid.length)]! };
    }

    // 2軒目(SETUP_BACKWARD)は自分の1軒目を踏まえ、不足資源・別数字を補完する評価にする。
    const firstSettlement = state.phase === 'SETUP_BACKWARD'
      ? Object.keys(state.vertices).find(vid => {
          const b = state.vertices[vid]?.building;
          return b?.type === 'settlement' && b.playerId === pid;
        })
      : undefined;
    const chosen = pickByScore(valid, vid => evaluateVertexForSetup(state, vid, firstSettlement), rng);
    return { type: 'BUILD_SETTLEMENT', vertexId: chosen };
  }

  if (state.setupSubPhase === 'PLACE_ROAD') {
    const valid = Object.keys(state.edges).filter(eid =>
      canBuildRoad(state, pid, eid),
    );
    if (valid.length === 0) return null;

    return {
      type: 'BUILD_ROAD',
      edgeId: difficulty === 'weak'
        ? valid[Math.floor(rng() * valid.length)]!
        : valid[0]!,
    };
  }

  return null;
}

// ============================================================
// PRE_ROLL フェーズ
// ============================================================

function choosePreRollAction(state: GameState, pid: PlayerId): Action {
  const player = state.players[pid]!;
  const difficulty = getDifficulty(state, pid);

  // 1ターン1枚制限を尊重（devCardPlayedThisTurn を見ないと2枚目で例外→停止する）
  if (difficulty !== 'weak' && !state.devCardPlayedThisTurn) {
    const knight = player.devCards.find(
      c => c.type === 'knight' && c.purchasedOnTurn < state.globalTurnNumber,
    );
    if (knight) return { type: 'PLAY_KNIGHT' };
  }

  return { type: 'ROLL_DICE' };
}

// ============================================================
// DISCARD フェーズ（難易度に関わらず正確に捨てる）
// ============================================================

function chooseDiscard(state: GameState, pid: PlayerId, rng: () => number = Math.random): Action | null {
  const player = state.players[pid];
  if (!player) return null;

  const total = RESOURCE_TYPES.reduce((s, r) => s + player.hand[r], 0);
  if (total < 8) return null;

  const target = Math.floor(total / 2);
  return { type: 'DISCARD_RESOURCES', playerId: pid, resources: chooseDiscards(state, pid, target, rng) };
}

/**
 * 破棄する資源を選ぶ純粋関数。次の建設目標(goalCosts)に必要な資源を温存し、
 * 余剰(手札 - 目標必要数)が大きい資源から1枚ずつ count 枚捨てる。
 * 余剰が拮抗するときのみ seed RNG でタイブレーク（決定的）。
 */
export function chooseDiscards(
  state: GameState, pid: PlayerId, count: number, rng: () => number = Math.random,
): Partial<Record<ResourceType, number>> {
  const player = state.players[pid];
  if (!player) return {};
  const goals = goalCosts(state, pid);
  // 各資源の必要数 = 目標コストに含まれる枚数の最大（最優先目標を含む全目標で温存）。
  const needed = {} as Record<ResourceType, number>;
  for (const r of RESOURCE_TYPES) needed[r] = goals.reduce((m, g) => Math.max(m, g[r] ?? 0), 0);

  const remaining = { ...player.hand };
  const discards: Partial<Record<ResourceType, number>> = {};
  for (let i = 0; i < count; i++) {
    const avail = RESOURCE_TYPES.filter(r => remaining[r] > 0);
    if (avail.length === 0) break;
    // 余剰度（remaining - needed）が最大の資源を捨てる。必要資源は最後まで温存される。
    const pick = pickByScore(avail, r => remaining[r] - needed[r], rng);
    remaining[pick] -= 1;
    discards[pick] = (discards[pick] ?? 0) + 1;
  }
  return discards;
}

// ============================================================
// ROBBER フェーズ
// ============================================================

// タイルに建物を持つ相手プレイヤー（自分は除く・重複なし）。
function opponentsOnTile(state: GameState, tileId: string, pid: PlayerId): PlayerId[] {
  const vids = state.tileToVertices[tileId] ?? [];
  return [...new Set(
    vids.map(v => state.vertices[v]?.building?.playerId)
      .filter((p): p is PlayerId => p != null && p !== pid),
  )];
}

// 自分がそのタイルに建物を持つか（盗賊で自分の生産を止めないため）。
function selfOnTile(state: GameState, tileId: string, pid: PlayerId): boolean {
  return (state.tileToVertices[tileId] ?? []).some(v => state.vertices[v]?.building?.playerId === pid);
}

function tilePip(state: GameState, tileId: string): number {
  const n = state.tiles[tileId]?.number;
  return n ? (NUMBER_PROB[n] ?? 0) : 0;
}

// 盗賊配置スコア: 相手がいない/自分の生産/砂漠/現在地 は対象外(-Infinity)。
// それ以外は pip ×「最も勝っている相手の脅威度(VP)」。VP0でも pip で比較できるよう +1。
function robberHexScore(state: GameState, tileId: string, pid: PlayerId): number {
  const tile = state.tiles[tileId];
  if (!tile || tile.type === 'desert' || tile.hasRobber) return -Infinity;
  if (selfOnTile(state, tileId, pid)) return -Infinity;
  const opps = opponentsOnTile(state, tileId, pid);
  if (opps.length === 0) return -Infinity;
  const maxThreat = opps.reduce((m, o) => Math.max(m, calcVP(state, o)), 0);
  return tilePip(state, tileId) * (1 + maxThreat);
}

/**
 * 盗賊を置くヘックスを選ぶ純粋関数。
 * 「最も勝っている相手の生産を最も削る（pip × 相手VP）」ヘックスを選び、自分の生産は避ける。
 * 相手のいる有効ヘックスが無い場合は自分を避けた非砂漠、それも無ければ任意へフォールバック。
 */
export function chooseRobberHex(state: GameState, pid: PlayerId, rng: () => number = Math.random): string {
  const current = Object.values(state.tiles).find(t => t.hasRobber)?.id;
  const candidates = Object.keys(state.tiles).filter(
    tid => tid !== current && state.tiles[tid]?.type !== 'desert',
  );
  const scored = candidates.filter(tid => robberHexScore(state, tid, pid) > -Infinity);
  if (scored.length > 0) {
    return pickByScore(scored, tid => robberHexScore(state, tid, pid), rng);
  }
  // フォールバック: 自分の生産を避けたヘックス → 無ければ任意の候補 → 最後に fallbackTileId。
  const noSelf = candidates.filter(tid => !selfOnTile(state, tid, pid));
  const pool = noSelf.length > 0 ? noSelf : candidates;
  return pool.length > 0 ? pool[Math.floor(rng() * pool.length)]! : fallbackTileId(state, current);
}

/**
 * 盗賊を置いたヘックスに隣接する相手から略奪先を選ぶ純粋関数。
 * 手札が多い／勝利に近い(VP高)相手を優先。手札0の相手は除外（奪えないため）。該当なしは null。
 */
export function chooseStealTarget(
  state: GameState, tileId: string, pid: PlayerId, rng: () => number = Math.random,
): PlayerId | null {
  const opps = opponentsOnTile(state, tileId, pid).filter(o => playerHandTotal(state, o) > 0);
  if (opps.length === 0) return null;
  return pickByScore(opps, o => playerHandTotal(state, o) + calcVP(state, o) * 2, rng);
}

function chooseRobberAction(state: GameState, pid: PlayerId, rng: () => number): Action {
  const difficulty = getDifficulty(state, pid);

  if (difficulty === 'weak') {
    // 弱: 現在地以外の非砂漠からランダム。盗む相手は選ばない。
    const current = Object.values(state.tiles).find(t => t.hasRobber)?.id;
    const candidates = Object.keys(state.tiles).filter(
      tid => tid !== current && state.tiles[tid]?.type !== 'desert',
    );
    const tileId = candidates.length > 0
      ? candidates[Math.floor(rng() * candidates.length)]!
      : fallbackTileId(state, current);
    return { type: 'MOVE_ROBBER', tileId, stealFromPlayerId: null };
  }

  const tileId = chooseRobberHex(state, pid, rng);
  return { type: 'MOVE_ROBBER', tileId, stealFromPlayerId: chooseStealTarget(state, tileId, pid, rng) };
}

// ============================================================
// TRADE_BUILD フェーズ
// ============================================================

function chooseTradeBuildAction(state: GameState, pid: PlayerId, skipPlayerTrade = false, rng: () => number = Math.random): Action {
  // 街道建設カード使用中: 無料道を置く（置けなければ効果完了）
  if (state.roadBuildingRoadsRemaining > 0) {
    const roadEdge = Object.keys(state.edges).find(eid => canBuildRoad(state, pid, eid));
    if (roadEdge) return { type: 'BUILD_ROAD', edgeId: roadEdge };
    return { type: 'FINISH_ROAD_BUILDING' };
  }

  const difficulty = getDifficulty(state, pid);
  if (difficulty === 'weak') return chooseTradeBuildWeak(state, pid, rng);
  if (difficulty === 'strong') return chooseTradeBuildStrong(state, pid, skipPlayerTrade, rng);
  return chooseTradeBuildNormal(state, pid, skipPlayerTrade, rng);
}

// ---- 弱: 可能なアクションからランダム ----

function chooseTradeBuildWeak(state: GameState, pid: PlayerId, rng: () => number): Action {
  const player = state.players[pid]!;
  const possible: Action[] = [];

  Object.keys(state.vertices)
    .filter(vid => canBuildCity(state, pid, vid))
    .forEach(vid => possible.push({ type: 'BUILD_CITY', vertexId: vid }));

  Object.keys(state.vertices)
    .filter(vid => canBuildSettlement(state, pid, vid))
    .forEach(vid => possible.push({ type: 'BUILD_SETTLEMENT', vertexId: vid }));

  if (state.devDeck.length > 0 && hasEnoughResources(player.hand, BUILD_COSTS.dev_card)) {
    possible.push({ type: 'BUY_DEV_CARD' });
  }

  if (player.remainingRoads > 0) {
    // 候補を1辺に絞る（全辺追加すると道が圧倒的多数になりVP建設確率が激減するため）
    const roadEdge = Object.keys(state.edges).find(eid => canBuildRoad(state, pid, eid));
    if (roadEdge) possible.push({ type: 'BUILD_ROAD', edgeId: roadEdge });
  }

  if (possible.length > 0) {
    return possible[Math.floor(rng() * possible.length)]!;
  }

  // 資源不足で建設不可の場合: バンク交易を試みる（ゲームの収束を保証）
  const bankTrade = tryBankTrade(state, pid);
  if (bankTrade) return bankTrade;

  return { type: 'END_TURN' };
}

// ---- 普通: 優先度に従って確実な選択 ----

// cost を支払うのに不足している資源を、余剰資源のバンク交易で1枚補う手を返す。
// 1手ずつなので、複数回呼ばれて徐々に必要資源を揃える（次ステップで建設）。
function bankTradeToward(state: GameState, pid: PlayerId, cost: ResourceHand): Action | null {
  const player = state.players[pid]!;
  const need = RESOURCE_TYPES.find(r => player.hand[r] < (cost[r] ?? 0));
  if (!need) return null; // 既に足りている
  const giveCandidates = [...RESOURCE_TYPES].sort((a, b) =>
    (player.hand[b] - (cost[b] ?? 0)) - (player.hand[a] - (cost[a] ?? 0)),
  );
  for (const give of giveCandidates) {
    if (give === need) continue;
    if (!canBankTrade(state, pid, give, need)) continue;
    const rate = getEffectiveTradeRate(state, pid, give);
    // cost に必要な give の枚数を割らない範囲でのみ放出する
    if (player.hand[give] - rate < (cost[give] ?? 0)) continue;
    return { type: 'BANK_TRADE', give, receive: need };
  }
  return null;
}

// 勝利まであと1点以上なら、勝利に直結する建設を最優先で実行する。
// 建設できなければ、不足資源をバンク交易で1手ずつ補い、次ステップでの建設→勝利を狙う。
function victoryPush(state: GameState, pid: PlayerId, rng: () => number = Math.random): Action | null {
  if (calcVP(state, pid) < VP_TABLE.target - 1) return null;
  const player = state.players[pid]!;

  const city = bestCityVertex(state, pid, rng);
  if (city) return { type: 'BUILD_CITY', vertexId: city };
  const settl = bestSettlementVertex(state, pid, rng);
  if (settl) return { type: 'BUILD_SETTLEMENT', vertexId: settl };
  // 建設不可: 都市化先があれば都市、なければ開拓地の不足資源をバンク交易で補う
  const hasUpgradable = Object.values(state.vertices).some(
    v => v.building?.type === 'settlement' && v.building.playerId === pid,
  );
  const targets: ResourceHand[] = [];
  if (hasUpgradable && player.remainingCities > 0) targets.push(BUILD_COSTS.city as ResourceHand);
  if (player.remainingSettlements > 0) targets.push(BUILD_COSTS.settlement as ResourceHand);
  for (const cost of targets) {
    const bt = bankTradeToward(state, pid, cost);
    if (bt) return bt;
  }
  return null;
}

// ---- 進歩カード（豊作/独占/街道建設）の使用判断 ----
// 1ターン1枚制限・購入ターン制限を守る。建設で手詰まりのとき局面を進めるために使う。

function playableDev(state: GameState, pid: PlayerId, type: DevCardType): boolean {
  if (state.devCardPlayedThisTurn) return false;
  const p = state.players[pid];
  return !!p?.devCards.some(c => c.type === type && c.purchasedOnTurn < state.globalTurnNumber);
}

// pid が次に狙う建設目標のコスト一覧（都市→開拓地→発展カードの優先順）。
function goalCosts(state: GameState, pid: PlayerId): ResourceHand[] {
  const p = state.players[pid]!;
  const goals: ResourceHand[] = [];
  const hasUpgradable = Object.values(state.vertices).some(
    v => v.building?.type === 'settlement' && v.building.playerId === pid,
  );
  if (hasUpgradable && p.remainingCities > 0) goals.push(BUILD_COSTS.city as ResourceHand);
  if (p.remainingSettlements > 0) goals.push(BUILD_COSTS.settlement as ResourceHand);
  goals.push(BUILD_COSTS.dev_card as ResourceHand);
  return goals;
}

// 手持ちの進歩カードのうち局面を前進させられる一手を返す（無ければ null）。
// 相手の手札は覗かず、自分の建設目標に基づいて判断する（findCpuTradeOpportunity と同方針）。
function chooseProgressCardAction(state: GameState, pid: PlayerId): Action | null {
  if (state.devCardPlayedThisTurn) return null;
  const player = state.players[pid]!;

  // 街道建設: 道駒が残り、無料で置ける辺があるなら使う（無料2本・最長交易路狙い）。
  // 判定は「無料モードを模した state」で行う（通常の canBuildRoad は資源コストを要求し、
  // 手詰まり時に false になってしまうため）。
  if (playableDev(state, pid, 'road_building') && player.remainingRoads > 0) {
    const freeState: GameState = { ...state, roadBuildingRoadsRemaining: 1 };
    if (Object.keys(state.edges).some(eid => canBuildRoad(freeState, pid, eid))) {
      return { type: 'PLAY_ROAD_BUILDING' };
    }
  }

  // 豊作: あと2枚以内で目標(都市/開拓地/発展)に届くなら不足分を取得する。
  if (playableDev(state, pid, 'year_of_plenty')) {
    for (const cost of goalCosts(state, pid)) {
      const need: ResourceType[] = [];
      for (const r of RESOURCE_TYPES) {
        const miss = (cost[r] ?? 0) - player.hand[r];
        for (let i = 0; i < miss; i++) need.push(r);
      }
      if (need.length >= 1 && need.length <= 2) {
        const pick: [ResourceType, ResourceType] = need.length === 2 ? [need[0]!, need[1]!] : [need[0]!, need[0]!];
        return { type: 'PLAY_YEAR_OF_PLENTY', resources: pick };
      }
    }
  }

  // 独占: 目標に最も不足している資源を集める（相手手札は覗かない）。
  if (playableDev(state, pid, 'monopoly')) {
    for (const cost of goalCosts(state, pid)) {
      let bestR: ResourceType | null = null;
      let bestMiss = 0;
      for (const r of RESOURCE_TYPES) {
        const miss = (cost[r] ?? 0) - player.hand[r];
        if (miss > bestMiss) { bestMiss = miss; bestR = r; }
      }
      if (bestR) return { type: 'PLAY_MONOPOLY', resource: bestR };
    }
  }

  return null;
}

// ----------------------------------------------------------------
// 手番方策（明文化したヒューリスティック・探索/ミニマックスはしない）
//   1. このターンに勝てる（建設/カードで10点）なら勝ち手を実行（victoryPush）。
//   2. 最良の都市化（重み付き生産・特に ore/wheat を倍化）。
//   3. 道で繋がった最良の空き頂点へ開拓地（生産＋資源補完を評価）。
//   4. ore+wheat+sheep が揃うなら発展カード購入。
//   5. 最良の拡張先へ向けて道（行き止まりの道は避ける）。
//   6. 手詰まりなら進歩カードで局面を進める／人間へ交易提案／余剰をバンク交易で変換。
//   タイブレークのみ seed RNG。状態変更はエンジン経由（ルールはエンジンが権威）。
// ----------------------------------------------------------------
function chooseTradeBuildNormal(state: GameState, pid: PlayerId, skipPlayerTrade = false, rng: () => number = Math.random): Action {
  const player = state.players[pid]!;

  // 1. 勝利が近いなら勝利に直結する手を最優先
  const win = victoryPush(state, pid, rng);
  if (win) return win;

  // 2. 最良の都市化
  const city = bestCityVertex(state, pid, rng);
  if (city) return { type: 'BUILD_CITY', vertexId: city };

  // 3. 最良の開拓地（生産＋資源補完）
  const settl = bestSettlementVertex(state, pid, rng);
  if (settl) return { type: 'BUILD_SETTLEMENT', vertexId: settl };

  // 4. 発展カード購入（ore+wheat+sheep が揃うとき）
  if (state.devDeck.length > 0 && hasEnoughResources(player.hand, BUILD_COSTS.dev_card)) {
    return { type: 'BUY_DEV_CARD' };
  }

  // 5. 最良の拡張先へ向けて道
  if (player.remainingRoads > 0) {
    const road = bestRoadEdge(state, pid, rng);
    if (road) return { type: 'BUILD_ROAD', edgeId: road };
  }

  // 6. 建設で手詰まりのとき、手持ちの進歩カードで局面を進める（豊作/独占/街道建設）。
  const progress = chooseProgressCardAction(state, pid);
  if (progress) return progress;

  // バンク交易より先に人間への交易提案を試みる（テンポ重視で控えめな頻度）
  if (!skipPlayerTrade && rng() < CPU_TRADE_OFFER_CHANCE.normal) {
    const opp = findCpuTradeOpportunity(state, pid);
    if (opp) {
      const giveHand: Partial<ResourceHand> = { [opp.give]: 1 };
      const receiveHand: Partial<ResourceHand> = { [opp.receive]: 1 };
      return { type: 'OFFER_TRADE', offer: { give: giveHand, receive: receiveHand }, targetPlayerIds: [opp.humanPid] };
    }
  }

  const bankTrade = tryBankTrade(state, pid);
  if (bankTrade) return bankTrade;

  return { type: 'END_TURN' };
}

// ---- 強: VP効率最大化 ----

function chooseTradeBuildStrong(state: GameState, pid: PlayerId, skipPlayerTrade = false, rng: () => number = Math.random): Action {
  const player = state.players[pid]!;

  // 0. 勝利が近いなら勝利に直結する手を最優先（建設 or バンク交易で資源補充）
  const win = victoryPush(state, pid, rng);
  if (win) return win;

  // 1. 都市（VP効率最高・重み付き生産で ore/wheat を倍化）
  const city = bestCityVertex(state, pid, rng);
  if (city) return { type: 'BUILD_CITY', vertexId: city };

  // 2. 開拓地（生産＋資源補完）
  const settl = bestSettlementVertex(state, pid, rng);
  if (settl) return { type: 'BUILD_SETTLEMENT', vertexId: settl };

  // 3. 人間への交易提案（バンク交易より優先・テンポ重視で控えめ）
  if (!skipPlayerTrade && rng() < CPU_TRADE_OFFER_CHANCE.strong) {
    const opp = findCpuTradeOpportunity(state, pid);
    if (opp) {
      const giveHand: Partial<ResourceHand> = { [opp.give]: 1 };
      const receiveHand: Partial<ResourceHand> = { [opp.receive]: 1 };
      return { type: 'OFFER_TRADE', offer: { give: giveHand, receive: receiveHand }, targetPlayerIds: [opp.humanPid] };
    }
  }

  // 4. バンク交易で都市・開拓地が建設可能になる場合
  const bankTradeStrategic = tryBankTradeStrong(state, pid);
  if (bankTradeStrategic) return bankTradeStrategic;

  // 5. 道（最良の拡張先へ向けて）
  if (player.remainingRoads > 0) {
    const road = bestRoadEdge(state, pid, rng);
    if (road) return { type: 'BUILD_ROAD', edgeId: road };
  }

  // 6. 発展カード
  if (state.devDeck.length > 0 && hasEnoughResources(player.hand, BUILD_COSTS.dev_card)) {
    return { type: 'BUY_DEV_CARD' };
  }

  // 7. 手詰まりなら手持ちの進歩カードで局面を進める（豊作/独占/街道建設）。
  const progress = chooseProgressCardAction(state, pid);
  if (progress) return progress;

  // 8. 余剰を貯め込まない: 余った資源をバンク交易で発展カード等に変換（建設可能化）
  const useSurplus = tryBankTrade(state, pid);
  if (useSurplus) return useSurplus;

  return { type: 'END_TURN' };
}

// ============================================================
// バンク交易ロジック
// ============================================================

function tryBankTrade(state: GameState, pid: PlayerId): Action | null {
  const player = state.players[pid]!;
  const costs = [BUILD_COSTS.city, BUILD_COSTS.settlement, BUILD_COSTS.dev_card];

  for (const cost of costs) {
    if (hasEnoughResources(player.hand, cost)) continue;

    for (const give of RESOURCE_TYPES) {
      for (const receive of RESOURCE_TYPES) {
        if (give === receive) continue;
        if (!canBankTrade(state, pid, give, receive)) continue;

        const rate = getEffectiveTradeRate(state, pid, give);
        const simHand = { ...player.hand };
        simHand[give] -= rate;
        simHand[receive] += 1;

        if (hasEnoughResources(simHand, cost)) {
          return { type: 'BANK_TRADE', give, receive };
        }
      }
    }
  }

  return null;
}

// 強AI用: 余剰リソース優先・都市・開拓地のみを目標とした交易
function tryBankTradeStrong(state: GameState, pid: PlayerId): Action | null {
  const player = state.players[pid]!;
  const costs = [BUILD_COSTS.city, BUILD_COSTS.settlement];

  for (const cost of costs) {
    if (hasEnoughResources(player.hand, cost)) continue;

    const surplusFirst = [...RESOURCE_TYPES].sort((a, b) => {
      return (player.hand[b] - (cost[b] ?? 0)) - (player.hand[a] - (cost[a] ?? 0));
    });

    for (const give of surplusFirst) {
      for (const receive of RESOURCE_TYPES) {
        if (give === receive) continue;
        if (!canBankTrade(state, pid, give, receive)) continue;

        const rate = getEffectiveTradeRate(state, pid, give);
        const simHand = { ...player.hand };
        simHand[give] -= rate;
        simHand[receive] += 1;

        if (hasEnoughResources(simHand, cost)) {
          return { type: 'BANK_TRADE', give, receive };
        }
      }
    }
  }

  return null;
}
