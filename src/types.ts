// ============================================================
// src/types.ts — カタン全型定義
// ============================================================

// ---- 座標 ----

export type AxialCoord = { readonly q: number; readonly r: number };
export type Point = { readonly x: number; readonly y: number };

// ---- リソース ----

export type ResourceType = 'wood' | 'brick' | 'wool' | 'grain' | 'ore';
export type ResourceHand = Record<ResourceType, number>;

// ---- タイル ----

// 基本タイル: forest/field/pasture/hill/mountain/desert
// 航海者拡張: sea（海・数字なし・産出なし）, gold（金・任意資源を産出）
export type TileType = 'forest' | 'field' | 'pasture' | 'hill' | 'mountain' | 'desert' | 'sea' | 'gold';
export type TileId = string; // 例: "1,0"（axial q,r）

export interface Tile {
  readonly id: TileId;
  readonly coord: AxialCoord;
  type: TileType;
  number: number | null; // 砂漠は null
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
}

// ---- 辺（Edge） ----
// ID は両端 VertexId をソートして "|" 連結

export type EdgeId = string;

export interface Edge {
  readonly id: EdgeId;
  readonly midpoint: Point;              // 道コマのSVG配置位置
  readonly vertexIds: readonly [VertexId, VertexId];
  readonly adjacentEdgeIds: EdgeId[];    // 最長道路DFS用
  road: Road | null;
  // 航海者拡張: 海に面した辺に置く船。1つの辺は road か ship のどちらか一方のみ。
  // 基本ゲームでは常に null（海タイルが無いため）。
  ship?: Ship | null;
}

// ---- 建物・道 ----

export type BuildingType = 'settlement' | 'city';

export interface Building {
  readonly type: BuildingType;
  readonly playerId: PlayerId;
}

export interface Road {
  readonly playerId: PlayerId;
}

// 航海者拡張: 船（海上の道）。
export interface Ship {
  readonly playerId: PlayerId;
}

// ---- 港 ----

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
export type AiDifficulty = 'weak' | 'normal' | 'strong';

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

  // - アクションカードは使用後に除去する
  // - 勝利点カードは宣言まで除去しない
  devCards: DevCard[];

  remainingRoads: number;        // 初期 15
  remainingSettlements: number;  // 初期 5
  remainingCities: number;       // 初期 4
  remainingShips?: number;       // 航海者拡張の船コマ（初期 15）。基本ゲームでは未使用。

  knightsPlayed: number;        // 使用済み騎士カード枚数
  longestRoadLength: number;    // 現在の最長道路長

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
  | 'PRE_ROLL'    // ダイスロール前（発展カード使用可）
  | 'ROBBER'      // 強盗処理中
  | 'DISCARD'     // 手札8枚以上の捨て処理
  | 'GOLD'        // 航海者: 金タイル産出の資源選択待ち（DISCARD と同様の多人数解決）
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

  // セットアップで直前に置いた開拓地の頂点。直後の道はこの開拓地に接続せねばならない
  // （標準ルール）。PLACE_ROAD 解決後は null に戻す。未設定時は従来の接続判定にフォールバック。
  setupRoadAnchor?: VertexId | null;

  lastDiceRoll: [number, number] | null;
  // このターンにダイスを振ったか（騎士カードをダイス前に使用した場合の判別用）
  diceRolledThisTurn: boolean;
  // 街道建設カードで残り無料配置できる道路数（0=通常モード、1 or 2=無料配置中）
  roadBuildingRoadsRemaining: number;
  // 航海者: このターンに船を移動したか（航海は1ターン1回）。END_TURN でリセット。
  shipMovedThisTurn?: boolean;
  // 航海者: 海賊コマの現在地（海タイルID）。未配置は undefined。盗賊の海版で、隣接する
  // 自分の船建設を封じ、隣接船の所有者から1枚奪える。基本ゲームでは未使用。
  piratePosition?: TileId;
  // このターンに騎士・進歩カードを使ったか（1ターン1枚制限）
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

export type Action =
  | { type: 'ROLL_DICE' }
  | { type: 'MOVE_ROBBER';         tileId: TileId; stealFromPlayerId: PlayerId | null }
  | { type: 'MOVE_PIRATE';         tileId: TileId; stealFromPlayerId: PlayerId | null }
  | { type: 'DISCARD_RESOURCES';   playerId: PlayerId; resources: Partial<ResourceHand> }
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
  | { type: 'BANK_TRADE';          give: ResourceType; receive: ResourceType }
  | { type: 'OFFER_TRADE';         offer: TradeOffer; targetPlayerIds: PlayerId[] }
  | { type: 'RESPOND_TRADE';       response: PlayerResponse }
  | { type: 'CONFIRM_TRADE';       responderId: PlayerId }
  | { type: 'CANCEL_TRADE' }
  | { type: 'FINISH_ROAD_BUILDING' }
  | { type: 'END_TURN' }
  | { type: 'DECLARE_VICTORY' };
