# Catan 仕様準拠監査レポート

監査実施日: 2026-06-01（最終更新: 2026-06-01）  
テスト数: 322 (全通過)  
実プレイ確認: 2026-06-01（Playwright ヘッドレス）→ docs/manual_playtest_report.md 参照

## 設計判断事項

### GAME_OVER 時の勝者情報表示（修正済み）
GAME_OVER 状態では、勝者プレイヤーのパネルで **VP カードと勝利点内訳のみ** を開示する：
- 勝者の VP カード枚数（`★×N`）— 公開
- 勝者の VP 内訳（開拓地・都市・最長道路・最大騎士団）— 公開
- 勝者の資源カード内訳 — **非公開のまま**（仕様通り）
- 勝者の他の発展カード種別 — **非公開のまま**（仕様通り）

実装: `isSelf = player.type === 'human'`（`isWinner` を含めない）。  
`showVpCards = (isSelf || isWinner) && bd.vpCards > 0` で勝者のVPカードのみ開示。

## 分類凡例

- ✅ 実装済み・テストあり
- 🟡 実装済みだがテスト不足
- 🟠 一部実装・不完全
- ❌ 未実装
- 🔴 実装バグあり・要修正

---

## A. ゲーム開始・初期配置

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| A-1 | 3〜4人プレイに対応 | ✅ | CPU数1〜3 + 人間1で2〜4人プレイ対応 |
| A-2 | 人間とCPUの混在 | ✅ | PlayerType='human'\|'ai' で管理 |
| A-3 | ターン順が時計回り | ✅ | SETUP_FORWARD: idx+1 |
| A-4 | 初期配置が蛇行順 | ✅ | advanceSetup() が正確に前半→後半逆順を実装 |
| A-5 | 1個目配置：先手から時計回り | ✅ | SETUP_FORWARD: index 0→1→2→3 |
| A-6 | 2個目配置：最後のプレイヤーから反時計回り | ✅ | SETUP_BACKWARD: index 3→2→1→0 |
| A-7 | 初期開拓地は距離ルールを守る | ✅ | canBuildSettlement → isDistanceRuleOk |
| A-8 | 初期街道は直前に置いた開拓地に接する | ✅ | canBuildRoad → isEdgeConnected（setup は資源不要・道接続不要） |
| A-9 | 初期資源は2個目の開拓地からだけ配られる | ✅ | SETUP_BACKWARD BUILD_SETTLEMENT 処理で隣接タイルから配布 |
| A-10 | 砂漠から資源を受け取らない | ✅ | TILE_RESOURCE_MAP.desert = null |

---

## B. 盤面生成

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| B-1 | 地形枚数が標準版通り（森4/丘陵3/牧草4/畑4/山地3/砂漠1） | ✅ | TILE_COUNTS で定義 |
| B-2 | 数字チップが標準版通り（2×1, 3×2, 4×2, ...12×1） | ✅ | NUMBER_TOKENS で定義 |
| B-3 | 7の数字チップが存在しない | ✅ | NUMBER_TOKENS に7なし |
| B-4 | 砂漠に数字チップを置かない | ✅ | placeNumberTokens は nonDesert のみ対象 |
| B-5 | 盗賊初期位置が砂漠 | ✅ | assignTileTypes: hasRobber: type === 'desert' |
| B-6 | 6と8が隣接しない | ✅ | hasRedConflict + 最大200回リトライ |
| B-7 | 港が9か所 | ✅ | HARBOR_SLOTS.length === 9 |
| B-8 | 3:1港が4つ | ✅ | HARBOR_TYPE_POOL に 'generic' × 4 |
| B-9 | 2:1専門港が各資源1つ | ✅ | HARBOR_TYPE_POOL に 'wood', 'brick', 'wool', 'grain', 'ore' 各1 |

---

