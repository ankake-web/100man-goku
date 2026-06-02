// ============================================================
// tests/trade.test.ts — L-06: 交易エンジン テスト
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  getEffectiveTradeRate,
  canBankTrade,
  executeBankTrade,
  offerTrade,
  respondTrade,
  confirmTrade,
  cancelTrade,
} from '../src/engine/trade';
import { applyAction } from '../src/engine/game';
import { findCpuTradeOpportunity } from '../src/engine/ai';
import { makeHand } from '../src/constants';
import { makeGameState, makePlayer } from './helpers';
import type { GameState, ResourceType, TradeOffer } from '../src/types';

// ============================================================
// テスト用ユーティリティ
// ============================================================

/** 指定プレイヤーの最初の頂点に港を設定した GameState を生成する */
function stateWithHarbor(
  harborType: 'generic' | ResourceType,
  buildingPlayerId: 'player1' | 'player2' = 'player1',
): GameState {
  const state = makeGameState();
  const vid = Object.keys(state.vertices)[0]!;
  return {
    ...state,
    vertices: {
      ...state.vertices,
      [vid]: {
        ...state.vertices[vid]!,
        harborType,
        building: { type: 'settlement', playerId: buildingPlayerId },
      },
    },
  };
}

// ============================================================
// getEffectiveTradeRate
// ============================================================

describe('getEffectiveTradeRate', () => {
  it('returns 4 when player has no harbor', () => {
    const state = makeGameState();
    expect(getEffectiveTradeRate(state, 'player1', 'wood')).toBe(4);
  });

  it('returns 3 with a generic harbor building', () => {
    const state = stateWithHarbor('generic');
    expect(getEffectiveTradeRate(state, 'player1', 'wood')).toBe(3);
  });

  it('returns 2 with a specific harbor matching the resource', () => {
    const state = stateWithHarbor('wood');
    expect(getEffectiveTradeRate(state, 'player1', 'wood')).toBe(2);
  });

  it('returns 4 for non-matching specific harbor resource', () => {
    const state = stateWithHarbor('wood');
    expect(getEffectiveTradeRate(state, 'player1', 'brick')).toBe(4);
  });

  it('returns 2 when player has both generic and specific harbor (best rate wins)', () => {
    const state = makeGameState();
    const vids = Object.keys(state.vertices);
    const vid0 = vids[0]!;
    const vid1 = vids[1]!;
    const s = {
      ...state,
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          harborType: 'generic' as const,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
        [vid1]: {
          ...state.vertices[vid1]!,
          harborType: 'wood' as const,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(getEffectiveTradeRate(s, 'player1', 'wood')).toBe(2);
  });

  it('opponent harbor does not apply to player1', () => {
    const state = stateWithHarbor('wood', 'player2');
    expect(getEffectiveTradeRate(state, 'player1', 'wood')).toBe(4);
  });

  it('works with city building at harbor vertex', () => {
    const state = makeGameState();
    const vid = Object.keys(state.vertices)[0]!;
    const s = {
      ...state,
      vertices: {
        ...state.vertices,
        [vid]: {
          ...state.vertices[vid]!,
          harborType: 'wool' as const,
          building: { type: 'city' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(getEffectiveTradeRate(s, 'player1', 'wool')).toBe(2);
  });
});

// ============================================================
// canBankTrade
// ============================================================

describe('canBankTrade', () => {
  it('returns false when give === receive', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(canBankTrade(state, 'player1', 'wood', 'wood')).toBe(false);
  });

  it('returns false when player does not have enough of give resource (4:1)', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 3 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(canBankTrade(state, 'player1', 'wood', 'brick')).toBe(false);
  });

  it('returns true when player has exactly 4 of give resource (default 4:1)', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(canBankTrade(state, 'player1', 'wood', 'brick')).toBe(true);
  });

  it('returns true at 3:1 rate when player has 3 and generic harbor', () => {
    const base = stateWithHarbor('generic');
    const state = {
      ...base,
      players: {
        ...base.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 3 }) }),
      },
    };
    expect(canBankTrade(state, 'player1', 'wood', 'brick')).toBe(true);
  });

  it('returns true at 2:1 rate when player has 2 and specific harbor', () => {
    const base = stateWithHarbor('wood');
    const state = {
      ...base,
      players: {
        ...base.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 2 }) }),
      },
    };
    expect(canBankTrade(state, 'player1', 'wood', 'brick')).toBe(true);
  });

  it('returns false when bank has no receive resource', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
      bank: makeHand({ wood: 19, brick: 0, wool: 19, grain: 19, ore: 19 }),
    });
    expect(canBankTrade(state, 'player1', 'wood', 'brick')).toBe(false);
  });
});

