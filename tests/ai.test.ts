// ============================================================
// tests/ai.test.ts — AIプレイヤー テスト（難易度対応）
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chooseAction, evaluateVertexForSetup, chooseRobberHex, chooseStealTarget, chooseDiscards } from '../src/engine/ai';
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
// A-1: 初期配置ヒューリスティック
// ============================================================

describe('evaluateVertexForSetup (初期配置ヒューリスティック)', () => {
  // pip: 6/8=5, 5/9=4, 2/12=1。資源: forest=wood, hill=brick, mountain=ore, field=grain, pasture=wool
  function evalState(): GameState {
    return {
      tiles: {
        f6: { id: 'f6', type: 'forest', number: 6 },
        f8: { id: 'f8', type: 'forest', number: 8 },
        f5: { id: 'f5', type: 'forest', number: 5 },
        f2: { id: 'f2', type: 'forest', number: 2 },
        f12: { id: 'f12', type: 'forest', number: 12 },
        h8: { id: 'h8', type: 'hill', number: 8 },
        h6: { id: 'h6', type: 'hill', number: 6 },
        m5: { id: 'm5', type: 'mountain', number: 5 },
        fld9: { id: 'fld9', type: 'field', number: 9 },
        p9: { id: 'p9', type: 'pasture', number: 9 },
      },
      vertices: {
        vHigh: { id: 'vHigh', adjacentTileIds: ['f6', 'h8', 'm5'], harborType: null },
        vLow: { id: 'vLow', adjacentTileIds: ['f2', 'f12'], harborType: null },
        vSame: { id: 'vSame', adjacentTileIds: ['f6', 'f8', 'f5'], harborType: null },
        vDiv: { id: 'vDiv', adjacentTileIds: ['f6', 'h8', 'm5'], harborType: null },
        vOreWheat: { id: 'vOreWheat', adjacentTileIds: ['m5', 'fld9'], harborType: null },
        vOreWool: { id: 'vOreWool', adjacentTileIds: ['m5', 'p9'], harborType: null },
        vNoHarbor: { id: 'vNoHarbor', adjacentTileIds: ['f2', 'f12'], harborType: null },
        vHarbor: { id: 'vHarbor', adjacentTileIds: ['f2', 'f12'], harborType: 'generic' },
        vSpread: { id: 'vSpread', adjacentTileIds: ['f6', 'h8'], harborType: null },
        vNoSpread: { id: 'vNoSpread', adjacentTileIds: ['f6', 'h6'], harborType: null },
        vFirst: { id: 'vFirst', adjacentTileIds: ['f6', 'h8'], harborType: null },
        vNew: { id: 'vNew', adjacentTileIds: ['m5', 'fld9'], harborType: null },
        vDup: { id: 'vDup', adjacentTileIds: ['f6', 'h8'], harborType: null },
      },
    } as unknown as GameState;
  }

  it('(a) 高pip・多様な頂点を低pip・単一資源より高く評価する', () => {
    const s = evalState();
    expect(evaluateVertexForSetup(s, 'vHigh')).toBeGreaterThan(evaluateVertexForSetup(s, 'vLow'));
  });

  it('資源の多様性を加点する（同pipなら多様な方が高い）', () => {
    const s = evalState();
    expect(evaluateVertexForSetup(s, 'vDiv')).toBeGreaterThan(evaluateVertexForSetup(s, 'vSame'));
  });

  it('ore+wheat を加点する（同pip・同多様性の wool 比較で上回る）', () => {
    const s = evalState();
    expect(evaluateVertexForSetup(s, 'vOreWheat')).toBeGreaterThan(evaluateVertexForSetup(s, 'vOreWool'));
  });

  it('港に小加点する', () => {
    const s = evalState();
    expect(evaluateVertexForSetup(s, 'vHarbor')).toBeGreaterThan(evaluateVertexForSetup(s, 'vNoHarbor'));
  });

  it('数字の分散を加点する（同じ数字に偏る頂点より高い）', () => {
    const s = evalState();
    expect(evaluateVertexForSetup(s, 'vSpread')).toBeGreaterThan(evaluateVertexForSetup(s, 'vNoSpread'));
  });

  it('(b) 2軒目は1軒目の不足資源・別数字を補完する頂点を優先する', () => {
    const s = evalState();
    // 補完なし（1軒目を考慮しない）なら vDup(高pip) > vNew
    expect(evaluateVertexForSetup(s, 'vNew')).toBeLessThan(evaluateVertexForSetup(s, 'vDup'));
    // 1軒目(vFirst=wood/brick,6/8)を踏まえると、全資源・全数字が新しい vNew が逆転して上回る
    expect(evaluateVertexForSetup(s, 'vNew', 'vFirst'))
      .toBeGreaterThan(evaluateVertexForSetup(s, 'vDup', 'vFirst'));
  });
});

