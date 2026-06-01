// ============================================================
// src/renderer/events.ts — F-02: ボードクリックイベント処理
// ============================================================

import type { GameState, Action, PlayerId } from '../types';
import { canBuildRoad, canBuildSettlement, canBuildCity } from '../engine/actions';
import type { UIPhase } from './ui';

// ============================================================
// 型定義
// ============================================================

export type BuildMode = 'idle' | 'road' | 'settlement' | 'city';

// ============================================================
// イベント登録（一度だけ呼ぶ）
// ============================================================

export function attachBoardEvents(
  svg: SVGSVGElement,
  getState: () => GameState,
  getBuildMode: () => BuildMode,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (action: Action) => void,
): void {
  svg.addEventListener('click', (e) => {
    const target = e.target as SVGElement;
    const state = getState();
    const pid = state.playerOrder[state.currentPlayerIndex]!;

    // ---- タイルクリック ----
    const tileEl = target.closest('[data-tile-id]');
    if (tileEl) {
      const tileId = tileEl.getAttribute('data-tile-id');
      if (!tileId) return;
      handleTileClick(tileId, state, pid, setUIPhase, dispatch);
      return;
    }

    // ---- 頂点クリック ----
    const vertexEl = target.closest('[data-vertex-id]');
    if (vertexEl) {
      const vertexId = vertexEl.getAttribute('data-vertex-id');
      if (!vertexId) return;
      handleVertexClick(vertexId, state, pid, getBuildMode(), dispatch);
      return;
    }

    // ---- 辺クリック ----
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute('data-edge-id');
      if (!edgeId) return;
      handleEdgeClick(edgeId, state, pid, getBuildMode(), dispatch);
      return;
    }
  });
}

// ============================================================
// 個別ハンドラ
// ============================================================

function handleTileClick(
  tileId: string,
  state: GameState,
  pid: PlayerId,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): void {
  if (state.phase !== 'MAIN' || state.turnPhase !== 'ROBBER') return;

  const currentRobberTile = Object.values(state.tiles).find(t => t.hasRobber);
  if (currentRobberTile?.id === tileId) return;

  const vertexIds = state.tileToVertices[tileId] ?? [];
  const opponents = [...new Set(
    vertexIds
      .map(vid => state.vertices[vid]?.building?.playerId)
      .filter((p): p is PlayerId => p != null && p !== pid),
  )];

  if (opponents.length <= 1) {
    // 0人または1人：即座にディスパッチ
    dispatch({
      type: 'MOVE_ROBBER',
      tileId,
      stealFromPlayerId: opponents[0] ?? null,
    });
  } else {
    // 複数の相手がいる場合：UIで選択させる
    setUIPhase({ type: 'robberTarget', tileId, opponents });
  }
}

function handleVertexClick(
  vertexId: string,
  state: GameState,
  pid: PlayerId,
  mode: BuildMode,
  dispatch: (a: Action) => void,
): void {
  const isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';

  if (isSetup && state.setupSubPhase === 'PLACE_SETTLEMENT') {
    if (canBuildSettlement(state, pid, vertexId)) {
      dispatch({ type: 'BUILD_SETTLEMENT', vertexId });
    }
    return;
  }

  if (state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD') {
    if (mode === 'settlement' && canBuildSettlement(state, pid, vertexId)) {
      dispatch({ type: 'BUILD_SETTLEMENT', vertexId });
    } else if (mode === 'city' && canBuildCity(state, pid, vertexId)) {
      dispatch({ type: 'BUILD_CITY', vertexId });
    }
  }
}

function handleEdgeClick(
  edgeId: string,
  state: GameState,
  pid: PlayerId,
  mode: BuildMode,
  dispatch: (a: Action) => void,
): void {
  const isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';

  if (isSetup && state.setupSubPhase === 'PLACE_ROAD') {
    if (canBuildRoad(state, pid, edgeId)) {
      dispatch({ type: 'BUILD_ROAD', edgeId });
    }
    return;
  }

  if (state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD') {
    if (mode === 'road' && canBuildRoad(state, pid, edgeId)) {
      dispatch({ type: 'BUILD_ROAD', edgeId });
    }
  }
}
