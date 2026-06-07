// ============================================================
// src/net/lanClient.ts — LAN対戦 WebSocket クライアント（ブラウザ）
// ============================================================
//
// dev サーバと同一オリジンの /lan へ接続する薄いラッパー。
// 受信メッセージはハンドラへそのまま渡し、UI 側（lanLobby / main）が解釈する。

import { LAN_WS_PATH } from './protocol';
import type { ClientMessage, ServerMessage } from './protocol';

export type LanHandler = (msg: ServerMessage) => void;

// 接続先 WebSocket URL を解決する。
// VITE_LAN_SERVER_URL が設定されていればそのホスト（別オリジンの本番サーバ）へ、
// 未設定なら現在ページと同一オリジンの /lan へ接続する（ローカル dev / LAN 対戦）。
function lanServerUrl(): string {
  const base = import.meta.env.VITE_LAN_SERVER_URL?.trim();
  if (base) {
    // 末尾スラッシュを除いて /lan を付与（wss://host や wss://host/ の両方を許容）。
    return `${base.replace(/\/$/, '')}${LAN_WS_PATH}`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${LAN_WS_PATH}`;
}

export class LanClient {
  private ws: WebSocket | null = null;
  private handler: LanHandler;
  private onClose: (() => void) | null = null;
  private closedByUs = false;

  constructor(handler: LanHandler) {
    this.handler = handler;
  }

  /** 受信ハンドラを差し替える（ロビー → ゲーム本体へ受け渡す際に使用）。 */
  setHandler(handler: LanHandler): void {
    this.handler = handler;
  }

  /** 予期しない切断時のコールバックを設定（設定時は fatal エラーを投げず再接続に委ねる）。 */
  setOnClose(cb: () => void): void {
    this.onClose = cb;
  }

  /**
   * 対戦サーバの /lan へ接続。open で resolve、失敗で reject。
   * 接続先はビルド時環境変数 VITE_LAN_SERVER_URL で切り替える:
   *   - 設定あり（例 wss://catan-xxxx.onrender.com）… その別ホストへ接続。
   *     GitHub Pages など、サーバが別オリジンに居る本番構成で使う。
   *   - 未設定 … 従来どおり同一オリジンの /lan へ接続（ローカル dev / LAN 対戦）。
   */
  connect(): Promise<void> {
    const url = lanServerUrl();
    this.ws = new WebSocket(url);
    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('サーバに接続できませんでした'));
      ws.onmessage = (ev: MessageEvent) => {
        let msg: ServerMessage;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        this.handler(msg);
      };
      ws.onclose = () => {
        if (this.closedByUs) return;
        // 再接続コールバックがあれば委ねる（fatal にしない）。無ければ従来どおり致命扱い。
        if (this.onClose) this.onClose();
        else this.handler({ t: 'error', message: 'サーバとの接続が切れました', fatal: true });
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }
}
