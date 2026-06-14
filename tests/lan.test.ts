import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { maskStateFor } from '../src/engine/mask';
import { createRng } from '../src/engine/setup';
import { RESOURCE_TYPES } from '../src/constants';
import type { GameState, PlayerId } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',    type: 'human' },
  { id: 'player2', name: 'B', color: 'blue',   type: 'human' },
  { id: 'player3', name: 'C', color: 'purple', type: 'human' },
];

describe('createInitialGameState', () => {
  it('creates a SETUP state with the given human players', () => {
    const s = createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']);
    expect(s.phase).toBe('SETUP_FORWARD');
    expect(s.turnPhase).toBe('PRE_ROLL');
    expect(Object.keys(s.players)).toHaveLength(3);
    expect(s.players.player1!.type).toBe('human');
    expect(s.players.player2!.name).toBe('B');
    expect(s.playerOrder).toEqual(['player1', 'player2', 'player3']);
  });

  it('has a full 19-tile board and standard bank/dev deck', () => {
    const s = createInitialGameState(SPECS, 'random', undefined);
    expect(Object.keys(s.tiles)).toHaveLength(19);
    expect(s.devDeck.length).toBe(25);
    expect(s.bank.wood).toBeGreaterThan(0);
  });

  it('is deterministic when given the same seeded rng', () => {
    const a = createInitialGameState(SPECS, 'random', undefined, createRng(42));
    const b = createInitialGameState(SPECS, 'random', undefined, createRng(42));
    expect(a.playerOrder).toEqual(b.playerOrder);
    expect(Object.keys(a.tiles).map(t => a.tiles[t]!.number))
      .toEqual(Object.keys(b.tiles).map(t => b.tiles[t]!.number));
  });
});

describe('maskStateFor', () => {
  // 手札と発展カードを持たせた state を用意
  function withHands(base: GameState): GameState {
    const players = { ...base.players };
    players.player1 = {
      ...players.player1!,
      hand: { wood: 2, brick: 1, wool: 0, grain: 0, ore: 0 },
      devCards: [{ id: 'd1', type: 'victory_point', purchasedOnTurn: 0 }],
    };
    players.player2 = {
      ...players.player2!,
      hand: { wood: 0, brick: 0, wool: 3, grain: 1, ore: 0 },
      devCards: [
        { id: 'd2', type: 'knight', purchasedOnTurn: 0 },
        { id: 'd3', type: 'monopoly', purchasedOnTurn: 0 },
      ],
    };
    return { ...base, players };
  }

  const total = (h: Record<string, number>) =>
    RESOURCE_TYPES.reduce((s, r) => s + (h[r] ?? 0), 0);

  it('reveals the viewer’s own hand and dev cards unchanged', () => {
    const s = withHands(createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']));
    const masked = maskStateFor(s, 'player1');
    expect(masked.players.player1!.hand).toEqual(s.players.player1!.hand);
    expect(masked.players.player1!.devCards).toEqual(s.players.player1!.devCards);
    expect(masked.players.player1!.handCount).toBeUndefined();
  });

  it('hides other players’ hand composition but keeps the count', () => {
    const s = withHands(createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']));
    const masked = maskStateFor(s, 'player1');
    const p2 = masked.players.player2!;
    // 中身は全0（DevTools で覗いても構成不明）
    expect(total(p2.hand)).toBe(0);
    // 枚数だけ開示
    expect(p2.handCount).toBe(4);
  });

  it('hides other players’ dev card contents but keeps the count', () => {
    const s = withHands(createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']));
    const masked = maskStateFor(s, 'player1');
    const p2 = masked.players.player2!;
    expect(p2.devCards).toEqual([]);
    expect(p2.devCardCount).toBe(2);
  });

  it('hides other players’ commodities and progress cards but keeps the counts (C&K)', () => {
    const base = createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']);
    const players = { ...base.players };
    players.player2 = {
      ...players.player2!,
      commodities: { coin: 2, cloth: 1, paper: 0 },
      progressCards: [
        { id: 's_smith_0', type: 'smith', deck: 'science' },
        { id: 'p_warlord_1', type: 'warlord', deck: 'politics' },
      ],
    };
    const s = { ...base, expansion: 'cities_knights' as const, players };
    const p2 = maskStateFor(s, 'player1').players.player2!;
    // 内訳は隠れる
    expect(p2.commodities).toEqual({ coin: 0, cloth: 0, paper: 0 });
    expect(p2.progressCards).toEqual([]);
    // 枚数だけ開示
    expect(p2.commodityCount).toBe(3);
    expect(p2.progressCardCount).toBe(2);
    // 自分視点では自分の内訳はそのまま
    const me = maskStateFor(s, 'player2').players.player2!;
    expect(me.commodities).toEqual({ coin: 2, cloth: 1, paper: 0 });
    expect(me.progressCards).toHaveLength(2);
  });

  it('produces different views per viewer (no cross-leak)', () => {
    const s = withHands(createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']));
    const forP1 = maskStateFor(s, 'player1');
    const forP2 = maskStateFor(s, 'player2');
    // p1 視点では p2 の中身が隠れ、p2 視点では p1 の中身が隠れる
    expect(total(forP1.players.player2!.hand)).toBe(0);
    expect(forP1.players.player1!.hand).toEqual(s.players.player1!.hand);
    expect(total(forP2.players.player1!.hand)).toBe(0);
    expect(forP2.players.player2!.hand).toEqual(s.players.player2!.hand);
  });

  it('does not mutate the source state', () => {
    const s = withHands(createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']));
    const snapshot = JSON.stringify(s.players.player2);
    maskStateFor(s, 'player1');
    expect(JSON.stringify(s.players.player2)).toBe(snapshot);
  });

  it('keeps public info (names, colors, order) intact', () => {
    const s = createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']);
    const masked = maskStateFor(s, 'player3' as PlayerId);
    expect(masked.playerOrder).toEqual(s.playerOrder);
    expect(masked.players.player1!.name).toBe('A');
    expect(masked.players.player2!.color).toBe('blue');
  });

  it('hides the dev-card deck order/types but keeps the remaining count (H1)', () => {
    const s = createInitialGameState(SPECS, 'fixed', ['player1', 'player2', 'player3']);
    const real = s.devDeck;
    expect(real.length).toBe(25);
    const masked = maskStateFor(s, 'player1');
    // 残り枚数（公開情報）は保たれる
    expect(masked.devDeck.length).toBe(real.length);
    // 種類・並び順・id は実山札と一致しない＝「次に引くカード」を先読みできない
    const realSig = real.map(c => `${c.id}:${c.type}`).join(',');
    const maskedSig = masked.devDeck.map(c => `${c.id}:${c.type}`).join(',');
    expect(maskedSig).not.toBe(realSig);
    for (const c of masked.devDeck) expect(c.id).toBe('');
    // GAME_OVER の勝者公開時も山札は秘匿のまま（勝者の Player だけが開示される）
    const over = maskStateFor({ ...s, phase: 'GAME_OVER', winner: 'player1' }, 'player2' as PlayerId);
    for (const c of over.devDeck) expect(c.id).toBe('');
  });
});
