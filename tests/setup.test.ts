import { describe, it, expect } from 'vitest';
import {
  createRng,
  shuffle,
  assignTileTypes,
  placeNumberTokens,
  createHarbors,
  createRandomBoard,
  resolvePlayerOrder,
  isValidOrderSpec,
} from '../src/engine/setup';
import { applyAction } from '../src/engine/game';
import { chooseAction } from '../src/engine/ai';
import { makeGameState, makePlayer } from './helpers';
import type { GameState, PlayerId } from '../src/types';
import { buildBoardGeometry, getAllTileCoords, getTileNeighbors, tileId } from '../src/engine/board';
import { TILE_COUNTS, NUMBER_TOKENS } from '../src/constants';

// ============================================================
// createRng
// ============================================================

describe('createRng', () => {
  it('same seed produces identical sequence', () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    const seq1 = Array.from({ length: 20 }, () => r1());
    const seq2 = Array.from({ length: 20 }, () => r2());
    expect(seq1).toEqual(seq2);
  });

  it('different seeds produce different sequences', () => {
    const r1 = createRng(1);
    const r2 = createRng(2);
    const seq1 = Array.from({ length: 10 }, () => r1());
    const seq2 = Array.from({ length: 10 }, () => r2());
    expect(seq1).not.toEqual(seq2);
  });

  it('output is in [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ============================================================
// shuffle
// ============================================================

describe('shuffle', () => {
  it('returns same length', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toHaveLength(5);
  });

  it('contains same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr, createRng(7)).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not mutate original array', () => {
    const arr = [1, 2, 3, 4, 5];
    shuffle(arr, createRng(1));
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic with seeded rng', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r1 = createRng(123);
    const r2 = createRng(123);
    expect(shuffle(arr, r1)).toEqual(shuffle(arr, r2));
  });

  it('produces different results with different seeds', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const s1 = shuffle(arr, createRng(1));
    const s2 = shuffle(arr, createRng(2));
    expect(s1).not.toEqual(s2);
  });
});

// ============================================================
// assignTileTypes
// ============================================================

describe('assignTileTypes', () => {
  const coords = getAllTileCoords();

  it('returns exactly 19 tiles', () => {
    const tiles = assignTileTypes(coords, createRng(1));
    expect(Object.keys(tiles)).toHaveLength(19);
  });

  it('tile type counts match TILE_COUNTS', () => {
    const tiles = assignTileTypes(coords, createRng(2));
    const counts: Record<string, number> = {};
    Object.values(tiles).forEach(t => {
      counts[t.type] = (counts[t.type] ?? 0) + 1;
    });
    for (const [type, expected] of Object.entries(TILE_COUNTS)) {
      // 0件の種別（航海者用の sea/gold は基本盤に出現しない）は undefined になる。
      expect(counts[type] ?? 0).toBe(expected);
    }
  });

  it('exactly 1 desert tile', () => {
    const tiles = assignTileTypes(coords, createRng(3));
    const deserts = Object.values(tiles).filter(t => t.type === 'desert');
    expect(deserts).toHaveLength(1);
  });

  it('desert tile has hasRobber = true', () => {
    const tiles = assignTileTypes(coords, createRng(4));
    const desert = Object.values(tiles).find(t => t.type === 'desert');
    expect(desert?.hasRobber).toBe(true);
  });

  it('non-desert tiles have hasRobber = false', () => {
    const tiles = assignTileTypes(coords, createRng(5));
    Object.values(tiles)
      .filter(t => t.type !== 'desert')
      .forEach(t => expect(t.hasRobber).toBe(false));
  });

  it('all tiles have number = null initially', () => {
    const tiles = assignTileTypes(coords, createRng(6));
    Object.values(tiles).forEach(t => expect(t.number).toBeNull());
  });

  it('tile IDs match coords', () => {
    const tiles = assignTileTypes(coords, createRng(7));
    coords.forEach(c => {
      expect(tiles[tileId(c)]).toBeDefined();
    });
  });
});

// ============================================================
// placeNumberTokens
// ============================================================

