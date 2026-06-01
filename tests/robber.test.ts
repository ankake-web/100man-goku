// ============================================================
// tests/robber.test.ts — L-07: 強盗ロジック テスト
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  handTotal, discardCount, discardResources,
  moveRobber, getRobbablePlayerIds, stealResource,
} from '../src/engine/robber';
import { makeHand, ROBBER_HAND_DISCARD_MIN } from '../src/constants';
import { makeGameState, makePlayer } from './helpers';
import type { GameState } from '../src/types';

// ============================================================
// handTotal
// ============================================================

describe('handTotal', () => {
  it('returns 0 for empty hand', () => {
    const s = makeGameState();
    expect(handTotal(s, 'player1')).toBe(0);
  });

  it('sums all resource types correctly', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 2, brick: 3, wool: 1 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(handTotal(s, 'player1')).toBe(6);
  });

  it('returns 0 for unknown playerId', () => {
    const s = makeGameState();
    expect(handTotal(s, 'player4')).toBe(0);
  });
});

// ============================================================
// discardCount
// ============================================================

describe('discardCount', () => {
  it('returns 0 when hand < 8', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 7 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(discardCount(s, 'player1')).toBe(0);
  });

  it(`returns 0 when hand is exactly ${ROBBER_HAND_DISCARD_MIN - 1}`, () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 7 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(discardCount(s, 'player1')).toBe(0);
  });

  it('returns floor(total/2) when hand >= 8', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 8 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(discardCount(s, 'player1')).toBe(4);
  });

  it('floors the result (9 cards → discard 4)', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 9 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(discardCount(s, 'player1')).toBe(4);
  });

  it('10 cards → discard 5', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 5, brick: 5 }) }),
        player2: makePlayer('player2'),
      },
    });
    expect(discardCount(s, 'player1')).toBe(5);
  });
});

// ============================================================
// discardResources
// ============================================================

describe('discardResources', () => {
  it('deducts specified resources from player hand', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4, brick: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = discardResources(s, 'player1', { wood: 2, brick: 2 });
    expect(next.players['player1']!.hand.wood).toBe(2);
    expect(next.players['player1']!.hand.brick).toBe(2);
  });

  it('returns discarded resources to bank', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ ore: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = discardResources(s, 'player1', { ore: 3 });
    expect(next.bank.ore).toBe(s.bank.ore + 3);
  });

  it('handles partial discard (only some resource types)', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 3, grain: 5 }) }),
        player2: makePlayer('player2'),
      },
    });
    const next = discardResources(s, 'player1', { grain: 2 });
    expect(next.players['player1']!.hand.wood).toBe(3);
    expect(next.players['player1']!.hand.grain).toBe(3);
  });

  it('does not mutate original state', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand({ wood: 4 }) }),
        player2: makePlayer('player2'),
      },
    });
    discardResources(s, 'player1', { wood: 4 });
    expect(s.players['player1']!.hand.wood).toBe(4);
  });
});

// ============================================================
// moveRobber
// ============================================================

describe('moveRobber', () => {
  function getDesertTileId(s: GameState): string {
    return Object.values(s.tiles).find(t => t.hasRobber)!.id;
  }

  it('places robber on new tile', () => {
    const s = makeGameState();
    const nonDesert = Object.values(s.tiles).find(t => !t.hasRobber)!.id;
    const next = moveRobber(s, nonDesert);
    expect(next.tiles[nonDesert]!.hasRobber).toBe(true);
  });

  it('removes robber from old tile', () => {
    const s = makeGameState();
    const oldId = getDesertTileId(s);
    const newId = Object.values(s.tiles).find(t => !t.hasRobber)!.id;
    const next = moveRobber(s, newId);
    expect(next.tiles[oldId]!.hasRobber).toBe(false);
  });

  it('exactly one tile has robber after move', () => {
    const s = makeGameState();
    const newId = Object.values(s.tiles).find(t => !t.hasRobber)!.id;
    const next = moveRobber(s, newId);
    const robberCount = Object.values(next.tiles).filter(t => t.hasRobber).length;
    expect(robberCount).toBe(1);
  });

  it('can move robber to same tile (no-op on position)', () => {
    const s = makeGameState();
    const currentId = getDesertTileId(s);
    const next = moveRobber(s, currentId);
    expect(next.tiles[currentId]!.hasRobber).toBe(true);
  });
});

