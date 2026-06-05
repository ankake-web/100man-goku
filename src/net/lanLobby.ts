// ============================================================
// src/net/lanLobby.ts — LAN対戦ロビーUI（TOPの「オンライン対戦」タブ）
// ============================================================
//
// ルーム作成/参加 → 参加者一覧の同期 → ホストの開始、までを担当する。
// ゲーム開始（started 受信）で onGameStart を呼び、以降は main 側が描画する。
// 既存の CPU 対戦フォームには一切触れない（このモジュールは LAN 専用）。

import { LanClient } from './lanClient';
import type { ServerMessage, LobbyPlayer } from './protocol';
import type { GameState, PlayerId, PlayerColor } from '../types';
import { attachNameField, savePlayerName } from './nameField';
import { saveResume, clearResume } from './resume';
import type { ResumeInfo } from './resume';

const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#e23b3b', blue: '#3b7fe2', purple: '#9b5bd6', orange: '#e2913b',
};

export interface LanLobbyCallbacks {
  // started 受信時: マスク済み state・自分のID・接続中クライアントを引き渡す
  onGameStart: (state: GameState, viewerId: PlayerId, client: LanClient) => void;
}

interface LobbyView {
  code: string;
  you: PlayerId | null;
  isHost: boolean;
  players: LobbyPlayer[];
  hostUrls: string[];
  canStart: boolean;
  cpuCount: number;
  maxCpu: number;
  error: string;
}

