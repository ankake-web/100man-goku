// ============================================================
// src/types.ts — 100万石 全型定義
// ============================================================

// ---- 座標 ----

export type AxialCoord = { readonly q: number; readonly r: number };
export type Point = { readonly x: number; readonly y: number };

// ---- リソース ----

export type ResourceType = 'wood' | 'brick' | 'wool' | 'grain' | 'ore';
export type ResourceHand = Record<ResourceType, number>;

// ---- 武将と商い(Cities & Knights)拡張: 物産(コモディティ) ----
// 城が「森林→紙 / 牧→絹 / 鉱山→金」を1個ずつ追加産出する。城下の改善の支払いに使う。
export type CommodityType = 'coin' | 'cloth' | 'paper';
export type CommodityHand = Record<CommodityType, number>;
/** バンク交易の対象（資源または物産）。物産交易は武将と商いのみ。 */
export type TradeKind = ResourceType | CommodityType;

// ---- タイル ----

// 基本タイル: forest/field/pasture/hill/mountain/desert
// 航海者拡張: sea（海・数字なし・産出なし）, gold（金・任意資源を産出）
export type TileType = 'forest' | 'field' | 'pasture' | 'hill' | 'mountain' | 'desert' | 'sea' | 'gold';
export type TileId = string; // 例: "1,0"（axial q,r）

export interface Tile {
  readonly id: TileId;
  readonly coord: AxialCoord;
  type: TileType;
  number: number | null; // 荒野は null
  hasRobber: boolean;
}

// ---- 頂点（Vertex） ----
// ID はボード生成時のピクセル座標重複排除で確定（"v0"〜"v53"）

export type VertexId = string;

export interface Vertex {
  readonly id: VertexId;
  readonly pixel: Point;                 // SVGレンダリング用（不変）
  readonly adjacentTileIds: TileId[];
  readonly adjacentEdgeIds: EdgeId[];
  readonly adjacentVertexIds: VertexId[];
  building: Building | null;
  harborType: HarborType | null;
  // 武将と商い: この頂点の武将コマ（建物とは排他）。基本/航海者では未設定。
  knight?: Knight | null;
}

// ---- 辺（Edge） ----
// ID は両端 VertexId をソートして "|" 連結

export type EdgeId = string;

export interface Edge {
  readonly id: EdgeId;
  readonly midpoint: Point;              // 街道コマのSVG配置位置
  readonly vertexIds: readonly [VertexId, VertexId];
  readonly adjacentEdgeIds: EdgeId[];    // 最長街道DFS用
  road: Road | null;
  // 航海者拡張: 海に面した辺に置く船。1つの辺は road か ship のどちらか一方のみ。
  // 基本ゲームでは常に null（海タイルが無いため）。
  ship?: Ship | null;
}

// ---- 建物・街道 ----

export type BuildingType = 'settlement' | 'city';

export interface Building {
  readonly type: BuildingType;
  readonly playerId: PlayerId;
  // 武将と商い: 城下の改善Lv4到達で天守化した城（勝利点4・石垣扱い）。
  readonly metropolis?: boolean;
  // 武将と商い: 石垣付きの城（7の捨て札上限+2）。
  readonly wall?: boolean;
}

// ---- 武将と商い(Cities & Knights) ----
export type CkTrack = 'trade' | 'politics' | 'science'; // 商(絹)/政(金)/学(紙)
export type KnightStrength = 1 | 2 | 3;                  // 基本/強力/最強

// 武将コマ（頂点に置く。自分の街道網に接続。起動すると一揆勢防衛に算入）。
export interface Knight {
  readonly playerId: PlayerId;
  readonly strength: KnightStrength;
  readonly active: boolean;
  // 武将と商い: このターンに起動したか。起動したターンは行動(移動/押出/追払い)不可。END_TURNでクリア。
  readonly activatedThisTurn?: boolean;
}

