// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { buildGoldChoiceUI } from '../src/renderer/ui';
import type { UIPhase } from '../src/renderer/ui';
import type { Action, GameState } from '../src/types';

const SPECS: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',  type: 'human' },
  { id: 'player2', name: 'B', color: 'blue', type: 'ai', aiDifficulty: 'normal' },
];

// player1 が金で 2 枚選べる GOLD 状態。
function goldState(owed = 2): GameState {
  const g = createInitialGameState(SPECS, 'fixed', ['player1', 'player2'], createRng(1), 'seafarers_newshores');
  return { ...g, phase: 'MAIN', turnPhase: 'GOLD', setupSubPhase: null, currentPlayerIndex: 0, pendingGoldChoice: { player1: owed } };
}

// ボタンをラベル前方一致で探してクリックする。
function clickByText(root: HTMLElement, text: string): void {
  const btn = [...root.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`button "${text}" not found in: ${[...root.querySelectorAll('button')].map(b => b.textContent).join(' | ')}`);
  btn.click();
}

describe('金タイル選択モーダル（人間UI・jsdom）', () => {
  it('資源を owed 枚選んで「受け取る」で CHOOSE_GOLD を dispatch する', () => {
    const s = goldState(2);
    let uiPhase: UIPhase = { type: 'goldChoice', playerId: 'player1', slots: [null, null] };
    const dispatched: Action[] = [];
    const dispatch = (a: Action): void => { dispatched.push(a); };
    const setUIPhase = (p: UIPhase): void => { uiPhase = p; };

    // 1枚目: 鉄(ore)、2枚目: 米(grain) を選ぶ（クリックのたびに再構築＝アプリの再描画を模す）。
    const render = (): HTMLDivElement => buildGoldChoiceUI(s, 'player1', uiPhase, setUIPhase, dispatch);

    clickByText(render(), '鉄');   // ore → setUIPhase slots[ore, null]
    clickByText(render(), '米');     // grain → setUIPhase slots[ore, grain]
    expect(uiPhase).toMatchObject({ type: 'goldChoice', slots: ['ore', 'grain'] });

    // 全スロット埋まったので「受け取る」が有効 → dispatch
    clickByText(render(), '受け取る');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({ type: 'CHOOSE_GOLD', playerId: 'player1', resources: { ore: 1, grain: 1 } });
  });

  it('未完成（スロットに空きあり）では「受け取る」は無効で dispatch しない', () => {
    const s = goldState(2);
    const uiPhase: UIPhase = { type: 'goldChoice', playerId: 'player1', slots: ['ore', null] };
    const dispatched: Action[] = [];
    const div = buildGoldChoiceUI(s, 'player1', uiPhase, () => {}, a => dispatched.push(a));
    clickByText(div, '受け取る'); // disabled ボタン → ハンドラは発火しない
    expect(dispatched).toHaveLength(0);
  });

  it('同一資源はバンク在庫を超えて選べない（在庫0の資源ボタンは無効）', () => {
    const base = goldState(2);
    const s: GameState = { ...base, bank: { ...base.bank, ore: 0 } };
    const uiPhase: UIPhase = { type: 'goldChoice', playerId: 'player1', slots: [null, null] };
    const div = buildGoldChoiceUI(s, 'player1', uiPhase, () => {}, () => {});
    const oreBtn = [...div.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('鉄'))!;
    expect(oreBtn.hasAttribute('disabled')).toBe(true);
  });
});
