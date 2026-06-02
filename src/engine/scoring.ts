// ============================================================
// src/engine/scoring.ts — L-08: VP・最長道路・最大騎士団
// ============================================================

import type { GameState, PlayerId, EdgeId, VertexId } from '../types';
import {
  VP_TABLE, LONGEST_ROAD_MIN, LARGEST_ARMY_MIN,
} from '../constants';

// ============================================================
// VP 計算
// ============================================================

/**
 * 指定プレイヤーの現在の勝利点を計算して返す（勝利点カード込み）。
 * エンジン内部の勝利判定・プレイヤー自身の表示に使用する。
 */
export function calcVP(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) return 0;

  let vp = 0;
  for (const vertex of Object.values(state.vertices)) {
    if (vertex.building?.playerId !== playerId) continue;
    vp += vertex.building.type === 'city' ? VP_TABLE.city : VP_TABLE.settlement;
  }
  if (player.hasLongestRoad) vp += VP_TABLE.longestRoad;
  if (player.hasLargestArmy) vp += VP_TABLE.largestArmy;
  vp += player.devCards.filter(c => c.type === 'victory_point').length * VP_TABLE.victoryPoint;

  return vp;
}

/**
 * 他プレイヤーから見える「公開勝利点」を計算して返す。
 * 勝利点カードは非公開なので合算しない。
 */
export function calcPublicVP(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) return 0;

  let vp = 0;
  for (const vertex of Object.values(state.vertices)) {
    if (vertex.building?.playerId !== playerId) continue;
    vp += vertex.building.type === 'city' ? VP_TABLE.city : VP_TABLE.settlement;
  }
  if (player.hasLongestRoad) vp += VP_TABLE.longestRoad;
  if (player.hasLargestArmy) vp += VP_TABLE.largestArmy;

  return vp;
}

// ============================================================
// 最長道路（Longest Road）
// ============================================================

/**
 * 指定プレイヤーの最長連続道路長を DFS で計算する。
 *
 * 切断ルール（rules.md §7-2）:
 *   - 相手プレイヤーの建物がある頂点は通過不可（道路が切断される）。
 *   - 自分の建物がある頂点は通過可能。
 *
 * アルゴリズム:
 *   各自分の道 Edge を起点に DFS し、使用済み辺を visited に入れて
 *   到達可能な最長パスを求める。全起点の最大値を返す。
 */
export function calcLongestRoad(state: GameState, playerId: PlayerId): number {
  // 自分の道だけ収集
  const myEdges = new Set<EdgeId>();
  for (const [eid, edge] of Object.entries(state.edges)) {
    if (edge.road?.playerId === playerId) myEdges.add(eid);
  }
  if (myEdges.size === 0) return 0;

  // 相手の建物がある頂点は通過不可（道路が切断される）。自分の建物は通過可。
  const isBlocked = (vid: VertexId): boolean => {
    const v = state.vertices[vid];
    return v?.building != null && v.building.playerId !== playerId;
  };

  let longest = 0;

  // 「方向付き」DFS。tipVid（フロンティア頂点）から1本ずつ前方にだけ伸ばす。
  // これにより分岐点で枝を合算してしまうバグを防ぐ（直前に来た頂点へは戻らない）。
  // visited は使用済みの辺の集合（同じ道を2回数えない）。
  const extend = (tipVid: VertexId, visited: Set<EdgeId>, lengthSoFar: number): number => {
    let best = lengthSoFar;
    // 相手建物のある頂点で道は分断される（その先へは伸ばせない）
    if (isBlocked(tipVid)) return best;
    const tip = state.vertices[tipVid];
    if (!tip) return best;
    for (const nextEid of tip.adjacentEdgeIds) {
      if (!myEdges.has(nextEid)) continue;
      if (visited.has(nextEid)) continue;
      const nextEdge = state.edges[nextEid]!;
      const otherVid = nextEdge.vertexIds[0] === tipVid
        ? nextEdge.vertexIds[1] : nextEdge.vertexIds[0];
      visited.add(nextEid);
      const count = extend(otherVid!, visited, lengthSoFar + 1);
      if (count > best) best = count;
      visited.delete(nextEid);
    }
    return best;
  };

  // 各辺をどちらの端からも起点として、前方へ伸ばした最長を取る
  for (const eid of myEdges) {
    const edge = state.edges[eid]!;
    for (const startVid of edge.vertexIds) {
      const otherVid = edge.vertexIds[0] === startVid ? edge.vertexIds[1] : edge.vertexIds[0];
      const visited = new Set<EdgeId>([eid]);
      const count = extend(otherVid!, visited, 1);
      if (count > longest) longest = count;
    }
  }

  return longest;
}

