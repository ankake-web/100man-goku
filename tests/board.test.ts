import { describe, it, expect } from 'vitest';
import {
  getAllTileCoords,
  getTileNeighbors,
  axialToPixel,
  buildBoardGeometry,
  tileId,
  isDistanceRuleOk,
} from '../src/engine/board';

describe('getAllTileCoords', () => {
  it('returns exactly 19 tiles', () => {
    expect(getAllTileCoords()).toHaveLength(19);
  });

  it('all coords satisfy |q+r| <= 2', () => {
    getAllTileCoords().forEach(({ q, r }) => {
      expect(Math.abs(q + r)).toBeLessThanOrEqual(2);
    });
  });

  it('center tile (0,0) is included', () => {
    const ids = getAllTileCoords().map(c => tileId(c));
    expect(ids).toContain('0,0');
  });
});

describe('getTileNeighbors', () => {
  it('center tile has 6 neighbors', () => {
    expect(getTileNeighbors({ q: 0, r: 0 })).toHaveLength(6);
  });

  it('corner tile has 3 neighbors', () => {
    // (2,-2) は有効コーナータイル
    expect(getTileNeighbors({ q: 2, r: -2 })).toHaveLength(3);
  });

  it('all returned neighbors are valid tile coords', () => {
    getAllTileCoords().forEach(coord => {
      getTileNeighbors(coord).forEach(n => {
        expect(Math.abs(n.q + n.r)).toBeLessThanOrEqual(2);
      });
    });
  });
});

describe('axialToPixel', () => {
  it('center tile maps to (0, 0)', () => {
    const p = axialToPixel({ q: 0, r: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('tiles have unique pixel positions', () => {
    const positions = new Set(
      getAllTileCoords().map(c => {
        const p = axialToPixel(c);
        return `${Math.round(p.x)},${Math.round(p.y)}`;
      })
    );
    expect(positions.size).toBe(19);
  });
});

describe('buildBoardGeometry', () => {
  const geo = buildBoardGeometry();

  it('produces exactly 54 vertices', () => {
    expect(Object.keys(geo.vertices)).toHaveLength(54);
  });

  it('produces exactly 72 edges', () => {
    expect(Object.keys(geo.edges)).toHaveLength(72);
  });

  it('tileToVertices has 19 entries each with 6 vertex IDs', () => {
    const entries = Object.entries(geo.tileToVertices);
    expect(entries).toHaveLength(19);
    entries.forEach(([, vIds]) => {
      expect(vIds).toHaveLength(6);
    });
  });

  it('tileToEdges has 19 entries each with 6 edge IDs', () => {
    const entries = Object.entries(geo.tileToEdges);
    expect(entries).toHaveLength(19);
    entries.forEach(([, eIds]) => {
      expect(eIds).toHaveLength(6);
    });
  });

  it('all vertex IDs in tileToVertices exist in vertices map', () => {
    Object.values(geo.tileToVertices).flat().forEach(vid => {
      expect(geo.vertices[vid]).toBeDefined();
    });
  });

  it('all edge IDs in tileToEdges exist in edges map', () => {
    Object.values(geo.tileToEdges).flat().forEach(eid => {
      expect(geo.edges[eid]).toBeDefined();
    });
  });

  it('interior vertices (3 tiles) have 3 adjacent edges', () => {
    const interiorVertices = Object.values(geo.vertices).filter(
      v => v.adjacentTileIds.length === 3
    );
    interiorVertices.forEach(v => {
      expect(v.adjacentEdgeIds).toHaveLength(3);
    });
  });

  it('all vertices have at least 2 adjacent vertices', () => {
    Object.values(geo.vertices).forEach(v => {
      expect(v.adjacentVertexIds.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('each edge has exactly 2 vertex IDs', () => {
    Object.values(geo.edges).forEach(e => {
      expect(e.vertexIds).toHaveLength(2);
    });
  });

  it('each edge has 2-4 adjacent edges', () => {
    Object.values(geo.edges).forEach(e => {
      expect(e.adjacentEdgeIds.length).toBeGreaterThanOrEqual(2);
      expect(e.adjacentEdgeIds.length).toBeLessThanOrEqual(4);
    });
  });

  it('vertex adjacency is symmetric', () => {
    Object.values(geo.vertices).forEach(v => {
      v.adjacentVertexIds.forEach(nid => {
        const neighbor = geo.vertices[nid];
        expect(neighbor).toBeDefined();
        expect(neighbor!.adjacentVertexIds).toContain(v.id);
      });
    });
  });

  it('edge adjacency is symmetric', () => {
    Object.values(geo.edges).forEach(e => {
      e.adjacentEdgeIds.forEach(nid => {
        const neighbor = geo.edges[nid];
        expect(neighbor).toBeDefined();
        expect(neighbor!.adjacentEdgeIds).toContain(e.id);
      });
    });
  });
});

describe('isDistanceRuleOk', () => {
  it('returns true when all neighbors have no building', () => {
    const { vertices } = buildBoardGeometry();
    const anyVertex = Object.values(vertices)[0]!;
    expect(isDistanceRuleOk(anyVertex, vertices)).toBe(true);
  });

  it('returns false when a neighbor already has a building', () => {
    const { vertices } = buildBoardGeometry();
    const v = Object.values(vertices).find(v => v.adjacentVertexIds.length > 0)!;
    const neighborId = v.adjacentVertexIds[0]!;
    vertices[neighborId]!.building = { type: 'settlement', playerId: 'player1' };
    expect(isDistanceRuleOk(v, vertices)).toBe(false);
  });
});