// ============================================================
// executeBankTrade
// ============================================================

describe('executeBankTrade', () => {
  it('deducts give resource from player at 4:1 rate', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = executeBankTrade(state, 'player1', 'wood', 'brick');
    expect(next.players['player1']!.hand.wood).toBe(0);
  });

  it('gives player 1 of receive resource', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = executeBankTrade(state, 'player1', 'wood', 'brick');
    expect(next.players['player1']!.hand.brick).toBe(1);
  });

  it('returns give resource to bank', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = executeBankTrade(state, 'player1', 'wood', 'brick');
    expect(next.bank.wood).toBe(state.bank.wood + 4);
  });

  it('takes receive resource from bank', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = executeBankTrade(state, 'player1', 'wood', 'brick');
    expect(next.bank.brick).toBe(state.bank.brick - 1);
  });

  it('uses 3:1 rate with generic harbor', () => {
    const base = stateWithHarbor('generic');
    const state = {
      ...base,
      players: {
        ...base.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 3 }) }),
      },
    };
    const next = executeBankTrade(state, 'player1', 'wood', 'grain');
    expect(next.players['player1']!.hand.wood).toBe(0);
    expect(next.players['player1']!.hand.grain).toBe(1);
    expect(next.bank.wood).toBe(state.bank.wood + 3);
  });

  it('uses 2:1 rate with specific harbor', () => {
    const base = stateWithHarbor('ore');
    const state = {
      ...base,
      players: {
        ...base.players,
        player1: makePlayer('player1', { hand: makeHand({ ore: 2 }) }),
      },
    };
    const next = executeBankTrade(state, 'player1', 'ore', 'wool');
    expect(next.players['player1']!.hand.ore).toBe(0);
    expect(next.players['player1']!.hand.wool).toBe(1);
    expect(next.bank.ore).toBe(state.bank.ore + 2);
  });

  it('original state is unchanged (immutability)', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    executeBankTrade(state, 'player1', 'wood', 'brick');
    expect(state.players['player1']!.hand.wood).toBe(4);
  });
});

// ============================================================
// offerTrade
// ============================================================

describe('offerTrade', () => {
  const offer: TradeOffer = {
    give:    { wood: 2 },
    receive: { brick: 1 },
  };

  it('sets pendingTrade to TRADE_OFFER state', () => {
    const state = makeGameState();
    const next = offerTrade(state, 'player1', offer, ['player2']);
    expect(next.pendingTrade?.state).toBe('TRADE_OFFER');
  });

  it('stores initiatorId, offer and targetPlayerIds', () => {
    const state = makeGameState();
    const next = offerTrade(state, 'player1', offer, ['player2']);
    expect(next.pendingTrade?.initiatorId).toBe('player1');
    expect(next.pendingTrade?.offer).toEqual(offer);
    expect(next.pendingTrade?.targetPlayerIds).toEqual(['player2']);
  });

  it('starts with empty responses and null selectedResponderId', () => {
    const state = makeGameState();
    const next = offerTrade(state, 'player1', offer, ['player2']);
    expect(next.pendingTrade?.responses).toEqual({});
    expect(next.pendingTrade?.selectedResponderId).toBeNull();
  });
});

