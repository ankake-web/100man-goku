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

export type TileType = 'forest' | 'field' | 'pasture' | 'hill' | 'mountain' | 'desert';
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

// ---- 港 ----

export type HarborType = 'generic' | ResourceType; // generic = 3:1、ResourceType = 2:1

export interface Harbor {
  readonly id: string;
  readonly type: HarborType;
  readonly vertexIds: readonly [VertexId, VertexId];
}

// ---- プレイヤー ----

export type PlayerId = 'player1' | 'player2' | 'player3' | 'player4';
export type PlayerColor = 'red' | 'blue' | 'white' | 'orange';
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

  knightsPlayed: number;        // 使用済み騎士カード枚数
  longestRoadLength: number;    // 現在の最長道路長

  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
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
  // このターンに騎士・進歩カードを使ったか（1ターン1枚制限）
  devCardPlayedThisTurn: boolean;

  longestRoadHolder: PlayerId | null;
  largestArmyHolder: PlayerId | null;

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
  | { type: 'DISCARD_RESOURCES';   playerId: PlayerId; resources: Partial<ResourceHand> }
  | { type: 'BUILD_ROAD';          edgeId: EdgeId }
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
