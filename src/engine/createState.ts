// ============================================================
// src/engine/createState.ts — 初期 GameState 生成（純粋関数）
// ============================================================
//
// main.ts の initGameState とサーバ（LAN対戦）の双方から使う、DOM 非依存の
// 純粋な初期状態生成。プレイヤーの実体（人間/CPU・名前・色）は呼び出し側が
// PlayerSpec で渡し、ここでは盤面生成・手番順決定・初期 state 組み立てだけを行う。

import type {
  GameState, Player, PlayerId, PlayerColor, PlayerType, AiDifficulty,
} from '../types';
import { buildBoardGeometry } from './board';
import { createRandomBoard, resolvePlayerOrder } from './setup';
import type { PlayerOrderMode } from './setup';
import { buildDevDeck } from './game';
import { makeHand, BANK_INITIAL } from '../constants';

export interface PlayerSpec {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: PlayerColor;
  readonly type: PlayerType;
  readonly aiDifficulty?: AiDifficulty;
}

/**
 * 初期 GameState を生成する純粋関数。
 *
 * @param specs     参加プレイヤー（実体）。ID 固定・手番順とは独立。
 * @param orderMode 手番順の決め方（'random' は毎回シャッフル / 'fixed' は orderSpec 採用）。
 * @param orderSpec orderMode==='fixed' のときの手番順。参加者と不整合なら元順にフォールバック。
 * @param rng       乱数生成器。省略時 Math.random（テスト/サーバで注入可能）。
 */
export function createInitialGameState(
  specs: readonly PlayerSpec[],
  orderMode: PlayerOrderMode,
  orderSpec: PlayerId[] | undefined,
  rng: () => number = Math.random,
): GameState {
  const geo = buildBoardGeometry();
  const { tiles, harbors } = createRandomBoard(geo, rng);

  const players: GameState['players'] = {};
  const allIds: PlayerId[] = [];

  for (const spec of specs) {
    const base: Player = {
      id: spec.id,
      color: spec.color,
      name: spec.name,
      type: spec.type,
      hand: makeHand(),
      devCards: [],
      remainingRoads: 15,
      remainingSettlements: 5,
      remainingCities: 4,
      knightsPlayed: 0,
      longestRoadLength: 0,
      hasLongestRoad: false,
      hasLargestArmy: false,
    };
    // exactOptionalPropertyTypes 対策: aiDifficulty は値があるときだけ付与。
    players[spec.id] = spec.aiDifficulty != null
      ? { ...base, aiDifficulty: spec.aiDifficulty }
      : base;
    allIds.push(spec.id);
  }

  const playerOrder = resolvePlayerOrder(allIds, orderMode, orderSpec, rng);

  return {
    tiles,
    vertices: geo.vertices,
    edges:    geo.edges,
    harbors,
    tileToVertices: geo.tileToVertices,
    tileToEdges:    geo.tileToEdges,
    players,
    playerOrder,
    bank: { ...BANK_INITIAL },
    devDeck:        buildDevDeck(rng),
    devDiscardPile: [],
    phase: 'SETUP_FORWARD',
    turnPhase: 'PRE_ROLL',
    currentPlayerIndex: 0,
    globalTurnNumber: 0,
    setupSubPhase: 'PLACE_SETTLEMENT',
    lastDiceRoll: null,
    diceRolledThisTurn: false,
    roadBuildingRoadsRemaining: 0,
    devCardPlayedThisTurn: false,
    longestRoadHolder: null,
    largestArmyHolder: null,
    pendingTrade: null,
    winner: null,
    discardedThisRound: [],
    log: [],
  };
}
