// ============================================================
// server/lanServer.ts — LAN対戦 WebSocket サーバ（サーバ権威）
// ============================================================
//
// Vite dev サーバの HTTP サーバに相乗りし、パス /lan の WebSocket だけを処理する
// （Vite 自身の HMR WebSocket と衝突しないよう noServer + パス判定）。
//
// 役割:
//   - ルーム作成 / 参加 / 参加者一覧の同期（ロビー）
//   - ホストのゲーム開始 → 純粋エンジンで初期 state を生成
//   - 各クライアントへ「視点別マスク済み」state を配信
//
// MVP 1-2 範囲: ロビー＋開始＋同一盤面＋playerId 割当＋秘匿マスク。
// 操作 Action の同期（applyAction 適用・配信）は MVP3 以降で本ファイルに追加する。
//
// 注意: このファイルは src 外なので tsc の型チェックゲート対象外。
//        dev 起動時のみ Vite プラグインから動的 import される。

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Server } from 'node:http';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { createInitialGameState } from '../src/engine/createState';
import { maskStateFor } from '../src/engine/mask';
import { applyAction } from '../src/engine/game';
import { buildActionLog, MAX_LOG_ENTRIES } from '../src/engine/log';
import { nextCpuAction, cpuFallbackAction } from '../src/engine/lanCpu';
import { generateRandomPlayerName, resolveUniqueName, pickCpuName } from '../src/net/names';
import { RESOURCE_TYPES } from '../src/constants';
import { LAN_WS_PATH } from '../src/net/protocol';
import type { ClientMessage, ServerMessage, LobbyPlayer, LanOrderMode } from '../src/net/protocol';
import type { PlayerId, PlayerColor, GameState, Action, LogEntry, AiDifficulty } from '../src/types';
import type { PlayerSpec } from '../src/engine/createState';
import type { PlayerOrderMode } from '../src/engine/setup';

// LAN 同期する Action（サーバ側ホワイトリスト）。
// MVP4 で交易・捨て札・盗賊・発展カード使用・勝利まで全主要操作を許可する。
const LAN_ALLOWED_ACTIONS = new Set<Action['type']>([
  // 基本操作（MVP3）
  'ROLL_DICE', 'BUILD_ROAD', 'BUILD_SETTLEMENT', 'BUILD_CITY',
  'BUY_DEV_CARD', 'END_TURN', 'DECLARE_VICTORY',
  // 7 / 捨て札 / 盗賊（MVP4）
  'MOVE_ROBBER', 'DISCARD_RESOURCES',
  // 交易（MVP4）
  'OFFER_TRADE', 'RESPOND_TRADE', 'CONFIRM_TRADE', 'CANCEL_TRADE', 'BANK_TRADE',
  // 発展カード使用（MVP4）
  'PLAY_KNIGHT', 'PLAY_ROAD_BUILDING', 'PLAY_YEAR_OF_PLENTY', 'PLAY_MONOPOLY',
  'FINISH_ROAD_BUILDING',
]);

// その Action を実行してよいプレイヤー（actor）。送信者の id と一致せねば拒否。
function requiredActor(state: GameState, action: Action): PlayerId | null {
  switch (action.type) {
    case 'DISCARD_RESOURCES': return action.playerId;
    case 'RESPOND_TRADE':     return action.response.playerId;
    default:                  return state.playerOrder[state.currentPlayerIndex] ?? null;
  }
}

const PLAYER_IDS: PlayerId[] = ['player1', 'player2', 'player3', 'player4'];
const PLAYER_COLORS: PlayerColor[] = ['red', 'blue', 'purple', 'orange'];
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

// CPU の一手ごとのディレイ(ms)。人間が何が起きたか追えるよう待つ。
// ダイス後は出目演出が見えるよう長めにする。
const CPU_STEP_MS = 850;
const CPU_AFTER_ROLL_MS = 1700;

// 切断したメンバーを保持して再接続を待つ猶予(ms)。これを過ぎたら解放する。
const DISCONNECT_GRACE_MS = 90_000;

interface Member {
  ws: WebSocket | null;       // 切断中は null
  id: PlayerId;
  name: string;
  isHost: boolean;
  connected: boolean;
  token: string;              // 再接続用の秘密トークン
  graceTimer: ReturnType<typeof setTimeout> | null; // 切断後の解放タイマー
}

