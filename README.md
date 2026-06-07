# 🎲 カタン (Catan)

ブラウザで遊べるカタン（Settlers of Catan）風ボードゲーム。CPU 対戦と、同じ Wi‑Fi / LAN・インターネット越しのオンライン対戦に対応。TypeScript + Vite + 素の DOM/SVG で実装し、ゲームエンジンは純粋関数として分離してテストしています。

- **CPU 対戦** … 1〜3 体の CPU と対戦。難易度（弱 / 普通 / 強）・速度・手番順を選択可能。
- **オンライン対戦** … 数字4桁のルームコードで参加。切断時は AI が代行し、再接続で復帰できます。手札・発展カードは視点別マスクで秘匿。
- **スマホ対応** … タップの最近傍スナップ、配置の確認ステップ、盤面のピンチズーム＆パン。
- **演出 / サウンド** … ダイス・資源獲得・盗賊・勝利などの演出と効果音/BGM。`prefers-reduced-motion` を尊重。

## 技術スタック

| 領域 | 採用 |
|------|------|
| 言語 | TypeScript（strict） |
| ビルド/開発 | Vite |
| UI | 素の DOM + SVG（フレームワークなし） |
| オンライン対戦サーバ | Node + [`ws`](https://github.com/websockets/ws)（WebSocket） |
| テスト | Vitest（516 件）／実プレイ確認に Playwright |

ゲームのルールロジック（`src/engine/`）は副作用のない純粋関数で、`applyAction(state, action)` のリデューサ方式。UI 層（`src/renderer/`, `src/main.ts`）から独立して単体テストしています。

## セットアップ

必要環境: **Node.js 20** 以上。

```bash
npm install
```

## 開発

```bash
# クライアント（ブラウザ）を開発サーバで起動 → http://localhost:5173
npm run dev

# 同じ LAN 内の別端末からアクセスできるように起動（スマホ実機確認用）
npm run dev:lan

# オンライン対戦サーバ（WebSocket, 既定 :8787 / パス /lan）を起動
npm start

# テスト / 型チェック
npm test                 # vitest run
npm run test:watch
npm run typecheck        # クライアント
npm run typecheck:test   # テスト
```

CPU 対戦はクライアント単体で完結します（サーバ不要）。オンライン対戦を試すときは別ターミナルで `npm start`（サーバ）を起動してください。

## ビルド

```bash
npm run build   # tsc で型チェック → vite build（出力: dist/）
```

## オンライン対戦の構成

クライアント（静的サイト）と対戦サーバ（WebSocket）を分けてデプロイします。

- **クライアント**: GitHub Pages（`.github/workflows/deploy.yml` が `main` への push で自動ビルド/公開）。
- **サーバ**: Render の Web Service（`render.yaml`、`npm start` = `tsx server/index.ts`、ヘルスチェック `GET /health`）。

### 環境変数

| 変数 | 場所 | 役割 |
|------|------|------|
| `VITE_LAN_SERVER_URL` | クライアントのビルド時 | 対戦サーバの接続先（`wss://<host>/lan` 形式）。未設定なら同一ホスト推測にフォールバック。 |
| `ALLOWED_ORIGINS` | サーバ（本番） | 接続を許可する Origin のカンマ区切りリスト（例 `https://<user>.github.io`）。スキーム+ホストのみ、パスは含めない。 |
| `PORT` | サーバ | listen ポート。ホスティングが注入。未設定なら `8787`。 |

機密値はリポジトリにコミットせず、各ホスティングのダッシュボード/Secrets で設定します。

## ディレクトリ構成

```
src/
  engine/      ゲームルール（純粋関数）: game.ts(reducer), actions, robber, trade,
               scoring, dice, setup, ai, lanCpu, mask, createState, board(幾何), recap, log
  renderer/    描画とイベント: board.ts(SVG), ui.ts(パネル/モーダル), events.ts(タップ/ジェスチャ)
  net/         オンライン対戦クライアント: lanLobby, lanClient, protocol, resume, names
  main.ts      コントローラ（状態/dispatch/演出/ライフサイクル）
  audio.ts     BGM / 効果音
  style.css    スタイル（:root にデザイントークン）
server/        オンライン対戦サーバ（lanServer.ts / index.ts）
tests/         Vitest テスト
docs/          仕様・監査・ルールなどのドキュメント
```

## テスト

```bash
npm test
```

ルールエンジン・AI・LAN 同期・スコアリングなどを 516 件のテストでカバーしています。UI の最終的な見た目・操作感は実機/ブラウザでの目視確認が前提です（`docs/manual_playtest_report.md` 参照）。

## ドキュメント

- `docs/rules.md` … ゲームルール
- `docs/tech_spec.md` / `docs/home_spec.md` / `docs/trade_spec.md` … 仕様
- `docs/spec_compliance_audit.md` … 仕様準拠監査
- `LAN対戦.md` … オンライン対戦のセットアップメモ
- `PROGRESS.md` … 直近の作業ログ・残タスク・要判断事項
