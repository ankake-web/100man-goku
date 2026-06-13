import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { applyAction } from '../src/engine/game';
import { computeGoldPicks } from '../src/engine/dice';
import { chooseAction } from '../src/engine/ai';
import { RESOURCE_TYPES, makeHand } from '../src/constants';
import type { GameState, VertexId } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'ai', aiDifficulty: 'normal' },
];
const AI_SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'ai', aiDifficulty: 'normal' },
  { id: 'player2', name: 'B', color: 'blue', type: 'ai', aiDifficulty: 'normal' },
];

const seafarers = (specs = SPECS): GameState =>
  createInitialGameState(specs, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');

// 金タイルのID・出目はシナリオから動的に取得（マップ変更に強い）。
const GOLD_TILE = Object.values(seafarers().tiles).find(t => t.type === 'gold')!.id;
const GOLD_NUM = seafarers().tiles[GOLD_TILE]!.number!;     // 金タイルの出目
const NON_GOLD_NUM = GOLD_NUM === 5 ? 9 : 5;                // 金と一致しない出目

// 合計 total になる固定ダイス目を返す rng（die=floor(rng*6)+1）。
function rngForTotal(total: number): () => number {
  const d1 = Math.min(6, Math.max(1, total - 6 > 0 ? total - 6 : Math.floor(total / 2)));
  const d2 = total - d1;
  const seq = [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01];
  let i = 0;
  return () => seq[(i++) % 2]!;
}

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
    expect(computeGoldPicks(settle, GOLD_NUM)).toEqual({ player1: 1 });
    const city = withBuildingOnGold(g, 'player1', 'city').s;
    expect(computeGoldPicks(city, GOLD_NUM)).toEqual({ player1: 2 });
  });

  it('出目不一致 / 7 / 強盗ありは産出しない', () => {
    const { s } = withBuildingOnGold(seafarers(), 'player1');
    expect(computeGoldPicks(s, NON_GOLD_NUM)).toEqual({});
    expect(computeGoldPicks(s, 7)).toEqual({});
    const robbed: GameState = { ...s, tiles: { ...s.tiles, [GOLD_TILE]: { ...s.tiles[GOLD_TILE]!, hasRobber: true } } };
    expect(computeGoldPicks(robbed, GOLD_NUM)).toEqual({});
  });

  it('基本ゲームは金タイルが無く常に空', () => {
    const classic = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'classic');
    expect(computeGoldPicks(classic, GOLD_NUM)).toEqual({});
  });
});

describe('ROLL_DICE → GOLD フェーズ遷移', () => {
  it('金タイルの出目(10)を出すと turnPhase=GOLD・pendingGoldChoice が立つ', () => {
    const { s: built } = withBuildingOnGold(seafarers(), 'player1');
    const s: GameState = { ...built, phase: 'MAIN', turnPhase: 'PRE_ROLL', setupSubPhase: null, currentPlayerIndex: 0 };
    // rng=()=>0.7 → 各ダイス5 → 合計10（金タイルの出目）
    const next = applyAction(s, { type: "ROLL_DICE" }, rngForTotal(GOLD_NUM));
    expect((next.lastDiceRoll![0] + next.lastDiceRoll![1])).toBe(GOLD_NUM);
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

describe('GOLD 多人数×バンク枯渇でソフトロックしない（レビュー指摘の修正）', () => {
  // 金タイルの2頂点に player1/player2 の建物を置き、出目10を振る state を作る。
  function twoOwners(bank: ReturnType<typeof makeHand>): GameState {
    const g = seafarers();
    const vids = g.tileToVertices[GOLD_TILE] ?? [];
    const [v1, v2] = vids as VertexId[];
    return {
      ...g, phase: 'MAIN', turnPhase: 'PRE_ROLL', setupSubPhase: null, currentPlayerIndex: 0, bank,
      vertices: {
        ...g.vertices,
        [v1!]: { ...g.vertices[v1!]!, building: { type: 'settlement', playerId: 'player1' } },
        [v2!]: { ...g.vertices[v2!]!, building: { type: 'settlement', playerId: 'player2' } },
      },
    };
  }

  it('owed 合計はバンク総在庫を超えない（逐次キャップ）', () => {
    // バンク総在庫1・2人 owed → 取れる人だけ owed になり、解決して TRADE_BUILD へ。
    const s = twoOwners(makeHand({ wool: 1 }));
    const rolled = applyAction(s, { type: "ROLL_DICE" }, rngForTotal(GOLD_NUM)); // 5+5=10（金タイルの出目）
    expect(rolled.turnPhase).toBe('GOLD');
    const owed = rolled.pendingGoldChoice ?? {};
    const sum = Object.values(owed).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(1); // バンク総在庫を超えない
    let st = rolled;
    for (const pid of Object.keys(owed)) {
      st = applyAction(st, { type: 'CHOOSE_GOLD', playerId: pid, resources: { wool: owed[pid] } });
    }
    expect(st.turnPhase).toBe('TRADE_BUILD'); // 全員解決でき soft-lock しない
  });

  it('バンク総在庫2・2人 owed → どの順で解決しても TRADE_BUILD（順序非依存）', () => {
    const s = twoOwners(makeHand({ wool: 1, grain: 1 }));
    const rolled = applyAction(s, { type: "ROLL_DICE" }, rngForTotal(GOLD_NUM));
    expect(rolled.pendingGoldChoice).toEqual({ player1: 1, player2: 1 });
    // player2 を先に解決（在庫を先に引く）→ player1 が残在庫で必ず取れる
    const mid = applyAction(rolled, { type: 'CHOOSE_GOLD', playerId: 'player2', resources: { wool: 1 } });
    expect(mid.turnPhase).toBe('GOLD');
    const done = applyAction(mid, { type: 'CHOOSE_GOLD', playerId: 'player1', resources: { grain: 1 } });
    expect(done.turnPhase).toBe('TRADE_BUILD');
  });

  it('CPU も枯渇時に合法手を出せる（chooseAction が owed 枚ちょうど）', () => {
    const base = twoOwners(makeHand({ wool: 1 }));
    const rolled = applyAction(base, { type: "ROLL_DICE" }, rngForTotal(GOLD_NUM));
    for (const pid of Object.keys(rolled.pendingGoldChoice ?? {})) {
      const a = chooseAction(rolled, pid as 'player1' | 'player2', { rng: createRng(1) });
      expect(a?.type).toBe('CHOOSE_GOLD');
      // 出した手は必ず適用できる（在庫内・owed 枚ちょうど）
      expect(() => applyAction(rolled, a!)).not.toThrow();
    }
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
