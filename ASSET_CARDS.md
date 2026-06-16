# 進歩カード素材 監査（科学10・商業6の本アート差し替え）

結論を先に: **`asset/` フォルダには「科学カード10種・商業カード6種の個別アート」は存在しない。**
中にあるのは、すでにゲームへ統合済みの コマ／改良建築／バナー／商品 の生成元レンダ画像（生データ）であり、
進歩カードの単独イラストではない。したがって 16 枚の本アート差し替えは **実施できない（素材未提供）**。
誤って建物/コマ画像をカードのスロットへ割り当てることはしない（例: 水道橋の建物を「灌漑」カードにする等は誤り）。

科学・商業カードは現状どおり **デッキ裏のプレースホルダ表示**（科学=緑／商業=黄）を維持する。
政治9種は従来どおり個別アート（`card-pol-*`）で表示される。

---

## ステップ1: `asset/` 実ファイルの棚卸し

ChatGPT 生成画像 25 枚（2026-06-16 21:47–22:33 生成）。解像度はカード型 1254×1254、横長バナー 1672×941。
1枚ずつ画像を開いて内容を同定した（25体並列の鑑定＋疑わしい数枚は手元で再確認）。

| 連番(作業名) | 解像度 | 実際に描かれているもの | 対応する“既存”アセット |
|---|---|---|---|
| img-01 | 1254² | 政治コマ9体の 3×3 モンタージュシート | `card-pol-*` の生成元 |
| img-02 | 1254² | 市場/交易所の建物 | bld-trading-house（交易所・商Lv3） |
| img-03 | 1254² | 金ドーム＋天秤紋の建物 | bld-bank（銀行・商Lv4） |
| img-04 | 1254² | 城/要塞の建物 | bld-fortress（要塞・政Lv3） |
| img-05 | 1254² | ゴシック大聖堂の建物 | bld-cathedral（大聖堂・政Lv4） |
| img-06 | 1254² | **水道橋**（水路を渡す石アーチ） | bld-aqueduct（水道橋・科Lv3）※カード「灌漑」ではない |
| img-07 | 1254² | 望遠鏡/原子紋の学術建物 | bld-theater（劇場・科Lv4） |
| img-08 | 1672×941 | ヴァイキング上陸の戦闘バナー | bg-barbarian（蛮族襲来背景） |
| img-09 | 1672×941 | 島全体の俯瞰パノラマ | bg-title（タイトル背景） |
| img-10 | 1672×941 | 島＋花火の祝祭パノラマ | bg-victory（勝利背景） |
| img-11 | 1254² | 中空の装飾フレーム | frame-decorative（装飾フレーム） |
| img-12 | 1254² | 緑リボンで束ねた書類＋巻物 | card-back-science / com-paper（紙） |
| img-13 | 1254² | 金リボンの青い布の束 | com-cloth（布）/ card-back-politics |
| img-14 | 1254² | 金貨の山（歯車紋） | com-coin（金貨）/ card-back-trade |
| img-15,16,17 | 1254² | 鎧の騎士フィギュア（青羽飾り） | knight-basic/strong/mighty の生成元 |
| img-18 | 1254² | 鞄を提げたフード姿の小コマ | merchant（商人コマ） |
| img-19 | 1254² | 城門（青円錐屋根の塔＋扉） | metropolis-gate（メトロポリス門） |
| img-20 | 1254² | 月桂樹に囲まれた盾エンブレム | defender-badge（守護者バッジ） |
| img-21 | 1254² | **城壁**セクション（青盾2枚） | city-wall（城壁コマ）※カード「技師」ではない |
| img-22,23,24 | 1254² | 鎧の騎士フィギュア | knight-* の生成元 |
| img-25 | 1254² | ヴァイキング軍船（竜頭・髑髏帆） | barbarian-ship（蛮族船） |

## ステップ2: 正規名への照合と差し替え
**該当なし。** 16枚の個別カードアート（`card-sci-*` / `card-com-*`）に相当する画像が存在しないため、
リネーム対応表・マニフェスト差し替えは作成していない（捏造割当を避ける）。中央マニフェストは無変更。

## ステップ3: 取り違えペアの重点確認（❓要確認＝今回はすべて「カードではない」と判明）
鑑定で science/commerce に寄った“候補”は、画像を開いて確認した結果すべて建物/コマ/商品だった:

- ❓ img-06 → 鑑定は「灌漑(irrigation)」候補(0.92)。**実体は水道橋の建物**（bld-aqueduct）。カードではない。
- ❓ img-21 → 鑑定は「技師(engineer)」候補(0.78)。**実体は城壁コマ**（city-wall）。カードではない。
- ❓ img-02 → 鑑定は「商業港(commercial-harbor)」候補(0.45)。**実体は交易所の建物**（bld-trading-house）。カードではない。
- ❓ img-13/14 → 「交易独占(trade-monopoly)」候補(0.40/0.50)。**実体は商品コマ**（布／金貨）。カードではない。

→ ★最重要の取り違えペア（錬金術師↔医術・クレーン↔技師↔街道建設・鉱業↔鍛冶・商人↔大商人・
資源独占↔交易独占・商船隊↔商業港）は、そもそも**いずれの単独カード絵も asset/ に存在しない**ため判別対象なし。

## ステップ4: 紐づけ検証
- 政治9＝個別アート表示（OK）。科学10＋商業6＝デッキ裏プレースホルダ表示（緑/黄）のまま（変更なし）。
- VP/点が絡むカード（印刷機=VP / 商人=保持中+1点）は、エンジン側スロット（`printer` / `merchant`）が
  正しく定義済み（[`src/constants.ts`](src/constants.ts)）。アート未提供のため表示は当該デッキ裏のまま。

## ステップ5: 残課題 / まだプレースホルダのままの素材
- **未提供（本対応に必要）**: 科学10・商業6の個別カードイラスト 計16枚。
  正規名で `src/assets/` に置けば即結線できる（下記）:
  - 科学(緑): card-sci-alchemist / -crane / -engineer / -inventor / -irrigation / -medicine /
    -mining / -road-building / -smith / -printer
  - 商業(黄): card-com-merchant / -merchant-fleet / -master-merchant / -commercial-harbor /
    -resource-monopoly / -trade-monopoly
  - エンジンの型スラッグ対応（結線キー）: `alchemist, crane, engineer, inventor, irrigation, medicine,
    mining, printer, road_building_progress, smith` ／ `commercial_harbor, master_merchant, merchant,
    merchant_fleet, resource_monopoly, trade_monopoly`。
  - 結線箇所（提供されれば数行）: [`src/assets/manifest.ts`](src/assets/manifest.ts) に16 import＋
    `progressCard` マップ追加、[`src/renderer/ui.ts`](src/renderer/ui.ts) のカード絵参照4箇所
    （`ASSETS.politicsCard[type] ?? ASSETS.cardBack[deck]` → `ASSETS.progressCard[type] ?? ASSETS.cardBack[deck]`）。
- 既定どおりプレースホルダ継続（非カード素材・対象外）: 蛮族襲来バナー / タイトル背景 / 勝利背景 / 装飾フレーム。
</content>