// 進歩カード（軍略カードの置換）。色イベント面で改善レベルに応じて引く。即時効果。
export type ProgressCardType =
  // 学(緑/紙)
  | 'smith'        // 武将を最大2体まで無料で1段昇格
  | 'engineer'     // 石垣を1つ無料建設
  | 'irrigation'   // 自分の建物に隣接する田1つにつき米2
  | 'mining'       // 自分の建物に隣接する鉱山1つにつき鉄2
  | 'alchemist'    // 次のダイスの目を自分で決めてから振る（自動で最良の目）
  | 'crane'        // 城下の改善を物産1個安く即建設
  | 'inventor'     // 数字トークン2枚を入れ替え（自動で自分に有利に）
  | 'medicine'     // 米1鉄2で砦を築城
  | 'printer'      // 即時+1勝利点
  | 'road_building_progress' // 街道を2本無料建設
  // 商(黄/絹)
  | 'resource_monopoly' // 各相手から指定資源を2枚（自動で最良資源）
  | 'trade_monopoly'    // 各相手から指定物産を1枚（自動で最良物産）
  | 'master_merchant'   // VP最多の相手から無作為2枚
  | 'commercial_harbor' // 各相手と 自分の資源1⇄相手の物産1 を交換
  | 'merchant'          // 御用商人コマを資源地形に置く（+1VP・その地形2:1）
  | 'merchant_fleet'    // このターン、指定1種を2:1で交易
  // 政(青/金)
  | 'warlord'      // 自分の武将を全て無料で起動
  | 'saboteur'     // 自分以上のVPの全員が資源を半数捨てる
  | 'wedding'      // 自分よりVPが高い各相手から2枚もらう
  | 'bishop'       // 野盗を移動し移動先隣接の全相手から各1枚
  | 'constitution' // 即時+1勝利点
  | 'deserter'     // 相手の武将を1体消し、自分は同強度の非起動武将を得る
  | 'diplomat'     // 端の街道1本を撤去（自分の街道なら再建設）
  | 'intrigue'     // 自分の街道に隣接する敵武将を1体退去
  | 'spy';         // 相手の進歩カードを1枚奪う

export interface ProgressCard {
  readonly id: string;
  readonly type: ProgressCardType;
  readonly deck: CkTrack;
}

export interface Road {
  readonly playerId: PlayerId;
}

// 航海者拡張: 船（海上の街道）。
export interface Ship {
  readonly playerId: PlayerId;
}

// ---- 湊 ----

export type HarborType = 'generic' | ResourceType; // generic = 3:1、ResourceType = 2:1

export interface Harbor {
  readonly id: string;
  readonly type: HarborType;
  readonly vertexIds: readonly [VertexId, VertexId];
}

// ---- プレイヤー ----

export type PlayerId = 'player1' | 'player2' | 'player3' | 'player4';
export type PlayerColor = 'red' | 'blue' | 'purple' | 'orange';
export type PlayerType = 'human' | 'ai';
// AIの強さ。内部4段階だが、UIは「弱い/普通/強い」の3択を normal/strong/elite に割り当てる
//（'weak'=旧ランダム級は現在UI非公開。テスト互換のため型としては残す）。'elite' が最上位。
export type AiDifficulty = 'weak' | 'normal' | 'strong' | 'elite';

export type DevCardType =
  | 'knight'
  | 'road_building'
  | 'year_of_plenty'
  | 'monopoly'
  | 'victory_point';

