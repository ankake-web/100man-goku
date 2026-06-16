# 3Dダイス演出の仕上げ強化（DICE_3D の上に積む差分）

既存の3Dダイス（[DICE_3D.md](DICE_3D.md)・面マッピング厳密検証済み・時間差着地）はそのままに、
「見せ方」だけを5点強化する。**着地タイミング・面マッピング・出目受け渡し・抽選/蛮族ロジックは不変。**

実装箇所: [`src/main.ts`](src/main.ts) `playDiceRoll`/`applyEventFlourish` 近辺、[`src/style.css`](src/style.css) のダイス節。

## 追加ポイント（現行構造）
- `playDiceRoll` が `#board-area` に `.dice-roll-overlay`(z50) を置き、中に `.dice-stage`＋`.dice-sum`。
- 各 `.dice-slot` = `.dice-cube-wrap`(立方体) + `.dice-shadow`。`spinCube` が rotateX/Y で転がす。
- 結果演出: `applyEventFlourish`（船=board-shake / 色=dice-color-wash）と `buildEventResolutionPanel`。
- `#board-area` への一時 transform は内側 `<g.board-viewport>`(パン/ズーム)と競合しない。

## 実装する5点
1. **ロール中だけ盤を沈める**: `#board-area` に `.dice-board-dim`(z47, pointer-events:none) を一時追加。
   `backdrop-filter: blur+saturate↓+brightness↓` で**背後の盤だけ**を沈め、z50のダイス/合計/パネルは前面のまま。
   背景は放射状ビネット＝ダイスへスポット。決着(finishAll)で opacity トランジション付き除去。reduced/instantは弱め/即時。
2. **定位置クラスタ**: overlay を下中央寄せ(justify flex-end＋padding-bottom clamp)。`.dice-tray-zone` に淡い窪み
   `.dice-tray`(楕円の影/半透明)を敷き、3個を近いgapで着地。各ダイスに微小な rotateZ(±数度)で自然な散らし
   （rotateZ は視軸回りなので支配面=出目は不変）。
3. **接地影**: 既存 `.dice-shadow` を強化。ロール中=大きく薄くぼかし、着地=小さく濃く。本体を rolling 中わずかに
   持ち上げ(translateY)→cubeLand で着地、影とリンクして高さ感。
4. **イベント着地のクライマックス**: イベントは cubeLand の代わりに `eventLand`(translateY＋スケールpop)。結果色リングを
   強発光。`diceLandHeavy` に同期した軽い画面ヒット `.board-hit`(2–3px・~130ms)。その直後に既存の結果演出
   （船=トラック前進＋警告揺れ / 色=color-wash＋抽選ハイライト）へ繋ぐ（board-shakeとヒットは時間をずらして非競合）。
5. **立方体マテリアル**: 面の角丸＋ベベル＋エッジハイライトを強化。ピップは凹み(インシャドウ)、イベント面は
   彫り込み記号のコントラスト＋軽いスペキュラ。CSSのみ（重い画像なし）。

## 不変条件 / 後始末
- 連続ロールで dim/spot/hit/ring/shadow を毎回クリーンに復帰（`clearTransientFx` に `.dice-board-dim` 追加、
  `#board-area` の board-hit/shake クラスを除去）。多重適用・残留なし。
- reduced-motion/instant: dim弱め・hit/blur抑制、出目の正しさと判別性は維持。681テスト緑・面マッピング不変。

## 実装結果（受け入れ確認）
- [x] ロール中だけ盤が沈む（`.dice-board-dim` の backdrop-filter blur+減彩+減光＋放射ビネット）、決着で opacity フェード復帰。ダイス/合計/パネル(z50)は前面で沈まない。
- [x] 下中央の `.dice-tray-zone`＋`.dice-tray` に近接gapで着地。各立方体に視軸回り rotateZ(±数度)の自然な散らし（**z成分不変＝支配面=出目は厳密に不変**、行列的に自明）。
- [x] 接地影: rolling=大きく薄くblur / settled=小さく濃く。rolling 中は本体を translateY(-10px) 持ち上げ→cubeLand/eventLand で着地（高さ→影リンク）。
- [x] イベント着地: `eventLand`(translateY＋scale pop) ＋ 結果色リング強発光 ＋ `board-hit`(~220ms)。その後 +260ms で既存の船=揺れ / 色=wash へ（#board-area transform 競合なし）。
- [x] 立方体マテリアル: 面のベベル＋上辺ハイライト＋下辺陰、ピップは凹み(インシャドウ)、イベント面に軽いスペキュラ。
- [x] 着地タイミング・面マッピング・抽選/蛮族の数値・分岐は不変。**全682テスト緑・ビルドOK**。
- [x] 連続ロール後始末: `showBoardDim` が既存dim除去、`finishAll` で `hideBoardDim`、`clearTransientFx` に `.dice-board-dim`/`.dice-color-wash`＋`#board-area` の board-hit/shake クラス除去を追加（残留・多重なし）。
- 結果パネルは `insertBefore(firstChild)` で上に挿入し、ダイスクラスタを動かさない（レイアウトシフト防止）。

備考: ライブのアニメは静止画にできないため、面マッピング不変は行列性質（Rzはz成分を保存）で保証。実機確認推奨。
</content>
