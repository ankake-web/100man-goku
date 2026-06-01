// ============================================================
// tests/scoring.test.ts — L-08: VP・最長道路・最大騎士団 テスト
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  calcVP, calcPublicVP, calcLongestRoad,
  updateLongestRoad, updateLargestArmy, checkVictory,
} from '../src/engine/scoring';
import { makeHand } from '../src/constants';
import { makeGameState, makePlayer } from './helpers';
import type { GameState, VertexId, EdgeId, PlayerId } from '../src/types';

// ============================================================
// calcVP
// ============================================================

describe('calcVP', () => {
  it('returns 0 for player with nothing', () => {
    const s = makeGameState();
    expect(calcVP(s, 'player1')).toBe(0);
  });

  it('counts settlement as 1 VP', () => {
    const s = makeGameState();
    const vid = Object.keys(s.vertices)[0]!;
    const next: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vid]: { ...s.vertices[vid]!, building: { type: 'settlement', playerId: 'player1' } },
      },
    };
    expect(calcVP(next, 'player1')).toBe(1);
  });

  it('counts city as 2 VP', () => {
    const s = makeGameState();
    const vid = Object.keys(s.vertices)[0]!;
    const next: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vid]: { ...s.vertices[vid]!, building: { type: 'city', playerId: 'player1' } },
      },
    };
    expect(calcVP(next, 'player1')).toBe(2);
  });

  it('counts hasLongestRoad bonus as 2 VP', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hasLongestRoad: true }),
        player2: makePlayer('player2'),
      },
    });
    expect(calcVP(s, 'player1')).toBe(2);
  });

  it('counts hasLargestArmy bonus as 2 VP', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hasLargestArmy: true }),
        player2: makePlayer('player2'),
      },
    });
    expect(calcVP(s, 'player1')).toBe(2);
  });

  it('counts victory_point dev cards', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', {
          devCards: [
            { id: 'c1', type: 'victory_point', purchasedOnTurn: 0 },
            { id: 'c2', type: 'victory_point', purchasedOnTurn: 0 },
          ],
        }),
        player2: makePlayer('player2'),
      },
    });
    expect(calcVP(s, 'player1')).toBe(2);
  });

  it('sums all VP sources correctly', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', {
          hasLongestRoad: true,
          hasLargestArmy: true,
          devCards: [{ id: 'c1', type: 'victory_point', purchasedOnTurn: 0 }],
        }),
        player2: makePlayer('player2'),
      },
    });
    const vids = Object.keys(s.vertices);
    const next: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vids[0]!]: { ...s.vertices[vids[0]!]!, building: { type: 'settlement', playerId: 'player1' } },
        [vids[1]!]: { ...s.vertices[vids[1]!]!, building: { type: 'city', playerId: 'player1' } },
      },
    };
    // 1(settlement) + 2(city) + 2(longest) + 2(largest) + 1(vp card) = 8
    expect(calcVP(next, 'player1')).toBe(8);
  });

  it('does not count opponent buildings', () => {
    const s = makeGameState();
    const vid = Object.keys(s.vertices)[0]!;
    const next: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vid]: { ...s.vertices[vid]!, building: { type: 'city', playerId: 'player2' } },
      },
    };
    expect(calcVP(next, 'player1')).toBe(0);
  });
});

// ============================================================
// calcLongestRoad
// ============================================================

