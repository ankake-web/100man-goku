// ============================================================
// src/net/protocol.ts — LAN対戦 WebSocket メッセージ型（クライアント/サーバ共有）
// ============================================================
//
// サーバ権威モデル:
//   - 正本 state はサーバが保持し、純粋エンジン applyAction で更新する。
//   - クライアントは操作 Action を送るだけ（MVP3 以降）。
//   - サーバは送信者が正しい actor か検証し、適用後、各クライアントへ
//     視点別マスク済み state を配信する。
//
// MVP 1-2 で実際に使うのは create/join/start（C→S）と
// joined/lobby/started/error（S→C）。action / state は MVP3 以降で使う。

import type { GameState, PlayerId, PlayerColor, Action } from '../types';

// WebSocket のパス（Vite dev サーバと同一オリジン上に同居）
export const LAN_WS_PATH = '/lan';

// ロビーに表示する参加者1人分の公開情報
export interface LobbyPlayer {
  readonly id: PlayerId;          // 割り当てられたスロット（player1..4）
  readonly name: string;
  readonly color: PlayerColor;
  readonly isHost: boolean;
  readonly connected: boolean;
}

// ---- クライアント → サーバ ----
export type ClientMessage =
  | { t: 'create'; name: string }                       // ルーム作成（作成者がホスト）
  | { t: 'join';   code: string; name: string }         // ルーム参加
  | { t: 'rename'; name: string }                       // 名前変更（ロビー中）
  | { t: 'start' }                                       // ホストがゲーム開始
  | { t: 'action'; action: Action };                     // 操作（MVP3 以降）

// ---- サーバ → クライアント ----
export type ServerMessage =
  | { t: 'joined'; code: string; you: PlayerId; isHost: boolean }   // 入室確定＋自分のID
  | { t: 'lobby';  code: string; hostUrls: string[]; players: LobbyPlayer[]; canStart: boolean }
  | { t: 'started'; you: PlayerId; state: GameState }               // 開始（state はマスク済み）
  | { t: 'state';   state: GameState; action?: Action; by?: PlayerId } // 状態更新（MVP3 以降）
  | { t: 'error';   message: string };
