// ============================================================
// src/engine/trade.ts — L-06: 交易エンジン
// ============================================================

import type {
  GameState, PlayerId, ResourceType, TradeOffer, PlayerResponse,
} from '../types';
import { RESOURCE_TYPES } from '../constants';

// ============================================================
// 港交易レート計算
// ============================================================

/**
 * 指定プレイヤーの指定資源に対する最良交易レートを返す。
 *
 * - デフォルト: 4:1
 * - 汎用港 (generic): 3:1
 * - 特殊港 (2:1 harbor for resource): 2:1
 * 複数の港を保有する場合は最も有利なレートを採用する。
 */
export function getEffectiveTradeRate(
  state: GameState,
  playerId: PlayerId,
  resource: ResourceType,
): number {
  let rate = 4;

  for (const vertex of Object.values(state.vertices)) {
    if (vertex.building?.playerId !== playerId) continue;
    const harbor = vertex.harborType;
    if (!harbor) continue;
    if (harbor === 'generic') rate = Math.min(rate, 3);
    if (harbor === resource) rate = Math.min(rate, 2);
  }

  return rate;
}

// ============================================================
// バンク交易・港交易
// ============================================================

/**
 * バンク/港交易が可能かバリデーションする。
 *
 * - 同じ資源同士の交換は不可。
 * - give 資源を rate 枚以上保有していること。
 * - バンクに receive 資源が 1 枚以上あること。
 */
export function canBankTrade(
  state: GameState,
  playerId: PlayerId,
  give: ResourceType,
  receive: ResourceType,
): boolean {
  if (give === receive) return false;
  const player = state.players[playerId];
  if (!player) return false;
  if (state.bank[receive] < 1) return false;

  const rate = getEffectiveTradeRate(state, playerId, give);
  return player.hand[give] >= rate;
}

/**
 * バンク/港交易を実行して新しい GameState を返す（バリデーション済み前提）。
 * give 資源を rate 枚バンクに戻し、receive 資源を 1 枚受け取る。
 */
export function executeBankTrade(
  state: GameState,
  playerId: PlayerId,
  give: ResourceType,
  receive: ResourceType,
): GameState {
  const player = state.players[playerId]!;
  const rate = getEffectiveTradeRate(state, playerId, give);

  return {
    ...state,
    bank: {
      ...state.bank,
      [give]:    state.bank[give] + rate,
      [receive]: state.bank[receive] - 1,
    },
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: {
          ...player.hand,
          [give]:    player.hand[give] - rate,
          [receive]: player.hand[receive] + 1,
        },
      },
    },
  };
}

// ============================================================
// プレイヤー間交易
// ============================================================

/**
 * 交易オファーを発行する。
 * pendingTrade を TRADE_OFFER 状態に設定する。
 */
export function offerTrade(
  state: GameState,
  initiatorId: PlayerId,
  offer: TradeOffer,
  targetPlayerIds: PlayerId[],
): GameState {
  return {
    ...state,
    pendingTrade: {
      state: 'TRADE_OFFER',
      initiatorId,
      offer,
      targetPlayerIds,
      responses: {},
      selectedResponderId: null,
    },
  };
}

/**
 * 対象プレイヤーが交易オファーに応答する。
 * 応答は responses に追加される。全ターゲットが応答するまでは TRADE_OFFER の
 * まま（残りのCPUの応答を集め続ける）、全員応答したら TRADE_RESPONSE へ遷移する。
 */
export function respondTrade(state: GameState, response: PlayerResponse): GameState {
  if (!state.pendingTrade) return state;

  const trade = state.pendingTrade;
  const responses = { ...trade.responses, [response.playerId]: response };
  const allResponded = trade.targetPlayerIds.every(t => responses[t] != null);

  return {
    ...state,
    pendingTrade: {
      ...trade,
      state: allResponded ? 'TRADE_RESPONSE' : 'TRADE_OFFER',
      responses,
    },
  };
}

/**
 * 発起者が受諾者を選択し交易を確定・実行する。
 *
 * 実行直前に再バリデーションを行い:
 * - 失敗した場合は TRADE_CANCELLED 状態へ遷移（ペナルティなし）。
 * - 成功した場合はリソースを交換し pendingTrade を null に戻す。
 */
export function confirmTrade(state: GameState, responderId: PlayerId): GameState {
  const trade = state.pendingTrade;
  if (!trade) return state;

  const initiator = state.players[trade.initiatorId];
  const responder = state.players[responderId];
  if (!initiator || !responder) {
    return { ...state, pendingTrade: { ...trade, state: 'TRADE_CANCELLED' } };
  }

  const { give, receive } = trade.offer;

  // 再バリデーション: 送り手・受け手の手持ちを現在の GameState で確認
  const initiatorCanGive = RESOURCE_TYPES.every(r => initiator.hand[r] >= (give[r] ?? 0));
  const responderCanGive = RESOURCE_TYPES.every(r => responder.hand[r] >= (receive[r] ?? 0));

  if (!initiatorCanGive || !responderCanGive) {
    return { ...state, pendingTrade: { ...trade, state: 'TRADE_CANCELLED' } };
  }

  // リソース交換
  const newInitiatorHand = { ...initiator.hand };
  const newResponderHand = { ...responder.hand };

  for (const r of RESOURCE_TYPES) {
    newInitiatorHand[r] -= (give[r] ?? 0);
    newInitiatorHand[r] += (receive[r] ?? 0);
    newResponderHand[r] -= (receive[r] ?? 0);
    newResponderHand[r] += (give[r] ?? 0);
  }

  return {
    ...state,
    players: {
      ...state.players,
      [trade.initiatorId]: { ...initiator, hand: newInitiatorHand },
      [responderId]:       { ...responder, hand: newResponderHand },
    },
    pendingTrade: null,
  };
}

/**
 * 交易をキャンセルして pendingTrade を null に戻す。
 */
export function cancelTrade(state: GameState): GameState {
  return { ...state, pendingTrade: null };
}
