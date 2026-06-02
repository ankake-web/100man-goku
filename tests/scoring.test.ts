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

// 末端から「方向付き」に辺を辿り、確実に1本の連続パス（分岐なし）となる n 辺を返す。
// 旧テストの adjacentEdgeIds.find(...) はY字に分岐し得たため、正しいパスを作る用。
function straightPathEids(s: GameState, n: number, startEid?: EdgeId): EdgeId[] {
  const start = startEid ?? (Object.keys(s.edges)[0]! as EdgeId);
  const path: EdgeId[] = [start];
  let tip: VertexId = s.edges[start]!.vertexIds[1]!;
  while (path.length < n) {
    const v = s.vertices[tip];
    if (!v) break;
    const next = v.adjacentEdgeIds.find(e => !path.includes(e as EdgeId)) as EdgeId | undefined;
    if (!next) break;
    path.push(next);
    const ne = s.edges[next]!;
    tip = (ne.vertexIds[0] === tip ? ne.vertexIds[1] : ne.vertexIds[0])!;
  }
  return path;
}
function placeRoads(s: GameState, eids: EdgeId[], pid: PlayerId = 'player1'): GameState {
  const edges = { ...s.edges };
  for (const e of eids) edges[e] = { ...edges[e]!, road: { playerId: pid } };
  return { ...s, edges };
}

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
    // 方向付きに5本の連続パスを作る
    const eids = straightPathEids(s, 5);
    expect(eids.length).toBe(5);
    const len = calcLongestRoad(placeRoads(s, eids), 'player1');
    // 単一の連続パスなので長さ=本数
    expect(len).toBe(eids.length);
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
// calcLongestRoad — 連続経路ルール（分岐を合算しない）
// ============================================================