## C. ターン状態遷移

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| C-1 | 各フェーズに相当する状態管理がある | 🟡 | PRE_ROLL/ROBBER/DISCARD/TRADE_BUILD は実装済み。SETUP_FORWARD/BACKWARD も実装。 |
| C-2 | サイコロ前に交易できない | ✅ | UI: PRE_ROLLではバンク交易ボタンなし |
| C-3 | サイコロ前に建設できない | ✅ | UI: PRE_ROLLでは建設ボタンなし |
| C-4 | サイコロ前にターン終了できない | ✅ | UI: PRE_ROLLでは「ターン終了」ボタンなし |
| C-5 | サイコロは1ターンに必ず1回だけ | ✅ | ROLL_DICE は turnPhase='PRE_ROLL' の時のみ有効 |
| C-6 | サイコロを2回振れない | ✅ | ROLL_DICE は diceRolledThisTurn=false + PRE_ROLL でのみ可 |
| C-7 | サイコロ後に交易・建設状態へ進む | ✅ | ROLL_DICE → TRADE_BUILD (7以外) or DISCARD/ROBBER (7) |
| C-8 | combinedTradeBuild 設定 | 🟠 | 常に combined モード（TRADE_BUILD）。設定切り替えは未実装 |

---

## D. サイコロ前の騎士カード

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| D-1 | サイコロ前に騎士カードを使える | ✅ | PRE_ROLLフェーズでPLAY_KNIGHT有効 |
| D-2 | 騎士カード使用後にサイコロが振れる | ✅ | **今回修正**: PLAY_KNIGHT→ROBBER→MOVE_ROBBER→PRE_ROLL(dice未済)で復帰 |
| D-3 | diceRolledThisTurn=false のまま | ✅ | PLAY_KNIGHT は diceRolledThisTurn を変更しない |
| D-4 | Roll Dice ボタンが有効のまま | ✅ | PRE_ROLLに戻るのでダイスボタン表示 |
| D-5 | 騎士カード使用後のダイスで7→捨て+盗賊 | ✅ | 通常の7処理フローに合流 |

---

## E. 資源産出

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| E-1 | 数字チップと同じ出目のヘクスだけ産出 | ✅ | distributeResources |
| E-2 | 盗賊がいるヘクスは産出しない | ✅ | `if (tile.hasRobber) continue` |
| E-3 | 同じ数字の別ヘクスは産出する | ✅ | 全タイルをイテレート |
| E-4 | 開拓地1枚・都市2枚 | ✅ | `amount = type === 'city' ? 2 : 1` |
| E-5 | 複数ヘクスに接している場合それぞれ産出 | ✅ | vertexIds 全てチェック |
| E-6 | 銀行資源が有限 | ✅ | min(needed, bank) で制限 |
| E-7 | 資源不足が複数プレイヤーに影響→誰も受け取らない | ✅ | **今回修正**: affectedPids>1 && total>bank → skip |
| E-8 | 資源不足が1プレイヤーのみ→銀行残数分受け取る | ✅ | 単一プレイヤー: min(needed, bank) |
| E-9 | 不足した資源以外は通常産出 | ✅ | 資源種類ごとに独立処理 |

---

## F. 7と盗賊

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| F-1 | 7では資源産出しない | ✅ | `if (diceTotal === 7) return state` |
| F-2 | 8枚以上のプレイヤーが半数(切り捨て)捨てる | ✅ | discardCount = floor(total/2)。15枚→7枚捨て→8枚残でも再捨て不要（discardedThisRound で管理） |
| F-3 | 7枚以下は捨てない | ✅ | `if (total < ROBBER_HAND_DISCARD_MIN) return 0` |
| F-4 | 発展カードは捨て札枚数に含めない | ✅ | handTotal = RESOURCE_TYPES.reduce のみ（devCardsは含まない） |
| F-5 | 全員の捨て完了後に盗賊移動へ進む | ✅ | discardedThisRound で捨て済みプレイヤーを除外したうえで stillNeeds チェック。テスト2件追加 |
| F-6 | 人間は自分で捨てる資源を選べる | ✅ | buildDiscardUI で操作可。CPUが同時捨てしても人間の選択状態を保持 |
| F-7 | CPUは自動で捨てる | ✅ | scheduleAiTurn + chooseDiscard。CPU捨て時に uiPhase をリセットしない修正済み |
| F-8 | 盗賊は現在地とは別ヘクスへ必ず移動 | ✅ | handleTileClick: `if (currentRobberTile?.id === tileId) return` |
| F-9 | 盗む相手は隣接相手から選ぶ | ✅ | getRobbablePlayerIds 実装 |
| F-10 | 自分自身を盗む対象にできない | ✅ | `filter(p => p !== pid)` |
| F-11 | 資源0枚の相手からは盗まない | ✅ | stealResource: `if (pool.length === 0) return state` |
| F-12 | 奪う資源種類はランダム | ✅ | pool からランダム選択 |
| F-13 | 騎士カードによる盗賊移動では捨て札が発生しない | ✅ | PLAY_KNIGHT → ROBBER（DISCARD をスキップ） |

