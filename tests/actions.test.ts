// ============================================================
// tests/actions.test.ts — L-05: 建設バリデーション テスト
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  canBuildRoad, buildRoad,
  canBuildSettlement, buildSettlement,
  canBuildCity, buildCity,
  hasEnoughResources,
} from '../src/engine/actions';
import { buildBoardGeometry } from '../src/engine/board';
import { makeHand, BUILD_COSTS } from '../src/constants';
import { makeGameState, makePlayer } from './helpers';
import type { GameState, EdgeId, VertexId } from '../src/types';

// ============================================================
// hasEnoughResources
// ============================================================

describe('hasEnoughResources', () => {
  it('returns true when hand has exactly the required amount', () => {
    const hand = makeHand({ wood: 1, brick: 1 });
    expect(hasEnoughResources(hand, BUILD_COSTS.road)).toBe(true);
  });

  it('returns true when hand has more than required', () => {
    const hand = makeHand({ wood: 5, brick: 5, wool: 3, grain: 3, ore: 3 });
    expect(hasEnoughResources(hand, BUILD_COSTS.settlement)).toBe(true);
  });

  it('returns false when hand is short on one resource', () => {
    const hand = makeHand({ wood: 1, brick: 0 });
    expect(hasEnoughResources(hand, BUILD_COSTS.road)).toBe(false);
  });

  it('returns false for empty hand against any cost', () => {
    const hand = makeHand();
    expect(hasEnoughResources(hand, BUILD_COSTS.city)).toBe(false);
  });
});

// ============================================================
// テスト用ユーティリティ: ボードから辺・頂点を取得
// ============================================================

function getFirstEdge(state: GameState): EdgeId {
  return Object.keys(state.edges)[0]!;
}

function getFirstVertex(state: GameState): VertexId {
  return Object.keys(state.vertices)[0]!;
}

/** 頂点 vid に接続している最初の辺 ID を返す */
function getEdgeAtVertex(state: GameState, vid: VertexId): EdgeId {
  return state.vertices[vid]!.adjacentEdgeIds[0]!;
}

// ============================================================
// canBuildRoad / buildRoad
// ============================================================

