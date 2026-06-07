// ============================================================
// src/engine/game.ts — L-09: applyAction 統合エンジン
// ============================================================

import type {
  GameState, Action, PlayerId, ResourceType, DevCard, VertexId, ResourceHand,
} from '../types';
import { RESOURCE_TYPES, BUILD_COSTS, DEV_CARD_COUNTS, TILE_RESOURCE_MAP, VP_TABLE } from '../constants';
import { rollDice, distributeResources } from './dice';
import {
  canBuildRoad, buildRoad,
  canBuildSettlement, buildSettlement,
  canBuildCity, buildCity,
  hasEnoughResources,
} from './actions';
import { moveRobber, discardResources, stealResource, getRobbablePlayerIds, discardCount } from './robber';
import { executeBankTrade, canBankTrade, offerTrade, respondTrade, confirmTrade, cancelTrade } from './trade';
import { updateLongestRoad, updateLargestArmy, checkVictory, calcVP } from './scoring';

// ============================================================
// 内部ユーティリティ
// ============================================================

function currentPlayer(state: GameState): PlayerId {
  return state.playerOrder[state.currentPlayerIndex]!;
}

/**
 * 初期配置2軒目で配る資源を、配置頂点に隣接するタイルから導出する純粋関数。
 * 付与（applyAction の BUILD_SETTLEMENT）と資源アニメ（renderer 側）の双方が
 * これを共有し、ロジックのドリフト（アニメだけズレる）を防ぐ。
 *
 * - 隣接タイルは tileToVertices の列挙順で走査（付与と同じ順序＝アニメ順も一致）。
 * - 砂漠（resource なし）は除外。
 * - bank 在庫が0の資源は除外。同一資源の隣接が複数あれば在庫が尽きた分から除外。
 * 返り値は獲得した資源の順序付き配列（同じ資源が複数回入りうる）。
 *
 * 注意: bank 在庫の判定は「付与“時点”の bank」でのみ正しい。初期配置ではバンク枯渇は
 *       起きない前提なので、アニメ側が付与“後”の bank（=現在値）を渡しても実害はない。
 *       バンクが絡む他フェーズには流用しないこと（在庫差で結果がズレる）。
 */
export function setupGainFor(state: GameState, vertexId: VertexId, bank: ResourceHand): ResourceType[] {
  const gains: ResourceType[] = [];
  const remaining = { ...bank };
  const tileIds = Object.entries(state.tileToVertices)
    .filter(([, vids]) => vids.includes(vertexId))
    .map(([tid]) => tid);
  for (const tid of tileIds) {
    const tile = state.tiles[tid];
    if (!tile || tile.type === 'desert') continue;
    const r = TILE_RESOURCE_MAP[tile.type];
    if (!r || remaining[r] < 1) continue;
    remaining[r] -= 1;
    gains.push(r);
  }
  return gains;
}

