// ============================================================
// src/main.ts — エントリポイント
// ============================================================

import './style.css';
import type { GameState, Action, PlayerId, AiDifficulty, ResourceType, TradeOffer, ResourceHand } from './types';
import type { PlayerOrderMode } from './engine/setup';
import { makeHand, RESOURCE_TYPES, VP_TABLE } from './constants';
import { createInitialGameState } from './engine/createState';
import type { PlayerSpec } from './engine/createState';
import { applyAction } from './engine/game';
import { renderLanLobby } from './net/lanLobby';
import type { LanClient } from './net/lanClient';
import { generateRandomPlayerName } from './net/names';
import { attachNameField, savePlayerName } from './net/nameField';
import { canBuildRoad, canBuildSettlement, canBuildCity } from './engine/actions';
import { renderBoard } from './renderer/board';
import type { BoardRenderOptions } from './renderer/board';
import { renderUI } from './renderer/ui';
import type { UIPhase } from './renderer/ui';
import { attachBoardEvents } from './renderer/events';
import type { BuildMode } from './renderer/events';
import { chooseAction } from './engine/ai';
import type { AiOpts } from './engine/ai';
import { buildActionLog, MAX_LOG_ENTRIES, RES_EMOJI } from './engine/log';
import { calcVP } from './engine/scoring';

// ============================================================
// ホーム画面設定
// ============================================================

type CpuSpeed = 'slow' | 'normal' | 'fast' | 'instant';

interface HomeConfig {
  mode: 'cpu' | 'online';
  playerName: string;
  cpuCount: 1 | 2 | 3;
  cpuDifficulty: AiDifficulty;
  cpuSpeed: CpuSpeed;
  orderMode: PlayerOrderMode;
  // orderMode==='fixed' のときの手番順（参加プレイヤーIDの順列）。
  // 'random' のときは未使用（開始時に毎回シャッフル）。
  playerOrderSpec?: PlayerId[];
}

const PLAYER_IDS: PlayerId[]   = ['player1', 'player2', 'player3', 'player4'];
const PLAYER_COLORS            = ['red', 'blue', 'purple', 'orange'] as const;
const CPU_NAMES                = ['CPU α', 'CPU β', 'CPU γ'];

// ============================================================
// ホーム画面レンダリング
// ============================================================

function renderHome(
  container: HTMLElement,
  onStart: (cfg: HomeConfig) => void,
  onLanStart: (state: GameState, viewerId: PlayerId, client: LanClient) => void,
): void {
  container.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'home-screen';

  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = '🎲 カタン';
  screen.appendChild(title);

  const card = document.createElement('div');
  card.className = 'home-card';

  // ---- タブ ----
  const tabs = document.createElement('div');
  tabs.className = 'home-tabs';

  // 既定はオンライン（LAN）対戦タブ。CPU対戦タブも残す。
  const tabCpu    = createTab('CPU 対戦',      false);
  const tabOnline = createTab('オンライン対戦', true);
  tabs.appendChild(tabCpu);
  tabs.appendChild(tabOnline);
  card.appendChild(tabs);

  // ---- CPU 対戦フォーム ----（既定はオンラインタブなので初期は非表示）
  const cpuForm = document.createElement('div');
  cpuForm.className = 'home-form';
  cpuForm.style.display = 'none';

  const nameField = document.createElement('div');
  nameField.className = 'home-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'home-label';
  nameLabel.textContent = 'プレイヤー名';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'home-input';
  const nameRow = document.createElement('div');
  nameRow.className = 'name-input-row';
  // 初期値=保存名 or ランダムなカタカナ名、横に 🎲 再生成ボタン。
  const nameDice = attachNameField(nameInput);
  if (lastConfig?.playerName) nameInput.value = lastConfig.playerName; // 同セッションの再戦は前回名を優先
  nameRow.appendChild(nameInput);
  nameRow.appendChild(nameDice);
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameRow);
  cpuForm.appendChild(nameField);

  const countField = document.createElement('div');
  countField.className = 'home-field';
  const countLabel = document.createElement('label');
  countLabel.className = 'home-label';
  countLabel.textContent = 'CPU 数';
  const countGroup = document.createElement('div');
  countGroup.className = 'home-radio-group';
  const defaultCount = String(lastConfig?.cpuCount ?? 1);
  countGroup.appendChild(createRadioGroup('cpuCount', ['1', '2', '3'], defaultCount));
  countField.appendChild(countLabel);
  countField.appendChild(countGroup);
  cpuForm.appendChild(countField);

  const diffField = document.createElement('div');
  diffField.className = 'home-field';
  const diffLabel = document.createElement('label');
  diffLabel.className = 'home-label';
  diffLabel.textContent = 'CPU の強さ';
  const diffGroup = document.createElement('div');
  diffGroup.className = 'home-radio-group';
  const diffLabelMap: Record<AiDifficulty, string> = { weak: '弱', normal: '普通', strong: '強' };
  const defaultDiff = diffLabelMap[lastConfig?.cpuDifficulty ?? 'normal'];
  diffGroup.appendChild(createRadioGroup('cpuDiff', ['弱', '普通', '強'], defaultDiff));
  diffField.appendChild(diffLabel);
  diffField.appendChild(diffGroup);
  cpuForm.appendChild(diffField);

  // ---- CPU 速度 ----
  const speedField = document.createElement('div');
  speedField.className = 'home-field';
  const speedLabel = document.createElement('label');
  speedLabel.className = 'home-label';
  speedLabel.textContent = 'CPU の速度';
  const speedGroup = document.createElement('div');
  speedGroup.className = 'home-radio-group';
  const speedLabelMap: Record<CpuSpeed, string> = { slow: 'ゆっくり', normal: '普通', fast: '速い', instant: '最速' };
  const defaultSpeed = speedLabelMap[lastConfig?.cpuSpeed ?? 'normal'];
  speedGroup.appendChild(createRadioGroup('cpuSpeed', ['ゆっくり', '普通', '速い', '最速'], defaultSpeed));
  speedField.appendChild(speedLabel);
  speedField.appendChild(speedGroup);
  cpuForm.appendChild(speedField);

  // ---- プレイヤー順 ----
  const orderField = document.createElement('div');
  orderField.className = 'home-field';
  const orderLabel = document.createElement('label');
  orderLabel.className = 'home-label';
  orderLabel.textContent = 'プレイヤー順';
  const orderGroup = document.createElement('div');
  orderGroup.className = 'home-radio-group';
  const orderDefault = (lastConfig?.orderMode ?? 'random') === 'fixed' ? '指定' : 'ランダム';
  orderGroup.appendChild(createRadioGroup('orderMode', ['ランダム', '指定'], orderDefault));
  orderField.appendChild(orderLabel);
  orderField.appendChild(orderGroup);

  // 指定順 UI（セレクトボックス群）。orderMode==='指定' のときだけ表示。
  const specWrap = document.createElement('div');
  specWrap.className = 'home-order-spec';
  orderField.appendChild(specWrap);
  cpuForm.appendChild(orderField);

  // 指定順の現在状態（常に参加プレイヤーの順列を保つ）
  let specState: PlayerId[] = [];

  const playerDisplayLabel = (id: PlayerId): string => {
    const idx = PLAYER_IDS.indexOf(id);
    return idx === 0 ? 'あなた' : (CPU_NAMES[idx - 1] ?? id);
  };

  const readCpuCount = (): number => {
    const v = (countGroup.querySelector('input[name="cpuCount"]:checked') as HTMLInputElement | null)?.value ?? '1';
    return parseInt(v, 10) || 1;
  };

  const readOrderMode = (): PlayerOrderMode => {
    const v = (orderGroup.querySelector('input[name="orderMode"]:checked') as HTMLInputElement | null)?.value ?? 'ランダム';
    return v === '指定' ? 'fixed' : 'random';
  };

  // specState からセレクト群を描画（変更時はスワップで重複を防ぐ）
  const renderSpecSelects = (): void => {
    specWrap.innerHTML = '';
    const ids = PLAYER_IDS.slice(0, specState.length);
    specState.forEach((cur, slot) => {
      const row = document.createElement('div');
      row.className = 'home-order-row';
      const slotLbl = document.createElement('span');
      slotLbl.className = 'home-order-slot';
      slotLbl.textContent = `${slot + 1}番手`;
      const sel = document.createElement('select');
      sel.className = 'home-order-select';
      for (const id of ids) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = playerDisplayLabel(id);
        sel.appendChild(opt);
      }
      sel.value = cur;
      sel.addEventListener('change', () => {
        const picked = sel.value as PlayerId;
        const old = specState[slot]!;
        const conflict = specState.indexOf(picked);
        if (conflict !== -1 && conflict !== slot) {
          specState[conflict] = old; // 衝突相手に旧値を渡してスワップ（順列を維持）
        }
        specState[slot] = picked;
        renderSpecSelects();
      });
      row.appendChild(slotLbl);
      row.appendChild(sel);
      specWrap.appendChild(row);
    });
  };

  // CPU 人数に合わせて specState を初期化（前回 spec が人数一致なら流用）
  const rebuildSpec = (): void => {
    const total = readCpuCount() + 1;
    const ids = PLAYER_IDS.slice(0, total);
    let initial: PlayerId[] = [...ids];
    const last = lastConfig?.playerOrderSpec;
    if (last && last.length === total && last.every(p => ids.includes(p))
        && new Set(last).size === total) {
      initial = [...last];
    }
    specState = initial;
    renderSpecSelects();
  };

  const updateSpecVisibility = (): void => {
    specWrap.style.display = readOrderMode() === 'fixed' ? '' : 'none';
  };

  rebuildSpec();
  updateSpecVisibility();

  // CPU 人数変更時：存在しないCPUが順番に残らないよう再構築
  countGroup.addEventListener('change', () => { rebuildSpec(); });
  orderGroup.addEventListener('change', () => { updateSpecVisibility(); });

  const startBtn = document.createElement('button');
  startBtn.className = 'home-start-btn';
  startBtn.textContent = 'ゲーム開始';
  cpuForm.appendChild(startBtn);

  // ---- LAN対戦フォーム（同一LAN内の複数端末で人間対戦）。既定タブなので表示。----
  const onlineForm = document.createElement('div');
  onlineForm.className = 'home-form';
  // ロビーUIは専用モジュールが描画する（CPU対戦フォームには非干渉）。
  renderLanLobby(onlineForm, { onGameStart: onLanStart });

  card.appendChild(cpuForm);
  card.appendChild(onlineForm);
  screen.appendChild(card);

  // ---- ルール説明（折りたたみ。開始ボタンの下に置き、邪魔しない） ----
  screen.appendChild(buildRulePanel());

  // ---- サウンドテストパネル ----
  const soundPanel = buildSoundTestPanel();
  screen.appendChild(soundPanel);

  container.appendChild(screen);

  // ---- イベント ----

  tabCpu.addEventListener('click', () => {
    tabCpu.classList.add('active');
    tabOnline.classList.remove('active');
    cpuForm.style.display = '';
    onlineForm.style.display = 'none';
  });

  tabOnline.addEventListener('click', () => {
    tabOnline.classList.add('active');
    tabCpu.classList.remove('active');
    onlineForm.style.display = '';
    cpuForm.style.display = 'none';
  });

  startBtn.addEventListener('click', () => {
    // 未入力ならランダムなカタカナ名（機械的な「プレイヤー1」を避ける）。
    const name = nameInput.value.trim() || generateRandomPlayerName();
    savePlayerName(name);

    const countVal = (countGroup.querySelector('input[name="cpuCount"]:checked') as HTMLInputElement | null)?.value ?? '1';
    const cpuCount = (parseInt(countVal, 10) as 1 | 2 | 3) || 1;

    const diffVal = (diffGroup.querySelector('input[name="cpuDiff"]:checked') as HTMLInputElement | null)?.value ?? '普通';
    const diffMap: Record<string, AiDifficulty> = { '弱': 'weak', '普通': 'normal', '強': 'strong' };
    const cpuDifficulty: AiDifficulty = diffMap[diffVal] ?? 'normal';

    const speedVal = (speedGroup.querySelector('input[name="cpuSpeed"]:checked') as HTMLInputElement | null)?.value ?? '普通';
    const speedMap: Record<string, CpuSpeed> = { 'ゆっくり': 'slow', '普通': 'normal', '速い': 'fast', '最速': 'instant' };
    const cpuSpeed: CpuSpeed = speedMap[speedVal] ?? 'normal';

    // プレイヤー順設定を読み取る
    const orderMode = readOrderMode();
    const cfg: HomeConfig = { mode: 'cpu', playerName: name, cpuCount, cpuDifficulty, cpuSpeed, orderMode };
    // 指定順は現在の人数（cpuCount+1）に一致する specState のみ採用。
    // 食い違う場合は spec を渡さず initGameState 側で元順にフォールバック。
    if (orderMode === 'fixed' && specState.length === cpuCount + 1) {
      cfg.playerOrderSpec = [...specState];
    }

    onStart(cfg);
  });
}