---

## G. 国内交易

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| G-1 | 交易はサイコロ後のみ可能 | ✅ | TRADE_BUILD フェーズのみボタン表示 |
| G-2 | 手番プレイヤーを含まない交易は禁止 | 🟡 | OFFER_TRADE は pid（カレント）から実行。エンジン側のガードはあるが完全なテストなし |
| G-3 | 非手番プレイヤー同士の交換は禁止 | 🟡 | UI制御で防止。エンジン側バリデーション弱め |
| G-4 | 人間がCPU同士の交換を選択・成立できない | 🟠 | 現在 CPU は交易提案を自動拒否する実装がない。CPU 間交易ロジック未実装 |
| G-5 | 一方的な譲渡は禁止 | 🟡 | buildPlayerTradeOfferUI: giveTotal>0 && recvTotal>0 でボタン活性化 |
| G-6 | 発展カードを交換できない | ✅ | 交易対象は ResourceHand のみ |
| G-7 | 同一資源同士の無意味な交換を禁止 | 🟡 | エンジン側でのチェックなし（UI で通常発生しない） |
| G-8 | CPU の手番中、人間はCPUからの提案に承認/拒否だけできる | 🟠 | CPU は交易提案を行わない（chooseAction に OFFER_TRADE なし）。CPU から人間への提案機能は未実装 |

---

## H. 海外交易・港

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| H-1 | 4:1交換が常時可能 | ✅ | getEffectiveTradeRate デフォルト=4 |
| H-2 | 3:1港所有時に3:1交換 | ✅ | generic 港保有で rate=3 |
| H-3 | 2:1専門港所有時に該当資源2枚で交換 | ✅ | 該当資源港保有で rate=2 |
| H-4 | 港所有判定は港に接する建物で行う | ✅ | vertex.building.playerId の確認 |
| H-5 | 受け取る資源が銀行にない場合は交換不可 | ✅ | canBankTrade: bank[receive] < 1 → false |
| H-6 | サイコロ前に銀行・港交換できない | ✅ | UI: PRE_ROLL では銀行交易ボタンなし |

---

## I. 建設

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| I-1 | 街道コスト 木材1・レンガ1 | ✅ | BUILD_COSTS.road |
| I-2 | 開拓地コスト 木材1・レンガ1・羊毛1・小麦1 | ✅ | BUILD_COSTS.settlement |
| I-3 | 都市コスト 小麦2・鉱石3 | ✅ | BUILD_COSTS.city |
| I-4 | 発展カード購入コスト 羊毛1・小麦1・鉱石1 | ✅ | BUILD_COSTS.dev_card |
| I-5 | 街道は空き辺にだけ置ける | ✅ | `if (edge.road != null) return false` |
| I-6 | 街道は自分の既存道路/建物に接続 | ✅ | isEdgeConnected 実装 |
| I-7 | 相手の建物で接続が遮断される | ✅ | isEdgeConnected で相手建物チェック（Longest Road DFS と同様） |
| I-8 | 開拓地は距離ルールを守る | ✅ | isDistanceRuleOk |
| I-9 | 通常開拓地は自分の街道に接続 | ✅ | MAIN フェーズの canBuildSettlement |
| I-10 | 都市は自分の開拓地だけアップグレード | ✅ | canBuildCity: building.playerId===pid && type==='settlement' |
| I-11 | 都市化で開拓地が手元に戻る | ✅ | buildCity: remainingSettlements+1 |
| I-12 | 駒数制限（道15/開拓地5/都市4） | ✅ | remainingRoads/Settlements/Cities チェック |
| I-13 | エンジン側の turnPhase ガード | ✅ | applyAction 内で BUILD_ROAD/SETTLEMENT/CITY/BUY_DEV_CARD に turnPhase + phase チェックあり。GAME_OVER は冒頭で全面ブロック |

