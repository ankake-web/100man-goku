// @vitest-environment jsdom
// 中央素材マニフェストの健全性: 全要素が URL（または明示的 null）に解決し、
// 欠損でもプレースホルダで壊れ画像を出さないことを確認する。
import { describe, it, expect } from 'vitest';
import { ASSETS, houseImg, cityImg, shipImg, placeholder, assetImg } from '../src/assets/manifest';

const truthy = (u: string) => typeof u === 'string' && u.length > 0;

describe('資産マニフェスト', () => {
  it('資源5・商品3が個別URLに解決する（取り違えなし＝全て異なる）', () => {
    const res = Object.values(ASSETS.resource);
    const com = Object.values(ASSETS.commodity);
    expect(res.every(truthy)).toBe(true);
    expect(com.every(truthy)).toBe(true);
    expect(new Set([...res, ...com]).size).toBe(8); // 5+3 すべて異なる画像
  });

  it('騎士は基本/強い/最強が別URL', () => {
    const { basic, strong, mighty } = ASSETS.knight;
    expect([basic, strong, mighty].every(truthy)).toBe(true);
    expect(new Set([basic, strong, mighty]).size).toBe(3);
  });

  it('改良建築6種が トラック×レベル(3/4) に正しく対応し全て別URL', () => {
    const b = ASSETS.building;
    const all = [b.trade[3], b.trade[4], b.politics[3], b.politics[4], b.science[3], b.science[4]];
    expect(all.every(truthy)).toBe(true);
    expect(new Set(all).size).toBe(6);
  });

  it('政治カード9種が別URL', () => {
    const cards = ['bishop', 'diplomat', 'intrigue', 'deserter', 'warlord', 'spy', 'saboteur', 'wedding', 'constitution'];
    const urls = cards.map(c => ASSETS.politicsCard[c]);
    expect(urls.every(truthy)).toBe(true);
    expect(new Set(urls).size).toBe(9);
  });

  it('プレイヤー色の駒（家/都市/船）が4色解決し、不明色は赤フォールバック', () => {
    for (const c of ['red', 'blue', 'purple', 'orange'] as const) {
      expect(truthy(houseImg(c))).toBe(true);
      expect(truthy(cityImg(c))).toBe(true);
      expect(truthy(shipImg(c))).toBe(true);
    }
    // @ts-expect-error 不明色でもクラッシュせず赤へ
    expect(houseImg('green')).toBe(houseImg('red'));
  });

  it('蛮族船コマが解決する。欠損(null)時も assetImg はプレースホルダで壊れ画像を出さない', () => {
    expect(truthy(ASSETS.piece.barbarianShip!)).toBe(true); // 取り込み済み
    // null を渡した場合のフォールバックも担保（欠損でも404/壊れ画像を出さない）。
    const img = assetImg(null, 'x', 'なし', '?');
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(placeholder('test').startsWith('data:image/svg+xml')).toBe(true);
  });
});