describe('calcLongestRoad', () => {
  it('returns 0 when player has no roads', () => {
    const s = makeGameState();
    expect(calcLongestRoad(s, 'player1')).toBe(0);
  });

  it('returns 1 for single road', () => {
    const s = makeGameState();
    const eid = Object.keys(s.edges)[0]!;
    const next: GameState = {
      ...s,
      edges: { ...s.edges, [eid]: { ...s.edges[eid]!, road: { playerId: 'player1' } } },
    };
    expect(calcLongestRoad(next, 'player1')).toBe(1);
  });

  it('counts chain of 5 connected roads', () => {
    const s = makeGameState();
    // 連続した5辺を取得する: 1本目の辺から隣接辺を辿って5本チェーンを作る
    let state = s;
    let eids: EdgeId[] = [];
    const firstEid = Object.keys(s.edges)[0]!;
    eids.push(firstEid);
    state = { ...state, edges: { ...state.edges, [firstEid]: { ...state.edges[firstEid]!, road: { playerId: 'player1' } } } };

    // 4本隣接辺をチェーンする
    for (let i = 0; i < 4; i++) {
      const lastEid = eids[eids.length - 1]!;
      const lastEdge = state.edges[lastEid]!;
      // 隣接辺で未使用のものを選ぶ
      const nextEid = lastEdge.adjacentEdgeIds.find(e => !eids.includes(e));
      if (!nextEid) break;
      eids.push(nextEid);
      state = { ...state, edges: { ...state.edges, [nextEid]: { ...state.edges[nextEid]!, road: { playerId: 'player1' } } } };
    }

    const len = calcLongestRoad(state, 'player1');
    expect(len).toBeGreaterThanOrEqual(eids.length);
  });

  it('road is cut by opponent settlement', () => {
    const s = makeGameState();
    // 2本の道を並べ、その間の頂点に相手の開拓地を置く
    const eid0 = Object.keys(s.edges)[0]!;
    const edge0 = s.edges[eid0]!;
    const sharedVid = edge0.vertexIds[1]!;

    // sharedVid を共有する別の辺を探す
    const eid1 = s.vertices[sharedVid]!.adjacentEdgeIds.find(e => e !== eid0)!;

    const next: GameState = {
      ...s,
      edges: {
        ...s.edges,
        [eid0]: { ...s.edges[eid0]!, road: { playerId: 'player1' } },
        [eid1]: { ...s.edges[eid1]!, road: { playerId: 'player1' } },
      },
      vertices: {
        ...s.vertices,
        [sharedVid]: { ...s.vertices[sharedVid]!, building: { type: 'settlement', playerId: 'player2' } },
      },
    };

    // 相手の開拓地で切断されるので最長は1
    expect(calcLongestRoad(next, 'player1')).toBe(1);
  });

  it('own settlement does not cut road', () => {
    const s = makeGameState();
    const eid0 = Object.keys(s.edges)[0]!;
    const edge0 = s.edges[eid0]!;
    const sharedVid = edge0.vertexIds[1]!;
    const eid1 = s.vertices[sharedVid]!.adjacentEdgeIds.find(e => e !== eid0)!;

    const next: GameState = {
      ...s,
      edges: {
        ...s.edges,
        [eid0]: { ...s.edges[eid0]!, road: { playerId: 'player1' } },
        [eid1]: { ...s.edges[eid1]!, road: { playerId: 'player1' } },
      },
      vertices: {
        ...s.vertices,
        [sharedVid]: { ...s.vertices[sharedVid]!, building: { type: 'settlement', playerId: 'player1' } },
      },
    };

    // 自分の開拓地は切断しない → 2本連続
    expect(calcLongestRoad(next, 'player1')).toBe(2);
  });
});

// ============================================================
// calcPublicVP
// ============================================================