export interface DevCard {
  readonly id: string;
  readonly type: DevCardType;
  readonly purchasedOnTurn: number; // globalTurnNumber 単位。canPlay: purchasedOnTurn < current
}

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: PlayerColor;
  readonly type: PlayerType;
  readonly aiDifficulty?: AiDifficulty;

  hand: ResourceHand;
  // 武将と商い: 物産(コモディティ)の手札。基本/航海者では未設定。
  commodities?: CommodityHand;
  // 武将と商い: 城下の改善の各ツリーのレベル(0..5)。
  improvements?: Record<CkTrack, number>;
  // 武将と商い: 一揆勢撃退で得た「国の守護者」勝利点。
  defenderVP?: number;
  // 武将と商い: 進歩カード(印刷/立憲)で得た恒久勝利点。
  progressVP?: number;
  // 武将と商い: 商船隊(merchant_fleet)で「このターン2:1で交易できる」種別。END_TURN でクリア。
  merchantFleetType?: TradeKind | null;
  // 武将と商い: 手札の進歩カード（最大4枚）。
  progressCards?: ProgressCard[];
  // LANマスク用: 相手の進歩カード枚数（中身は隠す）。
  progressCardCount?: number;
  // LANマスク用: 相手の物産(コモディティ)枚数（内訳は隠す）。
  commodityCount?: number;

  // - アクションカードは使用後に除去する
  // - 勝利点カードは宣言まで除去しない
  devCards: DevCard[];

  remainingRoads: number;        // 初期 15
  remainingSettlements: number;  // 初期 5
  remainingCities: number;       // 初期 4
  remainingShips?: number;       // 航海者拡張の船コマ（初期 15）。基本ゲームでは未使用。

  knightsPlayed: number;        // 使用済み武将カード枚数
  longestRoadLength: number;    // 現在の最長街道長

  hasLongestRoad: boolean;
  hasLargestArmy: boolean;

  // ---- LAN対戦の秘匿マスク用（表示専用・単一端末プレイでは常に未設定） ----
  // 他プレイヤー視点へ配信する state では hand / devCards の中身を隠し、
  // 枚数だけをここへ入れて配信する。applyAction はこれらを一切参照しない。
  handCount?: number;
  devCardCount?: number;
}

// ---- フェーズ ----

export type GamePhase =
  | 'SETUP_FORWARD'  // 初期配置 前半（時計回り）
  | 'SETUP_BACKWARD' // 初期配置 後半（逆順）
  | 'MAIN'
  | 'GAME_OVER';

export type TurnPhase =
  | 'PRE_ROLL'    // ダイスロール前（軍略カード使用可）
  | 'ROBBER'      // 野盗処理中
  | 'DISCARD'     // 手札8枚以上の捨て処理
  | 'GOLD'        // 航海者: 金タイル産出の資源選択待ち（DISCARD と同様の多人数解決）
  | 'CITY_DOWNGRADE' // 武将と商い: 一揆勢敗北で格下げする城の選択待ち（DISCARD と同様の多人数解決）
  | 'PROGRESS_DISCARD' // 武将と商い: 進歩カード上限超過（5枚目）で捨てる1枚の選択待ち（多人数解決）
  | 'TRADE_BUILD' // 交易・建設
  | 'END';

export type SetupSubPhase = 'PLACE_SETTLEMENT' | 'PLACE_ROAD';

// ---- 交易 ----

export type TradeState =
  | 'TRADE_OFFER'
  | 'TRADE_RESPONSE'
  | 'TRADE_CONFIRM'
  | 'TRADE_EXECUTE'
  | 'TRADE_CANCELLED';

export interface TradeOffer {
  give: Partial<ResourceHand>;
  receive: Partial<ResourceHand>;
}

export interface PlayerResponse {
  readonly playerId: PlayerId;
  readonly status: 'ACCEPT' | 'REJECT' | 'COUNTER';
  readonly counterOffer?: TradeOffer;
  readonly timedOutAt?: number;
}

export interface PendingTrade {
  state: TradeState;
  readonly initiatorId: PlayerId;
  offer: TradeOffer;
  readonly targetPlayerIds: PlayerId[];
  responses: Record<string, PlayerResponse>; // PlayerId → response
  selectedResponderId: PlayerId | null;
}

// ---- GameState ----

export interface GameState {
  // ボード（Record = JSON シリアライズ可）
  tiles: Record<TileId, Tile>;
  vertices: Record<VertexId, Vertex>;
  edges: Record<EdgeId, Edge>;
  harbors: Harbor[];
  tileToVertices: Record<TileId, VertexId[]>;
  tileToEdges: Record<TileId, EdgeId[]>;

  players: Record<string, Player>; // PlayerId → Player
  playerOrder: PlayerId[];

