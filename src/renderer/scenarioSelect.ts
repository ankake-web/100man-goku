// ============================================================
// src/renderer/scenarioSelect.ts — 盤面シナリオの選択UI（ホーム/ロビー共通）
// ============================================================
//
// シナリオが増えてもラジオが横に伸びないよう、カテゴリ分けしたドロップダウン＋
// 選択中の説明文・勝利点を表示する。listScenarios() 由来なので追加シナリオは自動で並ぶ。

import { listScenarios, type ScenarioId } from '../engine/scenarios';

const CATEGORY_LABEL: Record<'basic' | 'seafarers', string> = {
  basic: '基本',
  seafarers: '航海者（船で島へ）',
};

export interface ScenarioSelectOptions {
  current: ScenarioId;
  onChange?: (id: ScenarioId) => void;
  /** 参加者ビューなど、表示のみで変更不可にする。 */
  disabled?: boolean;
}

/** シナリオ選択ウィジェット（<select> + 説明）。要素を返す。 */
export function buildScenarioSelect(opts: ScenarioSelectOptions): HTMLElement {
  const scenarios = listScenarios();
  const wrap = document.createElement('div');
  wrap.className = 'scenario-select';

  const select = document.createElement('select');
  select.className = 'scenario-dropdown';
  select.disabled = !!opts.disabled;

  // カテゴリごとに optgroup でまとめる。
  for (const cat of ['basic', 'seafarers'] as const) {
    const inCat = scenarios.filter(s => s.category === cat);
    if (inCat.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = CATEGORY_LABEL[cat];
    for (const s of inCat) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === opts.current) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
  wrap.appendChild(select);

  const desc = document.createElement('div');
  desc.className = 'scenario-desc';
  wrap.appendChild(desc);

  const renderDesc = (id: ScenarioId): void => {
    const s = scenarios.find(x => x.id === id);
    if (!s) { desc.textContent = ''; return; }
    desc.textContent = '';
    const vt = document.createElement('span');
    vt.className = 'scenario-vp';
    vt.textContent = `🏆 ${s.victoryTarget}点`;
    const tx = document.createElement('span');
    tx.className = 'scenario-desc-text';
    tx.textContent = s.description;
    desc.append(vt, tx);
  };
  renderDesc(opts.current);

  select.addEventListener('change', () => {
    const id = select.value as ScenarioId;
    renderDesc(id);
    opts.onChange?.(id);
  });

  // 値の取得用に参照を付ける。
  (wrap as HTMLElement & { value?: ScenarioId }).value = opts.current;
  select.addEventListener('change', () => { (wrap as HTMLElement & { value?: ScenarioId }).value = select.value as ScenarioId; });

  return wrap;
}

/** ウィジェットの現在値を取得。 */
export function getScenarioSelectValue(wrap: HTMLElement): ScenarioId {
  const select = wrap.querySelector('select.scenario-dropdown') as HTMLSelectElement | null;
  return (select?.value ?? 'classic') as ScenarioId;
}