// ルール説明の1セクション（見出し＋箇条書き）を生成
function ruleSection(heading: string, bullets: string[]): HTMLDivElement {
  const sec = document.createElement('div');
  sec.className = 'rule-section';
  const h = document.createElement('div');
  h.className = 'rule-heading';
  h.textContent = heading;
  sec.appendChild(h);
  const ul = document.createElement('ul');
  ul.className = 'rule-list';
  for (const b of bullets) {
    const li = document.createElement('li');
    li.textContent = b;
    ul.appendChild(li);
  }
  sec.appendChild(ul);
  return sec;
}

// TOPページのルール説明（折りたたみ式）
function buildRulePanel(): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'rule-panel';
  const summary = document.createElement('summary');
  summary.className = 'rule-summary';
  summary.textContent = '📖 はじめての人へ（ルール説明）';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'rule-body';
  const target = VP_TABLE.target;

  body.appendChild(ruleSection('🎯 目的', [
    `先に ${target} 点を取ったプレイヤーが勝ち。`,
    '開拓地・都市・最長交易路・最大騎士力・勝利点カードで点を集める。',
  ]));
  body.appendChild(ruleSection('🔁 ターンの流れ', [
    '① サイコロを振る',
    '② 出た数字のタイルから資源をもらう',
    '③ 交易・建設をする',
    '④ ターン終了',
  ]));
  body.appendChild(ruleSection('🌲 資源', [
    '木・レンガ・羊・麦・鉱石を集める。',
    'タイルの数字が出ると、隣に開拓地/都市を持つ人が資源を得る。',
    '開拓地は1個、都市は2個もらえる。',
  ]));
  body.appendChild(ruleSection('🏠 建設コスト', [
    '道：木＋レンガ',
    '開拓地：木＋レンガ＋羊＋麦',
    '都市：麦2＋鉱石3',
    '発展カード：羊＋麦＋鉱石',
  ]));
  body.appendChild(ruleSection('🦹 7と盗賊', [
    '7が出ると資源は出ない。',
    '手札8枚以上の人は半分捨てる。',
    '盗賊を動かして、隣接する相手から1枚奪える。',
    '盗賊がいるタイルからは資源が出ない。',
  ]));
  body.appendChild(ruleSection('🤝 交易', [
    '他プレイヤーと資源を交換できる。',
    '銀行（4:1）や港（3:1 / 2:1）とも交換できる。',
    '同じ資源同士の交換はできない。',
  ]));
  body.appendChild(ruleSection('🃏 発展カード', [
    '騎士・街道建設・年の豊穣（発見）・独占・勝利点カードがある。',
    'サイコロ前に使えるのは騎士だけ。他はサイコロ後に使う。',
    '勝利点カードは隠し点（自分だけ見える）。',
  ]));
  body.appendChild(ruleSection('🏆 点数', [
    '開拓地：1点 / 都市：2点',
    '最長交易路：2点（道5本以上で最長の人）',
    '最大騎士力：2点（騎士3回以上で最多の人）',
    '勝利点カード：1点',
  ]));
  body.appendChild(ruleSection('💡 操作のコツ', [
    '最初は資源が多く出そうな数字の近くに開拓地を置く。',
    '6・8は出やすい数字。',
    '港を使うと資源を交換しやすい。',
    '道を伸ばして開拓地を増やし、都市にすると資源が増える。',
  ]));

  details.appendChild(body);
  return details;
}

function buildSoundTestPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'sound-test-panel';

  const summary = document.createElement('details');
  const sumTitle = document.createElement('summary');
  sumTitle.className = 'sound-test-title';
  sumTitle.textContent = '🔊 サウンドテスト';
  summary.appendChild(sumTitle);

  // 音量・ミュート行
  const ctrlRow = document.createElement('div');
  ctrlRow.className = 'sound-test-ctrl';

  // BGM コントロール
  const bgmLbl = document.createElement('span');
  bgmLbl.textContent = 'BGM：';
  ctrlRow.appendChild(bgmLbl);

  const bgmBtn = document.createElement('button');
  bgmBtn.className = 'st-btn';
  bgmBtn.textContent = _bgmEnabled ? '▶ 停止' : '▶ 再生';
  bgmBtn.addEventListener('click', () => {
    _bgmEnabled = !_bgmEnabled;
    if (_bgmEnabled) bgmStart(); else bgmStop();
    bgmBtn.textContent = _bgmEnabled ? '■ 停止' : '▶ 再生';
  });
  ctrlRow.appendChild(bgmBtn);

  const bgmVolLbl = document.createElement('label');
  bgmVolLbl.textContent = ' 音量';
  const bgmVol = document.createElement('input');
  bgmVol.type = 'range'; bgmVol.min = '0'; bgmVol.max = '100';
  bgmVol.value = String(Math.round(_bgmVolume * 100));
  bgmVol.className = 'st-slider';
  bgmVol.addEventListener('input', () => bgmSetVolume(parseInt(bgmVol.value) / 100));
  bgmVolLbl.appendChild(bgmVol);
  ctrlRow.appendChild(bgmVolLbl);

  // SE コントロール
  const seLbl = document.createElement('span');
  seLbl.style.marginLeft = '16px';
  seLbl.textContent = 'SE：';
  ctrlRow.appendChild(seLbl);

  const seVolLbl = document.createElement('label');
  seVolLbl.textContent = '音量';
  const seVol = document.createElement('input');
  seVol.type = 'range'; seVol.min = '0'; seVol.max = '100';
  seVol.value = String(Math.round(_seVolume * 100));
  seVol.className = 'st-slider';
  seVol.addEventListener('input', () => { _seVolume = parseInt(seVol.value) / 100; });
  seVolLbl.appendChild(seVol);
  ctrlRow.appendChild(seVolLbl);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'st-btn';
  muteBtn.textContent = _seEnabled ? '🔔 ON' : '🔕 OFF';
  muteBtn.addEventListener('click', () => {
    _seEnabled = !_seEnabled;
    muteBtn.textContent = _seEnabled ? '🔔 ON' : '🔕 OFF';
  });
  ctrlRow.appendChild(muteBtn);

  summary.appendChild(ctrlRow);

  // SE テストボタン
  const seRow = document.createElement('div');
  seRow.className = 'sound-test-se-row';

  const seTests: Array<[SEType, string]> = [
    ['dice',     '🎲 ダイス'],
    ['build',    '🏠 建設'],
    ['resource', '🌲 資源獲得'],
    ['tradeOk',  '✓ 交易成立'],
    ['tradeNg',  '✗ 交易拒否'],
    ['devCard',  '🃏 発展カード'],
    ['robber',   '💀 盗賊'],
    ['turnStart','⏭ ターン開始'],
    ['victory',  '🏆 勝利'],
  ];

  for (const [seType, label] of seTests) {
    const btn = document.createElement('button');
    btn.className = 'st-se-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      _seCooldown.delete(seType); // クールダウンをリセットしてテスト再生
      playSE(seType);
    });
    seRow.appendChild(btn);
  }

  summary.appendChild(seRow);
  panel.appendChild(summary);
  return panel;
}

function createTab(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'home-tab' + (active ? ' active' : '');
  btn.textContent = label;
  return btn;
}

function createRadioGroup(name: string, options: string[], defaultVal: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  options.forEach(opt => {
    const wrapper = document.createElement('div');
    wrapper.className = 'home-radio-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = opt;
    input.id = `${name}_${opt}`;
    if (opt === defaultVal) input.checked = true;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = opt;
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    frag.appendChild(wrapper);
  });
  return frag;
}

// ============================================================
// GameState 初期化
// ============================================================

function initGameState(cfg: HomeConfig): GameState {
  const totalPlayers = cfg.cpuCount + 1;
  // プレイヤー実体（誰が人間/CPUか）は ID 固定で生成する。手番順とは独立。
  const specs: PlayerSpec[] = [];
  for (let i = 0; i < totalPlayers; i++) {
    const isHuman = i === 0;
    specs.push({
      id: PLAYER_IDS[i]!,
      color: PLAYER_COLORS[i]!,
      name: isHuman ? cfg.playerName : CPU_NAMES[i - 1]!,
      type: isHuman ? 'human' : 'ai',
      ...(isHuman ? {} : { aiDifficulty: cfg.cpuDifficulty }),
    });
  }
  // 手番順: ランダム=毎回シャッフル / 指定=spec を検証して採用（不整合なら元順）。
  return createInitialGameState(specs, cfg.orderMode, cfg.playerOrderSpec);
}

// ============================================================
// 有効配置ハイライト計算
// ============================================================

function computeHighlights(state: GameState, mode: BuildMode): BoardRenderOptions {
  const pid = state.playerOrder[state.currentPlayerIndex]!;
  const opts: BoardRenderOptions = {};

  if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
    if (state.setupSubPhase === 'PLACE_SETTLEMENT') {
      opts.validVertexIds = new Set(
        Object.keys(state.vertices).filter(vid => canBuildSettlement(state, pid, vid)),
      );
    } else if (state.setupSubPhase === 'PLACE_ROAD') {
      opts.validEdgeIds = new Set(
        Object.keys(state.edges).filter(eid => canBuildRoad(state, pid, eid)),
      );
    }
    return opts;
  }

  if (state.phase === 'MAIN') {
    if (state.turnPhase === 'ROBBER') {
      const robberTile = Object.values(state.tiles).find(t => t.hasRobber)?.id;
      opts.validTileIds = new Set(
        Object.keys(state.tiles).filter(tid => tid !== robberTile),
      );
      return opts;
    }

    if (state.turnPhase === 'TRADE_BUILD') {
      if (mode === 'road') {
        opts.validEdgeIds = new Set(
          Object.keys(state.edges).filter(eid => canBuildRoad(state, pid, eid)),
        );
      } else if (mode === 'settlement') {
        opts.validVertexIds = new Set(
          Object.keys(state.vertices).filter(vid => canBuildSettlement(state, pid, vid)),
        );
      } else if (mode === 'city') {
        opts.validVertexIds = new Set(
          Object.keys(state.vertices).filter(vid => canBuildCity(state, pid, vid)),
        );
      }
    }
  }

  return opts;
}

// ============================================================
// DOM 取得（モジュール起動時に一度だけ）
// ============================================================

const homeDiv   = document.getElementById('home')       as HTMLDivElement;
const gameTitle = document.getElementById('game-title') as HTMLHeadingElement;
const appDiv    = document.getElementById('app')        as HTMLDivElement;
const gameNav   = document.getElementById('game-nav')   as HTMLDivElement;
const svgBoard  = document.getElementById('board')      as unknown as SVGSVGElement;
const uiDiv     = document.getElementById('ui')         as HTMLDivElement;

if (!homeDiv || !gameTitle || !appDiv || !gameNav || !svgBoard || !uiDiv) {
  throw new Error('DOM elements not found');
}

// ============================================================
// アプリ状態
// ============================================================

let state!: GameState;
let buildMode: BuildMode = 'idle';
let uiPhase: UIPhase = { type: 'idle' };
let lastConfig: HomeConfig | null = null;

// ---- LAN対戦（サーバ権威）----
// netMode 時は state はサーバ配信のマスク済み state。CPU スケジューリングや
// ローカル applyAction は一切行わず、操作UIも出さない（MVP1-2: 情報表示のみ）。
let netMode = false;
let viewerPlayerId: PlayerId | null = null;
let lanClient: LanClient | null = null;