  bank: ResourceHand;
  // 武将と商い: 物産(コモディティ)の銀行在庫。バンク交易/産出で増減し枯渇したら配れない。非CKでは未設定。
  commodityBank?: CommodityHand;
  // 武将と商い(Cities & Knights)拡張が有効か。未設定=基本/航海者ルール。
  expansion?: 'cities_knights';
  // 武将と商い: 一揆勢船の進行度(0..7)。7で襲来して判定後 0 に戻る。
  barbarianPosition?: number;
  // 武将と商い: これまでの一揆勢襲来回数。
  barbarianAttacks?: number;
  // 武将と商い: 直近のイベントダイスの目（'ship'=一揆勢前進 / 色=進歩カード抽選）。
  lastEventDie?: 'ship' | CkTrack;
  // 武将と商い: 直近に使われた進歩カード（公開情報）。使用した瞬間に種類を全員へ見せる演出に使う。
  // LANでは使用者の手札がマスクされ札種を引けないため、ここに公開で載せて他プレイヤーにも表示できるようにする。
  lastProgressPlay?: { playerId: PlayerId; cardType: ProgressCardType } | null;
  // 武将と商い: 各天守の保持者と所在頂点（ツリーごとに最大1人・盤面で一意）。
  // Lv5到達者が Lv4保持者から奪取するために頂点IDを保持する。
  metropolis?: Partial<Record<CkTrack, { playerId: PlayerId; vertexId: VertexId }>>;
  // 武将と商い: 進歩カードの山札（ツリー別）。
  progressDecks?: Record<CkTrack, ProgressCard[]>;
  // 武将と商い: 御用商人(merchant)コマの保持者と所在タイル（盤面で一意・移動式・+1VP/2:1）。
  merchant?: { playerId: PlayerId; tileId: TileId } | null;
  // 武将と商い: 錬金術師(alchemist)で事前指定した次ROLL_DICEの目。消費したら null。
  alchemistForcedDice?: [number, number] | null;

  devDeck: DevCard[];
  devDiscardPile: DevCard[];

  phase: GamePhase;
  turnPhase: TurnPhase;
  currentPlayerIndex: number;

  // 手番単位のインクリメント（個人ターンごと+1）。
  // purchasedOnTurn < globalTurnNumber なら使用可能。
  globalTurnNumber: number;

  // MAIN / GAME_OVER では null
  setupSubPhase: SetupSubPhase | null;

  // セットアップで直前に置いた砦の頂点。直後の街道はこの砦に接続せねばならない
  // （標準ルール）。PLACE_ROAD 解決後は null に戻す。未設定時は従来の接続判定にフォールバック。
  setupRoadAnchor?: VertexId | null;

  lastDiceRoll: [number, number] | null;
  // このターンにダイスを振ったか（武将カードをダイス前に使用した場合の判別用）
  diceRolledThisTurn: boolean;
  // 普請カードで残り無料配置できる街道数（0=通常モード、1 or 2=無料配置中）
  roadBuildingRoadsRemaining: number;
  // 航海者: このターンに船を移動したか（航海は1ターン1回）。END_TURN でリセット。
  shipMovedThisTurn?: boolean;
  // 航海者: このターンに建設した船の辺ID（建てたばかりの船は移動できない）。END_TURN でリセット。
  shipsBuiltThisTurn?: EdgeId[];
  // 武将と商い: このターンに武将を移動したか（移動は1ターン1回）。END_TURN でリセット。
  knightMovedThisTurn?: boolean;
  // 武将と商い: このターンに武将で野盗を追い払ったか（1ターン1回）。END_TURN でリセット。
  knightChasedThisTurn?: boolean;
  // 航海者: 海賊コマの現在地（海タイルID）。未配置は undefined。野盗の海版で、隣接する
  // 自分の船建設を封じ、隣接船の所有者から1枚奪える。基本ゲームでは未使用。
  piratePosition?: TileId;
  // このターンに武将・進歩カードを使ったか（1ターン1枚制限）
  devCardPlayedThisTurn: boolean;

  longestRoadHolder: PlayerId | null;
  largestArmyHolder: PlayerId | null;