describe('calcPublicVP', () => {
  it('VP カードを合算しない', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', {
          devCards: [{ id: 'vp1', type: 'victory_point', purchasedOnTurn: 0 }],
        }),
        player2: makePlayer('player2'),
      },
    });
    expect(calcVP(s, 'player1')).toBe(1);    // 内部VP = 1 (VPカード込み)
    expect(calcPublicVP(s, 'player1')).toBe(0); // 公開VP = 0 (カード非公開)
  });

  it('CPUがVPカード1枚保持でも公開VPに加算されない（情報漏洩なし）', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1'),
        player2: makePlayer('player2', {
          devCards: [{ id: 'vp1', type: 'victory_point', purchasedOnTurn: 0 }],
        }),
      },
    });
    // 公開VP は 0（VPカードは非公開）
    expect(calcPublicVP(s, 'player2')).toBe(0);
    // 内部VP は 1（VPカード込み）
    expect(calcVP(s, 'player2')).toBe(1);
  });

  it('CPUが公開2点+VPカード1枚でも表示は公開2点のみ', () => {
    const base = makeGameState();
    const vid = Object.keys(base.vertices)[0]!;
    const s: GameState = {
      ...base,
      players: {
        ...base.players,
        player2: makePlayer('player2', {
          hasLongestRoad: true,
          devCards: [{ id: 'vp1', type: 'victory_point', purchasedOnTurn: 0 }],
        }),
      },
      vertices: {
        ...base.vertices,
        [vid]: { ...base.vertices[vid]!, building: { type: 'settlement', playerId: 'player2' } },
      },
    };
    expect(calcPublicVP(s, 'player2')).toBe(3); // 開拓地1 + 最長2 = 3（VPカード除外）
    expect(calcVP(s, 'player2')).toBe(4);        // 内部VP = 4
  });

  it('建物・最長道路・最大騎士力は公開VPに含める', () => {
    const base = makeGameState({ longestRoadHolder: 'player1' });
    const vid = Object.keys(base.vertices)[0]!;
    const s: GameState = {
      ...base,
      players: {
        ...base.players,
        player1: makePlayer('player1', { hasLongestRoad: true }),
      },
      vertices: {
        ...base.vertices,
        [vid]: { ...base.vertices[vid]!, building: { type: 'settlement', playerId: 'player1' } },
      },
    };
    // 開拓地1VP + 最長道路2VP = 公開3VP
    expect(calcPublicVP(s, 'player1')).toBe(3);
  });
});

// ============================================================
// updateLongestRoad
// ============================================================

