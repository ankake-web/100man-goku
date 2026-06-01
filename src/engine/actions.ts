// ============================================================
// src/engine/actions.ts — L-05: 建設バリデーション・実行エンジン
// ============================================================

import type {
  GameState, PlayerId, EdgeId, VertexId, ResourceHand, ResourceType,
} from '../types';
import { BUILD_COSTS, RESOURCE_TYPES } from '../constants';
import { isDistanceRuleOk, isEdgeConnected } from './board';

// ============================================================
// リソース操作ユーティリティ
// ============================================================

export function hasEnoughResources(hand: ResourceHand, cost: ResourceHand): boolean {
  return RESOURCE_TYPES.every(r => hand[r] >= cost[r]);
}

function deductCost(hand: ResourceHand, cost: ResourceHand): ResourceHand {
  const next = { ...hand };
  for (const r of RESOURCE_TYPES) next[r] -= cost[r];
  return next;
}

function returnToBank(bank: ResourceHand, cost: ResourceHand): ResourceHand {
  const next = { ...bank };
  for (const r of RESOURCE_TYPES) next[r] += cost[r];
  return next;
}

function isSetupPhase(state: GameState): boolean {
  return state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
}

// ============================================================
// 道（Road）
// ============================================================

/**
 * 指定辺に道を建設できるか検証する。
 *
 * MAIN フェーズ: 資源コスト + 残コマ + 辺未使用 + ネットワーク接続
 * SETUP フェーズ: 資源不要。残コマ + 辺未使用 + 接続
 */
export function canBuildRoad(state: GameState, playerId: PlayerId, edgeId: EdgeId): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  if (player.remainingRoads <= 0) return false;

  const edge = state.edges[edgeId];
  if (!edge) return false;
  if (edge.road != null) return false;

  // セットアップ or 街道建設カード使用中は資源コスト不要
  const freeRoad = isSetupPhase(state) || state.roadBuildingRoadsRemaining > 0;
  if (!freeRoad && !hasEnoughResources(player.hand, BUILD_COSTS.road)) return false;

  return isEdgeConnected(edge, playerId, state.vertices, state.edges);
}

/** 道を建設して新しい GameState を返す（バリデーション済み前提）。 */
export function buildRoad(state: GameState, playerId: PlayerId, edgeId: EdgeId): GameState {
  const player = state.players[playerId]!;
  const freeRoad = isSetupPhase(state) || state.roadBuildingRoadsRemaining > 0;
  const newHand = freeRoad ? player.hand : deductCost(player.hand, BUILD_COSTS.road);
  const newBank = freeRoad ? state.bank : returnToBank(state.bank, BUILD_COSTS.road);

  return {
    ...state,
    bank: newBank,
    edges: {
      ...state.edges,
      [edgeId]: { ...state.edges[edgeId]!, road: { playerId } },
    },
    players: {
      ...state.players,
      [playerId]: { ...player, hand: newHand, remainingRoads: player.remainingRoads - 1 },
    },
  };
}

// ============================================================
// 開拓地（Settlement）
// ============================================================

/**
 * 指定頂点に開拓地を建設できるか検証する。
 *
 * MAIN フェーズ: 資源コスト + 残コマ + 頂点未使用 + 距離ルール + 道への接続
 * SETUP フェーズ: 資源不要・道接続不要。残コマ + 頂点未使用 + 距離ルール
 */
export function canBuildSettlement(
  state: GameState, playerId: PlayerId, vertexId: VertexId,
): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  if (player.remainingSettlements <= 0) return false;

  const vertex = state.vertices[vertexId];
  if (!vertex) return false;
  if (vertex.building != null) return false;

  if (!isDistanceRuleOk(vertex, state.vertices)) return false;

  const setup = isSetupPhase(state);
  if (!setup && !hasEnoughResources(player.hand, BUILD_COSTS.settlement)) return false;

  // MAIN フェーズ: 自分の道への接続が必要
  if (!setup) {
    const connected = vertex.adjacentEdgeIds.some(eid => {
      const e = state.edges[eid];
      return e?.road?.playerId === playerId;
    });
    if (!connected) return false;
  }

  return true;
}

/** 開拓地を建設して新しい GameState を返す（バリデーション済み前提）。 */
export function buildSettlement(
  state: GameState, playerId: PlayerId, vertexId: VertexId,
): GameState {
  const player = state.players[playerId]!;
  const setup = isSetupPhase(state);
  const newHand = setup ? player.hand : deductCost(player.hand, BUILD_COSTS.settlement);
  const newBank = setup ? state.bank : returnToBank(state.bank, BUILD_COSTS.settlement);

  return {
    ...state,
    bank: newBank,
    vertices: {
      ...state.vertices,
      [vertexId]: {
        ...state.vertices[vertexId]!,
        building: { type: 'settlement', playerId },
      },
    },
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: newHand,
        remainingSettlements: player.remainingSettlements - 1,
      },
    },
  };
}

// ============================================================
// 都市（City）
// ============================================================

/**
 * 指定頂点を都市に昇格できるか検証する。
 * 昇格元となる自分の開拓地がその頂点に必要。
 */
export function canBuildCity(state: GameState, playerId: PlayerId, vertexId: VertexId): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  if (player.remainingCities <= 0) return false;
  if (!hasEnoughResources(player.hand, BUILD_COSTS.city)) return false;

  const vertex = state.vertices[vertexId];
  if (!vertex) return false;
  if (vertex.building?.type !== 'settlement') return false;
  if (vertex.building.playerId !== playerId) return false;

  return true;
}

/**
 * 開拓地を都市に昇格させて新しい GameState を返す（バリデーション済み前提）。
 * 都市昇格した開拓地コマは手元に戻るため remainingSettlements +1。
 */
export function buildCity(state: GameState, playerId: PlayerId, vertexId: VertexId): GameState {
  const player = state.players[playerId]!;

  return {
    ...state,
    bank: returnToBank(state.bank, BUILD_COSTS.city),
    vertices: {
      ...state.vertices,
      [vertexId]: {
        ...state.vertices[vertexId]!,
        building: { type: 'city', playerId },
      },
    },
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: deductCost(player.hand, BUILD_COSTS.city),
        remainingSettlements: player.remainingSettlements + 1, // 開拓地コマ返却
        remainingCities: player.remainingCities - 1,
      },
    },
  };
}