  // 勝利に必要な勝利点。シナリオ別（基本=10／航海者の大きい盤=13）。未設定は VP_TABLE.target。
  victoryTarget?: number;

  // 航海者拡張: 「新しい島への最初の入植」ボーナス。島の代表タイルID → 最初に入植したプレイヤー。
  // 各エントリ +2VP（calcVP で加算）。基本ゲームでは常に空（海タイルが無く発生しない）。
  islandBonus?: Record<string, PlayerId>;

  // 航海者拡張: 金タイル産出で「任意資源を選ぶ権利」の残数。PlayerId → 選ぶ枚数。
  // turnPhase==='GOLD' の間だけ非空。各プレイヤーが CHOOSE_GOLD で解決し、全員空になると
  // TRADE_BUILD へ進む（DISCARD と同様の多人数解決）。基本ゲームでは常に未使用。
  pendingGoldChoice?: Record<string, number>;

  // 武将と商い: 一揆勢敗北で「城1つを格下げする」必要があるプレイヤー（最弱・平の城持ち）。
  // turnPhase==='CITY_DOWNGRADE' の間だけ非空。各自 DOWNGRADE_CITY で解決し、全員空になると
  // 生産/捨て札など本来の続きへ進む（DISCARD と同様の多人数解決）。
  pendingCityDowngrade?: PlayerId[];

  // 武将と商い: 進歩カードの手札上限(4・VPカード除外)を超えて引いたため、捨てる1枚を選ぶ必要が
  // あるプレイヤー。turnPhase==='PROGRESS_DISCARD' の間だけ非空。各自 DISCARD_PROGRESS で解決。
  pendingProgressDiscard?: PlayerId[];

  pendingTrade: PendingTrade | null;
  winner: PlayerId | null;

  // DISCARD フェーズで既に捨てたプレイヤーを記録（15枚以上所持時の二重捨て防止）
  discardedThisRound: PlayerId[];

  log: LogEntry[];
}

// ---- ログ ----

export type LogEntryType =
  | 'DICE_ROLL' | 'RESOURCE_GAIN' | 'BUILD' | 'TRADE_BANK'
  | 'TRADE_PLAYER' | 'DEV_CARD' | 'ROBBER' | 'BONUS_CHANGE' | 'VICTORY' | 'DISCARD'
  | 'SYSTEM';

export interface LogEntry {
  readonly turn: number;
  readonly playerId: PlayerId;
  readonly type: LogEntryType;
  readonly message: string;
}

// ---- アクション ----

// 進歩カードの「プレイヤーが選ぶ」対象（公式準拠）。
//   資源独占=resource / 交易独占=commodity / 大商人=targetPlayerId。未指定なら自動最善で解決。
export interface ProgressChoice {
  resource?: ResourceType;
  commodity?: CommodityType;
  targetPlayerId?: PlayerId;
  // 錬金術師: 次のダイス目（赤・黄 各1〜6）を自分で指定。
  dice?: readonly [number, number];
  // 発明家: 数字トークンを入れ替える2タイルのID。
  inventorTiles?: readonly [TileId, TileId];
  // 御用商人: 御用商人コマを置く資源タイルのID（自分の建物に隣接する陸タイル）。
  merchantTileId?: TileId;
  // クレーン: 1段安く改善するトラック（商/政/学）。
  craneTrack?: CkTrack;
  // 僧正(bishop): 野盗を置くタイルのID（隣接する全相手から1枚ずつ奪う）。
  bishopTileId?: TileId;
  // 外交官(diplomat): 撤去する相手の「端の街道」の辺ID。
  diplomatEdgeId?: EdgeId;
  // 脱走兵(deserter): 消す相手の武将の頂点ID（同強度の武将を自分が得る）。
  deserterVertexId?: VertexId;
  // 医術(medicine): 城に格上げする自分の砦の頂点ID。
  medicineVertexId?: VertexId;
  // 商業湊(commercial_harbor): 各相手に渡す自分の資源1種＋各相手から要求する物産1種を指名（全相手共通）。
  commercialGive?: ResourceType;
  commercialTake?: CommodityType;
  // 商船隊(merchant_fleet): このターン 2:1 で交易する1種（資源 or 物産）。
  fleetType?: TradeKind;
  // 鍛冶屋(smith): 1段昇格する自分の武将の頂点ID（最大2体）。
  smithVertexIds?: readonly VertexId[];
  // 技師(engineer): 石垣を建てる自分の城の頂点ID。
  engineerVertexId?: VertexId;
  // 陰謀(intrigue): 退去させる「自分の街道/船に隣接する敵武将」の頂点ID。
  intrigueVertexId?: VertexId;
  // スパイ(spy): 進歩カードを盗む相手と、盗む札のID（公式: 相手の手札を見て1枚選ぶ）。
  spyTargetPlayerId?: PlayerId;
  spyCardId?: string;
}

