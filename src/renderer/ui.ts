// ============================================================
// src/renderer/ui.ts — F-03: 手番UIパネル
// ============================================================

import type { GameState, Action, PlayerId, ResourceType, Player, ResourceHand } from '../types';
import { RESOURCE_TYPES, BUILD_COSTS, VP_TABLE } from '../constants';
import { calcVP, calcPublicVP, victoryTarget } from '../engine/scoring';
import { LONGEST_ROAD_MIN, LARGEST_ARMY_MIN } from '../constants';
import { hasEnoughResources, playerHasMovableShip } from '../engine/actions';
import { canBankTrade, getEffectiveTradeRate } from '../engine/trade';
import { findPendingDiscarder } from '../engine/robber';
import {
  isCk, canBuildImprovement, canBuildKnight, canActivateKnight, canUpgradeKnight, canBuildCityWall, canPlayProgress,
  playerHasMovableKnight,
} from '../engine/citiesKnights';
import { CK_TRACK_NAME, CK_TRACK_COMMODITY, CK_BARBARIAN_MAX, COMMODITY_TYPES, improvementCost, PROGRESS_CARD_NAME, PROGRESS_CARD_DESC } from '../constants';
import type { CkTrack, CommodityType } from '../types';
import type { BuildMode } from './events';

const COMMODITY_EMOJI: Record<CommodityType, string> = { coin: '🪙', cloth: '🧵', paper: '📜' };
import resWoodImg from '../assets/res_wood.png';
import resBrickImg from '../assets/res_brick.png';
import resSheepImg from '../assets/res_sheep.png';
import resWheatImg from '../assets/res_wheat.png';
import resOreImg from '../assets/res_ore.png';
import knightImg from '../assets/knight.png';

// ============================================================
// 型定義（main.ts・events.ts 共有）
// ============================================================

export type UIPhase =
  | { type: 'idle' }
  | { type: 'discard'; playerId: PlayerId; selected: ResourceHand }
  | { type: 'bankTrade'; give: ResourceType | null; receive: ResourceType | null }
  | { type: 'yearOfPlenty'; slots: (ResourceType | null)[] }
  | { type: 'goldChoice'; playerId: PlayerId; slots: (ResourceType | null)[] }
  | { type: 'monopoly'; resource: ResourceType | null }
  | { type: 'robberTarget'; tileId: string; opponents: PlayerId[]; kind?: 'robber' | 'pirate' }
  | { type: 'placePreview'; kind: 'settlement' | 'city' | 'road' | 'ship'; targetId: string }
  | { type: 'playerTradeOffer'; give: ResourceHand; receive: ResourceHand; targetPids: PlayerId[] };

// ============================================================
// 定数
// ============================================================

const PLAYER_COLORS: Record<string, string> = {
  player1: '#e03030',
  player2: '#3060e0',
  player3: '#a855f7',
  player4: '#f0a020',
};

// この幅以上でプレイヤーパネルを盤面の四隅に配置する（未満は盤面下に縦並び）
const CORNER_LAYOUT_MIN_WIDTH = 1200;

// 横持ちスマホ（横長かつ低い高さ）か。表示テキストを短縮するために使う。
function isLandscapeCompact(): boolean {
  return window.innerWidth > window.innerHeight && window.innerHeight <= 600;
}

const RESOURCE_EMOJI: Record<ResourceType, string> = {
  wood: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '⛰',
};

// 資源アイコン画像（手札カード・交易チップ用）。テキスト埋め込み箇所は絵文字のまま。
const RESOURCE_IMG: Record<ResourceType, string> = {
  wood: resWoodImg, brick: resBrickImg, wool: resSheepImg, grain: resWheatImg, ore: resOreImg,
};

// 資源アイコンの <img> 要素を生成。
function resIconImg(r: ResourceType, cls: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = cls;
  img.src = RESOURCE_IMG[r];
  img.alt = RESOURCE_NAMES[r];
  img.draggable = false;
  return img;
}

const RESOURCE_NAMES: Record<ResourceType, string> = {
  wood: '木材', brick: 'レンガ', wool: '羊毛', grain: '麦', ore: '鉄鉱',
};

const DEV_CARD_NAMES: Record<string, string> = {
  knight:          '⚔ 騎士',
  road_building:   '🛤 道路建設',
  year_of_plenty:  '🌾 年の豊穣',
  monopoly:        '🏛 独占',
};

// F-06: カードパネル用コンパクト名
const DEV_CARD_CHIP_NAMES: Record<string, string> = {
  knight:          '⚔騎士',
  road_building:   '🛤道路建設',
  year_of_plenty:  '🌾年の豊穣',
  monopoly:        '🏛独占',
  victory_point:   '★',
};

// ============================================================
// フェーズ説明テキスト
// ============================================================

function phaseText(state: GameState): string {
  if (state.phase === 'GAME_OVER') {
    const w = state.players[state.winner ?? ''];
    return w ? `🎉 ゲーム終了！${w.name} の勝利！` : 'ゲーム終了！';
  }

  // 現在手番のプレイヤーが CPU かどうかで文言を切り替える
  // （CPU手番中は人間向けの「クリックしてください」を出さない）
  const currentPid = state.playerOrder[state.currentPlayerIndex] ?? '';
  const current = state.players[currentPid];
  const isCpuTurn = current?.type === 'ai';
  const cpuName = current?.name ?? 'CPU';

  if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
    const half = state.phase === 'SETUP_FORWARD' ? '前半' : '後半';
    if (isCpuTurn) return `セットアップ${half}：${cpuName} 配置中…`;
    return state.setupSubPhase === 'PLACE_SETTLEMENT'
      ? `セットアップ${half}：開拓地を置く`
      : `セットアップ${half}：道を置く`;
  }

  switch (state.turnPhase) {
    case 'PRE_ROLL':
      return isCpuTurn ? `${cpuName} の手番…` : 'ダイスを振る';
    case 'ROBBER':
      return isCpuTurn ? `${cpuName} が盗賊を移動中…` : '盗賊を動かすタイルをクリック';
    case 'DISCARD': {
      // 捨て札は手番者とは限らない（手札8枚以上の全員が対象）。
      const discardPid = findPendingDiscarder(state);
      const dp = discardPid ? state.players[discardPid] : null;
      if (dp?.type === 'ai') return `${dp.name} が手札を捨てています…`;
      return '半数を捨ててください';
    }
    case 'TRADE_BUILD':
      return isCpuTurn ? `${cpuName} の交易・建設…` : '交易・建設';
    case 'END':
      return 'ターン終了処理中';
    default:
      return '';
  }
}

// ============================================================
// DOM ヘルパー
// ============================================================

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function makeBtn(
  label: string,
  cls: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = el('button', `action-btn ${cls}`);
  btn.textContent = label;
  btn.disabled = disabled;
  if (!disabled) btn.addEventListener('click', onClick);
  return btn;
}

function modeBtn(
  label: string,
  mode: Exclude<BuildMode, 'idle'>,
  canAfford: boolean,
  current: BuildMode,
  setBuildMode: (m: BuildMode) => void,
): HTMLButtonElement {
  const isActive = current === mode;
  const disabled = !canAfford && !isActive;
  const cls = isActive ? 'btn-active' : canAfford ? 'btn-build' : 'btn-disabled';
  return makeBtn(label, cls, disabled, () => setBuildMode(isActive ? 'idle' : mode));
}

// ============================================================
// 発展カード：使用可能カード一覧
// ============================================================

function getPlayableDevCards(
  player: Player,
  globalTurn: number,
): { type: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const card of player.devCards) {
    if (card.type === 'victory_point') continue;
    if (card.purchasedOnTurn >= globalTurn) continue;
    counts[card.type] = (counts[card.type] ?? 0) + 1;
  }
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}

// ============================================================
// DISCARD UI（手札捨て）
// ============================================================

function buildDiscardUI(
  state: GameState,
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');

  const discardPid = findPendingDiscarder(state);
  if (!discardPid) return div;

  const player = state.players[discardPid]!;
  const total = RESOURCE_TYPES.reduce((s, r) => s + player.hand[r], 0);
  const target = Math.floor(total / 2);

  const selected: ResourceHand =
    uiPhase.type === 'discard' && uiPhase.playerId === discardPid
      ? uiPhase.selected
      : { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };

  const chosen = RESOURCE_TYPES.reduce((s, r) => s + selected[r], 0);

  const color = PLAYER_COLORS[discardPid] ?? '#aaa';
  const header = el('div', 'modal-header');
  const dot = el('span', 'color-dot');
  dot.style.background = color;
  header.appendChild(dot);
  const remaining = Math.max(0, target - chosen);
  header.append(` ${player.name}：${target}枚を捨てる（あと ${remaining}枚 ・ ${chosen}/${target}）`);
  div.appendChild(header);

  const resRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    if (player.hand[r] === 0) continue;

    const cell = el('div', 'modal-res-cell');
    const minus = makeBtn('−', 'btn-small', selected[r] <= 0, () => {
      setUIPhase({ type: 'discard', playerId: discardPid, selected: { ...selected, [r]: selected[r] - 1 } });
    });
    const info = el('span', 'modal-res-info');
    info.textContent = `${RESOURCE_EMOJI[r]} ${player.hand[r]}枚 → 捨:${selected[r]}`;
    const plus = makeBtn('+', 'btn-small', selected[r] >= player.hand[r] || chosen >= target, () => {
      setUIPhase({ type: 'discard', playerId: discardPid, selected: { ...selected, [r]: selected[r] + 1 } });
    });

    cell.appendChild(minus);
    cell.appendChild(info);
    cell.appendChild(plus);
    resRow.appendChild(cell);
  }
  div.appendChild(resRow);

  div.appendChild(makeBtn(
    `✓ 捨てる（${chosen}/${target}枚）`,
    chosen === target ? 'btn-primary' : 'btn-disabled',
    chosen !== target,
    () => dispatch({ type: 'DISCARD_RESOURCES', playerId: discardPid, resources: selected }),
  ));

  return div;
}

// ============================================================
// Robber Target Selection UI（複数ターゲット選択）
// ============================================================

