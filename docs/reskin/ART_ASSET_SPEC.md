# 100万石 アート素材 仕様書 ＆ 生成プロンプト集

戦国テーマ「100万石」の画像素材（`src/assets/` 配下・約70枚）を作り替えるための一覧。
各素材の「描くもの・寸法・透過・AI生成プロンプト」をまとめてある。テキストの用語正典は
[GLOSSARY.md](./GLOSSARY.md)、作業全体の記録は [../../RESKIN_REPORT.md](../../RESKIN_REPORT.md)。

---

## 0. 使い方（最重要）

- **差し替えは「同じファイル名で `src/assets/` に上書き」するだけ**。コードは一切いじらない。
  `src/assets/manifest.ts` が**ファイル名固定で import** し、Vite が実URLへ解決するので自動反映される。
- **ファイル名は英語のまま変えない**（内部識別子。リスキンのルールで変更禁止）。日本語化するのは“絵”だけ。
- **寸法は現物と同じに**する（各表の「寸法」列）。駒・アイコン・カードは**透過PNG**、背景は**JPG（不透明）**。
- **1枚ずつ差し替えてOK**。未差し替えは旧絵のまま動作する。欠損してもアプリは
  プレースホルダ（色付きラベル）にフォールバックし、404やクラッシュは出ない（`manifest.ts` の `placeholder()`）。
- **画像の中に文字を入れない**。名称・点数・コストはアプリ側が文字で描くので、絵は“画”だけにする。
- **構図**：中央に単体オブジェクト、周囲に少し余白、背景は透明、淡いドロップシャドウ。
- **確認**：`npm run dev` → 盤面と「🖼 コマ・カード図鑑」で反映を目視。

### 一括差し替え手順（例）
1. 各ファイルを下表のファイル名・寸法で書き出す（透過PNG／背景はJPG）。
2. `c:\Users\b1242\claude\game\100man-goku\src\assets\` に**上書きコピー**。
3. `npm run dev` で表示確認 → 問題なければ `git add src/assets && git commit`。

---

## 1. 全体アートディレクション（共通スタイル）

- **テーマ**：日本の戦国時代（16世紀）。城・武将・一揆・交易。
- **画風**：浮世絵／墨絵（sumi-e）＋金屏風の質感。和紙テクスチャ、墨の輪郭、金の差し色。
  けばけばしくせず、フラット寄りの色面＋淡い陰影で**アイコンとしての視認性**を最優先。
- **統一感**：全アイコンで線の太さ・陰影・余白・彩度を揃える。**同一シード／同一スタイル**で量産推奨。
- **視点**：資源/物産/カードの図像は正面の単体オブジェクト。盤上の駒（砦/城/天守/船/武将）は
  **同じ俯瞰アングル・同じ光源**で揃える（盤に並べたとき違和感が出ないように）。

### カラーパレット（[RESKIN_REPORT.md](../../RESKIN_REPORT.md) と同じ）
| 用途 | 色 | HEX |
|---|---|---|
| UI地 生成り | 和紙 | `#EFE6CE` |
| 墨 | 線・文字 | `#1C1A17` |
| 朱 | 差し色 | `#B7282E` |
| 藍 | 差し色 | `#1B3A5B` |
| 古金 | 金箔 | `#C9A227` |
| 田 | 地形 | `#D8B24A` |
| 森 | 地形 | `#3E5E3A` |
| 鉱山 | 地形 | `#565A61` |
| 牧 | 地形 | `#7FA05A` |
| 石切場 | 地形 | `#9A7B5A` |
| 荒野 | 地形 | `#B9A37E` |

### プレイヤー色（駒の色別バリエーション＝4色）
内部キーは `red / blue / purple / orange`（**変更不可**）。絵柄の差し色を下記に。
※ 報告書の旧メモは「萌黄(緑)」を含むが、**実際の色キーに緑は無い**。orange は山吹で表現する。

| 色キー | 和名 | 駒の差し色 HEX |
|---|---|---|
| red | 朱 | `#C8102E` |
| blue | 藍 | `#1B3A5B` |
| purple | 紫 | `#6A4C93` |
| orange | 山吹 | `#E8A33D` |

### 共通スタイル・プロンプト（接頭辞 ＝ 各素材の主題に前置きする）
英語の方が画像生成エンジンの解釈が安定するため、**接頭辞＋主題**で組み立てる。

