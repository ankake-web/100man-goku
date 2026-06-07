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
    return chooseDiscard(state, pid);
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

function chooseDiscard(state: GameState, pid: PlayerId): Action | null {
  const player = state.players[pid];
  if (!player) return null;

  const total = RESOURCE_TYPES.reduce((s, r) => s + player.hand[r], 0);
  if (total < 8) return null;

  const target = Math.floor(total / 2);
  const discardOrder: ResourceType[] = ['wood', 'brick', 'wool', 'grain', 'ore'];
  const resources: Partial<Record<ResourceType, number>> = {};
  let remaining = target;

  for (const r of discardOrder) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, player.hand[r]);
    if (amount > 0) {
      resources[r] = amount;
      remaining -= amount;
    }
  }

  return { type: 'DISCARD_RESOURCES', playerId: pid, resources };
}

// ============================================================
// ROBBER フェーズ
// ============================================================

function chooseRobberAction(state: GameState, pid: PlayerId, rng: () => number): Action {
  const difficulty = getDifficulty(state, pid);
  const currentRobberTileId = Object.values(state.tiles).find(t => t.hasRobber)?.id;

  // 移動候補: 現在地以外の非砂漠タイル
  const candidates = Object.keys(state.tiles).filter(
    tid => tid !== currentRobberTileId && state.tiles[tid]?.type !== 'desert',
  );

  if (difficulty === 'weak') {
    // 弱: 候補からランダム。候補がなければ現在地以外の任意タイル。
    const tileId = candidates.length > 0
      ? candidates[Math.floor(rng() * candidates.length)]!
      : fallbackTileId(state, currentRobberTileId);
    return { type: 'MOVE_ROBBER', tileId, stealFromPlayerId: null };
  }

  // 普通・強: スコア最大タイルを選び、手札最多の相手から盗む
  let bestTileId = '';
  let bestScore = -1;
  let bestOpponent: PlayerId | null = null;

  for (const [tileId, tile] of Object.entries(state.tiles)) {
    if (tileId === currentRobberTileId) continue;
    if (tile.type === 'desert') continue;

    const prob = tile.number ? (NUMBER_PROB[tile.number] ?? 0) : 0;
    const vertexIds = state.tileToVertices[tileId] ?? [];
    const opponents = [...new Set(
      vertexIds
        .map(vid => state.vertices[vid]?.building?.playerId)
        .filter((p): p is PlayerId => p != null && p !== pid),
    )];

    const opponentMultiplier = difficulty === 'strong' ? 3 : 2;
    const score = prob * (opponents.length > 0 ? opponentMultiplier : 1);

    if (score > bestScore) {
      bestScore = score;
      bestTileId = tileId;
      bestOpponent = opponents.reduce<PlayerId | null>((best, opp) => {
        const oppTotal = playerHandTotal(state, opp);
        const bestTotal = best != null ? playerHandTotal(state, best) : -1;
        return oppTotal > bestTotal ? opp : best;
      }, null);
    }
  }

  if (!bestTileId) {
    bestTileId = candidates[0] ?? fallbackTileId(state, currentRobberTileId);
  }

  return { type: 'MOVE_ROBBER', tileId: bestTileId, stealFromPlayerId: bestOpponent };
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
function victoryPush(state: GameState, pid: PlayerId): Action | null {
  if (calcVP(state, pid) < VP_TABLE.target - 1) return null;
  const player = state.players[pid]!;

  const cityVerts = Object.keys(state.vertices).filter(v => canBuildCity(state, pid, v));
  if (cityVerts.length > 0) {
    const best = cityVerts.reduce((a, b) => vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b);
    return { type: 'BUILD_CITY', vertexId: best };
  }
  const settlVerts = Object.keys(state.vertices).filter(v => canBuildSettlement(state, pid, v));
  if (settlVerts.length > 0) {
    const best = settlVerts.reduce((a, b) => vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b);
    return { type: 'BUILD_SETTLEMENT', vertexId: best };
  }
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

function chooseTradeBuildNormal(state: GameState, pid: PlayerId, skipPlayerTrade = false, rng: () => number = Math.random): Action {
  const player = state.players[pid]!;

  // 勝利が近いなら勝利に直結する手を最優先
  const win = victoryPush(state, pid);
  if (win) return win;

  const cityVerts = Object.keys(state.vertices).filter(vid => canBuildCity(state, pid, vid));
  if (cityVerts.length > 0) {
    const best = cityVerts.reduce((a, b) =>
      vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b,
    );
    return { type: 'BUILD_CITY', vertexId: best };
  }

  const settlVerts = Object.keys(state.vertices).filter(vid => canBuildSettlement(state, pid, vid));
  if (settlVerts.length > 0) {
    const best = settlVerts.reduce((a, b) =>
      vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b,
    );
    return { type: 'BUILD_SETTLEMENT', vertexId: best };
  }

  if (state.devDeck.length > 0 && hasEnoughResources(player.hand, BUILD_COSTS.dev_card)) {
    return { type: 'BUY_DEV_CARD' };
  }

  if (player.remainingRoads > 0) {
    const roadEdges = Object.keys(state.edges).filter(eid => canBuildRoad(state, pid, eid));
    if (roadEdges.length > 0) {
      return { type: 'BUILD_ROAD', edgeId: roadEdges[0]! };
    }
  }

  // 建設で手詰まりのとき、手持ちの進歩カードで局面を進める（豊作/独占/街道建設）。
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
  const win = victoryPush(state, pid);
  if (win) return win;

  // 1. 都市（VP効率最高）
  const cityVerts = Object.keys(state.vertices).filter(vid => canBuildCity(state, pid, vid));
  if (cityVerts.length > 0) {
    const best = cityVerts.reduce((a, b) =>
      vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b,
    );
    return { type: 'BUILD_CITY', vertexId: best };
  }

  // 2. 開拓地
  const settlVerts = Object.keys(state.vertices).filter(vid => canBuildSettlement(state, pid, vid));
  if (settlVerts.length > 0) {
    const best = settlVerts.reduce((a, b) =>
      vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b,
    );
    return { type: 'BUILD_SETTLEMENT', vertexId: best };
  }

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

  // 5. 道
  if (player.remainingRoads > 0) {
    const roadEdges = Object.keys(state.edges).filter(eid => canBuildRoad(state, pid, eid));
    if (roadEdges.length > 0) {
      return { type: 'BUILD_ROAD', edgeId: roadEdges[0]! };
    }
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