// ============================================================
// respondTrade
// ============================================================

describe('respondTrade', () => {
  function stateWithOffer(): GameState {
    const state = makeGameState();
    return offerTrade(
      state,
      'player1',
      { give: { wood: 1 }, receive: { brick: 1 } },
      ['player2'],
    );
  }

  it('records the response in pendingTrade.responses', () => {
    const state = stateWithOffer();
    const next = respondTrade(state, {
      playerId: 'player2',
      status: 'ACCEPT',
    });
    expect(next.pendingTrade?.responses['player2']?.status).toBe('ACCEPT');
  });

  it('updates state to TRADE_RESPONSE', () => {
    const state = stateWithOffer();
    const next = respondTrade(state, { playerId: 'player2', status: 'REJECT' });
    expect(next.pendingTrade?.state).toBe('TRADE_RESPONSE');
  });

  it('accumulates multiple responses', () => {
    const base = makeGameState({
      players: {
        player1: makePlayer('player1'),
        player2: makePlayer('player2'),
        player3: makePlayer('player3'),
      },
      playerOrder: ['player1', 'player2', 'player3'],
    });
    const withOffer = offerTrade(
      base,
      'player1',
      { give: { wood: 1 }, receive: { brick: 1 } },
      ['player2', 'player3'],
    );
    const r1 = respondTrade(withOffer, { playerId: 'player2', status: 'ACCEPT' });
    const r2 = respondTrade(r1, { playerId: 'player3', status: 'REJECT' });
    expect(r2.pendingTrade?.responses['player2']?.status).toBe('ACCEPT');
    expect(r2.pendingTrade?.responses['player3']?.status).toBe('REJECT');
  });

  it('複数ターゲット: 全員応答するまで TRADE_OFFER のまま、揃ったら TRADE_RESPONSE', () => {
    const base = makeGameState({
      players: {
        player1: makePlayer('player1'),
        player2: makePlayer('player2'),
        player3: makePlayer('player3'),
      },
      playerOrder: ['player1', 'player2', 'player3'],
    });
    const withOffer = offerTrade(base, 'player1',
      { give: { wood: 1 }, receive: { brick: 1 } }, ['player2', 'player3']);
    // 1人目の応答後はまだ収集中
    const r1 = respondTrade(withOffer, { playerId: 'player2', status: 'ACCEPT' });
    expect(r1.pendingTrade?.state).toBe('TRADE_OFFER');
    // 2人目（最後）の応答で確定
    const r2 = respondTrade(r1, { playerId: 'player3', status: 'REJECT' });
    expect(r2.pendingTrade?.state).toBe('TRADE_RESPONSE');
  });

  it('returns unchanged state if no pendingTrade', () => {
    const state = makeGameState();
    const next = respondTrade(state, { playerId: 'player2', status: 'ACCEPT' });
    expect(next).toEqual(state);
  });
});

// ============================================================
// confirmTrade
// ============================================================

