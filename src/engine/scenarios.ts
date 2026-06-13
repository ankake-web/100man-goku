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

import type { AxialCoord, Tile, TileId, TileType, Harbor } from '../types';
import { getAllTileCoords, tileId, type BoardGeometry } from './board';
import { createRandomBoard } from './setup';

export type ScenarioId = 'classic' | 'seafarers_newshores';

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
}

// ---- 基本カタン（既定）。挙動は従来どおり createRandomBoard に委譲。 ----
const classic: Scenario = {
  id: 'classic',
  name: '基本',
  coords: () => getAllTileCoords(),
  build: (geo, rng) => createRandomBoard(geo, rng),
};

// ---- 航海者「新たな海岸を求めて」簡易版（Phase 1） ----
// 既存の盤面viewBoxに収めるため19タイル footprint のまま、二つの陸塊を海峡(q=0列)で分離する:
//   左(q=-2,-1)=本島7タイル / 中央(q=0)=海峡 / 右(q=1,2)=新しい島4タイル。
//   左右の陸は隣接しない（間が海）ため、新しい島へは船で渡る必要がある。
//   金タイル・海賊・島ボーナスVP・最長交易路への船算入は後続フェーズ（docs/seafarers_plan.md）。
const NEW_SHORES_LAND: Record<string, { type: TileType; number: number | null; robber?: boolean }> = {
  // 本島（左）
  '-2,0':  { type: 'field',    number: 5 },
  '-2,1':  { type: 'forest',   number: 9 },
  '-2,2':  { type: 'pasture',  number: 6 },
  '-1,-1': { type: 'hill',     number: 10 },
  '-1,0':  { type: 'desert',   number: null, robber: true }, // 砂漠（盗賊初期位置）
  '-1,1':  { type: 'mountain', number: 8 },
  '-1,2':  { type: 'forest',   number: 4 },
  // 新しい島（右）
  '1,-1':  { type: 'field',    number: 3 },
  '1,0':   { type: 'pasture',  number: 11 },
  '2,-1':  { type: 'forest',   number: 12 },
  '2,0':   { type: 'hill',     number: 2 },
};

const seafarersNewShores: Scenario = {
  id: 'seafarers_newshores',
  name: '航海者：新たな海岸を求めて',
  coords: () => getAllTileCoords(),
  build: () => {
    const tiles: Record<TileId, Tile> = {};
    for (const coord of getAllTileCoords()) {
      const id = tileId(coord);
      const land = NEW_SHORES_LAND[id];
      tiles[id] = land
        ? { id, coord, type: land.type, number: land.number, hasRobber: !!land.robber }
        : { id, coord, type: 'sea', number: null, hasRobber: false }; // 外周＝海
    }
    // 港・船・島勝利は後フェーズ。Phase 0 は盤面の土台のみ。
    return { tiles, harbors: [] };
  },
};

const SCENARIOS: Record<ScenarioId, Scenario> = {
  classic,
  seafarers_newshores: seafarersNewShores,
};

/** シナリオIDからシナリオ定義を取得（未知IDは基本にフォールバック）。 */
export function getScenario(id: ScenarioId = 'classic'): Scenario {
  return SCENARIOS[id] ?? classic;
}

/** UI/設定で使うシナリオ一覧（id, 表示名）。 */
export function listScenarios(): ReadonlyArray<{ id: ScenarioId; name: string }> {
  return (Object.keys(SCENARIOS) as ScenarioId[]).map(id => ({ id, name: SCENARIOS[id].name }));
}
