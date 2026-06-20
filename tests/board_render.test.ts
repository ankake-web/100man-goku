// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { renderBoard } from '../src/renderer/board';
import type { GameState } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'human' },
];

function svgEl(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('盤面描画（jsdom）: 海賊マーカー', () => {
  it('piratePosition の海タイルに海賊船フィギュア画像を描く', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');
    const seaTile = Object.values(s.tiles).find(t => t.type === 'sea')!.id;
    const svg = svgEl();
    renderBoard(svg, s, { piratePosition: seaTile });
    const pirate = svg.querySelector('.pirate');
    expect(pirate).not.toBeNull();
    // 絵文字フラッグ→画像(<image>)に変更済み。href が設定されていることを確認。
    const img = pirate?.querySelector('image');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('href')).toBeTruthy();
  });

  it('piratePosition 未設定なら海賊マーカーは描かれない', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');
    const svg = svgEl();
    renderBoard(svg, s, {});
    expect(svg.querySelector('.pirate')).toBeNull();
  });
});

describe('盤面描画（jsdom）: 騎士と商人のコマ', () => {
  it('vertex.knight があれば .knight-piece、メトロポリスは .metropolis-mark を描く', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'cities_knights');
    // 適当な空き頂点に騎士、別の頂点に player1 のメトロポリス都市を置く。
    const vids = Object.keys(s.vertices);
    const kv = vids[0]!, mv = vids[10]!;
    const s2: GameState = {
      ...s,
      vertices: {
        ...s.vertices,
        [kv]: { ...s.vertices[kv]!, knight: { playerId: 'player1', strength: 2, active: true } },
        [mv]: { ...s.vertices[mv]!, building: { type: 'city', playerId: 'player1', metropolis: true } },
      },
    };
    const svg = svgEl();
    renderBoard(svg, s2, {});
    const kp = svg.querySelector('.knight-piece');
    expect(kp).not.toBeNull();
    // 騎士はSVG円→コマ画像(<image>)に変更済み。href が設定されていることを確認。
    const kimg = kp?.querySelector('image');
    expect(kimg).not.toBeNull();
    expect(kimg?.getAttribute('href')).toBeTruthy();
    // メトロポリスはプレイヤー色の城コマ画像(<image class="building-img">)で描画（門マーク重ねは廃止）。
    const metro = svg.querySelector('.building-img');
    expect(metro).not.toBeNull();
    expect(metro?.tagName.toLowerCase()).toBe('image');
    expect(metro?.getAttribute('href')).toBeTruthy();
  });

  it('state.merchant があれば該当タイルに .merchant-piece（画像）を描く', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'cities_knights');
    // 任意の資源タイルに商人コマを置く。
    const landTile = Object.values(s.tiles).find(t => t.type !== 'sea' && t.type !== 'desert')!.id;
    const s2: GameState = { ...s, merchant: { playerId: 'player1', tileId: landTile } };
    const svg = svgEl();
    renderBoard(svg, s2, {});
    const mp = svg.querySelector('.merchant-piece');
    expect(mp).not.toBeNull();
    const img = mp?.querySelector('image');
    expect(img?.getAttribute('href')).toBeTruthy();
  });

  it('downgradeVertexIds の都市に .building-downgrade（赤ハイライト）を付ける', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'cities_knights');
    const vids = Object.keys(s.vertices);
    const cityVid = vids[5]!;
    const s2: GameState = {
      ...s,
      vertices: { ...s.vertices, [cityVid]: { ...s.vertices[cityVid]!, building: { type: 'city', playerId: 'player1' } } },
    };
    const svg = svgEl();
    renderBoard(svg, s2, { downgradeVertexIds: new Set([cityVid]) });
    const dg = svg.querySelector('.building-downgrade');
    expect(dg).not.toBeNull();
    expect(dg?.tagName.toLowerCase()).toBe('image');
  });
});