describe('chooseAction - SETUP 配置の決定性', () => {
  it('(c) 通常AIの初期配置は同シードで同じ頂点を選ぶ', () => {
    const mk = (): GameState => makeGameState({
      phase: 'SETUP_FORWARD',
      setupSubPhase: 'PLACE_SETTLEMENT',
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'normal' }),
        player2: makePlayer('player2', { type: 'ai', aiDifficulty: 'normal' }),
      },
    });
    const a = chooseAction(mk(), 'player1', { rng: createRng(7) });
    const b = chooseAction(mk(), 'player1', { rng: createRng(7) });
    expect(a?.type).toBe('BUILD_SETTLEMENT');
    expect(a).toEqual(b);
  });
});

// ============================================================
// PRE_ROLL フェーズ
// ============================================================

describe('chooseAction - 勝利push (item5: 勝てる時に勝つ)', () => {
  // VPカード8枚 + 開拓地1 = 9VP（勝利まであと1点）の強CPU状態を作る
  function nearWin(handPartial: Partial<Record<string, number>>): GameState {
    const vpCards: DevCard[] = Array.from({ length: 8 }, (_, i) => makeDevCard('victory_point', i));
    const s = makeGameState({
      turnPhase: 'TRADE_BUILD',
      diceRolledThisTurn: true,
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', {
          type: 'ai', aiDifficulty: 'strong',
          hand: makeHand(handPartial as Record<typeof RESOURCE_TYPES[number], number>),
          devCards: vpCards,
        }),
        player2: makePlayer('player2'),
      },
    });
    // 自分の開拓地を1つ置く（=都市化先, VP=9）
    const vid = Object.keys(s.vertices)[0]! as VertexId;
    return { ...s, vertices: { ...s.vertices, [vid]: { ...s.vertices[vid]!, building: { type: 'settlement', playerId: 'player1' } } } };
  }

  it('9VPで都市資源あり → BUILD_CITY（勝利に直結する建設を最優先）', () => {
    const s = nearWin({ grain: 3, ore: 3 });
    expect(chooseAction(s, 'player1')?.type).toBe('BUILD_CITY');
  });

  it('9VPで資源不足 → バンク交易で不足資源を補う（BANK_TRADE）', () => {
    // 余剰の木4枚のみ（4:1でgrain/oreへ交換できる）。都市化に向け交換する。
    const s = nearWin({ wood: 4 });
    const act = chooseAction(s, 'player1');
    expect(act?.type).toBe('BANK_TRADE');
    if (act?.type === 'BANK_TRADE') {
      expect(act.give).toBe('wood');
      expect(['grain', 'ore']).toContain(act.receive);
    }
  });
});

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
// A-2: 盗賊配置・略奪・7破棄
// ============================================================

