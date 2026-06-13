// ============================================================
// src/engine/board.ts — L-02: Hexグリッド生成・隣接計算
// ============================================================

import type {
  AxialCoord, Point,
  TileId, VertexId, EdgeId,
  Tile, Vertex, Edge,
} from '../types';
import { HEX_DIRECTIONS, HEX_SIZE } from '../constants';

// ============================================================
// 座標変換
// ============================================================

/** axial (q,r) → タイルID文字列 */
export function tileId(coord: AxialCoord): TileId {
  return `${coord.q},${coord.r}`;
}

/** タイルID → axial 座標 */
export function parseTileId(id: TileId): AxialCoord {
  const [q, r] = id.split(',').map(Number);
  return { q: q!, r: r! };
}

/**
 * Axial (q, r) → SVGピクセル座標（フラットトップ六角形）
 * フラットトップのため6方向は SE/NE/N/NW/SW/S になる。
 */
export function axialToPixel(coord: AxialCoord, size = HEX_SIZE): Point {
  const sqrt3 = Math.sqrt(3);
  return {
    x: size * 1.5 * coord.q,
    y: size * (sqrt3 / 2 * coord.q + sqrt3 * coord.r),
  };
}

// ============================================================
// グリッド列挙
// ============================================================

/**
 * カタンボード上の有効な全19タイル座標を返す。
 * 条件: |q| <= 2 && |r| <= 2 && |q+r| <= 2
 * 結果はq優先・r順でソートされる。
 */
export function getAllTileCoords(): AxialCoord[] {
  const coords: AxialCoord[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) <= 2) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

/**
 * 指定座標のタイルに隣接する有効なタイル座標一覧を返す。
 * ボード外（条件外）の座標は除外される。
 */
export function getTileNeighbors(coord: AxialCoord): AxialCoord[] {
  return HEX_DIRECTIONS
    .map(d => ({ q: coord.q + d.q, r: coord.r + d.r }))
    .filter(c => Math.abs(c.q) <= 2 && Math.abs(c.r) <= 2 && Math.abs(c.q + c.r) <= 2);
}

/** タイルが有効なボード範囲内かどうか */
export function isValidTileCoord(coord: AxialCoord): boolean {
  return Math.abs(coord.q) <= 2 && Math.abs(coord.r) <= 2 && Math.abs(coord.q + coord.r) <= 2;
}

// ============================================================
// ボードジオメトリ構築
// ============================================================

/**
 * フラットトップ六角形の6頂点ピクセル座標を返す。
 * 角度: 0°, 60°, 120°, 180°, 240°, 300° （時計回り）
 * corner[0] = 右、corner[1] = 右下、... corner[5] = 右上
 */
function hexCornerPixels(center: Point, size: number): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return {
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    };
  });
}

/**
 * ピクセル座標を文字列キーに変換する（頂点重複排除用）。
 * 1/100ピクセル精度で丸める。HEX_SIZE=60 では最小頂点間距離≈52px なので十分。
 */