function buildRobberTargetUI(
  state: GameState,
  uiPhase: UIPhase,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');
  if (uiPhase.type !== 'robberTarget') return div;
  const isPirate = uiPhase.kind === 'pirate';
  const header = el('div', 'modal-header');
  header.textContent = isPirate ? '🏴‍☠️ 海賊：奪う相手を選んでください' : '🦹 強盗：盗む相手を選んでください';
  div.appendChild(header);

  const row = el('div', 'modal-res-row');
  for (const opponentPid of uiPhase.opponents) {
    const opponent = state.players[opponentPid];
    if (!opponent) continue;
    const color = PLAYER_COLORS[opponentPid] ?? '#aaa';
    // 他プレイヤーの手札はLANではマスクで中身が全0になり、枚数は handCount に入る。
    // hand 合計だと0枚と誤表示されるため、公開情報の handCount を優先する。
    const totalCards = opponent.handCount ?? RESOURCE_TYPES.reduce((s, r) => s + opponent.hand[r], 0);
    const btn = makeBtn(
      `${opponent.name}（手札${totalCards}枚）`,
      'btn-build',
      false,
      () => dispatch(isPirate
        ? { type: 'MOVE_PIRATE', tileId: uiPhase.tileId, stealFromPlayerId: opponentPid }
        : { type: 'MOVE_ROBBER', tileId: uiPhase.tileId, stealFromPlayerId: opponentPid }),
    );
    btn.style.borderLeft = `4px solid ${color}`;
    row.appendChild(btn);
  }
  div.appendChild(row);

  return div;
}

// ============================================================
// Bank Trade UI（バンク交易）
// ============================================================

function buildBankTradeUI(
  state: GameState,
  pid: PlayerId,
  player: Player,
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');

  const give    = uiPhase.type === 'bankTrade' ? uiPhase.give : null;
  const receive = uiPhase.type === 'bankTrade' ? uiPhase.receive : null;

  const header = el('div', 'modal-header');
  header.textContent = '💱 バンク交易';
  div.appendChild(header);

  const giveLabel = el('div', 'modal-section-label');
  giveLabel.textContent = '渡す資源：';
  div.appendChild(giveLabel);

  const giveRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    const rate = getEffectiveTradeRate(state, pid, r);
    const canAfford = player.hand[r] >= rate;
    const btn = makeBtn(
      `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]} ×${player.hand[r]} (${rate}:1)`,
      give === r ? 'btn-active' : canAfford ? 'btn-build' : 'btn-disabled',
      !canAfford,
      () => setUIPhase({ type: 'bankTrade', give: give === r ? null : r, receive }),
    );
    giveRow.appendChild(btn);
  }
  div.appendChild(giveRow);

  if (give !== null) {
    const receiveLabel = el('div', 'modal-section-label');
    receiveLabel.textContent = '受け取る資源：';
    div.appendChild(receiveLabel);

    const receiveRow = el('div', 'modal-res-row');
    for (const r of RESOURCE_TYPES) {
      if (r === give) continue;
      const inBank = state.bank[r] > 0;
      const btn = makeBtn(
        `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]}`,
        receive === r ? 'btn-active' : inBank ? 'btn-build' : 'btn-disabled',
        !inBank,
        () => setUIPhase({ type: 'bankTrade', give, receive: receive === r ? null : r }),
      );
      receiveRow.appendChild(btn);
    }
    div.appendChild(receiveRow);

    if (receive !== null) {
      const rate = getEffectiveTradeRate(state, pid, give);
      const valid = canBankTrade(state, pid, give, receive);
      div.appendChild(makeBtn(
        `✓ ${rate}枚の${RESOURCE_EMOJI[give]} → 1枚の${RESOURCE_EMOJI[receive]}`,
        valid ? 'btn-primary' : 'btn-disabled',
        !valid,
        () => dispatch({ type: 'BANK_TRADE', give, receive }),
      ));
    }
  }

  div.appendChild(makeBtn('✕ キャンセル', 'btn-end', false, () => setUIPhase({ type: 'idle' })));
  return div;
}

// ============================================================
// 金タイル産出の任意資源選択（航海者）
// ============================================================
// owed 枚をバンクから選ぶ。ルール上「選ばない」は不可（必須）なのでキャンセルは無し。
export function buildGoldChoiceUI(
  state: GameState,
  gpid: PlayerId,
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');
  const owed = (state.pendingGoldChoice ?? {})[gpid] ?? 0;
  const slots: (ResourceType | null)[] =
    uiPhase.type === 'goldChoice' && uiPhase.playerId === gpid && uiPhase.slots.length === owed
      ? uiPhase.slots
      : Array.from({ length: owed }, () => null);

  const header = el('div', 'modal-header');
  header.textContent = `✨ 金タイル：資源${owed}枚を選んで受け取る`;
  div.appendChild(header);

  const status = el('div', 'modal-section-label');
  status.textContent = `選択中：${slots.map(s => (s ? RESOURCE_EMOJI[s] : '？')).join(' ・ ')}`;
  div.appendChild(status);

  const resRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    const chosen = slots.filter(s => s === r).length;
    // バンク在庫を超えて同一資源は選べない（金もバンクからの受け取り）。
    const canAdd = chosen < state.bank[r] && slots.some(s => s === null);
    const btn = makeBtn(
      `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]}${chosen > 0 ? ` ×${chosen}` : ''}`,
      chosen > 0 ? 'btn-active' : canAdd ? 'btn-build' : 'btn-disabled',
      !canAdd,
      () => {
        const next = [...slots] as (ResourceType | null)[];
        const empty = next.findIndex(s => s === null);
        if (empty !== -1) next[empty] = r;
        setUIPhase({ type: 'goldChoice', playerId: gpid, slots: next });
      },
    );
    resRow.appendChild(btn);
  }
  div.appendChild(resRow);

  // 選び直し（全クリア）。誤タップのリカバリ用。「選ばない」はルール上不可。
  div.appendChild(makeBtn('↺ 選び直す', 'btn-end', owed === 0, () =>
    setUIPhase({ type: 'goldChoice', playerId: gpid, slots: Array.from({ length: owed }, () => null) })));

  const allFilled = slots.length > 0 && slots.every(s => s !== null);
  div.appendChild(makeBtn(
    '✓ 受け取る',
    allFilled ? 'btn-primary' : 'btn-disabled',
    !allFilled,
    () => {
      const resources: Partial<ResourceHand> = {};
      for (const s of slots) if (s) resources[s] = (resources[s] ?? 0) + 1;
      dispatch({ type: 'CHOOSE_GOLD', playerId: gpid, resources });
    },
  ));
  return div;
}

// ============================================================
// Year of Plenty UI（年の豊穣）
// ============================================================

function buildYearOfPlentyUI(
  state: GameState,
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');

  const slots: (ResourceType | null)[] =
    uiPhase.type === 'yearOfPlenty' ? uiPhase.slots : [null, null];

  const header = el('div', 'modal-header');
  header.textContent = '🌾 年の豊穣：資源2枚を受け取る';
  div.appendChild(header);

  const status = el('div', 'modal-section-label');
  const s0 = slots[0] ? RESOURCE_EMOJI[slots[0]] : '？';
  const s1 = slots[1] ? RESOURCE_EMOJI[slots[1]] : '？';
  status.textContent = `選択中：${s0} ・ ${s1}`;
  div.appendChild(status);

  const resRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    const inBank = state.bank[r] > 0;
    const count = slots.filter(s => s === r).length;
    const btn = makeBtn(
      `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]}${count > 0 ? ` ×${count}` : ''}`,
      count > 0 ? 'btn-active' : inBank ? 'btn-build' : 'btn-disabled',
      !inBank,
      () => {
        const next = [...slots] as (ResourceType | null)[];
        const empty = next.findIndex(s => s === null);
        if (empty !== -1) {
          next[empty] = r;
        } else {
          // 両スロット埋まっている場合：1つシフトして追加
          next[0] = next[1] ?? null;
          next[1] = r;
        }
        setUIPhase({ type: 'yearOfPlenty', slots: next });
      },
    );
    resRow.appendChild(btn);
  }
  div.appendChild(resRow);

  const bothFilled = slots[0] !== null && slots[1] !== null;
  div.appendChild(makeBtn(
    '✓ 受け取る',
    bothFilled ? 'btn-primary' : 'btn-disabled',
    !bothFilled,
    () => {
      if (slots[0] && slots[1]) dispatch({ type: 'PLAY_YEAR_OF_PLENTY', resources: [slots[0], slots[1]] });
    },
  ));
  div.appendChild(makeBtn('✕ キャンセル', 'btn-end', false, () => setUIPhase({ type: 'idle' })));
  return div;
}

// ============================================================
// Monopoly UI（独占）
// ============================================================

function buildMonopolyUI(
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');

  const resource = uiPhase.type === 'monopoly' ? uiPhase.resource : null;

  const header = el('div', 'modal-header');
  header.textContent = '🏛 独占：資源1種を宣言';
  div.appendChild(header);

  const resRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    const btn = makeBtn(
      `${RESOURCE_EMOJI[r]} ${RESOURCE_NAMES[r]}`,
      resource === r ? 'btn-active' : 'btn-build',
      false,
      () => setUIPhase({ type: 'monopoly', resource: r }),
    );
    resRow.appendChild(btn);
  }
  div.appendChild(resRow);

  div.appendChild(makeBtn(
    '✓ 独占実行',
    resource !== null ? 'btn-primary' : 'btn-disabled',
    resource === null,
    () => { if (resource) dispatch({ type: 'PLAY_MONOPOLY', resource }); },
  ));
  div.appendChild(makeBtn('✕ キャンセル', 'btn-end', false, () => setUIPhase({ type: 'idle' })));
  return div;
}

// ============================================================
// ============================================================
// F-07: VP 内訳ヘルパー
// ============================================================

interface VPBreakdown {
  settlements: number;
  cities: number;
  lr: boolean;
  la: boolean;
  vpCards: number;
  islandBonus: number; // 航海者: 獲得した新島入植ボーナスの件数（各 +2VP）
}

function calcVPBreakdown(state: GameState, pid: PlayerId): VPBreakdown {
  const player = state.players[pid];
  let settlements = 0, cities = 0;
  for (const v of Object.values(state.vertices)) {
    if (v.building?.playerId !== pid) continue;
    if (v.building.type === 'settlement') settlements++;
    else cities++;
  }
  return {
    settlements,
    cities,
    lr: player?.hasLongestRoad ?? false,
    la: player?.hasLargestArmy ?? false,
    vpCards: player?.devCards.filter(c => c.type === 'victory_point').length ?? 0,
    islandBonus: Object.values(state.islandBonus ?? {}).filter(o => o === pid).length,
  };
}