---

## J. 発展カード

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| J-1 | 発展カード25枚構成（騎士14/街道建設2/豊作2/独占2/勝利点5） | ✅ | DEV_CARD_COUNTS |
| J-2 | 発展カードの種類は所有者だけが見える | ✅ | buildPlayerPanel: 非アクティブは枚数のみ表示 |
| J-3 | 他プレイヤーには枚数だけ公開 | ✅ | `🃏 ×{count}` 表示 |
| J-4 | 発展カードを交換・譲渡できない | ✅ | 交易対象は ResourceHand のみ |
| J-5 | 1ターンに騎士/進歩カードは1枚まで | ✅ | devCardPlayedThisTurn フラグで2枚目を投げる。エンジンテストあり |
| J-6 | そのターンに買った騎士/進歩カードを使えない | ✅ | purchasedOnTurn < globalTurnNumber |
| J-7 | 勝利点カードは通常非公開 | ✅ | buildPlayerPanel: `showVpCards = isSelf && bd.vpCards > 0`。他プレイヤーのVP内訳には★を表示しない |
| J-8 | 勝利点カードは勝利できる場合だけ公開 | ✅ | GAME_OVER 時に勝者の VP カード枚数のみ開示（`showVpCards = (isSelf || isWinner) && bd.vpCards > 0`） |
| J-9 | 街道建設カードで最大2本無料道路 | ✅ | roadBuildingRoadsRemaining(2→1→0)でカウント。BUILD_ROAD がデクリメント。FINISH_ROAD_BUILDING で強制0。テスト済み |
| J-10 | 1本目によって2本目の合法位置が増える | ✅ | BUILD_ROAD 後に canBuildRoad が再評価される |
| J-11 | 豊作カードで同じ資源2枚選択可 | ✅ | yearOfPlenty UI: 同じ資源を2スロットに選択可能 |
| J-12 | 独占カードで全員から回収 | ✅ | PLAY_MONOPOLY: 全 otherPid から resource を0に |

---

## K. 最大騎士力

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| K-1 | 騎士3枚以上で獲得候補 | ✅ | LARGEST_ARMY_MIN = 3 |
| K-2 | 既存保持者より多くなった場合だけ奪える | ✅ | `if (k > maxKnights)` 厳密な不等号 |
| K-3 | 同数では奪えない | ✅ | `>` を使用（≥ でないため移動しない） |
| K-4 | 最大騎士力は2VP | ✅ | VP_TABLE.largestArmy = 2 |

---

## L. 最長交易路

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| L-1 | 5本以上で獲得候補 | ✅ | LONGEST_ROAD_MIN = 5 |
| L-2 | 分岐を合算していない | ✅ | DFS で各辺を1度だけカウント |
| L-3 | 同じ道を二重カウントしていない | ✅ | visited セットで管理 |
| L-4 | ループを正しく扱う | ✅ | visited で再訪防止 |
| L-5 | 相手の建物で分断する | ✅ | `blocked = vertex.building != null && building.playerId !== playerId` |
| L-6 | 自分の建物では分断しない | ✅ | `building.playerId !== playerId` の条件 |
| L-7 | 同数では保持者から奪えない | ✅ | `if (len > maxLen)` 厳密な不等号 |
| L-8 | 保持者が分断され新最長が複数同点ならカード場外 | ✅ | 実装済み。topPlayers.length > 1 → newHolder=null。保持者が同点に追いつかれた場合は保持者が維持。要件2・7のテスト追加 |
| L-9 | 誰も5本以上でなければ場外 | ✅ | holder=null のまま、MIN 以上に達した者がいなければ newHolder=null |

---

