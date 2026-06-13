// ============================================================
// src/engine/scenarios.ts — 盤面シナリオ登録（基本／航海者）
// ============================================================
//
// 盤面生成を「シナリオ」として抽象化する。各シナリオは
//   - coords(): タイル座標集合（盤面幾何 buildBoardGeometry の入力）
//   - build(geo, rng): タイル種別・数字・港の割り当て
// を返す。既定は 'classic'（基本カタン）で、既存の生成（createRandomBoard）に委譲する
// ため挙動は不変。航海者は 'seafarers_*' として追加する。
//
// 注意: 純粋関数（DOM非依存）。createInitialGameState から使う。

import type { AxialCoord, Tile, TileId, TileType, Harbor, HarborType } from '../types';
import { getAllTileCoords, getHexRegion, tileId, parseTileId, edgeTileIds, type BoardGeometry } from './board';
import { createRandomBoard } from './setup';

export type ScenarioId = 'classic' | 'seafarers_newshores' | 'seafarers_archipelago';

export interface ScenarioBoard {
  tiles: Record<TileId, Tile>;
  harbors: Harbor[];
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly name: string;
  /** タイル座標集合（盤面幾何の生成に使う）。航海者の可変盤ではここを差し替える。 */
  coords(): AxialCoord[];
  /** 幾何確定後にタイル種別・数字・港を割り当てる。 */
  build(geo: BoardGeometry, rng: () => number): ScenarioBoard;
  /** 勝利に必要な勝利点。未指定は基本の VP_TABLE.target(10)。航海者は新島活用を促すため高め。 */
  readonly victoryTarget?: number;
}

// ---- 基本カタン（既定）。挙動は従来どおり createRandomBoard に委譲。 ----
const classic: Scenario = {
  id: 'classic',
  name: '基本',
  coords: () => getAllTileCoords(),
  build: (geo, rng) => createRandomBoard(geo, rng),
};

// 航海者マップは大きめの footprint（半径3＝29ヘックス）を使う。盤面は自動縮小して収まる。
const SEAFARERS_COORDS = (): ReturnType<typeof getHexRegion> => getHexRegion(3, 2, 3);

// ---- 航海者「新たな海岸を求めて」 ----
// 本島(左 q=-3..-1 = 12タイル)＋海峡(q=0列)＋新しい島(右 q=1..3 = 9タイル)。
//   左右の陸は海峡で隔てられ、新島へは船で渡る。新島の玄関口(1,-1)に金タイル。陸21タイル。
const NEW_SHORES_LAND: Record<string, { type: TileType; number: number | null; robber?: boolean }> = {
  // 本島（左 12）
  '-3,0':  { type: 'forest',   number: 8 },
  '-3,1':  { type: 'field',    number: 5 },
  '-3,2':  { type: 'pasture',  number: 10 },
  '-2,-1': { type: 'hill',     number: 9 },
  '-2,0':  { type: 'mountain', number: 4 },
  '-2,1':  { type: 'forest',   number: 11 },
  '-2,2':  { type: 'field',    number: 3 },
  '-1,-2': { type: 'pasture',  number: 6 },
  '-1,-1': { type: 'desert',   number: null, robber: true }, // 砂漠（盗賊初期位置）
  '-1,0':  { type: 'hill',     number: 2 },
  '-1,1':  { type: 'mountain', number: 9 },
  '-1,2':  { type: 'forest',   number: 10 },
  // 新しい島（右 9）。玄関口(1,-1)に金タイル。残り(0列・1,2・2,1・3,0)は海。
  '1,-2':  { type: 'field',    number: 4 },
  '1,-1':  { type: 'gold',     number: 8 },  // 金（任意資源）。新島の玄関口。
  '1,0':   { type: 'pasture',  number: 10 },
  '1,1':   { type: 'hill',     number: 5 },
  '2,-2':  { type: 'forest',   number: 9 },
  '2,-1':  { type: 'mountain', number: 3 },
  '2,0':   { type: 'field',    number: 11 },
  '3,-2':  { type: 'pasture',  number: 6 },
  '3,-1':  { type: 'hill',     number: 4 },
};

// 海岸線（陸1・海1 に面する辺）に港を決定論的に配置する。
// 各辺の2頂点は陸の沿岸頂点なので、そこに港を持たせる。港が密集しないよう
// 使用頂点とその隣接頂点を避けながら最大 max 個まで、種別をプールから順に割り当てる。
const HARBOR_POOL: HarborType[] = ['generic', 'wood', 'brick', 'generic', 'wool', 'grain', 'ore'];
function coastalHarbors(geo: BoardGeometry, tiles: Record<TileId, Tile>, max = 4): Harbor[] {
  const coastEdges = Object.values(geo.edges)
    .filter(e => {
      const tids = edgeTileIds(e, geo.vertices);
      return tids.length === 2 && tids.filter(t => tiles[t]?.type === 'sea').length === 1; // 陸1・海1＝海岸線
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1)); // 決定論的順序

  const harbors: Harbor[] = [];
  const used = new Set<string>();
  for (const e of coastEdges) {
    if (harbors.length >= max) break;
    const [va, vb] = e.vertexIds;
    const vA = geo.vertices[va];
    const vB = geo.vertices[vb];
    if (!vA || !vB) continue;
    // 使用済み頂点・その隣接頂点に被るなら避ける（港の密集を防ぐ）。
    if (used.has(va) || used.has(vb)) continue;
    if (vA.adjacentVertexIds.some(v => used.has(v)) || vB.adjacentVertexIds.some(v => used.has(v))) continue;
    const type = HARBOR_POOL[harbors.length % HARBOR_POOL.length]!;
    vA.harborType = type;
    vB.harborType = type;
    harbors.push({ id: `harbor_${harbors.length}`, type, vertexIds: [va, vb] });
    used.add(va);
    used.add(vb);
  }
  return harbors;
}