describe('placeNumberTokens', () => {
  function makeBoard(seed: number) {
    const coords = getAllTileCoords();
    const tiles = assignTileTypes(coords, createRng(seed));
    placeNumberTokens(tiles, createRng(seed + 1000));
    return tiles;
  }

  it('all non-desert tiles receive a number token', () => {
    const tiles = makeBoard(10);
    Object.values(tiles)
      .filter(t => t.type !== 'desert')
      .forEach(t => expect(t.number).not.toBeNull());
  });

  it('desert tile has no number token', () => {
    const tiles = makeBoard(11);
    const desert = Object.values(tiles).find(t => t.type === 'desert');
    expect(desert?.number).toBeNull();
  });

  it('exactly 18 tiles have number tokens', () => {
    const tiles = makeBoard(12);
    const withNumber = Object.values(tiles).filter(t => t.number !== null);
    expect(withNumber).toHaveLength(18);
  });

  it('number token distribution matches NUMBER_TOKENS', () => {
    const tiles = makeBoard(13);
    const placed = Object.values(tiles)
      .map(t => t.number)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    const expected = [...NUMBER_TOKENS].sort((a, b) => a - b);
    expect(placed).toEqual(expected);
  });

  it('number tokens are only valid values (2-12, no 7)', () => {
    const tiles = makeBoard(14);
    Object.values(tiles)
      .filter(t => t.number !== null)
      .forEach(t => {
        expect(t.number).toBeGreaterThanOrEqual(2);
        expect(t.number).toBeLessThanOrEqual(12);
        expect(t.number).not.toBe(7);
      });
  });

  it('no red tokens (6 or 8) are adjacent to each other', () => {
    // 複数シードでテスト（確率的バグを検出）
    for (let seed = 0; seed < 30; seed++) {
      const coords = getAllTileCoords();
      const tiles = assignTileTypes(coords, createRng(seed));
      placeNumberTokens(tiles, createRng(seed + 500));

      coords.forEach(coord => {
        const tile = tiles[tileId(coord)];
        if (tile?.number !== 6 && tile?.number !== 8) return;

        // 赤トークンの隣接タイルを確認
        getTileNeighbors(coord).forEach((n: { q: number; r: number }) => {
          const neighbor = tiles[tileId(n)];
          if (neighbor?.number === 6 || neighbor?.number === 8) {
            throw new Error(
              `Red conflict seed=${seed}: tile (${coord.q},${coord.r})=${tile?.number} ` +
              `adj (${n.q},${n.r})=${neighbor.number}`
            );
          }
        });
      });
    }
  });

  it('6 appears exactly twice', () => {
    const tiles = makeBoard(15);
    const sixes = Object.values(tiles).filter(t => t.number === 6);
    expect(sixes).toHaveLength(2);
  });

  it('8 appears exactly twice', () => {
    const tiles = makeBoard(16);
    const eights = Object.values(tiles).filter(t => t.number === 8);
    expect(eights).toHaveLength(2);
  });

  it('2 appears exactly once', () => {
    const tiles = makeBoard(17);
    const twos = Object.values(tiles).filter(t => t.number === 2);
    expect(twos).toHaveLength(1);
  });

  it('12 appears exactly once', () => {
    const tiles = makeBoard(18);
    const twelves = Object.values(tiles).filter(t => t.number === 12);
    expect(twelves).toHaveLength(1);
  });
});

// ============================================================
// createHarbors
// ============================================================

