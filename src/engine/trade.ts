// ============================================================
// src/engine/trade.ts — L-06: 交易エンジン
// ============================================================

import type {
  GameState, PlayerId, ResourceType, CommodityType, TradeKind, Player, TradeOffer, PlayerResponse,
} from '../types';
import { RESOURCE_TYPES, COMMODITY_TYPES, makeCommodities, TILE_RESOURCE_MAP } from '../constants';

// ============================================================
// 物産/資源の共通ヘルパ（武将と商いのバンク交易は資源∪物産を扱う）
// ============================================================

const COMMODITY_SET = new Set<TradeKind>(COMMODITY_TYPES);
/** k が物産(coin/cloth/paper)か。 */
export function isCommodity(k: TradeKind): k is CommodityType {
  return COMMODITY_SET.has(k);
}
/** プレイヤーの手持ち枚数（資源は hand、物産は commodities）。 */
function handOf(player: Player, k: TradeKind): number {
  return isCommodity(k) ? (player.commodities ?? makeCommodities())[k] : player.hand[k as ResourceType];
}
/** バンク在庫枚数（資源は bank、物産は commodityBank）。 */
function bankOf(state: GameState, k: TradeKind): number {
  return isCommodity(k) ? (state.commodityBank ?? makeCommodities())[k] : state.bank[k as ResourceType];
}

// ============================================================
// 湊交易レート計算
// ============================================================

/**
 * 指定プレイヤーの give（資源 or 物産）に対する最良交易レートを返す。
 *
 * 資源: デフォルト4:1 / 楽市3:1 / 特殊湊2:1。複数湊は最良を採用。
 * 物産: 湊は効かない。トレーディングハウス(商Lv3)で2:1、無ければ4:1。
 * 武将と商い: 商ツリーLv3以上は資源も全種2:1。
 */
export function getEffectiveTradeRate(
  state: GameState,
  playerId: PlayerId,
  give: TradeKind,
): number {
  const ck = state.expansion === 'cities_knights';
  const tradeLv3 = ck && (state.players[playerId]?.improvements?.trade ?? 0) >= 3;
  // 商船隊(merchant_fleet): このターン指定した1種を2:1で交易できる。
  const fleet2to1 = ck && state.players[playerId]?.merchantFleetType === give;

  if (isCommodity(give)) {
    // 物産は湊レートを持たない。交易所(商Lv3)=同種物産2:1、商船隊=指定物産2:1、無ければ4:1。
    return (tradeLv3 || fleet2to1) ? 2 : 4;
  }

  // 資源: 交易所(商Lv3)は資源レートに影響しない（公式: 交易所は物産のみ2:1）。
  let rate = 4;
  for (const vertex of Object.values(state.vertices)) {
    if (vertex.building?.playerId !== playerId) continue;
    const harbor = vertex.harborType;
    if (!harbor) continue;
    if (harbor === 'generic') rate = Math.min(rate, 3);
    if (harbor === give) rate = Math.min(rate, 2);
  }
  if (fleet2to1) rate = Math.min(rate, 2); // 商船隊で指定した資源は2:1
  // 御用商人(merchant)コマを置いた地形の資源は、保持者は2:1で交易できる。
  if (ck && state.merchant?.playerId === playerId) {
    const mtile = state.tiles[state.merchant.tileId];
    if (mtile && TILE_RESOURCE_MAP[mtile.type] === give) rate = Math.min(rate, 2);
  }
  return rate;
}

// ============================================================
// バンク交易・湊交易
// ============================================================

/**
 * バンク/湊交易が可能かバリデーションする。
 *
 * - 同じ種類同士の交換は不可。
 * - 非CKでは物産の give/receive は不可（後方互換・チート防止）。
 * - give を rate 枚以上保有していること。
 * - バンクに receive が 1 枚以上あること。
 */
export function canBankTrade(
  state: GameState,
  playerId: PlayerId,
  give: TradeKind,
  receive: TradeKind,
): boolean {
  if (give === receive) return false;
  const player = state.players[playerId];
  if (!player) return false;
  // 非CKモードでは物産交易を一切禁止。
  if (state.expansion !== 'cities_knights' && (isCommodity(give) || isCommodity(receive))) return false;
  if (bankOf(state, receive) < 1) return false;

  const rate = getEffectiveTradeRate(state, playerId, give);
  return handOf(player, give) >= rate;
}

/**
 * バンク/湊交易を実行して新しい GameState を返す（バリデーション済み前提）。
 * give を rate 枚それぞれのバンクへ戻し、receive を 1 枚受け取る（資源/物産の4方向に対応）。
 */
export function executeBankTrade(
  state: GameState,
  playerId: PlayerId,
  give: TradeKind,
  receive: TradeKind,
): GameState {
  const player = state.players[playerId]!;
  const rate = getEffectiveTradeRate(state, playerId, give);

  const hand = { ...player.hand };
  const commodities = { ...(player.commodities ?? makeCommodities()) };
  const bank = { ...state.bank };
  const commodityBank = { ...(state.commodityBank ?? makeCommodities()) };

  // give を rate 枚プレイヤーから引き、対応バンクへ戻す。
  if (isCommodity(give)) { commodities[give] -= rate; commodityBank[give] += rate; }
  else { hand[give] -= rate; bank[give] += rate; }
  // receive を 1 枚バンクから引き、プレイヤーへ渡す。
  if (isCommodity(receive)) { commodities[receive] += 1; commodityBank[receive] -= 1; }
  else { hand[receive] += 1; bank[receive] -= 1; }

  const playerNext: Player = state.expansion === 'cities_knights'
    ? { ...player, hand, commodities }
    : { ...player, hand };

  return {
    ...state,
    bank,
    ...(state.expansion === 'cities_knights' ? { commodityBank } : {}),
    players: { ...state.players, [playerId]: playerNext },
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

  // 成立できるのは「交易対象に含まれ、かつ ACCEPT した相手」のみ。
  // 拒否した相手・対象外の相手への一方的な成立強制（resource の強奪）を防ぐ。
  if (!trade.targetPlayerIds.includes(responderId) || trade.responses[responderId]?.status !== 'ACCEPT') {
    return { ...state, pendingTrade: { ...trade, state: 'TRADE_CANCELLED' } };
  }

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
