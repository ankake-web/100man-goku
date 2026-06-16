# 進歩カード素材 監査（科学10・商業6 本アート差し替え）— 完了

科学10・商業6の個別アートが `asset/` に再提供され、**全16枚を本アートへ差し替え済み**。
これで進歩カード25種（政治9＋科学10＋商業6）すべてが個別アートで表示される（プレースホルダ落ちなし）。

## ステップ1: 実ファイル（再提供分）
`asset/ChatGPT Image 2026年6月17日 06_50_*〜06_52_*`（計16枚、各 1254×1254・透過化前は near-white 背景）。
DLし直しでファイル名は連番のみ。作業用に new-01〜new-16 と採番して1枚ずつ画像を開いて同定した。

## ステップ2: リネーム対応表（作業名 → 正規名）と同定
背景（near-white）を edge flood-fill で除去 → bbox トリム → 正方パディング → 256×256 へ統一（既存 card-pol-* と同形式）。

| 正規ファイル名 | 元(作業名) | カード | デッキ |
|---|---|---|---|
| card-sci-alchemist.png | new-07 | 錬金術師 | 科学 |
| card-sci-crane.png | new-08 | クレーン | 科学 |
| card-sci-engineer.png | new-16 ※ | 技師 | 科学 |
| card-sci-inventor.png | new-09 | 発明家 | 科学 |
| card-sci-irrigation.png | new-10 | 灌漑 | 科学 |
| card-sci-medicine.png | new-11 | 医術 | 科学 |
| card-sci-mining.png | new-12 | 鉱業 | 科学 |
| card-sci-road-building.png | new-13 | 街道建設 | 科学 |
| card-sci-smith.png | new-15 | 鍛冶 | 科学 |
| card-sci-printer.png | new-14 | 印刷機（VP） | 科学 |
| card-com-merchant.png | new-01 | 商人（保持中+1点） | 商業 |
| card-com-merchant-fleet.png | new-02 | 商船隊 | 商業 |
| card-com-master-merchant.png | new-03 | 大商人 | 商業 |
| card-com-commercial-harbor.png | new-04 | 商業港 | 商業 |
| card-com-resource-monopoly.png | new-05 | 資源独占 | 商業 |
| card-com-trade-monopoly.png | new-06 | 交易独占 | 商業 |

※ new-16 = 技師。当初 `asset/` に入っていたのは15枚で、16枚目（技師）だけ
`~/Desktop/image_download/ChatGPT Image 2026年6月17日 06_52_04 (3).png` に取り残されていた。
これを `asset/` へ取り込んで全16枚を揃えた。

## ステップ3: ★最重要・取り違えペアの重点確認（実画像で判別、自動鑑定の誤りを訂正）
自動鑑定が誤割当した2枚を、画像を開いて訂正した（決め手を明記）:

- **new-11**: 自動鑑定は「錬金術師」候補(0.72)。→ **実体は医術(medicine)**。胸の医療十字(✚)＋薬草・乳鉢・治療用の小瓶。
  錬金術師(new-07)は宙に浮く2サイコロ＋紫の魔術エフェクトが決め手で別物。
- **new-06**: 自動鑑定は「大商人」候補(0.88)。→ **実体は交易独占(trade_monopoly)**。紙/布/金貨（＝3商品）の山＋金庫＋そろばん。
  大商人(new-03)は紫の宝石を掲げる富豪＋宝石/真珠/金延べ棒（＝汎用の富）で別物。

その他のペアも実画像で確認:
- 錬金術師(new-07 サイコロ＋魔術) ↔ 医術(new-11 医療十字＋薬草) … 区別OK
- クレーン(new-08 吊り上げ機構) ↔ 技師(new-16 設計図＋城壁) ↔ 街道建設(new-13 石畳敷設) … 区別OK
- 鉱業(new-12 つるはし＋鉱脈) ↔ 鍛冶(new-15 炉＋金床＋武具) … 区別OK
- 商人(new-01 荷車の行商人) ↔ 大商人(new-03 宝石/金貨の富豪) … 区別OK
- 資源独占(new-05 木/レンガ/羊毛/小麦/鉱石) ↔ 交易独占(new-06 紙/布/金貨) … 区別OK
- 商船隊(new-02 海上の複数船) ↔ 商業港(new-04 陸の桟橋＋荷揚げクレーン) … 区別OK

→ ❓要確認の積み残しなし（16枚すべて確信度高で確定）。

## ステップ4: 紐づけ検証
- 中央マニフェスト [`src/assets/manifest.ts`](src/assets/manifest.ts) に16 import＋`progressCard`（25種＝政治9＋科学10＋商業6）を追加。
- 表示4箇所（効果モーダル・図鑑・手札ボタンのアイコン/参照）を
  `ASSETS.politicsCard[type] ?? cardBack` → `ASSETS.progressCard[type] ?? cardBack` に変更（[`src/renderer/ui.ts`](src/renderer/ui.ts)）。
- VP/点カード: 印刷機=`printer`→card-sci-printer（活版印刷機の絵）、商人=`merchant`→card-com-merchant（荷車の行商人）に正しく割り当て。
- テスト追加: 25種すべてが個別URLに解決＝プレースホルダ落ち無し・全て別画像（[`tests/manifest.test.ts`](tests/manifest.test.ts)）。全681＋1テスト緑・ビルドOK・404なし。

## ステップ5: 重複コピーの捜索 / 残課題
- **重複捜索**: `$HOME` 全体（Library/リポジトリ/node_modules を除く）を **内容ハッシュ(md5)** で走査。
  16枚と同一内容の重複コピーは **どこにも存在しなかった**。
  唯一の“別フォルダの該当画像”は上記の技師(new-16)で、これは重複ではなく `asset/` から欠けていた16枚目だった
  （取り込み済み）。`~/Desktop/image_download/` に残っていた技師の元ファイルは、本取り込み後は冗長のため削除した
  （同フォルダ内の無関係な旧画像2枚＝6月7日生成 は対象外として温存）。
- まだプレースホルダのままの素材（非カード・対象外）: 蛮族襲来バナー / タイトル背景 / 勝利背景 / 装飾フレーム。
</content>