export type Action =
  | { type: 'ROLL_DICE' }
  | { type: 'MOVE_ROBBER';         tileId: TileId; stealFromPlayerId: PlayerId | null }
  | { type: 'MOVE_PIRATE';         tileId: TileId; stealFromPlayerId: PlayerId | null }
  | { type: 'DISCARD_RESOURCES';   playerId: PlayerId; resources: Partial<ResourceHand>; commodities?: Partial<CommodityHand> }
  | { type: 'DOWNGRADE_CITY';      playerId: PlayerId; vertexId: VertexId } // 一揆勢敗北で城を格下げ
  | { type: 'DISCARD_PROGRESS';    playerId: PlayerId; cardId: string }     // 進歩カード上限超過で1枚捨てる
  | { type: 'BUILD_ROAD';          edgeId: EdgeId }
  | { type: 'BUILD_SHIP';          edgeId: EdgeId }
  | { type: 'MOVE_SHIP';           fromEdgeId: EdgeId; toEdgeId: EdgeId }
  | { type: 'CHOOSE_GOLD';         playerId: PlayerId; resources: Partial<ResourceHand> }
  | { type: 'BUILD_SETTLEMENT';    vertexId: VertexId }
  | { type: 'BUILD_CITY';          vertexId: VertexId }
  | { type: 'BUY_DEV_CARD' }
  | { type: 'PLAY_KNIGHT' }
  | { type: 'PLAY_ROAD_BUILDING' }
  | { type: 'PLAY_YEAR_OF_PLENTY'; resources: [ResourceType, ResourceType] }
  | { type: 'PLAY_MONOPOLY';       resource: ResourceType }
  | { type: 'BANK_TRADE';          give: TradeKind; receive: TradeKind }
  | { type: 'BUILD_KNIGHT';        vertexId: VertexId }
  | { type: 'ACTIVATE_KNIGHT';     vertexId: VertexId }
  | { type: 'UPGRADE_KNIGHT';      vertexId: VertexId }
  | { type: 'BUILD_IMPROVEMENT';   track: CkTrack; metropolisVertexId?: VertexId } // metropolisVertexId: Lv4+到達時に天守化する城を手動指定（任意）
  | { type: 'BUILD_CITY_WALL';     vertexId: VertexId }
  | { type: 'MOVE_KNIGHT';         fromVertexId: VertexId; toVertexId: VertexId }
  | { type: 'CHASE_ROBBER';        vertexId: VertexId } // 武将で野盗を追い払う（ROBBERフェーズへ遷移）
  | { type: 'PLAY_PROGRESS';       cardId: string; choice?: ProgressChoice; cardType?: ProgressCardType } // cardType: 使用札の種類（公開情報）。LANで他プレイヤーが盤面表示するため送信側が付与する。
  | { type: 'OFFER_TRADE';         offer: TradeOffer; targetPlayerIds: PlayerId[] }
  | { type: 'RESPOND_TRADE';       response: PlayerResponse }
  | { type: 'CONFIRM_TRADE';       responderId: PlayerId }
  | { type: 'CANCEL_TRADE' }
  | { type: 'FINISH_ROAD_BUILDING' }
  | { type: 'END_TURN' }
  | { type: 'DECLARE_VICTORY' };