describe('createHarbors', () => {
  const geo = buildBoardGeometry();

  it('returns exactly 9 harbors', () => {
    const harbors = createHarbors(geo, createRng(20));
    expect(harbors).toHaveLength(9);
  });

  it('harbor type distribution: 4 generic + 5 resource-specific', () => {
    const harbors = createHarbors(buildBoardGeometry(), createRng(21));
    const generics = harbors.filter(h => h.type === 'generic');
    const specifics = harbors.filter(h => h.type !== 'generic');
    expect(generics).toHaveLength(4);
    expect(specifics).toHaveLength(5);
  });

  it('each resource type appears exactly once as a specific harbor', () => {
    const harbors = createHarbors(buildBoardGeometry(), createRng(22));
    const specifics = harbors.filter(h => h.type !== 'generic').map(h => h.type);
    for (const r of ['wood', 'brick', 'wool', 'grain', 'ore']) {
      expect(specifics).toContain(r);
    }
    expect(new Set(specifics).size).toBe(5);
  });

  it('each harbor has exactly 2 vertex IDs', () => {
    const harbors = createHarbors(buildBoardGeometry(), createRng(23));
    harbors.forEach(h => expect(h.vertexIds).toHaveLength(2));
  });

  it('harbor vertex IDs exist in geometry.vertices', () => {
    const freshGeo = buildBoardGeometry();
    const harbors = createHarbors(freshGeo, createRng(24));
    harbors.forEach(h => {
      h.vertexIds.forEach(vid => {
        expect(freshGeo.vertices[vid]).toBeDefined();
      });
    });
  });

  it('harbor vertices have harborType set after createHarbors', () => {
    const freshGeo = buildBoardGeometry();
    const harbors = createHarbors(freshGeo, createRng(25));
    harbors.forEach(h => {
      h.vertexIds.forEach(vid => {
        expect(freshGeo.vertices[vid]?.harborType).toBe(h.type);
      });
    });
  });

  it('each harbor edge is a boundary edge (claimed by exactly 1 tile)', () => {
    // 境界辺 = その辺を tileToEdges に持つタイルが1枚のみ。
    // 内側の辺は隣接2タイルがそれぞれ tileToEdges に持つため count=2 になる。
    // ※ 境界辺の頂点が内側3タイルに接することはあるが、辺自体は境界に限定される。
    const freshGeo = buildBoardGeometry();
    const harbors = createHarbors(freshGeo, createRng(26));

    // edgeId → 何タイルがこの辺を持つか、逆引きマップを構築
    const edgeTileCount = new Map<string, number>();
    Object.values(freshGeo.tileToEdges).forEach(eids => {
      eids.forEach(eid => {
        edgeTileCount.set(eid, (edgeTileCount.get(eid) ?? 0) + 1);
      });
    });

    harbors.forEach(h => {
      const eid = [...h.vertexIds].sort().join('|');
      expect(edgeTileCount.get(eid)).toBe(1); // 境界辺は1タイルのみが保有
    });
  });

  it('no two harbors share a vertex', () => {
    const freshGeo = buildBoardGeometry();
    const harbors = createHarbors(freshGeo, createRng(27));
    const allVids = harbors.flatMap(h => h.vertexIds);
    expect(new Set(allVids).size).toBe(allVids.length);
  });

  it('harbor IDs are unique', () => {
    const harbors = createHarbors(buildBoardGeometry(), createRng(28));
    const ids = harbors.map(h => h.id);
    expect(new Set(ids).size).toBe(9);
  });
});

// ============================================================
// createRandomBoard (end-to-end)
// ============================================================