export function renderLanLobby(container: HTMLElement, cb: LanLobbyCallbacks, resume?: ResumeInfo): void {
  container.innerHTML = '';

  let client: LanClient | null = null;
  const view: LobbyView = {
    code: '', you: null, isHost: false, players: [], hostUrls: [], canStart: false,
    cpuCount: 0, maxCpu: 3, error: '',
  };
  let stage: 'idle' | 'lobby' | 'resuming' = 'idle';

  const root = document.createElement('div');
  root.className = 'lan-lobby';
  container.appendChild(root);

  // ---- サーバメッセージ処理 ----
  const handle = (msg: ServerMessage): void => {
    switch (msg.t) {
      case 'joined':
        view.you = msg.you; view.isHost = msg.isHost; view.code = msg.code; view.error = '';
        // 再接続情報を保存（リロード/一時切断で同一プレイヤー復帰）。
        saveResume({ code: msg.code, you: msg.you, token: msg.token });
        // started=true なら 'started' 受信でゲームへ遷移するのでロビーは描かない。
        if (!msg.started) { stage = 'lobby'; render(); }
        break;
      case 'lobby':
        view.code = msg.code; view.players = msg.players;
        view.hostUrls = msg.hostUrls; view.canStart = msg.canStart;
        view.cpuCount = msg.cpuCount; view.maxCpu = msg.maxCpu;
        if (stage === 'lobby' || stage === 'resuming') { stage = 'lobby'; render(); }
        break;
      case 'started':
        if (client) cb.onGameStart(msg.state, msg.you, client);
        break;
      case 'error':
        if (msg.fatal) {
          // 再接続失敗など: 保存情報を破棄して入室前(idle)へ戻す。
          clearResume();
          client?.close(); client = null;
          stage = 'idle';
        }
        view.error = msg.message; render();
        break;
    }
  };

  const ensureClient = async (): Promise<boolean> => {
    if (client) return true;
    client = new LanClient(handle);
    try {
      await client.connect();
      return true;
    } catch {
      client = null;
      view.error = 'サーバに接続できませんでした（ホストが dev サーバを起動しているか確認してください）';
      render();
      return false;
    }
  };

  // ---- レンダリング ----
  function render(): void {
    root.innerHTML = '';
    if (stage === 'idle') renderIdle();
    else if (stage === 'resuming') {
      const r = document.createElement('div');
      r.className = 'lan-wait';
      r.textContent = '🔄 再接続中…';
      root.appendChild(r);
    } else renderLobby();
    if (view.error) {
      const err = document.createElement('div');
      err.className = 'lan-error';
      err.textContent = `⚠ ${view.error}`;
      root.appendChild(err);
    }
  }

  // 再接続（resume 情報があれば、同一プレイヤーとして復帰を試みる）。
  async function startResume(info: ResumeInfo): Promise<void> {
    stage = 'resuming'; view.error = ''; render();
    if (await ensureClient()) {
      client!.send({ t: 'resume', code: info.code, you: info.you, token: info.token });
    } else {
      clearResume();
      stage = 'idle'; render();
    }
  }

  function renderIdle(): void {
    const nameField = field('プレイヤー名');
    const nameRow = document.createElement('div');
    nameRow.className = 'name-input-row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'home-input';
    const dice = attachNameField(nameInput);  // 初期値=保存名 or ランダム、🎲ボタン
    nameRow.appendChild(nameInput);
    nameRow.appendChild(dice);
    nameField.appendChild(nameRow);
    root.appendChild(nameField);

    // 未入力なら空のまま送る（サーバがランダム名を補完＋重複回避する）。
    const getName = (): string => {
      const n = nameInput.value.trim();
      savePlayerName(n);
      return n;
    };

    // ルーム作成
    const createBtn = document.createElement('button');
    createBtn.className = 'home-start-btn';
    createBtn.textContent = 'ルームを作成';
    createBtn.addEventListener('click', async () => {
      if (await ensureClient()) client!.send({ t: 'create', name: getName() });
    });
    root.appendChild(createBtn);

    const divider = document.createElement('div');
    divider.className = 'lan-divider';
    divider.textContent = 'または';
    root.appendChild(divider);

    // ルーム参加
    const joinRow = document.createElement('div');
    joinRow.className = 'lan-join-row';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'home-input lan-code-input';
    codeInput.maxLength = 4;
    codeInput.placeholder = 'ルームコード';
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    const joinBtn = document.createElement('button');
    joinBtn.className = 'home-online-btn';
    joinBtn.textContent = '参加';
    joinBtn.addEventListener('click', async () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length < 4) { view.error = 'ルームコードを入力してください'; render(); return; }
      if (await ensureClient()) client!.send({ t: 'join', code, name: getName() });
    });
    joinRow.appendChild(codeInput);
    joinRow.appendChild(joinBtn);
    root.appendChild(joinRow);

    const hint = document.createElement('p');
    hint.className = 'lan-hint';
    hint.textContent = '同じ Wi-Fi / LAN 内の端末同士で対戦できます。ホストが表示する URL に他の端末からアクセスしてください。';
    root.appendChild(hint);
  }

  function renderLobby(): void {
    // ルームコード
    const codeBox = document.createElement('div');
    codeBox.className = 'lan-code-box';
    codeBox.append('ルームコード ');
    const codeStrong = document.createElement('b');
    codeStrong.className = 'lan-code';
    codeStrong.textContent = view.code;
    codeBox.appendChild(codeStrong);
    root.appendChild(codeBox);

    // 参加用 URL（他端末で開く）
    if (view.hostUrls.length > 0) {
      const urlBox = document.createElement('div');
      urlBox.className = 'lan-url-box';
      const lbl = document.createElement('div');
      lbl.className = 'lan-url-label';
      lbl.textContent = '他の端末でこの URL を開く:';
      urlBox.appendChild(lbl);
      for (const u of view.hostUrls) {
        const a = document.createElement('a');
        a.className = 'lan-url';
        a.href = u; a.textContent = u; a.target = '_blank'; a.rel = 'noopener';
        urlBox.appendChild(a);
      }
      root.appendChild(urlBox);
    }

    // 参加者一覧
    const listBox = document.createElement('div');
    listBox.className = 'lan-players';
    const listTitle = document.createElement('div');
    listTitle.className = 'lan-players-title';
    listTitle.textContent = `参加者 (${view.players.filter(p => p.connected).length})`;
    listBox.appendChild(listTitle);
    const humanCount = view.players.filter(p => !p.isCpu && p.connected).length;
    for (const p of view.players) {
      const row = document.createElement('div');
      row.className = `lan-player-row${p.connected ? '' : ' disconnected'}${p.isCpu ? ' cpu' : ''}`;
      const dot = document.createElement('span');
      dot.className = 'lan-player-dot';
      dot.style.background = COLOR_HEX[p.color];
      row.appendChild(dot);
      const nm = document.createElement('span');
      nm.className = 'lan-player-name';
      nm.textContent = p.isCpu ? `🤖 ${p.name}` : p.name;
      row.appendChild(nm);
      const tags = document.createElement('span');
      tags.className = 'lan-player-tags';
      if (p.isCpu) tags.textContent += ' CPU';
      if (p.isHost) tags.textContent += ' 👑ホスト';
      if (p.id === view.you) tags.textContent += ' (あなた)';
      if (!p.connected && !p.isCpu) tags.textContent += ' …切断';
      row.appendChild(tags);
      listBox.appendChild(row);
    }
    root.appendChild(listBox);

    // CPU 人数設定（ホストのみ）。人間＋CPUが2〜4人になるよう調整する。
    if (view.isHost) {
      const cpuBox = document.createElement('div');
      cpuBox.className = 'lan-cpu-ctrl';
      const lbl = document.createElement('span');
      lbl.className = 'lan-cpu-label';
      lbl.textContent = 'CPU 人数';
      cpuBox.appendChild(lbl);
      const minus = document.createElement('button');
      minus.className = 'lan-cpu-btn'; minus.textContent = '−';
      minus.disabled = view.cpuCount <= 0;
      minus.addEventListener('click', () => client?.send({ t: 'setCpu', count: view.cpuCount - 1 }));
      const val = document.createElement('span');
      val.className = 'lan-cpu-val'; val.textContent = String(view.cpuCount);
      const plus = document.createElement('button');
      plus.className = 'lan-cpu-btn'; plus.textContent = '＋';
      plus.disabled = view.cpuCount >= view.maxCpu;
      plus.addEventListener('click', () => client?.send({ t: 'setCpu', count: view.cpuCount + 1 }));
      cpuBox.append(minus, val, plus);
      const hint = document.createElement('span');
      hint.className = 'lan-cpu-hint';
      hint.textContent = `（人間 ${humanCount} ＋ CPU ${view.cpuCount} ＝ ${humanCount + view.cpuCount}人）`;
      cpuBox.appendChild(hint);
      root.appendChild(cpuBox);
    }

    // 開始 / 待機
    if (view.isHost) {
      const startBtn = document.createElement('button');
      startBtn.className = 'home-start-btn';
      // 開始条件未達は内部条件を見せず、シンプルに「待機中」。
      startBtn.textContent = view.canStart ? 'ゲーム開始' : '⏳ 待機中…';
      startBtn.disabled = !view.canStart;
      startBtn.addEventListener('click', () => client?.send({ t: 'start' }));
      root.appendChild(startBtn);
      if (!view.canStart) {
        const note = document.createElement('div');
        note.className = 'lan-wait-note';
        note.textContent = '参加者を待っています';
        root.appendChild(note);
      }
    } else {
      const wait = document.createElement('div');
      wait.className = 'lan-wait';
      wait.textContent = '⏳ ホストの開始を待っています';
      root.appendChild(wait);
    }

    // 退出
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'home-online-btn lan-leave';
    leaveBtn.textContent = '退出';
    leaveBtn.addEventListener('click', () => {
      client?.close(); client = null;
      stage = 'idle';
      Object.assign(view, { code: '', you: null, isHost: false, players: [], hostUrls: [], canStart: false, error: '' });
      render();
    });
    root.appendChild(leaveBtn);
  }

  function field(labelText: string): HTMLDivElement {
    const f = document.createElement('div');
    f.className = 'home-field';
    const l = document.createElement('label');
    l.className = 'home-label';
    l.textContent = labelText;
    f.appendChild(l);
    return f;
  }

  render();
  // 再接続情報があれば自動で復帰を試みる（リロード/一時切断からの復帰）。
  if (resume) void startResume(resume);
}