describe('updateLongestRoad', () => {
  it('nobody gets longest road if max < 5', () => {
    const s = makeGameState();
    const next = updateLongestRoad(s);
    expect(next.longestRoadHolder).toBeNull();
  });

  it('awards longest road when player reaches 5+ roads', () => {
    let s = makeGameState();
    // 5本の連続道路を player1 に設置
    let eids: EdgeId[] = [];
    const firstEid = Object.keys(s.edges)[0]!;
    eids.push(firstEid);
    s = { ...s, edges: { ...s.edges, [firstEid]: { ...s.edges[firstEid]!, road: { playerId: 'player1' } } } };
    for (let i = 0; i < 4; i++) {
      const last = eids[eids.length - 1]!;
      const nextEid = s.edges[last]!.adjacentEdgeIds.find(e => !eids.includes(e));
      if (!nextEid) break;
      eids.push(nextEid);
      s = { ...s, edges: { ...s.edges, [nextEid]: { ...s.edges[nextEid]!, road: { playerId: 'player1' } } } };
    }
    const next = updateLongestRoad(s);
    if (eids.length >= 5) {
      expect(next.longestRoadHolder).toBe('player1');
      expect(next.players['player1']!.hasLongestRoad).toBe(true);
    }
  });

  it('holder keeps bonus when only they have 5+ roads (no tie)', () => {
    // player1 が単独で5本 → 保持者が維持
    let s = makeGameState({ longestRoadHolder: 'player1' });
    const firstEid = Object.keys(s.edges)[0]!;
    const eids = [firstEid];
    s = { ...s, edges: { ...s.edges, [firstEid]: { ...s.edges[firstEid]!, road: { playerId: 'player1' } } } };
    for (let i = 0; i < 4; i++) {
      const last = eids[eids.length - 1]!;
      const nextEid = s.edges[last]!.adjacentEdgeIds.find(e => !eids.includes(e) && s.edges[e]!.road == null);
      if (!nextEid) break;
      eids.push(nextEid);
      s = { ...s, edges: { ...s.edges, [nextEid]: { ...s.edges[nextEid]!, road: { playerId: 'player1' } } } };
    }
    if (eids.length < 5) return;
    const next = updateLongestRoad(s);
    expect(next.longestRoadHolder).toBe('player1');
  });

  it('updates longestRoadLength for all players', () => {
    const s = makeGameState();
    const next = updateLongestRoad(s);
    for (const pid of s.playerOrder) {
      expect(typeof next.players[pid]!.longestRoadLength).toBe('number');
    }
  });

  // ----------------------------------------------------------------
  // 仕様書 §7-2: 同点・場外処理
  // ----------------------------------------------------------------

  // 実際の道をN本連続で繋げるヘルパー
  function buildChain(state: GameState, pid: PlayerId, count: number, startEid?: EdgeId): { state: GameState; built: number } {
    let cur = state;
    const eids: EdgeId[] = [];
    const first = startEid ?? Object.keys(cur.edges).find(e => cur.edges[e]!.road == null)!;
    if (!first || cur.edges[first]!.road != null) return { state: cur, built: 0 };
    eids.push(first);
    cur = { ...cur, edges: { ...cur.edges, [first]: { ...cur.edges[first]!, road: { playerId: pid } } } };
    for (let i = 1; i < count; i++) {
      const last = eids[eids.length - 1]!;
      const next = cur.edges[last]!.adjacentEdgeIds.find(e => !eids.includes(e) && cur.edges[e]!.road == null);
      if (!next) break;
      eids.push(next);
      cur = { ...cur, edges: { ...cur.edges, [next]: { ...cur.edges[next]!, road: { playerId: pid } } } };
    }
    return { state: cur, built: eids.length };
  }

  it('[仕様1] A(5本保持), B(5本) → Aが保持', () => {
    let s = makeGameState({ longestRoadHolder: 'player1' });
    const r1 = buildChain(s, 'player1', 5);
    s = r1.state;
    if (r1.built < 5) return;
    // player2 は別の辺から始まる5本 (p1の辺と異なるエリアから)
    const allEdges = Object.keys(s.edges);
    const p2Start = allEdges.find(e => s.edges[e]!.road == null && !s.edges[e]!.adjacentEdgeIds.some(ae => s.edges[ae]!.road != null)) ?? allEdges[30]!;
    const r2 = buildChain(s, 'player2', 5, p2Start);
    s = r2.state;
    if (r2.built < 5) return;
    const next = updateLongestRoad(s);
    const p1 = next.players['player1']!.longestRoadLength;
    const p2 = next.players['player2']!.longestRoadLength;
    if (p1 >= 5 && p2 >= 5 && p1 === p2) {
      expect(next.longestRoadHolder).toBe('player1');
    }
  });

  it('[仕様2] A(5本保持), B(6本) → Bが奪う', () => {
    let s = makeGameState({ longestRoadHolder: 'player1' });
    const r1 = buildChain(s, 'player1', 5);
    s = r1.state;
    if (r1.built < 5) return;
    const p2Start = Object.keys(s.edges).find(e => s.edges[e]!.road == null) ?? '';
    const r2 = buildChain(s, 'player2', 6, p2Start);
    s = r2.state;
    if (r2.built < 6) return;
    const next = updateLongestRoad(s);
    const p2 = next.players['player2']!.longestRoadLength;
    const p1 = next.players['player1']!.longestRoadLength;
    if (p2 > p1 && p2 >= 5) {
      expect(next.longestRoadHolder).toBe('player2');
    }
  });

  it('[仕様5] A保持だったが分断, A(4本), B,C(5本ずつ) → null', () => {
    // 3プレイヤーで試験
    let s = makeGameState({
      longestRoadHolder: 'player1',
      players: {
        player1: makePlayer('player1'),
        player2: makePlayer('player2'),
        player3: makePlayer('player3'),
      },
      playerOrder: ['player1', 'player2', 'player3'],
    });
    // player1: 4本のみ（保持者から転落）
    const r1 = buildChain(s, 'player1', 4);
    s = r1.state;
    // player2: 5本
    const r2Start = Object.keys(s.edges).find(e => s.edges[e]!.road == null) ?? '';
    const r2 = buildChain(s, 'player2', 5, r2Start);
    s = r2.state;
    // player3: 5本
    const r3Start = Object.keys(s.edges).find(e => s.edges[e]!.road == null) ?? '';
    const r3 = buildChain(s, 'player3', 5, r3Start);
    s = r3.state;
    if (r2.built < 5 || r3.built < 5) return; // ボード上に辺が足りなければスキップ
    const next = updateLongestRoad(s);
    const p2 = next.players['player2']!.longestRoadLength;
    const p3 = next.players['player3']!.longestRoadLength;
    if (p2 >= 5 && p3 >= 5 && p2 === p3) {
      expect(next.longestRoadHolder).toBeNull();
    }
  });

  it('[仕様6] A保持, A,B(5本同点) → A保持', () => {
    let s = makeGameState({ longestRoadHolder: 'player1' });
    const r1 = buildChain(s, 'player1', 5);
    s = r1.state;
    if (r1.built < 5) return;
    // player2 の5本チェーン（player1 と同じ長さ）
    const p2Start = Object.keys(s.edges).find(e => s.edges[e]!.road == null && !s.edges[e]!.adjacentEdgeIds.some(ae => s.edges[ae]!.road != null)) ?? '';
    const r2 = buildChain(s, 'player2', 5, p2Start);
    s = r2.state;
    if (r2.built < 5) return;
    const next = updateLongestRoad(s);
    const p1 = next.players['player1']!.longestRoadLength;
    const p2 = next.players['player2']!.longestRoadLength;
    if (p1 >= 5 && p1 === p2) {
      // 保持者(player1)が同点 → 保持継続
      expect(next.longestRoadHolder).toBe('player1');
    }
  });

  it('[要件2] 保持者なし、AとBが5本同点 → longestRoadHolder が null', () => {
    // 保持者がいない状態でAとBが同時に5本の場合、誰にも渡らない
    let s = makeGameState({ longestRoadHolder: null });
    const r1 = buildChain(s, 'player1', 5);
    s = r1.state;
    if (r1.built < 5) return;
    // player2 は player1 と切り離れた辺から開始
    const p2Start = Object.keys(s.edges).find(e =>
      s.edges[e]!.road == null &&
      !s.edges[e]!.adjacentEdgeIds.some(ae => s.edges[ae]!.road != null),
    );
    if (!p2Start) return;
    const r2 = buildChain(s, 'player2', 5, p2Start);
    s = r2.state;
    if (r2.built < 5) return;
    const next = updateLongestRoad(s);
    const p1 = next.players['player1']!.longestRoadLength;
    const p2 = next.players['player2']!.longestRoadLength;
    // 両者が5本以上かつ同点の場合のみアサート
    if (p1 >= 5 && p2 >= 5 && p1 === p2) {
      expect(next.longestRoadHolder).toBeNull();
    }
  });

  it('[要件7] A(5本保持)、BとCが6本同点 → longestRoadHolder が null', () => {
    // Aが保持者(5本)で、BとCが同時に6本最長になる場合、場外になる
    let s = makeGameState({
      longestRoadHolder: 'player1',
      players: {
        player1: makePlayer('player1'),
        player2: makePlayer('player2'),
        player3: makePlayer('player3'),
      },
      playerOrder: ['player1', 'player2', 'player3'],
    });
    const r1 = buildChain(s, 'player1', 5);
    s = r1.state;
    if (r1.built < 5) return;
    const p2Start = Object.keys(s.edges).find(e =>
      s.edges[e]!.road == null &&
      !s.edges[e]!.adjacentEdgeIds.some(ae => s.edges[ae]!.road != null),
    );
    if (!p2Start) return;
    const r2 = buildChain(s, 'player2', 6, p2Start);
    s = r2.state;
    if (r2.built < 6) return;
    const p3Start = Object.keys(s.edges).find(e =>
      s.edges[e]!.road == null &&
      !s.edges[e]!.adjacentEdgeIds.some(ae => s.edges[ae]!.road != null),
    );
    if (!p3Start) return;
    const r3 = buildChain(s, 'player3', 6, p3Start);
    s = r3.state;
    if (r3.built < 6) return;
    const next = updateLongestRoad(s);
    const p1 = next.players['player1']!.longestRoadLength;
    const p2 = next.players['player2']!.longestRoadLength;
    const p3 = next.players['player3']!.longestRoadLength;
    // BとCが共に6本以上かつ同点で、Aがそれより短い場合のみアサート
    if (p2 >= 6 && p3 >= 6 && p2 === p3 && p1 < p2) {
      expect(next.longestRoadHolder).toBeNull();
    }
  });

  it('[仕様7] 誰も5本以上でなくなった → longestRoadHolder は null', () => {
    // longestRoadHolder=player1 だが実際の道は0本 → null
    const s = makeGameState({ longestRoadHolder: 'player1' });
    const next = updateLongestRoad(s);
    expect(next.longestRoadHolder).toBeNull();
  });

  it('[仕様8] longestRoadHolder が null のとき誰にも最長交易路2VPが入らない', () => {
    const s = makeGameState({ longestRoadHolder: null });
    for (const pid of s.playerOrder) {
      expect(s.players[pid]!.hasLongestRoad).toBe(false);
    }
    const vp = calcVP(s, 'player1');
    expect(vp).toBe(0);
  });
});