interface Room {
  code: string;
  members: Member[];          // 人間プレイヤー（socketを持つ）。CPUは含まない。
  started: boolean;
  state: GameState | null;
  cpuCount: number;           // CPU 人数（0..3、ホストが設定）
  cpuTimer: ReturnType<typeof setTimeout> | null; // サーバ側CPU駆動タイマー
  // CPU のランダム3文字名。ルームで一度決めたら固定（再接続・人数変更でも維持）。
  cpuNames: string[];
  cpuDifficulty: AiDifficulty;  // ホスト設定のCPU強さ（弱い/普通/強い）
  orderMode: LanOrderMode;      // ホスト設定の手番順（ランダム/入室順）
  // 視点別ログ（playerId → ログ配列）。各端末に「自分視点」のログを配信するため。
  memberLogs: Record<string, LogEntry[]>;
}

const rooms = new Map<string, Room>();

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// 再接続トークンは「同一プレイヤーとして復帰＝相手の手札も見える」認証情報なので、
// 推測可能だとセッション乗っ取り（秘匿漏洩）につながる。CSPRNG で生成する。
function genToken(): string {
  return randomBytes(32).toString('base64url');
}

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// 空いている最小スロット（player1..4）を返す。満員なら null。
function nextSlot(room: Room): PlayerId | null {
  const used = new Set(room.members.map(m => m.id));
  for (const id of PLAYER_IDS) {
    if (!used.has(id)) return id;
  }
  return null;
}

function colorFor(id: PlayerId): PlayerColor {
  return PLAYER_COLORS[PLAYER_IDS.indexOf(id)] ?? 'red';
}

const connectedHumans = (room: Room): number => room.members.filter(m => m.connected).length;

// CPU に割り当てる空きスロット（人間が使っていない player1..4 の先頭から cpuCount 個）。
function cpuSlots(room: Room): PlayerId[] {
  const used = new Set(room.members.map(m => m.id));
  return PLAYER_IDS.filter(id => !used.has(id)).slice(0, room.cpuCount);
}

// 人間＋CPU が 4 を超えないよう CPU 人数をクランプする。
function clampCpu(room: Room): void {
  const maxCpu = Math.max(0, MAX_PLAYERS - room.members.length);
  room.cpuCount = Math.min(Math.max(0, room.cpuCount), maxCpu);
}

// CPU 名をルーム単位で固定割り当て（不足分のみ追加。人間名・既存CPU名と重複回避）。
// 一度決めた名前は room.cpuNames に残るので、人数変更・再接続後も同じ名前を維持する。
function cpuNamesFor(room: Room, count: number): string[] {
  const humanNames = room.members.map(m => m.name);
  while (room.cpuNames.length < count) {
    room.cpuNames.push(pickCpuName([...humanNames, ...room.cpuNames]));
  }
  return room.cpuNames.slice(0, count);
}

function lobbyPlayers(room: Room): LobbyPlayer[] {
  const humans: LobbyPlayer[] = [...room.members]
    .sort((a, b) => PLAYER_IDS.indexOf(a.id) - PLAYER_IDS.indexOf(b.id))
    .map(m => ({ id: m.id, name: m.name, color: colorFor(m.id), isHost: m.isHost, connected: m.connected, isCpu: false }));
  const cpuNames = cpuNamesFor(room, cpuSlots(room).length);
  const cpus: LobbyPlayer[] = cpuSlots(room).map((id, i) => ({
    id, name: cpuNames[i] ?? `CPU${i + 1}`, color: colorFor(id), isHost: false, connected: true, isCpu: true,
  }));
  return [...humans, ...cpus];
}

function lanHostUrls(port: number): string[] {
  const urls: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        urls.push(`http://${info.address}:${port}/`);
      }
    }
  }
  return urls;
}

function broadcastLobby(room: Room, urls: string[]): void {
  clampCpu(room);
  const humans = connectedHumans(room);
  const total = humans + room.cpuCount;
  const msg: ServerMessage = {
    t: 'lobby',
    code: room.code,
    hostUrls: urls,
    players: lobbyPlayers(room),
    // 人間が1人以上、合計2〜4人なら開始可（CPUだけの対戦は不可）
    canStart: humans >= 1 && total >= MIN_PLAYERS && total <= MAX_PLAYERS,
    cpuCount: room.cpuCount,
    maxCpu: Math.max(0, MAX_PLAYERS - humans),
    cpuDifficulty: room.cpuDifficulty,
    orderMode: room.orderMode,
  };
  for (const m of room.members) send(m.ws, msg);
}

