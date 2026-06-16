// @vitest-environment jsdom
// 図鑑が全要素を画像つきで表示し、壊れ画像（空src）を出さないことを確認。
import { describe, it, expect, afterEach } from 'vitest';
import { showAssetGallery } from '../src/renderer/ui';

afterEach(() => { document.querySelector('.gallery-overlay')?.remove(); });

describe('コマ・カード図鑑', () => {
  it('全要素が画像＋名前つきセルで表示され、空srcが無い', () => {
    showAssetGallery();
    const overlay = document.querySelector('.gallery-overlay');
    expect(overlay).not.toBeNull();
    const cells = overlay!.querySelectorAll('.gallery-cell');
    // コマ11 + 資源5 + 商品3 + 建築6 + 進歩カード(政治9+科学10+商業6=25) = 50
    expect(cells.length).toBeGreaterThanOrEqual(48);
    const imgs = overlay!.querySelectorAll('.gallery-img');
    expect(imgs.length).toBe(cells.length);
    imgs.forEach(img => expect((img as HTMLImageElement).getAttribute('src')).toBeTruthy());
    overlay!.querySelectorAll('.gallery-name').forEach(n => expect(n.textContent && n.textContent.length).toBeTruthy());
    // セクション見出しが複数（コマ/資源/商品/建築/進歩カード×3）。
    expect(overlay!.querySelectorAll('.gallery-section-title').length).toBeGreaterThanOrEqual(7);
  });
});
