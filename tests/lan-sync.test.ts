import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { applyAction } from '../src/engine/game';
import { maskStateFor } from '../src/engine/mask';
import { createRng } from '../src/engine/setup';
import { canBuildSettlement, canBuildRoad } from '../src/engine/actions';
import { RESOURCE_TYPES } from '../src/constants';
import type { GameState, Action, PlayerId } from '../src/types';

// サーバ(lanServer)の action 処理と同じ「操作権限 actor 判定」を再現する。
function requiredActor(state: GameState, action: Action): PlayerId | null {
  switch (action.type) {
    case 'DISCARD_RESOURCES': return action.playerId;
    case 'RESPOND_TRADE':     return action.response.playerId;
    default:                  return state.playerOrder[state.currentPlayerIndex] ?? null;
  }
}

// サーバの権威適用を模倣: actor 検証 → applyAction。拒否時は state 据え置き。
function serverApply(state: GameState, senderId: PlayerId, action: Action, rng: () => number): GameState {
  if (requiredActor(state, action) !== senderId) return state; // 非手番/別IDは無視
  return applyAction(state, action, rng);
}

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'human' },
];

const cur = (s: GameState) => s.playerOrder[s.currentPlayerIndex]!;
const handTotal = (s: GameState, p: PlayerId) =>
  RESOURCE_TYPES.reduce((sum, r) => sum + s.players[p]!.hand[r], 0);

// 現在の手番プレイヤーが置ける頂点/辺を masked state から探す（盤面は公開情報）。
function firstValidVertex(s: GameState, p: PlayerId): string | undefined {
  return Object.keys(s.vertices).find(v => canBuildSettlement(s, p, v));
}
function firstValidEdge(s: GameState, p: PlayerId): string | undefined {
  return Object.keys(s.edges).find(e => canBuildRoad(s, p, e));
}

// 初期配置を最後まで（サーバ権威で）進める。
function runSetup(state: GameState, rng: () => number): GameState {
  let s = state;
  for (let i = 0; i < 100 && s.phase !== 'MAIN'; i++) {
    const p = cur(s);
    if (s.setupSubPhase === 'PLACE_SETTLEMENT') {
      const v = firstValidVertex(s, p)!;
      s = serverApply(s, p, { type: 'BUILD_SETTLEMENT', vertexId: v }, rng);
    } else {
      const e = firstValidEdge(s, p)!;
      s = serverApply(s, p, { type: 'BUILD_ROAD', edgeId: e }, rng);
    }
  }
  return s;
}