// AI タイムアウト世代管理（世代が変わった setTimeout は無視）
let gameGeneration = 0;

// このターンにCPUがプレイヤー間交易を提案済みか（連続提案防止）
let cpuPlayerTradeOfferedThisTurn = false;

// ダイスのロール演出中フラグ。演出中は新たなアクションを無視（多重ロール等を防止）。
let diceAnimating = false;

// 画面右上メニュー（ホーム/BGM/SE/CPU速度）の開閉状態
let gameMenuOpen = false;

// CPU手番の状況バナー（「今CPUが何をしているか」を上部中央に表示）
let cpuStatusActor = '';   // CPU名
let cpuStatusColor = '#aaa';
let cpuStatusMsg = '';     // 行動説明 or 「考え中…」

// 出目分布の集計（インデックス2〜12が出現回数。現在のゲーム中のみ蓄積）
let diceStats: number[] = new Array(13).fill(0);

// 人間向け: 他プレイヤーからの交易提案を自動拒否する設定（既定OFF）
let autoRejectTrades = false;
// 人間ターゲットの交易応答タイマー（自動拒否・20秒タイムアウト用）
let humanTradeTimer: ReturnType<typeof setTimeout> | null = null;

// 直近に実際に出た「CPU交易提案」のシグネチャ（1件だけ保持）。
// 完全一致する次のCPU提案だけを抑制する（ターンをまたいでも有効）。
// 人間→CPU提案・銀行交易には影響しない（CPU起案のみ記録）。
let lastCpuOfferSignature: string | null = null;

/**
 * CPU交易提案のシグネチャ（cpuPid + give内訳 + receive内訳）。
 * キー順に依存しないよう資源をソートして直列化する。
 */
function cpuOfferSignature(cpuPid: string, offer: TradeOffer): string {
  const ser = (h: Partial<ResourceHand>): string =>
    RESOURCE_TYPES.filter(r => (h[r] ?? 0) > 0)
      .map(r => `${r}:${h[r]}`)
      .join(',');
  return `${cpuPid}|give=${ser(offer.give)}|recv=${ser(offer.receive)}`;
}

// ============================================================
// 再描画
// ============================================================

function redraw(): void {
  if (!state) return;

  // DISCARD フェーズの uiPhase 自動同期。
  // LAN ではマスク済み state のため discardPid は「自分（8枚以上の場合）」に
  // 自然解決し、捨て札UIが各端末で自分の分だけ出る。
  if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
    const discardPid = state.playerOrder.find(p => {
      const h = state.players[p]!.hand;
      return RESOURCE_TYPES.reduce((s, r) => s + h[r], 0) >= 8;
    });
    if (discardPid && (uiPhase.type !== 'discard' || uiPhase.playerId !== discardPid)) {
      uiPhase = { type: 'discard', playerId: discardPid, selected: makeHand() };
    }
  } else if (uiPhase.type === 'discard') {
    uiPhase = { type: 'idle' };
  }

  if (state.turnPhase !== 'ROBBER' && uiPhase.type === 'robberTarget') {
    uiPhase = { type: 'idle' };
  }

  // LAN対戦: 操作UIは viewer の手番のみ有効化（lanMode）。建設ハイライトも
  // 自分の手番のときだけ出す。CPUスケジュール/ウォッチドッグは動かさない。
  if (netMode) {
    const myTurn = viewerPlayerId != null && viewerPlayerId === currentPid(state);
    const opts = myTurn ? computeHighlights(state, buildMode) : {};
    renderBoard(svgBoard, state, opts);
    renderUI(
      uiDiv, state, buildMode, setBuildMode, uiPhase, setUIPhase, dispatch,
      viewerPlayerId ?? undefined, /* lanMode */ true,
    );
    updateGameNav();
    updateLandscapeSheet();
    return;
  }

  const opts = computeHighlights(state, buildMode);
  renderBoard(svgBoard, state, opts);
  renderUI(uiDiv, state, buildMode, setBuildMode, uiPhase, setUIPhase, dispatch);
  updateGameNav();
  // CPUが責任を持つ場面ならフリーズ対策ウォッチドッグを再武装
  armCpuWatchdog();
  // CPU手番ステータスバナーの更新
  updateCpuStatusBanner();
  updateLandscapeSheet();
}

// ============================================================
// 横持ちスマホ: 操作パネルをボトムシート化（collapsed/expanded）
// ============================================================

// ユーザーが手動で開いた状態。交易依頼/捨て札中は強制で開く（mustAct）。
let landscapeSheetUserOpen = false;
let sheetHandleEl: HTMLButtonElement | null = null;

// 横持ちの操作対象プレイヤー（LAN=自分、ローカル=人間）。
function viewerForStatus(): PlayerId | null {
  if (netMode) return viewerPlayerId;
  return state.playerOrder.find(p => state.players[p]?.type === 'human') ?? null;
}

// ボトムシートのハンドルに出す短いステータス。alert=見逃すと困る（交易/捨て札）。
function computeSheetStatus(): { text: string; alert: boolean } {
  if (!state) return { text: '', alert: false };
  const viewer = viewerForStatus();
  const cur = state.playerOrder[state.currentPlayerIndex];
  const tr = state.pendingTrade;
  if (viewer && tr && tr.targetPlayerIds.includes(viewer) && !tr.responses[viewer]
      && (tr.state === 'TRADE_OFFER' || tr.state === 'TRADE_RESPONSE')) {
    return { text: '🤝 交易依頼！', alert: true };
  }
  if (viewer && state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
    const h = state.players[viewer]?.hand;
    const total = h ? RESOURCE_TYPES.reduce((s, r) => s + h[r], 0) : 0;
    if (total >= 8 && !(state.discardedThisRound ?? []).includes(viewer)) {
      return { text: '🗑 捨て札！', alert: true };
    }
  }
  if (viewer && cur === viewer) {
    if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
      return { text: state.setupSubPhase === 'PLACE_ROAD' ? '🛤 道を配置' : '🏠 開拓地を配置', alert: false };
    }
    if (state.turnPhase === 'PRE_ROLL') return { text: '🎲 ダイス', alert: false };
    if (state.turnPhase === 'ROBBER')   return { text: '🦹 盗賊', alert: false };
    if (state.turnPhase === 'TRADE_BUILD') {
      if (buildMode === 'road')       return { text: '🛤 道を配置', alert: false };
      if (buildMode === 'settlement') return { text: '🏠 開拓地を配置', alert: false };
      if (buildMode === 'city')       return { text: '🏙 都市を配置', alert: false };
      return { text: '🛠 建設・交易', alert: false };
    }
  }
  if (cur) {
    const p = state.players[cur];
    if (p?.type === 'ai') return { text: `🤖 ${p.name} 操作中`, alert: false };
    return { text: `⏳ ${p?.name ?? ''} の番`, alert: false };
  }
  return { text: '', alert: false };
}

// ハンドル更新＋開閉状態の反映（横持ち以外でも安全に呼べる：CSSが媒体で制御）。
function updateLandscapeSheet(): void {
  if (!sheetHandleEl) {
    sheetHandleEl = document.createElement('button');
    sheetHandleEl.id = 'ui-sheet-handle';
    sheetHandleEl.type = 'button';
    sheetHandleEl.addEventListener('click', () => {
      landscapeSheetUserOpen = !landscapeSheetUserOpen;
      updateLandscapeSheet();
    });
    appDiv.appendChild(sheetHandleEl);
  }
  if (!state) return;
  const st = computeSheetStatus();
  // 交易/捨て札は自動展開。建設モード中は盤面をタップさせたいので自動収納。
  const open = st.alert || (landscapeSheetUserOpen && buildMode === 'idle');
  document.body.classList.toggle('lsheet-open', open);
  sheetHandleEl.classList.toggle('alert', st.alert);
  const arrow = open ? '▼ 閉じる' : '▲ 操作';
  sheetHandleEl.textContent = `${st.text}　${arrow}`;
}

// ============================================================
// ゲームナビバー更新
// ============================================================

const CPU_SPEED_LABELS: Record<CpuSpeed, string> = {
  slow: 'ゆっくり', normal: '普通', fast: '速い', instant: '最速',
};

function updateGameNav(): void {
  gameNav.innerHTML = '';

  // ゲーム終了時のみ、主要アクション（再戦/ホーム）を見える位置に出す
  if (state.phase === 'GAME_OVER') {
    if (lastConfig) {
      const rematchBtn = document.createElement('button');
      rematchBtn.className = 'btn-nav btn-nav-primary';
      rematchBtn.textContent = 'もう一度プレイ';
      rematchBtn.addEventListener('click', () => { if (lastConfig) startGame(lastConfig); });
      gameNav.appendChild(rematchBtn);
    }
    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn-nav';
    homeBtn.textContent = '設定を変えてホームへ';
    homeBtn.addEventListener('click', returnToHome);
    gameNav.appendChild(homeBtn);
  }

  // 右上の「☰ メニュー」（補助操作をまとめてメイン操作の邪魔をしない）
  const menuBtn = document.createElement('button');
  menuBtn.className = 'menu-toggle';
  menuBtn.textContent = '☰ メニュー';
  menuBtn.setAttribute('aria-label', 'メニュー');
  const dd = document.createElement('div');
  dd.className = 'game-menu';
  dd.style.display = gameMenuOpen ? 'flex' : 'none';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    gameMenuOpen = !gameMenuOpen;
    dd.style.display = gameMenuOpen ? 'flex' : 'none';
  });
  dd.addEventListener('click', (e) => e.stopPropagation());

  // CPU 速度（ゲーム中に変更可能。次のCPU行動から反映）
  if (lastConfig) {
    const speedRow = document.createElement('div');
    speedRow.className = 'game-menu-row';
    const lbl = document.createElement('span');
    lbl.className = 'game-menu-label';
    lbl.textContent = 'CPU速度';
    const sel = document.createElement('select');
    sel.className = 'game-menu-select';
    (['slow', 'normal', 'fast', 'instant'] as CpuSpeed[]).forEach(sp => {
      const opt = document.createElement('option');
      opt.value = sp; opt.textContent = CPU_SPEED_LABELS[sp];
      if (lastConfig!.cpuSpeed === sp) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      if (lastConfig) lastConfig = { ...lastConfig, cpuSpeed: sel.value as CpuSpeed };
    });
    speedRow.append(lbl, sel);
    dd.appendChild(speedRow);
  }

  // BGM ON/OFF + 音量
  const bgmRow = document.createElement('div');
  bgmRow.className = 'game-menu-row';
  const bgmBtn = document.createElement('button');
  bgmBtn.className = 'game-menu-btn';
  bgmBtn.textContent = _bgmEnabled ? '🔊 BGM ON' : '🔇 BGM OFF';
  bgmBtn.addEventListener('click', () => {
    _bgmEnabled = !_bgmEnabled;
    if (_bgmEnabled) bgmStart(); else bgmStop();
    bgmBtn.textContent = _bgmEnabled ? '🔊 BGM ON' : '🔇 BGM OFF';
  });
  const volSlider = document.createElement('input');
  volSlider.type = 'range'; volSlider.min = '0'; volSlider.max = '100';
  volSlider.value = String(Math.round(_bgmVolume * 100));
  volSlider.className = 'bgm-volume';
  volSlider.title = 'BGM 音量';
  volSlider.addEventListener('input', () => bgmSetVolume(parseInt(volSlider.value) / 100));
  bgmRow.append(bgmBtn, volSlider);
  dd.appendChild(bgmRow);

  // SE ON/OFF
  const seBtn = document.createElement('button');
  seBtn.className = 'game-menu-btn';
  seBtn.textContent = _seEnabled ? '🔔 効果音 ON' : '🔕 効果音 OFF';
  seBtn.addEventListener('click', () => {
    _seEnabled = !_seEnabled;
    seBtn.textContent = _seEnabled ? '🔔 効果音 ON' : '🔕 効果音 OFF';
  });
  dd.appendChild(seBtn);

  // 出目分布グラフ
  const statsBtn = document.createElement('button');
  statsBtn.className = 'game-menu-btn';
  statsBtn.textContent = '🎲 出目分布';
  statsBtn.addEventListener('click', () => {
    gameMenuOpen = false;
    dd.style.display = 'none';
    showDiceStatsModal();
  });
  dd.appendChild(statsBtn);

  // 交易の自動拒否（人間向け。ONなら他プレイヤーからの提案を自動で拒否）
  const autoRejBtn = document.createElement('button');
  autoRejBtn.className = 'game-menu-btn';
  autoRejBtn.textContent = autoRejectTrades ? '🚫 交易を自動拒否 ON' : '🤝 交易を自動拒否 OFF';
  autoRejBtn.addEventListener('click', () => {
    autoRejectTrades = !autoRejectTrades;
    autoRejBtn.textContent = autoRejectTrades ? '🚫 交易を自動拒否 ON' : '🤝 交易を自動拒否 OFF';
    // ONにした瞬間、保留中の提案があれば適用する
    if (autoRejectTrades) scheduleHumanTradeAutoReject();
  });
  dd.appendChild(autoRejBtn);

  // ホームに戻る（誤クリック防止のため最下部・確認ダイアログ付き。ゲーム中のみ）
  if (state.phase !== 'GAME_OVER') {
    const homeBtn = document.createElement('button');
    homeBtn.className = 'game-menu-btn game-menu-danger';
    homeBtn.textContent = '🏠 ホームに戻る';
    homeBtn.addEventListener('click', () => {
      if (window.confirm('ホームに戻りますか？現在のゲームは終了します。')) returnToHome();
    });
    dd.appendChild(homeBtn);
  }

  const wrap = document.createElement('div');
  wrap.className = 'game-menu-wrap';
  wrap.append(menuBtn, dd);
  gameNav.appendChild(wrap);
}

