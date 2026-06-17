# 3DダイスのThree.js(WebGL)化 — 設計・面マッピング・接続点

CSS 3D実装（[DICE_3D.md](DICE_3D.md) / [DICE_3D_FX.md](DICE_3D_FX.md)）を撤去し、Three.js(WebGL) で
実写級に作り直した。**出目・抽選条件(赤≤Lv+1)・蛮族判定などロジックは不変**。既存の演出フロー
（盤dim・生産合計ポップ・抽選照合・蛮族前進/襲来・color wash・board hit）は維持し、新ダイスへ繋ぎ替えた。

## 構成ファイル
- [`src/renderer/diceGLMapping.ts`](src/renderer/diceGLMapping.ts) … 面→値マッピングと目標クォータニオン（純粋・テスト対象）。
- [`src/renderer/diceGL.ts`](src/renderer/diceGL.ts) … レンダラ/シーン/ライティング/ジオメトリ/素材/タンブル。遅延ロード対象。
- [`tests/diceGLMapping.test.ts`](tests/diceGLMapping.test.ts) … ★決定性検証（生産6面＋イベント4結果）。
- [`src/main.ts`](src/main.ts) `playDiceRoll` … 既存演出の土台はそのまま、ダイス描画だけ WebGL へ接続。

## レンダラ/シーン（実写級の定番）
- `WebGLRenderer{alpha:true, antialias:true}`、`outputColorSpace=SRGB`、`toneMapping=ACESFilmic`(exposure 1.05)、
  `PCFSoftShadowMap`、`pixelRatio=min(2,dpr)`。透過canvas(`.dice-gl-canvas`, pointer-events:none) を `.dice-gl-wrap` に載せる。
- IBL: `PMREMGenerator + RoomEnvironment`（HDRI不要の自然な反射）。
- ライト: `DirectionalLight`(キー・影付き) ＋ `HemisphereLight`(補助)。`ShadowMaterial` の地面で接地影。
- カメラ: やや上・前方固定構図。**結果は「正面の面」に出す**（上面は補助的に見えて立体感を出す）。スマホ縦でも破綻しない画角。

## ジオメトリ/素材
- 形状: `RoundedBoxGeometry`（角丸の削り出し）＝ボディ1メッシュ。RoundedBox は面ごとのマテリアルグループを持たない
  ため、**6面はそれぞれ透過デカール平面**（`PlaneGeometry`）をボディ面に貼って表現（角丸＋面ごとの絵を両立）。
- 生産ダイス(赤/黄): 象牙PBR（低metal・中rough）。ピップはキャンバス生成テクスチャ（凹みの陰影＝掘った穴）。向かい合う面=7。
- イベントダイス: 濃いスレートPBR（暗色・高rough）。船×3＋ゲート×3。
  - 船面: 既存 `barbarian-ship.png` を非同期ロードして石面に彫り込み風で配置（ロード前はベクター⛵フォールバック）。
  - ゲート面: **漢字を廃止**し、色付き盾(ヒーターシールド)＋交易品アイコン（ベクター・エンボス風）。
    - 政治＝青の盾＋金貨(coin) / 科学＝緑の盾＋紙(巻物) / 商業＝黄の盾＋布(cloth)。
- テクスチャは SRGB・anisotropy=8。重いテクスチャ画像は追加しない（船以外は全てキャンバス生成）。

## ★面→値マッピング（決定性）
RoundedBox/Box のマテリアル面順 `0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z`。デカールも同順で配置。

| 生産・面 | +X | -X | +Y | -Y | +Z | -Z |
|---|---|---|---|---|---|---|
| 値 | 3 | 4 | 5 | 2 | 1 | 6 |（向かい合う和=7）

| イベント・面 | +X | -X | +Y | -Y | +Z | -Z |
|---|---|---|---|---|---|---|
| 結果 | 科学 | 商業 | 船 | 政治 | 船 | 船 |

- 目標姿勢: 出目の面を**正面(+Z=カメラ側)**へ向けるクォータニオン（`productionTargetQuaternion` /
  `eventTargetQuaternion`）。物理ではなくこの目標へ必ず着地（タンブルは目標へ向けて減速）。
- 自然な散らしは**視軸(Z)回りの微小ロール**で付与（z成分保存＝正面の面=出目は不変）。
- 検証: `frontFaceIndex(q)` が出目/結果の面を返すことを単体テストで担保（生産6・イベント4、法線·+Z>0.999）。

