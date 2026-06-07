/// <reference types="vite/client" />
// Vite が注入する import.meta.env（BASE_URL など）の型定義を有効化する。
// これが無いと build スクリプトの `tsc` 型チェックで import.meta.env が未定義扱いになる。
