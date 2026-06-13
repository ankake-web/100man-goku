import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { calcLongestRoad } from '../src/engine/scoring';
import { isSeaEdge, isLandEdge, isLandVertex } from '../src/engine/board';
import type { GameState, EdgeId, VertexId } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'human' },
];
const base = (): GameState =>
  createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');

// 沿岸の陸頂点 V（空きの陸辺 L と海辺 S を1本ずつ持つ）を探す。
function coastVertex(g: GameState): { v: VertexId; land: EdgeId; sea: EdgeId } {
  for (const vx of Object.values(g.vertices)) {
    if (!isLandVertex(vx, g.tiles)) continue;
    const land = vx.adjacentEdgeIds.find(eid => isLandEdge(g.edges[eid]!, g.vertices, g.tiles) && !isSeaEdge(g.edges[eid]!, g.vertices, g.tiles));
    const sea = vx.adjacentEdgeIds.find(eid => isSeaEdge(g.edges[eid]!, g.vertices, g.tiles));
    if (land && sea) return { v: vx.id, land: land as EdgeId, sea: sea as EdgeId };
  }
  throw new Error('no coastal vertex with both a land and a sea edge');
}

describe('最長交易路: 道＋船の連続（航海者）', () => {
  it('自分の建物を切替点に、道→船を連続させて長さに算入する', () => {
    const g = base();
    const { v, land, sea } = coastVertex(g);
    const s: GameState = {
      ...g,
      vertices: { ...g.vertices, [v]: { ...g.vertices[v]!, building: { type: 'settlement', playerId: 'player1' } } },
      edges: {
        ...g.edges,
        [land]: { ...g.edges[land]!, road: { playerId: 'player1' } },
        [sea]:  { ...g.edges[sea]!, ship: { playerId: 'player1' } },
      },
    };
    // V(建物)で道↔船を切替できるので 道1 + 船1 = 2
    expect(calcLongestRoad(s, 'player1')).toBe(2);
  });

  it('建物の無い頂点では道と船は繋がらない（同種のみ）', () => {
    const g = base();
    const { v, land, sea } = coastVertex(g);
    // V に建物を置かない
    const s: GameState = {
      ...g,
      edges: {
        ...g.edges,
        [land]: { ...g.edges[land]!, road: { playerId: 'player1' } },
        [sea]:  { ...g.edges[sea]!, ship: { playerId: 'player1' } },
      },
    };
    // 切替不可 → 道だけ/船だけの最大 = 1
    expect(calcLongestRoad(s, 'player1')).toBe(1);
  });

  it('船だけでも連続経路として算入される', () => {
    const g = base();
    // 海辺を共有する2本の海辺（連続する船2隻）を探す。
    let pair: [EdgeId, EdgeId] | null = null;
    for (const vx of Object.values(g.vertices)) {
      const seas = vx.adjacentEdgeIds.filter(eid => isSeaEdge(g.edges[eid]!, g.vertices, g.tiles));
      if (seas.length >= 2) { pair = [seas[0] as EdgeId, seas[1] as EdgeId]; break; }
    }
    expect(pair).not.toBeNull();
    const [s1, s2] = pair!;
    const s: GameState = {
      ...g,
      edges: {
        ...g.edges,
        [s1]: { ...g.edges[s1]!, ship: { playerId: 'player1' } },
        [s2]: { ...g.edges[s2]!, ship: { playerId: 'player1' } },
      },
    };
    expect(calcLongestRoad(s, 'player1')).toBe(2);
  });
});
