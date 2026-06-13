import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { applyAction } from '../src/engine/game';
import { computeGoldPicks } from '../src/engine/dice';
import { chooseAction } from '../src/engine/ai';
import { RESOURCE_TYPES } from '../src/constants';
import type { GameState, VertexId } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'ai', aiDifficulty: 'normal' },
];
const AI_SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'ai', aiDifficulty: 'normal' },
  { id: 'player2', name: 'B', color: 'blue', type: 'ai', aiDifficulty: 'normal' },
];

const GOLD_TILE = '1,0'; // 新島の金タイル（玄関口・出目10）
const seafarers = (specs = SPECS): GameState =>
  createInitialGameState(specs, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');

// 金タイルに隣接する頂点に pid の建物を置いた state を返す。
function withBuildingOnGold(g: GameState, pid: 'player1' | 'player2', type: 'settlement' | 'city' = 'settlement'): { s: GameState; vid: VertexId } {
  const vid = (g.tileToVertices[GOLD_TILE] ?? [])[0]! as VertexId;
  return {
    vid,
    s: { ...g, vertices: { ...g.vertices, [vid]: { ...g.vertices[vid]!, building: { type, playerId: pid } } } },
  };
}

describe('computeGoldPicks: 金タイル産出の枚数', () => {
  it('出目一致・開拓地=1枚 / 都市=2枚', () => {
    const g = seafarers();
    const settle = withBuildingOnGold(g, 'player1', 'settlement').s;
    expect(computeGoldPicks(settle, 10)).toEqual({ player1: 1 });
    const city = withBuildingOnGold(g, 'player1', 'city').s;
    expect(computeGoldPicks(city, 10)).toEqual({ player1: 2 });
  });

  it('出目不一致 / 7 / 強盗ありは産出しない', () => {
    const { s } = withBuildingOnGold(seafarers(), 'player1');
    expect(computeGoldPicks(s, 8)).toEqual({});
    expect(computeGoldPicks(s, 7)).toEqual({});
    const robbed: GameState = { ...s, tiles: { ...s.tiles, [GOLD_TILE]: { ...s.tiles[GOLD_TILE]!, hasRobber: true } } };
    expect(computeGoldPicks(robbed, 10)).toEqual({});
  });

  it('基本ゲームは金タイルが無く常に空', () => {
    const classic = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'classic');
    expect(computeGoldPicks(classic, 10)).toEqual({});
  });
});

describe('ROLL_DICE → GOLD フェーズ遷移', () => {
  it('金タイルの出目(10)を出すと turnPhase=GOLD・pendingGoldChoice が立つ', () => {
    const { s: built } = withBuildingOnGold(seafarers(), 'player1');
    const s: GameState = { ...built, phase: 'MAIN', turnPhase: 'PRE_ROLL', setupSubPhase: null, currentPlayerIndex: 0 };
    // rng=()=>0.7 → 各ダイス5 → 合計10（金タイルの出目）
    const next = applyAction(s, { type: 'ROLL_DICE' }, () => 0.7);
    expect(next.lastDiceRoll).toEqual([5, 5]);
    expect(next.turnPhase).toBe('GOLD');
    expect(next.pendingGoldChoice).toEqual({ player1: 1 });
  });
});

describe('CHOOSE_GOLD の解決', () => {
  function goldState(pending: Record<string, number>): GameState {
    const { s } = withBuildingOnGold(seafarers(), 'player1');
    return { ...s, phase: 'MAIN', turnPhase: 'GOLD', setupSubPhase: null, currentPlayerIndex: 0, pendingGoldChoice: pending };
  }

  it('選んだ資源が手札へ・バンクから減り、全員解決で TRADE_BUILD へ', () => {
    const s = goldState({ player1: 2 });
    const bankOre = s.bank.ore, bankGrain = s.bank.grain;
    const next = applyAction(s, { type: 'CHOOSE_GOLD', playerId: 'player1', resources: { ore: 1, grain: 1 } });
    expect(next.players.player1!.hand.ore).toBe(s.players.player1!.hand.ore + 1);
    expect(next.players.player1!.hand.grain).toBe(s.players.player1!.hand.grain + 1);
    expect(next.bank.ore).toBe(bankOre - 1);
    expect(next.bank.grain).toBe(bankGrain - 1);
    expect(next.pendingGoldChoice).toEqual({});
    expect(next.turnPhase).toBe('TRADE_BUILD');
  });

  it('多人数: 1人解決しても残りがいれば GOLD のまま、全員で TRADE_BUILD', () => {
    const s = goldState({ player1: 1, player2: 1 });
    const mid = applyAction(s, { type: 'CHOOSE_GOLD', playerId: 'player2', resources: { wool: 1 } });
    expect(mid.turnPhase).toBe('GOLD');
    expect(mid.pendingGoldChoice).toEqual({ player1: 1 });
    const done = applyAction(mid, { type: 'CHOOSE_GOLD', playerId: 'player1', resources: { wood: 1 } });
    expect(done.turnPhase).toBe('TRADE_BUILD');
    expect(done.pendingGoldChoice).toEqual({});
  });

  it('枚数不一致・バンク超過・非GOLDフェーズは弾く', () => {
    const s = goldState({ player1: 2 });
    expect(() => applyAction(s, { type: 'CHOOSE_GOLD', playerId: 'player1', resources: { ore: 1 } })).toThrow();
    const dry: GameState = { ...s, bank: { ...s.bank, ore: 0 } };
    expect(() => applyAction(dry, { type: 'CHOOSE_GOLD', playerId: 'player1', resources: { ore: 2 } })).toThrow();
    const notGold: GameState = { ...s, turnPhase: 'TRADE_BUILD' };
    expect(() => applyAction(notGold, { type: 'CHOOSE_GOLD', playerId: 'player1', resources: { ore: 2 } })).toThrow();
  });
});

describe('AI: 金タイルの選択', () => {
  it('CPU は owed 枚をちょうど選ぶ（不足資源優先）', () => {
    const { s: built } = withBuildingOnGold(seafarers(AI_SPECS), 'player1');
    const s: GameState = { ...built, phase: 'MAIN', turnPhase: 'GOLD', setupSubPhase: null, currentPlayerIndex: 0, pendingGoldChoice: { player1: 2 } };
    const action = chooseAction(s, 'player1', { rng: createRng(3) });
    expect(action?.type).toBe('CHOOSE_GOLD');
    if (action?.type === 'CHOOSE_GOLD') {
      const total = RESOURCE_TYPES.reduce((t, r) => t + (action.resources[r] ?? 0), 0);
      expect(total).toBe(2);
      // 選んだ分は適用でき、GOLD を抜ける
      const next = applyAction(s, action);
      expect(next.turnPhase).toBe('TRADE_BUILD');
    }
  });
});