// ============================================================
// BGM + SE（Web Audio API）
// ============================================================

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

// -------------------------------------------------------
// BGM: Cメジャーペンタトニックの穏やかなメロディ
// ドローンや不協和音を使わず、酒場風の明るい雰囲気
// -------------------------------------------------------
let _bgmEnabled  = false;
let _bgmVolume   = 0.07;  // かなり控えめ
let _bgmLoopId   = 0;
let _bgmOscs: OscillatorNode[] = [];

// C4/E4/G4/A4/C5: Cペンタトニックメジャー
// [freq_hz, dur_beats, vol_ratio]
const BEAT_SEC = 0.55;  // 約110 BPM
const BGM_SEQ: [number, number, number][] = [
  [261.6,1,0.8],[329.6,1,0.7],[392.0,1,0.8],[523.3,1,0.6],
  [440.0,1,0.7],[392.0,1,0.6],[329.6,2,0.5],
  [261.6,1,0.7],[349.2,1,0.6],[392.0,1,0.7],[349.2,1,0.5],
  [329.6,1,0.6],[293.7,1,0.5],[261.6,2,0.7],
  [392.0,1,0.6],[440.0,1,0.7],[523.3,1,0.8],[440.0,1,0.6],
  [392.0,1,0.6],[329.6,1,0.5],[261.6,3,0.4],
];
const BGM_TOTAL_BEATS = BGM_SEQ.reduce((s,[,b]) => s + b, 0);

function bgmStart(): void {
  if (!_bgmEnabled) return;
  bgmStop();
  const ctx = getAudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.value = _bgmVolume;
  masterGain.connect(ctx.destination);
  const loopId = ++_bgmLoopId;

  function scheduleLoop(startT: number) {
    if (_bgmLoopId !== loopId) return;
    let t = startT;
    for (const [freq, beats, volR] of BGM_SEQ) {
      const dur = beats * BEAT_SEC;
      // 主旋律: sine（澄んだ音）
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volR, t + 0.04);
      g.gain.setValueAtTime(volR, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur * 0.95);
      osc.connect(g); g.connect(masterGain);
      osc.start(t); osc.stop(t + dur);
      _bgmOscs.push(osc);
      // 低音ハーモニー: triangle（一オクターブ下、半音量）
      if (beats >= 2) {
        const bass = ctx.createOscillator();
        const bg = ctx.createGain();
        bass.type = 'triangle';
        bass.frequency.value = freq / 2;
        bg.gain.setValueAtTime(0, t);
        bg.gain.linearRampToValueAtTime(volR * 0.35, t + 0.08);
        bg.gain.linearRampToValueAtTime(0, t + dur * 0.8);
        bass.connect(bg); bg.connect(masterGain);
        bass.start(t); bass.stop(t + dur);
        _bgmOscs.push(bass);
      }
      t += dur;
    }
    // 1ループ後に再スケジュール
    const loopDur = BGM_TOTAL_BEATS * BEAT_SEC;
    setTimeout(() => scheduleLoop(ctx.currentTime + 0.05), (loopDur - 0.5) * 1000);
  }
  scheduleLoop(ctx.currentTime + 0.1);
}

function bgmStop(): void {
  _bgmLoopId++;
  _bgmOscs.forEach(o => { try { o.stop(); } catch { /**/ } });
  _bgmOscs = [];
}

function bgmSetVolume(v: number): void {
  _bgmVolume = v;
}

// -------------------------------------------------------
// SE: 短くシンプル、連打・鳴りすぎ防止付き
// -------------------------------------------------------
let _seEnabled = true;
let _seVolume  = 0.28;
const _seCooldown = new Map<string, number>();  // SE種別 → 最後に鳴らした時刻(ms)
const SE_MIN_INTERVAL: Record<string, number> = {
  resource: 80,   // 資源獲得は連続OK（少しずらす）
  click:    150,
  discardLose: 250, // 連続で捨てる場合にうるさくならないよう少し間隔を空ける
  default:  200,
};

export type SEType = 'click'|'dice'|'resource'|'build'|'tradeOk'|'tradeNg'|'devCard'|'robber'|'turnStart'|'victory'
  |'sevenRoll'|'discardWarn'|'discardLose';

function playSE(type: SEType): void {
  if (!_seEnabled) return;
  const now = Date.now();
  const minInterval = SE_MIN_INTERVAL[type] ?? SE_MIN_INTERVAL['default'] ?? 200;
  const last = _seCooldown.get(type) ?? 0;
  if (now - last < minInterval) return;  // 間隔が短すぎる場合はスキップ
  _seCooldown.set(type, now);

  try {
    const ctx = getAudioCtx();
    const mg = ctx.createGain();
    mg.gain.value = _seVolume;
    mg.connect(ctx.destination);
    const t = ctx.currentTime;

    // ノート1個ヘルパー（attack/decay を柔らかく）
    function note(freq: number, dur: number, tp: OscillatorType = 'sine', vol = 1, delay = 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = tp; osc.frequency.value = freq;
      const s = t + delay;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + Math.min(0.03, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.001, s + dur);
      osc.connect(g); g.connect(mg);
      osc.start(s); osc.stop(s + dur + 0.01);
    }

    switch (type) {
      case 'click':
        note(900, 0.05, 'sine', 0.5);
        break;
      case 'dice':
        note(320, 0.07, 'triangle', 0.6, 0.00);
        note(420, 0.07, 'triangle', 0.5, 0.04);
        note(520, 0.10, 'triangle', 0.4, 0.08);
        break;
      case 'resource':
        note(660, 0.12, 'sine', 0.4);
        note(880, 0.10, 'sine', 0.25, 0.05);
        break;
      case 'build':
        note(440, 0.10, 'triangle', 0.55);
        note(554, 0.15, 'triangle', 0.45, 0.07);
        break;
      case 'tradeOk':
        note(523, 0.10, 'sine', 0.5, 0.00);
        note(659, 0.10, 'sine', 0.5, 0.10);
        note(784, 0.18, 'sine', 0.5, 0.20);
        break;
      case 'tradeNg':
        note(350, 0.12, 'triangle', 0.45, 0.00);
        note(280, 0.16, 'triangle', 0.35, 0.08);
        break;
      case 'devCard':
        note(587, 0.10, 'sine', 0.45, 0.00);
        note(740, 0.12, 'sine', 0.40, 0.08);
        break;
      case 'robber':
        note(220, 0.12, 'triangle', 0.5, 0.00);
        note(196, 0.20, 'triangle', 0.4, 0.10);
        break;
      case 'turnStart':
        note(523, 0.10, 'sine', 0.35);
        break;
      case 'victory': {
        // 明るいファンファーレ（上昇アルペジオ → 高音で締め）
        [523, 659, 784, 1047].forEach((f, i) => note(f, 0.32, 'triangle', 0.5, i * 0.10));
        // 締めの和音（C メジャー）
        [1047, 1319, 1568].forEach(f => note(f, 0.7, 'triangle', 0.38, 0.46));
        note(2093, 0.5, 'sine', 0.22, 0.5);
        break;
      }
      case 'sevenRoll':
        // 7（盗賊）: 少し不穏な下降音
        note(240, 0.18, 'sawtooth', 0.4, 0.00);
        note(180, 0.28, 'sawtooth', 0.32, 0.12);
        break;
      case 'discardWarn':
        // 捨て札警告: 短い2音の注意音
        note(466, 0.10, 'square', 0.3, 0.00);
        note(349, 0.16, 'square', 0.26, 0.10);
        break;
      case 'discardLose':
        // 資源を失う: 短い下降音（控えめ）
        note(392, 0.10, 'triangle', 0.38, 0.00);
        note(294, 0.16, 'triangle', 0.30, 0.07);
        break;
    }
  } catch { /* ignore */ }
}

// ============================================================
// ディスパッチ
// ============================================================

const RESET_UIPHASE_ACTIONS = new Set([
  'DISCARD_RESOURCES', 'MOVE_ROBBER', 'BANK_TRADE',
  'PLAY_KNIGHT', 'PLAY_YEAR_OF_PLENTY', 'PLAY_MONOPOLY', 'PLAY_ROAD_BUILDING',
  'FINISH_ROAD_BUILDING', 'END_TURN', 'DECLARE_VICTORY',
  'OFFER_TRADE', 'CONFIRM_TRADE', 'CANCEL_TRADE',
]);

// CPU行動の待ち時間(ms)。初見でもCPUの動きを追える速度を基準に再調整。
//  ゆっくり: 現行ゆっくり(1200)よりさらに遅く（じっくり観戦向け）
//  普通(既定): 現行「ゆっくり」相当＝CPUの建設/交易/盗賊/捨て札を目で追える
//  速い: 現行「普通〜速い」相当でテンポ重視
//  最速: 動作確認用の最速
const CPU_SPEED_MS: Record<CpuSpeed, number> = { slow: 2200, normal: 1200, fast: 350, instant: 30 };
function aiDelayMs(): number {
  return CPU_SPEED_MS[lastConfig?.cpuSpeed ?? 'normal'];
}

/** 人間が交易提案した後、CPU ターゲットを自動応答させる */
function scheduleCpuTradeResponse(): void {
  if (!state) return;
  const trade = state.pendingTrade;
  if (!trade || trade.state !== 'TRADE_OFFER') return;

  const pending = trade.targetPlayerIds.find(t => !trade.responses[t]);
  if (!pending || state.players[pending]?.type !== 'ai') return;

  const gen = gameGeneration;
  setTimeout(() => {
    if (gen !== gameGeneration) return;
    const cur = state.pendingTrade;
    if (!cur || cur.state !== 'TRADE_OFFER') return;
    const stillPending = cur.targetPlayerIds.find(t => !cur.responses[t]);
    if (stillPending !== pending) return;

    const cpuPlayer = state.players[pending];
    const canAfford = RESOURCE_TYPES.every((r: ResourceType) =>
      (cpuPlayer?.hand[r] ?? 0) >= (cur.offer.receive[r] ?? 0),
    );
    // CPU は資源があれば 60% の確率で承諾
    const accepts = canAfford && Math.random() < 0.6;
    if (!accepts) {
      const reason = !canAfford ? '資源不足' : '気が乗らない';
      console.log(`[交易] ${state.players[pending]?.name} が拒否（理由: ${reason}）`);
    }
    dispatch({ type: 'RESPOND_TRADE', response: { playerId: pending as PlayerId, status: accepts ? 'ACCEPT' : 'REJECT' } });
  }, aiDelayMs());
}

/**
 * CPUが交易を起案した後、人間が応答したら CPU として自動的に確認/キャンセルする。
 * TRADE_RESPONSE 状態かつ initiator が AI の場合のみ動作する。
 */
