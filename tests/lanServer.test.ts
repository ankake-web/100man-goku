// ============================================================
// tests/lanServer.test.ts — LAN サーバ(本物) の統合テスト（M8）
// ============================================================
//
// 目的: lan-sync.test.ts が再実装していた requiredActor / serverGuard の「コピー」
//       ではなく、実際に出荷される server/lanServer.ts を ws で直接駆動して検証する。
//   - 接続ライフサイクル（create / join / start）と視点別マスク配信の配線
//   - 操作権限(actor)ガードの拒否
//   - 実 requiredActor のユニット検証（コピーのドリフト防止）
//   - グループB の回帰: H5（切断→CPU代行でスタールしない）/ M1（再接続でスロット維持）
//
// タイミングは attachLanServer のオプションで短縮注入し、高速・確定的に検証する。

import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { attachLanServer, requiredActor, genCode, __resetRoomsForTest } from '../server/lanServer';
import type { LanServerOptions } from '../server/lanServer';
import { LAN_WS_PATH } from '../src/net/protocol';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { makeGameState } from './helpers';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let server: Server | null = null;
let port = 0;
const clients: TestClient[] = [];

interface TestClient {
  ws: WebSocket;
  send: (m: ClientMessage) => void;
  next: (pred: (m: ServerMessage) => boolean, ms?: number) => Promise<ServerMessage>;
}

async function startServer(opts: LanServerOptions = { graceMs: 200, cpuStepMs: 20, cpuAfterRollMs: 20 }): Promise<void> {
  server = createServer();
  attachLanServer(server, 0, opts);
  await new Promise<void>(res => server!.listen(0, '127.0.0.1', () => res()));
  port = (server!.address() as AddressInfo).port;
}