describe('LAN server-authoritative sync (MVP3)', () => {
  it('runs initial placement in the correct turn order (forward then backward)', () => {
    const s0 = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7));
    const order: { pid: PlayerId; sub: string }[] = [];
    let s = s0;
    for (let i = 0; i < 100 && s.phase !== 'MAIN'; i++) {
      const p = cur(s);
      order.push({ pid: p, sub: s.setupSubPhase! });
      if (s.setupSubPhase === 'PLACE_SETTLEMENT') {
        s = serverApply(s, p, { type: 'BUILD_SETTLEMENT', vertexId: firstValidVertex(s, p)! }, createRng(1));
      } else {
        s = serverApply(s, p, { type: 'BUILD_ROAD', edgeId: firstValidEdge(s, p)! }, createRng(1));
      }
    }
    // 2人: P1 settle/road, P2 settle/road, P2 settle/road, P1 settle/road
    expect(order.map(o => o.pid)).toEqual([
      'player1', 'player1', 'player2', 'player2',
      'player2', 'player2', 'player1', 'player1',
    ]);
    expect(s.phase).toBe('MAIN');
  });

  it('rejects actions from a non-current player (permission check)', () => {
    const s0 = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7));
    const p = cur(s0); // player1
    const other = s0.playerOrder.find(x => x !== p)!; // player2
    // 非手番 player2 が配置を試みる → 無視され state は不変
    const v = firstValidVertex(s0, p)!;
    const after = serverApply(s0, other, { type: 'BUILD_SETTLEMENT', vertexId: v }, createRng(1));
    expect(after).toBe(s0); // 据え置き
    // 手番 player1 なら適用される
    const ok = serverApply(s0, p, { type: 'BUILD_SETTLEMENT', vertexId: v }, createRng(1));
    expect(ok).not.toBe(s0);
    expect(ok.vertices[v]!.building?.playerId).toBe(p);
  });

  it('distributes second-settlement starting resources', () => {
    const s = runSetup(createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7)), createRng(1));
    // 2巡目開拓地で各プレイヤーに初期資源が配られる（>0）。
    expect(handTotal(s, 'player1')).toBeGreaterThan(0);
    expect(handTotal(s, 'player2')).toBeGreaterThan(0);
  });

  it('rolls dice on the server and yields the same result for all viewers', () => {
    let s = runSetup(createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7)), createRng(1));
    expect(s.turnPhase).toBe('PRE_ROLL');
    const roller = cur(s);
    s = serverApply(s, roller, { type: 'ROLL_DICE' }, createRng(123));
    expect(s.lastDiceRoll).not.toBeNull();
    // 各視点へ配信する masked state は同じ出目を持つ（出目は公開情報）。
    const viewA = maskStateFor(s, 'player1');
    const viewB = maskStateFor(s, 'player2');
    expect(viewA.lastDiceRoll).toEqual(s.lastDiceRoll);
    expect(viewB.lastDiceRoll).toEqual(s.lastDiceRoll);
    expect(viewA.lastDiceRoll).toEqual(viewB.lastDiceRoll);
  });

  it('advances to the next player on END_TURN and only the new current player may act', () => {
    let s = runSetup(createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7)), createRng(1));
    // 7 が出ると分岐が複雑になるので、7以外が出るシードを探す
    let seed = 1;
    let rolled = s;
    do { rolled = serverApply(s, cur(s), { type: 'ROLL_DICE' }, createRng(seed++)); }
    while (rolled.lastDiceRoll![0] + rolled.lastDiceRoll![1] === 7 && seed < 50);
    s = rolled;
    expect(s.turnPhase).toBe('TRADE_BUILD');
    const before = cur(s);
    s = serverApply(s, before, { type: 'END_TURN' }, createRng(1));
    const after = cur(s);
    expect(after).not.toBe(before);
    // 旧プレイヤーの END_TURN は無視（手番は進まない）
    const noop = serverApply(s, before, { type: 'END_TURN' }, createRng(1));
    expect(cur(noop)).toBe(after);
  });

  it('masks opponent hands in the distributed state after resources are gained', () => {
    const s = runSetup(createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7)), createRng(1));
    const viewForP1 = maskStateFor(s, 'player1');
    // P1 視点: 自分(P1)の手札は実数、相手(P2)は構成0＋handCount
    expect(handTotal(viewForP1, 'player1')).toBe(handTotal(s, 'player1'));
    expect(RESOURCE_TYPES.reduce((a, r) => a + viewForP1.players.player2!.hand[r], 0)).toBe(0);
    expect(viewForP1.players.player2!.handCount).toBe(handTotal(s, 'player2'));
  });
});

// ============================================================
// MVP4: 交易 / 捨て札 / 盗賊 / 発展カード / 勝利の同期
// ============================================================

import { makeHand } from '../src/constants';

// サーバの追加検証（lanServer）を反映: 交易応答の対象チェック・捨て札枚数チェック。
function serverGuard(state: GameState, senderId: PlayerId, action: Action): boolean {
  if (requiredActor(state, action) !== senderId) return false;
  if (action.type === 'RESPOND_TRADE') {
    const pt = state.pendingTrade;
    if (!pt || !pt.targetPlayerIds.includes(action.response.playerId)) return false;
  }
  if (action.type === 'DISCARD_RESOURCES') {
    const p = state.players[action.playerId];
    if (!p) return false;
    const total = RESOURCE_TYPES.reduce((s, r) => s + p.hand[r], 0);
    const required = Math.floor(total / 2);
    const sum = RESOURCE_TYPES.reduce((s, r) => s + (action.resources[r] ?? 0), 0);
    const within = RESOURCE_TYPES.every(r => (action.resources[r] ?? 0) >= 0 && (action.resources[r] ?? 0) <= p.hand[r]);
    if (total < 8 || sum !== required || !within) return false;
  }
  return true;
}
function fullServerApply(state: GameState, senderId: PlayerId, action: Action, rng: () => number): GameState {
  if (!serverGuard(state, senderId, action)) return state;
  // サーバは applyAction の例外（無効操作）を握りつぶし state を据え置く。
  try {
    return applyAction(state, action, rng);
  } catch {
    return state;
  }
}

