// ============================================================
// tests/citiesKnights.test.ts — 騎士と商人(Cities & Knights) フェーズ1: 都市産出
// ============================================================

import { describe, it, expect } from 'vitest';
import { computeCkProduction } from '../src/engine/citiesKnights';
import { makeGameState, makePlayer } from './helpers';
import { makeHand } from '../src/constants';
import type { GameState, TileType, BuildingType, PlayerId } from '../src/types';

// 1つのタイルだけ出目8にして（他は number=null）、その頂点に建物を置いた状態を作る。
function oneTile(type: TileType, buildings: Array<[idx: number, b: BuildingType, p: PlayerId]>): GameState {
  const g = makeGameState({
    players: {
      player1: makePlayer('player1'),
      player2: makePlayer('player2'),
    },
    playerOrder: ['player1', 'player2'],
  });
  const tid = Object.keys(g.tileToVertices).find(t => (g.tileToVertices[t]?.length ?? 0) >= 3)!;
  const vids = g.tileToVertices[tid]!;
  const tiles = Object.fromEntries(
    Object.entries(g.tiles).map(([id, t]) =>
      [id, id === tid ? { ...t, type, number: 8, hasRobber: false } : { ...t, number: null }]),
  );
  const vertices = { ...g.vertices };
  for (const [idx, b, p] of buildings) {
    const vid = vids[idx]!;
    vertices[vid] = { ...g.vertices[vid]!, building: { type: b, playerId: p } };
  }
  return { ...g, tiles, vertices } as GameState;
}

describe('C&K 都市産出 computeCkProduction', () => {
  it('都市(森)=木1+紙1、開拓地(森)=木1のみ', () => {
    const s = oneTile('forest', [[0, 'city', 'player1'], [1, 'settlement', 'player2']]);
    const prod = computeCkProduction(s, 8);
    expect(prod.resources.player1).toEqual({ wood: 1 });
    expect(prod.commodities.player1).toEqual({ paper: 1 });
    expect(prod.resources.player2).toEqual({ wood: 1 });
    expect(prod.commodities.player2).toBeUndefined(); // 開拓地は商品を産まない
  });

  it('都市(牧草)=羊1+布1 / 都市(山)=鉱石1+金貨1', () => {
    const pasture = computeCkProduction(oneTile('pasture', [[0, 'city', 'player1']]), 8);
    expect(pasture.resources.player1).toEqual({ wool: 1 });
    expect(pasture.commodities.player1).toEqual({ cloth: 1 });

    const mountain = computeCkProduction(oneTile('mountain', [[0, 'city', 'player1']]), 8);
    expect(mountain.resources.player1).toEqual({ ore: 1 });
    expect(mountain.commodities.player1).toEqual({ coin: 1 });
  });

  it('都市(丘/畑)=資源2で商品なし', () => {
    const hill = computeCkProduction(oneTile('hill', [[0, 'city', 'player1']]), 8);
    expect(hill.resources.player1).toEqual({ brick: 2 });
    expect(hill.commodities.player1).toBeUndefined();

    const field = computeCkProduction(oneTile('field', [[0, 'city', 'player1']]), 8);
    expect(field.resources.player1).toEqual({ grain: 2 });
    expect(field.commodities.player1).toBeUndefined();
  });

  it('7は産出なし', () => {
    const s = oneTile('forest', [[0, 'city', 'player1']]);
    expect(computeCkProduction(s, 7)).toEqual({ resources: {}, commodities: {} });
  });

  it('盗賊のいるタイルは資源も商品も産出しない', () => {
    const s = oneTile('forest', [[0, 'city', 'player1']]);
    const tid = Object.keys(s.tiles).find(t => s.tiles[t]!.number === 8)!;
    const s2 = { ...s, tiles: { ...s.tiles, [tid]: { ...s.tiles[tid]!, hasRobber: true } } };
    expect(computeCkProduction(s2, 8)).toEqual({ resources: {}, commodities: {} });
  });

  it('資源はバンク枯渇ルールを適用（複数需要が在庫超なら配布なし／商品は枯渇しない）', () => {
    // 山タイルに player1/player2 の都市 → 各 鉱石1＋金貨1。ore 需要 1+1=2 を bank.ore=1 にすると
    // 複数需要が在庫超 → ore は誰も貰えない。一方、商品(金貨)は枯渇を扱わないので両者とも貰える。
    const s0 = oneTile('mountain', [[0, 'city', 'player1'], [1, 'city', 'player2']]);
    const s = { ...s0, bank: makeHand({ ore: 1, wood: 9, brick: 9, wool: 9, grain: 9 }) };
    const prod = computeCkProduction(s, 8);
    expect(prod.resources.player1).toBeUndefined();
    expect(prod.resources.player2).toBeUndefined();
    expect(prod.commodities.player1).toEqual({ coin: 1 });
    expect(prod.commodities.player2).toEqual({ coin: 1 });
  });
});