describe('confirmTrade', () => {
  function stateWithAcceptedOffer(
    p1Wood = 2, p2Brick = 1,
  ): GameState {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: p1Wood }) }),
        player2: makePlayer('player2', { hand: makeHand({ brick: p2Brick }) }),
      },
    });
    const offered = offerTrade(
      state,
      'player1',
      { give: { wood: 2 }, receive: { brick: 1 } },
      ['player2'],
    );
    return respondTrade(offered, { playerId: 'player2', status: 'ACCEPT' });
  }

  it('swaps resources between initiator and responder', () => {
    const state = stateWithAcceptedOffer();
    const next = confirmTrade(state, 'player2');
    expect(next.players['player1']!.hand.wood).toBe(0);
    expect(next.players['player1']!.hand.brick).toBe(1);
    expect(next.players['player2']!.hand.brick).toBe(0);
    expect(next.players['player2']!.hand.wood).toBe(2);
  });

  it('clears pendingTrade after execution', () => {
    const state = stateWithAcceptedOffer();
    const next = confirmTrade(state, 'player2');
    expect(next.pendingTrade).toBeNull();
  });

  it('transitions to TRADE_CANCELLED if initiator lacks resources', () => {
    const state = stateWithAcceptedOffer(0, 1); // initiator has no wood
    const next = confirmTrade(state, 'player2');
    expect(next.pendingTrade?.state).toBe('TRADE_CANCELLED');
  });

  it('transitions to TRADE_CANCELLED if responder lacks resources', () => {
    const state = stateWithAcceptedOffer(2, 0); // responder has no brick
    const next = confirmTrade(state, 'player2');
    expect(next.pendingTrade?.state).toBe('TRADE_CANCELLED');
  });

  it('returns unchanged state if no pendingTrade', () => {
    const state = makeGameState();
    const next = confirmTrade(state, 'player2');
    expect(next).toEqual(state);
  });

  it('trade with counter offer: responder gives different resource', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wool: 3 }) }),
        player2: makePlayer('player2', { hand: makeHand({ grain: 2 }) }),
      },
    });
    // カウンターオファー: receive側は grain:2 を要求
    const offered = offerTrade(
      state,
      'player1',
      { give: { wool: 3 }, receive: { grain: 2 } },
      ['player2'],
    );
    const responded = respondTrade(offered, {
      playerId: 'player2',
      status: 'ACCEPT',
    });
    const next = confirmTrade(responded, 'player2');
    expect(next.players['player1']!.hand.wool).toBe(0);
    expect(next.players['player1']!.hand.grain).toBe(2);
    expect(next.players['player2']!.hand.grain).toBe(0);
    expect(next.players['player2']!.hand.wool).toBe(3);
  });
});

// ============================================================
// cancelTrade
// ============================================================

describe('cancelTrade', () => {
  it('sets pendingTrade to null', () => {
    const state = makeGameState();
    const offered = offerTrade(
      state,
      'player1',
      { give: { wood: 1 }, receive: { brick: 1 } },
      ['player2'],
    );
    expect(offered.pendingTrade).not.toBeNull();
    const next = cancelTrade(offered);
    expect(next.pendingTrade).toBeNull();
  });

  it('does nothing if no pendingTrade', () => {
    const state = makeGameState();
    const next = cancelTrade(state);
    expect(next.pendingTrade).toBeNull();
  });

  it('does not modify player hands', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 2 }) }),
        player2: makePlayer('player2'),
      },
    });
    const offered = offerTrade(
      state,
      'player1',
      { give: { wood: 2 }, receive: { brick: 1 } },
      ['player2'],
    );
    const next = cancelTrade(offered);
    expect(next.players['player1']!.hand.wood).toBe(2);
  });
});

// ============================================================
// CPU→人間 交易打診テスト
// ============================================================