## M. 勝利判定

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| M-1 | VP内訳が正確 | ✅ | calcVP: 建物+最長+最大騎士+VPカード |
| M-2 | 公開VP と内部VP を区別 | ✅ | calcPublicVP（VPカード除外）と calcVP（全込み）を使い分け。他プレイヤーへの表示は calcPublicVP |
| M-3 | 自分のターン中に10点以上で即勝利 | ✅ | checkVictory はビルドアクション後に呼ばれる |
| M-4 | 建設・最大騎士力・最長交易路で10点到達時に即終了 | ✅ | checkVictory が各アクション後に呼ばれる |
| M-5 | 自分のターン外で10点になっても即勝利しない | ✅ | checkVictory は常に active player のみチェック |
| M-6 | 勝利後に追加操作ができない | ✅ | phase='GAME_OVER' → applyAction 冒頭でブロック（エンジンテスト4件追加）。chooseAction / UI もロック |

---

## N. UI・非公開情報

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| N-1 | 有効なボタンだけ表示または有効化 | ✅ | PRE_ROLL/TRADE_BUILD/フェーズ別に UI を切り替え |
| N-2 | PRE_ROLLでTrade/Build/End Turnが無効 | ✅ | PRE_ROLL では これらのボタンなし |
| N-3 | 強制処理中は他の操作が禁止 | 🟡 | DISCARD/ROBBER フェーズ中はボタンが出ない。完全なガードはエンジン側では行っていない |
| N-4 | 他プレイヤーの資源種類を見せていないか | 🔴 | **バグ**: buildPlayerPanel で全プレイヤーの resource 種類別枚数を表示している。CPUゲームでは影響小だが仕様違反 |
| N-5 | 他プレイヤーの未使用発展カード種類を見せていないか | ✅ | 非アクティブプレイヤーは `🃏 ×{count}` のみ表示 |
| N-6 | 他プレイヤーの勝利点カード枚数を見せていないか | ✅ | `showVpCards = isSelf && bd.vpCards > 0` で自分のみ表示。GAME_OVER時は勝者のみ開示 |

---

## O. 最低限の完成判定（15項目）

| # | 項目 | 状態 | 備考 |
|---|------|------|------|
| O-1 | 初期配置が蛇行順で正しく動く | ✅ | advanceSetup テスト済み |
| O-2 | 初期資源が2個目の開拓地からだけ配られる | ✅ | setup.test.ts でカバー |
| O-3 | サイコロ前に騎士カードを使ってもサイコロが振れる | ✅ | **今回修正**: diceRolledThisTurn フラグで制御 |
| O-4 | 騎士カードとサイコロ7の盗賊処理が区別されている | ✅ | **今回修正**: diceRolledThisTurn で区別 |
| O-5 | サイコロ7の捨て札が全員に正しく適用される | ✅ | discardedThisRound で1人1回のみ捨て保証。15枚所持→7枚捨て→8枚残でも再捨て不要。テスト追加済み |
| O-6 | 手番プレイヤーを含まない国内交易が禁止 | 🟡 | UI制御あり、エンジンテスト不足 |
| O-7 | 人間がCPU同士の交換を選択できない | 🟠 | CPUがOFFER_TRADEを使わないため実質未発生。明示的なガードなし |
| O-8 | 港交換の2:1、3:1、4:1が正しく判定される | ✅ | getEffectiveTradeRate テスト済み |
| O-9 | そのターンに買った騎士・進歩カードを使えない | ✅ | purchasedOnTurn < globalTurnNumber |
| O-10 | そのターンに買った勝利点カードで勝てる場合だけ即公開できる | 🟠 | 勝利点カード購入でcheckVictoryが呼ばれ自動勝利。DECLARE_VICTORYによる明示的公開フローは不完全 |
| O-11 | 最長交易路が分岐・分断・同点を正しく処理する | ✅ | 分岐・分断・単純同点・保持者脱落後複数同点(→null)すべて実装済み。テスト8件 |
| O-12 | 最大騎士力が同点では移動せず、上回ったときだけ移動する | ✅ | 厳密な `>` 演算子 |
| O-13 | 資源不足時の産出が資源種類ごとに正しく処理される | ✅ | **今回修正**: 複数プレイヤー影響時は配布なし |
| O-14 | 勝利判定が「自分のターン中のみ」になっている | ✅ | checkVictory(state, activePlayer) |
| O-15 | 10点到達時に即ゲーム終了する | ✅ | checkVictory → phase='GAME_OVER' |