// ============================================================
// getRobbablePlayerIds
// ============================================================

describe('getRobbablePlayerIds', () => {
  it('returns empty array when no other player has building on tile', () => {
    const s = makeGameState();
    const tileId = Object.keys(s.tileToVertices)[0]!;
    const result = getRobbablePlayerIds(s, tileId, 'player1');
    expect(result).toEqual([]);
  });

  it('returns opponent player when they have settlement on tile', () => {
    const s = makeGameState();
    const tileId = Object.keys(s.tileToVertices)[0]!;
    const vIds = s.tileToVertices[tileId]!;
    const vid = vIds[0]!;
    const updated: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vid]: {
          ...s.vertices[vid]!,
          building: { type: 'settlement', playerId: 'player2' },
        },
      },
    };
    const result = getRobbablePlayerIds(updated, tileId, 'player1');
    expect(result).toContain('player2');
  });

  it('does not include active player', () => {
    const s = makeGameState();
    const tileId = Object.keys(s.tileToVertices)[0]!;
    const vIds = s.tileToVertices[tileId]!;
    const updated: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vIds[0]!]: {
          ...s.vertices[vIds[0]!]!,
          building: { type: 'settlement', playerId: 'player1' },
        },
      },
    };
    const result = getRobbablePlayerIds(updated, tileId, 'player1');
    expect(result).not.toContain('player1');
  });

  it('deduplicates player with multiple buildings on same tile', () => {
    const s = makeGameState();
    const tileId = Object.keys(s.tileToVertices)[0]!;
    const vIds = s.tileToVertices[tileId]!;
    const updated: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [vIds[0]!]: {
          ...s.vertices[vIds[0]!]!,
          building: { type: 'settlement', playerId: 'player2' },
        },
        [vIds[1]!]: {
          ...s.vertices[vIds[1]!]!,
          building: { type: 'city', playerId: 'player2' },
        },
      },
    };
    const result = getRobbablePlayerIds(updated, tileId, 'player1');
    expect(result.filter(p => p === 'player2')).toHaveLength(1);
  });
});

// ============================================================
// stealResource
// ============================================================

describe('stealResource', () => {
  it('transfers 1 resource from target to active player', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand() }),
        player2: makePlayer('player2', { hand: makeHand({ wood: 3 }) }),
      },
    });
    const next = stealResource(s, 'player1', 'player2', () => 0);
    const p1Total = Object.values(next.players['player1']!.hand).reduce((a, b) => a + b, 0);
    const p2Total = Object.values(next.players['player2']!.hand).reduce((a, b) => a + b, 0);
    expect(p1Total).toBe(1);
    expect(p2Total).toBe(2);
  });

  it('does nothing when target has empty hand', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand() }),
        player2: makePlayer('player2', { hand: makeHand() }),
      },
    });
    const next = stealResource(s, 'player1', 'player2');
    expect(next.players['player1']!.hand).toEqual(s.players['player1']!.hand);
    expect(next.players['player2']!.hand).toEqual(s.players['player2']!.hand);
  });

  it('steals the correct resource (deterministic with rng=()=>0)', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand() }),
        player2: makePlayer('player2', { hand: makeHand({ brick: 2, wool: 1 }) }),
      },
    });
    // pool order: brick,brick,wool → index 0 → brick
    const next = stealResource(s, 'player1', 'player2', () => 0);
    expect(next.players['player1']!.hand.brick).toBe(1);
    expect(next.players['player2']!.hand.brick).toBe(1);
  });

  it('does not mutate original state', () => {
    const s = makeGameState({
      players: {
        player1: makePlayer('player1', { hand: makeHand() }),
        player2: makePlayer('player2', { hand: makeHand({ grain: 2 }) }),
      },
    });
    stealResource(s, 'player1', 'player2', () => 0);
    expect(s.players['player2']!.hand.grain).toBe(2);
  });
});
