// ============================================================
// tests/events.test.ts — B-1 タップ命中精度（最近傍の合法ターゲット選択）
// ============================================================
//
// 盤面ピクセル座標から最も近い合法な頂点/辺を選ぶ純粋関数の検証。
// DOM/CTM 変換は実機目視（命中率そのもの）に委ね、ここでは幾何ロジックを担保する。

import { describe, it, expect } from 'vitest';
import { nearestValidVertexId, nearestValidEdgeId, resolvePlacePreviewAction } from '../src/renderer/events';
import { applyAction } from '../src/engine/game';
import { canBuildRoad } from '../src/engine/actions';
import { makeGameState } from './helpers';
import type { GameState } from '../src/types';

function setupSettlementState(): GameState {
  return makeGameState({ phase: 'SETUP_FORWARD', setupSubPhase: 'PLACE_SETTLEMENT', currentPlayerIndex: 0 });
}

describe('nearestValidVertexId', () => {
  it('頂点のちょうど上をタップするとその頂点を返す', () => {
    const s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    const { x, y } = s.vertices[vid]!.pixel;
    expect(nearestValidVertexId(s, 'player1', 'settlement', x, y)).toBe(vid);
  });

  it('少しずれても最近傍の合法頂点にスナップする', () => {
    const s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    const { x, y } = s.vertices[vid]!.pixel;
    expect(nearestValidVertexId(s, 'player1', 'settlement', x + 6, y - 5)).toBe(vid);
  });

  it('どの合法頂点からも遠ければ null を返す', () => {
    const s = setupSettlementState();
    expect(nearestValidVertexId(s, 'player1', 'settlement', 99999, 99999)).toBeNull();
  });

  it('占有後はその頂点へスナップしない（合法でなくなる）', () => {
    let s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    const { x, y } = s.vertices[vid]!.pixel;
    s = applyAction(s, { type: 'BUILD_SETTLEMENT', vertexId: vid });
    // 占有頂点と距離ルールで近傍も不可 → 近傍に合法頂点が無く null。
    expect(nearestValidVertexId(s, 'player1', 'settlement', x, y)).not.toBe(vid);
  });
});

describe('nearestValidEdgeId', () => {
  it('辺の中点付近をタップするとその辺を返す（SETUPの道）', () => {
    let s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    s = applyAction(s, { type: 'BUILD_SETTLEMENT', vertexId: vid }); // → PLACE_ROAD（anchor=vid）
    const eid = s.vertices[vid]!.adjacentEdgeIds.find(e => canBuildRoad(s, 'player1', e))!;
    const e = s.edges[eid]!;
    const a = s.vertices[e.vertexIds[0]]!.pixel;
    const b = s.vertices[e.vertexIds[1]]!.pixel;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    expect(nearestValidEdgeId(s, 'player1', 'road', mx, my)).toBe(eid);
  });

  it('配置フェーズでなければ（道を求めていない）null を返す', () => {
    const s = makeGameState({ phase: 'MAIN', turnPhase: 'TRADE_BUILD' });
    expect(nearestValidEdgeId(s, 'player1', 'idle', 400, 350)).toBeNull();
  });
});

describe('resolvePlacePreviewAction (確認ステップの確定)', () => {
  it('合法な開拓地頂点を BUILD_SETTLEMENT に変換する', () => {
    const s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    expect(resolvePlacePreviewAction(s, 'player1', 'settlement', vid)).toEqual({ type: 'BUILD_SETTLEMENT', vertexId: vid });
  });

  it('合法な道の辺を BUILD_ROAD に変換する', () => {
    let s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    s = applyAction(s, { type: 'BUILD_SETTLEMENT', vertexId: vid });
    const eid = s.vertices[vid]!.adjacentEdgeIds.find(e => canBuildRoad(s, 'player1', e))!;
    expect(resolvePlacePreviewAction(s, 'player1', 'road', eid)).toEqual({ type: 'BUILD_ROAD', edgeId: eid });
  });

  it('非合法ターゲットは null を返す（確定しても何も起きない）', () => {
    let s = setupSettlementState();
    const vid = Object.keys(s.vertices)[0]!;
    s = applyAction(s, { type: 'BUILD_SETTLEMENT', vertexId: vid });
    // PLACE_ROAD 中に開拓地確定を試みても null（フェーズ不一致）
    expect(resolvePlacePreviewAction(s, 'player1', 'settlement', vid)).toBeNull();
  });
});
