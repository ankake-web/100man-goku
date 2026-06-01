// ============================================================
// src/engine/dice.ts — L-04: ダイスロール・資源配布エンジン
// ============================================================

import type { GameState, ResourceType } from '../types';
import { TILE_RESOURCE_MAP, RESOURCE_TYPES } from '../constants';

/**
 * 2つのダイスを振り [die1, die2] を返す。
 * rng を注入することでテストで再現可能。
 */
export function rollDice(rng: () => number = Math.random): [number, number] {
  return [
    Math.floor(rng() * 6) + 1,
    Math.floor(rng() * 6) + 1,
  ];
}

/**
 * ダイス合計値に基づいて資源を配布し、新しい GameState を返す。
 *
 * 配布ルール:
 *   - diceTotal === 7 → 強盗フェーズへ。資源配布なし。
 *   - 強盗コマがあるタイルは配布しない。
 *   - 砂漠タイルは resource が null なので配布しない。
 *   - 開拓地 = 1枚、都市 = 2枚。
 *   - バンク枯渇: 各資源について playerOrder 順に min(需要, 残在庫) を配布。
 */
export function distributeResources(state: GameState, diceTotal: number): GameState {
  if (diceTotal === 7) return state;

  // resource → playerId → 総需要量
  const demand: Record<ResourceType, Record<string, number>> = {
    wood: {}, brick: {}, wool: {}, grain: {}, ore: {},
  };

  for (const tile of Object.values(state.tiles)) {
    if (tile.number !== diceTotal) continue;
    if (tile.hasRobber) continue;

    const resource = TILE_RESOURCE_MAP[tile.type];
    if (resource == null) continue;

    const vertexIds = state.tileToVertices[tile.id] ?? [];
    for (const vid of vertexIds) {
      const vertex = state.vertices[vid];
      if (!vertex?.building) continue;
      const { playerId, type } = vertex.building;
      const amount = type === 'city' ? 2 : 1;
      demand[resource][playerId] = (demand[resource][playerId] ?? 0) + amount;
    }
  }

  // バンク枯渇ルールを適用して配布
  const newBank = { ...state.bank };
  const handUpdates: Record<string, Partial<Record<ResourceType, number>>> = {};

  for (const resource of RESOURCE_TYPES) {
    const resourceDemand = demand[resource];
    const affectedPids = Object.keys(resourceDemand);
    if (affectedPids.length === 0) continue;

    // Catan公式ルール: 複数プレイヤーへの配布合計がバンク在庫を超える場合、
    // その資源は誰にも配布しない（単一プレイヤーの場合は在庫分だけ配布）
    const totalDemand = affectedPids.reduce((s, pid) => s + (resourceDemand[pid] ?? 0), 0);
    if (affectedPids.length > 1 && totalDemand > newBank[resource]) {
      continue;
    }

    for (const pid of state.playerOrder) {
      const needed = resourceDemand[pid] ?? 0;
      if (needed === 0) continue;
      const actual = Math.min(needed, newBank[resource]);
      if (actual <= 0) continue;
      newBank[resource] -= actual;
      if (!handUpdates[pid]) handUpdates[pid] = {};
      handUpdates[pid]![resource] = (handUpdates[pid]![resource] ?? 0) + actual;
    }
  }

  if (Object.keys(handUpdates).length === 0) {
    return { ...state, bank: newBank };
  }

  const newPlayers = { ...state.players };
  for (const [pid, updates] of Object.entries(handUpdates)) {
    const player = newPlayers[pid]!;
    const newHand = { ...player.hand };
    for (const [r, amount] of Object.entries(updates) as [ResourceType, number][]) {
      newHand[r] += amount;
    }
    newPlayers[pid] = { ...player, hand: newHand };
  }

  return { ...state, bank: newBank, players: newPlayers };
}
