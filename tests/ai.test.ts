// ============================================================
// tests/ai.test.ts — AIプレイヤー テスト（難易度対応）
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chooseAction } from '../src/engine/ai';
import { applyAction } from '../src/engine/game';
import { makeHand, RESOURCE_TYPES } from '../src/constants';
import { makeGameState, makePlayer } from './helpers';
import { createRng } from '../src/engine/setup';
import type { GameState, VertexId, EdgeId, DevCard, AiDifficulty } from '../src/types';

// ============================================================
// テストユーティリティ
// ============================================================

function withRoad(s: GameState, eid: EdgeId, pid: 'player1' | 'player2' = 'player1'): GameState {
  return {
    ...s,
    edges: { ...s.edges, [eid]: { ...s.edges[eid]!, road: { playerId: pid } } },
    players: {
      ...s.players,
      [pid]: { ...s.players[pid]!, remainingRoads: s.players[pid]!.remainingRoads - 1 },
    },
  };
}

function makeDevCard(type: DevCard['type'], turn = 0): DevCard {
  return { id: `${type}_test`, type, purchasedOnTurn: turn };
}

function firstFreeVertex(s: GameState): VertexId {
  return Object.keys(s.vertices).find(vid => s.vertices[vid]!.building == null)!;
}

function firstFreeEdge(s: GameState): EdgeId {
  return Object.keys(s.edges).find(eid => s.edges[eid]!.road == null)!;
}

// ============================================================
// フルゲームシミュレーション共通ヘルパー
// ============================================================

function runSimulation(initial: GameState, maxIter = 10_000): GameState {
  let s = initial;
  for (let i = 0; i < maxIter; i++) {
    if (s.phase === 'GAME_OVER') break;

    if (s.phase === 'MAIN' && s.turnPhase === 'DISCARD') {
      const discardPid = s.playerOrder.find(pid => {
        const h = s.players[pid]!.hand;
        return RESOURCE_TYPES.reduce((sum, r) => sum + h[r], 0) >= 8;
      });
      if (discardPid) {
        const action = chooseAction(s, discardPid);
        if (!action) break;
        s = applyAction(s, action);
        continue;
      }
    }

    const pid = s.playerOrder[s.currentPlayerIndex]!;
    const action = chooseAction(s, pid);
    if (!action) break;
    s = applyAction(s, action);
  }
  return s;
}

function makeAiOnlyGameState(difficulty: AiDifficulty): GameState {
  return makeGameState({
    phase: 'SETUP_FORWARD',
    setupSubPhase: 'PLACE_SETTLEMENT',
    currentPlayerIndex: 0,
    players: {
      player1: makePlayer('player1', { type: 'ai', aiDifficulty: difficulty }),
      player2: makePlayer('player2', { type: 'ai', aiDifficulty: difficulty }),
    },
  });
}

// ============================================================
// GAME_OVER / 非カレントプレイヤー
// ============================================================

describe('chooseAction - ガード節', () => {
  it('GAME_OVER なら null を返す', () => {
    const s = makeGameState({ phase: 'GAME_OVER' });
    expect(chooseAction(s, 'player1')).toBeNull();
  });

  it('MAIN フェーズで非カレントプレイヤーなら null を返す', () => {
    const s = makeGameState({ phase: 'MAIN', turnPhase: 'PRE_ROLL', currentPlayerIndex: 0 });
    expect(chooseAction(s, 'player2')).toBeNull();
  });

  it('SETUP フェーズで非カレントプレイヤーなら null を返す', () => {
    const s = makeGameState({
      phase: 'SETUP_FORWARD',
      setupSubPhase: 'PLACE_SETTLEMENT',
      currentPlayerIndex: 0,
    });
    expect(chooseAction(s, 'player2')).toBeNull();
  });
});

// ============================================================
// SETUP フェーズ
// ============================================================

describe('chooseAction - SETUP フェーズ', () => {
  it('SETUP_FORWARD PLACE_SETTLEMENT: BUILD_SETTLEMENT を返す', () => {
    const s = makeGameState({
      phase: 'SETUP_FORWARD',
      setupSubPhase: 'PLACE_SETTLEMENT',
      currentPlayerIndex: 0,
    });
    expect(chooseAction(s, 'player1')?.type).toBe('BUILD_SETTLEMENT');
  });

  it('SETUP PLACE_ROAD: BUILD_ROAD を返す', () => {
    let s = makeGameState({
      phase: 'SETUP_FORWARD',
      setupSubPhase: 'PLACE_SETTLEMENT',
      currentPlayerIndex: 0,
    });
    const settlAction = chooseAction(s, 'player1');
    s = applyAction(s, settlAction!);
    expect(s.setupSubPhase).toBe('PLACE_ROAD');
    expect(chooseAction(s, 'player1')?.type).toBe('BUILD_ROAD');
  });

  it('弱AI PLACE_SETTLEMENT: 有効な頂点を選ぶ', () => {
    const s = makeGameState({
      phase: 'SETUP_FORWARD',
      setupSubPhase: 'PLACE_SETTLEMENT',
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'weak' }),
        player2: makePlayer('player2'),
      },
    });
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('BUILD_SETTLEMENT');
    if (action?.type === 'BUILD_SETTLEMENT') {
      expect(s.vertices[action.vertexId]?.building).toBeNull();
    }
  });
});