function connect(): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${LAN_WS_PATH}`);
  const waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void; t: ReturnType<typeof setTimeout> }[] = [];
  ws.on('message', (data: Buffer) => {
    let m: ServerMessage;
    try { m = JSON.parse(String(data)) as ServerMessage; } catch { return; }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(m)) { clearTimeout(waiters[i]!.t); waiters[i]!.res(m); waiters.splice(i, 1); }
    }
  });
  const next = (pred: (m: ServerMessage) => boolean, ms = 2000): Promise<ServerMessage> =>
    new Promise((res, rej) => {
      const t = setTimeout(() => {
        const idx = waiters.findIndex(w => w.t === t);
        if (idx >= 0) waiters.splice(idx, 1);
        rej(new Error('lanServer test: next() timed out'));
      }, ms);
      waiters.push({ pred, res, t });
    });
  const client: TestClient = { ws, send: (m) => ws.send(JSON.stringify(m)), next };
  clients.push(client);
  return new Promise((res, rej) => {
    ws.on('open', () => res(client));
    ws.on('error', rej);
  });
}

const isType = <T extends ServerMessage['t']>(t: T) => (m: ServerMessage): boolean => m.t === t;

// create(host) + join(guest) + start を行い、両者の started を受け取って返す。
async function setupStartedGame() {
  const host = await connect();
  const hjP = host.next(isType('joined'));
  host.send({ t: 'create', name: 'Alice' });
  const hj = await hjP as Extract<ServerMessage, { t: 'joined' }>;

  const guest = await connect();
  const gjP = guest.next(isType('joined'));
  guest.send({ t: 'join', code: hj.code, name: 'Bob' });
  const gj = await gjP as Extract<ServerMessage, { t: 'joined' }>;

  const hsP = host.next(isType('started'));
  const gsP = guest.next(isType('started'));
  host.send({ t: 'start' });
  const hStarted = await hsP as Extract<ServerMessage, { t: 'started' }>;
  const gStarted = await gsP as Extract<ServerMessage, { t: 'started' }>;

  return { host, guest, code: hj.code, hostToken: hj.token, guestToken: gj.token, hStarted, gStarted };
}

afterEach(async () => {
  for (const c of clients) { try { c.ws.terminate(); } catch { /* noop */ } }
  clients.length = 0;
  await delay(50);          // サーバ側 'close' ハンドラを走らせてから
  __resetRoomsForTest();    // 全ルームの保留タイマーを止めて Map を空に
  if (server) { await new Promise<void>(res => server!.close(() => res())); server = null; }
});

describe('genCode (room code)', () => {
  it('always returns a 4-digit string, preserving leading zeros (no numeric coercion)', () => {
    let sawLeadingZero = false;
    for (let i = 0; i < 500; i++) {
      const code = genCode(() => false);
      expect(typeof code).toBe('string');
      expect(code).toMatch(/^\d{4}$/);
      expect(code.length).toBe(4);
      if (code[0] === '0') sawLeadingZero = true;
    }
    // "0042" が 42 にならない＝先頭ゼロ保持。500回も引けば必ず先頭ゼロが出る。
    expect(sawLeadingZero).toBe(true);
  });

  it('never returns a code reported as taken (collision retry works)', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = genCode(c => taken.has(c));
      expect(taken.has(code)).toBe(false); // アクティブな既存コードは決して返さない
      taken.add(code);
    }
    expect(taken.size).toBe(200); // 全て一意
  });

  it('throws when the keyspace is exhausted instead of looping forever', () => {
    expect(() => genCode(() => true)).toThrow();
  });
});

describe('lanServer integration (M8)', () => {
  it('create issues a joined message with a CSPRNG-looking host token', async () => {
    await startServer();
    const host = await connect();
    const p = host.next(isType('joined'));
    host.send({ t: 'create', name: 'Alice' });
    const joined = await p as Extract<ServerMessage, { t: 'joined' }>;
    expect(joined.you).toBe('player1');
    expect(joined.isHost).toBe(true);
    expect(typeof joined.token).toBe('string');
    expect(joined.token.length).toBeGreaterThan(20); // randomBytes(32) base64url
  });

  it('start delivers per-viewer masked state (own hand raw, opponent masked, devDeck hidden)', async () => {
    await startServer();
    const { hStarted, gStarted } = await setupStartedGame();
    expect(hStarted.you).toBe('player1');
    expect(gStarted.you).toBe('player2');

    // host(=player1) 視点: 自分は素の手札（handCount 未設定）、相手はマスク（handCount 設定）
    const hs = hStarted.state;
    expect(hs.players.player1!.handCount).toBeUndefined();
    expect(hs.players.player2!.handCount).not.toBeUndefined();
    expect(hs.players.player2!.devCards).toEqual([]);
    // guest(=player2) 視点では逆になる（クロスリークなし）
    const gs = gStarted.state;
    expect(gs.players.player2!.handCount).toBeUndefined();
    expect(gs.players.player1!.handCount).not.toBeUndefined();
    // devDeck は枚数だけ公開・中身は秘匿（H1 がサーバ配信経路で効いている）
    expect(hs.devDeck.length).toBe(25);
    expect(hs.devDeck.every(c => c.id === '')).toBe(true);
  });

  it('rejects an action sent by a non-current player (actor guard)', async () => {
    await startServer();
    const { host, guest, hStarted } = await setupStartedGame();
    const order = hStarted.state.playerOrder;
    const current = order[hStarted.state.currentPlayerIndex]!;
    const offTurn = current === 'player1' ? guest : host; // 非手番のクライアント
    const errP = offTurn.next(isType('error'));
    offTurn.send({ t: 'action', action: { type: 'BUILD_SETTLEMENT', vertexId: Object.keys(hStarted.state.vertices)[0]! } });
    const err = await errP as Extract<ServerMessage, { t: 'error' }>;
    expect(err.message).toContain('操作できる場面ではありません');
  });

  it('requiredActor (the real exported function): DISCARD→playerId, RESPOND_TRADE→responder, else current', () => {
    const s = makeGameState({ currentPlayerIndex: 0, playerOrder: ['player1', 'player2'] });
    expect(requiredActor(s, { type: 'ROLL_DICE' })).toBe('player1');
    expect(requiredActor(s, { type: 'DISCARD_RESOURCES', playerId: 'player2', resources: {} })).toBe('player2');
    expect(requiredActor(s, { type: 'RESPOND_TRADE', response: { playerId: 'player2', status: 'REJECT' } })).toBe('player2');
  });

  it('H5: when the current player disconnects, the CPU takes over and the game progresses (no stall)', async () => {
    await startServer({ graceMs: 10_000, cpuStepMs: 20, cpuAfterRollMs: 20 });
    const { host, guest, hStarted } = await setupStartedGame();
    const order = hStarted.state.playerOrder;
    const current = order[hStarted.state.currentPlayerIndex]!;
    const currentClient = current === 'player1' ? host : guest;
    const otherClient = current === 'player1' ? guest : host;
    // 切断後、残りのクライアントは「実際に適用された手」を含む state を受け取れる＝代行が進んだ
    const progressed = otherClient.next(m => m.t === 'state' && (m as Extract<ServerMessage, { t: 'state' }>).action != null, 8000);
    currentClient.ws.close();
    const msg = await progressed as Extract<ServerMessage, { t: 'state' }>;
    expect(msg.by).toBe(current);                       // CPU が切断者の代わりに打った
    expect(msg.state.players[current]!.type).toBe('ai'); // 切断者は一時的に AI 化されている
  }, 12_000);

  it('M1: a disconnected player resumes with their token and is restored to human (during grace)', async () => {
    await startServer({ graceMs: 10_000, cpuStepMs: 20, cpuAfterRollMs: 20 });
    const g = await setupStartedGame();
    g.guest.ws.close();
    const back = await connect();
    const jP = back.next(isType('joined'));
    const sP = back.next(isType('started'));
    back.send({ t: 'resume', code: g.code, you: 'player2', token: g.guestToken });
    const joined = await jP as Extract<ServerMessage, { t: 'joined' }>;
    expect(joined.started).toBe(true);
    expect(joined.you).toBe('player2');
    const resync = await sP as Extract<ServerMessage, { t: 'started' }>;
    expect(resync.state.players.player2!.type).toBe('human'); // AI 代行から人間へ復帰
  }, 12_000);

  it('M1: the slot is kept even AFTER the disconnect grace expires (resume still succeeds)', async () => {
    // 旧実装は猶予超過でメンバーを解放し、再接続が fatal になっていた。
    await startServer({ graceMs: 60, cpuStepMs: 20, cpuAfterRollMs: 20 });
    const g = await setupStartedGame();
    g.guest.ws.close();
    await delay(250);          // 猶予(60ms)を確実に超過させる（host は接続したまま）
    const back = await connect();
    const jP = back.next(isType('joined'));
    back.send({ t: 'resume', code: g.code, you: 'player2', token: g.guestToken });
    const joined = await jP as Extract<ServerMessage, { t: 'joined' }>;
    expect(joined.started).toBe(true); // スロットが残っているので復帰できる
    expect(joined.you).toBe('player2');
  }, 12_000);
});
