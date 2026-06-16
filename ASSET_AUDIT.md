# 画像素材 監査・組み込みレポート（Cities & Knights）

スコープ: 用意された画像素材を組み込み、現状の素材セットで破綻なく動作することの確認。
ゲームのルール/ロジックは不変。全画像参照は中央マニフェスト `src/assets/manifest.ts` 経由（単一の真実）。

## 更新（騎士・蛮族船の追加／不要画像の削除／命名整理）
- **新規取り込み**: 中立グレーの騎士3段階（basic/strong/mighty）と**蛮族船**。
  - 騎士は `knight-basic/strong/mighty.png` を新グレー版で**置換**（4色プレイヤー全てに合う中立色。盤面は色土台ディスクで所有者表示）。
  - `barbarian-ship.png` を新規作成 → マニフェストの `piece.barbarianShip` を null から実画像へ。蛮族船はダイス演出の「船」結果パネルに表示。
- **不要画像の削除**: 旧・青寄り騎士アート `knight-{basic,strong,mighty}-art.png`、未使用の汎用 `house.png`・`knight.png`・`ship.png`（計6枚）を削除。
- **命名整理（全て適した名前へ）**: アンダースコア＆旧名を廃止し統一。
  - `house_<色>.png → settlement-<色>.png`、`city_<色>.png → city-<色>.png`、`ship_<色>.png → ship-<色>.png`、`imp_<トラック>.png → track-<トラック>.png`。
  - これで `src/assets/` にアンダースコア名は0。参照は全てマニフェスト経由なので影響は manifest.ts のimportのみ。
- **追加UI（素材確認・効果説明）**:
  - **コマ・カード図鑑**（TOPの「🖼 コマ・カード図鑑を見る」）: コマ/資源/商品/改良建築/進歩カード全種を**画像＋名前＋説明**で一覧。
  - **進歩カードの効果説明モーダル**: 手札のカードをタップすると、**使用前に**カード絵・名前・効果・「使う/やめる」を表示（使えない時は理由つきで「今は使えません」）。
- 検証: 全680テスト緑・ビルドOK。`src/assets/` に旧名参照なし、新旧アセットが dist にバンドル済み。マニフェスト健全性テスト更新。

---

（以下は初回取り込み時のレポート。命名は上記「更新」で `settlement-<色>`/`track-<トラック>` 等に整理済み。）

## ステップ0：素材フォルダ
- スクラッチ元: `asset/`（gitignore。ChatGPT生成の原画像。コミット対象外）
- 配信用: `src/assets/`（Vite が import で base 付きURLへ解決。コミット対象）

今回 `asset/` に追加された原画像21枚を判別し、`src/assets/` へ正規名で取り込んだ（透明余白トリム＋リサイズ。
政治カードは3×3グリッド1枚を9枚にスライス）。原画像はサイズ 1254²（コマ/カード）・1672×941（背景）。

## ステップ5：要素 × 画像 対応表
状態: ✅対応 / 🔁リネーム / ✅(新)=新規取り込み / ⛔未作成=プレースホルダ / ❓要確認