// 更新後の正本 state を、各メンバーへ視点別マスク＋視点別ログで配信する。
// ログは buildActionLog を「その視点(m.id)」で生成するため、自分の獲得内訳や
// 「あなた」表記が各端末で正しくなり、他人の資源獲得内訳も漏れない。
function broadcastState(room: Room, prev: GameState, action: Action, byPid: PlayerId): void {
  if (!room.state) return;
  for (const m of room.members) {
    if (!m.connected) continue;
    const entries = buildActionLog(prev, action, room.state, m.id);
    const log = [...(room.memberLogs[m.id] ?? []), ...entries].slice(-MAX_LOG_ENTRIES);
    room.memberLogs[m.id] = log;
    send(m.ws, { t: 'state', state: { ...maskStateFor(room.state, m.id), log }, action, by: byPid });
  }
}

function startGame(room: Room): void {
  clampCpu(room);
  const ordered = [...room.members].sort((a, b) => PLAYER_IDS.indexOf(a.id) - PLAYER_IDS.indexOf(b.id));
  const humanSpecs: PlayerSpec[] = ordered.map(m => ({
    id: m.id,
    name: m.name,
    color: colorFor(m.id),
    type: 'human' as const,
  }));
  // CPU は空きスロットへ割り当て（type:'ai'）。難易度はホスト設定、名前はルーム固定のランダム3文字名。
  const cpuNames = cpuNamesFor(room, cpuSlots(room).length);
  const cpuSpecs: PlayerSpec[] = cpuSlots(room).map((id, i) => ({
    id,
    name: cpuNames[i] ?? `CPU${i + 1}`,
    color: colorFor(id),
    type: 'ai' as const,
    aiDifficulty: room.cpuDifficulty,
  }));
  // 手番順はホスト設定。joined=入室順(spec順をそのまま固定) / random=シャッフル。
  // 乱数（ダイス/山札/盤面/CPU判断）はすべてサーバ側。
  const allSpecs = [...humanSpecs, ...cpuSpecs];
  const orderMode: PlayerOrderMode = room.orderMode === 'joined' ? 'fixed' : 'random';
  const orderSpec = room.orderMode === 'joined' ? allSpecs.map(s => s.id) : undefined;
  const state = createInitialGameState(allSpecs, orderMode, orderSpec);
  room.started = true;
  room.state = state;
  room.memberLogs = {};
  for (const m of room.members) {
    room.memberLogs[m.id] = [];
    send(m.ws, { t: 'started', you: m.id, state: maskStateFor(state, m.id) });
  }
  // 開始直後の手番が CPU の場合に備えて CPU 駆動を起動。
  scheduleCpuTick(room, CPU_STEP_MS);
}

// ============================================================
// サーバ側 CPU 駆動（混合対戦）
// ============================================================

// CPU 駆動の観測用カウンタ（テスト/手順での追跡用。秘匿情報は含めない）。
export const cpuDriveStats = { steps: 0, fallbacks: 0 };

// CPU が動く必要があれば、delay 後に一手だけ適用して配信し、再スケジュールする。
// 人間の手番・人間の入力待ち・GAME_OVER になれば停止する。
function scheduleCpuTick(room: Room, delay: number): void {
  if (room.cpuTimer) { clearTimeout(room.cpuTimer); room.cpuTimer = null; }
  if (!room.started || !room.state || room.state.phase === 'GAME_OVER') return;
  if (!nextCpuAction(room.state)) return; // 今は CPU が動く場面ではない
  room.cpuTimer = setTimeout(() => {
    room.cpuTimer = null;
    if (!room.started || !room.state || room.state.phase === 'GAME_OVER') return;
    const step = nextCpuAction(room.state, Math.random);
    if (!step) return; // 人間の番になった等
    const applied = applyCpuStep(room, step.pid, step.action);
    if (!applied) return; // 適用できず（極めて稀）。人間操作/再接続を待つ。
    // 次の CPU 手番へ。ダイス後は演出ぶん長めに待つ。
    const nextDelay = applied === 'ROLL_DICE' ? CPU_AFTER_ROLL_MS : CPU_STEP_MS;
    scheduleCpuTick(room, nextDelay);
  }, delay);
}