describe('canBuildRoad', () => {
  let state: GameState;
  let vid0: VertexId;
  let eid0: EdgeId;

  beforeEach(() => {
    state = makeGameState({ phase: 'MAIN', turnPhase: 'TRADE_BUILD' });
    vid0 = getFirstVertex(state);
    eid0 = getEdgeAtVertex(state, vid0);
  });

  it('returns false in MAIN phase with no resources', () => {
    expect(canBuildRoad(state, 'player1', eid0)).toBe(false);
  });

  it('returns false when edge already has a road', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 1, brick: 1 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
      edges: {
        ...state.edges,
        [eid0]: { ...state.edges[eid0]!, road: { playerId: 'player1' as const } },
      },
    };
    expect(canBuildRoad(s, 'player1', eid0)).toBe(false);
  });

  it('returns false when remainingRoads is 0', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          remainingRoads: 0,
          hand: makeHand({ wood: 5, brick: 5 }),
        }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildRoad(s, 'player1', eid0)).toBe(false);
  });

  it('returns false when edge is not connected to any own road/settlement', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 5, brick: 5 }) }),
      },
    };
    expect(canBuildRoad(s, 'player1', eid0)).toBe(false);
  });

  it('returns true in MAIN phase with resources and adjacent own settlement', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 1, brick: 1 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildRoad(s, 'player1', eid0)).toBe(true);
  });

  it('returns true in MAIN phase when adjacent to own road', () => {
    // vid0 に道を置き、その隣の頂点を経由した別の辺をターゲットにする
    const edge0 = state.edges[eid0]!;
    const [va] = edge0.vertexIds;
    const stateWithRoad = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 5, brick: 5 }) }),
      },
      edges: {
        ...state.edges,
        [eid0]: { ...edge0, road: { playerId: 'player1' as const } },
      },
    };
    // va に隣接する別の辺を探す
    const nextEdgeId = stateWithRoad.vertices[va]!.adjacentEdgeIds.find(e => e !== eid0);
    if (!nextEdgeId) return; // 構造による
    expect(canBuildRoad(stateWithRoad, 'player1', nextEdgeId)).toBe(true);
  });

  it('相手の建物がある頂点を越えて道を伸ばせない（接続が遮断される）', () => {
    // 自分の道(eid0)が va に接続。va に相手(player2)の開拓地。
    // va の先（va に接する別の空き辺）は、相手の建物が遮断するので建設不可であるべき。
    const edge0 = state.edges[eid0]!;
    const [va] = edge0.vertexIds;
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 5, brick: 5 }) }),
        player2: makePlayer('player2'),
      },
      playerOrder: ['player1', 'player2'] as const,
      vertices: {
        ...state.vertices,
        [va!]: { ...state.vertices[va!]!, building: { type: 'settlement' as const, playerId: 'player2' as const } },
      },
      edges: {
        ...state.edges,
        [eid0]: { ...edge0, road: { playerId: 'player1' as const } },
      },
    };
    const nextEdgeId = s.vertices[va!]!.adjacentEdgeIds.find(e => e !== eid0);
    if (!nextEdgeId) return; // 構造による
    // va は相手の開拓地で遮断 → 自分の道が va に接していても接続不可。
    expect(canBuildRoad(s, 'player1', nextEdgeId)).toBe(false);
    // 同じ頂点が自分の建物なら接続可（正の対照）。
    const sOwn = {
      ...s,
      vertices: {
        ...s.vertices,
        [va!]: { ...s.vertices[va!]!, building: { type: 'settlement' as const, playerId: 'player1' as const } },
      },
    };
    expect(canBuildRoad(sOwn, 'player1', nextEdgeId)).toBe(true);
  });

  it('returns true in SETUP phase without resources (adjacent settlement)', () => {
    const s = {
      ...state,
      phase: 'SETUP_FORWARD' as const,
      setupSubPhase: 'PLACE_ROAD' as const,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }), // 資源なし
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildRoad(s, 'player1', eid0)).toBe(true);
  });

  it('SETUP: setupRoadAnchor が設定されると、その開拓地に接続する道のみ有効', () => {
    // player1 が2つの開拓地を持つ後半セットアップ状態を想定。
    // anchor=vid0（直前に置いた開拓地）なので、vid0 隣接辺のみ有効、
    // もう一方の開拓地(vidB)の隣接辺は無効でなければならない。
    const vidB = Object.keys(state.vertices).find(v => {
      if (v === vid0) return false;
      // vid0 と辺を共有しない（隣接していない）頂点を選ぶ
      const eAtB = state.vertices[v]!.adjacentEdgeIds[0];
      if (!eAtB) return false;
      return !state.edges[eAtB]!.vertexIds.includes(vid0 as VertexId);
    })!;
    const eidAnchor = getEdgeAtVertex(state, vid0);
    const eidOther  = getEdgeAtVertex(state, vidB);

    const s: GameState = {
      ...state,
      phase: 'SETUP_BACKWARD',
      setupSubPhase: 'PLACE_ROAD',
      setupRoadAnchor: vid0,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: { ...state.vertices[vid0]!, building: { type: 'settlement', playerId: 'player1' } },
        [vidB]: { ...state.vertices[vidB]!, building: { type: 'settlement', playerId: 'player1' } },
      },
    };

    expect(canBuildRoad(s, 'player1', eidAnchor)).toBe(true);  // 直前の開拓地に接続 → OK
    expect(canBuildRoad(s, 'player1', eidOther)).toBe(false);  // 別の開拓地に接続 → NG
  });
});

describe('buildRoad', () => {
  it('places a road on the edge', () => {
    const state = makeGameState({ phase: 'MAIN' });
    const vid0 = getFirstVertex(state);
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 1, brick: 1 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    const next = buildRoad(s, 'player1', eid0);
    expect(next.edges[eid0]!.road).toEqual({ playerId: 'player1' });
  });

  it('decrements remainingRoads by 1', () => {
    const state = makeGameState({ phase: 'MAIN' });
    const vid0 = getFirstVertex(state);
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 1, brick: 1 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    const before = s.players['player1']!.remainingRoads;
    const next = buildRoad(s, 'player1', eid0);
    expect(next.players['player1']!.remainingRoads).toBe(before - 1);
  });

  it('deducts road cost from hand in MAIN phase', () => {
    const state = makeGameState({ phase: 'MAIN' });
    const vid0 = getFirstVertex(state);
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 3, brick: 3 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    const next = buildRoad(s, 'player1', eid0);
    expect(next.players['player1']!.hand.wood).toBe(2);
    expect(next.players['player1']!.hand.brick).toBe(2);
  });

  it('does not deduct cost in SETUP phase', () => {
    const state = makeGameState({ phase: 'SETUP_FORWARD', setupSubPhase: 'PLACE_ROAD' });
    const vid0 = getFirstVertex(state);
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    const next = buildRoad(s, 'player1', eid0);
    expect(next.players['player1']!.hand.wood).toBe(0);
    expect(next.players['player1']!.hand.brick).toBe(0);
  });

  it('returns resources to bank in MAIN phase', () => {
    const state = makeGameState({ phase: 'MAIN' });
    const vid0 = getFirstVertex(state);
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ wood: 1, brick: 1 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    const next = buildRoad(s, 'player1', eid0);
    expect(next.bank.wood).toBe(s.bank.wood + 1);
    expect(next.bank.brick).toBe(s.bank.brick + 1);
  });
});