// ============================================================
// F-05: プレイヤー間交易ヘルパー
// ============================================================

function makeZeroHand(): ResourceHand {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

// 資源を見やすいチップ列で表示（交易UIの「一目で分かる」用）
function resChips(partial: Partial<ResourceHand>): HTMLDivElement {
  const wrap = el('div', 'res-chips');
  let any = false;
  for (const r of RESOURCE_TYPES) {
    const n = partial[r] ?? 0;
    if (n <= 0) continue;
    any = true;
    const chip = el('span', `res-chip res-chip-${r}`);
    const icon = resIconImg(r, 'res-chip-img');
    const ct = el('span', 'res-chip-count'); ct.textContent = `×${n}`;
    chip.append(icon, ct);
    wrap.appendChild(chip);
  }
  if (!any) { const none = el('span', 'res-chip res-chip-none'); none.textContent = '—'; wrap.appendChild(none); }
  return wrap;
}

// 「提案者が渡す → 提案者が欲しい」を視覚的に表示する交換ビュー
function buildExchangeView(give: Partial<ResourceHand>, receive: Partial<ResourceHand>, initiatorName: string, initiatorColor: string): HTMLDivElement {
  const box = el('div', 'trade-exchange');
  const row1 = el('div', 'trade-ex-row');
  const lbl1 = el('span', 'trade-ex-label');
  const dot = el('span', 'color-dot'); dot.style.background = initiatorColor;
  lbl1.append(dot, document.createTextNode(`${initiatorName} が渡す`));
  row1.append(lbl1, resChips(give));
  const arrow = el('div', 'trade-ex-arrow'); arrow.textContent = '⇅';
  const row2 = el('div', 'trade-ex-row');
  const lbl2 = el('span', 'trade-ex-label'); lbl2.textContent = `${initiatorName} が欲しい`;
  row2.append(lbl2, resChips(receive));
  box.append(row1, arrow, row2);
  return box;
}

// ============================================================
// F-05: 交易オファー作成UI
// ============================================================

function buildPlayerTradeOfferUI(
  player: Player,
  pid: PlayerId,
  state: GameState,
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');

  const give       = uiPhase.type === 'playerTradeOffer' ? uiPhase.give       : makeZeroHand();
  const receive    = uiPhase.type === 'playerTradeOffer' ? uiPhase.receive    : makeZeroHand();
  const opponents  = state.playerOrder.filter(p => p !== pid) as PlayerId[];
  const targetPids = uiPhase.type === 'playerTradeOffer'
    ? uiPhase.targetPids
    : opponents; // デフォルト全員

  const lc = isLandscapeCompact(); // 横持ちは短ラベルで圧縮
  const header = el('div', 'modal-header');
  header.textContent = lc ? '🤝 交易を提案' : '🤝 プレイヤー間交易：オファー作成';
  div.appendChild(header);

  // ---- 現在の交換内容サマリ（一目で分かるように）----
  const summary = el('div', 'trade-you-view');
  summary.append('あなたが渡す ');
  summary.appendChild(resChips(give));
  summary.append(' → もらう ');
  summary.appendChild(resChips(receive));
  div.appendChild(summary);

  // ---- 交易相手選択 ----
  const targetLabel = el('div', 'modal-section-label');
  targetLabel.textContent = lc ? '相手' : '交易相手：';
  div.appendChild(targetLabel);
  const targetRow = el('div', 'trade-target-row');
  for (const opp of opponents) {
    const oppPlayer = state.players[opp];
    if (!oppPlayer) continue;
    const btn = el('button', `trade-target-btn${targetPids.includes(opp) ? ' selected' : ''}`);
    btn.textContent = oppPlayer.name;
    btn.addEventListener('click', () => {
      const next = targetPids.includes(opp)
        ? targetPids.filter(p => p !== opp)
        : [...targetPids, opp];
      setUIPhase({ type: 'playerTradeOffer', give, receive, targetPids: next });
    });
    targetRow.appendChild(btn);
  }
  div.appendChild(targetRow);

  // 渡す資源
  const giveLabel = el('div', 'modal-section-label');
  giveLabel.textContent = lc ? '出す' : '渡す資源：';
  div.appendChild(giveLabel);

  const giveRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    const cell = el('div', 'modal-res-cell');
    cell.appendChild(makeBtn('−', 'btn-small', give[r] <= 0, () =>
      setUIPhase({ type: 'playerTradeOffer', give: { ...give, [r]: give[r] - 1 }, receive, targetPids }),
    ));
    const info = el('span', 'modal-res-info');
    info.textContent = `${RESOURCE_EMOJI[r]} 手${player.hand[r]} 渡${give[r]}`;
    cell.appendChild(info);
    cell.appendChild(makeBtn('+', 'btn-small', give[r] >= player.hand[r], () =>
      setUIPhase({ type: 'playerTradeOffer', give: { ...give, [r]: give[r] + 1 }, receive, targetPids }),
    ));
    giveRow.appendChild(cell);
  }
  div.appendChild(giveRow);

  // 受け取る資源
  const recvLabel = el('div', 'modal-section-label');
  recvLabel.textContent = lc ? 'もらう' : '受け取る資源：';
  div.appendChild(recvLabel);

  const recvRow = el('div', 'modal-res-row');
  for (const r of RESOURCE_TYPES) {
    const cell = el('div', 'modal-res-cell');
    cell.appendChild(makeBtn('−', 'btn-small', receive[r] <= 0, () =>
      setUIPhase({ type: 'playerTradeOffer', give, receive: { ...receive, [r]: receive[r] - 1 }, targetPids }),
    ));
    const info = el('span', 'modal-res-info');
    info.textContent = `${RESOURCE_EMOJI[r]} 要求${receive[r]}`;
    cell.appendChild(info);
    cell.appendChild(makeBtn('+', 'btn-small', false, () =>
      setUIPhase({ type: 'playerTradeOffer', give, receive: { ...receive, [r]: receive[r] + 1 }, targetPids }),
    ));
    recvRow.appendChild(cell);
  }
  div.appendChild(recvRow);

  const giveTotal = RESOURCE_TYPES.reduce((s, r) => s + give[r], 0);
  const recvTotal = RESOURCE_TYPES.reduce((s, r) => s + receive[r], 0);
  // 同一資源を渡しつつ受け取る交換は無意味なので送信不可にする
  const hasOverlap = RESOURCE_TYPES.some(r => give[r] > 0 && receive[r] > 0);
  const canSend = giveTotal > 0 && recvTotal > 0 && !hasOverlap;

  const canSendWithTarget = canSend && targetPids.length > 0;
  if (hasOverlap) {
    const warn = el('div', 'modal-section-label');
    warn.textContent = '⚠ 同じ資源を渡して受け取ることはできません';
    warn.style.color = '#ffb060';
    div.appendChild(warn);
  }
  div.appendChild(makeBtn(lc ? '📤 提案' : '📤 オファー送信', canSendWithTarget ? 'btn-primary' : 'btn-disabled', !canSendWithTarget, () => {
    const giveP: Partial<ResourceHand> = {};
    const recvP: Partial<ResourceHand> = {};
    for (const r of RESOURCE_TYPES) {
      if (give[r] > 0) giveP[r] = give[r];
      if (receive[r] > 0) recvP[r] = receive[r];
    }
    dispatch({ type: 'OFFER_TRADE', offer: { give: giveP, receive: recvP }, targetPlayerIds: targetPids });
  }));
  div.appendChild(makeBtn(lc ? '✕' : '✕ キャンセル', 'btn-end', false, () => setUIPhase({ type: 'idle' })));
  return div;
}

// ============================================================
// F-05: ペンディング交易UI（応答・確認）
// ============================================================