// CPU の一手を適用して配信する。失敗時はフェーズ別の安全行動でフォールバックし、
// それでも失敗したら（極めて稀）進行を止めずに停止する。
// 返り値: 適用できた Action の type（再スケジュール判定用）/ 失敗なら null。
function applyCpuStep(room: Room, pid: PlayerId, action: Action): Action['type'] | null {
  if (!room.state) return null;
  try {
    const prev = room.state;
    const next = applyAction(prev, action, Math.random);
    room.state = next;
    cpuDriveStats.steps++;
    broadcastState(room, prev, action, pid);
    return action.type;
  } catch (err) {
    // 本来成功すべき CPU Action が失敗した。秘匿情報は出さず type と理由のみ記録する。
    cpuDriveStats.fallbacks++;
    console.warn(`[LAN-CPU] action ${action.type} by ${pid} failed; falling back. reason: ${(err as Error)?.message ?? 'unknown'}`);
    try {
      const prev = room.state;
      const cur = prev.playerOrder[prev.currentPlayerIndex];
      // フォールバックの actor: 捨て札/交易応答は対象本人、それ以外は手番者。
      const fbActor = (action.type === 'DISCARD_RESOURCES' || action.type === 'RESPOND_TRADE') ? pid : (cur ?? pid);
      const fb = cpuFallbackAction(prev, fbActor as PlayerId);
      const next = applyAction(prev, fb, Math.random);
      room.state = next;
      broadcastState(room, prev, fb, fbActor as PlayerId);
      return fb.type;
    } catch (err2) {
      console.warn(`[LAN-CPU] fallback also failed: ${(err2 as Error)?.message ?? 'unknown'}`);
      return null;
    }
  }
}

/**
 * Vite dev サーバの HTTP サーバへ LAN WebSocket を相乗りさせる。
 * @param httpServer    Vite の Node HTTP サーバ
 * @param fallbackPort  address() が取れない場合のポート（既定 5173）
 */