function scheduleCpuInitiatorConfirm(): void {
  if (!state) return;
  const trade = state.pendingTrade;
  if (!trade || trade.state !== 'TRADE_RESPONSE') return;
  if (state.players[trade.initiatorId]?.type !== 'ai') return;

  const gen = gameGeneration;
  setTimeout(() => {
    if (gen !== gameGeneration) return;
    const cur = state.pendingTrade;
    if (!cur || cur.state !== 'TRADE_RESPONSE') return;
    if (state.players[cur.initiatorId]?.type !== 'ai') return;

    const acceptor = cur.targetPlayerIds.find(
      t => cur.responses[t]?.status === 'ACCEPT',
    ) as PlayerId | undefined;
    if (acceptor) {
      dispatch({ type: 'CONFIRM_TRADE', responderId: acceptor });
    } else {
      dispatch({ type: 'CANCEL_TRADE' });
    }
  }, aiDelayMs());
}

/**
 * 人間がターゲットの交易提案に対する自動拒否/タイムアウト拒否をスケジュールする。
 * - 自動拒否ON → すぐ拒否
 * - 提案された資源を持っていない → 約2秒で拒否
 * - 20秒無反応 → タイムアウト拒否
 * 人間が手動で応答すれば（responses に入る）発火しない。
 */
function scheduleHumanTradeAutoReject(): void {
  if (humanTradeTimer) { clearTimeout(humanTradeTimer); humanTradeTimer = null; }
  if (!state) return;
  const trade = state.pendingTrade;
  if (!trade || trade.state !== 'TRADE_OFFER') return;
  if (state.players[trade.initiatorId]?.type !== 'ai') return; // CPU起案のみ対象
  const humanTarget = trade.targetPlayerIds.find(
    t => !trade.responses[t] && state.players[t]?.type === 'human',
  );
  if (!humanTarget) return;

  const human = state.players[humanTarget]!;
  const canAfford = RESOURCE_TYPES.every(r => (human.hand[r] ?? 0) >= (trade.offer.receive[r] ?? 0));

  let delay: number; let timeout = false;
  if (autoRejectTrades) delay = 600;            // 自動拒否設定ON
  else if (!canAfford) delay = 2000;            // 渡せる資源がない → 短時間で拒否
  else { delay = 20000; timeout = true; }       // 20秒無反応で自動拒否

  const gen = gameGeneration;
  humanTradeTimer = setTimeout(() => {
    humanTradeTimer = null;
    if (gen !== gameGeneration) return;
    const cur = state.pendingTrade;
    if (!cur || cur.state !== 'TRADE_OFFER') return;
    if (cur.responses[humanTarget]) return;     // 既に人間が応答済み
    appendSystemLog(timeout ? '⏱ 20秒経過のため自動拒否' : `🤝 ${human.name} は交換を拒否`);
    dispatch({ type: 'RESPOND_TRADE', response: { playerId: humanTarget, status: 'REJECT' } });
  }, delay);
}

function scheduleAiTurn(): void {
  if (!state || state.phase === 'GAME_OVER') return;

  const gen = gameGeneration;

  if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
    const discardPid = state.playerOrder.find(pid => {
      if (state.players[pid]?.type !== 'ai') return false;
      const h = state.players[pid]!.hand;
      return RESOURCE_TYPES.reduce((s, r) => s + h[r], 0) >= 8;
    });
    if (discardPid) {
      setCpuThinking(discardPid); updateCpuStatusBanner();
      setTimeout(() => {
        if (gen !== gameGeneration) return;
        runCpuStep(discardPid, {});
      }, aiDelayMs());
    }
    return;
  }

  const pid = state.playerOrder[state.currentPlayerIndex]!;
  if (state.players[pid]?.type === 'ai') {
    const aiOpts: AiOpts = { skipPlayerTrade: cpuPlayerTradeOfferedThisTurn };
    setCpuThinking(pid); updateCpuStatusBanner();
    setTimeout(() => {
      if (gen !== gameGeneration) return;
      runCpuStep(pid, aiOpts);
    }, aiDelayMs());
  }
}

// CPUの1手を「例外やnullでも止まらない」ように実行する。
function runCpuStep(pid: PlayerId, aiOpts: AiOpts): void {
  try {
    let action = chooseAction(state, pid, aiOpts);
    // 直近と完全一致するCPU交易提案は抑制し、交易抜きで選び直す。
    if (action?.type === 'OFFER_TRADE'
        && cpuOfferSignature(pid, action.offer) === lastCpuOfferSignature) {
      action = chooseAction(state, pid, { ...aiOpts, skipPlayerTrade: true });
    }
    if (!action) action = safeFallbackAction();
    if (action) dispatch(action);
  } catch (err) {
    console.warn('CPU処理に失敗したためフォールバックします', err);
    const fb = safeFallbackAction();
    if (fb) { try { dispatch(fb); } catch (e) { console.warn('fallback failed', e); } }
  }
}

// ============================================================
// CPUフリーズ対策（ウォッチドッグ）: 一定時間 CPU が進めない場合に
// 合法な安全行動を自動実行して進行不能を防ぐ。ゲームロジックは変えない。
// ============================================================

let cpuWatchdog: ReturnType<typeof setTimeout> | null = null;
const WATCHDOG_MS = 8000;

/** 次に動く責任が CPU 側にあるか（人間の番なら待つので false） */
function cpuIsResponsible(): boolean {
  if (!state || state.phase === 'GAME_OVER') return false;
  const t = state.pendingTrade;
  if (t) {
    if (t.state === 'TRADE_OFFER') {
      const pending = t.targetPlayerIds.find(x => !t.responses[x]);
      return !!pending && state.players[pending]?.type === 'ai';
    }
    if (t.state === 'TRADE_RESPONSE') return state.players[t.initiatorId]?.type === 'ai';
    return false;
  }
  if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
    return state.playerOrder.some(p => state.players[p]?.type === 'ai'
      && RESOURCE_TYPES.reduce((s, r) => s + state.players[p]!.hand[r], 0) >= 8);
  }
  const cur = state.playerOrder[state.currentPlayerIndex];
  return !!cur && state.players[cur]?.type === 'ai';
}

/** 進行が止まっていないか判定するためのトークン */
function progressToken(): string {
  if (!state) return '';
  const t = state.pendingTrade;
  return `${state.globalTurnNumber}|${state.currentPlayerIndex}|${state.turnPhase}|${state.phase}|${t ? t.state + ':' + Object.keys(t.responses).length : '-'}|${state.log.length}`;
}

/** ウォッチドッグを再武装（CPU責任時のみ）。redraw のたびに呼ぶ。 */
function armCpuWatchdog(): void {
  if (cpuWatchdog) { clearTimeout(cpuWatchdog); cpuWatchdog = null; }
  if (!cpuIsResponsible()) return;
  const token = progressToken();
  const gen = gameGeneration;
  cpuWatchdog = setTimeout(() => {
    cpuWatchdog = null;
    if (gen !== gameGeneration) return;
    if (diceAnimating) { armCpuWatchdog(); return; }      // 演出中は待つ
    if (!cpuIsResponsible()) return;                      // 人間の番になっていれば何もしない
    if (progressToken() !== token) { armCpuWatchdog(); return; } // 進んでいれば再武装
    // 一定時間進まなかった → 合法な安全行動で進める
    const fb = safeFallbackAction();
    if (fb) {
      appendSystemLog('CPU処理をスキップしました');
      try { dispatch(fb); } catch (e) { console.warn('watchdog fallback failed', e); }
    }
  }, WATCHDOG_MS);
}

/** どのフェーズでも「合法で進行する」行動を1つ返す（最終手段）。 */
function safeFallbackAction(): Action | null {
  if (!state || state.phase === 'GAME_OVER') return null;
  const trade = state.pendingTrade;
  if (trade) {
    if (trade.state === 'TRADE_OFFER') {
      const pending = trade.targetPlayerIds.find(t => !trade.responses[t]);
      if (pending && state.players[pending]?.type === 'ai') {
        return { type: 'RESPOND_TRADE', response: { playerId: pending, status: 'REJECT' } };
      }
    } else if (trade.state === 'TRADE_RESPONSE' && state.players[trade.initiatorId]?.type === 'ai') {
      const acc = trade.targetPlayerIds.find(t => trade.responses[t]?.status === 'ACCEPT') as PlayerId | undefined;
      return acc ? { type: 'CONFIRM_TRADE', responderId: acc } : { type: 'CANCEL_TRADE' };
    }
    return null;
  }
  // 捨て札（CPUが対象のとき、大きい山から半数を捨てる）
  if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
    const dpid = state.playerOrder.find(p => state.players[p]?.type === 'ai'
      && RESOURCE_TYPES.reduce((s, r) => s + state.players[p]!.hand[r], 0) >= 8);
    if (dpid) {
      const hand = state.players[dpid]!.hand;
      let toDiscard = Math.floor(RESOURCE_TYPES.reduce((s, r) => s + hand[r], 0) / 2);
      const resources: Partial<ResourceHand> = {};
      for (const r of [...RESOURCE_TYPES].sort((a, b) => hand[b] - hand[a])) {
        if (toDiscard <= 0) break;
        const take = Math.min(hand[r], toDiscard);
        if (take > 0) { resources[r] = take; toDiscard -= take; }
      }
      return { type: 'DISCARD_RESOURCES', playerId: dpid, resources };
    }
    return null;
  }
  const cur = state.playerOrder[state.currentPlayerIndex];
  if (!cur || state.players[cur]?.type !== 'ai') return null; // 人間の番は強制しない
  if (state.turnPhase === 'ROBBER') {
    const robberTile = Object.values(state.tiles).find(t => t.hasRobber)?.id;
    const tileId = Object.keys(state.tiles).find(t => t !== robberTile);
    if (tileId) return { type: 'MOVE_ROBBER', tileId, stealFromPlayerId: null };
    return null;
  }
  if (state.turnPhase === 'PRE_ROLL') return { type: 'ROLL_DICE' };
  if (state.turnPhase === 'TRADE_BUILD') return { type: 'END_TURN' };
  return null;
}

/** システムログを1件追記（公開情報のみ・CPU内部は出さない）。 */
function appendSystemLog(message: string): void {
  if (!state) return;
  const entry = { turn: state.globalTurnNumber, playerId: (state.playerOrder[state.currentPlayerIndex] ?? 'player1') as PlayerId, type: 'SYSTEM' as const, message };
  state = { ...state, log: [...state.log, entry].slice(-MAX_LOG_ENTRIES) };
}

/**
 * 資源獲得アニメーション
 * origin: 画面座標（起点タイル中心など）。省略時はボードの中央。
 */
// 1個のアイコンを起点→対象パネルへ飛ばす。
const RES_FLY_MS = 1300;       // 飛行時間（ゆっくり）
const RES_FLY_STAGGER = 300;   // アイコン1個ずつの間隔（0.3秒）
function spawnResFlyer(
  glyph: string,
  panelEl: HTMLElement,
  origin: { x: number; y: number },
  delay: number,
): void {
  setTimeout(() => {
    const span = document.createElement('span');
    span.className = 'res-fly';
    span.textContent = glyph;
    // 起点位置をセット（絶対座標）
    span.style.left = `${origin.x}px`;
    span.style.top  = `${origin.y}px`;
    // 終点位置（対象プレイヤーパネル中央）をCSS変数でセット
    const pr = panelEl.getBoundingClientRect();
    const tx = pr.left + pr.width / 2 - origin.x;
    const ty = pr.top  + pr.height / 2 - origin.y;
    span.style.setProperty('--tx', `${tx}px`);
    span.style.setProperty('--ty', `${ty}px`);
    document.body.appendChild(span);
    requestAnimationFrame(() => requestAnimationFrame(() => { span.classList.add('fly-in'); }));
    setTimeout(() => { span.remove(); playSE('resource'); }, RES_FLY_MS);
  }, delay);
}

