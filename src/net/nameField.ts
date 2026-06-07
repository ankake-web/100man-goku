// ============================================================
// src/net/nameField.ts — 名前入力欄の共通UX（localStorage＋🎲再生成）
// ============================================================
//
// ロビー（LAN）と CPU 対戦ホームの双方で使う、名前入力のためのDOMヘルパー。
// - 初期値: localStorage の前回名があればそれ、無ければランダムなカタカナ名。
// - placeholder にもランダム候補を出す。
// - 入力欄の横に置く 🎲 ボタンでランダム名を再生成できる。
// 純粋なロジック（候補生成）は names.ts に分離している。

import { generateRandomPlayerName } from './names';

const STORAGE_KEY = 'catan_player_name';

export function loadPlayerName(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}

export function savePlayerName(name: string): void {
  try {
    const n = (name ?? '').trim();
    if (n) localStorage.setItem(STORAGE_KEY, n);
  } catch { /* localStorage 不可環境では何もしない */ }
}

/**
 * 名前入力欄を初期化し、再生成用の 🎲 ボタンを返す（呼び出し側が配置する）。
 * - 初期値: 保存名 or ランダム名。空にしてもユーザーが消せるが、未入力なら
 *   送信側がランダム名を補う想定。
 */
export function attachNameField(input: HTMLInputElement): HTMLButtonElement {
  input.value = loadPlayerName() || generateRandomPlayerName();
  input.placeholder = `例: ${generateRandomPlayerName()}`;
  input.maxLength = 12; // 四隅パネルでも崩れない長さ
  input.setAttribute('aria-label', 'プレイヤー名'); // 視覚ラベルとは別にスクリーンリーダー名を付与

  const dice = document.createElement('button');
  dice.type = 'button';
  dice.className = 'name-dice-btn';
  dice.textContent = '🎲';
  dice.title = 'ランダムな名前にする';
  dice.setAttribute('aria-label', 'ランダムな名前にする');
  dice.addEventListener('click', () => {
    input.value = generateRandomPlayerName();
    input.focus();
  });
  return dice;
}
