// ============================================================
// src/engine/robber.ts — L-07: 強盗ロジック
// ============================================================

import type { GameState, PlayerId, TileId, ResourceType } from '../types';
import { RESOURCE_TYPES, ROBBER_HAND_DISCARD_MIN } from '../constants';

// ============================================================
// 手札合計
// ============================================================

export function handTotal(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) return 0;
  return RESOURCE_TYPES.reduce((sum, r) => sum + player.hand[r], 0);
}

// ============================================================
// 手札捨て（手札8枚以上のプレイヤーが半数切り捨てを捨てる）
// ============================================================

/**
 * 手札が ROBBER_HAND_DISCARD_MIN(8) 枚以上のプレイヤーが捨てるべき枚数を返す。
 * 半数を切り捨てた枚数。
 */
export function discardCount(state: GameState, playerId: PlayerId): number {
  const total = handTotal(state, playerId);
  if (total < ROBBER_HAND_DISCARD_MIN) return 0;
  return Math.floor(total / 2);
}

/**
 * 7 の捨て札フェーズで「まだ捨てておらず、手札が最低枚数(8)以上の」次の対象プレイヤーを返す。
 * 既に捨てたプレイヤー(discardedThisRound)は除外する。該当なしは undefined。
 *
 * UI・サーバ・エンジンが同じ判定を共有することで、捨て終えた人（捨てた結果ちょうど8枚
 * 残ったケース等）への再プロンプト＝二重捨てを防ぐ。
 */
export function findPendingDiscarder(state: GameState): PlayerId | undefined {
  return state.playerOrder.find(
    p => !(state.discardedThisRound ?? []).includes(p) && handTotal(state, p) >= ROBBER_HAND_DISCARD_MIN,
  );
}

/**
 * 指定プレイヤーが指定の資源を捨て、バンクに返す。
 * resources は捨てる枚数の差分（超過分は無視しない — 呼び出し側がバリデーション済み前提）。
 */
export function discardResources(
  state: GameState,
  playerId: PlayerId,
  resources: Partial<Record<ResourceType, number>>,
): GameState {
  const player = state.players[playerId]!;
  const newHand = { ...player.hand };
  const newBank = { ...state.bank };

  for (const r of RESOURCE_TYPES) {
    const amount = resources[r] ?? 0;
    newHand[r] -= amount;
    newBank[r] += amount;
  }

  return {
    ...state,
    bank: newBank,
    players: {
      ...state.players,
      [playerId]: { ...player, hand: newHand },
    },
  };
}

// ============================================================
// 強盗移動
// ============================================================

/**
 * 強盗コマを指定タイルへ移動する。
 * 元のタイルの hasRobber を false に、新タイルを true にする。
 */
export function moveRobber(state: GameState, tileId: TileId): GameState {
  const newTiles = { ...state.tiles };

  // 元の強盗タイルをクリア
  for (const [tid, tile] of Object.entries(newTiles)) {
    if (tile.hasRobber) {
      newTiles[tid] = { ...tile, hasRobber: false };
    }
  }

  // 新タイルに強盗を配置
  const target = newTiles[tileId];
  if (target) {
    newTiles[tileId] = { ...target, hasRobber: true };
  }

  return { ...state, tiles: newTiles };
}

// ============================================================
// 盗み
// ============================================================

/**
 * 強盗移動先タイルの隣接頂点に建物を持つ「他プレイヤー」の一覧を返す。
 * 重複なし。手札0枚のプレイヤーも含む（UI側で選択可否を判断）。
 */
export function getRobbablePlayerIds(
  state: GameState,
  tileId: TileId,
  activePlayerId: PlayerId,
): PlayerId[] {
  const vIds = state.tileToVertices[tileId] ?? [];
  const seen = new Set<PlayerId>();

  for (const vid of vIds) {
    const vertex = state.vertices[vid];
    const pid = vertex?.building?.playerId;
    if (pid && pid !== activePlayerId) {
      seen.add(pid);
    }
  }

  return [...seen];
}

/**
 * 指定プレイヤーからランダムに資源を1枚盗む。
 * 手札が0枚の場合は何もしない（盗みスキップ）。
 * rng は Fisher-Yates と同じ mulberry32 系を想定。
 */
export function stealResource(
  state: GameState,
  activePlayerId: PlayerId,
  targetPlayerId: PlayerId,
  rng: () => number = Math.random,
): GameState {
  const target = state.players[targetPlayerId];
  if (!target) return state;

  // 手持ちの全資源を配列に展開
  const pool: ResourceType[] = [];
  for (const r of RESOURCE_TYPES) {
    for (let i = 0; i < target.hand[r]; i++) pool.push(r);
  }
  if (pool.length === 0) return state;

  const stolen = pool[Math.floor(rng() * pool.length)] as ResourceType;

  const active = state.players[activePlayerId]!;

  return {
    ...state,
    players: {
      ...state.players,
      [targetPlayerId]: {
        ...target,
        hand: { ...target.hand, [stolen]: target.hand[stolen] - 1 },
      },
      [activePlayerId]: {
        ...active,
        hand: { ...active.hand, [stolen]: active.hand[stolen] + 1 },
      },
    },
  };
}
