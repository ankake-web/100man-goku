// ============================================================
// tests/recap.test.ts — 終了後プレイ講評（公開情報のみ）の回帰テスト
// ============================================================
//
// buildPlayerRecap は最終 state の公開統計（開拓地/都市/道/称号/騎士/公開VP）
// だけからコメントを作る。秘匿情報（資源内訳・VPカードの中身）を出さないこと、
// 主要な特徴で妥当な定型コメントを選ぶことを確認する。

import { describe, it, expect } from 'vitest';
import { buildPlayerRecap } from '../src/engine/recap';
import { makeGameState, makePlayer } from './helpers';
import type { GameState, VertexId, EdgeId } from '../src/types';

// 指定プレイヤー(player1)に開拓地/都市/道/称号を割り当てた state を作る。
function withBuildings(opts: {
  settlements?: number; cities?: number; roads?: number;
  hasLongestRoad?: boolean; hasLargestArmy?: boolean; knights?: number;
  winner?: boolean;
}): GameState {
  const s = makeGameState({
    players: {
      player1: makePlayer('player1', {
        name: '青',
        hasLongestRoad: opts.hasLongestRoad ?? false,
        hasLargestArmy: opts.hasLargestArmy ?? false,
        knightsPlayed: opts.knights ?? 0,
      }),
      player2: makePlayer('player2', { name: '赤' }),
    },
    playerOrder: ['player1', 'player2'],
  });

  const vertices = { ...s.vertices };
  const vids = Object.keys(vertices) as VertexId[];
  let vi = 0;
  for (let i = 0; i < (opts.cities ?? 0); i++) {
    const id = vids[vi++]!;
    vertices[id] = { ...vertices[id]!, building: { type: 'city', playerId: 'player1' } };
  }
  for (let i = 0; i < (opts.settlements ?? 0); i++) {
    const id = vids[vi++]!;
    vertices[id] = { ...vertices[id]!, building: { type: 'settlement', playerId: 'player1' } };
  }

  const edges = { ...s.edges };
  const eids = Object.keys(edges) as EdgeId[];
  for (let i = 0; i < (opts.roads ?? 0); i++) {
    const id = eids[i]!;
    edges[id] = { ...edges[id]!, road: { playerId: 'player1' } };
  }

  return {
    ...s, vertices, edges,
    winner: opts.winner ? 'player1' : null,
    phase: opts.winner ? 'GAME_OVER' : 'MAIN',
  };
}

const SECRET_EMOJI = ['🌲', '🧱', '🐑', '🌾', '⛰'];
const BANNED = ['騎士カード', 'チャペル', '大学', '図書館', '市場', '議事堂', '勝利点カード'];

describe('buildPlayerRecap', () => {
  it('開拓地/都市/道の集計が正しい', () => {
    const r = buildPlayerRecap(withBuildings({ settlements: 2, cities: 3, roads: 4 }), 'player1');
    expect(r.settlements).toBe(2);
    expect(r.cities).toBe(3);
    expect(r.roads).toBe(4);
    expect(r.comment.length).toBeGreaterThan(0);
  });

  it('城が多いと「城」を含む開発型の講評になる', () => {
    expect(buildPlayerRecap(withBuildings({ cities: 3 }), 'player1').comment).toContain('城');
  });

  it('最長交易路保持で「道」を含む講評になる', () => {
    const r = buildPlayerRecap(withBuildings({ hasLongestRoad: true, roads: 6 }), 'player1');
    expect(r.hasLongestRoad).toBe(true);
    expect(r.comment).toContain('道');
  });

  it('武威(最大騎士力)保持で「武将」を含む講評になる', () => {
    expect(buildPlayerRecap(withBuildings({ hasLargestArmy: true, knights: 3 }), 'player1').comment).toContain('武将');
  });

  it('都市1+開拓地3はバランス安定型になる', () => {
    expect(buildPlayerRecap(withBuildings({ cities: 1, settlements: 3 }), 'player1').comment).toContain('バランス');
  });

  it('称号総取りの勝者は「勝利」を含む前向きな講評になる', () => {
    const r = buildPlayerRecap(withBuildings({ hasLongestRoad: true, hasLargestArmy: true, knights: 3, winner: true }), 'player1');
    expect(r.isWinner).toBe(true);
    expect(r.comment).toContain('勝利');
  });

  it('講評に秘匿情報（資源内訳・発展カード名）を含まない', () => {
    const cases = [{ cities: 3 }, { settlements: 5 }, { hasLargestArmy: true, knights: 3 }, { cities: 1, settlements: 3 }, {}];
    for (const opts of cases) {
      const c = buildPlayerRecap(withBuildings(opts), 'player1').comment;
      for (const e of SECRET_EMOJI) expect(c).not.toContain(e);
      for (const b of BANNED) expect(c).not.toContain(b);
    }
  });
});

describe('buildPlayerRecap（騎士と商人）', () => {
  // 都市2つ（うち1つメトロポリス）＋守護VP を持つ CK 終了 state。
  function ckState(opts: { metropolis?: boolean; defenderVP?: number; merchant?: boolean; progressVP?: number; winner?: boolean } = {}): GameState {
    const s = makeGameState({
      expansion: 'cities_knights',
      players: {
        player1: makePlayer('player1', { name: '青', defenderVP: opts.defenderVP ?? 0, progressVP: opts.progressVP ?? 0 }),
        player2: makePlayer('player2', { name: '赤' }),
      },
      playerOrder: ['player1', 'player2'],
    } as Partial<GameState>);
    const vertices = { ...s.vertices };
    const vids = Object.keys(vertices) as VertexId[];
    vertices[vids[0]!] = { ...vertices[vids[0]!]!, building: { type: 'city', playerId: 'player1', ...(opts.metropolis ? { metropolis: true } : {}) } };
    vertices[vids[1]!] = { ...vertices[vids[1]!]!, building: { type: 'city', playerId: 'player1' } };
    return {
      ...s, vertices,
      merchant: opts.merchant ? { playerId: 'player1', tileId: Object.keys(s.tiles)[0]! } : null,
      winner: opts.winner ? 'player1' : null,
      phase: opts.winner ? 'GAME_OVER' : 'MAIN',
    } as GameState;
  }

  it('メトロポリス/守護VP/isCk を集計する（cities はメトロポリス含む総数）', () => {
    const r = buildPlayerRecap(ckState({ metropolis: true, defenderVP: 2 }), 'player1');
    expect(r.isCk).toBe(true);
    expect(r.cities).toBe(2);
    expect(r.metropolises).toBe(1);
    expect(r.defenderVP).toBe(2);
  });

  it('天守(メトロポリス)保持者の講評に「天守」を含む', () => {
    expect(buildPlayerRecap(ckState({ metropolis: true, winner: true }), 'player1').comment).toContain('天守');
  });

  it('守護VPが高いと「守護」を含む講評になる（メトロポリス無し）', () => {
    expect(buildPlayerRecap(ckState({ defenderVP: 3 }), 'player1').comment).toContain('守護');
  });

  it('商人コマ保持と進歩カード永久VPを内訳用に集計する', () => {
    const r = buildPlayerRecap(ckState({ merchant: true, progressVP: 2 }), 'player1');
    expect(r.hasMerchant).toBe(true);
    expect(r.progressVP).toBe(2);
    // 商人を持たない相手は false。
    expect(buildPlayerRecap(ckState({ merchant: true }), 'player2').hasMerchant).toBe(false);
  });
});
