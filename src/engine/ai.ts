// ============================================================
// src/engine/ai.ts — AIプレイヤー（難易度対応）
// ============================================================

import type { GameState, Action, PlayerId, ResourceType, AiDifficulty, ResourceHand } from '../types';
import { RESOURCE_TYPES, BUILD_COSTS } from '../constants';
import { canBuildRoad, canBuildSettlement, canBuildCity, hasEnoughResources } from './actions';
import { canBankTrade, getEffectiveTradeRate } from './trade';

// ============================================================
// 確率テーブル（数字トークンの出目確率 /36）
// ============================================================

const NUMBER_PROB: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
  8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

// ============================================================
// ユーティリティ
// ============================================================

function vertexProductionScore(state: GameState, vertexId: string): number {
  return (state.vertices[vertexId]?.adjacentTileIds ?? []).reduce((sum, tid) => {
    const n = state.tiles[tid]?.number;
    return sum + (n ? (NUMBER_PROB[n] ?? 0) : 0);
  }, 0);
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
}

export function chooseAction(state: GameState, pid: PlayerId, opts?: AiOpts): Action | null {
  if (state.phase === 'GAME_OVER') return null;

  if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
    if (state.playerOrder[state.currentPlayerIndex] !== pid) return null;
    return chooseSetupAction(state, pid);
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
    case 'ROBBER':      return chooseRobberAction(state, pid);
    case 'TRADE_BUILD': return chooseTradeBuildAction(state, pid, opts?.skipPlayerTrade ?? false);
    default:            return null;
  }
}

// ============================================================
// セットアップフェーズ
// ============================================================

function chooseSetupAction(state: GameState, pid: PlayerId): Action | null {
  const difficulty = getDifficulty(state, pid);

  if (state.setupSubPhase === 'PLACE_SETTLEMENT') {
    const valid = Object.keys(state.vertices).filter(vid =>
      canBuildSettlement(state, pid, vid),
    );
    if (valid.length === 0) return null;

    const chosen = difficulty === 'weak'
      ? valid[Math.floor(Math.random() * valid.length)]!
      : valid.reduce((a, b) =>
          vertexProductionScore(state, a) >= vertexProductionScore(state, b) ? a : b,
        );
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
        ? valid[Math.floor(Math.random() * valid.length)]!
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

  if (difficulty !== 'weak') {
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

function chooseRobberAction(state: GameState, pid: PlayerId): Action {
  const difficulty = getDifficulty(state, pid);
  const currentRobberTileId = Object.values(state.tiles).find(t => t.hasRobber)?.id;

  // 移動候補: 現在地以外の非砂漠タイル
  const candidates = Object.keys(state.tiles).filter(
    tid => tid !== currentRobberTileId && state.tiles[tid]?.type !== 'desert',
  );

  if (difficulty === 'weak') {
    // 弱: 候補からランダム。候補がなければ現在地以外の任意タイル。
    const tileId = candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)]!
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

function chooseTradeBuildAction(state: GameState, pid: PlayerId, skipPlayerTrade = false): Action {
  // 街道建設カード使用中: 無料道を置く（置けなければ効果完了）
  if (state.roadBuildingRoadsRemaining > 0) {
    const roadEdge = Object.keys(state.edges).find(eid => canBuildRoad(state, pid, eid));
    if (roadEdge) return { type: 'BUILD_ROAD', edgeId: roadEdge };
    return { type: 'FINISH_ROAD_BUILDING' };
  }

  const difficulty = getDifficulty(state, pid);
  if (difficulty === 'weak') return chooseTradeBuildWeak(state, pid);
  if (difficulty === 'strong') return chooseTradeBuildStrong(state, pid, skipPlayerTrade);
  return chooseTradeBuildNormal(state, pid, skipPlayerTrade);
}

// ---- 弱: 可能なアクションからランダム ----

function chooseTradeBuildWeak(state: GameState, pid: PlayerId): Action {
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
    return possible[Math.floor(Math.random() * possible.length)]!;
  }

  // 資源不足で建設不可の場合: バンク交易を試みる（ゲームの収束を保証）
  const bankTrade = tryBankTrade(state, pid);
  if (bankTrade) return bankTrade;

  return { type: 'END_TURN' };
}

// ---- 普通: 優先度に従って確実な選択 ----

function chooseTradeBuildNormal(state: GameState, pid: PlayerId, skipPlayerTrade = false): Action {
  const player = state.players[pid]!;

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

  // バンク交易より先に人間への交易提案を試みる
  if (!skipPlayerTrade && Math.random() < 0.45) {
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

function chooseTradeBuildStrong(state: GameState, pid: PlayerId, skipPlayerTrade = false): Action {
  const player = state.players[pid]!;

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

  // 3. 人間への交易提案（バンク交易より優先）
  if (!skipPlayerTrade && Math.random() < 0.5) {
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