```
flat game icon, Japanese Sengoku-era (16th century) theme,
ukiyo-e woodblock print and sumi-e ink aesthetic, warm washi paper texture,
muted earthy palette with gold-leaf accents, bold ink outline, soft cel shading,
single centered object, slight margin, transparent background, subtle drop shadow,
no text, no letters, high readability as a small icon
```
- 出力は **512×512 で生成 → 指定寸法へ縮小**すると線が締まる。背景は必ず透過（PNG）。
- **同一スタイル・同一シード**を固定し、被写体（主題）だけ差し替えて量産する。
- 盤上の駒（3.3）は **isometric / slight top-down view, consistent light from upper-left** を追加。

---

## 2. 資源 5（256×256・透過PNG）

手札・凡例・建設コストで使う小アイコン。地形との対応は [GLOSSARY.md](./GLOSSARY.md) 参照。

| ファイル名 | 描くもの（戦国） | 産地 | 生成プロンプト主題（英） |
|---|---|---|---|
| `res-lumber.png` | 木材（丸太・木挽き材） | 森林 | a stack of cut timber logs, rope-tied lumber |
| `res-brick.png` | 石材（切り出した石・石垣用の方形石） | 石切場 | a stack of quarried rectangular building stones |
| `res-wool.png` | 馬（軍馬の頭・横向き） | 牧 | head of a Japanese warhorse in profile, bridle |
| `res-grain.png` | 米（稲穂の束 or 米俵） | 田 | a bundle of golden rice ears / a straw rice bale (komedawara) |
| `res-ore.png` | 鉄（鉄塊・たたら製鉄の鉧/玉鋼） | 鉱山 | a chunk of raw iron / tamahagane steel ingot, dark metallic |

---

## 3. 物産 3（256×256・透過PNG）

城（城下の発展）が産む上位資源。資源とは別の手札。

| ファイル名 | 描くもの | 産出（地形/トラック） | 生成プロンプト主題（英） |
|---|---|---|---|
| `com-paper.png` | 紙（巻物・和紙の束） | 森林の城／学 | a rolled washi paper scroll, Japanese handmade paper |
| `com-cloth.png` | 絹（反物・絹の巻物） | 牧の城／商 | a roll of fine silk fabric (tanmono), elegant sheen |
| `com-coin.png` | 金（小判・金貨の山） | 鉱山の城／政 | a small pile of gold koban coins, Edo/Sengoku gold |

---

## 4. 駒・盤面コマ

盤上に置く立体物。**同一俯瞰アングル・同一光源**で揃える。色別は差し色だけ替える。

### 4.1 汎用＆プレイヤー色別の駒
| ファイル名 | 描くもの | 寸法 | 生成プロンプト主題（英） |
|---|---|---|---|
| `settlement.png` | 砦（柵・物見櫓のある小拠点）汎用 | 384² | a small wooden Japanese stockade fort with a watchtower |
| `settlement-red/blue/purple/orange.png` | 同上・差し色を各色の旗/幕に | 384² | …with a colored war banner (朱/藍/紫/山吹) |
| `city.png` | 城（天守をもつ城郭）汎用 | 384² | a Japanese castle with white keep and stone base |
| `city-red/blue/purple/orange.png` | 同上・差し色を各色の旗に | 384² | …with colored banners on the keep |
| `ship-red/blue/purple/orange.png` | 船（安宅船/小早＝和船の軍船） | 384² | a Japanese atakebune wooden warship, colored sail |

> 砦＝settlement / 城＝city / 天守＝metropolis。**「砦は柵＋櫓」「城は天守＋石垣」と段階差を明確に**。