// ============================================================
// PRE_ROLL フェーズ
// ============================================================

describe('chooseAction - PRE_ROLL', () => {
  it('騎士カードなし: ROLL_DICE を返す', () => {
    const s = makeGameState({ turnPhase: 'PRE_ROLL', currentPlayerIndex: 0 });
    expect(chooseAction(s, 'player1')).toEqual({ type: 'ROLL_DICE' });
  });

  it('使用可能な騎士あり: PLAY_KNIGHT を返す', () => {
    const s = makeGameState({
      turnPhase: 'PRE_ROLL',
      currentPlayerIndex: 0,
      globalTurnNumber: 5,
      players: {
        player1: makePlayer('player1', {
          devCards: [makeDevCard('knight', 3)],
        }),
        player2: makePlayer('player2'),
      },
    });
    expect(chooseAction(s, 'player1')).toEqual({ type: 'PLAY_KNIGHT' });
  });

  it('今ターン購入の騎士は使えない: ROLL_DICE を返す', () => {
    const s = makeGameState({
      turnPhase: 'PRE_ROLL',
      currentPlayerIndex: 0,
      globalTurnNumber: 5,
      players: {
        player1: makePlayer('player1', {
          devCards: [makeDevCard('knight', 5)], // purchasedOnTurn === globalTurnNumber → 使用不可
        }),
        player2: makePlayer('player2'),
      },
    });
    expect(chooseAction(s, 'player1')).toEqual({ type: 'ROLL_DICE' });
  });

  it('弱AI: 騎士があっても ROLL_DICE を返す', () => {
    const s = makeGameState({
      turnPhase: 'PRE_ROLL',
      currentPlayerIndex: 0,
      globalTurnNumber: 5,
      players: {
        player1: makePlayer('player1', {
          type: 'ai',
          aiDifficulty: 'weak',
          devCards: [makeDevCard('knight', 3)],
        }),
        player2: makePlayer('player2'),
      },
    });
    expect(chooseAction(s, 'player1')).toEqual({ type: 'ROLL_DICE' });
  });
});

// ============================================================
// DISCARD フェーズ
// ============================================================

describe('chooseAction - DISCARD', () => {
  it('手札8枚以上: DISCARD_RESOURCES を返す', () => {
    const s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'DISCARD',
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4, brick: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('DISCARD_RESOURCES');
    if (action?.type === 'DISCARD_RESOURCES') {
      const total = RESOURCE_TYPES.reduce((s, r) => s + (action.resources[r] ?? 0), 0);
      expect(total).toBe(4);
    }
  });

  it('手札7枚: null を返す', () => {
    const s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'DISCARD',
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4, brick: 3 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(chooseAction(s, 'player1')).toBeNull();
  });

  it('捨て枚数 = floor(total / 2)', () => {
    const s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'DISCARD',
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 5, brick: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('DISCARD_RESOURCES');
    if (action?.type === 'DISCARD_RESOURCES') {
      const total = RESOURCE_TYPES.reduce((s, r) => s + (action.resources[r] ?? 0), 0);
      expect(total).toBe(4);
      expect(action.playerId).toBe('player1');
    }
  });
});

// ============================================================
// ROBBER フェーズ
// ============================================================

describe('chooseAction - ROBBER', () => {
  it('MOVE_ROBBER を返す', () => {
    const s = makeGameState({ phase: 'MAIN', turnPhase: 'ROBBER', currentPlayerIndex: 0 });
    expect(chooseAction(s, 'player1')?.type).toBe('MOVE_ROBBER');
  });

  it('強盗を現在地以外のタイルへ移動する', () => {
    const s = makeGameState({ phase: 'MAIN', turnPhase: 'ROBBER', currentPlayerIndex: 0 });
    const currentRobberTile = Object.values(s.tiles).find(t => t.hasRobber)!;
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('MOVE_ROBBER');
    if (action?.type === 'MOVE_ROBBER') {
      expect(action.tileId).not.toBe(currentRobberTile.id);
    }
  });

  it('弱AI: 強盗を現在地以外のタイルへ移動する', () => {
    const s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'ROBBER',
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'weak' }),
        player2: makePlayer('player2'),
      },
    });
    const currentRobberTile = Object.values(s.tiles).find(t => t.hasRobber)!;
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('MOVE_ROBBER');
    if (action?.type === 'MOVE_ROBBER') {
      expect(action.tileId).not.toBe(currentRobberTile.id);
    }
  });
});