// MAIN / TRADE_BUILD 状態を作る（手札を直接設定）。current = player1。
function tradeReadyState(p1: Partial<Record<string, number>>, p2: Partial<Record<string, number>>): GameState {
  const base = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7));
  return {
    ...base,
    phase: 'MAIN',
    turnPhase: 'TRADE_BUILD',
    diceRolledThisTurn: true,
    players: {
      ...base.players,
      player1: { ...base.players.player1!, hand: makeHand(p1) },
      player2: { ...base.players.player2!, hand: makeHand(p2) },
    },
  };
}

describe('LAN MVP4 sync: trade', () => {
  it('offer -> accept -> confirm swaps resources between the two players', () => {
    let s = tradeReadyState({ wood: 2 }, { brick: 2 });
    s = fullServerApply(s, 'player1', { type: 'OFFER_TRADE', offer: { give: { wood: 1 }, receive: { brick: 1 } }, targetPlayerIds: ['player2'] }, createRng(1));
    expect(s.pendingTrade).not.toBeNull();
    s = fullServerApply(s, 'player2', { type: 'RESPOND_TRADE', response: { playerId: 'player2', status: 'ACCEPT' } }, createRng(1));
    expect(s.pendingTrade!.state).toBe('TRADE_RESPONSE');
    s = fullServerApply(s, 'player1', { type: 'CONFIRM_TRADE', responderId: 'player2' }, createRng(1));
    expect(s.pendingTrade).toBeNull();
    expect(s.players.player1!.hand.wood).toBe(1);
    expect(s.players.player1!.hand.brick).toBe(1);
    expect(s.players.player2!.hand.brick).toBe(1);
    expect(s.players.player2!.hand.wood).toBe(1);
  });

  it('rejects responses from a non-target and confirm from a non-initiator', () => {
    let s = tradeReadyState({ wood: 2 }, { brick: 2 });
    s = fullServerApply(s, 'player1', { type: 'OFFER_TRADE', offer: { give: { wood: 1 }, receive: { brick: 1 } }, targetPlayerIds: ['player2'] }, createRng(1));
    // player1（提案者・非対象）が応答 → 拒否され不変
    const noop = fullServerApply(s, 'player1', { type: 'RESPOND_TRADE', response: { playerId: 'player1', status: 'ACCEPT' } }, createRng(1));
    expect(noop.pendingTrade!.responses.player1).toBeUndefined();
    // player2 が confirm を試みる（提案者でない）→ requiredActor=current(player1) で拒否
    s = fullServerApply(s, 'player2', { type: 'RESPOND_TRADE', response: { playerId: 'player2', status: 'ACCEPT' } }, createRng(1));
    const noConfirm = fullServerApply(s, 'player2', { type: 'CONFIRM_TRADE', responderId: 'player2' }, createRng(1));
    expect(noConfirm.pendingTrade).not.toBeNull(); // まだ成立していない
  });

  it('a rejected trade can be cancelled by the initiator', () => {
    let s = tradeReadyState({ wood: 2 }, { brick: 2 });
    s = fullServerApply(s, 'player1', { type: 'OFFER_TRADE', offer: { give: { wood: 1 }, receive: { brick: 1 } }, targetPlayerIds: ['player2'] }, createRng(1));
    s = fullServerApply(s, 'player2', { type: 'RESPOND_TRADE', response: { playerId: 'player2', status: 'REJECT' } }, createRng(1));
    s = fullServerApply(s, 'player1', { type: 'CANCEL_TRADE' }, createRng(1));
    expect(s.pendingTrade).toBeNull();
    // 手札は不変
    expect(s.players.player1!.hand.wood).toBe(2);
    expect(s.players.player2!.hand.brick).toBe(2);
  });
});