### 4.2 城下と武将（C&K）コマ
| ファイル名 | 描くもの | 寸法 | 生成プロンプト主題（英） |
|---|---|---|---|
| `metropolis-red/blue/purple/orange.png` | 天守（大型の天守閣。城の上位） | 256² | a grand multi-tiered castle tenshu keep, colored banners |
| `metropolis-gate.png` | 天守門（改善Lv4で城に被せる門/櫓） | 256² | an ornate castle gate / yagura turret, gold accents |
| `city-wall.png` | 石垣（城の防御。手札上限+2） | 256² | a curved stone castle rampart (ishigaki) section |
| `knight-basic.png` | 武将・足軽（強さ1。槍足軽） | 256² | a foot soldier (ashigaru) with a spear, light armor |
| `knight-strong.png` | 武将・侍（強さ2。甲冑の侍） | 256² | a mounted-rank samurai in full armor with katana |
| `knight-mighty.png` | 武将・精兵（強さ3。豪壮な武将/大将） | 256² | an elite samurai general in ornate o-yoroi armor, helmet crest |
| `merchant.png` | 御用商人（行商/帯刀せぬ商人コマ） | 256² | a traveling merchant with goods box, no weapon |
| `robber.png` | 野盗（覆面の野伏せ/山賊） | 384² | a masked bandit (nobushi) crouching, ragged clothes |
| `pirate.png` | 海賊（村上水軍風の海賊） | 384² | a Sengoku sea-pirate (Murakami suigun) with banner |
| `barbarian-ship.png` | 一揆勢の船（一揆衆を乗せた襲来船） | 256² | a ragtag rebel (ikki) boat crowded with peasant fighters, bamboo spears |
| `defender-badge.png` | 守護者の証（一揆撃退の最大功・+1点） | 256² | a heraldic defender medallion / war-merit badge, gold |

### 4.3 武将アクション・アイコン（ボタン用）
| ファイル名 | 描くもの | 寸法 | 生成プロンプト主題（英） |
|---|---|---|---|
| `knight-activate.png` | 出陣（武将を起動。陣太鼓/采配） | 256² | a war drum / commander's baton (saihai), "sortie" feel |
| `knight-upgrade.png` | 加増（武将を昇格。兜の格上げ） | 256² | an upgraded samurai helmet with new crest, rank-up arrow |

---

## 5. 城下の発展（改良建築 6・256×256・透過PNG）

トラック×レベル（Lv3/Lv4）で城に建つ施設。図鑑の表示名に合わせて描く。
※ 一部は西洋寄りの名（大聖堂/水道橋/劇場）。現状の表示名どおりに描くが、より戦国らしい
名称に寄せたい場合は §8 の置換案を参照（テキスト改修は任意・別作業）。

| ファイル名 | 表示名（トラック/Lv） | 描くもの | 生成プロンプト主題（英） |
|---|---|---|---|
| `bld-trading-house.png` | 交易所（商/Lv3） | 暖簾を掛けた商家・市の店 | a merchant trading house with noren curtain, market stall |
| `bld-bank.png` | 銀行（商/Lv4） | 両替商の蔵・千両箱 | a money-changer's storehouse (kura) with gold chests |
| `bld-fortress.png` | 要塞（政/Lv3） | 堅固な砦/出城・櫓 | a fortified outpost castle with palisades and tower |
| `bld-cathedral.png` | 大聖堂（政/Lv4） | 壮麗な大伽藍/本堂（寺院） | a grand Buddhist temple hall (garan), sweeping roof |
| `bld-aqueduct.png` | 水道橋（学/Lv3） | 用水・治水の樋/堰 | a wooden water aqueduct / irrigation sluice |
| `bld-theater.png` | 劇場（学/Lv4） | 能舞台/芝居小屋 | a Noh theatre stage with pine backdrop |

---

## 6. トラック＆カード裏

### 6.1 城下の発展トラック・アイコン 3（256²・透過PNG）
ボタンに使う系統アイコン。色は `TRACK_COLOR`（商=金 `#d8a838`／政=藍 `#3b6fd4`／学=緑 `#3f9e54`）。

| ファイル名 | 系統 | 描くもの | 生成プロンプト主題（英） |
|---|---|---|---|
| `track-trade.png` | 商（交易） | 秤/算盤/銭差し | a balance scale or abacus, commerce, gold tone |
| `track-politics.png` | 政（政治） | 采配/印判/扇 | a commander's war-fan (gunbai) or official seal, indigo tone |
| `track-science.png` | 学（兵学） | 巻物/兵法書/筆 | a scroll of military strategy and brush, green tone |

### 6.2 進歩カードの裏 3（256²・透過PNG）
デッキの裏面。系統色で塗り分け、中央に系統の紋。

