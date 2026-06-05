// ============================================================
// tests/dice.test.ts — L-04: ダイスロール・資源配布エンジン テスト
// ============================================================

import { describe, it, expect } from 'vitest';
import { rollDice, distributeResources, computeDiceProduction } from '../src/engine/dice';
import { createRng } from '../src/engine/setup';
import { makeHand } from '../src/constants';
import { makeGameState, makePlayer } from './helpers';
import type { GameState } from '../src/types';

// ============================================================
// rollDice
// ============================================================

describe('rollDice', () => {
  it('returns two dice values each in [1, 6]', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) {
      const [d1, d2] = rollDice(rng);
      expect(d1).toBeGreaterThanOrEqual(1);
      expect(d1).toBeLessThanOrEqual(6);
      expect(d2).toBeGreaterThanOrEqual(1);
      expect(d2).toBeLessThanOrEqual(6);
    }
  });

  it('returns integers only', () => {
    const rng = createRng(2);
    for (let i = 0; i < 50; i++) {
      const [d1, d2] = rollDice(rng);
      expect(Number.isInteger(d1)).toBe(true);
      expect(Number.isInteger(d2)).toBe(true);
    }
  });

  it('same seed produces same sequence', () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    const rolls1 = Array.from({ length: 10 }, () => rollDice(r1));
    const rolls2 = Array.from({ length: 10 }, () => rollDice(r2));
    expect(rolls1).toEqual(rolls2);
  });

  it('different seeds produce different sequences', () => {
    const r1 = createRng(1);
    const r2 = createRng(2);
    const rolls1 = Array.from({ length: 20 }, () => rollDice(r1));
    const rolls2 = Array.from({ length: 20 }, () => rollDice(r2));
    expect(rolls1).not.toEqual(rolls2);
  });

  it('returns an array of length 2', () => {
    const [d1, d2] = rollDice(createRng(5));
    expect(typeof d1).toBe('number');
    expect(typeof d2).toBe('number');
  });

  it('sum is in [2, 12]', () => {
    const rng = createRng(99);
    for (let i = 0; i < 200; i++) {
      const [d1, d2] = rollDice(rng);
      expect(d1 + d2).toBeGreaterThanOrEqual(2);
      expect(d1 + d2).toBeLessThanOrEqual(12);
    }
  });
});

// ============================================================
// distributeResources — ヘルパー
// ============================================================

/**
 * テスト用ボード: tileId "0,0" を forest(wood)・number=6 に固定し、
 * 指定した頂点に建物を置いたミニ GameState を生成する。
 */
function makeStateWithTile(
  tileNumber: number,
  tileType: 'forest' | 'field' | 'mountain' | 'desert',
  hasRobber: boolean,
  buildingVertexIdx: number | null,
  buildingType: 'settlement' | 'city' = 'settlement',
  bankStock: Partial<Record<string, number>> = {},
): GameState {
  const base = makeGameState();

  // タイル "0,0" を書き換え
  const targetTileId = '0,0';
  const tile = base.tiles[targetTileId]!;
  const updatedTiles = {
    ...base.tiles,
    [targetTileId]: {
      ...tile,
      type: tileType,
      number: tileType === 'desert' ? null : tileNumber,
      hasRobber,
    },
  };

  // 指定インデックスの頂点に building を設置
  let updatedVertices = { ...base.vertices };
  if (buildingVertexIdx !== null) {
    const vIds = base.tileToVertices[targetTileId]!;
    const vid = vIds[buildingVertexIdx]!;
    updatedVertices = {
      ...updatedVertices,
      [vid]: {
        ...updatedVertices[vid]!,
        building: { type: buildingType, playerId: 'player1' },
      },
    };
  }

  // バンク書き換え
  const bank = { ...base.bank, ...bankStock };

  return { ...base, tiles: updatedTiles, vertices: updatedVertices, bank };
}

// ============================================================
// distributeResources
// ============================================================

