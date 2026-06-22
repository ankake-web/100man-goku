# 100万石 リスキン作業報告（reskin/100man-goku）

カタン実装を戦国テーマ「100万石」へ**表示テキスト/用語のみ**リスキンした作業の記録。
内部識別子・enum・キー・ロジック・数値・確率・アセットファイル名は不変。用語正典は `docs/reskin/GLOSSARY.md`。

## 作業環境
- 作業フォルダ: `100man-goku/`（`catan/` の git worktree、ブランチ `reskin/100man-goku`）。`catan/main` は無傷。
- `node_modules` は `catan/node_modules` へのジャンクションで共有。

## Phase 0：調査・ベースライン
- 構成: TypeScript + Vite + 素のDOM/SVG + Three.js。基本ルール版・都市と騎士(C&K)版・航海者を含む**単一統合ビルド**（モード切替）。base と C&K の表示文字列は共有ファイル（`main.ts`/`ui.ts` 等）に混在。
- 文字列管理: i18n機構なし。ハードコードの日本語表示。ただし内部キー/enumはすべて英語（`wood`/`forest`/`knight`/`city`…）。中央ラベルマップあり: `RESOURCE_NAMES`,`COMMODITY_NAMES`,`DEV_CARD_NAMES`(ui.ts), `CK_TRACK_NAME`,`PROGRESS_CARD_NAME/DESC`(constants.ts), `DEV_PLAY_LABEL`(log.ts)。
- ロジックで比較される日本語リテラルは `main.ts` の `'指定'`（fixed/random）の1件のみ。→ 変更対象外。
- コマンド: `npm test`(vitest) / `npm run typecheck` / `npm run typecheck:test` / `npm run build` / `npm run dev`。

### ベースライン結果（リスキン前）
- `npm test`: **736 passed (33 files)** ✓（実行末尾にWindows/vitestの既知のV8 teardownクラッシュが出るが、テスト結果は全グリーン）
- `npm run typecheck`（src）: **クリーン** ✓
- `npm run typecheck:test`: `tests/manifest.test.ts` に**既存の**型エラー2件（リスキンと無関係のベースライン状態）
- `npm run build`: **成功** ✓

<!-- 以降のフェーズ結果は作業進行に伴い追記する -->