### コマ・盤面
| 区分 | 要素 | 正規ファイル名 | 実ファイル（由来） | 状態 | 備考 |
|---|---|---|---|---|---|
| コマ | 開拓地(家) | settlement.png | settlement.png(=house.png複製)＋house_{red,blue,purple,orange}.png | ✅ | 盤面はプレイヤー色版を使用 |
| コマ | 都市 | city.png | city.png＋city_{色}.png | ✅ | 家と別画像で区別 |
| コマ | 盗賊 | robber.png | robber.png | ✅ | 盤面描画済 |
| コマ | 海賊 | pirate.png | pirate.png | ✅ | 海タイルに描画済 |
| コマ | 基本騎士 | knight-basic.png | knight1.png→リネーム | 🔁 | 中立グレー＋色土台ディスク。起動=くっきり/非起動=薄め |
| コマ | 強い騎士 | knight-strong.png | knight2.png→リネーム | 🔁 | 盾の山形2本で区別 |
| コマ | 最強騎士 | knight-mighty.png | knight3.png→リネーム | 🔁 | 盾の山形3本＋羽根 |
| コマ | 商人 | merchant.png | 新(21_50_27)→取込 | ✅(新) | マニフェスト登録。盤面描画スロットは今後 |
| コマ | メトロポリス門 | metropolis-gate.png | 新(21_50_29)→取込 | ✅(新) | **都市に重ねて表示**（👑絵文字から置換、board.ts） |
| コマ | 守護者バッジ | defender-badge.png | 新(21_50_30-6)→取込 | ✅(新) | マニフェスト登録（バッジ表示スロットは今後） |
| コマ | 城壁 | city-wall.png | 新(21_50_30-7)→取込 | ✅(新) | マニフェスト登録（盤面描画スロットは今後） |
| コマ | 蛮族船 | barbarian-ship.png | （なし） | ⛔未作成 | プレースホルダ。襲来演出は bg-barbarian バナーで代替可 |

### 資源5・商品3（取り違えなし＝全8種が別画像。テストで担保）
| 区分 | 要素 | 正規名 | 実ファイル（由来） | 状態 |
|---|---|---|---|---|
| 資源 | 木 | res-lumber.png | res_wood.png→リネーム | 🔁 |
| 資源 | レンガ | res-brick.png | res_brick.png→リネーム | 🔁 |
| 資源 | 羊毛 | res-wool.png | res_sheep.png→リネーム | 🔁 |
| 資源 | 小麦 | res-grain.png | res_wheat.png→リネーム | 🔁 |
| 資源 | 鉱石 | res-ore.png | res_ore.png→リネーム | 🔁 |
| 商品 | 紙 | com-paper.png | comm_paper.png→リネーム | 🔁 |
| 商品 | 布 | com-cloth.png | comm_cloth.png→リネーム | 🔁 |
| 商品 | 金貨 | com-coin.png | comm_coin.png→リネーム | 🔁 |

### 改良建築6（トラック×レベル。Lv3/Lv4ボタンに対応画像を表示）
| 要素 | 正規名 | 実ファイル（由来） | 状態 |
|---|---|---|---|
| 交易所(商業L3) | bld-trading-house.png | 新(21_47_45)→取込 | ✅(新) |
| 銀行(商業L4) | bld-bank.png | 新(21_47_46-2)→取込 | ✅(新) |
| 要塞(政治L3) | bld-fortress.png | 新(21_47_46-3)→取込 | ✅(新) |
| 大聖堂(政治L4) | bld-cathedral.png | 新(21_47_46-4)→取込 | ✅(新) |
| 水道橋(科学L3) | bld-aqueduct.png | 新(21_47_56-5)→取込 | ✅(新) |
| 劇場(科学L4) | bld-theater.png | 新(21_48_00-6)→取込 | ✅(新) |

### 進歩カード
| 区分 | 要素 | 正規名 | 実ファイル | 状態 | 備考 |
|---|---|---|---|---|---|
| 政治カード | 司教 | card-pol-bishop.png | グリッド(0,0) | ✅(新) | 進歩カードボタンに専用アート |
| 政治カード | 外交官 | card-pol-diplomat.png | グリッド(0,1) | ✅(新) | |
| 政治カード | 策謀 | card-pol-intrigue.png | グリッド(0,2) | ❓要確認 | 策謀/スパイの取り違えに注意（机+駒で策謀と判定） |
| 政治カード | 脱走兵 | card-pol-deserter.png | グリッド(1,0) | ✅(新) | |
| 政治カード | 将軍 | card-pol-warlord.png | グリッド(1,1) | ✅(新) | |
| 政治カード | スパイ | card-pol-spy.png | グリッド(1,2) | ❓要確認 | 壁から覗く+カードでスパイと判定 |
| 政治カード | 破壊工作員 | card-pol-saboteur.png | グリッド(2,0) | ✅(新) | |
| 政治カード | 結婚 | card-pol-wedding.png | グリッド(2,1) | ✅(新) | |
| 政治カード | 憲法 | card-pol-constitution.png | グリッド(2,2) | ✅(新) | |
| カード裏 | 商業/政治/科学 | card-back-{trade,politics,science}.png | 新(21_50_06/21_49_53/21_48_57)→取込 | ✅(新) | 科学=緑/商業=黄/政治=青。非政治カードのボタン背景に使用 |
| 科学カード10(個別) | — | card-sci-*.png | （なし） | ⛔未作成 | カードは「ボタン＋トラック色裏＋名前」で代替（プレイ可能・一目で区別） |
| 商業カード6(個別) | — | card-com-*.png | （なし） | ⛔未作成 | 〃 |