// ============================================================
// canBuildSettlement / buildSettlement
// ============================================================

describe('canBuildSettlement', () => {
  let state: GameState;
  let vid0: VertexId;

  beforeEach(() => {
    state = makeGameState({ phase: 'MAIN' });
    vid0 = getFirstVertex(state);
  });

  it('returns false in MAIN with no resources', () => {
    expect(canBuildSettlement(state, 'player1', vid0)).toBe(false);
  });

  it('returns false when vertex already has a building', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
        }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player2' as const },
        },
      },
    };
    expect(canBuildSettlement(s, 'player1', vid0)).toBe(false);
  });

  it('returns false when remainingSettlements is 0', () => {
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          remainingSettlements: 0,
          hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
        }),
      },
      edges: {
        ...state.edges,
        [eid0]: { ...state.edges[eid0]!, road: { playerId: 'player1' as const } },
      },
    };
    expect(canBuildSettlement(s, 'player1', vid0)).toBe(false);
  });

  it('returns false when distance rule violated (neighbor has building)', () => {
    const neighborId = state.vertices[vid0]!.adjacentVertexIds[0]!;
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
        }),
      },
      edges: {
        ...state.edges,
        [eid0]: { ...state.edges[eid0]!, road: { playerId: 'player1' as const } },
      },
      vertices: {
        ...state.vertices,
        [neighborId]: {
          ...state.vertices[neighborId]!,
          building: { type: 'settlement' as const, playerId: 'player2' as const },
        },
      },
    };
    expect(canBuildSettlement(s, 'player1', vid0)).toBe(false);
  });

  it('returns false in MAIN when not connected to own road', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
        }),
      },
    };
    expect(canBuildSettlement(s, 'player1', vid0)).toBe(false);
  });

  it('returns true in MAIN with resources and adjacent own road', () => {
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          hand: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
        }),
      },
      edges: {
        ...state.edges,
        [eid0]: { ...state.edges[eid0]!, road: { playerId: 'player1' as const } },
      },
    };
    expect(canBuildSettlement(s, 'player1', vid0)).toBe(true);
  });

  it('returns true in SETUP without resources or road connection', () => {
    const s = {
      ...state,
      phase: 'SETUP_FORWARD' as const,
      setupSubPhase: 'PLACE_SETTLEMENT' as const,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }),
      },
    };
    expect(canBuildSettlement(s, 'player1', vid0)).toBe(true);
  });
});

describe('buildSettlement', () => {
  it('places a settlement on the vertex', () => {
    const state = makeGameState({ phase: 'SETUP_FORWARD', setupSubPhase: 'PLACE_SETTLEMENT' });
    const vid0 = getFirstVertex(state);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }),
      },
    };
    const next = buildSettlement(s, 'player1', vid0);
    expect(next.vertices[vid0]!.building).toEqual({ type: 'settlement', playerId: 'player1' });
  });

  it('decrements remainingSettlements by 1', () => {
    const state = makeGameState({ phase: 'SETUP_FORWARD', setupSubPhase: 'PLACE_SETTLEMENT' });
    const vid0 = getFirstVertex(state);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }),
      },
    };
    const before = s.players['player1']!.remainingSettlements;
    const next = buildSettlement(s, 'player1', vid0);
    expect(next.players['player1']!.remainingSettlements).toBe(before - 1);
  });

  it('deducts settlement cost in MAIN phase', () => {
    const state = makeGameState({ phase: 'MAIN' });
    const vid0 = getFirstVertex(state);
    const eid0 = getEdgeAtVertex(state, vid0);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          hand: makeHand({ wood: 2, brick: 2, wool: 2, grain: 2 }),
        }),
      },
      edges: {
        ...state.edges,
        [eid0]: { ...state.edges[eid0]!, road: { playerId: 'player1' as const } },
      },
    };
    const next = buildSettlement(s, 'player1', vid0);
    expect(next.players['player1']!.hand.wood).toBe(1);
    expect(next.players['player1']!.hand.brick).toBe(1);
    expect(next.players['player1']!.hand.wool).toBe(1);
    expect(next.players['player1']!.hand.grain).toBe(1);
  });

  it('does not deduct cost in SETUP phase', () => {
    const state = makeGameState({ phase: 'SETUP_FORWARD', setupSubPhase: 'PLACE_SETTLEMENT' });
    const vid0 = getFirstVertex(state);
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand() }),
      },
    };
    const next = buildSettlement(s, 'player1', vid0);
    expect(next.players['player1']!.hand.wood).toBe(0);
  });
});

