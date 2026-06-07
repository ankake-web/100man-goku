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

// タップ命中の許容半径（盤面ピクセル単位。頂点間隔は HEX_SIZE=60）。
// 見た目の点/線より広く取り、指でも外れにくくする。最近傍の合法ターゲットを選ぶため、
// 多少広めでも誤爆しない（より近い候補が優先される）。
const VERTEX_TAP_RADIUS = 38;
const EDGE_TAP_RADIUS = 26;

// ============================================================
// 配置フェーズ判定（純粋）
// ============================================================

function wantsSettlement(state: GameState, mode: BuildMode): boolean {
  const isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
  if (isSetup) return state.setupSubPhase === 'PLACE_SETTLEMENT';
  return state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD' && mode === 'settlement';
}
function wantsCity(state: GameState, mode: BuildMode): boolean {
  return state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD' && mode === 'city';
}
function wantsRoad(state: GameState, mode: BuildMode): boolean {
  const isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
  if (isSetup) return state.setupSubPhase === 'PLACE_ROAD';
  return state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD'
    && (mode === 'road' || state.roadBuildingRoadsRemaining > 0);
}

// ============================================================
// 最近傍の合法ターゲット探索（純粋・盤面ピクセル座標で判定）
// ============================================================

/** 点(x,y)に最も近い合法な開拓地/都市の頂点IDを maxDist 内で返す。なければ null。 */
export function nearestValidVertexId(
  state: GameState, pid: PlayerId, mode: BuildMode, x: number, y: number, maxDist = VERTEX_TAP_RADIUS,
): string | null {
  const city = wantsCity(state, mode);
  if (!city && !wantsSettlement(state, mode)) return null;
  let best: string | null = null;
  let bestD = maxDist * maxDist;
  for (const v of Object.values(state.vertices)) {
    const ok = city ? canBuildCity(state, pid, v.id) : canBuildSettlement(state, pid, v.id);
    if (!ok) continue;
    const dx = v.pixel.x - x, dy = v.pixel.y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = v.id; }
  }
  return best;
}

// 点(px,py)と線分(ax,ay)-(bx,by)の距離の二乗。
function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** 点(x,y)に最も近い合法な道の辺IDを maxDist 内で返す。なければ null。 */
export function nearestValidEdgeId(
  state: GameState, pid: PlayerId, mode: BuildMode, x: number, y: number, maxDist = EDGE_TAP_RADIUS,
): string | null {
  if (!wantsRoad(state, mode)) return null;
  let best: string | null = null;
  let bestD = maxDist * maxDist;
  for (const e of Object.values(state.edges)) {
    if (!canBuildRoad(state, pid, e.id)) continue;
    const a = state.vertices[e.vertexIds[0]];
    const b = state.vertices[e.vertexIds[1]];
    if (!a || !b) continue;
    const d = distToSegmentSq(x, y, a.pixel.x, a.pixel.y, b.pixel.x, b.pixel.y);
    if (d <= bestD) { bestD = d; best = e.id; }
  }
  return best;
}

// 画面座標(clientX/Y)を盤面ピクセル座標（vertex.pixel と同じ系）へ変換する。
// content グループの CTM 逆行列で content ローカル座標(=pixel+offset)に直し、offset を引く。
function clickToBoardPixel(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const content = svg.querySelector('.board-content') as SVGGElement | null;
  const ctm = content?.getScreenCTM();
  if (!content || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const local = pt.matrixTransform(ctm.inverse());
  const ox = Number(content.dataset.ox ?? 0);
  const oy = Number(content.dataset.oy ?? 0);
  return { x: local.x - ox, y: local.y - oy };
}

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
    const mode = getBuildMode();

    // ---- 盗賊フェーズ: タイル（大きいので closest で十分）----
    if (state.phase === 'MAIN' && state.turnPhase === 'ROBBER') {
      const tileEl = target.closest('[data-tile-id]');
      const tileId = tileEl?.getAttribute('data-tile-id');
      if (tileId) handleTileClick(tileId, state, pid, setUIPhase, dispatch);
      return;
    }

    // ---- 配置: タップ座標から最近傍の合法ターゲットへスナップ（指で外れにくく）----
    const pt = clickToBoardPixel(svg, e.clientX, e.clientY);
    if (pt) {
      const vid = nearestValidVertexId(state, pid, mode, pt.x, pt.y);
      if (vid) { placeVertex(vid, state, pid, mode, setUIPhase, dispatch); return; }
      const eid = nearestValidEdgeId(state, pid, mode, pt.x, pt.y);
      if (eid) { placeEdge(eid, state, pid, mode, setUIPhase, dispatch); return; }
    }

    // ---- フォールバック: 直接ヒットした要素（マウスの精密クリック等）----
    const vertexEl = target.closest('[data-vertex-id]');
    if (vertexEl) {
      const vertexId = vertexEl.getAttribute('data-vertex-id');
      if (vertexId) placeVertex(vertexId, state, pid, mode, setUIPhase, dispatch);
      return;
    }
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute('data-edge-id');
      if (edgeId) placeEdge(edgeId, state, pid, mode, setUIPhase, dispatch);
    }
  });
}