export function attachLanServer(httpServer: Server, fallbackPort = 5173): void {
  const wss = new WebSocketServer({ noServer: true });

  // ホスト URL 表示用に、実際に listen しているポートを動的取得する。
  const currentUrls = (): string[] => {
    const addr = httpServer.address();
    const port = addr && typeof addr === 'object' && addr.port ? addr.port : fallbackPort;
    return lanHostUrls(port);
  };

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { /* noop */ }
    // /lan 以外（Vite HMR 等）は触らない＝他のリスナに委ねる
    if (pathname !== LAN_WS_PATH) return;
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let me: Member | null = null;

    ws.on('message', (data: unknown) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(data)); } catch { return; }

      switch (msg.t) {
        case 'create': {
          if (room) return;
          const code = genCode();
          room = { code, members: [], started: false, state: null, cpuCount: 0, cpuTimer: null, cpuNames: [], cpuDifficulty: 'normal', orderMode: 'random', memberLogs: {} };
          rooms.set(code, room);
          me = { ws, id: 'player1', name: assignName(msg.name, room), isHost: true, connected: true, token: genToken(), graceTimer: null };
          room.members.push(me);
          send(ws, { t: 'joined', code, you: me.id, isHost: true, token: me.token, started: false });
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'join': {
          if (room) return;
          const target = rooms.get((msg.code || '').toUpperCase());
          if (!target) { send(ws, { t: 'error', message: 'ルームが見つかりません' }); return; }
          if (target.started) { send(ws, { t: 'error', message: 'このルームは既に開始済みです' }); return; }
          const slot = nextSlot(target);
          if (!slot) { send(ws, { t: 'error', message: 'ルームが満員です（最大4人）' }); return; }
          room = target;
          me = { ws, id: slot, name: assignName(msg.name, target), isHost: false, connected: true, token: genToken(), graceTimer: null };
          room.members.push(me);
          send(ws, { t: 'joined', code: room.code, you: me.id, isHost: false, token: me.token, started: false });
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'resume': {
          // 再接続: 同一プレイヤー(token一致)として復帰する。新規プレイヤーは増やさない。
          if (room) return;
          const target = rooms.get((msg.code || '').toUpperCase());
          if (!target) { send(ws, { t: 'error', message: '接続が切れました。ルームに入り直してください', fatal: true }); return; }
          const member = target.members.find(m => m.id === msg.you && m.token === msg.token);
          if (!member) { send(ws, { t: 'error', message: '接続が切れました。ルームに入り直してください', fatal: true }); return; }
          // 二重接続: 古い接続があれば無効化（新しい接続を正とする）。
          if (member.ws && member.ws !== ws) { try { member.ws.close(); } catch { /* noop */ } }
          if (member.graceTimer) { clearTimeout(member.graceTimer); member.graceTimer = null; }
          member.ws = ws;
          member.connected = true;
          room = target;
          me = member;
          send(ws, { t: 'joined', code: target.code, you: member.id, isHost: member.isHost, token: member.token, started: target.started });
          if (target.started && target.state) {
            // ゲーム中: 現在の視点別マスク state ＋ 自分視点ログで再同期。
            send(ws, { t: 'started', you: member.id, state: { ...maskStateFor(target.state, member.id), log: target.memberLogs[member.id] ?? [] } });
            // 復帰を他プレイヤーへ通知＋CPU駆動を再評価（手番待ち解消の場合に備える）。
            notifyReconnect(target, member.name);
            scheduleCpuTick(target, CPU_STEP_MS);
          } else {
            broadcastLobby(target, currentUrls());
          }
          break;
        }
        case 'rename': {
          if (!room || !me || room.started) return;
          me.name = assignName(msg.name, room, me);
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'setCpu': {
          // CPU 人数の設定はホストのみ・ロビー中のみ。
          if (!room || !me || !me.isHost || room.started) return;
          const n = Number.isFinite(msg.count) ? Math.floor(msg.count) : 0;
          room.cpuCount = n; // clampCpu は broadcastLobby 内で適用
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'setConfig': {
          // CPU強さ・手番順の設定はホストのみ・ロビー中のみ。参加者からは変更不可。
          if (!room || !me || !me.isHost || room.started) return;
          if (msg.cpuDifficulty === 'weak' || msg.cpuDifficulty === 'normal' || msg.cpuDifficulty === 'strong') {
            room.cpuDifficulty = msg.cpuDifficulty;
          }
          if (msg.orderMode === 'random' || msg.orderMode === 'joined') {
            room.orderMode = msg.orderMode;
          }
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'start': {
          if (!room || !me || !me.isHost || room.started) return;
          clampCpu(room);
          const humans = connectedHumans(room);
          const total = humans + room.cpuCount;
          if (humans < 1 || total < MIN_PLAYERS || total > MAX_PLAYERS) {
            send(ws, { t: 'error', message: '人間1人以上・合計2〜4人で開始できます' });
            return;
          }
          startGame(room);
          break;
        }
        case 'action': {
          // ルーム所属・開始済み・正本stateの存在を確認
          if (!room || !me || !room.started || !room.state) return;
          const action = msg.action;
          if (!action || !LAN_ALLOWED_ACTIONS.has(action.type)) {
            send(ws, { t: 'error', message: 'この操作はまだLAN対戦に対応していません' });
            return;
          }
          // 操作権限: actor が送信者本人か（非手番/別IDは拒否）
          const actor = requiredActor(room.state, action);
          if (actor !== me.id) {
            send(ws, { t: 'error', message: 'あなたの操作できる場面ではありません' });
            return;
          }
          // 交易応答は「交易対象に含まれるプレイヤー」のみ許可（対象外を拒否）
          if (action.type === 'RESPOND_TRADE') {
            const pt = room.state.pendingTrade;
            if (!pt || !pt.targetPlayerIds.includes(action.response.playerId)) {
              send(ws, { t: 'error', message: '交易の対象ではありません' });
              return;
            }
          }
          // 捨て札は「手札の半分(切り捨て)を、所持範囲内で」のみ許可（不足/過剰を拒否）
          if (action.type === 'DISCARD_RESOURCES') {
            const p = room.state.players[action.playerId];
            if (!p) { send(ws, { t: 'error', message: '不明なプレイヤーです' }); return; }
            const handTotal = RESOURCE_TYPES.reduce((s, r) => s + p.hand[r], 0);
            const required = Math.floor(handTotal / 2);
            const res = action.resources as Partial<Record<typeof RESOURCE_TYPES[number], number>>;
            const discardSum = RESOURCE_TYPES.reduce((s, r) => s + (res[r] ?? 0), 0);
            const withinHand = RESOURCE_TYPES.every(r => (res[r] ?? 0) >= 0 && (res[r] ?? 0) <= p.hand[r]);
            if (handTotal < 8 || discardSum !== required || !withinHand) {
              send(ws, { t: 'error', message: '捨て札の枚数が正しくありません' });
              return;
            }
          }
          try {
            const prev = room.state;
            // 乱数（ダイス/山札/盗賊奪取）はすべてサーバ側で確定する
            const next = applyAction(prev, action, Math.random);
            room.state = next;
            // 視点別ログは broadcastState 内で各メンバー視点に生成する
            broadcastState(room, prev, action, me.id);
            // 人間の操作後に CPU の手番/応答が来る場合は CPU 駆動を起動。
            scheduleCpuTick(room, action.type === 'ROLL_DICE' ? CPU_AFTER_ROLL_MS : CPU_STEP_MS);
          } catch {
            // applyAction が弾いた無効操作（送信者にのみ通知）
            send(ws, { t: 'error', message: '無効な操作です' });
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (!room || !me) return;
      // この ws が現在のメンバーの ws でない（既に別接続に置き換わった）なら無視。
      if (me.ws !== ws) return;
      me.connected = false;
      me.ws = null;
      if (!room.started) {
        // 開始前: 即削除せず猶予を持たせ、同一端末の再接続(resume)で復帰できるようにする。
        broadcastLobby(room, currentUrls());
        scheduleMemberRelease(room, me);
      } else {
        // 開始後: 切断を記録。残りの人間へ配信は継続。
        if (connectedHumans(room) === 0) {
          // 観戦者ゼロなら CPU 駆動を一時停止（再接続で再開）。ルームは猶予中は保持。
          if (room.cpuTimer) { clearTimeout(room.cpuTimer); room.cpuTimer = null; }
        } else {
          notifyDisconnect(room, me.name);
        }
        scheduleMemberRelease(room, me);
      }
    });
  });
}

// 切断メンバーを猶予後に解放する（再接続が来なければ枠を空ける）。
function scheduleMemberRelease(room: Room, member: Member): void {
  if (member.graceTimer) clearTimeout(member.graceTimer);
  member.graceTimer = setTimeout(() => {
    member.graceTimer = null;
    if (member.connected) return; // 既に再接続済み
    room.members = room.members.filter(m => m !== member);
    if (!room.started) {
      // ホストが抜けたままなら残りの先頭をホストに昇格
      if (member.isHost && room.members.length > 0 && !room.members.some(m => m.isHost)) {
        room.members[0]!.isHost = true;
      }
    }
    // 誰もいなくなったら CPU を止めてルーム破棄
    if (room.members.length === 0) {
      if (room.cpuTimer) { clearTimeout(room.cpuTimer); room.cpuTimer = null; }
      rooms.delete(room.code);
      return;
    }
    if (!room.started) broadcastLobby(room, lanHostUrls(5173));
  }, DISCONNECT_GRACE_MS);
}

function sanitizeName(raw: string): string {
  // 空でもここでは補完しない（空判定を assignName に委ねる）。
  return (raw ?? '').toString().trim().slice(0, 20);
}

// ルーム内の他メンバー名と重複しない名前を割り当てる。
// 空入力ならランダムなカタカナ名を生成。明示入力は尊重しつつ重複だけ回避する。
function assignName(raw: string, room: Room, exclude?: Member): string {
  const existing = room.members.filter(m => m !== exclude).map(m => m.name);
  const requested = sanitizeName(raw) || generateRandomPlayerName(existing);
  return resolveUniqueName(requested, existing);
}

// ゲーム中の切断/再接続を、接続中の人間へシステムログ＋現在stateで知らせる。
function notifySystem(room: Room, message: string): void {
  if (!room.state) return;
  const entry: LogEntry = {
    turn: room.state.globalTurnNumber,
    playerId: room.state.playerOrder[room.state.currentPlayerIndex] ?? 'player1',
    type: 'SYSTEM',
    message,
  };
  for (const m of room.members) {
    if (!m.connected || !m.ws) continue;
    const log = [...(room.memberLogs[m.id] ?? []), entry].slice(-MAX_LOG_ENTRIES);
    room.memberLogs[m.id] = log;
    send(m.ws, { t: 'state', state: { ...maskStateFor(room.state, m.id), log } });
  }
}
function notifyDisconnect(room: Room, name: string): void { notifySystem(room, `🔌 ${name} が切断しました`); }
function notifyReconnect(room: Room, name: string): void { notifySystem(room, `🔄 ${name} が再接続しました`); }