describe('LAN MVP4 sync: discard count validation', () => {
  it('accepts exactly half and rejects wrong amounts', () => {
    // player1 に 8 枚持たせて DISCARD フェーズへ
    const base = tradeReadyState({ wood: 8 }, {});
    const s: GameState = { ...base, turnPhase: 'DISCARD', discardedThisRound: [] };
    // 過少(3枚)は拒否
    expect(serverGuard(s, 'player1', { type: 'DISCARD_RESOURCES', playerId: 'player1', resources: { wood: 3 } })).toBe(false);
    // 過剰(5枚)は拒否
    expect(serverGuard(s, 'player1', { type: 'DISCARD_RESOURCES', playerId: 'player1', resources: { wood: 5 } })).toBe(false);
    // ちょうど半分(4枚)は許可
    expect(serverGuard(s, 'player1', { type: 'DISCARD_RESOURCES', playerId: 'player1', resources: { wood: 4 } })).toBe(true);
    // 所持を超える資源は拒否
    expect(serverGuard(s, 'player1', { type: 'DISCARD_RESOURCES', playerId: 'player1', resources: { brick: 4 } })).toBe(false);
    // 他人が player1 の捨て札を送る → actor 不一致で拒否
    expect(serverGuard(s, 'player2', { type: 'DISCARD_RESOURCES', playerId: 'player1', resources: { wood: 4 } })).toBe(false);
  });
});

describe('LAN MVP4 sync: dev card (monopoly) keeps opponent hands masked', () => {
  it('monopoly result is applied server-side and masked per viewer', () => {
    const base = tradeReadyState({ wool: 1 }, { wool: 3 });
    // player1 に独占カード（前ターン購入＝使用可）を持たせる
    const s0: GameState = {
      ...base,
      globalTurnNumber: 3,           // 購入ターン(0) < 現在(3) ＝ 使用可能
      devCardPlayedThisTurn: false,
      players: {
        ...base.players,
        player1: { ...base.players.player1!, devCards: [{ id: 'm1', type: 'monopoly', purchasedOnTurn: 0 }] },
      },
    };
    const s = fullServerApply(s0, 'player1', { type: 'PLAY_MONOPOLY', resource: 'wool' }, createRng(1));
    // player1 が全員の wool を独占（1 + 3 = 4）
    expect(s.players.player1!.hand.wool).toBe(4);
    expect(s.players.player2!.hand.wool).toBe(0);
    // 配信マスク: player2 視点では player1 の手札中身は隠れる
    const viewP2 = maskStateFor(s, 'player2');
    expect(RESOURCE_TYPES.reduce((a, r) => a + viewP2.players.player1!.hand[r], 0)).toBe(0);
    expect(viewP2.players.player1!.handCount).toBe(4);
  });
});

describe('LAN MVP4 sync: victory', () => {
  it('DECLARE_VICTORY needs enough VP and is rejected otherwise; winner revealed at GAME_OVER', () => {
    const base = tradeReadyState({}, {});
    // VP不足では宣言できない
    const noWin = fullServerApply(base, 'player1', { type: 'DECLARE_VICTORY' }, createRng(1));
    expect(noWin.phase).toBe('MAIN');
    // 勝者の隠しVPカードを持たせ、十分なVPで宣言（VPカードで target 到達を再現）
    const vpCards = Array.from({ length: 10 }, (_, i) => ({ id: `vp${i}`, type: 'victory_point' as const, purchasedOnTurn: 0 }));
    const rich: GameState = { ...base, players: { ...base.players, player1: { ...base.players.player1!, devCards: vpCards } } };
    const won = fullServerApply(rich, 'player1', { type: 'DECLARE_VICTORY' }, createRng(1));
    expect(won.phase).toBe('GAME_OVER');
    expect(won.winner).toBe('player1');
    // GAME_OVER では勝者(player1)は他視点にも公開され、VPカードが見える
    const viewP2 = maskStateFor(won, 'player2');
    expect(viewP2.players.player1!.devCards.length).toBe(10);
  });
});
