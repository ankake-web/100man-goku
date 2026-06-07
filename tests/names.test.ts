import { describe, it, expect } from 'vitest';
import { NAME_POOL, CPU_NAME_POOL, generateRandomPlayerName, resolveUniqueName, pickCpuNames } from '../src/net/names';
import { createRng } from '../src/engine/setup';

// カタカナのみ（長音符含む）で2〜5文字、英字・記号・絵文字なし
const KATAKANA = /^[゠-ヿー]{2,5}$/;
const first = (s: string): string => [...s][0] ?? '';

describe('NAME_POOL', () => {
  it('contains only short katakana names (no alphabet/emoji)', () => {
    expect(NAME_POOL.length).toBeGreaterThan(10);
    for (const n of NAME_POOL) {
      expect(n).toMatch(KATAKANA);
      expect(n.startsWith('CPU')).toBe(false);
    }
  });
});

describe('CPU_NAME_POOL', () => {
  it('contains only short katakana names with mutually distinct first characters', () => {
    expect(CPU_NAME_POOL.length).toBeGreaterThanOrEqual(4);
    for (const n of CPU_NAME_POOL) expect(n).toMatch(KATAKANA);
    const firsts = CPU_NAME_POOL.map(first);
    expect(new Set(firsts).size).toBe(CPU_NAME_POOL.length); // 先頭文字が全員ユニーク
  });

  it('does not share any first character with the human pool (CPUと人間が一目で別)', () => {
    const human = new Set(NAME_POOL.map(first));
    for (const n of CPU_NAME_POOL) expect(human.has(first(n))).toBe(false);
  });
});

describe('pickCpuNames', () => {
  it('returns names that are unique, distinct-first-char, and avoid the human name', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const human = 'ミナ';
      const count = 4; // 4人卓の最大CPU数
      const names = pickCpuNames(count, [human], createRng(seed));
      expect(names.length).toBe(count);
      expect(new Set(names).size).toBe(count);              // (a) 全員ユニーク
      expect(new Set(names.map(first)).size).toBe(count);   // (b) 先頭文字が全員異なる
      expect(names.includes(human)).toBe(false);            // (c) 人間名と衝突しない
    }
  });

  it('can fill the whole pool keeping every first character distinct', () => {
    const names = pickCpuNames(CPU_NAME_POOL.length, [], createRng(7));
    expect(new Set(names).size).toBe(CPU_NAME_POOL.length);
    expect(new Set(names.map(first)).size).toBe(CPU_NAME_POOL.length);
  });
});

describe('generateRandomPlayerName', () => {
  it('returns a pool name not in the existing set', () => {
    const existing = NAME_POOL.slice(0, 5);
    for (let i = 0; i < 30; i++) {
      const n = generateRandomPlayerName(existing, createRng(i + 1));
      expect(NAME_POOL.includes(n)).toBe(true);
      expect(existing.includes(n)).toBe(false);
    }
  });

  it('falls back to a numbered name when the whole pool is used', () => {
    const n = generateRandomPlayerName([...NAME_POOL], createRng(3));
    expect(KATAKANA.test(n.replace(/\d+$/, ''))).toBe(true);
    expect(n).toMatch(/\d+$/); // 末尾数字で一意化
  });

  it('is katakana and 2-5 chars', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRandomPlayerName([], createRng(i + 1))).toMatch(KATAKANA);
    }
  });
});

describe('resolveUniqueName', () => {
  it('keeps an explicit name as-is when there is no collision', () => {
    expect(resolveUniqueName('たろう', ['ミナ', 'ルカ'])).toBe('たろう');
  });

  it('re-picks another pool name when a pool name collides', () => {
    const out = resolveUniqueName('ミナ', ['ミナ'], createRng(2));
    expect(out).not.toBe('ミナ');
    expect(NAME_POOL.includes(out)).toBe(true);
  });

  it('appends a number for an explicit (non-pool) duplicate', () => {
    expect(resolveUniqueName('たろう', ['たろう'])).toBe('たろう2');
    expect(resolveUniqueName('たろう', ['たろう', 'たろう2'])).toBe('たろう3');
  });

  it('two empty-name players never collide (server-style assignment)', () => {
    const existing: string[] = [];
    const a = generateRandomPlayerName(existing, createRng(1)); existing.push(a);
    const b = generateRandomPlayerName(existing, createRng(1)); existing.push(b);
    expect(a).not.toBe(b); // 同じ seed でも既存回避で別名になる
  });
});