describe('distributeResources', () => {
  it('returns unchanged state when diceTotal is 7', () => {
    const state = makeGameState();
    const next = distributeResources(state, 7);
    expect(next).toEqual(state);
  });

  it('does not distribute when no tile matches the dice number', () => {
    const state = makeStateWithTile(6, 'forest', false, 0);
    const before = { ...state.players['player1']!.hand };
    const next = distributeResources(state, 9); // 9 はマッチしない
    expect(next.players['player1']!.hand).toEqual(before);
  });

  it('distributes 1 wood from settlement on matching forest tile', () => {
    const state = makeStateWithTile(6, 'forest', false, 0, 'settlement');
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand.wood).toBe(1);
    expect(next.bank.wood).toBe(state.bank.wood - 1);
  });

  it('distributes 2 wood from city on matching forest tile', () => {
    const state = makeStateWithTile(6, 'forest', false, 0, 'city');
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand.wood).toBe(2);
    expect(next.bank.wood).toBe(state.bank.wood - 2);
  });

  it('distributes grain from field tile', () => {
    const state = makeStateWithTile(8, 'field', false, 0, 'settlement');
    const next = distributeResources(state, 8);
    expect(next.players['player1']!.hand.grain).toBe(1);
  });

  it('distributes ore from mountain tile', () => {
    const state = makeStateWithTile(9, 'mountain', false, 0, 'settlement');
    const next = distributeResources(state, 9);
    expect(next.players['player1']!.hand.ore).toBe(1);
  });

  it('does not distribute when robber is on the tile', () => {
    const state = makeStateWithTile(6, 'forest', true, 0, 'settlement');
    const before = { ...state.players['player1']!.hand };
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand).toEqual(before);
  });

  it('does not distribute from desert tile', () => {
    const state = makeStateWithTile(6, 'desert', false, 0, 'settlement');
    const before = { ...state.players['player1']!.hand };
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand).toEqual(before);
  });

  it('does not distribute when vertex has no building', () => {
    const state = makeStateWithTile(6, 'forest', false, null);
    const before = { ...state.players['player1']!.hand };
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand).toEqual(before);
  });

  it('bank is reduced by the distributed amount', () => {
    const state = makeStateWithTile(6, 'forest', false, 0, 'city');
    const next = distributeResources(state, 6);
    expect(next.bank.wood).toBe(state.bank.wood - 2);
  });

  it('bank depletion: distributes at most what bank has (city needs 2, bank has 1)', () => {
    const state = makeStateWithTile(6, 'forest', false, 0, 'city', { wood: 1 });
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand.wood).toBe(1);
    expect(next.bank.wood).toBe(0);
  });

  it('bank depletion: distributes 0 when bank is empty', () => {
    const state = makeStateWithTile(6, 'forest', false, 0, 'settlement', { wood: 0 });
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand.wood).toBe(0);
    expect(next.bank.wood).toBe(0);
  });

  it('player2 also receives resources on matching tile', () => {
    const base = makeStateWithTile(6, 'forest', false, 0, 'settlement');
    const vIds = base.tileToVertices['0,0']!;
    // 頂点1（別の頂点）に player2 の開拓地を設置
    const vid1 = vIds[1]!;
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        player2: makePlayer('player2', { hand: makeHand() }),
      },
      playerOrder: ['player1', 'player2'],
      vertices: {
        ...base.vertices,
        [vid1]: {
          ...base.vertices[vid1]!,
          building: { type: 'settlement', playerId: 'player2' },
        },
      },
    };
    const next = distributeResources(state, 6);
    expect(next.players['player1']!.hand.wood).toBe(1);
    expect(next.players['player2']!.hand.wood).toBe(1);
    expect(next.bank.wood).toBe(state.bank.wood - 2);
  });

  it('state is immutable: original state is unchanged', () => {
    const state = makeStateWithTile(6, 'forest', false, 0, 'settlement');
    const originalWood = state.players['player1']!.hand.wood;
    distributeResources(state, 6);
    expect(state.players['player1']!.hand.wood).toBe(originalWood);
  });
});

// ============================================================
// computeDiceProduction — 公開情報からの導出（演出用・LANマスク状態でも全員分が分かる）
// ============================================================

describe('computeDiceProduction', () => {
  // forest(wood)・number=6 のタイルに player1=開拓地, player2=都市 を置く。
  function twoPlayerForest6(): GameState {
    const base = makeGameState({
      players: { player1: makePlayer('player1'), player2: makePlayer('player2') },
      playerOrder: ['player1', 'player2'],
    });
    const tid = '0,0';
    const tiles = { ...base.tiles, [tid]: { ...base.tiles[tid]!, type: 'forest' as const, number: 6, hasRobber: false } };
    const vIds = base.tileToVertices[tid]!;
    const vertices = {
      ...base.vertices,
      [vIds[0]!]: { ...base.vertices[vIds[0]!]!, building: { type: 'settlement' as const, playerId: 'player1' as const } },
      [vIds[2]!]: { ...base.vertices[vIds[2]!]!, building: { type: 'city' as const, playerId: 'player2' as const } },
    };
    return { ...base, tiles, vertices };
  }

  it('全プレイヤーのダイス産出を返す（開拓地=1枚 / 都市=2枚）', () => {
    const prod = computeDiceProduction(twoPlayerForest6(), 6);
    expect(prod['player1']?.wood).toBe(1);
    expect(prod['player2']?.wood).toBe(2);
  });

  it('手札を0にしても結果は同じ（盤面から導出＝LANのマスク状態でも全員分が分かる）', () => {
    const s = twoPlayerForest6();
    const masked: GameState = {
      ...s,
      players: {
        player1: { ...s.players.player1!, hand: makeHand() },
        player2: { ...s.players.player2!, hand: makeHand() },
      },
    };
    expect(computeDiceProduction(masked, 6)).toEqual(computeDiceProduction(s, 6));
    expect(computeDiceProduction(masked, 6)['player2']?.wood).toBe(2);
  });

  it('7では何も産出しない', () => {
    expect(computeDiceProduction(twoPlayerForest6(), 7)).toEqual({});
  });
});
