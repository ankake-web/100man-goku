// ============================================================
// src/main.ts — エントリポイント
// ============================================================

import './style.css';
import type { GameState, Action, PlayerId, AiDifficulty, ResourceType } from './types';
import { buildBoardGeometry } from './engine/board';
import { createRandomBoard, resolvePlayerOrder } from './engine/setup';
import type { PlayerOrderMode } from './engine/setup';
import { makeHand, BANK_INITIAL, RESOURCE_TYPES } from './constants';
import { buildDevDeck } from './engine/game';
import { applyAction } from './engine/game';
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
const PLAYER_COLORS            = ['red', 'blue', 'white', 'orange'] as const;
const CPU_NAMES                = ['CPU α', 'CPU β', 'CPU γ'];

// ============================================================
// ホーム画面レンダリング
// ============================================================

function renderHome(container: HTMLElement, onStart: (cfg: HomeConfig) => void): void {
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

  const tabCpu    = createTab('CPU 対戦',      true);
  const tabOnline = createTab('オンライン対戦', false);
  tabs.appendChild(tabCpu);
  tabs.appendChild(tabOnline);
  card.appendChild(tabs);

  // ---- CPU 対戦フォーム ----
  const cpuForm = document.createElement('div');
  cpuForm.className = 'home-form';

  const nameField = document.createElement('div');
  nameField.className = 'home-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'home-label';
  nameLabel.textContent = 'プレイヤー名';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'home-input';
  nameInput.value = lastConfig?.playerName ?? 'プレイヤー1';
  nameInput.maxLength = 20;
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);
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

  // ---- オンライン対戦フォーム（スタブ）----
  const onlineForm = document.createElement('div');
  onlineForm.className = 'home-form';
  onlineForm.style.display = 'none';

  const onlineBtns = document.createElement('div');
  onlineBtns.className = 'home-online-btns';
  const createRoomBtn = document.createElement('button');
  createRoomBtn.className = 'home-online-btn';
  createRoomBtn.textContent = 'ルーム作成';
  const joinRoomBtn = document.createElement('button');
  joinRoomBtn.className = 'home-online-btn';
  joinRoomBtn.textContent = 'ルーム参加';
  onlineBtns.appendChild(createRoomBtn);
  onlineBtns.appendChild(joinRoomBtn);
  onlineForm.appendChild(onlineBtns);

  const comingSoon = document.createElement('p');
  comingSoon.className = 'home-coming-soon';
  comingSoon.textContent = '※ オンライン機能は近日公開予定';
  onlineForm.appendChild(comingSoon);

  const comingSoonMsg = document.createElement('div');
  comingSoonMsg.className = 'home-coming-soon-msg';
  comingSoonMsg.textContent = '🚧 オンライン対戦は現在開発中です。しばらくお待ちください。';
  onlineForm.appendChild(comingSoonMsg);

  card.appendChild(cpuForm);
  card.appendChild(onlineForm);
  screen.appendChild(card);

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

  [createRoomBtn, joinRoomBtn].forEach(btn => {
    btn.addEventListener('click', () => { comingSoonMsg.style.display = 'block'; });
  });

  startBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'プレイヤー1';

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
  const geo = buildBoardGeometry();
  const { tiles, harbors } = createRandomBoard(geo);

  const totalPlayers = cfg.cpuCount + 1;
  const players: GameState['players'] = {};
  // プレイヤー実体（誰が人間/CPUか）は ID 固定で生成する。手番順とは独立。
  const allIds: PlayerId[] = [];

  for (let i = 0; i < totalPlayers; i++) {
    const id = PLAYER_IDS[i]!;
    const color = PLAYER_COLORS[i]!;
    const isHuman = i === 0;
    const base = {
      id, color,
      name: isHuman ? cfg.playerName : CPU_NAMES[i - 1]!,
      type: isHuman ? 'human' as const : 'ai' as const,
      hand: makeHand(),
      devCards: [],
      remainingRoads: 15,
      remainingSettlements: 5,
      remainingCities: 4,
      knightsPlayed: 0,
      longestRoadLength: 0,
      hasLongestRoad: false as const,
      hasLargestArmy: false as const,
    };
    players[id] = isHuman ? base : { ...base, aiDifficulty: cfg.cpuDifficulty };
    allIds.push(id);
  }

  // 手番順を決定（ランダム=毎回シャッフル / 指定=spec を検証して採用）。
  // 指定 spec が現在の参加プレイヤーと不整合なら allIds の元順にフォールバック。
  const playerOrder = resolvePlayerOrder(allIds, cfg.orderMode, cfg.playerOrderSpec);

  return {
    tiles,
    vertices: geo.vertices,
    edges:    geo.edges,
    harbors,
    tileToVertices: geo.tileToVertices,
    tileToEdges:    geo.tileToEdges,
    players,
    playerOrder,
    bank: { ...BANK_INITIAL },
    devDeck:        buildDevDeck(),
    devDiscardPile: [],
    phase: 'SETUP_FORWARD',
    turnPhase: 'PRE_ROLL',
    currentPlayerIndex: 0,
    globalTurnNumber: 0,
    setupSubPhase: 'PLACE_SETTLEMENT',
    lastDiceRoll: null,
    diceRolledThisTurn: false,
    roadBuildingRoadsRemaining: 0,
    devCardPlayedThisTurn: false,
    longestRoadHolder: null,
    largestArmyHolder: null,
    pendingTrade: null,
    winner: null,
    discardedThisRound: [],
    log: [],
  };
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