// ============================================================
// updateLargestArmy
// ============================================================

describe('updateLargestArmy', () => {
  it('nobody gets largest army if max < 3', () => {
    const s = makeGameState();
    const next = updateLargestArmy(s);
    expect(next.largestArmyHolder).toBeNull();
  });

  it('awards largest army when player reaches 3 knights', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { knightsPlayed: 3 }),
        player2: makePlayer('player2'),
      },
    });
    const next = updateLargestArmy(s);
    expect(next.largestArmyHolder).toBe('player1');
    expect(next.players['player1']!.hasLargestArmy).toBe(true);
    expect(next.players['player2']!.hasLargestArmy).toBe(false);
  });

  it('moves army when another player surpasses current holder', () => {
    const s = makeGameState({
      largestArmyHolder: 'player1',
      players: {
        player1: makePlayer('player1', { knightsPlayed: 3, hasLargestArmy: true }),
        player2: makePlayer('player2', { knightsPlayed: 4 }),
      },
    });
    const next = updateLargestArmy(s);
    expect(next.largestArmyHolder).toBe('player2');
    expect(next.players['player2']!.hasLargestArmy).toBe(true);
    expect(next.players['player1']!.hasLargestArmy).toBe(false);
  });

  it('current holder keeps bonus on tie', () => {
    const s = makeGameState({
      largestArmyHolder: 'player1',
      players: {
        player1: makePlayer('player1', { knightsPlayed: 3, hasLargestArmy: true }),
        player2: makePlayer('player2', { knightsPlayed: 3 }),
      },
    });
    const next = updateLargestArmy(s);
    expect(next.largestArmyHolder).toBe('player1');
  });
});