function pixelKey(p: Point): string {
  return `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
}

/** EdgeId: 両端 VertexId をソートして "|" 連結 */
function makeEdgeId(va: VertexId, vb: VertexId): EdgeId {
  return [va, vb].sort().join('|');
}

export type BoardGeometry = {
  vertices: Record<VertexId, Vertex>;
  edges:    Record<EdgeId, Edge>;
  /** タイルID → そのタイルの6頂点ID（corner 0〜5 順） */
  tileToVertices: Record<TileId, VertexId[]>;
  /** タイルID → そのタイルの6辺ID（edge 0〜5 順, edge i は corner i と (i+1)%6 の間） */
  tileToEdges:    Record<TileId, EdgeId[]>;
};

/**
 * L-02 メイン関数: 空のカタンボードのジオメトリグラフを構築する。
 *
 * アルゴリズム概要（tech_spec.md §10参照）:
 *   1. 全19タイルを列挙
 *   2. 各タイルの6頂点をピクセル座標で算出
 *   3. ピクセルキーで重複排除 → 54頂点
 *   4. 隣接するcorner pair → Edge → 72辺
 *   5. 頂点↔頂点・頂点↔辺・辺↔辺 の隣接グラフを構築
 */
export function buildBoardGeometry(
  coords: readonly AxialCoord[] = getAllTileCoords(),
  size = HEX_SIZE,
): BoardGeometry {
  const pixelToVid = new Map<string, VertexId>();
  const vertices: Record<VertexId, Vertex> = {};
  const edges:    Record<EdgeId, Edge>     = {};
  const tileToVertices: Record<TileId, VertexId[]> = {};
  const tileToEdges:    Record<TileId, EdgeId[]>   = {};

  let vCounter = 0;

  // ---- Step 1-3: 頂点の重複排除と登録 ----
  // coords は任意のタイル座標集合（既定＝基本19タイル）。航海者の可変盤では
  // 海タイルを含むより大きい座標集合を渡す。
  for (const coord of coords) {
    const tid = tileId(coord);
    const center = axialToPixel(coord, size);
    const corners = hexCornerPixels(center, size);

    const vIds: VertexId[] = corners.map(corner => {
      const key = pixelKey(corner);

      if (!pixelToVid.has(key)) {
        const vid: VertexId = `v${vCounter++}`;
        pixelToVid.set(key, vid);
        vertices[vid] = {
          id:                 vid,
          pixel:              corner,
          adjacentTileIds:    [],
          adjacentEdgeIds:    [],
          adjacentVertexIds:  [],
          building:           null,
          harborType:         null,
        };
      }

      const vid = pixelToVid.get(key)!;
      const v = vertices[vid]!;
      if (!v.adjacentTileIds.includes(tid)) {
        v.adjacentTileIds.push(tid);
      }
      return vid;
    });

    tileToVertices[tid] = vIds;

    // ---- Step 4: 辺の構築 ----
    const eIds: EdgeId[] = vIds.map((va, i) => {
      const vb = vIds[(i + 1) % 6]!;
      const eid = makeEdgeId(va, vb);

      if (!edges[eid]) {
        const vA = vertices[va]!;
        const vB = vertices[vb]!;
        edges[eid] = {
          id:              eid,
          midpoint: {
            x: (vA.pixel.x + vB.pixel.x) / 2,
            y: (vA.pixel.y + vB.pixel.y) / 2,
          },
          vertexIds:        [va, vb],
          adjacentEdgeIds:  [],
          road:             null,
        };
      }
      return eid;
    });

    tileToEdges[tid] = eIds;
  }

  // ---- Step 5a: 頂点↔頂点・頂点↔辺 隣接 ----
  for (const edge of Object.values(edges)) {
    const [va, vb] = edge.vertexIds;
    const vA = vertices[va]!;
    const vB = vertices[vb]!;

    if (!vA.adjacentVertexIds.includes(vb)) vA.adjacentVertexIds.push(vb);
    if (!vB.adjacentVertexIds.includes(va)) vB.adjacentVertexIds.push(va);
    if (!vA.adjacentEdgeIds.includes(edge.id)) vA.adjacentEdgeIds.push(edge.id);
    if (!vB.adjacentEdgeIds.includes(edge.id)) vB.adjacentEdgeIds.push(edge.id);
  }

  // ---- Step 5b: 辺↔辺 隣接（共通頂点を持つ辺同士） ----
  for (const vertex of Object.values(vertices)) {
    const eIds = vertex.adjacentEdgeIds;
    for (let i = 0; i < eIds.length; i++) {
      for (let j = i + 1; j < eIds.length; j++) {
        const ei = edges[eIds[i]!]!;
        const ej = edges[eIds[j]!]!;
        if (!ei.adjacentEdgeIds.includes(ej.id)) ei.adjacentEdgeIds.push(ej.id);
        if (!ej.adjacentEdgeIds.includes(ei.id)) ej.adjacentEdgeIds.push(ei.id);
      }
    }
  }

  return { vertices, edges, tileToVertices, tileToEdges };
}

// ============================================================
// 空タイルセットの生成（L-03 のランダム配置前ベース）
// ============================================================

/** 指定座標集合（既定＝全19座標）の空タイル（type/number 未設定）マップを返す */
export function createEmptyTiles(
  coords: readonly AxialCoord[] = getAllTileCoords(),
): Record<TileId, Tile> {
  const tiles: Record<TileId, Tile> = {};
  for (const coord of coords) {
    const id = tileId(coord);
    tiles[id] = {
      id,
      coord,
      type:      'desert', // L-03でランダム割り当て
      number:    null,
      hasRobber: false,
    };
  }
  return tiles;
}

// ============================================================
// ユーティリティ: 距離・連結チェック（建設バリデーション用）
// ============================================================

/**
 * 2頂点が距離ルール（2頂点以上の距離）を満たすかチェックする。
 * 隣接頂点は距離1なので、adjacentVertexIds に含まれていれば NG。
 */
export function isDistanceRuleOk(
  v: Vertex,
  allVertices: Record<VertexId, Vertex>,
): boolean {
  return v.adjacentVertexIds.every(nid => {
    const neighbor = allVertices[nid];
    return neighbor == null || neighbor.building == null;
  });
}

/**
 * 指定辺が特定プレイヤーの道ネットワークに接続しているかチェックする。
 * 接続条件: 辺の頂点いずれかに自分の道または建物がある。
 */
export function isEdgeConnected(
  edge: Edge,
  playerId: string,
  vertices: Record<VertexId, Vertex>,
  edges:    Record<EdgeId, Edge>,
): boolean {
  return edge.vertexIds.some(vid => {
    const v = vertices[vid];
    if (!v) return false;

    // 自分の建物がある頂点は接続点
    if (v.building?.playerId === playerId) return true;

    // 自分の道が隣接辺にある
    return v.adjacentEdgeIds.some(eid => {
      const e = edges[eid];
      return e != null && e.id !== edge.id && e.road?.playerId === playerId;
    });
  });
}

// ============================================================
// 航海者拡張: 海/陸の判定とコマ種別を考慮した接続
// ============================================================

/** 辺が接するタイルID（1〜2個）。両端頂点の adjacentTileIds の積集合。 */
export function edgeTileIds(edge: Edge, vertices: Record<VertexId, Vertex>): TileId[] {
  const [a, b] = edge.vertexIds;
  const va = vertices[a];
  const vb = vertices[b];
  if (!va || !vb) return [];
  const setB = new Set(vb.adjacentTileIds);
  return va.adjacentTileIds.filter(t => setB.has(t));
}

/** 辺が海に面するか（船を置ける辺）。基本ゲームは海タイルが無いので常に false。 */
export function isSeaEdge(
  edge: Edge, vertices: Record<VertexId, Vertex>, tiles: Record<TileId, Tile>,
): boolean {
  return edgeTileIds(edge, vertices).some(t => tiles[t]?.type === 'sea');
}

/** 辺が陸に面するか（道を置ける辺）。基本ゲームは常に true。 */
export function isLandEdge(
  edge: Edge, vertices: Record<VertexId, Vertex>, tiles: Record<TileId, Tile>,
): boolean {
  return edgeTileIds(edge, vertices).some(t => { const ty = tiles[t]?.type; return ty != null && ty !== 'sea'; });
}

/** 頂点が陸に面するか（開拓地を置ける）。基本ゲームは常に true。 */
export function isLandVertex(vertex: Vertex, tiles: Record<TileId, Tile>): boolean {
  return vertex.adjacentTileIds.some(t => { const ty = tiles[t]?.type; return ty != null && ty !== 'sea'; });
}

/**
 * コマ種別（道/船）を考慮した接続判定。
 *   - 自分の建物（開拓地/都市）がある頂点ではどの種別とも接続できる（道↔船の切替点）。
 *   - 建物が無い頂点では、同種のコマ（道は道、船は船）のみ接続できる。
 */
export function isEdgeConnectedForPiece(
  edge: Edge,
  playerId: string,
  vertices: Record<VertexId, Vertex>,
  edges:    Record<EdgeId, Edge>,
  piece: 'road' | 'ship',
): boolean {
  return edge.vertexIds.some(vid => {
    const v = vertices[vid];
    if (!v) return false;
    if (v.building?.playerId === playerId) return true; // 建物は両種を接続
    return v.adjacentEdgeIds.some(eid => {
      if (eid === edge.id) return false;
      const e = edges[eid];
      if (!e) return false;
      return piece === 'road'
        ? e.road?.playerId === playerId
        : e.ship?.playerId === playerId;
    });
  });
}