// AI タイムアウト世代管理（世代が変わった setTimeout は無視）
let gameGeneration = 0;

// このターンにCPUがプレイヤー間交易を提案済みか（連続提案防止）
let cpuPlayerTradeOfferedThisTurn = false;

// ============================================================
// 再描画
// ============================================================

function redraw(): void {
  if (!state) return;

  // DISCARD フェーズの uiPhase 自動同期
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

  const opts = computeHighlights(state, buildMode);
  renderBoard(svgBoard, state, opts);
  renderUI(uiDiv, state, buildMode, setBuildMode, uiPhase, setUIPhase, dispatch);
  updateGameNav();
}

// ============================================================
// ゲームナビバー更新
// ============================================================

function updateGameNav(): void {
  gameNav.innerHTML = '';

  if (state.phase === 'GAME_OVER') {
    // ゲーム終了: 再戦ボタン + ホームボタン
    if (lastConfig) {
      const rematchBtn = document.createElement('button');
      rematchBtn.className = 'btn-nav btn-nav-primary';
      rematchBtn.textContent = 'もう一度プレイ';
      rematchBtn.addEventListener('click', () => {
        if (lastConfig) startGame(lastConfig);
      });
      gameNav.appendChild(rematchBtn);
    }

    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn-nav';
    homeBtn.textContent = '設定を変えてホームへ';
    homeBtn.addEventListener('click', returnToHome);
    gameNav.appendChild(homeBtn);
  } else {
    // ゲーム中: ホームに戻るボタン
    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn-nav';
    homeBtn.textContent = 'ホームに戻る';
    homeBtn.addEventListener('click', () => {
      if (window.confirm('ホームに戻りますか？現在のゲームは終了します。')) {
        returnToHome();
      }
    });
    gameNav.appendChild(homeBtn);
  }

  // BGM コントロール（ゲーム中 / GAME_OVER 共通）
  const bgmBtn = document.createElement('button');
  bgmBtn.className = 'btn-nav btn-nav-bgm';
  bgmBtn.textContent = _bgmEnabled ? '🔊 BGM' : '🔇 BGM';
  bgmBtn.title = 'BGM ON/OFF';
  bgmBtn.addEventListener('click', () => {
    _bgmEnabled = !_bgmEnabled;
    if (_bgmEnabled) bgmStart(); else bgmStop();
    bgmBtn.textContent = _bgmEnabled ? '🔊 BGM' : '🔇 BGM';
  });
  gameNav.appendChild(bgmBtn);

  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.min = '0'; volSlider.max = '100';
  volSlider.value = String(Math.round(_bgmVolume * 100));
  volSlider.className = 'bgm-volume';
  volSlider.title = 'BGM 音量';
  volSlider.addEventListener('input', () => {
    bgmSetVolume(parseInt(volSlider.value) / 100);
  });
  gameNav.appendChild(volSlider);

  // SE ミュートボタン
  const seBtn = document.createElement('button');
  seBtn.className = 'btn-nav btn-nav-bgm';
  seBtn.textContent = _seEnabled ? '🔔 SE' : '🔕 SE';
  seBtn.title = '効果音 ON/OFF';
  seBtn.addEventListener('click', () => {
    _seEnabled = !_seEnabled;
    seBtn.textContent = _seEnabled ? '🔔 SE' : '🔕 SE';
  });
  gameNav.appendChild(seBtn);
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
  default:  200,
};

export type SEType = 'click'|'dice'|'resource'|'build'|'tradeOk'|'tradeNg'|'devCard'|'robber'|'turnStart'|'victory';

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
      case 'victory':
        [523,659,784,1047].forEach((f, i) => note(f, 0.45, 'triangle', 0.5, i * 0.12));
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

