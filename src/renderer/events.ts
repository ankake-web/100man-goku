// ============================================================
// src/renderer/events.ts — F-02: ボードクリックイベント処理
// ============================================================

import type { GameState, Action, PlayerId } from '../types';
import { canBuildRoad, canBuildSettlement, canBuildCity } from '../engine/actions';
import type { UIPhase } from './ui';
import type { BoardViewport } from './board';

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
    // 直前のパン/ピンチで動いた指のクリックは配置に使わない（誤配置防止）。
    if (consumeSuppressClick()) return;
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
// ピンチズーム＆パン（B-3）
// ============================================================

// パン/ピンチで指が動いた直後の click(配置) を1回だけ抑止する。
let pendingSuppressClick = false;
function consumeSuppressClick(): boolean {
  if (pendingSuppressClick) { pendingSuppressClick = false; return true; }
  return false;
}

const MIN_SCALE = 1;
const MAX_SCALE = 2.6;
const PAN_THRESHOLD = 8; // screen px。これ未満の1本指移動はタップ(配置)扱い。

/** ビューポートを範囲内に収める純粋関数。scale<=1 は中央(tx=ty=0)へ戻す。 */
export function clampViewport(vp: BoardViewport, vbW: number, vbH: number): BoardViewport {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale));
  if (scale <= 1) return { scale: 1, tx: 0, ty: 0 };
  const maxX = (vbW * (scale - 1)) / 2;
  const maxY = (vbH * (scale - 1)) / 2;
  return {
    scale,
    tx: Math.max(-maxX, Math.min(maxX, vp.tx)),
    ty: Math.max(-maxY, Math.min(maxY, vp.ty)),
  };
}

/**
 * 盤面のピンチズーム/パンを有効化する。viewport は main 側が永続保持する。
 * - 2本指: ピンチで拡縮（中心固定）＋midpoint移動でパン。
 * - 1本指: 拡大時(scale>1)のみパン。等倍ではタップ(配置)を優先。
 * - ホイール: PCの拡縮（任意）。
 * getScreenCTM 経由のヒット判定(events)は viewport 変換に自動追従する。
 */
export function attachBoardGestures(
  svg: SVGSVGElement,
  getViewport: () => BoardViewport,
  setViewport: (vp: BoardViewport) => void,
): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'none' | 'pan' | 'pinch' = 'none';
  let start = { x: 0, y: 0 };
  let last = { x: 0, y: 0 };
  let movedTotal = 0;
  let lastDist = 0;
  let lastMid = { x: 0, y: 0 };

  const vbDims = (): { w: number; h: number } => {
    const b = svg.viewBox?.baseVal;
    return { w: b?.width || 800, h: b?.height || 700 };
  };
  const screenScale = (): number => {
    const ctm = svg.getScreenCTM();
    return ctm && ctm.a ? ctm.a : 1;
  };
  const toVb = (x: number, y: number): { x: number; y: number } => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x, y };
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const r = p.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  };
  const applyLive = (vp: BoardViewport): void => {
    const g = svg.querySelector('.board-viewport') as SVGGElement | null;
    if (g) g.setAttribute('transform', `translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`);
  };
  const commit = (vp: BoardViewport): void => {
    const { w, h } = vbDims();
    const c = clampViewport(vp, w, h);
    setViewport(c);
    applyLive(c);
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // ピンチ中心(vbPoint)を固定したまま newScale へ拡縮した tx,ty を返す。
  const zoomAround = (vp: BoardViewport, newScale: number, vbPoint: { x: number; y: number }): BoardViewport => ({
    scale: newScale,
    tx: vbPoint.x - (vbPoint.x - vp.tx) * (newScale / vp.scale),
    ty: vbPoint.y - (vbPoint.y - vp.ty) * (newScale / vp.scale),
  });

  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      mode = 'none';
      start = last = { x: e.clientX, y: e.clientY };
      movedTotal = 0;
    } else if (pointers.size === 2) {
      mode = 'pinch';
      const pts = [...pointers.values()];
      lastDist = dist(pts[0]!, pts[1]!);
      lastMid = mid(pts[0]!, pts[1]!);
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === 'pinch' && pointers.size >= 2) {
      e.preventDefault();
      const pts = [...pointers.values()];
      const d = dist(pts[0]!, pts[1]!);
      const m = mid(pts[0]!, pts[1]!);
      if (lastDist > 0) {
        const vp = getViewport();
        let next = zoomAround(vp, vp.scale * (d / lastDist), toVb(m.x, m.y));
        const sc = screenScale();
        next = { scale: next.scale, tx: next.tx + (m.x - lastMid.x) / sc, ty: next.ty + (m.y - lastMid.y) / sc };
        commit(next);
      }
      lastDist = d; lastMid = m;
      return;
    }

    if (pointers.size === 1 && mode !== 'pinch') {
      movedTotal = Math.max(movedTotal, Math.hypot(e.clientX - start.x, e.clientY - start.y));
      const vp = getViewport();
      if (vp.scale > 1 && (mode === 'pan' || movedTotal > PAN_THRESHOLD)) {
        e.preventDefault();
        mode = 'pan';
        const sc = screenScale();
        commit({ scale: vp.scale, tx: vp.tx + (e.clientX - last.x) / sc, ty: vp.ty + (e.clientY - last.y) / sc });
      }
      last = { x: e.clientX, y: e.clientY };
    }
  }, { passive: false });

  const endPointer = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (mode === 'pan' || mode === 'pinch') pendingSuppressClick = true;
    if (pointers.size === 0) {
      mode = 'none';
    } else if (pointers.size === 1) {
      // ピンチ→1本指: 残り指でパン継続できるよう基準を更新。
      const only = [...pointers.values()][0]!;
      start = last = { x: only.x, y: only.y };
      movedTotal = 0;
      mode = 'none';
    }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  // PC: ホイールでカーソル位置中心に拡縮（任意）。
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const vp = getViewport();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    commit(zoomAround(vp, vp.scale * factor, toVb(e.clientX, e.clientY)));
  }, { passive: false });
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
