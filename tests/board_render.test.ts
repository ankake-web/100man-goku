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
  it('piratePosition の海タイルに 🏴‍☠️ マーカーを描く', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');
    const seaTile = Object.values(s.tiles).find(t => t.type === 'sea')!.id;
    const svg = svgEl();
    renderBoard(svg, s, { piratePosition: seaTile });
    const pirate = svg.querySelector('.pirate');
    expect(pirate).not.toBeNull();
    expect(pirate?.querySelector('.pirate-flag')?.textContent).toBe('🏴‍☠️');
  });

  it('piratePosition 未設定なら海賊マーカーは描かれない', () => {
    const s: GameState = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');
    const svg = svgEl();
    renderBoard(svg, s, {});
    expect(svg.querySelector('.pirate')).toBeNull();
  });
});