const CPU_SPEED_MS: Record<CpuSpeed, number> = { slow: 1200, normal: 500, fast: 200, instant: 30 };
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
      setTimeout(() => {
        if (gen !== gameGeneration) return;
        const action = chooseAction(state, discardPid);
        if (action) dispatch(action);
      }, aiDelayMs());
    }
    return;
  }

  const pid = state.playerOrder[state.currentPlayerIndex]!;
  if (state.players[pid]?.type === 'ai') {
    const aiOpts: AiOpts = { skipPlayerTrade: cpuPlayerTradeOfferedThisTurn };
    setTimeout(() => {
      if (gen !== gameGeneration) return;
      const action = chooseAction(state, pid, aiOpts);
      if (action) dispatch(action);
    }, aiDelayMs());
  }
}

/**
 * 資源獲得アニメーション
 * origin: 画面座標（起点タイル中心など）。省略時はボードの中央。
 */
function spawnResFlyer(
  r: ResourceType,
  panelEl: HTMLElement,
  origin: { x: number; y: number },
  delay: number,
): void {
  setTimeout(() => {
    const span = document.createElement('span');
    span.className = 'res-fly';
    span.textContent = RES_EMOJI[r];
    // 起点位置をセット（絶対座標）
    span.style.left = `${origin.x}px`;
    span.style.top  = `${origin.y}px`;
    // 終点位置（プレイヤーパネル中央）をCSS変数でセット
    const pr = panelEl.getBoundingClientRect();
    const tx = pr.left + pr.width / 2 - origin.x;
    const ty = pr.top  + 20 - origin.y;
    span.style.setProperty('--tx', `${tx}px`);
    span.style.setProperty('--ty', `${ty}px`);
    document.body.appendChild(span);
    requestAnimationFrame(() => requestAnimationFrame(() => { span.classList.add('fly-in'); }));
    setTimeout(() => { span.remove(); playSE('resource'); }, 750);
  }, delay);
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

function triggerResourceAnimation(
  oldState: GameState,
  newState: GameState,
  actionType?: string,
  diceTotal?: number,
): void {
  if (lastConfig?.cpuSpeed === 'instant') return;
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

    // 起点座標を決める
    let origin: { x: number; y: number };
    if (actionType === 'ROLL_DICE' && diceTotal !== undefined) {
      origin = getProducingTileOrigin(diceTotal) ?? getBoardCenter();
    } else {
      origin = getBoardCenter();
    }

    let delay = 0;
    for (const { r, n } of gains) {
      const count = Math.min(n, 4);  // 多すぎる場合は最大4個
      for (let i = 0; i < count; i++) {
        // 起点を少しランダムにバラけさせる
        const jitter = { x: origin.x + (Math.random() - 0.5) * 30, y: origin.y + (Math.random() - 0.5) * 20 };
        spawnResFlyer(r, panelEl, jitter, delay);
        delay += 110;
      }
    }
  }
}

function dispatch(action: Action): void {
  try {
    const prevState = state;
    state = applyAction(state, action);

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
    }
    if (state.phase === 'GAME_OVER' && prevState.phase !== 'GAME_OVER') playSE('victory');

    // リソース獲得アニメーション（ROLL_DICE の場合はダイス目を渡してタイル起点を使う）
    const diceTotal = action.type === 'ROLL_DICE' && state.lastDiceRoll
      ? state.lastDiceRoll[0] + state.lastDiceRoll[1]
      : undefined;
    triggerResourceAnimation(prevState, state, action.type, diceTotal);

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

    // CPUがプレイヤー間交易を提案した場合：連続提案フラグをセット
    if (action.type === 'OFFER_TRADE') {
      const initPid = prevState.playerOrder[prevState.currentPlayerIndex]!;
      if (prevState.players[initPid]?.type === 'ai') {
        cpuPlayerTradeOfferedThisTurn = true;
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

    redraw();
    // 交易提案後は CPU ターゲットが自動応答 / CPU起案時は人間の応答を待つ
    if (action.type === 'OFFER_TRADE' || action.type === 'RESPOND_TRADE') {
      scheduleCpuTradeResponse();
      scheduleCpuInitiatorConfirm();
    } else {
      scheduleAiTurn();
    }
  } catch (err) {
    console.error('applyAction error:', err);
  }
}

function setBuildMode(mode: BuildMode): void {
  buildMode = mode;
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

function startGame(cfg: HomeConfig): void {
  // 新しいゲーム世代 → 前の AI setTimeout を無効化
  gameGeneration++;

  lastConfig = cfg;
  state = initGameState(cfg);
  buildMode = 'idle';
  uiPhase = { type: 'idle' };

  // 画面切り替え
  homeDiv.style.display = 'none';
  gameTitle.style.display = '';
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

  appDiv.style.display = 'none';
  gameTitle.style.display = 'none';
  homeDiv.style.display = '';

  // ホーム画面を再レンダリング（前回の設定を引き継ぐ）
  renderHome(homeDiv, startGame);
}

// ============================================================
// 起動
// ============================================================

window.addEventListener('resize', () => {
  if (state) redraw();
});

renderHome(homeDiv, startGame);