// 配置タップで確認ステップを挟むか（誤配置防止）。タッチ端末のみ。マウスは即配置。
function requireConfirm(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

// 頂点への配置: タッチなら仮置きプレビュー（確定待ち）、マウスなら即配置。
function placeVertex(
  vid: string, state: GameState, pid: PlayerId, mode: BuildMode,
  setUIPhase: (p: UIPhase) => void, dispatch: (a: Action) => void,
): void {
  const action = resolveVertexAction(state, pid, mode, vid);
  if (!action) return;
  if (requireConfirm()) {
    setUIPhase({ type: 'placePreview', kind: action.type === 'BUILD_CITY' ? 'city' : 'settlement', targetId: vid });
  } else {
    dispatch(action);
  }
}

// 辺への配置: タッチなら仮置きプレビュー、マウスなら即配置。
function placeEdge(
  eid: string, state: GameState, pid: PlayerId, mode: BuildMode,
  setUIPhase: (p: UIPhase) => void, dispatch: (a: Action) => void,
): void {
  const action = resolveEdgeAction(state, pid, mode, eid);
  if (!action) return;
  if (requireConfirm()) {
    setUIPhase({ type: 'placePreview', kind: 'road', targetId: eid });
  } else {
    dispatch(action);
  }
}

// 仮置きプレビューを確定して実アクションへ変換する（main.ts の確認バーから呼ぶ）。
export function resolvePlacePreviewAction(
  state: GameState, pid: PlayerId, kind: 'settlement' | 'city' | 'road', targetId: string,
): Action | null {
  if (kind === 'road') return resolveEdgeAction(state, pid, 'road', targetId);
  return resolveVertexAction(state, pid, kind, targetId);
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

// 頂点タップに対応する建設アクション（合法なら）を返す。なければ null。
function resolveVertexAction(state: GameState, pid: PlayerId, mode: BuildMode, vertexId: string): Action | null {
  const isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
  if (isSetup && state.setupSubPhase === 'PLACE_SETTLEMENT') {
    return canBuildSettlement(state, pid, vertexId) ? { type: 'BUILD_SETTLEMENT', vertexId } : null;
  }
  if (state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD') {
    if (mode === 'settlement' && canBuildSettlement(state, pid, vertexId)) return { type: 'BUILD_SETTLEMENT', vertexId };
    if (mode === 'city' && canBuildCity(state, pid, vertexId)) return { type: 'BUILD_CITY', vertexId };
  }
  return null;
}

// 辺タップに対応する道アクション（合法なら）を返す。なければ null。
function resolveEdgeAction(state: GameState, pid: PlayerId, mode: BuildMode, edgeId: string): Action | null {
  const isSetup = state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD';
  if (isSetup && state.setupSubPhase === 'PLACE_ROAD') {
    return canBuildRoad(state, pid, edgeId) ? { type: 'BUILD_ROAD', edgeId } : null;
  }
  if (state.phase === 'MAIN' && state.turnPhase === 'TRADE_BUILD') {
    if ((mode === 'road' || state.roadBuildingRoadsRemaining > 0) && canBuildRoad(state, pid, edgeId)) {
      return { type: 'BUILD_ROAD', edgeId };
    }
  }
  return null;
}
