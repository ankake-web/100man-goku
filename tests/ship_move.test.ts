import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { applyAction } from '../src/engine/game';
import { canMoveShip } from '../src/engine/actions';
import { nearestMoveShipEdgeId } from '../src/renderer/events';
import { isSeaEdge, isLandVertex, isLandEdge } from '../src/engine/board';
import { makeHand } from '../src/constants';
import type { GameState, EdgeId, VertexId } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'human' },
];

const base = (): GameState =>
  createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');

// 海辺を2本以上持つ沿岸の陸頂点 V を探し、V に player1 の開拓地・1本目(e1)に船を置く。
// e2 は空きのままにする（V に錨を取った合法な移動先）。
function setupMovableShip(): { s: GameState; v: VertexId; e1: EdgeId; e2: EdgeId } {
  const g = base();
  for (const v of Object.values(g.vertices)) {
    if (!isLandVertex(v, g.tiles)) continue;
    const seaEdges = v.adjacentEdgeIds.filter(eid => isSeaEdge(g.edges[eid]!, g.vertices, g.tiles));
    if (seaEdges.length < 2) continue;
    const [e1, e2] = seaEdges as EdgeId[];
    const s: GameState = {
      ...g,
      phase: 'MAIN', turnPhase: 'TRADE_BUILD', setupSubPhase: null, currentPlayerIndex: 0,
      diceRolledThisTurn: true,
      vertices: { ...g.vertices, [v.id]: { ...v, building: { type: 'settlement', playerId: 'player1' } } },
      edges: { ...g.edges, [e1!]: { ...g.edges[e1!]!, ship: { playerId: 'player1' } } },
      players: { ...g.players, player1: { ...g.players.player1!, hand: makeHand() } },
    };
    return { s, v: v.id, e1: e1!, e2: e2! };
  }
  throw new Error('no coastal vertex with 2 sea edges found');
}

describe('航海者: 船の移動（航海・Phase 4）', () => {
  it('開放端の船を、建物に錨を取った別の海辺へ移動できる（コマ数不変・1ターン1回）', () => {
    const { s, e1, e2 } = setupMovableShip();
    expect(canMoveShip(s, 'player1', e1, e2)).toBe(true);

    const next = applyAction(s, { type: 'MOVE_SHIP', fromEdgeId: e1, toEdgeId: e2 });
    expect(next.edges[e1]!.ship).toBeNull();
    expect(next.edges[e2]!.ship?.playerId).toBe('player1');
    expect(next.shipMovedThisTurn).toBe(true);
    // 移動はコマ数を消費しない
    expect(next.players.player1!.remainingShips).toBe(s.players.player1!.remainingShips);

    // 1ターンに2回目の移動はできない
    expect(canMoveShip(next, 'player1', e2, e1)).toBe(false);
    expect(() => applyAction(next, { type: 'MOVE_SHIP', fromEdgeId: e2, toEdgeId: e1 })).toThrow();
  });

  it('END_TURN で shipMovedThisTurn がリセットされる', () => {
    const { s, e1, e2 } = setupMovableShip();
    const moved = applyAction(s, { type: 'MOVE_SHIP', fromEdgeId: e1, toEdgeId: e2 });
    expect(moved.shipMovedThisTurn).toBe(true);
    const ended = applyAction(moved, { type: 'END_TURN' });
    expect(ended.shipMovedThisTurn).toBe(false);
  });

  it('同じ辺・占有された辺・陸の辺へは移動できない', () => {
    const { s, e1, e2 } = setupMovableShip();
    expect(canMoveShip(s, 'player1', e1, e1)).toBe(false); // 同一辺
    // e2 を占有してから移動先に指定 → 不可
    const occupied: GameState = { ...s, edges: { ...s.edges, [e2]: { ...s.edges[e2]!, ship: { playerId: 'player2' } } } };
    expect(canMoveShip(occupied, 'player1', e1, e2)).toBe(false);
    // 陸だけに面する辺（道用）へは不可
    const landEdge = Object.values(s.edges).find(e => isLandEdge(e, s.vertices, s.tiles) && !isSeaEdge(e, s.vertices, s.tiles));
    if (landEdge) expect(canMoveShip(s, 'player1', e1, landEdge.id)).toBe(false);
  });

  it('開放端を持たない船（内側＝両端が建物/他の船）は移動できない', () => {
    // setupMovableShip の V に錨を取った e1 の船を、まず e2 にも置いて「V から2方向」にする。
    // すると V 発の各船の遠端が開放端なので、別の内側ケースを直接組む:
    // building(V)→e1→midV→e3 のチェーンを作り、e1(内側)を移動不可とする。
    const g = base();
    // V: 海辺2本以上の沿岸頂点
    const v = Object.values(g.vertices).find(vx =>
      isLandVertex(vx, g.tiles) && vx.adjacentEdgeIds.filter(eid => isSeaEdge(g.edges[eid]!, g.vertices, g.tiles)).length >= 1)!;
    const e1 = v.adjacentEdgeIds.find(eid => isSeaEdge(g.edges[eid]!, g.vertices, g.tiles))! as EdgeId;
    const midV = g.edges[e1]!.vertexIds.find(x => x !== v.id)! as VertexId;
    const e3 = g.vertices[midV]!.adjacentEdgeIds.find(eid =>
      eid !== e1 && isSeaEdge(g.edges[eid]!, g.vertices, g.tiles)) as EdgeId | undefined;
    if (!e3) return; // 幾何ガード（このシードでは通常存在）
    const s: GameState = {
      ...g,
      phase: 'MAIN', turnPhase: 'TRADE_BUILD', setupSubPhase: null, currentPlayerIndex: 0,
      vertices: { ...g.vertices, [v.id]: { ...v, building: { type: 'settlement', playerId: 'player1' } } },
      edges: {
        ...g.edges,
        [e1]: { ...g.edges[e1]!, ship: { playerId: 'player1' } },   // 内側（V↔midV）
        [e3]: { ...g.edges[e3]!, ship: { playerId: 'player1' } },   // 外側（midV↔…）
      },
    };
    // e1 は両端とも開放端でない（V=建物 / midV=他の自分の船 e3）→ 移動不可
    const anyTo = Object.keys(s.edges).find(to => canMoveShip(s, 'player1', e1, to));
    expect(anyTo).toBeUndefined();
  });

  it('UIの最近傍判定: from未選択は動かせる船、from選択後は移動先を返す', () => {
    const { s, e1, e2 } = setupMovableShip();
    const mid = (eid: EdgeId): { x: number; y: number } => {
      const [a, b] = s.edges[eid]!.vertexIds;
      const pa = s.vertices[a]!.pixel, pb = s.vertices[b]!.pixel;
      return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    };
    const p1 = mid(e1);
    expect(nearestMoveShipEdgeId(s, 'player1', null, p1.x, p1.y)).toBe(e1); // 動かせる船
    const p2 = mid(e2);
    expect(nearestMoveShipEdgeId(s, 'player1', e1, p2.x, p2.y)).toBe(e2); // 移動先
  });
});