// ============================================================
// TRADE_BUILD フェーズ
// ============================================================

describe('chooseAction - TRADE_BUILD', () => {
  it('何もできない: END_TURN を返す', () => {
    const s = makeGameState({ phase: 'MAIN', turnPhase: 'TRADE_BUILD', currentPlayerIndex: 0 });
    expect(chooseAction(s, 'player1')).toEqual({ type: 'END_TURN' });
  });

  it('都市建設可能: BUILD_CITY を返す', () => {
    const vid = firstFreeVertex(makeGameState());
    let s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { hand: makeHand({ grain: 2, ore: 3 }) }),
        player2: makePlayer('player2'),
      },
    });
    s = {
      ...s,
      vertices: {
        ...s.vertices,
        [vid]: { ...s.vertices[vid]!, building: { type: 'settlement', playerId: 'player1' } },
      },
    };
    expect(chooseAction(s, 'player1')?.type).toBe('BUILD_CITY');
  });

  it('発展カード購入可能: BUY_DEV_CARD を返す', () => {
    const s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      currentPlayerIndex: 0,
      devDeck: [{ id: 'k1', type: 'knight', purchasedOnTurn: -1 }],
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wool: 1, grain: 1, ore: 1 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(chooseAction(s, 'player1')?.type).toBe('BUY_DEV_CARD');
  });

  it('バンク交易で都市コストを達成できる場合に BANK_TRADE を返す', () => {
    // ore:2(not enough) + wood:4(4:1 trade) → ore:3 で都市建設可能
    // devDeck 空・道なし → BUY_DEV_CARD / BUILD_SETTLEMENT も不可
    let s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      currentPlayerIndex: 0,
      devDeck: [],
      players: {
        player1: makePlayer('player1', {
          hand: makeHand({ grain: 2, ore: 2, wood: 4 }),
        }),
        player2: makePlayer('player2'),
      },
    });
    // 開拓地を配置（都市化候補）
    const vid = firstFreeVertex(s);
    s = {
      ...s,
      vertices: {
        ...s.vertices,
        [vid]: { ...s.vertices[vid]!, building: { type: 'settlement', playerId: 'player1' } },
      },
    };
    const action = chooseAction(s, 'player1');
    // 都市化には ore:3 必要。現在 ore:2 → 交易が必要。BANK_TRADE が先に来るはず。
    expect(action?.type).toBe('BANK_TRADE');
    if (action?.type === 'BANK_TRADE') {
      expect(action.receive).toBe('ore');
    }
  });
});

// ============================================================
// フルゲームシミュレーション（難易度別）
// ============================================================

describe('AI フルゲームシミュレーション', () => {
  const difficulties: AiDifficulty[] = ['weak', 'normal', 'strong'];

  // テスト間でのMath.random状態依存を排除するため決定論的シードを使用
  beforeEach(() => {
    const rng = createRng(42);
    vi.spyOn(Math, 'random').mockImplementation(rng);
  });

  difficulties.forEach(diff => {
    it(`難易度 ${diff}: GAME_OVER まで完走する`, () => {
      const final = runSimulation(makeAiOnlyGameState(diff), 10_000);
      expect(final.phase).toBe('GAME_OVER');
      expect(final.winner).not.toBeNull();
    });
  });

  it('normal: 10_000 ターン以内に終了する', () => {
    const MAX = 10_000;
    let s = makeAiOnlyGameState('normal');
    let i = 0;
    while (s.phase !== 'GAME_OVER' && i < MAX) {
      i++;
      if (s.phase === 'MAIN' && s.turnPhase === 'DISCARD') {
        const discardPid = s.playerOrder.find(pid => {
          const h = s.players[pid]!.hand;
          return RESOURCE_TYPES.reduce((sum, r) => sum + h[r], 0) >= 8;
        });
        if (discardPid) {
          const action = chooseAction(s, discardPid);
          if (!action) break;
          s = applyAction(s, action);
          continue;
        }
      }
      const pid = s.playerOrder[s.currentPlayerIndex]!;
      const action = chooseAction(s, pid);
      if (!action) break;
      s = applyAction(s, action);
    }
    expect(i).toBeLessThan(MAX);
    expect(s.phase).toBe('GAME_OVER');
  });
});