// 陸タイル定義表（タイルID→種別/数字/盗賊）から固定盤面を作る共通ビルダ。
// 表に無いタイルは海(sea)。19タイル footprint 内で陸塊を海で分離する航海者マップ用。
// 海岸線には港を自動配置する（沿岸開拓地の交易価値）。
type LandMap = Record<string, { type: TileType; number: number | null; robber?: boolean }>;
function buildFromLandMap(landMap: LandMap): (geo: BoardGeometry, rng: () => number) => ScenarioBoard {
  return (geo) => {
    const tiles: Record<TileId, Tile> = {};
    // 盤面の全タイル（シナリオの coords() が決めた footprint）を走査。表に無いタイルは海。
    for (const id of Object.keys(geo.tileToVertices)) {
      const coord = parseTileId(id);
      const land = landMap[id];
      tiles[id] = land
        ? { id, coord, type: land.type, number: land.number, hasRobber: !!land.robber }
        : { id, coord, type: 'sea', number: null, hasRobber: false }; // 表に無い＝海
    }
    return { tiles, harbors: coastalHarbors(geo, tiles) };
  };
}

const seafarersNewShores: Scenario = {
  id: 'seafarers_newshores',
  name: '航海者：新たな海岸を求めて',
  coords: SEAFARERS_COORDS,
  build: buildFromLandMap(NEW_SHORES_LAND),
  victoryTarget: 13,
};

// ---- 航海者「群島」（2つ目の盤面） ----
// 本島(左 12)＋海峡(q=0列)で隔てた右側を、r=0 の海列でさらに2つの新島に分割する。
//   新島A(右上 6・玄関口に金) / 新島B(右下 3)。島が3つあるため島ボーナス・金・航海の競争が core。
//   陸21タイル（本島12＋A6＋B3）。
const ARCHIPELAGO_LAND: LandMap = {
  // 本島（左 12）。全5資源が揃う自給島。砂漠=盗賊初期位置。
  '-3,0':  { type: 'pasture',  number: 9 },
  '-3,1':  { type: 'forest',   number: 5 },
  '-3,2':  { type: 'field',    number: 11 },
  '-2,-1': { type: 'mountain', number: 6 },
  '-2,0':  { type: 'hill',     number: 8 },
  '-2,1':  { type: 'forest',   number: 4 },
  '-2,2':  { type: 'pasture',  number: 3 },
  '-1,-2': { type: 'field',    number: 10 },
  '-1,-1': { type: 'desert',   number: null, robber: true },
  '-1,0':  { type: 'mountain', number: 5 },
  '-1,1':  { type: 'hill',     number: 9 },
  '-1,2':  { type: 'forest',   number: 11 },
  // 新島A（右上 6）。玄関口(1,-1)に金タイル。
  '1,-2':  { type: 'field',    number: 4 },
  '1,-1':  { type: 'gold',     number: 8 },  // 金（任意資源）
  '2,-2':  { type: 'forest',   number: 10 },
  '2,-1':  { type: 'mountain', number: 6 },
  '3,-2':  { type: 'pasture',  number: 3 },
  '3,-1':  { type: 'hill',     number: 5 },
  // 新島B（右下 3）。r=0 列(1,0)(2,0)(3,0)の海で A と分離。
  '1,1':   { type: 'hill',     number: 9 },
  '1,2':   { type: 'field',    number: 4 },
  '2,1':   { type: 'pasture',  number: 11 },
};

const seafarersArchipelago: Scenario = {
  id: 'seafarers_archipelago',
  name: '航海者：群島',
  coords: SEAFARERS_COORDS,
  build: buildFromLandMap(ARCHIPELAGO_LAND),
  victoryTarget: 13,
};

const SCENARIOS: Record<ScenarioId, Scenario> = {
  classic,
  seafarers_newshores: seafarersNewShores,
  seafarers_archipelago: seafarersArchipelago,
};

/** シナリオIDからシナリオ定義を取得（未知IDは基本にフォールバック）。 */
export function getScenario(id: ScenarioId = 'classic'): Scenario {
  return SCENARIOS[id] ?? classic;
}

/** UI/設定で使うシナリオ一覧（id, 表示名）。 */
export function listScenarios(): ReadonlyArray<{ id: ScenarioId; name: string }> {
  return (Object.keys(SCENARIOS) as ScenarioId[]).map(id => ({ id, name: SCENARIOS[id].name }));
}