describe('findCpuTradeOpportunity', () => {
  it('returns null when no human player exists', () => {
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'ai', hand: makeHand({ ore: 2 }) }),
        player2: makePlayer('player2', { type: 'ai', hand: makeHand({ grain: 2 }) }),
      },
    });
    expect(findCpuTradeOpportunity(state, 'player1')).toBeNull();
  });

  it('returns null when CPU can already build every target (no deficit anywhere)', () => {
    // 都市・開拓地・発展カードのいずれもコストを満たす手札
    // (wood1,brick1,wool1,grain2,ore3 → 3種すべて建設可能 → 不足なし)
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ ore: 2 }) }),
        player2: makePlayer('player2', {
          type: 'ai',
          hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 2, ore: 3 }),
        }),
      },
    });
    expect(findCpuTradeOpportunity(state, 'player2')).toBeNull();
  });

  // --- 重要: CPUは人間の手札を見ない（提案生成は人間の手札に依存しない） ---

  it('提案生成は人間の手札内容に依存しない（人間が要求資源を持つ場合と持たない場合で結果が同じ）', () => {
    // CPU: grain:2, ore:2, wood:3 → city に ore 1 枚不足、wood が余剰
    const cpuHand = makeHand({ grain: 2, ore: 2, wood: 3 });

    // ケース1: 人間が ore を持っている
    const stateHumanHasOre = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ ore: 5 }) }),
        player2: makePlayer('player2', { type: 'ai', hand: cpuHand }),
      },
    });
    // ケース2: 人間が ore を全く持っていない
    const stateHumanNoOre = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ wood: 5 }) }),
        player2: makePlayer('player2', { type: 'ai', hand: cpuHand }),
      },
    });

    const oppHasOre = findCpuTradeOpportunity(stateHumanHasOre, 'player2');
    const oppNoOre  = findCpuTradeOpportunity(stateHumanNoOre, 'player2');

    // 両ケースとも提案が生成され、内容（give/receive）が一致すること
    expect(oppHasOre).not.toBeNull();
    expect(oppNoOre).not.toBeNull();
    expect(oppNoOre!.receive).toBe(oppHasOre!.receive);
    expect(oppNoOre!.give).toBe(oppHasOre!.give);
  });

  it('returns a valid offer when CPU is 1 ore short for city (regardless of human hand)', () => {
    // CPU: grain:2, ore:2, wood:3 → 1 ore short for city; can give wood
    // Human が ore を持っていなくても提案は生成される
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({}) }), // 空手札
        player2: makePlayer('player2', { type: 'ai', hand: makeHand({ grain: 2, ore: 2, wood: 3 }) }),
      },
    });
    const opp = findCpuTradeOpportunity(state, 'player2');
    expect(opp).not.toBeNull();
    expect(opp!.receive).toBe('ore');
    expect(opp!.humanPid).toBe('player1');
  });

  it('returns a valid offer when CPU is 1 wood short for settlement (regardless of human hand)', () => {
    // CPU: brick:1, wool:1, grain:2 → 1 wood short for settlement; can give grain
    // Human が wood を持っていなくても提案は生成される
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({}) }), // 空手札
        player2: makePlayer('player2', {
          type: 'ai',
          hand: makeHand({ brick: 1, wool: 1, grain: 2 }),
        }),
      },
    });
    const opp = findCpuTradeOpportunity(state, 'player2');
    expect(opp).not.toBeNull();
    expect(opp!.receive).toBe('wood');
    expect(opp!.give).toBe('grain');
  });

  it('returns null when CPU has nothing to give (空手札では余剰を割けない)', () => {
    // CPU 空手札 → どのビルドにも渡せる余剰がない（自分の手札のみで判定）
    const state = makeGameState({
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ ore: 2 }) }),
        player2: makePlayer('player2', { type: 'ai', hand: makeHand({}) }),
      },
    });
    expect(findCpuTradeOpportunity(state, 'player2')).toBeNull();
  });
});

