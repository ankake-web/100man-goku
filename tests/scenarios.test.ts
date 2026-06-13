import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { getScenario, listScenarios } from '../src/engine/scenarios';
import { getAllTileCoords } from '../src/engine/board';
import { createRng } from '../src/engine/setup';
import type { Tile } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',    type: 'human' },
  { id: 'player2', name: 'B', color: 'blue',   type: 'ai', aiDifficulty: 'normal' },
];

const count = (tiles: Record<string, Tile>, type: string): number =>
  Object.values(tiles).filter(t => t.type === type).length;

describe('scenarios: registry', () => {
  it('lists classic and seafarers', () => {
    const ids = listScenarios().map(s => s.id);
    expect(ids).toContain('classic');
    expect(ids).toContain('seafarers_newshores');
  });
  it('unknown id falls back to classic', () => {
    // @ts-expect-error 故意に未知ID
    expect(getScenario('nope').id).toBe('classic');
  });
});

describe('scenarios: classic は従来どおり（非破壊）', () => {
  it('既定で19タイル・海/金タイルを含まない', () => {
    const s = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(7));
    expect(Object.keys(s.tiles)).toHaveLength(19);
    expect(count(s.tiles, 'sea')).toBe(0);
    expect(count(s.tiles, 'gold')).toBe(0);
    expect(count(s.tiles, 'desert')).toBe(1);
    // 盗賊は砂漠から開始（従来仕様）
    const robberTile = Object.values(s.tiles).find(t => t.hasRobber)!;
    expect(robberTile.type).toBe('desert');
  });
  it('明示的に classic を渡しても同じ盤面（決定論）', () => {
    const a = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(42));
    const b = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(42), 'classic');
    expect(a.tiles).toEqual(b.tiles);
  });
});

describe('scenarios: 航海者「新たな海岸を求めて」(Phase 0)', () => {
  const s = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');

  it('19タイル footprint（既存viewBoxに収まる）', () => {
    expect(Object.keys(s.tiles)).toHaveLength(19);
    // 座標は基本盤と同一集合
    const ids = new Set(Object.keys(s.tiles));
    for (const c of getAllTileCoords()) expect(ids.has(`${c.q},${c.r}`)).toBe(true);
  });

  it('二島（本島7+新島4=陸11）/ 海8。新島に金タイル1枚（Phase 2）', () => {
    expect(count(s.tiles, 'sea')).toBe(8);
    expect(count(s.tiles, 'gold')).toBe(1);
    expect(count(s.tiles, 'desert')).toBe(1);
    const land = 19 - 8; // 海以外（金タイルも陸に含む）
    expect(land).toBe(11);
    // 金タイルは新島(右)の玄関口(1,0)に置かれ、出目を持つ
    expect(s.tiles['1,0']?.type).toBe('gold');
    expect(s.tiles['1,0']?.number).toBe(10);
  });

  it('左右の陸塊が海峡(q=0列)で分離されている（隣接しない＝船が必要）', () => {
    // q=0 の列は全て海
    for (const r of [-2, -1, 0, 1, 2]) {
      expect(s.tiles[`0,${r}`]?.type).toBe('sea');
    }
    // 左(q=-1,-2)と右(q=1,2)に陸がある
    expect(s.tiles['-1,0']?.type).toBe('desert');
    expect(s.tiles['2,0']?.type).toBe('hill');
  });

  it('海タイルは数字なし・盗賊なし。陸タイルは砂漠以外に数字あり', () => {
    for (const t of Object.values(s.tiles)) {
      if (t.type === 'sea') {
        expect(t.number).toBeNull();
        expect(t.hasRobber).toBe(false);
      } else if (t.type !== 'desert') {
        expect(t.number).not.toBeNull();
      }
    }
  });

  it('盗賊は本島の砂漠(-1,0)から開始', () => {
    const robber = Object.values(s.tiles).find(t => t.hasRobber)!;
    expect(robber.id).toBe('-1,0');
    expect(robber.type).toBe('desert');
  });

  it('盤面幾何（頂点/辺）は基本盤と同一構造（座標が同じため）', () => {
    expect(Object.keys(s.vertices)).toHaveLength(54);
    expect(Object.keys(s.edges)).toHaveLength(72);
  });
});
