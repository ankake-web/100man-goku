// ============================================================
// src/net/lanClient.ts — LAN対戦 WebSocket クライアント（ブラウザ）
// ============================================================
//
// dev サーバと同一オリジンの /lan へ接続する薄いラッパー。
// 受信メッセージはハンドラへそのまま渡し、UI 側（lanLobby / main）が解釈する。

import { LAN_WS_PATH } from './protocol';
import type { ClientMessage, ServerMessage } from './protocol';

export type LanHandler = (msg: ServerMessage) => void;

export class LanClient {
  private ws: WebSocket | null = null;
  private handler: LanHandler;
  private closedByUs = false;

  constructor(handler: LanHandler) {
    this.handler = handler;
  }

  /** 受信ハンドラを差し替える（ロビー → ゲーム本体へ受け渡す際に使用）。 */
  setHandler(handler: LanHandler): void {
    this.handler = handler;
  }

  /** 同一オリジンの /lan へ接続。open で resolve、失敗で reject。 */
  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${LAN_WS_PATH}`;
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
        if (!this.closedByUs) {
          this.handler({ t: 'error', message: 'サーバとの接続が切れました' });
        }
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