| ファイル名 | デッキ | 生成プロンプト主題（英） |
|---|---|---|
| `card-back-trade.png` | 商策デッキ（金） | card back, gold ornament, commerce crest, washi texture |
| `card-back-politics.png` | 政策デッキ（藍） | card back, indigo ornament, government crest |
| `card-back-science.png` | 兵学デッキ（緑） | card back, green ornament, strategy crest |

---

## 7. 進歩カード 25（256×256・透過PNG）

各カードの“図像”。表示名・効果は [GLOSSARY.md](./GLOSSARY.md)／図鑑参照（**絵に文字は不要**）。
スラッグ（ファイル名の語）は内部キーなので不変。一部は西洋寄りの名（§8に和風置換案）。

### 7.1 政策デッキ（card-pol-*・9種）
| ファイル名 | 表示名 | 効果の要旨 | 生成プロンプト主題（英） |
|---|---|---|---|
| `card-pol-bishop.png` | 僧正 | 野盗移動＋隣接全員から1枚 | a high Buddhist monk (sōjō) in robes, prayer beads |
| `card-pol-diplomat.png` | 外交官 | 端の街道1本を撤去 | an envoy/messenger with a diplomatic letter scroll |
| `card-pol-intrigue.png` | 陰謀 | 隣接敵武将を1体退去 | a shadowy schemer plotting, dark backroom |
| `card-pol-deserter.png` | 脱走兵 | 敵武将を1体奪う | a deserting soldier fleeing camp at night |
| `card-pol-warlord.png` | 将軍 | 自分の武将を全て無料出陣 | a supreme commander (taishō) rallying troops |
| `card-pol-spy.png` | スパイ | 相手の進歩カードを1枚奪う | a ninja shinobi spy, stealth, dark |
| `card-pol-saboteur.png` | 破壊工作員 | 上位VP全員が資源半減 | a saboteur setting fire to enemy stores |
| `card-pol-wedding.png` | 婚礼 | 上位VPの各相手から2枚 | a political marriage ceremony, formal kimono |
| `card-pol-constitution.png` | 憲法 | 即+1勝利点 | a proclaimed domain law (bunkokuhō) document |

### 7.2 兵学デッキ（card-sci-*・10種）
| ファイル名 | 表示名 | 効果の要旨 | 生成プロンプト主題（英） |
|---|---|---|---|
| `card-sci-alchemist.png` | 錬金術師 | 次のダイス目を自分で決める | an onmyōji/alchemist with mystic dice and talismans |
| `card-sci-crane.png` | クレーン | 改善を物産1個安く1段 | a large wooden lifting crane (shura) at a build site |
| `card-sci-engineer.png` | 技師 | 石垣1つを無料建設 | a master builder engineer with castle-wall blueprint |
| `card-sci-inventor.png` | 発明家 | 数字トークン2枚を入替 | an inventor swapping numbered tiles, gadgets |
| `card-sci-irrigation.png` | 灌漑 | 隣接の田1つにつき米2 | irrigated rice paddies with water channels |
| `card-sci-medicine.png` | 医術 | 砦を安く城に格上げ | a Sengoku physician with herbal medicine box |
| `card-sci-mining.png` | 採掘 | 隣接の鉱山1つにつき鉄2 | a mining shaft with ore and miners, lanterns |
| `card-sci-road-building.png` | 普請 | 街道2本を無料建設 | corvée laborers building a road/embankment (fushin) |
| `card-sci-smith.png` | 鍛冶屋 | 武将を最大2体無料で加増 | a swordsmith forging a katana at the anvil, sparks |
| `card-sci-printer.png` | 印刷機 | 即+1勝利点 | a woodblock printing workshop (hanga), carved blocks |

### 7.3 商策デッキ（card-com-*・6種）
| ファイル名 | 表示名 | 効果の要旨 | 生成プロンプト主題（英） |
|---|---|---|---|
| `card-com-merchant.png` | 御用商人 | 資源地形に置く（+1VP・2:1） | a licensed purveyor merchant placing his market |
| `card-com-merchant-fleet.png` | 商船隊 | 指定1種を2:1で交易 | a fleet of trading sea vessels with cargo |
| `card-com-master-merchant.png` | 大商人 | VP最多の相手から2枚 | a wealthy great merchant (gōshō) with ledgers and gold |
| `card-com-commercial-harbor.png` | 商業湊 | 資源1⇄相手の物産1 | a bustling trade harbor (minato) with docks and crates |
| `card-com-resource-monopoly.png` | 資源独占 | 各相手から資源2枚ずつ | a merchant cornering a market, stacks of one resource |
| `card-com-trade-monopoly.png` | 交易独占 | 各相手から物産1枚ずつ | a monopoly seal over commodities (silk/paper/gold) |