## アニメーション（既存タイミング維持）
- 開始姿勢＝目標＋ランダム軸の多回転。`u∈[0,1]` で減速スピン（easeOutCubic）＋終盤に目標へ slerp（smootherstep, u=1で厳密一致）。
- 放物の持ち上げ(sin)＋着地スカッシュ。`render-on-demand`: ロール中のみ rAF、全着地＋tailで停止し最終フレームを保持。
- 段階着地は main.ts のタイミングを diceGL の各 `onLand` へ接続: 赤(redMs)→黄(yellowMs,+生産合計ポップ)→
  イベント(eventMs, 見せ場)。`prefers-reduced-motion`=`showStatic` で即着地、`fxSpeed='instant'`=演出スキップ。

## 既存演出への接続点（新規実装せず繋ぎ替え）
- `onRedLand`→クラッタ音 / `onYellowLand`→クラッタ音＋`showDiceSum`(赤+黄=生産) / `onEventLand`→重い着地音
  `diceLandHeavy`＋`boardHit`(軽い画面ヒット)＋結果パネル＋(260ms後)`applyEventFlourish`(船=蛮族トラック前進/警告揺れ、
  色=color wash＋抽選照合ハイライト)。クライマックスの発光は GL 側でイベントダイス本体を結果色で短くemissiveパルス。
- 盤dim(`.dice-board-dim`)・生産合計(`.dice-sum`)・結果パネル(`.dice-event-panel`)・color wash・board hit は従来CSS/DOMのまま。
- 旧CSS 3D（`.dice-cube`/`.cube-face`/`.dice-slot`/tray/cubeLand/eventLand/diceRing 等）と関連ビルダ(main.ts)は撤去。

## パフォーマンス / フォールバック / 後始末
- three は**動的 import** で遅延ロード（初期JS 78KB gzip を維持、three は別チャンク 122KB gzip をオンデマンド）。
  ゲーム進行(MAIN)で `preloadDiceGL` を先読みし、初回ロールまでに用意。未ロード/WebGL非対応/初期化失敗時は
  `getDiceGL()=null` → 出目と船/色ゲートが分かる**最小限表示**（sum＋パネル）にグレースフル退避。ゲーム進行は継続。
- メッシュ/シーンはロールごとに再利用（毎回作り直さない）。`reset()` で発光/アニメ状態を毎回クリア＝連続ロールで残留なし。
  `window.resize` でマウント中のみ追従。`dispose()`（geometry/material/texture/renderer 破棄）はページ破棄用に用意。

## タイトル表記
- アプリ表示の「騎士と商人」→「都市と騎士」: シナリオ選択ラベル/シナリオ名/ルール見出し（[`scenarioSelect.ts`](src/renderer/scenarioSelect.ts) /
  [`scenarios.ts`](src/engine/scenarios.ts) / [`main.ts`](src/main.ts)）＋監査ドキュメント見出し。
  **リポジトリ名・公開URL(GitHub Pages /catan/)・コード識別子(`cities_knights`/knight/merchant等)は不変**。

## 受け入れ確認
- [x] WebGL 実写級（角丸・PBR・IBL反射・接地影・船の彫り込み・盾のエンボス）。playwright で全結果を目視確認。
- [x] 旧CSS 3D/スロット式すり替え撤去・一本化。
- [x] 静止面＝渡された出目（生産6・イベント4）を単体テストで担保。実ロールで red=6/yellow=2/trade に厳密着地を確認。
- [x] イベント面の漢字廃止＝政治:青+金貨 / 科学:緑+紙 / 商業:黄+布、船面は据え置き（barbarian-ship.png）。
- [x] 赤→黄→イベントの時間差着地・生産合計・抽選照合・蛮族前進/揺れ・color wash が従来通り。
- [x] 数値結果不変・687テスト緑（旧681＋新マッピング等）・ビルドOK・コンソール/404なし。
- [x] render-on-demand/遅延ロード/reset・連続ロールで残留なし。reduced-motion/instant/WebGL非対応で破綻なし。
- [x] アプリ表示タイトル「都市と騎士」。リポジトリ名・公開URLは不変。

## 残課題 / メモ
- ゲートの交易品アイコンはベクター描画（小さく埋め込む彫り込み紋章として可読性優先のため、詳細PNGの com-* は不使用）。
- 端末性能に応じて影解像度/exposure の微調整余地あり。実機で要確認。
</content>