describe('A-2 盗賊配置・略奪・7破棄', () => {
  const vp = (turn: number): DevCard => makeDevCard('victory_point', turn);
  // 自分=player1。A: player2(リーダー,VP4) / B: player3(VP2) / E: player2&player3 / D: 砂漠(盗賊)
  function craft(overrides: Partial<GameState> = {}): GameState {
    return {
      tiles: {
        A: { id: 'A', type: 'forest', number: 6, hasRobber: false },    // pip5
        B: { id: 'B', type: 'hill', number: 5, hasRobber: false },       // pip4
        E: { id: 'E', type: 'mountain', number: 9, hasRobber: false },   // pip4
        D: { id: 'D', type: 'desert', number: null, hasRobber: true },
      },
      tileToVertices: { A: ['a1', 'a2'], B: ['b1', 'b2'], E: ['e1', 'e2'], D: ['d1'] },
      vertices: {
        a1: { id: 'a1', building: { type: 'settlement', playerId: 'player2' } },
        a2: { id: 'a2', building: null },
        b1: { id: 'b1', building: { type: 'settlement', playerId: 'player3' } },
        b2: { id: 'b2', building: null },
        e1: { id: 'e1', building: { type: 'settlement', playerId: 'player2' } },
        e2: { id: 'e2', building: { type: 'settlement', playerId: 'player3' } },
        d1: { id: 'd1', building: null },
      },
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'strong' }),
        player2: makePlayer('player2', { hand: makeHand({ wood: 6 }), devCards: [vp(0), vp(1)] }), // VP=2settl+2card=4
        player3: makePlayer('player3', { hand: makeHand({ wood: 1 }) }),                            // VP=2settl=2
      },
      playerOrder: ['player1', 'player2', 'player3'],
      ...overrides,
    } as unknown as GameState;
  }

  it('リーダー(最高VP)の最強ヘックスに盗賊を置く', () => {
    // A: pip5×(1+4)=25 > E: pip4×(1+4)=20 > B: pip4×(1+2)=12
    expect(chooseRobberHex(craft(), 'player1', createRng(1))).toBe('A');
  });

  it('自分の生産ヘックスは避ける（高pipでも自分がいれば選ばない）', () => {
    // A に自分(player1)を同居させる → A は除外。残り E(20) > B(12) で E を選ぶ。
    const s = craft();
    const sa = { ...s, vertices: { ...s.vertices, a2: { id: 'a2', building: { type: 'settlement', playerId: 'player1' } } } } as unknown as GameState;
    expect(chooseRobberHex(sa, 'player1', createRng(1))).toBe('E');
  });

  it('同ヘックスの相手のうち手札が多い/勝利に近い相手から奪う', () => {
    // E に player2(手札6,VP4) と player3(手札1,VP2) → player2 を狙う
    expect(chooseStealTarget(craft(), 'E', 'player1', createRng(1))).toBe('player2');
  });

  it('手札0の相手からは奪わない（null）', () => {
    const s = craft();
    const s0 = { ...s, players: { ...s.players, player3: makePlayer('player3', { hand: makeHand() }) } } as unknown as GameState;
    // B の相手は player3 のみ。手札0 → null。
    expect(chooseStealTarget(s0, 'B', 'player1', createRng(1))).toBeNull();
  });

  it('7破棄は建設目標に不要な余剰資源から捨て、必要資源を温存する', () => {
    // 目標(開拓地: 木/煉瓦/羊/麦 各1、発展: 羊/麦/鉱石 各1)。ore は dev で1必要だが余剰4。
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'normal', hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1, ore: 5 }) }),
        player2: makePlayer('player2'),
      },
    });
    const d = chooseDiscards(s, 'player1', 4, createRng(1));
    expect(d.ore).toBe(4);                                  // 余剰 ore を捨てる
    expect((d.wood ?? 0) + (d.brick ?? 0) + (d.wool ?? 0) + (d.grain ?? 0)).toBe(0); // 目標資源は温存
    const total = RESOURCE_TYPES.reduce((sum, r) => sum + (d[r] ?? 0), 0);
    expect(total).toBe(4);
  });

  it('盗賊配置は同シードで再現可能（決定的）', () => {
    expect(chooseRobberHex(craft(), 'player1', createRng(9))).toBe(chooseRobberHex(craft(), 'player1', createRng(9)));
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

// ============================================================
// グループD: 進歩カードのプレイ & rng 注入（M4）
// ============================================================

describe('Group D: AI plays progress dev cards when stuck', () => {
  // 開拓地1つ＋手詰まり手札＋指定カードを持つ normal CPU 状態を作る。
  function stuckWithCard(card: DevCard, hand = makeHand()): GameState {
    const base = makeGameState({
      turnPhase: 'TRADE_BUILD',
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'normal', hand, devCards: [card] }),
        player2: makePlayer('player2', { hand: makeHand({ ore: 3 }) }),
      },
    });
    const vid = Object.keys(base.vertices)[0]!;
    return {
      ...base,
      vertices: { ...base.vertices, [vid]: { ...base.vertices[vid]!, building: { type: 'settlement', playerId: 'player1' } } },
    };
  }

  it('手詰まりの CPU は街道建設カードを使う（無料で道を引けるとき）', () => {
    const s = stuckWithCard(makeDevCard('road_building', 0));
    expect(chooseAction(s, 'player1')).toEqual({ type: 'PLAY_ROAD_BUILDING' });
  });

  it('豊作カードで都市に2枚以内で届くなら使い、不足資源を指定する', () => {
    // 都市コスト grain2+ore3。grain2+ore1 所持 → ore が2枚不足。
    const s = stuckWithCard(makeDevCard('year_of_plenty', 0), makeHand({ grain: 2, ore: 1 }));
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('PLAY_YEAR_OF_PLENTY');
    if (action?.type === 'PLAY_YEAR_OF_PLENTY') expect(action.resources).toEqual(['ore', 'ore']);
  });

  it('独占カードは目標に最も不足している資源を指定する', () => {
    // 都市コスト grain2+ore3。grain2 のみ所持 → ore が最大不足。
    const s = stuckWithCard(makeDevCard('monopoly', 0), makeHand({ grain: 2 }));
    const action = chooseAction(s, 'player1');
    expect(action?.type).toBe('PLAY_MONOPOLY');
    if (action?.type === 'PLAY_MONOPOLY') expect(action.resource).toBe('ore');
  });

  it('そのターンに既に発展カードを使っていれば進歩カードは使わない（1ターン1枚）', () => {
    const base = stuckWithCard(makeDevCard('road_building', 0));
    const s: GameState = { ...base, devCardPlayedThisTurn: true };
    expect(chooseAction(s, 'player1')?.type).not.toBe('PLAY_ROAD_BUILDING');
  });

  it('進歩カードを使う一手はエンジンに受理される（合法性）', () => {
    const s = stuckWithCard(makeDevCard('year_of_plenty', 0), makeHand({ grain: 2, ore: 1 }));
    const action = chooseAction(s, 'player1')!;
    expect(() => applyAction(s, action, createRng(1))).not.toThrow();
  });
});

describe('Group D: AI rng injection (M4)', () => {
  function weakSetup(): GameState {
    return makeGameState({
      phase: 'SETUP_FORWARD', turnPhase: 'PRE_ROLL', setupSubPhase: 'PLACE_SETTLEMENT',
      players: {
        player1: makePlayer('player1', { type: 'ai', aiDifficulty: 'weak' }),
        player2: makePlayer('player2'),
      },
    });
  }

  it('weak CPU の初期配置は注入シードで再現可能（同シード→同じ選択）', () => {
    const a = chooseAction(weakSetup(), 'player1', { rng: createRng(123) });
    const b = chooseAction(weakSetup(), 'player1', { rng: createRng(123) });
    expect(a?.type).toBe('BUILD_SETTLEMENT');
    expect(a).toEqual(b);
  });
});