/**
 * 最長道路ボーナス保持者を更新した GameState を返す。
 *
 * 遷移ルール（仕様書 §7-2）:
 *   A) 現保持者が最長を維持している場合（holderLen === maxLen）: 保持継続。
 *   B) 現保持者が最長を失った場合（holderLen < maxLen）:
 *      - 新しい最長を持つプレイヤーが1人だけ → そのプレイヤーが獲得。
 *      - 複数同点 → カードは場外（null）。
 *   C) 現保持者がいない場合:
 *      - 最長が1人だけで MIN 以上 → そのプレイヤーが獲得。
 *      - 複数同点またはMIN未満 → 場外のまま（null）。
 *   D) maxLen < LONGEST_ROAD_MIN → 場外（null）。
 */
export function updateLongestRoad(state: GameState): GameState {
  // 全プレイヤーの実際の最長道路長を計算
  const lengths: Record<string, number> = {};
  let newState = state;

  for (const pid of state.playerOrder) {
    const length = calcLongestRoad(state, pid as PlayerId);
    lengths[pid] = length;
    newState = {
      ...newState,
      players: {
        ...newState.players,
        [pid]: { ...newState.players[pid]!, longestRoadLength: length },
      },
    };
  }

  const currentHolder = state.longestRoadHolder;
  const maxLen = state.playerOrder.reduce((m, pid) => Math.max(m, lengths[pid] ?? 0), 0);

  let newHolder: PlayerId | null;

  if (maxLen < LONGEST_ROAD_MIN) {
    // 誰も MIN 本以上ない → 場外
    newHolder = null;
  } else if (currentHolder !== null && (lengths[currentHolder] ?? 0) === maxLen) {
    // 保持者が最長を維持 → 保持継続
    newHolder = currentHolder;
  } else {
    // 最長者を特定: maxLen を持つプレイヤー一覧
    const topPlayers = state.playerOrder.filter(pid => (lengths[pid] ?? 0) === maxLen);
    if (topPlayers.length === 1) {
      // 単独最長 → 獲得（保持者が更新されるか保持者がいなかった場合）
      newHolder = topPlayers[0] as PlayerId;
    } else {
      // 複数同点 → 場外
      newHolder = null;
    }
  }

  // ボーナスフラグを更新
  for (const pid of state.playerOrder) {
    newState = {
      ...newState,
      players: {
        ...newState.players,
        [pid]: { ...newState.players[pid]!, hasLongestRoad: pid === newHolder },
      },
    };
  }

  return { ...newState, longestRoadHolder: newHolder };
}

// ============================================================
// 最大騎士団（Largest Army）
// ============================================================

/**
 * 最大騎士団ボーナス保持者を更新した GameState を返す。
 *
 * 遷移ルール（rules.md §7-3）:
 *   - 現保持者がいない場合: LARGEST_ARMY_MIN(3) 以上の最多者が取得。
 *   - 現保持者がいる場合: 他プレイヤーが現保持者を「上回った」場合のみ移動。
 *     同数では移動しない（現保持者優先）。
 */
export function updateLargestArmy(state: GameState): GameState {
  const currentHolder = state.largestArmyHolder;
  let newHolder = currentHolder;

  if (currentHolder === null) {
    let maxKnights = LARGEST_ARMY_MIN - 1;
    for (const pid of state.playerOrder) {
      const k = state.players[pid]?.knightsPlayed ?? 0;
      if (k > maxKnights) { maxKnights = k; newHolder = pid as PlayerId; }
    }
  } else {
    const holderKnights = state.players[currentHolder]?.knightsPlayed ?? 0;
    let maxKnights = holderKnights;
    for (const pid of state.playerOrder) {
      if (pid === currentHolder) continue;
      const k = state.players[pid]?.knightsPlayed ?? 0;
      if (k > maxKnights) { maxKnights = k; newHolder = pid as PlayerId; }
    }
  }

  // ボーナスフラグを更新
  let newState = state;
  for (const pid of state.playerOrder) {
    const has = pid === newHolder;
    newState = {
      ...newState,
      players: {
        ...newState.players,
        [pid]: { ...newState.players[pid]!, hasLargestArmy: has },
      },
    };
  }

  return { ...newState, largestArmyHolder: newHolder };
}

// ============================================================
// 勝利チェック
// ============================================================

/**
 * アクティブプレイヤーが勝利条件（VP_TABLE.target=10）を満たしているか確認し、
 * 満たしていれば winner と phase を更新した GameState を返す。
 */
export function checkVictory(state: GameState, playerId: PlayerId): GameState {
  const vp = calcVP(state, playerId);
  if (vp < VP_TABLE.target) return state;

  return { ...state, winner: playerId, phase: 'GAME_OVER' };
}