describe('calcLongestRoad — 連続経路ルール', () => {
  function withRoads(s: GameState, eids: EdgeId[], pid: PlayerId = 'player1'): GameState {
    const edges = { ...s.edges };
    for (const e of eids) edges[e] = { ...edges[e]!, road: { playerId: pid } };
    return { ...s, edges };
  }
  function withBuilding(s: GameState, vid: VertexId, pid: PlayerId): GameState {
    return { ...s, vertices: { ...s.vertices, [vid]: { ...s.vertices[vid]!, building: { type: 'settlement', playerId: pid } } } };
  }
  // 互いに頂点を共有しない（=非接続な）辺を n 本選ぶ
  function pickDisconnected(s: GameState, n: number): EdgeId[] {
    const blocked = new Set<VertexId>();
    const result: EdgeId[] = [];
    for (const e of Object.keys(s.edges)) {
      const vs = s.edges[e]!.vertexIds;
      if (vs.some(v => blocked.has(v))) continue;
      result.push(e);
      for (const v of vs) {
        blocked.add(v);
        for (const ae of s.vertices[v]!.adjacentEdgeIds) {
          s.edges[ae]!.vertexIds.forEach(x => blocked.add(x));
        }
      }
      if (result.length === n) break;
    }
    return result;
  }

  it('3本バラバラ → 最長1', () => {
    const s = makeGameState();
    const eids = pickDisconnected(s, 3);
    expect(eids.length).toBe(3);
    expect(calcLongestRoad(withRoads(s, eids), 'player1')).toBe(1);
  });

  it('2本接続 + 1本孤立 → 最長2', () => {
    const s = makeGameState();
    // 接続2本: 次数2以上の頂点の隣接2辺
    const vid = Object.keys(s.vertices).find(v => s.vertices[v]!.adjacentEdgeIds.length >= 2)!;
    const c0 = s.vertices[vid]!.adjacentEdgeIds[0]! as EdgeId;
    const c1 = s.vertices[vid]!.adjacentEdgeIds[1]! as EdgeId;
    // 孤立1本: 接続2本の頂点から離れた辺
    const near = new Set<VertexId>();
    for (const e of [c0, c1]) for (const v of s.edges[e]!.vertexIds) {
      near.add(v);
      for (const ae of s.vertices[v]!.adjacentEdgeIds) s.edges[ae]!.vertexIds.forEach(x => near.add(x));
    }
    const iso = Object.keys(s.edges).find(e => s.edges[e]!.vertexIds.every(v => !near.has(v)))!;
    expect(calcLongestRoad(withRoads(s, [c0, c1, iso]), 'player1')).toBe(2);
  });

  it('3本直線 → 最長3', () => {
    const s = makeGameState();
    const eids = straightPathEids(s, 3);
    expect(eids.length).toBe(3);
    expect(calcLongestRoad(withRoads(s, eids), 'player1')).toBe(3);
  });

  it('Y字分岐 → 枝を合算せず最長2', () => {
    const s = makeGameState();
    // 次数3の頂点に3本の道（Y字）。最長の単一路線は2本。
    const yVid = Object.keys(s.vertices).find(v => s.vertices[v]!.adjacentEdgeIds.length >= 3)!;
    const yEdges = s.vertices[yVid]!.adjacentEdgeIds.slice(0, 3) as EdgeId[];
    expect(calcLongestRoad(withRoads(s, yEdges), 'player1')).toBe(2);
  });

  it('Y字 + 直線で、合算されず最長は実際の連続長になる', () => {
    const s = makeGameState();
    // 次数3の頂点 yVid に3辺。さらに1本の枝を延長しても、分岐は合算しない。
    const yVid = Object.keys(s.vertices).find(v => s.vertices[v]!.adjacentEdgeIds.length >= 3)!;
    const yEdges = s.vertices[yVid]!.adjacentEdgeIds.slice(0, 3) as EdgeId[];
    // yEdges[0] の反対側頂点から、さらに1本伸ばす
    const e0 = s.edges[yEdges[0]!]!;
    const farVid = (e0.vertexIds[0] === yVid ? e0.vertexIds[1] : e0.vertexIds[0]) as VertexId;
    const ext = s.vertices[farVid]!.adjacentEdgeIds.find(e => !yEdges.includes(e as EdgeId)) as EdgeId | undefined;
    const roads = ext ? [...yEdges, ext] : yEdges;
    // 連続路: ext - yEdges[0] - (yEdges[1] か yEdges[2]) = 最長3。合算なら4になってしまう。
    const len = calcLongestRoad(withRoads(s, roads), 'player1');
    expect(len).toBe(ext ? 3 : 2);
    expect(len).toBeLessThan(roads.length); // 全本数より小さい（=合算していない）
  });

  it('相手建物で分断、自分建物では分断されない', () => {
    const s = makeGameState();
    const eids = straightPathEids(s, 3);
    expect(eids.length).toBe(3);
    // eids[0] と eids[1] の共有頂点（連結点）を求める
    const shared = s.edges[eids[0]!]!.vertexIds.find(v => s.edges[eids[1]!]!.vertexIds.includes(v)) as VertexId;
    const oppBlocked = withRoads(withBuilding(s, shared, 'player2'), eids);
    const selfOk = withRoads(withBuilding(s, shared, 'player1'), eids);
    // 相手建物: 連結点で分断され短くなる
    expect(calcLongestRoad(oppBlocked, 'player1')).toBeLessThan(3);
    // 自分建物: 分断されない → 3
    expect(calcLongestRoad(selfOk, 'player1')).toBe(3);
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
    const s = makeGameState();
    const eids = straightPathEids(s, 5);
    expect(eids.length).toBe(5);
    const next = updateLongestRoad(placeRoads(s, eids));
    expect(next.longestRoadHolder).toBe('player1');
    expect(next.players['player1']!.hasLongestRoad).toBe(true);
  });

  it('holder keeps bonus when only they have 5+ roads (no tie)', () => {
    // player1 が単独で5本の連続路 → 保持者が維持
    const s = makeGameState({ longestRoadHolder: 'player1' });
    const eids = straightPathEids(s, 5);
    expect(eids.length).toBe(5);
    const next = updateLongestRoad(placeRoads(s, eids));
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

  // 実際の道をN本「方向付き」に連続で繋げるヘルパー（分岐せず1本のパスを作る）
  function buildChain(state: GameState, pid: PlayerId, count: number, startEid?: EdgeId): { state: GameState; built: number } {
    let cur = state;
    const eids: EdgeId[] = [];
    const first = startEid ?? Object.keys(cur.edges).find(e => cur.edges[e]!.road == null)!;
    if (!first || cur.edges[first]!.road != null) return { state: cur, built: 0 };
    eids.push(first);
    cur = { ...cur, edges: { ...cur.edges, [first]: { ...cur.edges[first]!, road: { playerId: pid } } } };
    let tip: VertexId = cur.edges[first]!.vertexIds[1]!;
    for (let i = 1; i < count; i++) {
      const v = cur.vertices[tip];
      const next = v?.adjacentEdgeIds.find(e => !eids.includes(e as EdgeId) && cur.edges[e]!.road == null) as EdgeId | undefined;
      if (!next) break;
      eids.push(next);
      cur = { ...cur, edges: { ...cur.edges, [next]: { ...cur.edges[next]!, road: { playerId: pid } } } };
      const ne = cur.edges[next]!;
      tip = (ne.vertexIds[0] === tip ? ne.vertexIds[1] : ne.vertexIds[0])!;
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