describe('CPU→人間交易: 承認すると資源が交換される', () => {
  function makeCpuHumanTradeState() {
    return makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      playerOrder: ['player2', 'player1'],
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ ore: 2, wood: 1 }) }),
        player2: makePlayer('player2', { type: 'ai',   hand: makeHand({ wood: 3, grain: 2, ore: 2 }) }),
      },
    });
  }

  it('承認すると双方の資源が交換される', () => {
    const state = makeCpuHumanTradeState();
    // CPU(player2)が ore を要求し wood を渡すオファーを出す
    const offered = offerTrade(
      state,
      'player2',
      { give: { wood: 1 }, receive: { ore: 1 } },
      ['player1'],
    );
    // 人間が承認
    const responded = respondTrade(offered, {
      playerId: 'player1',
      status: 'ACCEPT',
    });
    // 確定
    const confirmed = confirmTrade(responded, 'player1');
    expect(confirmed.pendingTrade).toBeNull();
    // CPU(player2): wood -1, ore +1
    expect(confirmed.players['player2']!.hand.wood).toBe(2);
    expect(confirmed.players['player2']!.hand.ore).toBe(3);
    // 人間(player1): ore -1, wood +1
    expect(confirmed.players['player1']!.hand.ore).toBe(1);
    expect(confirmed.players['player1']!.hand.wood).toBe(2);
  });

  it('拒否すると資源は移動しない', () => {
    const state = makeCpuHumanTradeState();
    const offered = offerTrade(
      state,
      'player2',
      { give: { wood: 1 }, receive: { ore: 1 } },
      ['player1'],
    );
    const responded = respondTrade(offered, {
      playerId: 'player1',
      status: 'REJECT',
    });
    const cancelled = cancelTrade(responded);
    expect(cancelled.pendingTrade).toBeNull();
    // 資源は変化なし
    expect(cancelled.players['player2']!.hand.wood).toBe(3);
    expect(cancelled.players['player2']!.hand.ore).toBe(2);
    expect(cancelled.players['player1']!.hand.ore).toBe(2);
    expect(cancelled.players['player1']!.hand.wood).toBe(1);
  });

  it('人間が要求資源を持っていない場合、confirmTrade は TRADE_CANCELLED になる', () => {
    // 人間が ore を持っていない状態で承認しようとする
    const state = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      playerOrder: ['player2', 'player1'],
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ wood: 1 }) }), // ore なし
        player2: makePlayer('player2', { type: 'ai',   hand: makeHand({ wood: 3, ore: 2 }) }),
      },
    });
    const offered = offerTrade(
      state, 'player2',
      { give: { wood: 1 }, receive: { ore: 1 } },
      ['player1'],
    );
    const responded = respondTrade(offered, { playerId: 'player1', status: 'ACCEPT' });
    const result = confirmTrade(responded, 'player1');
    // 再バリデーションで失敗 → TRADE_CANCELLED
    expect(result.pendingTrade?.state).toBe('TRADE_CANCELLED');
    expect(result.players['player1']!.hand.wood).toBe(1); // 変化なし
  });

  it('CPUが提供資源を持っていない場合、confirmTrade は TRADE_CANCELLED になる', () => {
    // CPU の wood が 0 なのに wood を提案しようとする（不正状態）
    const state = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      playerOrder: ['player2', 'player1'],
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ ore: 2 }) }),
        player2: makePlayer('player2', { type: 'ai',   hand: makeHand({ ore: 2 }) }), // wood なし
      },
    });
    // 強制的にオファーを作る（通常はこのような提案はできないが直接エンジンを操作）
    const offered = offerTrade(
      state, 'player2',
      { give: { wood: 1 }, receive: { ore: 1 } },
      ['player1'],
    );
    const responded = respondTrade(offered, { playerId: 'player1', status: 'ACCEPT' });
    const result = confirmTrade(responded, 'player1');
    expect(result.pendingTrade?.state).toBe('TRADE_CANCELLED');
    expect(result.players['player2']!.hand.ore).toBe(2); // 変化なし
  });

  it('OFFER_TRADE は initiatorId に自分自身を指定できない', () => {
    const state = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      playerOrder: ['player1', 'player2'],
      currentPlayerIndex: 0,
      players: {
        player1: makePlayer('player1', { type: 'human', hand: makeHand({ wood: 2 }) }),
        player2: makePlayer('player2', { type: 'ai',   hand: makeHand({ ore: 2 }) }),
      },
    });
    expect(() => applyAction(state, {
      type: 'OFFER_TRADE',
      offer: { give: { wood: 1 }, receive: { ore: 1 } },
      targetPlayerIds: ['player1'], // 自分自身
    })).toThrow();
  });
});
