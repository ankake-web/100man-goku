// ============================================================
// tests/clip.test.ts — 盤上ミニパネル名の表示幅切り詰め（省略記号なし）
// ============================================================

import { describe, it, expect } from 'vitest';
import { clipByWidth } from '../src/renderer/ui';

describe('clipByWidth (全角=2 / 半角=1, 上限8=全角4相当, 省略記号なし)', () => {
  it('全角は最大4文字まで', () => {
    expect(clipByWidth('プレイヤー1')).toBe('プレイヤ');   // プレイヤ=幅8、ー以降は切る
    expect(clipByWidth('プレイヤー2')).toBe('プレイヤ');
  });

  it('全角4文字ちょうどはそのまま', () => {
    expect(clipByWidth('ハルト')).toBe('ハルト');         // 幅6
    expect(clipByWidth('ミナト')).toBe('ミナト');
    expect(clipByWidth('コハル')).toBe('コハル');
  });

  it('半角英数字は最大8文字まで', () => {
    expect(clipByWidth('Naoki')).toBe('Naoki');           // 幅5
    expect(clipByWidth('Naoki1234')).toBe('Naoki123');    // 幅9 → 8で切る
    expect(clipByWidth('NaokiPlayer')).toBe('NaokiPla');  // 幅11 → 8で切る
  });

  it('省略記号「…」「‥」を付けない', () => {
    const r = clipByWidth('NaokiPlayer');
    expect(r).not.toContain('…');
    expect(r).not.toContain('‥');
  });

  it('全角/半角混在は表示幅ベースで切る', () => {
    expect(clipByWidth('ナオキAB')).toBe('ナオキAB');      // 2+2+2+1+1=8 ちょうど
    expect(clipByWidth('ナオキABC')).toBe('ナオキAB');     // 9>8 → C を切る
    expect(clipByWidth('ABCDEFあ')).toBe('ABCDEFあ');      // 6+2=8 ちょうど
    expect(clipByWidth('ABCDEFGあ')).toBe('ABCDEFG');      // 7、あで9>8 → あ を切る
  });
});