### 背景・装飾・道
| 要素 | 正規名 | 実ファイル | 状態 | 備考 |
|---|---|---|---|---|
| タイトル背景 | bg-title.jpg | 新(21_48_17-2)→取込 | ✅(新) | マニフェスト登録（表示スロットは今後） |
| 勝利背景 | bg-victory.jpg | 新(21_48_17-3)→取込 | ✅(新) | 〃 |
| 蛮族襲来バナー | bg-barbarian.jpg | 新(21_48_16-1)→取込 | ✅(新) | 〃 |
| 装飾フレーム | frame-decorative.png | 新(21_48_19-4)→取込 | ✅(新) | 〃 |
| 道 | （画像不要） | SVG図形 | ✅ | プレイヤー色のSVGで描画（方針どおり画像不要） |
| 改良トラックアイコン | imp_{trade,politics,science}.png | 既存 | ✅ | Lv1–2/5 のボタン用（建築画像が無いレベル） |

## 未作成で要追加の素材
1. **barbarian-ship.png**（蛮族船の単体コマ）— 蛮族トラック等に置く用。現状プレースホルダ。
2. **科学カード10種・商業カード6種の個別アート** — 現状はボタン＋トラック色カード裏＋カード名で代替（プレイ可能）。
3. （任意）守護者バッジ・城壁・商人の盤面/パネル表示スロット（画像は取り込み済、描画箇所は未）。

## リネーム対応表（実ファイル → 正規名）
- res_wood.png → res-lumber.png / res_sheep.png → res-wool.png / res_wheat.png → res-grain.png / res_brick.png → res-brick.png / res_ore.png → res-ore.png
- comm_coin.png → com-coin.png / comm_cloth.png → com-cloth.png / comm_paper.png → com-paper.png
- knight1.png → knight-basic.png / knight2.png → knight-strong.png / knight3.png → knight-mighty.png
- house.png → settlement.png（複製。per-color house_* は据え置き）
- 新規21枚（ChatGPT原画像）→ 上表の正規名へ取り込み（政治カードはグリッドを9分割）

## 残課題・備考
1. **政治カードの策謀↔スパイ**は構図が近く ❓要確認（机+駒=策謀 / 壁から覗く+カード=スパイ と判定）。誤りなら2枚を入替。
2. **新規の「青寄り」騎士アート**（21_50_23/25）は detail が高いが青基調のため、4色全プレイヤーに使うと色が偏る。
   盤面の騎士は中立グレー(knight-basic/strong/mighty)＋色土台ディスクを継続使用。青アートは未使用（per-color運用に切替時の候補）。
3. 取り込んだが描画スロット未配置の素材（merchant/defender-badge/city-wall/背景/フレーム）は、マニフェストに登録済みで
   いつでも参照可能。表示箇所の追加は次フェーズ（ロジック非変更の範囲でUI拡張）。
4. **破綻なし**: 全素材はビルド時に解決（欠損importはビルド失敗するため404は出ない）。未作成要素は manifest が null を返し、
   `assetImg()` が onerror＋プレースホルダで壊れ画像を出さない。資源/商品/騎士/建築/政治カードの「取り違え無し・全別画像」を自動テストで担保。