/** 発展カードデッキをシャッフル生成（ゲーム開始時用） */
export function buildDevDeck(rng: () => number = Math.random): DevCard[] {
  const deck: DevCard[] = [];
  let id = 0;
  for (const [type, count] of Object.entries(DEV_CARD_COUNTS) as [DevCard['type'], number][]) {
    for (let i = 0; i < count; i++) {
      deck.push({ id: `dev_${id++}`, type, purchasedOnTurn: -1 });
    }
  }
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

// ============================================================
// applyAction — メインエントリポイント
// ============================================================

/**
 * アクションを GameState に適用して新しい GameState を返す純粋関数。
 * バリデーション失敗時は例外を投げる（呼び出し側で can* チェック済み前提）。
 *
 * @param rng テスト用に注入可能な乱数生成器
 */
export function applyAction(
  state: GameState,
  action: Action,
  rng: () => number = Math.random,
): GameState {
  if (state.phase === 'GAME_OVER') throw new Error(`applyAction: game is already over (action=${action.type})`);

  const pid = currentPlayer(state);

  switch (action.type) {

    // ----------------------------------------------------------
    // ROLL_DICE
    // ----------------------------------------------------------
    case 'ROLL_DICE': {
      if (state.phase !== 'MAIN') throw new Error('ROLL_DICE: not MAIN phase');
      if (state.turnPhase !== 'PRE_ROLL') throw new Error('ROLL_DICE: not PRE_ROLL');

      const [d1, d2] = rollDice(rng);
      const total = d1 + d2;

      let next: GameState = { ...state, lastDiceRoll: [d1, d2], diceRolledThisTurn: true };

      if (total === 7) {
        const needsDiscard = state.playerOrder.some(p => {
          const h = state.players[p]!.hand;
          return RESOURCE_TYPES.reduce((s, r) => s + h[r], 0) >= 8;
        });
        next = { ...next, discardedThisRound: [], turnPhase: needsDiscard ? 'DISCARD' : 'ROBBER' };
      } else {
        next = distributeResources({ ...next, turnPhase: 'TRADE_BUILD' }, total);
        next = { ...next, turnPhase: 'TRADE_BUILD' };
      }

      return next;
    }

    // ----------------------------------------------------------
    // DISCARD_RESOURCES
    // ----------------------------------------------------------
    case 'DISCARD_RESOURCES': {
      if (state.turnPhase !== 'DISCARD') throw new Error('DISCARD_RESOURCES: not in DISCARD phase');
      const { playerId, resources } = action;
      const discarder = state.players[playerId];
      if (!discarder) throw new Error('DISCARD_RESOURCES: unknown player');
      // 二重捨て防止: 既に今回の7で捨てたプレイヤーは再度捨てさせない
      // （捨てた結果ちょうど8枚残ってもUI等から再要求されうるため、エンジンで弾く）。
      if ((state.discardedThisRound ?? []).includes(playerId))
        throw new Error('DISCARD_RESOURCES: already discarded this round');
      // 捨て札は「ちょうど floor(手札/2) 枚・所持範囲内」をエンジンが一元的に検証する
      // （UI/AI/サーバの各所に散っていたルールの正本を discardCount に集約）。
      const required = discardCount(state, playerId);
      const res = resources as Partial<Record<ResourceType, number>>;
      const discardSum = RESOURCE_TYPES.reduce((s, r) => s + (res[r] ?? 0), 0);
      const withinHand = RESOURCE_TYPES.every(r => (res[r] ?? 0) >= 0 && (res[r] ?? 0) <= discarder.hand[r]);
      if (required === 0 || discardSum !== required || !withinHand)
        throw new Error('DISCARD_RESOURCES: must discard exactly floor(hand/2) cards you own');

      let next = discardResources(state, playerId, res);

      // 今回の7でそのプレイヤーが捨てたことを記録
      const discardedThisRound = [...(next.discardedThisRound ?? []), playerId];
      next = { ...next, discardedThisRound };

      // 既に捨てたプレイヤーを除いて、まだ捨てが必要なプレイヤーがいるか確認
      const stillNeeds = next.playerOrder.some(p => {
        if (discardedThisRound.includes(p)) return false; // 既に捨て済み
        const h = next.players[p]!.hand;
        return RESOURCE_TYPES.reduce((s, r) => s + h[r], 0) >= 8;
      });
      if (!stillNeeds) next = { ...next, turnPhase: 'ROBBER', discardedThisRound: [] };

      return next;
    }

    // ----------------------------------------------------------
    // MOVE_ROBBER
    // ----------------------------------------------------------
    case 'MOVE_ROBBER': {
      // 強盗を動かせるのは ROBBER フェーズ（7 を出した後／騎士カード使用後）のみ。
      // これが無いと PRE_ROLL 中に無料で（しかも繰り返し）盗賊移動＋強奪ができてしまう。
      if (state.turnPhase !== 'ROBBER') throw new Error('MOVE_ROBBER: not in ROBBER phase');
      const { tileId, stealFromPlayerId } = action;

      // 強盗は必ず現在地とは別ヘクスへ移動する（標準ルール）。
      const currentRobberTileId = Object.keys(state.tiles).find(tid => state.tiles[tid]!.hasRobber);
      if (currentRobberTileId === tileId) throw new Error('MOVE_ROBBER: must move to a different tile');

      let next = moveRobber(state, tileId);

      if (stealFromPlayerId != null) {
        // 盗む相手は「移動先タイルに隣接する建物を持つ相手」に限る（盤面と無関係な強奪を防ぐ）。
        if (!getRobbablePlayerIds(next, tileId, pid).includes(stealFromPlayerId))
          throw new Error('MOVE_ROBBER: steal target is not adjacent to the robber tile');
        next = stealResource(next, pid, stealFromPlayerId, rng);
      }

      // 騎士カードをダイス前に使った場合はPRE_ROLLへ戻る（ダイスをまだ振っていない）
      const nextPhase = state.diceRolledThisTurn ? 'TRADE_BUILD' : 'PRE_ROLL';
      return { ...next, turnPhase: nextPhase };
    }

    // ----------------------------------------------------------
    // BUILD_ROAD
    // ----------------------------------------------------------
    case 'BUILD_ROAD': {
      const { edgeId } = action;
      const _isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
      const _isRoadBuilding = state.roadBuildingRoadsRemaining > 0;
      if (!_isSetup && !_isRoadBuilding && state.turnPhase !== 'TRADE_BUILD')
        throw new Error('BUILD_ROAD: must be in TRADE_BUILD, setup, or road building phase');
      if (!canBuildRoad(state, pid, edgeId)) throw new Error('BUILD_ROAD: invalid');

      let next = buildRoad(state, pid, edgeId);
      next = updateLongestRoad(next);
      next = checkVictory(next, pid);

      // 街道建設カード使用中: 残り配置数をデクリメント
      if (next.roadBuildingRoadsRemaining > 0) {
        next = { ...next, roadBuildingRoadsRemaining: next.roadBuildingRoadsRemaining - 1 };
      }

      // SETUP フェーズのサブフェーズ進行（道を置いたので anchor は解除）
      if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
        next = advanceSetup({ ...next, setupRoadAnchor: null });
      }

      return next;
    }

    // ----------------------------------------------------------
    // BUILD_SETTLEMENT
    // ----------------------------------------------------------
    case 'BUILD_SETTLEMENT': {
      const { vertexId } = action;
      const _isSetupS = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
      if (!_isSetupS && state.turnPhase !== 'TRADE_BUILD')
        throw new Error('BUILD_SETTLEMENT: must be in TRADE_BUILD or setup phase');
      if (!canBuildSettlement(state, pid, vertexId)) throw new Error('BUILD_SETTLEMENT: invalid');

      let next = buildSettlement(state, pid, vertexId);

      // SETUP 後半: 2個目開拓地の隣接タイルから初期資源を配布。
      // 導出は setupGainFor に一本化（資源アニメと同じロジック）。bank は付与“時点”の値を渡す。
      if (state.phase === 'SETUP_BACKWARD' && state.setupSubPhase === 'PLACE_SETTLEMENT') {
        for (const resource of setupGainFor(next, vertexId, next.bank)) {
          next = {
            ...next,
            bank: { ...next.bank, [resource]: next.bank[resource] - 1 },
            players: {
              ...next.players,
              [pid]: {
                ...next.players[pid]!,
                hand: { ...next.players[pid]!.hand, [resource]: next.players[pid]!.hand[resource] + 1 },
              },
            },
          };
        }
      }

      next = checkVictory(next, pid);

      if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
        // 直後の道はこの開拓地に接続する必要がある（標準ルール）
        next = { ...next, setupSubPhase: 'PLACE_ROAD', setupRoadAnchor: vertexId };
      }

      return next;
    }

    // ----------------------------------------------------------
    // BUILD_CITY
    // ----------------------------------------------------------
    case 'BUILD_CITY': {
      const { vertexId } = action;
      if (state.phase !== 'MAIN' || state.turnPhase !== 'TRADE_BUILD')
        throw new Error('BUILD_CITY: must be in MAIN TRADE_BUILD phase');
      if (!canBuildCity(state, pid, vertexId)) throw new Error('BUILD_CITY: invalid');

      let next = buildCity(state, pid, vertexId);
      next = checkVictory(next, pid);
      return next;
    }

    // ----------------------------------------------------------
    // BUY_DEV_CARD
    // ----------------------------------------------------------
    case 'BUY_DEV_CARD': {
      if (state.phase !== 'MAIN' || state.turnPhase !== 'TRADE_BUILD')
        throw new Error('BUY_DEV_CARD: must be in MAIN TRADE_BUILD phase');
      const player = state.players[pid]!;
      if (!hasEnoughResources(player.hand, BUILD_COSTS.dev_card)) {
        throw new Error('BUY_DEV_CARD: insufficient resources');
      }
      if (state.devDeck.length === 0) throw new Error('BUY_DEV_CARD: deck empty');

      const [drawn, ...remaining] = state.devDeck;
      const card: DevCard = { ...drawn!, purchasedOnTurn: state.globalTurnNumber };

      let next: GameState = {
        ...state,
        devDeck: remaining,
        bank: {
          ...state.bank,
          wool:  state.bank.wool  + BUILD_COSTS.dev_card.wool,
          grain: state.bank.grain + BUILD_COSTS.dev_card.grain,
          ore:   state.bank.ore   + BUILD_COSTS.dev_card.ore,
        },
        players: {
          ...state.players,
          [pid]: {
            ...player,
            hand: {
              ...player.hand,
              wool:  player.hand.wool  - BUILD_COSTS.dev_card.wool,
              grain: player.hand.grain - BUILD_COSTS.dev_card.grain,
              ore:   player.hand.ore   - BUILD_COSTS.dev_card.ore,
            },
            devCards: [...player.devCards, card],
          },
        },
      };

      next = checkVictory(next, pid);
      return next;
    }

    // ----------------------------------------------------------
    // PLAY_KNIGHT
    // ----------------------------------------------------------
    case 'PLAY_KNIGHT': {
      if (state.devCardPlayedThisTurn) throw new Error('PLAY_KNIGHT: already played a dev card this turn');
      const player = state.players[pid]!;
      const cardIdx = player.devCards.findIndex(
        c => c.type === 'knight' && c.purchasedOnTurn < state.globalTurnNumber,
      );
      if (cardIdx === -1) throw new Error('PLAY_KNIGHT: no playable knight card');

      const newCards = player.devCards.filter((_, i) => i !== cardIdx);
      const usedCard = player.devCards[cardIdx]!;

      let next: GameState = {
        ...state,
        devCardPlayedThisTurn: true,
        devDiscardPile: [...state.devDiscardPile, usedCard],
        players: {
          ...state.players,
          [pid]: {
            ...player,
            devCards: newCards,
            knightsPlayed: player.knightsPlayed + 1,
          },
        },
        turnPhase: 'ROBBER',
      };

      next = updateLargestArmy(next);
      next = checkVictory(next, pid);
      return next;
    }

    // ----------------------------------------------------------
    // PLAY_YEAR_OF_PLENTY
    // ----------------------------------------------------------
    case 'PLAY_YEAR_OF_PLENTY': {
      if (state.devCardPlayedThisTurn) throw new Error('PLAY_YEAR_OF_PLENTY: already played a dev card this turn');
      // 騎士以外はダイス後（交易・建設フェーズ）のみ使用可
      if (!state.diceRolledThisTurn) throw new Error('PLAY_YEAR_OF_PLENTY: must roll dice first');
      const player = state.players[pid]!;
      const [r1, r2] = action.resources;
      const cardIdx = player.devCards.findIndex(
        c => c.type === 'year_of_plenty' && c.purchasedOnTurn < state.globalTurnNumber,
      );
      if (cardIdx === -1) throw new Error('PLAY_YEAR_OF_PLENTY: no playable card');

      const newCards = player.devCards.filter((_, i) => i !== cardIdx);
      const usedCard = player.devCards[cardIdx]!;

      const gained: Partial<Record<ResourceType, number>> = {};
      gained[r1] = (gained[r1] ?? 0) + 1;
      gained[r2] = (gained[r2] ?? 0) + 1;

      const newHand = { ...player.hand };
      const newBank = { ...state.bank };
      for (const [r, amt] of Object.entries(gained) as [ResourceType, number][]) {
        const actual = Math.min(amt, newBank[r]);
        newHand[r] += actual;
        newBank[r] -= actual;
      }

      return {
        ...state,
        devCardPlayedThisTurn: true,
        bank: newBank,
        devDiscardPile: [...state.devDiscardPile, usedCard],
        players: {
          ...state.players,
          [pid]: { ...player, hand: newHand, devCards: newCards },
        },
      };
    }

    // ----------------------------------------------------------
    // PLAY_MONOPOLY
    // ----------------------------------------------------------
    case 'PLAY_MONOPOLY': {
      if (state.devCardPlayedThisTurn) throw new Error('PLAY_MONOPOLY: already played a dev card this turn');
      if (!state.diceRolledThisTurn) throw new Error('PLAY_MONOPOLY: must roll dice first');
      const player = state.players[pid]!;
      const { resource } = action;
      const cardIdx = player.devCards.findIndex(
        c => c.type === 'monopoly' && c.purchasedOnTurn < state.globalTurnNumber,
      );
      if (cardIdx === -1) throw new Error('PLAY_MONOPOLY: no playable card');

      const newCards = player.devCards.filter((_, i) => i !== cardIdx);
      const usedCard = player.devCards[cardIdx]!;

      let totalStolen = 0;
      const newPlayers = { ...state.players };

      for (const otherPid of state.playerOrder) {
        if (otherPid === pid) continue;
        const other = newPlayers[otherPid]!;
        const amt = other.hand[resource];
        if (amt === 0) continue;
        totalStolen += amt;
        newPlayers[otherPid] = { ...other, hand: { ...other.hand, [resource]: 0 } };
      }

      newPlayers[pid] = {
        ...player,
        devCards: newCards,
        hand: { ...player.hand, [resource]: player.hand[resource] + totalStolen },
      };

      return {
        ...state,
        devCardPlayedThisTurn: true,
        devDiscardPile: [...state.devDiscardPile, usedCard],
        players: newPlayers,
      };
    }

    // ----------------------------------------------------------
    // PLAY_ROAD_BUILDING
    // ----------------------------------------------------------
    case 'PLAY_ROAD_BUILDING': {
      if (state.devCardPlayedThisTurn) throw new Error('PLAY_ROAD_BUILDING: already played a dev card this turn');
      if (!state.diceRolledThisTurn) throw new Error('PLAY_ROAD_BUILDING: must roll dice first');
      const player = state.players[pid]!;
      const cardIdx = player.devCards.findIndex(
        c => c.type === 'road_building' && c.purchasedOnTurn < state.globalTurnNumber,
      );
      if (cardIdx === -1) throw new Error('PLAY_ROAD_BUILDING: no playable card');

      const newCards = player.devCards.filter((_, i) => i !== cardIdx);
      const usedCard = player.devCards[cardIdx]!;

      const roadsAvailable = Math.min(2, player.remainingRoads);
      return {
        ...state,
        devCardPlayedThisTurn: true,
        roadBuildingRoadsRemaining: roadsAvailable,
        devDiscardPile: [...state.devDiscardPile, usedCard],
        players: {
          ...state.players,
          [pid]: { ...player, devCards: newCards },
        },
      };
    }

    // ----------------------------------------------------------
    // FINISH_ROAD_BUILDING
    // ----------------------------------------------------------
    case 'FINISH_ROAD_BUILDING': {
      if (state.roadBuildingRoadsRemaining === 0) throw new Error('FINISH_ROAD_BUILDING: no road building in progress');
      return { ...state, roadBuildingRoadsRemaining: 0 };
    }

    // ----------------------------------------------------------
    // BANK_TRADE
    // ----------------------------------------------------------
    case 'BANK_TRADE': {
      const { give, receive } = action;
      if (!canBankTrade(state, pid, give, receive)) throw new Error('BANK_TRADE: invalid');
      return executeBankTrade(state, pid, give, receive);
    }

    // ----------------------------------------------------------
    // OFFER_TRADE
    // ----------------------------------------------------------
    case 'OFFER_TRADE': {
      if (state.phase !== 'MAIN' || state.turnPhase !== 'TRADE_BUILD')
        throw new Error('OFFER_TRADE: must be in TRADE_BUILD phase');
      if (state.roadBuildingRoadsRemaining > 0)
        throw new Error('OFFER_TRADE: cannot trade during road building');
      const giveTotal = RESOURCE_TYPES.reduce((s, r) => s + (action.offer.give[r] ?? 0), 0);
      const recvTotal = RESOURCE_TYPES.reduce((s, r) => s + (action.offer.receive[r] ?? 0), 0);
      if (giveTotal === 0 || recvTotal === 0)
        throw new Error('OFFER_TRADE: both sides must offer at least 1 resource');
      // 同一資源を渡しつつ受け取る交換は無意味なので禁止（give と receive の品目が重複しない）
      if (RESOURCE_TYPES.some(r => (action.offer.give[r] ?? 0) > 0 && (action.offer.receive[r] ?? 0) > 0))
        throw new Error('OFFER_TRADE: cannot give and receive the same resource');
      if (action.targetPlayerIds.length === 0)
        throw new Error('OFFER_TRADE: targetPlayerIds must not be empty');
      if (action.targetPlayerIds.includes(pid))
        throw new Error('OFFER_TRADE: cannot trade with yourself');
      for (const tid of action.targetPlayerIds) {
        if (!state.players[tid])
          throw new Error(`OFFER_TRADE: player ${tid} does not exist`);
      }
      const initiator = state.players[pid]!;
      const hasEnoughGive = RESOURCE_TYPES.every(r => initiator.hand[r] >= (action.offer.give[r] ?? 0));
      if (!hasEnoughGive)
        throw new Error('OFFER_TRADE: initiator does not have enough resources to give');
      return offerTrade(state, pid, action.offer, action.targetPlayerIds);
    }

    // ----------------------------------------------------------
    // RESPOND_TRADE
    // ----------------------------------------------------------
    case 'RESPOND_TRADE': {
      return respondTrade(state, action.response);
    }

    // ----------------------------------------------------------
    // CONFIRM_TRADE
    // ----------------------------------------------------------
    case 'CONFIRM_TRADE': {
      return confirmTrade(state, action.responderId);
    }

    // ----------------------------------------------------------
    // CANCEL_TRADE
    // ----------------------------------------------------------
    case 'CANCEL_TRADE': {
      return cancelTrade(state);
    }

    // ----------------------------------------------------------
    // END_TURN
    // ----------------------------------------------------------
    case 'END_TURN': {
      // ターン終了は MAIN の TRADE_BUILD（ダイスを振り、強盗/捨て札を解決済み）でのみ。
      // これが無いと PRE_ROLL でダイスを飛ばしたり、SETUP/7処理中に勝手に手番を進められる。
      if (state.phase !== 'MAIN' || state.turnPhase !== 'TRADE_BUILD')
        throw new Error('END_TURN: must be in MAIN TRADE_BUILD phase');
      const nextIndex = (state.currentPlayerIndex + 1) % state.playerOrder.length;
      return {
        ...state,
        currentPlayerIndex: nextIndex,
        globalTurnNumber: state.globalTurnNumber + 1,
        turnPhase: 'PRE_ROLL',
        lastDiceRoll: null,
        diceRolledThisTurn: false,
        roadBuildingRoadsRemaining: 0,
        devCardPlayedThisTurn: false,
        pendingTrade: null,
      };
    }

    // ----------------------------------------------------------
    // DECLARE_VICTORY
    // ----------------------------------------------------------
    case 'DECLARE_VICTORY': {
      if (state.phase !== 'MAIN' || state.turnPhase !== 'TRADE_BUILD')
        throw new Error('DECLARE_VICTORY: must be in MAIN TRADE_BUILD phase');
      if (calcVP(state, pid) < VP_TABLE.target) throw new Error('DECLARE_VICTORY: insufficient VP');
      return { ...state, winner: pid, phase: 'GAME_OVER' };
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ============================================================
// セットアップ進行ヘルパー
// ============================================================

/**
 * SETUP フェーズの道設置後に次の手番・フェーズへ進める。
 *
 * SETUP_FORWARD: 0,1,2,3 順（4人の場合）
 * SETUP_BACKWARD: 3,2,1,0 逆順
 * 後半最後のプレイヤーが道を置いたら MAIN へ移行。
 */
function advanceSetup(state: GameState): GameState {
  const total = state.playerOrder.length;
  const idx = state.currentPlayerIndex;

  if (state.phase === 'SETUP_FORWARD') {
    if (idx < total - 1) {
      // 次のプレイヤーへ
      return {
        ...state,
        currentPlayerIndex: idx + 1,
        setupSubPhase: 'PLACE_SETTLEMENT',
      };
    } else {
      // 後半開始: 最後のプレイヤーが前半を終えたらそのまま後半へ（同プレイヤーが続ける）
      return {
        ...state,
        phase: 'SETUP_BACKWARD',
        setupSubPhase: 'PLACE_SETTLEMENT',
      };
    }
  }

  if (state.phase === 'SETUP_BACKWARD') {
    if (idx > 0) {
      return {
        ...state,
        currentPlayerIndex: idx - 1,
        setupSubPhase: 'PLACE_SETTLEMENT',
      };
    } else {
      // 全員配置完了 → MAIN フェーズへ
      return {
        ...state,
        phase: 'MAIN',
        turnPhase: 'PRE_ROLL',
        currentPlayerIndex: 0,
        setupSubPhase: null,
        diceRolledThisTurn: false,
        devCardPlayedThisTurn: false,
      };
    }
  }

  return state;
}