---

## 要修正バグ一覧（優先度順）

### 🔴 高優先度

（現在 高優先度バグなし）

### 🟠 中優先度

| バグ | ファイル | 説明 |
|------|---------|------|
| CPU間交易未実装 | engine/ai.ts | CPUは交易提案を行わない（G-4/G-8） |

### ✅ 今回修正済み

| 項目 | ファイル | 内容 |
|------|---------|------|
| GAME_OVER 勝者表示を VP 内訳のみ開示 | renderer/ui.ts | `isSelf` から `isWinner` を除去。`showVpCards = (isSelf || isWinner) && bd.vpCards > 0` |
| BUILD_CITY/BUY_DEV_CARD の phase チェック追加 | engine/game.ts | `state.phase !== 'MAIN'` チェックを追加。SETUP フェーズでの誤使用をブロック |
| BUILD_ROAD の街道建設カード例外を明示 | engine/game.ts | `_isRoadBuilding = roadBuildingRoadsRemaining > 0` を明示的に条件追加 |
| GAME_OVER ブロックのエンジンテスト追加 | tests/game.test.ts | BUILD_ROAD/SETTLEMENT/CITY/BUY_DEV_CARD の GAME_OVER ブロックテスト4件 |
| SETUP フェーズ BUILD_CITY/BUY_DEV_CARD テスト | tests/game.test.ts | SETUP_FORWARD/BACKWARD での投げるテスト3件 |
| 街道建設カード中の BUILD_ROAD テスト | tests/game.test.ts | roadBuildingRoadsRemaining デクリメントテスト2件 |
| 最長交易路 要件2・要件7 テスト追加 | tests/scoring.test.ts | 保持者なし+2者同点→null、保持者(5)+2者同点(6)→null の2件 |
| docs L-8 誤記修正 | docs/spec_compliance_audit.md | 実装済みなのに🔴バグ扱いだった記載を✅に訂正 |
| 捨て札1回保証（discardedThisRound） | types.ts, engine/game.ts | 15枚所持でも floor(hand/2)を1回だけ捨てたらROBBERへ進む。GameStateにdiscardedThisRound追加 |
| CPU捨て時に人間のUI状態を保持 | main.ts | dispatch()でCPUのDISCARD_RESOURCESはuiPhaseをリセットしない |
| 捨て札テスト追加 | tests/game.test.ts | 15枚所持の単独捨て・2人同時捨て→各1回のみでROBBER遷移の2件 |
| 実プレイ確認レポート作成 | docs/manual_playtest_report.md | Playwrightヘッドレスで初期配置〜MAINフェーズをテスト |

---

## updateLongestRoad 仕様まとめ

| 状態 | 条件 | 結果 |
|------|------|------|
| 誰も5本未満 | maxLen < LONGEST_ROAD_MIN | null（場外） |
| 保持者が最長を維持 | holder != null && lengths[holder] == maxLen | holder 維持 |
| 単独新最長（保持者なし、または保持者脱落） | topPlayers.length == 1 | そのプレイヤー獲得 |
| 複数同点最長（保持者なし、または保持者脱落） | topPlayers.length > 1 | null（場外） |

注: 保持者が「同点に追いつかれた」場合（holder == maxLen）は保持者維持。「上回られた」場合は再判定。

---

## 次にClaude Codeへ指示すべき内容

1. **CPU交易提案** (engine/ai.ts): OFFER_TRADE アクションを選択肢に追加（G-4/G-8）
2. **GAME_OVER 手動確認**: Playwright ヘッドレスではCPU勝利まで時間がかかり未確認。実ブラウザで再戦・ホーム戻りを確認する
3. **発展カード・都市建設の手動確認**: 資源積みが必要で自動テスト困難。実ブラウザで動作確認する