describe('createRandomBoard', () => {
  it('returns tiles and harbors', () => {
    const geo = buildBoardGeometry();
    const result = createRandomBoard(geo, createRng(50));
    expect(result.tiles).toBeDefined();
    expect(result.harbors).toBeDefined();
  });

  it('produces 19 tiles and 9 harbors', () => {
    const geo = buildBoardGeometry();
    const result = createRandomBoard(geo, createRng(51));
    expect(Object.keys(result.tiles)).toHaveLength(19);
    expect(result.harbors).toHaveLength(9);
  });

  it('same seed produces identical tile types', () => {
    const g1 = buildBoardGeometry();
    const g2 = buildBoardGeometry();
    const r1 = createRandomBoard(g1, createRng(99));
    const r2 = createRandomBoard(g2, createRng(99));

    const types1 = Object.entries(r1.tiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, t]) => t.type);
    const types2 = Object.entries(r2.tiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, t]) => t.type);
    expect(types1).toEqual(types2);
  });

  it('same seed produces identical number tokens', () => {
    const g1 = buildBoardGeometry();
    const g2 = buildBoardGeometry();
    const r1 = createRandomBoard(g1, createRng(100));
    const r2 = createRandomBoard(g2, createRng(100));

    const nums1 = Object.entries(r1.tiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, t]) => t.number);
    const nums2 = Object.entries(r2.tiles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, t]) => t.number);
    expect(nums1).toEqual(nums2);
  });

  it('same seed produces identical harbor types (in order)', () => {
    const g1 = buildBoardGeometry();
    const g2 = buildBoardGeometry();
    const r1 = createRandomBoard(g1, createRng(101));
    const r2 = createRandomBoard(g2, createRng(101));
    expect(r1.harbors.map(h => h.type)).toEqual(r2.harbors.map(h => h.type));
  });

  it('different seeds produce different boards', () => {
    const g1 = buildBoardGeometry();
    const g2 = buildBoardGeometry();
    const r1 = createRandomBoard(g1, createRng(1));
    const r2 = createRandomBoard(g2, createRng(2));

    const types1 = Object.values(r1.tiles).map(t => t.type).sort().join(',');
    const types2 = Object.values(r2.tiles).map(t => t.type).sort().join(',');
    // 種別の合計は同じだが、配置は違うはず（同じになる極めて低い確率は無視）
    const nums1 = Object.entries(r1.tiles).sort(([a],[b])=>a.localeCompare(b)).map(([,t])=>t.number).join(',');
    const nums2 = Object.entries(r2.tiles).sort(([a],[b])=>a.localeCompare(b)).map(([,t])=>t.number).join(',');
    // どちらか一方が違えばOK（両方同じになる確率は天文学的に低い）
    expect(nums1 === nums2 && types1 === types2).toBe(false);
  });

  it('red token constraint holds across multiple seeds', () => {
    for (let seed = 200; seed < 220; seed++) {
      const geo = buildBoardGeometry();
      const { tiles } = createRandomBoard(geo, createRng(seed));
      const coords = getAllTileCoords();

      coords.forEach(coord => {
        const tile = tiles[tileId(coord)];
        if (tile?.number !== 6 && tile?.number !== 8) return;

        getTileNeighbors(coord).forEach((n: { q: number; r: number }) => {
          const neighbor = tiles[tileId(n)];
          expect(neighbor?.number).not.toBe(6);
          expect(neighbor?.number).not.toBe(8);
        });
      });
    }
  });
});

// ============================================================
// プレイヤー手番順（resolvePlayerOrder / isValidOrderSpec）
// ============================================================

describe('isValidOrderSpec', () => {
  const base: PlayerId[] = ['player1', 'player2', 'player3'];

  it('正しい順列を有効と判定する', () => {
    expect(isValidOrderSpec(base, ['player3', 'player1', 'player2'])).toBe(true);
  });
  it('長さ不一致は無効', () => {
    expect(isValidOrderSpec(base, ['player1', 'player2'])).toBe(false);
    expect(isValidOrderSpec(base, ['player1', 'player2', 'player3', 'player4'])).toBe(false);
  });
  it('未知IDを含む場合は無効', () => {
    expect(isValidOrderSpec(base, ['player1', 'player2', 'player4'])).toBe(false);
  });
  it('重複を含む場合は無効', () => {
    expect(isValidOrderSpec(base, ['player1', 'player1', 'player2'])).toBe(false);
  });
  it('undefined は無効', () => {
    expect(isValidOrderSpec(base, undefined)).toBe(false);
  });
});

