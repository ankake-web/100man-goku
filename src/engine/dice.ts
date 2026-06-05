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
 * ダイス合計値で「各プレイヤーが実際に得る資源（種類×枚数）」だけを計算して返す。
 * GameState は変更しない純粋関数。バンク枯渇ルールも適用済みの“実配布量”を返す。
 *
 * 計算に使うのはすべて公開情報（タイル種別/数字/強盗位置/盤面の建物/バンク在庫）のみ。
 * そのため LAN のマスク済み state（自分以外の手札は隠れている）でも、各端末で
 * 同じ「誰が何を得たか」を導出できる（手札の中身は一切参照しない）。
 *
 * 配布ルール:
 *   - diceTotal === 7 → 配布なし（空オブジェクト）。
 *   - 強盗コマがあるタイル・砂漠は配布しない。開拓地=1枚、都市=2枚。
 *   - バンク枯渇: 複数人需要が在庫超なら配布なし。単独なら在庫分だけ配布。
 */
export function computeDiceProduction(
  state: GameState,
  diceTotal: number,
): Record<string, Partial<Record<ResourceType, number>>> {
  const handUpdates: Record<string, Partial<Record<ResourceType, number>>> = {};
  if (diceTotal === 7) return handUpdates;

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

  // バンク枯渇ルールを適用して“実配布量”を求める（在庫のコピー上で計算）。
  const bankLeft = { ...state.bank };
  for (const resource of RESOURCE_TYPES) {
    const resourceDemand = demand[resource];
    const affectedPids = Object.keys(resourceDemand);
    if (affectedPids.length === 0) continue;

    // Catan公式ルール: 複数プレイヤーへの配布合計がバンク在庫を超える場合、
    // その資源は誰にも配布しない（単一プレイヤーの場合は在庫分だけ配布）
    const totalDemand = affectedPids.reduce((s, pid) => s + (resourceDemand[pid] ?? 0), 0);
    if (affectedPids.length > 1 && totalDemand > bankLeft[resource]) {
      continue;
    }

    for (const pid of state.playerOrder) {
      const needed = resourceDemand[pid] ?? 0;
      if (needed === 0) continue;
      const actual = Math.min(needed, bankLeft[resource]);
      if (actual <= 0) continue;
      bankLeft[resource] -= actual;
      if (!handUpdates[pid]) handUpdates[pid] = {};
      handUpdates[pid]![resource] = (handUpdates[pid]![resource] ?? 0) + actual;
    }
  }

  return handUpdates;
}

/**
 * ダイス合計値に基づいて資源を配布し、新しい GameState を返す。
 * 実配布量は computeDiceProduction に委譲し、ここではその分を手札とバンクへ反映する。
 */
export function distributeResources(state: GameState, diceTotal: number): GameState {
  if (diceTotal === 7) return state;

  const handUpdates = computeDiceProduction(state, diceTotal);
  if (Object.keys(handUpdates).length === 0) {
    return { ...state, bank: { ...state.bank } };
  }

  const newBank = { ...state.bank };
  const newPlayers = { ...state.players };
  for (const [pid, updates] of Object.entries(handUpdates)) {
    const player = newPlayers[pid]!;
    const newHand = { ...player.hand };
    for (const [r, amount] of Object.entries(updates) as [ResourceType, number][]) {
      newHand[r] += amount;
      newBank[r] -= amount;
    }
    newPlayers[pid] = { ...player, hand: newHand };
  }

  return { ...state, bank: newBank, players: newPlayers };
}