// LAN対戦用のペンディング交易UI（視点 viewerId 基準で操作を出し分ける）。
// 提案者: 応答状況の一覧＋（全員応答後）成立相手選択 or 取り消し。
// 対象者: 自分が未応答なら承認/拒否。第三者: 状況の閲覧のみ。
function buildLanPendingTradeUI(
  state: GameState,
  viewerId: PlayerId,
  dispatch: (a: Action) => void,
): HTMLDivElement {
  const div = el('div', 'modal-panel');
  const trade = state.pendingTrade!;
  const initiator = state.players[trade.initiatorId];
  const initColor = PLAYER_COLORS[trade.initiatorId] ?? '#aaa';

  const lc = isLandscapeCompact();
  const header = el('div', 'modal-header');
  header.textContent = lc ? '🤝 交易' : '🤝 プレイヤー間交易';
  div.appendChild(header);

  // 交換内容（提案者が渡す ⇅ 提案者が欲しい）— 公開情報
  div.appendChild(buildExchangeView(trade.offer.give, trade.offer.receive, initiator?.name ?? trade.initiatorId, initColor));

  const isInitiator = viewerId === trade.initiatorId;
  const isTarget = trade.targetPlayerIds.includes(viewerId);
  const myResp = trade.responses[viewerId];

  // 応答状況の一覧（公開情報）
  const statusLbl = el('div', 'modal-section-label');
  statusLbl.textContent = lc ? '返答' : '提案先の返答：';
  div.appendChild(statusLbl);
  const list = el('div', 'trade-status-list');
  for (const t of trade.targetPlayerIds) {
    const name = state.players[t]?.name ?? t;
    const resp = trade.responses[t];
    const row = el('div', 'trade-status-row');
    if (!resp) { row.textContent = `⏳ ${name}：検討中…`; row.style.color = 'rgba(255,255,255,0.7)'; }
    else if (resp.status === 'ACCEPT') { row.textContent = `✓ ${name}：承認`; row.style.color = '#7aee40'; }
    else { row.textContent = `✗ ${name}：拒否`; row.style.color = '#ff6060'; }
    list.appendChild(row);
  }
  div.appendChild(list);

  // ---- 対象プレイヤー: 自分が未応答なら承認/拒否 ----
  if (isTarget && !myResp && (trade.state === 'TRADE_OFFER' || trade.state === 'TRADE_RESPONSE')) {
    const me = state.players[viewerId]!;
    // 「自分が渡す = 提案者が受け取る(receive)」を支払えるか
    const canAfford = RESOURCE_TYPES.every(r => (me.hand[r] ?? 0) >= (trade.offer.receive[r] ?? 0));
    const you = el('div', 'trade-you-view');
    you.append('👉 あなたは ');
    you.appendChild(resChips(trade.offer.receive));
    you.append(' を渡して ');
    you.appendChild(resChips(trade.offer.give));
    you.append(' をもらう');
    div.appendChild(you);
    if (!canAfford) {
      const lacking = RESOURCE_TYPES.filter(r => (me.hand[r] ?? 0) < (trade.offer.receive[r] ?? 0));
      const lackMsg = el('div', 'trade-lack-msg');
      lackMsg.textContent = `⚠ ${lacking.map(r => RESOURCE_NAMES[r]).join('・')}が不足しています`;
      div.appendChild(lackMsg);
    }
    const btnRow = el('div', 'trade-response-btns');
    btnRow.appendChild(makeBtn(lc ? '✓ OK' : '✓ 承認', canAfford ? 'btn-primary' : 'btn-disabled', !canAfford, () =>
      dispatch({ type: 'RESPOND_TRADE', response: { playerId: viewerId, status: 'ACCEPT' } }),
    ));
    btnRow.appendChild(makeBtn('✗ 拒否', 'btn-end', false, () =>
      dispatch({ type: 'RESPOND_TRADE', response: { playerId: viewerId, status: 'REJECT' } }),
    ));
    div.appendChild(btnRow);
  } else if (isTarget && myResp) {
    const done = el('div', 'modal-section-label');
    done.textContent = myResp.status === 'ACCEPT' ? '✓ あなたは承認しました' : '✗ あなたは拒否しました';
    div.appendChild(done);
  }

  // ---- 提案者: 取り消し / 成立相手の選択 ----
  if (isInitiator) {
    if (trade.state === 'TRADE_OFFER') {
      div.appendChild(makeBtn(lc ? '取消' : '↩ 取り消す', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
    } else if (trade.state === 'TRADE_RESPONSE') {
      const acceptors = trade.targetPlayerIds.filter(t => trade.responses[t]?.status === 'ACCEPT') as PlayerId[];
      if (acceptors.length === 0) {
        const msg = el('div', 'modal-section-label');
        msg.textContent = lc ? '😕 全員拒否' : '😕 全員が拒否（不成立）';
        msg.style.color = '#ff8060';
        div.appendChild(msg);
        div.appendChild(makeBtn('閉じる', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
      } else {
        const lbl = el('div', 'modal-section-label');
        lbl.textContent = lc ? '成立相手:' : (acceptors.length === 1 ? '✅ 成立させる：' : '✅ 成立相手を1人選択：');
        div.appendChild(lbl);
        const row = el('div', 'trade-response-btns');
        for (const a of acceptors) {
          row.appendChild(makeBtn(lc ? `${state.players[a]?.name}` : `${state.players[a]?.name} と成立`, 'btn-primary', false,
            () => dispatch({ type: 'CONFIRM_TRADE', responderId: a })));
        }
        div.appendChild(row);
        div.appendChild(makeBtn(lc ? 'やめる' : '↩ やめる', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
      }
    }
  }

  // 第三者（提案者でも対象でもない）は閲覧のみ。
  if (!isInitiator && !isTarget) {
    const note = el('div', 'modal-section-label');
    note.textContent = '他プレイヤーが交易中です…';
    div.appendChild(note);
  }

  if (trade.state === 'TRADE_CANCELLED') {
    const err = el('div', 'modal-section-label');
    err.textContent = '取引失敗：実行前に手持ちが変化しました';
    err.style.color = '#ff8060';
    div.appendChild(err);
    if (isInitiator) div.appendChild(makeBtn('閉じる', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
  }

  return div;
}

function buildPendingTradeUI(
  state: GameState,
  pid: PlayerId,
  dispatch: (a: Action) => void,
  viewerId?: PlayerId,
  lanMode = false,
): HTMLDivElement {
  // LAN対戦は「視点(viewerId)」基準で承認/拒否・成立操作を出し分ける。
  // （pid は手番=提案者なので全端末で同じになり、視点判定には使えない）
  if (lanMode && viewerId != null) {
    return buildLanPendingTradeUI(state, viewerId, dispatch);
  }

  const div = el('div', 'modal-panel');
  const trade = state.pendingTrade!;
  const initiator = state.players[trade.initiatorId];
  const isCpuInitiated = initiator?.type === 'ai';

  const header = el('div', 'modal-header');
  if (isCpuInitiated) {
    header.textContent = `🤝 ${initiator?.name ?? trade.initiatorId} から交易提案`;
  } else {
    header.textContent = '🤝 プレイヤー間交易';
  }
  div.appendChild(header);

  // 交換内容を視覚的に表示（提案者が渡す ⇅ 提案者が欲しい）
  const initColor = PLAYER_COLORS[trade.initiatorId] ?? '#aaa';
  div.appendChild(buildExchangeView(trade.offer.give, trade.offer.receive, initiator?.name ?? trade.initiatorId, initColor));

  // CPU起案で人間が応答する場合は「あなた視点」を明示（一目で分かるように）
  if (isCpuInitiated) {
    const youPid = trade.targetPlayerIds.find(t => state.players[t]?.type === 'human');
    if (youPid) {
      const you = el('div', 'trade-you-view');
      you.append('👉 あなたは ');
      you.appendChild(resChips(trade.offer.receive)); // あなたが渡す = 提案者が欲しい
      you.append(' を渡して ');
      you.appendChild(resChips(trade.offer.give));     // あなたがもらう = 提案者が渡す
      you.append(' をもらう');
      div.appendChild(you);
    }
  }

  if (isCpuInitiated) {
    // ---- CPU起案：人間（=ターゲット）が承認/拒否する ----
    if (trade.state === 'TRADE_OFFER') {
      const pending = trade.targetPlayerIds.find(t => !trade.responses[t]);
      const humanPlayer = pending ? state.players[pending] : null;
      if (pending && humanPlayer?.type === 'human') {
        const canAfford = RESOURCE_TYPES.every(r =>
          (humanPlayer.hand[r] ?? 0) >= (trade.offer.receive[r] ?? 0),
        );
        if (!canAfford) {
          const lacking = RESOURCE_TYPES.filter(r => (humanPlayer.hand[r] ?? 0) < (trade.offer.receive[r] ?? 0));
          const lackMsg = el('div', 'trade-lack-msg');
          lackMsg.textContent = `⚠ ${lacking.map(r => RESOURCE_NAMES[r]).join('・')}が不足しています`;
          div.appendChild(lackMsg);
        }
        const btnRow = el('div', 'trade-response-btns');
        btnRow.appendChild(makeBtn('✓ 承認', canAfford ? 'btn-primary' : 'btn-disabled', !canAfford, () =>
          dispatch({ type: 'RESPOND_TRADE', response: { playerId: pending, status: 'ACCEPT' } }),
        ));
        btnRow.appendChild(makeBtn('✗ 拒否', 'btn-end', false, () =>
          dispatch({ type: 'RESPOND_TRADE', response: { playerId: pending, status: 'REJECT' } }),
        ));
        div.appendChild(btnRow);
      }
    } else if (trade.state === 'TRADE_RESPONSE') {
      const waiting = el('div', 'modal-section-label');
      waiting.textContent = '⏳ 処理中...';
      div.appendChild(waiting);
    }
  } else if (trade.state === 'TRADE_OFFER' || trade.state === 'TRADE_RESPONSE') {
    // ---- 人間起案：提案先(複数CPU)の応答状況を常に一覧表示（公開情報のみ） ----
    const statusLbl = el('div', 'modal-section-label');
    statusLbl.textContent = '提案先の返答：';
    div.appendChild(statusLbl);
    const list = el('div', 'trade-status-list');
    for (const t of trade.targetPlayerIds) {
      const name = state.players[t]?.name ?? t;
      const resp = trade.responses[t];
      const row = el('div', 'trade-status-row');
      if (!resp) { row.textContent = `⏳ ${name}：検討中…`; row.style.color = 'rgba(255,255,255,0.7)'; }
      else if (resp.status === 'ACCEPT') { row.textContent = `✓ ${name}：OK`; row.style.color = '#7aee40'; }
      else { row.textContent = `✗ ${name}：拒否`; row.style.color = '#ff6060'; }
      list.appendChild(row);
    }
    div.appendChild(list);

    if (pid === trade.initiatorId) {
      if (trade.state === 'TRADE_OFFER') {
        // まだ収集中 → 取り消し可
        div.appendChild(makeBtn('↩ 取り消す', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
      } else {
        // 全員応答済み → 成立相手の選択 or 不成立
        const acceptors = trade.targetPlayerIds.filter(t => trade.responses[t]?.status === 'ACCEPT') as PlayerId[];
        if (acceptors.length === 0) {
          const msg = el('div', 'modal-section-label');
          msg.textContent = '😕 全員が拒否（不成立）';
          msg.style.color = '#ff8060';
          div.appendChild(msg);
          div.appendChild(makeBtn('閉じる', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
        } else {
          const lbl = el('div', 'modal-section-label');
          lbl.textContent = acceptors.length === 1 ? '✅ 成立させる：' : '✅ 成立相手を1人選択：';
          div.appendChild(lbl);
          const row = el('div', 'trade-response-btns');
          for (const a of acceptors) {
            row.appendChild(makeBtn(
              `${state.players[a]?.name} と成立`, 'btn-primary', false,
              () => dispatch({ type: 'CONFIRM_TRADE', responderId: a }),
            ));
          }
          div.appendChild(row);
          div.appendChild(makeBtn('↩ やめる', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
        }
      }
    }
  }

  // TRADE_CANCELLED: 失敗
  if (trade.state === 'TRADE_CANCELLED') {
    const err = el('div', 'modal-section-label');
    err.textContent = '取引失敗：実行前に手持ちが変化しました';
    err.style.color = '#ff8060';
    div.appendChild(err);
    div.appendChild(makeBtn('閉じる', 'btn-end', false, () => dispatch({ type: 'CANCEL_TRADE' })));
  }

  return div;
}

// ============================================================
// 発展カードボタン共通ヘルパー（PRE_ROLL / TRADE_BUILD 両方で使用）
// ============================================================

function appendDevCardButtons(
  div: HTMLElement,
  state: GameState,
  player: Player,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
): void {
  // 街道建設カード処理中は表示しない
  if (state.roadBuildingRoadsRemaining > 0) return;

  let playable = getPlayableDevCards(player, state.globalTurnNumber);
  // ダイス前（PRE_ROLL）は騎士カードのみ使用可。他はダイス後の交易・建設フェーズで。
  if (!state.diceRolledThisTurn) {
    playable = playable.filter(c => c.type === 'knight');
  }
  if (playable.length === 0) return;

  const devAlreadyPlayed = state.devCardPlayedThisTurn;
  for (const { type, count } of playable) {
    const label = `${DEV_CARD_NAMES[type] ?? type}${count > 1 ? ` ×${count}` : ''}`;
    const btn = makeBtn(
      label,
      devAlreadyPlayed ? 'btn-disabled' : 'btn-build',
      devAlreadyPlayed,
      () => {
        if (type === 'knight')         dispatch({ type: 'PLAY_KNIGHT' });
        if (type === 'road_building')  dispatch({ type: 'PLAY_ROAD_BUILDING' });
        if (type === 'year_of_plenty') setUIPhase({ type: 'yearOfPlenty', slots: [null, null] });
        if (type === 'monopoly')       setUIPhase({ type: 'monopoly', resource: null });
      },
    );
    // 騎士は ⚔ 絵文字の代わりに騎士フィギュア画像をアイコンとして先頭に表示。
    if (type === 'knight') {
      btn.textContent = label.replace('⚔ ', '');
      const ic = document.createElement('img');
      ic.className = 'dev-knight-icon';
      ic.src = knightImg; ic.alt = '騎士'; ic.draggable = false;
      btn.prepend(ic);
    }
    div.appendChild(btn);
  }
}

// 船ルールの説明ポップアップ（航海者）。「船は作れるが動かせない」等の疑問に答える。
function showShipRulesHelp(state: GameState, pid: PlayerId): void {
  document.getElementById('ship-help')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ship-help';
  overlay.className = 'help-overlay';
  const card = document.createElement('div');
  card.className = 'help-modal';

  const h = document.createElement('div');
  h.className = 'help-title';
  h.textContent = '⛵ 船のルール';
  card.appendChild(h);

  // 今動かせない理由を一言（分かる範囲で）。
  const reason = document.createElement('p');
  reason.className = 'help-reason';
  const hasOwnShip = Object.values(state.edges).some(e => e.ship?.playerId === pid);
  if (playerHasMovableShip(state, pid)) {
    reason.textContent = '「⛵ 船を移動」で、行き止まりの船を1隻だけ別の海辺へ動かせます。';
  } else if (state.shipMovedThisTurn) {
    reason.textContent = 'このターンはもう船を1隻動かしました（移動は1ターンに1隻まで）。';
  } else if (hasOwnShip) {
    reason.textContent = '今は「行き止まりの船」がないため動かせません。経路の途中の船は動かせません。';
  } else {
    reason.textContent = 'まだ動かせる船がありません。';
  }
  card.appendChild(reason);

  const ul = document.createElement('ul');
  ul.className = 'help-list';
  for (const r of [
    '船は「木材＋羊毛」。海に面した辺に置けます。',
    '道・船は自分の建物／道／船とつながっている必要があります。',
    '動かせるのは「行き止まり（片端が他とつながっていない）の船」だけ。',
    '船の移動は1ターンに1隻まで。',
    '新しい島に開拓地を建てると、そこから先へさらに船を伸ばせます。',
  ]) {
    const li = document.createElement('li');
    li.textContent = r;
    ul.appendChild(li);
  }
  card.appendChild(ul);

  const close = document.createElement('button');
  close.className = 'help-close';
  close.textContent = '閉じる';
  close.addEventListener('click', () => overlay.remove());
  card.appendChild(close);

  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// 騎士と商人: 都市改善・騎士・城壁の操作セクション（騎士の建設は最初の有効頂点へ自動配置・移動は盤面で選択）。
function appendCkBuildSection(
  div: HTMLElement, state: GameState, pid: PlayerId, dispatch: (a: Action) => void,
  buildMode: BuildMode, setBuildMode: (m: BuildMode) => void,
): void {
  const player = state.players[pid]!;
  const sec = el('div', 'ck-build');
  const title = el('div', 'ck-build-title');
  title.textContent = '⚔ 騎士と商人';
  sec.appendChild(title);

  // 都市改善（3ツリー）
  const imp = player.improvements ?? { trade: 0, politics: 0, science: 0 };
  const impRow = el('div', 'ck-imp-row');
  for (const track of ['trade', 'politics', 'science'] as CkTrack[]) {
    const lvl = imp[track];
    const can = canBuildImprovement(state, pid, track);
    const c = CK_TRACK_COMMODITY[track];
    const label = lvl >= 5
      ? `🏛${CK_TRACK_NAME[track]} Lv5`
      : `🏛${CK_TRACK_NAME[track]} Lv${lvl}→${lvl + 1}（${COMMODITY_EMOJI[c]}${improvementCost(lvl)}）`;
    impRow.appendChild(makeBtn(label, can ? 'btn-build' : 'btn-disabled', !can,
      () => dispatch({ type: 'BUILD_IMPROVEMENT', track })));
  }
  sec.appendChild(impRow);

  // 騎士・城壁
  const knightRow = el('div', 'ck-knight-row');
  const firstV = (pred: (vid: string) => boolean): string | undefined => Object.keys(state.vertices).find(pred);
  const buildVid = firstV(v => canBuildKnight(state, pid, v));
  knightRow.appendChild(makeBtn('🛡 騎士を建てる', buildVid ? 'btn-build' : 'btn-disabled', !buildVid,
    () => buildVid && dispatch({ type: 'BUILD_KNIGHT', vertexId: buildVid })));
  const actVid = firstV(v => canActivateKnight(state, pid, v));
  knightRow.appendChild(makeBtn('⚡ 騎士を起動', actVid ? 'btn-build' : 'btn-disabled', !actVid,
    () => actVid && dispatch({ type: 'ACTIVATE_KNIGHT', vertexId: actVid })));
  const upVid = firstV(v => canUpgradeKnight(state, pid, v));
  knightRow.appendChild(makeBtn('⬆ 騎士を昇格', upVid ? 'btn-build' : 'btn-disabled', !upVid,
    () => upVid && dispatch({ type: 'UPGRADE_KNIGHT', vertexId: upVid })));
  // 騎士の移動（盤面で 騎士→移動先 を選択。起動済みの騎士のみ・1ターン1回）。
  if (playerHasMovableKnight(state, pid)) {
    knightRow.appendChild(modeBtn('🏇 騎士を移動', 'moveKnight', true, buildMode, setBuildMode));
  }
  const wallVid = firstV(v => canBuildCityWall(state, pid, v));
  knightRow.appendChild(makeBtn('🧱 城壁', wallVid ? 'btn-build' : 'btn-disabled', !wallVid,
    () => wallVid && dispatch({ type: 'BUILD_CITY_WALL', vertexId: wallVid })));
  sec.appendChild(knightRow);

  // 進歩カード（手札）。使えるものだけ有効。
  const cards = player.progressCards ?? [];
  if (cards.length > 0) {
    const pcTitle = el('div', 'ck-pc-title');
    pcTitle.textContent = `📜 進歩カード（${cards.length}/4）`;
    sec.appendChild(pcTitle);
    const pcRow = el('div', 'ck-pc-row');
    for (const c of cards) {
      const can = canPlayProgress(state, pid, c.id);
      const btn = makeBtn(PROGRESS_CARD_NAME[c.type], can ? 'btn-build' : 'btn-disabled', !can,
        () => dispatch({ type: 'PLAY_PROGRESS', cardId: c.id }));
      btn.title = PROGRESS_CARD_DESC[c.type];
      pcRow.appendChild(btn);
    }
    sec.appendChild(pcRow);
  }

  div.appendChild(sec);
}

// ============================================================
// アクションボタン群
// ============================================================

function buildActionButtons(
  state: GameState,
  player: Player,
  pid: PlayerId,
  buildMode: BuildMode,
  setBuildMode: (m: BuildMode) => void,
  uiPhase: UIPhase,
  setUIPhase: (p: UIPhase) => void,
  dispatch: (a: Action) => void,
  viewerId?: PlayerId,   // LAN: 自分のID
  lanMode = false,       // LAN: 手番gating＋未対応操作を隠す
): HTMLDivElement | null {
  if (state.phase !== 'MAIN') return null;
  const div = el('div', 'action-buttons');

  // ---- DISCARD ----
  if (state.turnPhase === 'DISCARD') {
    // 捨て札UIは「人間が捨てる対象のとき」だけ表示する。
    // CPUが対象の場合に出すと、CPUの手札内訳が漏れ・人間がCPU分を操作できてしまう。
    // LAN ではマスク済み state により discardPid は「自分」に解決する。
    const discardPid = findPendingDiscarder(state);
    if (!discardPid || state.players[discardPid]?.type !== 'human') return null;
    div.appendChild(buildDiscardUI(state, uiPhase, setUIPhase, dispatch));
    return div;
  }

  // ---- 航海者: 金タイル産出の任意資源選択 ----
  // 対象が人間のときだけ表示。CPU分は scheduleAiTurn が自動解決し、解決後に
  // 次の owed（人間含む）へ進む（DISCARD と同じ多人数解決）。
  if (state.turnPhase === 'GOLD') {
    const gpid = state.playerOrder.find(p => ((state.pendingGoldChoice ?? {})[p] ?? 0) > 0);
    if (!gpid || state.players[gpid]?.type !== 'human') return null;
    if (lanMode && viewerId != null && viewerId !== gpid) return null; // LANは自分の分のみ
    div.appendChild(buildGoldChoiceUI(state, gpid, uiPhase, setUIPhase, dispatch));
    return div;
  }

  // ---- F-05: ペンディング交易 ----
  if (state.pendingTrade !== null) {
    div.appendChild(buildPendingTradeUI(state, pid, dispatch, viewerId, lanMode));
    return div;
  }

  // ---- セカンダリUI（オーバーレイ）----
  if (uiPhase.type === 'robberTarget') {
    div.appendChild(buildRobberTargetUI(state, uiPhase, dispatch));
    return div;
  }
  if (uiPhase.type === 'bankTrade') {
    div.appendChild(buildBankTradeUI(state, pid, player, uiPhase, setUIPhase, dispatch));
    return div;
  }
  if (uiPhase.type === 'yearOfPlenty') {
    div.appendChild(buildYearOfPlentyUI(state, uiPhase, setUIPhase, dispatch));
    return div;
  }
  if (uiPhase.type === 'monopoly') {
    div.appendChild(buildMonopolyUI(uiPhase, setUIPhase, dispatch));
    return div;
  }
  if (uiPhase.type === 'playerTradeOffer') {
    div.appendChild(buildPlayerTradeOfferUI(player, pid, state, uiPhase, setUIPhase, dispatch));
    return div;
  }

  // ここから先は「現在の手番プレイヤー自身」の操作ボタン。
  // CPUの手番ではダイス/建設/交易/ターン終了などを人間に出さない
  // （CPUは内部ロジックで自動進行する）。
  if (player.type !== 'human') return null;
  // LAN: 自分の手番でない端末には操作ボタンを出さない（サーバでも検証）。
  if (lanMode && viewerId != null && viewerId !== pid) return null;

  // ---- PRE_ROLL ----
  if (state.turnPhase === 'PRE_ROLL') {
    div.appendChild(makeBtn('🎲 ダイスを振る', 'btn-primary', false, () => dispatch({ type: 'ROLL_DICE' })));
    // ダイス前は騎士のみ使用可（appendDevCardButtons 内で制御）。LANも対応。
    appendDevCardButtons(div, state, player, setUIPhase, dispatch);
    if (calcVP(state, pid) >= victoryTarget(state)) {
      div.appendChild(makeBtn('🏆 勝利宣言！', 'btn-primary', false, () => dispatch({ type: 'DECLARE_VICTORY' })));
    }
    return div;
  }

  if (state.turnPhase !== 'TRADE_BUILD') return null;

  // ---- 街道建設カード使用中 ----
  if (state.roadBuildingRoadsRemaining > 0) {
    const info = el('div', 'turn-phase-text');
    info.textContent = `🛤 街道建設カード使用中（残り ${state.roadBuildingRoadsRemaining} 本）`;
    div.appendChild(info);
    div.appendChild(modeBtn('🛤 道を置く', 'road', player.remainingRoads > 0, buildMode, setBuildMode));
    div.appendChild(makeBtn('✓ 道路建設を完了', 'btn-end', false, () => dispatch({ type: 'FINISH_ROAD_BUILDING' })));
    return div;
  }

  // ---- TRADE_BUILD ----
  const canRoad  = player.remainingRoads > 0 && hasEnoughResources(player.hand, BUILD_COSTS.road);
  const canSettl = player.remainingSettlements > 0 && hasEnoughResources(player.hand, BUILD_COSTS.settlement);
  const canCity  = player.remainingCities > 0 && hasEnoughResources(player.hand, BUILD_COSTS.city);
  const canDev   = state.devDeck.length > 0 && hasEnoughResources(player.hand, BUILD_COSTS.dev_card);
  // 航海者: 盤面に海タイルがあるときだけ船ボタンを出す（基本盤では非表示）。
  const hasSea   = Object.values(state.tiles).some(t => t.type === 'sea');
  const canShip  = (player.remainingShips ?? 0) > 0 && hasEnoughResources(player.hand, BUILD_COSTS.ship);

  // 建設モード選択中のヒント文（「選択中：光っている場所をタップ」）は操作パネルの
  // レイアウトを崩すため表示しない。配置可能な頂点/辺は盤面側のハイライトで示す。

  div.appendChild(modeBtn('🛤 道', 'road', canRoad, buildMode, setBuildMode));
  if (hasSea) {
    div.appendChild(modeBtn('🚢 船', 'ship', canShip, buildMode, setBuildMode));
    // 航海者: 動かせる船があるときだけ「船を移動」モードを出す（1ターン1回）。
    if (playerHasMovableShip(state, pid)) {
      div.appendChild(modeBtn('⛵ 船を移動', 'moveShip', true, buildMode, setBuildMode));
    }
    // 船ルールはいつでも見られるよう常時ヘルプを置く（作れても動かせない等の疑問対策）。
    div.appendChild(makeBtn('⛵ 船のルール', 'btn-ship-help', false, () => showShipRulesHelp(state, pid)));
  }
  div.appendChild(modeBtn('🏠 開拓地', 'settlement', canSettl, buildMode, setBuildMode));
  div.appendChild(modeBtn('🏙 都市', 'city', canCity, buildMode, setBuildMode));
  // 発展カードは騎士と商人では使わない（進歩カードに置換）。基本/航海者のみ表示。
  if (!isCk(state)) {
    div.appendChild(makeBtn('🃏 発展カード購入', canDev ? 'btn-build' : 'btn-disabled', !canDev,
      () => dispatch({ type: 'BUY_DEV_CARD' })));
  }

  // 騎士と商人: 都市改善・騎士・城壁。
  if (isCk(state)) appendCkBuildSection(div, state, pid, dispatch, buildMode, setBuildMode);

  div.appendChild(makeBtn('💱 バンク交易', 'btn-build', false,
    () => setUIPhase({ type: 'bankTrade', give: null, receive: null })));

  // F-05: プレイヤー間交易（相手が2人以上いる場合のみ）
  if (state.playerOrder.length > 1) {
    div.appendChild(makeBtn('🤝 プレイヤー間交易', 'btn-build', false,
      () => setUIPhase({ type: 'playerTradeOffer', give: makeZeroHand(), receive: makeZeroHand(), targetPids: state.playerOrder.filter(p => p !== pid) as PlayerId[] })));
  }

  // TRADE_BUILD でも発展カードを使用できる（1ターン1枚制限あり）
  appendDevCardButtons(div, state, player, setUIPhase, dispatch);

  if (calcVP(state, pid) >= victoryTarget(state)) {
    div.appendChild(makeBtn('🏆 勝利宣言！', 'btn-primary', false, () => dispatch({ type: 'DECLARE_VICTORY' })));
  }

  div.appendChild(makeBtn('↩ ターン終了', 'btn-end', false, () => dispatch({ type: 'END_TURN' })));
  return div;
}

// ============================================================
// メイン描画
// ============================================================

export function renderUI(
  container: HTMLDivElement,
  state: GameState,
  buildMode: BuildMode,
  setBuildMode: (mode: BuildMode) => void,
  uiPhase: UIPhase,
  setUIPhase: (phase: UIPhase) => void,
  dispatch: (action: Action) => void,
  viewerId?: PlayerId,      // LAN対戦: 自分のID（単一端末プレイでは未指定）
  lanMode = false,          // LAN対戦: 操作UIを viewer の手番のみ有効化＋未対応操作を隠す
): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  const pid = state.playerOrder[state.currentPlayerIndex]!;
  const player = state.players[pid]!;
  const color = PLAYER_COLORS[pid] ?? '#aaa';

  // 自分の手番か（LAN=viewerId、単一端末=human）。手番の所在を大きく明示する。
  const selfPid: PlayerId | undefined = viewerId ?? state.playerOrder.find(p => state.players[p]?.type === 'human');
  const isMyTurn = state.phase !== 'GAME_OVER' && selfPid != null && pid === selfPid;
  const isCpuTurn = player.type === 'ai';

  const turnPanel = el('div', `turn-panel${isMyTurn ? ' mine-turn' : ''}`);

  // 手番バナー: 「あなたのターン」/「○○のターン（CPU）」を最上部に大きく表示。
  // 横持ちでも高さを取りすぎないよう CSS 側で1行・コンパクトにする。
  if (state.phase !== 'GAME_OVER') {
    const banner = el('div', `turn-banner ${isMyTurn ? 'mine' : isCpuTurn ? 'cpu' : 'other'}`);
    banner.style.setProperty('--turn-color', color);
    const bdot = el('span', 'turn-banner-dot');
    bdot.style.background = color;
    const btxt = el('span', 'turn-banner-text');
    btxt.textContent = isMyTurn ? 'あなたのターン'
      : isCpuTurn ? `${player.name} のターン（CPU）`
      : `${player.name} のターン`;
    banner.append(bdot, btxt);
    turnPanel.appendChild(banner);
  }

  const infoRow = el('div', 'turn-info-row');
  const dot = el('span', 'color-dot');
  dot.style.background = color;
  infoRow.appendChild(dot);
  const nameEl = el('span', 'turn-player-name');
  nameEl.textContent = player.name;
  infoRow.appendChild(nameEl);
  const vpEl = el('span', 'turn-vp');
  // CPU の内部VP（VPカード込み）は他プレイヤーには非公開
  vpEl.textContent = `★${player.type === 'human' ? calcVP(state, pid) : calcPublicVP(state, pid)}`;
  infoRow.appendChild(vpEl);
  turnPanel.appendChild(infoRow);

  // 手番順表示（現在の手番を強調）。プレイヤーの手札内容は出さない。
  const orderBar = el('div', 'turn-order-bar');
  const orderLbl = el('span', 'turn-order-label');
  orderLbl.textContent = '手番順';
  orderBar.appendChild(orderLbl);
  state.playerOrder.forEach((opId, i) => {
    const op = state.players[opId];
    if (!op) return;
    const chip = el('span', `turn-order-chip${opId === pid ? ' current' : ''}`);
    const cdot = el('span', 'turn-order-dot');
    cdot.style.background = PLAYER_COLORS[opId] ?? '#aaa';
    chip.appendChild(cdot);
    const cname = el('span', 'turn-order-name');
    cname.textContent = op.name;
    chip.appendChild(cname);
    orderBar.appendChild(chip);
    if (i < state.playerOrder.length - 1) {
      const sep = el('span', 'turn-order-sep');
      sep.textContent = '→';
      orderBar.appendChild(sep);
    }
  });
  turnPanel.appendChild(orderBar);

  const phaseEl = el('div', 'turn-phase-text');
  phaseEl.textContent = phaseText(state);
  turnPanel.appendChild(phaseEl);

  if (state.lastDiceRoll) {
    const [d1, d2] = state.lastDiceRoll;
    const diceEl = el('div', 'dice-result');
    diceEl.textContent = `🎲 ${d1}+${d2}=${d1 + d2}`;
    turnPanel.appendChild(diceEl);
  }

  // 称号状況（保持者名＋現在値）＋発展カード山札残数（すべて公開情報）
  const titles = el('div', 'turn-titles');
  const lrHolder = state.longestRoadHolder ? state.players[state.longestRoadHolder] : null;
  const laHolder = state.largestArmyHolder ? state.players[state.largestArmyHolder] : null;
  const t1 = el('span', 'turn-title-item');
  t1.textContent = lrHolder
    // エンジンが updateLongestRoad で全プレイヤー分を維持するキャッシュを参照する
    // （毎 redraw の DFS 再計算は道が密集した終盤にモーダル操作のジャンクになる）。
    ? `🛤最長 ${lrHolder.name}(${lrHolder.longestRoadLength})`
    : '🛤最長 未獲得';
  const t3 = el('span', 'turn-title-item');
  if (isCk(state)) {
    // 騎士と商人: 最大騎士の代わりに蛮族の進行度を表示。
    const pos = state.barbarianPosition ?? 0;
    const t2 = el('span', `turn-title-item${pos >= CK_BARBARIAN_MAX - 1 ? ' ck-barb-danger' : ''}`);
    t2.textContent = `🛶蛮族 ${pos}/${CK_BARBARIAN_MAX}（襲来${state.barbarianAttacks ?? 0}回）`;
    t3.textContent = '';
    titles.append(t1, t2);
  } else {
    const t2 = el('span', 'turn-title-item');
    t2.textContent = laHolder ? `⚔最大騎士 ${laHolder.name}(${laHolder.knightsPlayed})` : '⚔最大騎士 未獲得';
    t3.textContent = `🃏山札 ${state.devDeck.length}`;
    titles.append(t1, t2, t3);
  }
  turnPanel.appendChild(titles);

  // 直近に起きた公開イベントだけを1行で表示（履歴一覧は出さない）。
  // state.log は視点別マスク済み（buildActionLog が公開情報のみ生成）なので秘匿安全。
  const lastLog = state.log.length > 0 ? state.log[state.log.length - 1] : null;
  if (lastLog) {
    const ev = el('div', 'last-event');
    ev.textContent = lastLog.message;
    turnPanel.appendChild(ev);
  }

  const btns = buildActionButtons(
    state, player, pid, buildMode, setBuildMode, uiPhase, setUIPhase, dispatch, viewerId, lanMode,
  );
  if (btns) turnPanel.appendChild(btns);

  // LAN対戦で自分の手番でないときは、誰の手番かを明示する。
  // CPU の手番は「操作中」と分かるように表示する（サーバ側で自動進行）。
  if (lanMode && viewerId != null && viewerId !== pid && state.phase !== 'GAME_OVER') {
    const waitEl = el('div', 'lan-turn-wait');
    const compact = isLandscapeCompact();
    // CPU/人間を問わず控えめに「○○ の番」とだけ（操作パネル側の小表示。CPUを強調しない）。
    waitEl.textContent = compact ? `⏳ ${player.name} の番` : `⏳ ${player.name} の番です`;
    turnPanel.appendChild(waitEl);
  }

  // CPU起案交易がある場合はターンパネルに pending trade を表示
  // （buildActionButtons の pendingTrade チェックは pid=CPU で動くが念のため明示）

  container.appendChild(turnPanel);

  // ログ履歴パネルは画面表示しない（スマホ実プレイで邪魔なため UI から削除）。
  // 公開情報ログの生成（buildActionLog）と state.log・視点別配信は従来どおり維持する。

  const allPanels = el('div', 'player-panels');
  for (const pId of state.playerOrder) {
    const p = state.players[pId];
    if (!p) continue;
    allPanels.appendChild(buildPlayerPanel(p, pId as PlayerId, state, pId === pid, viewerId));
  }

  // 広い画面・横持ちスマホでは盤面ラッパー(#board-area)の四隅にパネルを配置し、
  // 盤面を大きく見せる。狭い縦画面では従来どおり #ui 内（盤面下の縦並び）にする。
  const boardArea = document.getElementById('board-area');
  // 前回描画でラッパーに残ったパネルを除去（モード切替・再描画対策）
  boardArea?.querySelector('.player-panels')?.remove();
  if (boardArea && useCornerLayout()) {
    boardArea.classList.add('corner-panels');
    boardArea.classList.remove('mini-mode');
    boardArea.appendChild(allPanels);
  } else {
    boardArea?.classList.remove('corner-panels');
    // 四隅レイアウトでない＝パネルが盤面下に回り込む。スマホ縦持ちと同様に
    // 盤面内ミニパネルを表示し（mini-mode）、資源アニメもそこへ着地させる。
    boardArea?.classList.add('mini-mode');
    container.appendChild(allPanels);
  }

  // 盤面四隅のミニプレイヤーパネルを重ねる（資源アニメの着地先）。
  // 実際の表示/非表示は #board-area.mini-mode（=盤面下回り込みレイアウト）で CSS が制御する。
  renderMiniPanels(state, viewerId);

  // ミニパネルの中央寄せ幅を、盤面の実描画幅(px)に同期させる。
  syncBoardDrawWidth();
}

// 盤面の実描画幅(px)を #board-area の CSS 変数 --board-draw-width へ書き出す。
// ミニパネル(mini-mode)の中央寄せ幅はこの変数を参照する（盤面幅の単一の真実）。
// CSS 側に既定値 min(100%, calc(78vh*800/700)) があるため、未設定でも崩れない。
// resize/orientationchange でも呼び、リロードなしで追従させる。
export function syncBoardDrawWidth(): void {
  const boardArea = document.getElementById('board-area');
  const boardEl = document.getElementById('board');
  if (!boardArea || !boardEl) return;
  const w = boardEl.getBoundingClientRect().width;
  if (w > 0) boardArea.style.setProperty('--board-draw-width', `${Math.round(w)}px`);
}

// 四隅レイアウトを使うか: 広い画面 or 横持ちスマホ（横長かつ低い高さ）。
function useCornerLayout(): boolean {
  const w = window.innerWidth, h = window.innerHeight;
  if (w >= CORNER_LAYOUT_MIN_WIDTH) return true;
  return w > h && h <= 600; // landscape phone
}

// 表示幅で文字列を切り詰める（盤上ミニパネル用）。全角=幅2 / 半角英数記号・半角カナ=幅1、
// 合計が maxWidth(=全角4相当=8) を超える直前で停止。省略記号は付けない。
export function clipByWidth(s: string, maxWidth = 8): string {
  let w = 0;
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const cw = ((code >= 0x20 && code <= 0x7e) || (code >= 0xff61 && code <= 0xff9f)) ? 1 : 2;
    if (w + cw > maxWidth) break;
    out += ch;
    w += cw;
  }
  return out;
}

// スマホ縦持ち用ミニパネルの四隅割り当て（人数別にバランスよく配置）。
const MINI_CORNERS: Record<number, string[]> = {
  1: ['corner-tl'],
  2: ['corner-tl', 'corner-tr'],
  3: ['corner-tl', 'corner-tr', 'corner-bl'],
  4: ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'],
};

// 盤面四隅のミニプレイヤーパネルを #board-area に重ねて描画する（縦持ちスマホ専用）。
// 表示する公開情報のみ: 名前 / VP / 手札枚数 / 現手番 / 最長・最大の小アイコン。
// 他プレイヤーの手札内訳・発展カード内容は出さない（手札は枚数のみ＝公開情報）。
function renderMiniPanels(state: GameState, viewerId?: PlayerId): void {
  const boardArea = document.getElementById('board-area');
  if (!boardArea) return;
  boardArea.querySelector('.mini-panels')?.remove();

  const order = state.playerOrder;
  const corners = MINI_CORNERS[order.length] ?? MINI_CORNERS[4]!;
  const currentPid = state.playerOrder[state.currentPlayerIndex];
  const selfPid = viewerId ?? state.playerOrder.find(p => state.players[p]?.type === 'human');

  const wrap = el('div', 'mini-panels');
  order.forEach((pid, i) => {
    const p = state.players[pid];
    if (!p) return;
    const isSelf = viewerId != null ? pid === viewerId : p.type === 'human';
    const isWinner = state.phase === 'GAME_OVER' && pid === state.winner;
    // 自分・勝者は内部VP（VPカード込み）、他プレイヤーは公開VPのみ（秘匿維持）。
    const vp = (isSelf || isWinner) ? calcVP(state, pid as PlayerId) : calcPublicVP(state, pid as PlayerId);
    const handTotal = isSelf
      ? RESOURCE_TYPES.reduce((s, r) => s + p.hand[r], 0)
      : (p.handCount ?? RESOURCE_TYPES.reduce((s, r) => s + p.hand[r], 0));
    const isCurrent = pid === currentPid && state.phase !== 'GAME_OVER';
    const mine = pid === selfPid;
    const color = PLAYER_COLORS[pid] ?? '#aaa';

    const panel = el('div', `mini-panel ${corners[i] ?? 'corner-tl'}${isCurrent ? ' current' : ''}${isCurrent && mine ? ' mine' : ''}`);
    panel.dataset.pid = pid;
    panel.style.setProperty('--mini-color', color);

    // 1行目: カラードット + 名前（長い場合は省略表示）
    const row1 = el('div', 'mini-row1');
    const dot = el('span', 'mini-dot');
    dot.style.background = color;
    const name = el('span', 'mini-name');
    name.textContent = clipByWidth(p.name, 8);   // 全角4文字相当で単純切り捨て（省略記号なし）
    row1.append(dot, name);

    // 2行目: ★点数 🃏手札枚数（公開情報のみ）＋ 称号アイコン
    const row2 = el('div', 'mini-row2');
    const stat = el('span', 'mini-stat');
    stat.textContent = `★${vp} 🃏${handTotal}`;
    row2.appendChild(stat);
    if (p.hasLongestRoad || p.hasLargestArmy) {
      const badges = el('span', 'mini-badges');
      if (p.hasLongestRoad) { const bdg = el('span', 'mini-badge'); bdg.textContent = '🛤'; badges.appendChild(bdg); }
      if (p.hasLargestArmy) { const bdg = el('span', 'mini-badge'); bdg.textContent = '⚔'; badges.appendChild(bdg); }
      row2.appendChild(badges);
    }

    panel.append(row1, row2);
    wrap.appendChild(panel);
  });
  boardArea.appendChild(wrap);
}

// ============================================================
// プレイヤーパネル
// ============================================================

function buildPlayerPanel(
  player: Player,
  pId: PlayerId,
  state: GameState,
  isActive: boolean,
  viewerId?: PlayerId,
): HTMLDivElement {
  // GAME_OVER時の勝者はVPカード・内訳のみ開示。資源・他発展カードは非公開のまま。
  const isWinner = state.phase === 'GAME_OVER' && pId === state.winner;
  // LAN対戦では viewerId（自分のID）基準で自分のみ全公開。
  // 単一端末プレイ（viewerId 未指定）では従来どおり human=自分。
  const isSelf = viewerId != null ? (pId === viewerId) : (player.type === 'human');

  const div = el('div', `player-panel${isActive ? ' active' : ''}${isActive && isSelf && state.phase !== 'GAME_OVER' ? ' your-turn' : ''}${isWinner ? ' winner-glow' : ''}`);
  div.dataset.pid = pId;  // リソースアニメーション用
  const color = PLAYER_COLORS[pId] ?? '#aaa';
  // プレイヤーカラーを反映（控えめ）：暖色寄りの暗いベースに淡い着色＋濃い枠線。
  // 文字可読性を優先するため背景は約82%暗色で、色は淡く乗せる程度。
  div.style.background = `linear-gradient(rgba(18,26,28,0.84), rgba(13,20,23,0.88)), ${color}`;
  div.style.borderColor = `${color}aa`;
  div.style.borderLeftWidth = '4px';
  div.style.boxShadow = '0 6px 18px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,238,206,0.05)';
  if (isActive) {
    // 現在手番は枠を濃く＋発光で明確に区別
    div.style.borderColor = color;
    div.style.boxShadow = `0 6px 20px rgba(0,0,0,0.45), 0 0 14px ${color}66, inset 0 1px 0 rgba(255,238,206,0.07)`;
  }

  // 順位バッジ: 公開VPを基準にする（VP カードは非公開のため）
  const vpByPlayer = state.playerOrder.map(p => ({ pid: p, vp: calcPublicVP(state, p as PlayerId) }));
  vpByPlayer.sort((a, b) => b.vp - a.vp);
  const rank = vpByPlayer.findIndex(x => x.pid === pId) + 1;
  const rankLabel = rank === 1 ? '👑' : `${rank}位`;

  const h3 = el('h3');
  h3.style.borderBottomColor = `${color}88`;  // 見出し下線もプレイヤーカラー
  // 1行目: カラードット + プレイヤー名
  const nameRow = el('span', 'panel-name-row');
  const dot = el('span', 'color-dot');
  dot.style.background = color;
  nameRow.appendChild(dot);
  const nameSpan = el('span', 'panel-name');
  nameSpan.textContent = player.name;
  nameRow.appendChild(nameSpan);
  h3.appendChild(nameRow);
  // 2行目: VP + 順位 + コンパクト統計（開拓地/都市/手札枚数）。1行固定で折り返さない。
  const bd = calcVPBreakdown(state, pId);
  const handTotal = isSelf
    ? RESOURCE_TYPES.reduce((s, r) => s + player.hand[r], 0)
    : (player.handCount ?? RESOURCE_TYPES.reduce((s, r) => s + player.hand[r], 0));
  const statRow = el('span', 'panel-stat-row');
  const vpSpan = el('span', 'panel-vp');
  // 自分: 内部VP（VPカード込み）、他プレイヤー: 公開VPのみ
  vpSpan.textContent = `★${isSelf ? calcVP(state, pId) : calcPublicVP(state, pId)}`;
  statRow.appendChild(vpSpan);
  const rankEl = el('span', `rank-badge${rank === 1 ? ' rank-1' : ''}`);
  rankEl.textContent = rankLabel;
  statRow.appendChild(rankEl);
  // 開拓地数・都市数・手札枚数をまとめて表示（手札は枚数のみ＝公開情報）。
  const counts = el('span', 'stat-counts');
  for (const [icon, n] of [['🏠', bd.settlements], ['🏙', bd.cities], ['🃏', handTotal]] as [string, number][]) {
    const c = el('span', 'stat-count');
    c.textContent = `${icon}${n}`;
    counts.appendChild(c);
  }
  statRow.appendChild(counts);
  h3.appendChild(statRow);
  div.appendChild(h3);

  // ボーナスVP内訳（最長/最大/VPカード）。開拓地・都市数は stat-row に集約済み。
  // GAME_OVER時は勝者のVPカード枚数も開示する（他プレイヤーは非公開のまま）。
  const showVpCards = (isSelf || isWinner) && bd.vpCards > 0;
  if (bd.lr || bd.la || bd.islandBonus > 0 || showVpCards) {
    const vpRow = el('div', 'vp-breakdown');
    if (bd.islandBonus > 0) {
      const item = el('span', 'vp-item bonus');
      item.textContent = `🏝+${bd.islandBonus * 2}`;
      item.title = `新しい島への入植 ${bd.islandBonus}件（+${bd.islandBonus * 2}点）`;
      vpRow.appendChild(item);
    }
    if (bd.lr) {
      const item = el('span', 'vp-item bonus');
      item.textContent = '🛤最長+2';
      vpRow.appendChild(item);
    }
    if (bd.la) {
      const item = el('span', 'vp-item bonus');
      item.textContent = '⚔最大+2';
      vpRow.appendChild(item);
    }
    if (showVpCards) {
      const item = el('span', 'vp-item');
      item.textContent = `★×${bd.vpCards}`;
      item.title = `★カード ${bd.vpCards}点`;
      vpRow.appendChild(item);
    }
    div.appendChild(vpRow);
  }

  // 称号の現在値＋残コマ数（公開情報。未使用発展カードや手札内訳は出さない）
  const meta = el('div', 'panel-meta');
  const lrLen = player.longestRoadLength; // エンジン維持のキャッシュ（calcLongestRoad の再計算は不要）
  const lrItem = el('span', `panel-meta-item${player.hasLongestRoad ? ' held' : ''}`);
  lrItem.textContent = `🛤${lrLen}`;
  lrItem.title = player.hasLongestRoad
    ? `最長交易路 保持中（${lrLen}本）`
    : `最長道路 ${lrLen}本（獲得は${LONGEST_ROAD_MIN}本以上）`;
  meta.appendChild(lrItem);
  const knItem = el('span', `panel-meta-item${player.hasLargestArmy ? ' held' : ''}`);
  knItem.textContent = `⚔${player.knightsPlayed}`;
  knItem.title = player.hasLargestArmy
    ? `最大騎士力 保持中（騎士${player.knightsPlayed}回）`
    : `騎士使用 ${player.knightsPlayed}回（獲得は${LARGEST_ARMY_MIN}回以上）`;
  meta.appendChild(knItem);
  const sep = el('span', 'panel-meta-sep');
  sep.textContent = '·';
  meta.appendChild(sep);
  const pieces = el('span', 'panel-meta-item');
  pieces.textContent = `道${player.remainingRoads} 家${player.remainingSettlements} 都${player.remainingCities}`;
  pieces.title = '残り 道 / 開拓地 / 都市';
  meta.appendChild(pieces);
  div.appendChild(meta);

  // 資源手札UI（自分のみ種別カードを表示。枚数合計は stat-row の 🃏 に集約済み）。
  // 他プレイヤーは秘匿マスクで hand が全0・handCount に枚数が入るため種別は出さない。
  if (isSelf) {
    const resRow = el('div', 'res-card-row');
    for (const r of RESOURCE_TYPES) {
      const count = player.hand[r];
      const card = el('div', `res-card res-${r}${count === 0 ? ' zero' : ''}`);
      const icon = resIconImg(r, 'res-card-img');
      const cnt = el('span', 'res-card-count');
      cnt.textContent = String(count);
      card.appendChild(icon);
      card.appendChild(cnt);
      resRow.appendChild(card);
    }
    div.appendChild(resRow);

    // 騎士と商人: 商品の手札（自分のみ）。
    if (isCk(state)) {
      const comm = player.commodities ?? { coin: 0, cloth: 0, paper: 0 };
      const cRow = el('div', 'ck-comm-row');
      for (const c of COMMODITY_TYPES) {
        const chip = el('span', `ck-comm ck-comm-${c}${comm[c] === 0 ? ' zero' : ''}`);
        chip.textContent = `${COMMODITY_EMOJI[c]}${comm[c]}`;
        cRow.appendChild(chip);
      }
      div.appendChild(cRow);
    }
  }

  // 騎士と商人: 都市改善レベルと騎士力（全員・公開情報）。
  if (isCk(state)) {
    const imp = player.improvements ?? { trade: 0, politics: 0, science: 0 };
    const kStr = Object.values(state.vertices)
      .filter(v => v.knight?.playerId === pId)
      .reduce((s, v) => s + (v.knight!.active ? v.knight!.strength : 0), 0);
    const kTotal = Object.values(state.vertices).filter(v => v.knight?.playerId === pId).length;
    const ck = el('div', 'ck-status');
    ck.textContent = `改善 交${imp.trade}/政${imp.politics}/科${imp.science}　🛡騎士${kTotal}(力${kStr})`;
    div.appendChild(ck);
  }

  // 発展カードUI
  // 他プレイヤーは秘匿マスクで devCards が空・devCardCount に枚数が入る場合がある。
  const devCount = isSelf ? player.devCards.length : (player.devCardCount ?? player.devCards.length);
  if (devCount > 0) {
    const devPanel = el('div', 'dev-card-panel');
    if (isSelf) {
      // 自分: 種別・使用可否を表示
      const groups: Record<string, { total: number; playable: number }> = {};
      for (const card of player.devCards) {
        if (!groups[card.type]) groups[card.type] = { total: 0, playable: 0 };
        groups[card.type]!.total++;
        if (card.purchasedOnTurn < state.globalTurnNumber) groups[card.type]!.playable++;
      }
      for (const [type, { total, playable }] of Object.entries(groups)) {
        const isVP = type === 'victory_point';
        const chipCls = isVP ? 'vp' : playable > 0 ? 'playable' : 'new-card';
        const chip = el('span', `dev-card-chip ${chipCls}`);
        chip.textContent = `${DEV_CARD_CHIP_NAMES[type] ?? type}${total > 1 ? ` ×${total}` : ''}`;
        chip.title = isVP ? '勝利点カード（常時効果）'
          : playable > 0 ? '使用可能（PRE_ROLLに使用）'
          : '今ターン購入（次ターンから使用可）';
        devPanel.appendChild(chip);
      }
    } else {
      // 他プレイヤー: 枚数のみ（種類・VPカード枚数は非表示）
      const chip = el('span', 'dev-card-chip hidden');
      chip.textContent = `🃏 ×${devCount}`;
      devPanel.appendChild(chip);
    }
    div.appendChild(devPanel);
  }

  return div;
}
