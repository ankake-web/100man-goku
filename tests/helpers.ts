// ============================================================
// tests/helpers.ts — テスト用 GameState ファクトリ
// ============================================================

import type {
  GameState, Player, PlayerId, ResourceHand,
  TileId, VertexId, EdgeId, Tile, Vertex, Edge,
} from '../src/types';
import { buildBoardGeometry } from '../src/engine/board';
import { createRandomBoard, createRng } from '../src/engine/setup';
import { BANK_INITIAL, makeHand } from '../src/constants';

export function makePlayer(id: PlayerId, partial: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    color: 'red',
    type: 'human',
    aiDifficulty: undefined,
    hand: makeHand(),
    devCards: [],
    remainingRoads: 15,
    remainingSettlements: 5,
    remainingCities: 4,
    knightsPlayed: 0,
    longestRoadLength: 0,
    hasLongestRoad: false,
    hasLargestArmy: false,
    ...partial,
  };
}

export function makeGameState(partial: Partial<GameState> = {}): GameState {
  const geo = buildBoardGeometry();
  const { tiles, harbors } = createRandomBoard(geo, createRng(42));

  const base: GameState = {
    tiles,
    vertices: geo.vertices,
    edges: geo.edges,
    harbors,
    tileToVertices: geo.tileToVertices,
    tileToEdges: geo.tileToEdges,
    players: {
      player1: makePlayer('player1'),
      player2: makePlayer('player2'),
    },
    playerOrder: ['player1', 'player2'],
    bank: { ...BANK_INITIAL },
    devDeck: [],
    devDiscardPile: [],
    phase: 'MAIN',
    turnPhase: 'TRADE_BUILD',
    currentPlayerIndex: 0,
    globalTurnNumber: 1,
    setupSubPhase: null,
    lastDiceRoll: null,
    diceRolledThisTurn: true, // テストデフォルト: ダイス済みとしてTRADE_BUILDから開始
    roadBuildingRoadsRemaining: 0,
    devCardPlayedThisTurn: false,
    longestRoadHolder: null,
    largestArmyHolder: null,
    pendingTrade: null,
    winner: null,
    discardedThisRound: [],
    log: [],
  };

  return { ...base, ...partial };
}
