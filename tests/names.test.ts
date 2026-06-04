import { describe, it, expect } from 'vitest';
import { NAME_POOL, generateRandomPlayerName, resolveUniqueName } from '../src/net/names';
import { createRng } from '../src/engine/setup';

// カタカナのみ（長音符含む）で2〜5文字、英字・記号・絵文字なし
const KATAKANA = /^[゠-ヿー]{2,5}$/;

describe('NAME_POOL', () => {
  it('contains only short katakana names (no alphabet/emoji)', () => {
    expect(NAME_POOL.length).toBeGreaterThan(10);
    for (const n of NAME_POOL) {
      expect(n).toMatch(KATAKANA);
      expect(n.startsWith('CPU')).toBe(false);
    }
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