// ============================================================
// canBuildCity / buildCity
// ============================================================

describe('canBuildCity', () => {
  let state: GameState;
  let vid0: VertexId;

  beforeEach(() => {
    state = makeGameState({ phase: 'MAIN' });
    vid0 = getFirstVertex(state);
  });

  it('returns false with no resources', () => {
    const s = {
      ...state,
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildCity(s, 'player1', vid0)).toBe(false);
  });

  it('returns false when no building at vertex', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ grain: 2, ore: 3 }) }),
      },
    };
    expect(canBuildCity(s, 'player1', vid0)).toBe(false);
  });

  it('returns false when vertex has a city already', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ grain: 2, ore: 3 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'city' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildCity(s, 'player1', vid0)).toBe(false);
  });

  it('returns false when vertex has an opponent settlement', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ grain: 2, ore: 3 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player2' as const },
        },
      },
    };
    expect(canBuildCity(s, 'player1', vid0)).toBe(false);
  });

  it('returns false when remainingCities is 0', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', {
          remainingCities: 0,
          hand: makeHand({ grain: 2, ore: 3 }),
        }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildCity(s, 'player1', vid0)).toBe(false);
  });

  it('returns true with resources and own settlement', () => {
    const s = {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ grain: 2, ore: 3 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
    expect(canBuildCity(s, 'player1', vid0)).toBe(true);
  });
});

describe('buildCity', () => {
  let state: GameState;
  let vid0: VertexId;

  beforeEach(() => {
    state = makeGameState({ phase: 'MAIN' });
    vid0 = getFirstVertex(state);
  });

  function setupCityState(): GameState {
    return {
      ...state,
      players: {
        ...state.players,
        player1: makePlayer('player1', { hand: makeHand({ grain: 2, ore: 3 }) }),
      },
      vertices: {
        ...state.vertices,
        [vid0]: {
          ...state.vertices[vid0]!,
          building: { type: 'settlement' as const, playerId: 'player1' as const },
        },
      },
    };
  }

  it('upgrades settlement to city', () => {
    const next = buildCity(setupCityState(), 'player1', vid0);
    expect(next.vertices[vid0]!.building?.type).toBe('city');
    expect(next.vertices[vid0]!.building?.playerId).toBe('player1');
  });

  it('deducts city cost from hand', () => {
    const s = setupCityState();
    const next = buildCity(s, 'player1', vid0);
    expect(next.players['player1']!.hand.grain).toBe(0);
    expect(next.players['player1']!.hand.ore).toBe(0);
  });

  it('returns resources to bank', () => {
    const s = setupCityState();
    const next = buildCity(s, 'player1', vid0);
    expect(next.bank.grain).toBe(s.bank.grain + 2);
    expect(next.bank.ore).toBe(s.bank.ore + 3);
  });

  it('decrements remainingCities by 1', () => {
    const s = setupCityState();
    const before = s.players['player1']!.remainingCities;
    const next = buildCity(s, 'player1', vid0);
    expect(next.players['player1']!.remainingCities).toBe(before - 1);
  });

  it('increments remainingSettlements by 1 (settlement returned)', () => {
    const s = setupCityState();
    const before = s.players['player1']!.remainingSettlements;
    const next = buildCity(s, 'player1', vid0);
    expect(next.players['player1']!.remainingSettlements).toBe(before + 1);
  });

  it('original state is unchanged (immutability)', () => {
    const s = setupCityState();
    buildCity(s, 'player1', vid0);
    expect(s.vertices[vid0]!.building?.type).toBe('settlement');
  });
});