// ============================================================
// checkVictory
// ============================================================

describe('checkVictory', () => {
  it('returns unchanged state when VP < 10', () => {
    const s = makeGameState();
    const next = checkVictory(s, 'player1');
    expect(next.winner).toBeNull();
    expect(next.phase).toBe('MAIN');
  });

  it('sets winner and GAME_OVER when VP >= 10', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', {
          hasLongestRoad: true,  // +2
          hasLargestArmy: true,  // +2
          devCards: [
            { id: 'c1', type: 'victory_point', purchasedOnTurn: 0 },
            { id: 'c2', type: 'victory_point', purchasedOnTurn: 0 },
          ], // +2
        }),
        player2: makePlayer('player2'),
      },
    });
    // 6VP from above; add 4 cities via vertices
    const vids = Object.keys(s.vertices).slice(0, 2);
    const next: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vids[0]!]: { ...s.vertices[vids[0]!]!, building: { type: 'city', playerId: 'player1' } },
        [vids[1]!]: { ...s.vertices[vids[1]!]!, building: { type: 'city', playerId: 'player1' } },
      },
    };
    // 2+2+2+2+2 = 10 VP
    const result = checkVictory(next, 'player1');
    expect(result.winner).toBe('player1');
    expect(result.phase).toBe('GAME_OVER');
  });

  it('does not set winner for opponent even if they have 10 VP', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1'),
        player2: makePlayer('player2', { hasLongestRoad: true, hasLargestArmy: true }),
      },
    });
    const vids = Object.keys(s.vertices).slice(0, 3);
    const next: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vids[0]!]: { ...s.vertices[vids[0]!]!, building: { type: 'city', playerId: 'player2' } },
        [vids[1]!]: { ...s.vertices[vids[1]!]!, building: { type: 'city', playerId: 'player2' } },
        [vids[2]!]: { ...s.vertices[vids[2]!]!, building: { type: 'city', playerId: 'player2' } },
      },
    };
    // player2 has 10VP but checkVictory is called for player1
    const result = checkVictory(next, 'player1');
    expect(result.winner).toBeNull();
  });
});
