/// <reference types="vite/client" />
// Vite が注入する import.meta.env（BASE_URL など）の型定義を有効化する。
// これが無いと build スクリプトの `tsc` 型チェックで import.meta.env が未定義扱いになる。

// アプリ独自のビルド時環境変数を型付けする。
//   VITE_LAN_SERVER_URL … オンライン対戦サーバの接続先（例 wss://catan-xxxx.onrender.com）。
//     未設定なら同一オリジンの /lan へ接続する（lanClient.ts 参照）。
interface ImportMetaEnv {
  readonly VITE_LAN_SERVER_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
