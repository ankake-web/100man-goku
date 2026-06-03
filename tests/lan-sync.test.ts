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