---

## 8. アクション・アイコン 3（256×256・透過PNG）

建設・交易ボタンのアイコン。

| ファイル名 | 用途 | 描くもの | 生成プロンプト主題（英） |
|---|---|---|---|
| `road.png` | 街道を建設 | 敷かれた街道/木の架け | a built road / wooden path segment, top-down |
| `bank-trade.png` | バンク交易（銀行） | 両替・銭と俵の交換 | exchanging coins for goods at a money table |
| `player-trade.png` | プレイヤー間交易 | 二人の商人が手交 | two merchants exchanging goods, handshake of trade |

---

## 9. 背景・装飾

### 9.1 背景 3（**JPG・1024×576・不透明**）
全画面の背景。透過不要。横長の情景。

| ファイル名 | 場面 | 生成プロンプト主題（英） |
|---|---|---|
| `bg-title.jpg` | タイトル（城下町と山河） | wide Sengoku landscape, a castle town below mountains, dawn, ukiyo-e |
| `bg-victory.jpg` | 勝利（凱旋・天守に旗） | victorious castle keep with banners flying, golden sunset, triumphant |
| `bg-barbarian.jpg` | 一揆勢襲来（夜襲・松明） | night raid of a peasant ikki mob with torches approaching a castle, ominous |

### 9.2 装飾枠（512×512・透過PNG）
| ファイル名 | 用途 | 生成プロンプト主題（英） |
|---|---|---|
| `frame-decorative.png` | モーダル等の装飾枠 | ornate Japanese gold border frame, karakusa arabesque, transparent center |

---

## 10. 推奨制作順（視覚インパクト＝高い順）

1. **資源5**（常時手札に出る・最頻出）→ 2. **駒：砦/城/船 各色**（盤の主役）→
3. **武将3＋天守/天守門/石垣**（C&Kの主役）→ 4. **物産3** → 5. **野盗/海賊/御用商人/一揆勢の船** →
6. **背景3**（雰囲気） → 7. **トラック3＋カード裏3** → 8. **改良建築6** →
9. **進歩カード25**（枚数多・頻度中） → 10. **アクションアイコン3／装飾枠**。

> 全部揃わなくても**差し替えた分だけ反映**される。1→3 まで替えるだけで一気に戦国の見た目になる。

---

## 11.（任意・将来）より戦国らしい“名称”への置換案

下記は**絵ではなくテキスト（表示名）**の候補。今回の範囲外（やるなら別途テキスト改修）。
西洋寄りで浮く語を、語感重視で和風に寄せる案。採否はお任せ。

| 現・表示名 | 和風寄せ案 | 備考 |
|---|---|---|
| 大聖堂 | 本堂／伽藍 | 寺社建築に |
| 水道橋 | 用水／治水 | 土木に |
| 劇場 | 芝居小屋／能舞台 | 興行に |
| 錬金術師 | 陰陽師 | 占術に |
| クレーン | 修羅（しゅら） | 巨石運搬具 |
| 外交官 | 使者／取次 | |
| 憲法 | 分国法 | 戦国大名の家法 |
| 印刷機 | 版木／開版 | 木版印刷 |
| スパイ | 忍び／間者 | |
| 銀行 | 両替商 | |

---

## 12. 生成・透過の実務メモ

- **透過の作り方**：生成時に「transparent background」を指定。背景が残る場合は
  remove.bg 等や、白背景生成→白を透過に抜く後処理で対応。最終は**アルファ付きPNG**。
- **寸法**：表の寸法ちょうどで書き出す（拡大は粗くなる）。512で作って縮小推奨。
- **一貫性**：被写体ごとにプロンプトを変えても、**スタイル接頭辞・シード・参照画像**は固定する。
- **盤上の駒**は背景透過＋接地影を弱めに。色別は**差し色（旗/幕）だけ**変え、形は同一に。
- **チェック**：差し替え後 `npm run dev` →「🖼 コマ・カード図鑑」で全コマ/カードを一覧確認できる。