describe('resolvePlayerOrder', () => {
  const ids: PlayerId[] = ['player1', 'player2', 'player3', 'player4'];

  it('ランダム順: 全プレイヤーを含む順列を返す', () => {
    const order = resolvePlayerOrder(ids, 'random', undefined, createRng(7));
    expect([...order].sort()).toEqual([...ids].sort());
    expect(order.length).toBe(ids.length);
  });

  it('ランダム順: 同じ seed なら同じ順、異なる seed で再シャッフルされうる', () => {
    const a = resolvePlayerOrder(ids, 'random', undefined, createRng(1));
    const b = resolvePlayerOrder(ids, 'random', undefined, createRng(1));
    expect(a).toEqual(b); // 決定論的（同seed）
    // 異なる seed をいくつか試すと、少なくとも1つは元順と異なる（再ランダム性）
    const seeds = [2, 3, 4, 5, 6, 7, 8, 9];
    const someDifferent = seeds.some(s => {
      const o = resolvePlayerOrder(ids, 'random', undefined, createRng(s));
      return o.join(',') !== ids.join(',');
    });
    expect(someDifferent).toBe(true);
  });

  it('指定順: spec をそのまま返す', () => {
    const spec: PlayerId[] = ['player3', 'player1', 'player4', 'player2'];
    expect(resolvePlayerOrder(ids, 'fixed', spec)).toEqual(spec);
  });

  it('指定順: spec が重複を含む場合は元順にフォールバック', () => {
    const bad: PlayerId[] = ['player1', 'player1', 'player3', 'player4'];
    expect(resolvePlayerOrder(ids, 'fixed', bad)).toEqual(ids);
  });

  it('指定順: 存在しないCPUを含む spec は元順にフォールバック（CPU人数変更時の安全策）', () => {
    // 2人ゲーム（player1, player2）に player3 を含む spec → 無効 → 元順
    const twoIds: PlayerId[] = ['player1', 'player2'];
    const stale: PlayerId[] = ['player1', 'player2', 'player3'];
    expect(resolvePlayerOrder(twoIds, 'fixed', stale)).toEqual(twoIds);
  });

  it('指定順: 再戦相当（同じ spec で複数回呼んでも壊れず安定）', () => {
    const spec: PlayerId[] = ['player2', 'player1', 'player3'];
    const ids3: PlayerId[] = ['player1', 'player2', 'player3'];
    const r1 = resolvePlayerOrder(ids3, 'fixed', spec);
    const r2 = resolvePlayerOrder(ids3, 'fixed', spec);
    expect(r1).toEqual(spec);
    expect(r2).toEqual(spec);
  });
});

describe('プレイヤー順が初期配置順・ターン順に反映される', () => {
  // SETUP_FORWARD を AI で進め、開拓地を置いた順を記録する
  function runForwardSettlementOrder(spec: PlayerId[]): PlayerId[] {
    const players: GameState['players'] = {};
    for (const id of spec) players[id] = makePlayer(id, { type: 'ai', aiDifficulty: 'normal' });

    let s = makeGameState({
      phase: 'SETUP_FORWARD',
      setupSubPhase: 'PLACE_SETTLEMENT',
      turnPhase: 'PRE_ROLL',
      currentPlayerIndex: 0,
      players,
      playerOrder: [...spec],
    });

    const placed: PlayerId[] = [];
    for (let i = 0; i < 100; i++) {
      if (s.phase !== 'SETUP_FORWARD') break;
      const pid = s.playerOrder[s.currentPlayerIndex]!;
      const action = chooseAction(s, pid);
      if (!action) break;
      if (action.type === 'BUILD_SETTLEMENT') placed.push(pid);
      s = applyAction(s, action);
    }
    return placed;
  }

  it('指定順が初期配置（SETUP_FORWARD）の開拓地設置順に一致する', () => {
    const spec: PlayerId[] = ['player3', 'player1', 'player2'];
    expect(runForwardSettlementOrder(spec)).toEqual(spec);
  });

  it('別の指定順でも初期配置順がそれに従う', () => {
    const spec: PlayerId[] = ['player2', 'player3', 'player1'];
    expect(runForwardSettlementOrder(spec)).toEqual(spec);
  });

  it('指定順が MAIN フェーズのターン順（END_TURN で次の手番）に反映される', () => {
    const spec: PlayerId[] = ['player2', 'player3', 'player1'];
    const players: GameState['players'] = {};
    for (const id of spec) players[id] = makePlayer(id);

    let s = makeGameState({
      phase: 'MAIN',
      turnPhase: 'TRADE_BUILD',
      currentPlayerIndex: 0,
      players,
      playerOrder: [...spec],
    });

    // 現在の手番は spec[0]
    expect(s.playerOrder[s.currentPlayerIndex]).toBe('player2');
    s = applyAction(s, { type: 'END_TURN' });
    expect(s.playerOrder[s.currentPlayerIndex]).toBe('player3');
    // END_TURN は MAIN/TRADE_BUILD でのみ許可されるため、手番順検証用に再び TRADE_BUILD へ戻す
    s = { ...s, turnPhase: 'TRADE_BUILD' };
    s = applyAction(s, { type: 'END_TURN' });
    expect(s.playerOrder[s.currentPlayerIndex]).toBe('player1');
    s = { ...s, turnPhase: 'TRADE_BUILD' };
    s = applyAction(s, { type: 'END_TURN' });
    // 一巡して先頭へ
    expect(s.playerOrder[s.currentPlayerIndex]).toBe('player2');
  });
});
