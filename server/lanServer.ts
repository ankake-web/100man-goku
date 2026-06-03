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
import { createInitialGameState } from '../src/engine/createState';
import { maskStateFor } from '../src/engine/mask';
import { LAN_WS_PATH } from '../src/net/protocol';
import type { ClientMessage, ServerMessage, LobbyPlayer } from '../src/net/protocol';
import type { PlayerId, PlayerColor, GameState } from '../src/types';
import type { PlayerSpec } from '../src/engine/createState';

const PLAYER_IDS: PlayerId[] = ['player1', 'player2', 'player3', 'player4'];
const PLAYER_COLORS: PlayerColor[] = ['red', 'blue', 'purple', 'orange'];
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

interface Member {
  ws: WebSocket;
  id: PlayerId;
  name: string;
  isHost: boolean;
  connected: boolean;
}

interface Room {
  code: string;
  members: Member[];
  started: boolean;
  state: GameState | null;
}

const rooms = new Map<string, Room>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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

function lobbyPlayers(room: Room): LobbyPlayer[] {
  // 手番スロット順（player1..4）で安定表示
  return [...room.members]
    .sort((a, b) => PLAYER_IDS.indexOf(a.id) - PLAYER_IDS.indexOf(b.id))
    .map(m => ({ id: m.id, name: m.name, color: colorFor(m.id), isHost: m.isHost, connected: m.connected }));
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
  const connected = room.members.filter(m => m.connected).length;
  const msg: ServerMessage = {
    t: 'lobby',
    code: room.code,
    hostUrls: urls,
    players: lobbyPlayers(room),
    canStart: connected >= MIN_PLAYERS && connected <= MAX_PLAYERS,
  };
  for (const m of room.members) send(m.ws, msg);
}

function startGame(room: Room): void {
  const ordered = [...room.members].sort((a, b) => PLAYER_IDS.indexOf(a.id) - PLAYER_IDS.indexOf(b.id));
  const specs: PlayerSpec[] = ordered.map(m => ({
    id: m.id,
    name: m.name,
    color: colorFor(m.id),
    type: 'human' as const,
  }));
  // LAN は人間のみ。手番順はランダム。乱数（ダイス/山札/盤面）はすべてサーバ側。
  const state = createInitialGameState(specs, 'random', undefined);
  room.started = true;
  room.state = state;
  for (const m of room.members) {
    send(m.ws, { t: 'started', you: m.id, state: maskStateFor(state, m.id) });
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
          room = { code, members: [], started: false, state: null };
          rooms.set(code, room);
          me = { ws, id: 'player1', name: sanitizeName(msg.name), isHost: true, connected: true };
          room.members.push(me);
          send(ws, { t: 'joined', code, you: me.id, isHost: true });
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
          me = { ws, id: slot, name: sanitizeName(msg.name), isHost: false, connected: true };
          room.members.push(me);
          send(ws, { t: 'joined', code: room.code, you: me.id, isHost: false });
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'rename': {
          if (!room || !me || room.started) return;
          me.name = sanitizeName(msg.name);
          broadcastLobby(room, currentUrls());
          break;
        }
        case 'start': {
          if (!room || !me || !me.isHost || room.started) return;
          const connected = room.members.filter(m => m.connected).length;
          if (connected < MIN_PLAYERS) { send(ws, { t: 'error', message: '2人以上で開始できます' }); return; }
          startGame(room);
          break;
        }
        case 'action': {
          // MVP3 以降で applyAction 適用＋配信を実装する。
          break;
        }
      }
    });

    ws.on('close', () => {
      if (!room || !me) return;
      if (!room.started) {
        // 開始前: スロットを解放（残りメンバーの id は据え置き＝各端末の you が安定）
        room.members = room.members.filter(m => m !== me);
        if (room.members.length === 0) {
          rooms.delete(room.code);
          return;
        }
        // ホストが抜けたら残りの先頭をホストに昇格
        if (me.isHost && !room.members.some(m => m.isHost)) {
          room.members[0]!.isHost = true;
        }
        broadcastLobby(room, currentUrls());
      } else {
        // 開始後: 切断を記録（再接続/進行ハンドリングは MVP3 以降）
        me.connected = false;
        broadcastLobby(room, currentUrls());
      }
    });
  });
}

function sanitizeName(raw: string): string {
  const name = (raw ?? '').toString().trim().slice(0, 20);
  return name || 'プレイヤー';
}