/** タイルの画面中心座標を返す */
function tileScreenCenter(tileId: string): { x: number; y: number } | null {
  const boardEl = document.getElementById('board');
  const g = boardEl?.querySelector(`[data-tile-id="${tileId}"]`) as SVGGElement | null;
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 盗賊が移動元→移動先へスライドする演出。移動先で着地ハイライト。 */
function animateRobberMove(fromTileId: string, toTileId: string): void {
  if (lastConfig?.cpuSpeed === 'instant' || fromTileId === toTileId) return;
  const from = tileScreenCenter(fromTileId);
  const to = tileScreenCenter(toTileId);
  if (!from || !to) return;
  const boardArea = document.getElementById('board-area');
  boardArea?.classList.add('robber-sliding'); // スライド中は静的コマを隠す（二重表示防止）

  const fly = document.createElement('div');
  fly.className = 'robber-fly';
  fly.textContent = '🦹';
  fly.style.left = `${from.x}px`;
  fly.style.top  = `${from.y}px`;
  fly.style.setProperty('--tx', `${to.x - from.x}px`);
  fly.style.setProperty('--ty', `${to.y - from.y}px`);
  document.body.appendChild(fly);
  requestAnimationFrame(() => requestAnimationFrame(() => fly.classList.add('go')));

  setTimeout(() => {
    fly.remove();
    boardArea?.classList.remove('robber-sliding');
    const robber = document.querySelector('#board .robber') as SVGGElement | null;
    if (robber) {
      robber.classList.add('robber-landed');
      setTimeout(() => robber.classList.remove('robber-landed'), 650);
    }
  }, 560);
}

// ============================================================
// 勝利演出（派手な勝利モーダル＋紙吹雪）
// ============================================================

const PLAYER_HEX: Record<string, string> = {
  player1: '#e03030', player2: '#3060e0', player3: '#a855f7', player4: '#f0a020',
};
const CONFETTI_COLORS = ['#ffd700', '#ff5b5b', '#5ba8f5', '#a855f7', '#f0a020', '#7aee40', '#ffffff'];
// 勝利を確定させたアクションから勝因を推定（不明なら「10点到達」）
const VICTORY_REASON: Record<string, string> = {
  BUILD_CITY:       '都市建設で勝利！',
  BUILD_SETTLEMENT: '開拓地建設で勝利！',
  PLAY_KNIGHT:      '最大騎士力で勝利！',
  BUILD_ROAD:       '最長交易路で勝利！',
  BUY_DEV_CARD:     '勝利点カードで勝利！',
};

function showVictoryOverlay(winnerId: PlayerId, causeAction: string): void {
  document.querySelector('.victory-overlay')?.remove(); document.querySelector('.dicestats-overlay')?.remove(); document.getElementById('cpu-status')?.remove();
  if (!state) return;
  const winner = state.players[winnerId];
  if (!winner) return;
  const color = PLAYER_HEX[winnerId] ?? '#ffd700';
  const vp = calcVP(state, winnerId);
  const isHuman = winner.type === 'human';
  const reason = VICTORY_REASON[causeAction] ?? '10点到達で勝利！';

  const overlay = document.createElement('div');
  overlay.className = 'victory-overlay';
  overlay.style.setProperty('--win-color', color);

  // 紙吹雪
  const confetti = document.createElement('div');
  confetti.className = 'confetti';
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!;
    piece.style.animationDelay = `${Math.random() * 0.9}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    confetti.appendChild(piece);
  }
  overlay.appendChild(confetti);

  // モーダル
  const modal = document.createElement('div');
  modal.className = 'victory-modal';
  modal.style.borderColor = color;

  const trophy = document.createElement('div');
  trophy.className = 'victory-trophy';
  trophy.textContent = isHuman ? '🎉🏆🎉' : '🏆';
  modal.appendChild(trophy);

  const dot = document.createElement('span'); dot.className = 'victory-dot'; dot.style.background = color;
  const nameEl = document.createElement('div');
  nameEl.className = 'victory-name';
  nameEl.style.color = color;
  nameEl.append(dot, document.createTextNode(`${winner.name} 勝利！`));
  modal.appendChild(nameEl);

  const vpEl = document.createElement('div');
  vpEl.className = 'victory-vp';
  vpEl.textContent = `★ ${vp}点 到達`;
  modal.appendChild(vpEl);

  const reasonEl = document.createElement('div');
  reasonEl.className = 'victory-reason';
  reasonEl.textContent = reason;
  modal.appendChild(reasonEl);

  const btnRow = document.createElement('div');
  btnRow.className = 'victory-btns';
  if (lastConfig) {
    const again = document.createElement('button');
    again.className = 'btn-nav btn-nav-primary';
    again.textContent = '🔄 もう一度遊ぶ';
    again.addEventListener('click', () => { overlay.remove(); if (lastConfig) startGame(lastConfig); });
    btnRow.appendChild(again);
  }
  const home = document.createElement('button');
  home.className = 'btn-nav';
  home.textContent = '🏠 ホームに戻る';
  home.addEventListener('click', () => { overlay.remove(); returnToHome(); });
  btnRow.appendChild(home);
  // 勝利後でもこのゲームの出目分布を見られるように
  const statsBtn = document.createElement('button');
  statsBtn.className = 'btn-nav';
  statsBtn.textContent = '🎲 出目分布';
  statsBtn.addEventListener('click', () => showDiceStatsModal());
  btnRow.appendChild(statsBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // 勝者パネルの発光は buildPlayerPanel 側で付与（再描画後も維持される）
}

// ============================================================
// 出目分布グラフ（現在ゲームのダイス集計を簡易棒グラフで表示）
// ============================================================

function showDiceStatsModal(): void {
  document.querySelector('.dicestats-overlay')?.remove();

  const total = diceStats.reduce((s, n) => s + n, 0);
  const maxCount = Math.max(1, ...diceStats.slice(2, 13));
  let mostFreq = 0, mostFreqCount = -1;
  for (let n = 2; n <= 12; n++) {
    if ((diceStats[n] ?? 0) > mostFreqCount) { mostFreqCount = diceStats[n] ?? 0; mostFreq = n; }
  }

  const overlay = document.createElement('div');
  overlay.className = 'dicestats-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const modal = document.createElement('div');
  modal.className = 'dicestats-modal';

  const header = document.createElement('div');
  header.className = 'dicestats-header';
  header.textContent = '🎲 出目分布（このゲーム）';
  modal.appendChild(header);

  const summary = document.createElement('div');
  summary.className = 'dicestats-summary';
  summary.textContent = total === 0
    ? 'まだダイスを振っていません'
    : `合計 ${total} 回 ・ 最多 ${mostFreq}（${mostFreqCount}回） ・ 7は ${diceStats[7] ?? 0}回`;
  modal.appendChild(summary);

  const chart = document.createElement('div');
  chart.className = 'dicestats-chart';
  for (let n = 2; n <= 12; n++) {
    const count = diceStats[n] ?? 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const row = document.createElement('div');
    row.className = `dicestats-row${n === 7 ? ' seven' : ''}${n === mostFreq && count > 0 ? ' most' : ''}`;
    const label = document.createElement('span'); label.className = 'dicestats-num'; label.textContent = String(n);
    const track = document.createElement('div'); track.className = 'dicestats-track';
    const bar = document.createElement('div'); bar.className = 'dicestats-bar';
    // 0回は空、1回以上は見やすい最小幅を確保
    bar.style.width = count > 0 ? `${Math.max(5, Math.round((count / maxCount) * 100))}%` : '0';
    track.appendChild(bar);
    const val = document.createElement('span'); val.className = 'dicestats-val';
    val.textContent = total > 0 ? `${count}回 (${pct}%)` : `${count}回`;
    row.append(label, track, val);
    chart.appendChild(row);
  }
  modal.appendChild(chart);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-nav';
  closeBtn.textContent = '閉じる';
  closeBtn.addEventListener('click', () => overlay.remove());
  const btnRow = document.createElement('div');
  btnRow.className = 'dicestats-btns';
  btnRow.appendChild(closeBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ============================================================
// CPU手番ステータスバナー（「今CPUが何をしているか」を上部中央に表示）
// ============================================================

const CPU_ACTION_DESC: Record<string, string> = {
  ROLL_DICE:            '🎲 ダイスを振った',
  BUILD_ROAD:           '🛤 道を建設',
  BUILD_SETTLEMENT:     '🏠 開拓地を建設',
  BUILD_CITY:           '🏙 都市を建設',
  BUY_DEV_CARD:         '🃏 発展カードを購入',
  PLAY_KNIGHT:          '⚔ 騎士を使用',
  PLAY_ROAD_BUILDING:   '🛤 街道建設カードを使用',
  PLAY_YEAR_OF_PLENTY:  '🌾 年の豊穣を使用',
  PLAY_MONOPOLY:        '🏛 独占を使用',
  MOVE_ROBBER:          '🦹 盗賊を移動',
  BANK_TRADE:           '💱 銀行と交易',
  OFFER_TRADE:          '🤝 交易を提案',
  CONFIRM_TRADE:        '🤝 交易を成立',
  CANCEL_TRADE:         '🤝 交易を取り下げ',
  DISCARD_RESOURCES:    '🗑 手札を捨てた',
  END_TURN:             '↩ ターンを終了',
};

/** CPUが行ったアクションからステータスバナーの文言を設定する（actorがCPUの時のみ） */
function setCpuStatusFromAction(action: Action, prevState: GameState): void {
  let actorId: string = prevState.playerOrder[prevState.currentPlayerIndex] ?? '';
  if (action.type === 'DISCARD_RESOURCES') actorId = action.playerId;
  else if (action.type === 'RESPOND_TRADE') actorId = action.response.playerId;
  const actor = prevState.players[actorId] ?? state.players[actorId];
  if (actor?.type !== 'ai') return;
  cpuStatusActor = actor.name;
  cpuStatusColor = PLAYER_HEX[actorId] ?? '#aaa';
  if (action.type === 'RESPOND_TRADE') {
    cpuStatusMsg = action.response.status === 'ACCEPT' ? '🤝 交易を承諾' : '🤝 交易を拒否';
  } else {
    cpuStatusMsg = CPU_ACTION_DESC[action.type] ?? '';
  }
}

/** 「考え中…」状態をセット（次のCPU行動を待っている間） */
function setCpuThinking(actorId: string): void {
  const actor = state.players[actorId];
  if (!actor) return;
  cpuStatusActor = actor.name;
  cpuStatusColor = PLAYER_HEX[actorId] ?? '#aaa';
  cpuStatusMsg = '考え中…';
}

/** CPUが責任を持つ場面なら上部中央にステータスバナーを表示。人間の番では消す。 */
function updateCpuStatusBanner(): void {
  const existing = document.getElementById('cpu-status');
  const show = !!state && state.phase !== 'GAME_OVER' && cpuIsResponsible() && !!cpuStatusActor;
  if (!show) { existing?.remove(); return; }
  let banner = existing as HTMLDivElement | null;
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'cpu-status';
    banner.className = 'cpu-status-banner';
    document.body.appendChild(banner);
  }
  banner.style.borderColor = cpuStatusColor;
  banner.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'cpu-status-dot';
  dot.style.background = cpuStatusColor;
  const robot = document.createElement('span'); robot.textContent = '🤖';
  const name = document.createElement('span'); name.className = 'cpu-status-name'; name.textContent = cpuStatusActor;
  const msg = document.createElement('span');
  msg.className = cpuStatusMsg === '考え中…' ? 'cpu-status-msg thinking' : 'cpu-status-msg';
  msg.textContent = cpuStatusMsg;
  banner.append(robot, dot, name, msg);
}

/** サイコロ産出タイルの画面座標を取得する */
function getProducingTileOrigin(diceTotal: number): { x: number; y: number } | null {
  const boardEl = document.getElementById('board') as SVGSVGElement | null;
  if (!boardEl) return null;
  const boardRect = boardEl.getBoundingClientRect();
  // state から diceTotal に対応するタイルを探す
  const producingTiles = Object.values(state.tiles).filter(
    t => t.number === diceTotal && !t.hasRobber,
  );
  if (producingTiles.length === 0) return null;
  // 最初のタイルの axial 座標からピクセル中心を求める
  const tile = producingTiles[0]!;
  // SVG内座標: axialToPixel を使えないが、data-tile-id から g 要素の位置が取れる
  const tileG = boardEl.querySelector(`[data-tile-id="${tile.id}"]`) as SVGGElement | null;
  if (!tileG) return null;
  const tileRect = tileG.getBoundingClientRect();
  return {
    x: tileRect.left + tileRect.width / 2,
    y: tileRect.top  + tileRect.height / 2,
  };
}

/** ボード中心の画面座標 */
function getBoardCenter(): { x: number; y: number } {
  const boardEl = document.getElementById('board');
  if (!boardEl) return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  const r = boardEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** ダイス目に対応する産出タイルを一時的に強調表示（どのタイルから資源が出たか分かりやすく） */
function highlightProducingTiles(diceTotal: number): void {
  if (lastConfig?.cpuSpeed === 'instant') return;
  const boardEl = document.getElementById('board');
  if (!boardEl) return;
  for (const tile of Object.values(state.tiles)) {
    if (tile.number !== diceTotal || tile.hasRobber) continue;
    const poly = boardEl.querySelector(`[data-tile-id="${tile.id}"] .hex-tile`) as SVGElement | null;
    if (!poly) continue;
    poly.classList.add('producing');
    setTimeout(() => poly.classList.remove('producing'), 1600);
  }
}

function triggerResourceAnimation(
  oldState: GameState,
  newState: GameState,
  actionType?: string,
  diceTotal?: number,
): void {
  if (lastConfig?.cpuSpeed === 'instant') return;
  // 盗み取り(MOVE_ROBBER)の獲得は飛ばさない（奪った資源の種類を秘匿するため）。
  if (actionType === 'MOVE_ROBBER') return;

  // 全プレイヤー分のアイコンを、誰のものでも実資源アイコンで、1個ずつ順番に飛ばす。
  // （ダイス産出は盤面を見れば分かる公開情報。誰に何が入ったか追えることを優先）
  let delay = 0;
  for (const pid of newState.playerOrder) {
    const oldH = oldState.players[pid]?.hand;
    const newH = newState.players[pid]?.hand;
    if (!oldH || !newH) continue;
    const gains: Array<{ r: ResourceType; n: number }> = [];
    for (const r of RESOURCE_TYPES) {
      const diff = newH[r] - oldH[r];
      if (diff > 0) gains.push({ r, n: diff });
    }
    if (gains.length === 0) continue;
    const panelEl = document.querySelector(`.player-panel[data-pid="${pid}"]`) as HTMLElement | null;
    if (!panelEl) continue;

    // 起点座標（ダイス産出はそのタイル中心、それ以外は盤面中央）
    const origin = (actionType === 'ROLL_DICE' && diceTotal !== undefined)
      ? (getProducingTileOrigin(diceTotal) ?? getBoardCenter())
      : getBoardCenter();

    // 実資源アイコンを枚数分（種類が分かる）。多すぎる場合は最大5個まで。
    const glyphs: string[] = [];
    for (const { r, n } of gains) {
      for (let i = 0; i < Math.min(n, 5); i++) glyphs.push(RES_EMOJI[r]);
    }

    for (const glyph of glyphs) {
      const jitter = { x: origin.x + (Math.random() - 0.5) * 30, y: origin.y + (Math.random() - 0.5) * 20 };
      spawnResFlyer(glyph, panelEl, jitter, delay);
      delay += RES_FLY_STAGGER; // 1個ずつ間隔を空けて飛ばす（全プレイヤー通しで順番に）
    }
  }
}

// ダイスのロール演出（擬似3D）。盤面中央で2つのサイコロが転がり、最初は速く→徐々に
// 減速→最後に確定。出目はピップ（点）で描画する。完了後に onDone を呼ぶ。
// 演出時間は速度設定に応じて調整（最速は0=スキップ）。ゲーム結果には一切影響しない。

// 各目のピップ配置（3x3 グリッドのインデックス 0..8）
const DICE_PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
function setDiePips(face: HTMLElement, value: number): void {
  face.textContent = ''; // 生成したピップ要素のみで構成（外部入力なし）
  const on = DICE_PIPS[value] ?? [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    cell.className = on.includes(i) ? 'pip-cell on' : 'pip-cell';
    face.appendChild(cell);
  }
}
// ロール演出の長さ（ms）。速度設定に連動。
function diceRollMs(): number {
  switch (lastConfig?.cpuSpeed) {
    case 'instant': return 0;
    case 'fast':    return 750;
    case 'slow':    return 2150;
    default:        return 1700; // normal: しっかり「振っている感」を出す
  }
}
function playDiceRoll(d1: number, d2: number, onDone: () => void): void {
  const dur = diceRollMs();
  if (dur <= 0 || d1 < 1 || d2 < 1) { onDone(); return; }

  const host = document.getElementById('board-area') ?? document.body;
  const overlay = document.createElement('div');
  overlay.className = 'dice-roll-overlay';
  const row = document.createElement('div'); row.className = 'dice-row';
  const die1 = document.createElement('div'); die1.className = 'dice-die rolling';
  const die2 = document.createElement('div'); die2.className = 'dice-die rolling d2';
  setDiePips(die1, d1); setDiePips(die2, d2);
  row.append(die1, die2);
  // 合計表示スロットを先に確保（確定時に中央がガタつかない）
  const sum = document.createElement('div'); sum.className = 'dice-sum';
  overlay.append(row, sum);
  host.appendChild(overlay);
  // 減速して回転が止まるトランブル演出（CSSアニメーション）
  die1.style.animationDuration = `${dur}ms`;
  die2.style.animationDuration = `${dur}ms`;

  // 出目を切り替える間隔を徐々に伸ばして「減速して止まりそう」な溜めを作る
  const start = Date.now();
  let stopped = false;
  const cycle = (): void => {
    if (stopped) return;
    const elapsed = Date.now() - start;
    if (elapsed >= dur) { settle(); return; }
    setDiePips(die1, 1 + Math.floor(Math.random() * 6));
    setDiePips(die2, 1 + Math.floor(Math.random() * 6));
    const p = elapsed / dur;
    const interval = 55 + p * p * 300; // 55ms → ~355ms（後半ほどゆっくり）
    setTimeout(cycle, interval);
  };
  const settle = (): void => {
    if (stopped) return;
    stopped = true;
    setDiePips(die1, d1); setDiePips(die2, d2);
    die1.classList.remove('rolling'); die2.classList.remove('rolling', 'd2');
    die1.classList.add('settled');    die2.classList.add('settled');
    sum.textContent = `${d1} + ${d2} = ${d1 + d2}`;
    sum.classList.add('show');
    setTimeout(() => { overlay.remove(); onDone(); }, 480);
  };
  cycle();
}

function dispatch(action: Action): void {
  // LAN対戦: ローカル applyAction は禁止（正本はサーバ）。Action はサーバへ送る。
  if (netMode) { netDispatch(action); return; }
  // ダイス演出中は操作を受け付けない（多重ロール・先走り操作を防止）
  if (diceAnimating) return;
  try {
    const prevState = state;
    state = applyAction(state, action);

    // CPU手番ステータス: CPUが行った行動をバナーに反映
    setCpuStatusFromAction(action, prevState);

    // SE
    switch (action.type) {
      case 'ROLL_DICE':         playSE('dice'); break;
      case 'BUILD_ROAD':
      case 'BUILD_SETTLEMENT':
      case 'BUILD_CITY':        playSE('build'); break;
      case 'BUY_DEV_CARD':      playSE('devCard'); break;
      case 'PLAY_KNIGHT':
      case 'PLAY_ROAD_BUILDING':
      case 'PLAY_YEAR_OF_PLENTY':
      case 'PLAY_MONOPOLY':     playSE('devCard'); break;
      case 'MOVE_ROBBER':       playSE('robber'); break;
      case 'CONFIRM_TRADE':     playSE('tradeOk'); break;
      case 'RESPOND_TRADE':
        if ((action as { response: { status: string } }).response.status === 'REJECT') playSE('tradeNg');
        break;
      case 'END_TURN':          playSE('turnStart'); break;
      case 'DECLARE_VICTORY':   playSE('victory'); break;
      // 手札半減（人間/CPU問わず）: 資源を失う系の軽いSE。種類は秘匿のまま。
      case 'DISCARD_RESOURCES': playSE('discardLose'); break;
    }
    // 勝利確定: 派手な勝利演出（モーダル＋紙吹雪）＋勝利SE。CPUの後続処理は止める。
    if (state.phase === 'GAME_OVER' && prevState.phase !== 'GAME_OVER') {
      if (cpuWatchdog) { clearTimeout(cpuWatchdog); cpuWatchdog = null; }
      if (humanTradeTimer) { clearTimeout(humanTradeTimer); humanTradeTimer = null; }
      playSE('victory');
      if (state.winner) showVictoryOverlay(state.winner, action.type);
    }

    // リソース獲得アニメーション用のダイス目（ROLL_DICE のみ）
    const diceTotal = action.type === 'ROLL_DICE' && state.lastDiceRoll
      ? state.lastDiceRoll[0] + state.lastDiceRoll[1]
      : undefined;

    // 出目分布の集計（確定した出目のみ。演出中の仮表示はカウントしない）。
    // 人間/CPU 問わず1ロール1回。ロジックには影響しない。
    if (action.type === 'ROLL_DICE' && diceTotal !== undefined && diceTotal >= 2 && diceTotal <= 12) {
      diceStats[diceTotal] = (diceStats[diceTotal] ?? 0) + 1;
    }

    // 盗賊スライド演出用に、移動前の盗賊タイルを控える
    const robberFromTile = action.type === 'MOVE_ROBBER'
      ? Object.values(prevState.tiles).find(t => t.hasRobber)?.id
      : undefined;

    if (
      action.type === 'BUILD_ROAD' ||
      action.type === 'BUILD_SETTLEMENT' ||
      action.type === 'BUILD_CITY'
    ) {
      buildMode = 'idle';
    }

    if (action.type === 'PLAY_ROAD_BUILDING') {
      buildMode = 'road';
    }

    // 街道建設カード使用中は引き続き道建設モードを維持
    if (state.roadBuildingRoadsRemaining > 0) {
      buildMode = 'road';
    }

    // CPUがプレイヤー間交易を提案した場合：連続提案フラグ＋シグネチャを記録
    if (action.type === 'OFFER_TRADE') {
      const initPid = prevState.playerOrder[prevState.currentPlayerIndex]!;
      if (prevState.players[initPid]?.type === 'ai') {
        cpuPlayerTradeOfferedThisTurn = true;
        lastCpuOfferSignature = cpuOfferSignature(initPid, action.offer);
      }
    }
    // ターン終了時：連続提案フラグをリセット
    if (action.type === 'END_TURN') {
      cpuPlayerTradeOfferedThisTurn = false;
    }

    // ログ追記（公開情報のみ）。直近 MAX_LOG_ENTRIES 件に制限。
    const newLogs = buildActionLog(prevState, action, state);
    if (newLogs.length > 0) {
      state = { ...state, log: [...state.log, ...newLogs].slice(-MAX_LOG_ENTRIES) };
    }

    if (RESET_UIPHASE_ACTIONS.has(action.type)) {
      // CPUプレイヤーが捨て札した場合は人間の選択状態を保持する
      const isCpuDiscard =
        action.type === 'DISCARD_RESOURCES' &&
        state.players[action.playerId]?.type === 'ai';
      if (!isCpuDiscard) {
        uiPhase = { type: 'idle' };
      }
    }

    // 再描画＋次の進行。ROLL_DICE はダイス演出を見せてから資源演出・進行へ。
    const finish = (): void => {
      diceAnimating = false;
      redraw();
      if (action.type === 'MOVE_ROBBER' && robberFromTile) {
        animateRobberMove(robberFromTile, action.tileId);
      }
      // 7（盗賊）が出た瞬間: 専用の不穏SE。捨て札フェーズなら警告SEも（少し遅らせて重複回避）。
      if (action.type === 'ROLL_DICE' && diceTotal === 7) {
        playSE('sevenRoll');
        if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
          setTimeout(() => playSE('discardWarn'), 360);
        }
      }
      // 7以外: 産出タイルを強調して「どのタイルから資源が出たか」を分かりやすく
      if (action.type === 'ROLL_DICE' && diceTotal !== undefined && diceTotal !== 7) {
        highlightProducingTiles(diceTotal);
      }
      triggerResourceAnimation(prevState, state, action.type, diceTotal);
      // 交易提案後は CPU ターゲットが自動応答 / CPU起案時は人間の応答を待つ
      if (action.type === 'OFFER_TRADE' || action.type === 'RESPOND_TRADE') {
        scheduleCpuTradeResponse();
        scheduleCpuInitiatorConfirm();
        scheduleHumanTradeAutoReject(); // 人間ターゲットの自動拒否/タイムアウト
      } else {
        scheduleAiTurn();
      }
    };

    if (action.type === 'ROLL_DICE' && state.lastDiceRoll) {
      diceAnimating = true;
      const [d1, d2] = state.lastDiceRoll;
      playDiceRoll(d1, d2, finish);
    } else {
      finish();
    }
  } catch (err) {
    // 例外が出ても全体は止めない。ウォッチドッグが安全行動で進行を回復する。
    console.warn('applyAction error (recoverable):', err);
  }
}

function setBuildMode(mode: BuildMode): void {
  buildMode = mode;
  // 建設モードに入ったら横持ちシートは畳む（盤面をタップしやすく）。
  if (mode !== 'idle') landscapeSheetUserOpen = false;
  redraw();
}

function setUIPhase(phase: UIPhase): void {
  uiPhase = phase;
  redraw();
}

// ============================================================
// ゲーム開始（idempotent: 複数回呼んでも安全）
// ============================================================

// SVG ボードイベントは一度だけ登録
let boardEventsAttached = false;

// ============================================================
// LAN対戦: ゲーム開始 / サーバメッセージ処理 / Action送信
// ============================================================

// 現在の手番プレイヤーID。
function currentPid(s: GameState): PlayerId {
  return s.playerOrder[s.currentPlayerIndex]!;
}

// LAN で送信を許可する Action（クライアント側ガード。サーバでも二重に検証）。
const LAN_CLIENT_ALLOWED = new Set<Action['type']>([
  'ROLL_DICE', 'BUILD_ROAD', 'BUILD_SETTLEMENT', 'BUILD_CITY',
  'BUY_DEV_CARD', 'END_TURN', 'DECLARE_VICTORY',
  'MOVE_ROBBER', 'DISCARD_RESOURCES',
  'OFFER_TRADE', 'RESPOND_TRADE', 'CONFIRM_TRADE', 'CANCEL_TRADE', 'BANK_TRADE',
  'PLAY_KNIGHT', 'PLAY_ROAD_BUILDING', 'PLAY_YEAR_OF_PLENTY', 'PLAY_MONOPOLY',
  'FINISH_ROAD_BUILDING',
]);

// ロビーから started を受け取った時に呼ばれる。以降のメッセージは main が受ける。
function startLanGame(initial: GameState, viewerId: PlayerId, client: LanClient): void {
  // CPU 系タイマーを無効化（LANはCPU不使用）
  gameGeneration++;
  document.querySelector('.victory-overlay')?.remove(); document.querySelector('.dicestats-overlay')?.remove(); document.getElementById('cpu-status')?.remove();

  netMode = true;
  viewerPlayerId = viewerId;
  lanClient = client;
  state = initial;
  buildMode = 'idle';
  uiPhase = { type: 'idle' };
  landscapeSheetUserOpen = false;
  diceStats = new Array(13).fill(0);

  // 以降のサーバメッセージ（状態更新・切断等）は main 側で処理する。
  client.setHandler(handleNetMessage);

  // ボードクリック（配置・盗賊）を有効化。dispatch は netMode で送信に分岐する。
  if (!boardEventsAttached) {
    attachBoardEvents(svgBoard, () => state, () => buildMode, setUIPhase, dispatch);
    boardEventsAttached = true;
  }

  // 画面をゲーム本体へ切替
  homeDiv.style.display = 'none';
  gameTitle.style.display = 'none';
  appDiv.style.display = '';

  redraw();
}

function handleNetMessage(msg: import('./net/protocol').ServerMessage): void {
  switch (msg.t) {
    case 'started':
      // 再開始（理論上）: viewer と state を更新
      viewerPlayerId = msg.you;
      state = msg.state;
      redraw();
      break;
    case 'state':
      // サーバが適用済みの正本（マスク済み）。演出はアクション種別で再現する。
      applyNetState(msg.action, msg.state);
      break;
    case 'error':
      if (msg.fatal) {
        // 接続断など致命的: ホームへ戻す（多重防止に netMode を先に落とす）。
        if (netMode) {
          netMode = false;
          window.alert(`LAN対戦: ${msg.message}`);
          returnToHome();
        }
      } else {
        // 操作拒否など非致命: 進行は継続（次の state 配信で UI は整合する）。
        console.warn('LAN操作エラー:', msg.message);
      }
      break;
    // 'lobby'（開始後の参加者増減ブロードキャスト等）は無視
  }
}

// アクション種別に応じた効果音。ローカル dispatch / LAN 受信の双方で使う。
function playActionSE(action: Action): void {
  switch (action.type) {
    case 'ROLL_DICE':         playSE('dice'); break;
    case 'BUILD_ROAD':
    case 'BUILD_SETTLEMENT':
    case 'BUILD_CITY':        playSE('build'); break;
    case 'BUY_DEV_CARD':      playSE('devCard'); break;
    case 'PLAY_KNIGHT':
    case 'PLAY_ROAD_BUILDING':
    case 'PLAY_YEAR_OF_PLENTY':
    case 'PLAY_MONOPOLY':     playSE('devCard'); break;
    case 'MOVE_ROBBER':       playSE('robber'); break;
    case 'CONFIRM_TRADE':     playSE('tradeOk'); break;
    case 'RESPOND_TRADE':
      if ((action as { response: { status: string } }).response.status === 'REJECT') playSE('tradeNg');
      break;
    case 'END_TURN':          playSE('turnStart'); break;
    case 'DECLARE_VICTORY':   playSE('victory'); break;
    case 'DISCARD_RESOURCES': playSE('discardLose'); break;
  }
}

// LAN: サーバ配信の新 state を反映し、アクション種別に応じた演出を再現する。
// ローカル applyAction は行わない（正本はサーバ）。CPU/ログ処理も走らせない。
function applyNetState(action: Action | undefined, newState: GameState): void {
  const prevState = state;
  state = newState;

  // SE（dispatch と同じ対応）
  if (action) playActionSE(action);

  // 勝利演出（GAME_OVER 遷移時）
  if (state.phase === 'GAME_OVER' && prevState.phase !== 'GAME_OVER') {
    playSE('victory');
    if (state.winner && action) showVictoryOverlay(state.winner, action.type);
  }

  const diceTotal = action?.type === 'ROLL_DICE' && state.lastDiceRoll
    ? state.lastDiceRoll[0] + state.lastDiceRoll[1]
    : undefined;
  if (action?.type === 'ROLL_DICE' && diceTotal !== undefined && diceTotal >= 2 && diceTotal <= 12) {
    diceStats[diceTotal] = (diceStats[diceTotal] ?? 0) + 1;
  }

  const robberFromTile = action?.type === 'MOVE_ROBBER'
    ? Object.values(prevState.tiles).find(t => t.hasRobber)?.id
    : undefined;

  if (action && (action.type === 'BUILD_ROAD' || action.type === 'BUILD_SETTLEMENT' || action.type === 'BUILD_CITY')) {
    buildMode = 'idle';
  }
  if (action?.type === 'PLAY_ROAD_BUILDING') buildMode = 'road';
  if (state.roadBuildingRoadsRemaining > 0) buildMode = 'road';

  // 交易/発展カード/盗賊/ターン終了などの後はモーダルUIを閉じる（CPU path と同様）。
  // ただし DISCARD_RESOURCES は除外（複数人捨て札で他人の捨て札時に自分の選択中UIを
  // 消さないため）。捨て札・盗賊ターゲットは直後の redraw 自動同期が再導出する。
  if (action && action.type !== 'DISCARD_RESOURCES' && RESET_UIPHASE_ACTIONS.has(action.type)) {
    uiPhase = { type: 'idle' };
  }

  const finish = (): void => {
    diceAnimating = false;
    redraw();
    if (action?.type === 'MOVE_ROBBER' && robberFromTile) {
      animateRobberMove(robberFromTile, action.tileId);
    }
    if (action?.type === 'ROLL_DICE' && diceTotal === 7) {
      playSE('sevenRoll');
      if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
        setTimeout(() => playSE('discardWarn'), 360);
      }
    }
    if (action?.type === 'ROLL_DICE' && diceTotal !== undefined && diceTotal !== 7) {
      highlightProducingTiles(diceTotal);
    }
    triggerResourceAnimation(prevState, state, action?.type ?? 'SYSTEM', diceTotal);
  };

  if (action?.type === 'ROLL_DICE' && state.lastDiceRoll) {
    diceAnimating = true;
    const [d1, d2] = state.lastDiceRoll;
    playDiceRoll(d1, d2, finish);
  } else {
    finish();
  }
}

// LAN: クライアント操作をサーバへ送る（ローカル state は変更しない）。
function netDispatch(action: Action): void {
  if (diceAnimating) return;
  if (!lanClient || !viewerPlayerId) return;
  if (!LAN_CLIENT_ALLOWED.has(action.type)) return; // 未対応操作は送らない
  // actor（操作者）が自分か。捨て札・交易応答は対象本人、それ以外は手番プレイヤー。
  const actor =
    action.type === 'DISCARD_RESOURCES' ? action.playerId :
    action.type === 'RESPOND_TRADE'     ? action.response.playerId :
    currentPid(state);
  if (actor !== viewerPlayerId) return; // 自分の操作できる場面のみ送信
  lanClient.send({ t: 'action', action });
}

function startGame(cfg: HomeConfig): void {
  // 新しいゲーム世代 → 前の AI setTimeout を無効化
  gameGeneration++;
  document.querySelector('.victory-overlay')?.remove(); document.querySelector('.dicestats-overlay')?.remove(); document.getElementById('cpu-status')?.remove();

  netMode = false; // CPU対戦はローカル完結（LAN状態を確実に解除）
  lastConfig = cfg;
  state = initGameState(cfg);
  buildMode = 'idle';
  uiPhase = { type: 'idle' };
  landscapeSheetUserOpen = false;
  cpuPlayerTradeOfferedThisTurn = false;
  lastCpuOfferSignature = null;
  diceStats = new Array(13).fill(0); // 新規ゲームで出目分布をリセット

  // 画面切り替え（ゲーム中は大きなタイトルは出さず、盤面/操作の領域を広げる）
  homeDiv.style.display = 'none';
  gameTitle.style.display = 'none';
  appDiv.style.display = '';

  // ボードイベントは初回のみ登録（二重登録防止）
  if (!boardEventsAttached) {
    attachBoardEvents(
      svgBoard,
      () => state,
      () => buildMode,
      setUIPhase,
      dispatch,
    );
    boardEventsAttached = true;
  }

  redraw();
  scheduleAiTurn();
}

// ============================================================
// ホームに戻る
// ============================================================

function returnToHome(): void {
  // AI タイムアウトを無効化
  gameGeneration++;
  document.querySelector('.victory-overlay')?.remove(); document.querySelector('.dicestats-overlay')?.remove(); document.getElementById('cpu-status')?.remove();
  // 横持ちボトムシートの状態をリセット
  landscapeSheetUserOpen = false;
  document.body.classList.remove('lsheet-open');

  // LAN対戦の後片付け（接続を閉じてローカルモードへ戻す）
  if (netMode || lanClient) {
    lanClient?.close();
    lanClient = null;
    netMode = false;
    viewerPlayerId = null;
  }

  appDiv.style.display = 'none';
  gameTitle.style.display = 'none';
  homeDiv.style.display = '';

  // ホーム画面を再レンダリング（前回の設定を引き継ぐ）
  renderHome(homeDiv, startGame, startLanGame);
}

// ============================================================
// 起動
// ============================================================

window.addEventListener('resize', () => {
  if (state) redraw();
});

// メニュー外クリックで閉じる
document.addEventListener('click', (e) => {
  if (!gameMenuOpen) return;
  const target = e.target as Node;
  if (!gameNav.contains(target)) {
    gameMenuOpen = false;
    const dd = gameNav.querySelector('.game-menu') as HTMLElement | null;
    if (dd) dd.style.display = 'none';
  }
});

renderHome(homeDiv, startGame, startLanGame);
