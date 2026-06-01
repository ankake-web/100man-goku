# カタン 技術仕様書 (L-00 / L-01)

**バージョン**: 1.0  
**作成者**: Logi  
**対象**: Fenn（UI実装）・Rex（レビュー）

---

## L-00: 技術スタック選定

### 選定結果サマリー

| レイヤー | 採用技術 | 不採用候補 | 理由 |
|---------|---------|-----------|------|
| 言語 | **TypeScript** | JavaScript | 複雑なGameState型でのバグを型で防ぐ |
| レンダリング | **SVG** | Canvas / Phaser | クリック判定が要素単位で自然、CSSアニメーション連携が容易 |
| ビルド | **Vite** | webpack / Parcel | 設定ゼロ起動、HMRが高速 |
| 状態管理 | **純粋関数 + 単一GameState** | React/Redux / Vue | UIフレームワーク不要。ゲームロジックとレンダリングを明確に分離 |
| テスト | **Vitest** | Jest | Viteと同一設定で動作、ESMネイティブ |
| スタイル | **CSS（単一ファイル）** | Tailwind / CSS Modules | ゲームUIは要素数が限定的で規模的に不要 |
| サーバー | **なし（クライアントオンリー）** | Node.js / WebSocket | ローカル多人数（ホットシート）+ AI対戦のみ対応 |

### ディレクトリ構成

```
catan/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts              # エントリポイント
│   ├── types.ts             # 全型定義（L-01）
│   ├── constants.ts         # 定数（タイル枚数・建設コスト等）
│   ├── engine/
│   │   ├── board.ts         # ボード生成・座標計算
│   │   ├── game.ts          # GameState更新関数群
│   │   ├── actions.ts       # プレイヤーアクション（建設・交易等）
│   │   ├── dice.ts          # ダイス・資源配布
│   │   ├── robber.ts        # 強盗ロジック
│   │   ├── devCards.ts      # 発展カード効果
│   │   ├── scoring.ts       # VP計算・最長道路・最大騎士団
│   │   └── ai.ts            # AIプレイヤー
│   ├── renderer/
│   │   ├── board.ts         # ボードSVGレンダリング
│   │   ├── ui.ts            # パネル・モーダル更新
│   │   └── events.ts        # SVGクリックイベント → アクション変換
│   └── assets/
│       └── sounds/
├── docs/
│   ├── rules.md
│   ├── trade_spec.md
│   └── tech_spec.md
└── tests/
    ├── board.test.ts
    ├── scoring.test.ts
    └── actions.test.ts
```

### 設計原則

1. **GameStateはイミュータブル**: 全アクション関数は `(state: GameState, action) => GameState` の純粋関数。副作用なし。
2. **エンジンとレンダラーは完全分離**: `src/engine/` はDOMを一切参照しない。テスト可能。
3. **単一の真実の源**: GameStateオブジェクト1個がゲームの全状態を保持。UIはGameStateから毎回完全再描画。

---

## L-01: データ構造設計

### 1. 座標系

**Axial座標系（q, r）** を採用する。

```
     q=-2  q=-1  q=0  q=1  q=2
r=-2  [  ]  [  ]  [  ]
r=-1  [  ]  [  ]  [  ]  [  ]
r= 0  [  ]  [  ]  [  ]  [  ]  [  ]
r= 1        [  ]  [  ]  [  ]  [  ]
r= 2              [  ]  [  ]  [  ]
```

**有効なタイル座標の条件**: `Math.abs(q) <= 2 && Math.abs(r) <= 2 && Math.abs(q + r) <= 2`  
（これにより3-4-5-4-3配置の19タイルが正確に列挙される）

**隣接タイルの方向ベクトル**（axial座標における6方向）:

```typescript
const HEX_DIRECTIONS: AxialCoord[] = [
  { q:  1, r:  0 }, // E
  { q:  1, r: -1 }, // NE
  { q:  0, r: -1 }, // NW
  { q: -1, r:  0 }, // W
  { q: -1, r:  1 }, // SW
  { q:  0, r:  1 }, // SE
];
```

**Axial座標 → SVGピクセル変換**（フラットトップ六角形、hexSize = 60px の場合）:

```typescript
function axialToPixel(q: number, r: number, hexSize: number): Point {
  return {
    x: hexSize * (3/2 * q),
    y: hexSize * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r),
  };
}
```

---

### 2. 基本型定義

```typescript
// src/types.ts

// --- 座標 ---
type AxialCoord = { q: number; r: number };
type Point = { x: number; y: number };

// --- リソース ---
type ResourceType = 'wood' | 'brick' | 'wool' | 'grain' | 'ore';
type ResourceHand = Record<ResourceType, number>;

// --- タイル ---
type TileType = 'forest' | 'field' | 'pasture' | 'hill' | 'mountain' | 'desert';
type TileId = string;  // 例: "q0r-1"

interface Tile {
  id: TileId;
  coord: AxialCoord;
  type: TileType;
  number: number | null;  // 砂漠はnull
  hasRobber: boolean;
}

// --- 頂点（Vertex） ---
// VertexId はボード生成時にピクセル座標で重複排除し連番で付与（"v0"〜"v53"）
// 「隣接タイルIDのソート連結」は外周頂点で一意性が崩れるため使用しない（T-02修正）
type VertexId = string;

interface Vertex {
  id: VertexId;
  pixel: Point;                  // SVGレンダリング用座標（ボード生成時に確定、不変）
  adjacentTileIds: TileId[];     // 1〜3タイルが隣接
  adjacentEdgeIds: EdgeId[];     // 2〜3辺が隣接
  adjacentVertexIds: VertexId[]; // 距離ルールチェック・最長道路計算用
  building: Building | null;
  harborType: HarborType | null;
}

// --- 辺（Edge） ---
// EdgeId は両端の VertexId をソートして "|" で連結（例: "v3|v7"）
type EdgeId = string;

interface Edge {
  id: EdgeId;
  midpoint: Point;               // SVGレンダリング用中点座標（道コマの配置位置）
  vertexIds: [VertexId, VertexId];
  adjacentEdgeIds: EdgeId[];     // 最長道路計算用
  road: Road | null;
}

// --- 建物 ---
type BuildingType = 'settlement' | 'city';

interface Building {
  type: BuildingType;
  playerId: PlayerId;
}

interface Road {
  playerId: PlayerId;
}

// --- 港 ---
type HarborType = 'generic' | ResourceType;  // 'generic' = 3:1、ResourceType = 2:1

interface Harbor {
  id: string;
  type: HarborType;
  vertexIds: [VertexId, VertexId]; // 港に接続する2頂点
}
```

---

### 3. プレイヤー型

```typescript
type PlayerId = 'player1' | 'player2' | 'player3' | 'player4';
type PlayerColor = 'red' | 'blue' | 'white' | 'orange';
type PlayerType = 'human' | 'ai';

type DevCardType = 'knight' | 'road_building' | 'year_of_plenty' | 'monopoly' | 'victory_point';

interface DevCard {
  id: string;               // uuid
  type: DevCardType;
  purchasedOnTurn: number;  // 購入したゲーム全体ターン番号（使用可否判定に使用）
}

interface Player {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  type: PlayerType;

  // 資源手札
  hand: ResourceHand;

  // 発展カード手札
  // - アクションカード（knight等）: 使用後に配列から除去する
  // - 勝利点カード: 勝利宣言まで除去しない（ずっとここに残る）
  devCards: DevCard[];

  // 建設コマ残数
  remainingRoads: number;        // 初期15
  remainingSettlements: number;  // 初期5
  remainingCities: number;       // 初期4

  // 実績
  knightsPlayed: number;   // 使用済み騎士カード枚数（最大騎士団判定用）
  longestRoadLength: number; // 現在の最長道路長

  // ボーナス保持状況
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
}
```

---

### 4. ゲームフェーズ・ターン型

```typescript
// ゲーム全体フェーズ
type GamePhase =
  | 'SETUP_FORWARD'   // 初期配置 前半（プレイヤー順）
  | 'SETUP_BACKWARD'  // 初期配置 後半（逆順）
  | 'MAIN'            // 本番ゲーム
  | 'GAME_OVER';      // 終了

// 本番ゲーム内のターンフェーズ
type TurnPhase =
  | 'PRE_ROLL'        // ダイスロール前（発展カード使用可）
  | 'ROBBER'          // 強盗処理中（7が出た / 騎士使用後）
  | 'DISCARD'         // 手札捨て中（8枚以上のプレイヤーが捨てる）
  | 'TRADE_BUILD'     // 交易・建設フェーズ
  | 'END';            // ターン終了処理

// 初期配置フェーズ内のサブフェーズ
type SetupSubPhase =
  | 'PLACE_SETTLEMENT'
  | 'PLACE_ROAD';
```

---

### 5. GameState（単一の真実の源）

```typescript
interface GameState {
  // ボード（Map ではなく Record を使用: JSON.stringify でそのままシリアライズ可能）
  tiles: Record<TileId, Tile>;
  vertices: Record<VertexId, Vertex>;
  edges: Record<EdgeId, Edge>;
  harbors: Harbor[];
  tileToVertices: Record<TileId, VertexId[]>; // ボード生成時に構築するインデックス
  tileToEdges:    Record<TileId, EdgeId[]>;   // ボード生成時に構築するインデックス

  // プレイヤー
  players: Record<PlayerId, Player>;
  playerOrder: PlayerId[];          // ターン順（インデックス0がスタート）

  // バンク
  bank: ResourceHand;               // 各資源の残枚数

  // 発展カードデッキ
  devDeck: DevCard[];               // 残りデッキ（先頭から引く）
  devDiscardPile: DevCard[];        // 使用済みデッキ

  // ターン管理
  phase: GamePhase;
  turnPhase: TurnPhase;
  currentPlayerIndex: number;       // playerOrder のインデックス
  // 手番（個人の1ターン）単位でインクリメント。
  // 4人ゲームで全員が1回ずつ打つと +4。ラウンド単位ではない。
  // DevCard.purchasedOnTurn との比較で「購入ターンに使用不可」を判定する。
  globalTurnNumber: number;

  // 初期配置専用（MAIN / GAME_OVER フェーズ中は null）
  setupSubPhase: SetupSubPhase | null;

  // ダイス
  lastDiceRoll: [number, number] | null;

  // ボーナス
  longestRoadHolder: PlayerId | null;  // null = まだ誰も5本以上ない
  largestArmyHolder: PlayerId | null;  // null = まだ誰も3枚以上ない

  // 交易
  pendingTrade: PendingTrade | null;

  // ゲーム終了
  winner: PlayerId | null;

  // ログ（UI表示用）
  log: LogEntry[];
}
```

---

### 6. 交易関連型

```typescript
type TradeState =
  | 'TRADE_OFFER'
  | 'TRADE_RESPONSE'
  | 'TRADE_CONFIRM'
  | 'TRADE_EXECUTE'
  | 'TRADE_CANCELLED';

interface TradeOffer {
  give: Partial<ResourceHand>;    // 渡す資源（0の資源は省略可）
  receive: Partial<ResourceHand>; // 受け取る資源
}

interface PlayerResponse {
  playerId: PlayerId;
  status: 'ACCEPT' | 'REJECT' | 'COUNTER';
  counterOffer?: TradeOffer;
  timedOutAt?: number; // Unixタイムスタンプ（タイムアウト時）
}

interface PendingTrade {
  state: TradeState;
  initiatorId: PlayerId;
  offer: TradeOffer;
  targetPlayerIds: PlayerId[];
  responses: Record<PlayerId, PlayerResponse>; // Map → Record（シリアライズ対応）
  selectedResponderId: PlayerId | null;        // TRADE_CONFIRM後に確定
}
```

---

### 7. アクション型（エンジン入力）

全プレイヤー操作はActionオブジェクトとして表現し、
`applyAction(state: GameState, action: Action): GameState` で処理する。

```typescript
type Action =
  | { type: 'ROLL_DICE' }
  | { type: 'MOVE_ROBBER';      tileId: TileId; stealFromPlayerId: PlayerId | null }
  | { type: 'DISCARD_RESOURCES'; playerId: PlayerId; resources: Partial<ResourceHand> }
  | { type: 'BUILD_ROAD';       edgeId: EdgeId }
  | { type: 'BUILD_SETTLEMENT'; vertexId: VertexId }
  | { type: 'BUILD_CITY';       vertexId: VertexId }
  | { type: 'BUY_DEV_CARD' }
  | { type: 'PLAY_KNIGHT' }
  | { type: 'PLAY_ROAD_BUILDING' }
  | { type: 'PLAY_YEAR_OF_PLENTY'; resources: [ResourceType, ResourceType] }
  | { type: 'PLAY_MONOPOLY';    resource: ResourceType }
  | { type: 'BANK_TRADE';       give: ResourceType; receive: ResourceType }
  | { type: 'OFFER_TRADE';      offer: TradeOffer; targetPlayerIds: PlayerId[] }
  | { type: 'RESPOND_TRADE';    response: PlayerResponse }
  | { type: 'CONFIRM_TRADE';    responderId: PlayerId }
  | { type: 'CANCEL_TRADE' }
  | { type: 'END_TURN' }
  | { type: 'DECLARE_VICTORY' };
```

---

### 8. ログ型

```typescript
type LogEntryType =
  | 'DICE_ROLL' | 'RESOURCE_GAIN' | 'BUILD' | 'TRADE_BANK'
  | 'TRADE_PLAYER' | 'DEV_CARD' | 'ROBBER' | 'BONUS_CHANGE' | 'VICTORY';

interface LogEntry {
  turn: number;
  playerId: PlayerId;
  type: LogEntryType;
  message: string;   // 表示用テキスト（日本語）
}
```

---

### 9. 定数（constants.ts）

```typescript
// src/constants.ts

export const RESOURCE_TYPES: ResourceType[] = ['wood', 'brick', 'wool', 'grain', 'ore'];

export const TILE_RESOURCE_MAP: Record<TileType, ResourceType | null> = {
  forest:   'wood',
  field:    'grain',
  pasture:  'wool',
  hill:     'brick',
  mountain: 'ore',
  desert:   null,
};

export const TILE_COUNTS: Record<TileType, number> = {
  forest: 4, field: 4, pasture: 4, hill: 3, mountain: 3, desert: 1,
};

// Partial<ResourceHand>ではなく全キー必須のResourceHandを使用する。
// 省略キーが undefined になると hand[r] -= cost[r] で NaN が発生する（T-07修正）。
export function makeHand(partial: Partial<ResourceHand> = {}): ResourceHand {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...partial };
}

export const BUILD_COSTS: Record<'road' | 'settlement' | 'city' | 'dev_card', ResourceHand> = {
  road:       makeHand({ wood: 1, brick: 1 }),
  settlement: makeHand({ wood: 1, brick: 1, wool: 1, grain: 1 }),
  city:       makeHand({ grain: 2, ore: 3 }),
  dev_card:   makeHand({ wool: 1, grain: 1, ore: 1 }),
};

export const PIECE_LIMITS = {
  roads: 15,
  settlements: 5,
  cities: 4,
} as const;

export const BANK_INITIAL: ResourceHand = {
  wood: 19, brick: 19, wool: 19, grain: 19, ore: 19,
};

export const DEV_CARD_COUNTS: Record<DevCardType, number> = {
  knight:         14,
  road_building:   2,
  year_of_plenty:  2,
  monopoly:        2,
  victory_point:   5,
};

export const VP_TABLE = {
  settlement:   1,
  city:         2,
  longestRoad:  2,
  largestArmy:  2,
  victoryPoint: 1,
  target:       10,
} as const;

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;
export const DICE_ROBBER_NUMBER      = 7;  // ダイス目7で強盗フェーズ発動
export const ROBBER_HAND_DISCARD_MIN = 8;  // 手札8枚以上で半数捨てが必要（7ではない）

export const TRADE_TIMEOUT_HUMAN_MS = 60_000;
export const TRADE_TIMEOUT_AI_MS    =  3_000;

export const HEX_SIZE = 60; // SVGピクセル単位
```

---

### 10. ボードグラフ構築アルゴリズム（T-06 / Logi向け）

`engine/board.ts` の `buildBoardGeometry()` が実装すべき手順を示す。

**Step 1: 全タイル座標列挙**
```
for q in [-2..2], r in [-2..2]:
  if abs(q+r) <= 2: valid tile
```
→ 19タイルが得られる。

**Step 2: 各タイルの6頂点をピクセル座標で列挙（フラットトップ六角形）**
```
center = axialToPixel(q, r, size)
corners[i] = center + size * (cos(60°*i), sin(60°*i))   for i in 0..5
```
→ 角度 0°, 60°, 120°, 180°, 240°, 300° の順に時計回り。

**Step 3: ピクセル座標キーで頂点を重複排除**
```
key = "${round(x*100)},${round(y*100)}"
if key not in pixelMap:
  create Vertex with id="v{counter++}"
  pixelMap[key] = vertex.id
vertex.adjacentTileIds.push(currentTileId)
```
→ 共有頂点は同一Vertexオブジェクトに集約される。19タイル×6角=114エントリが54頂点に収束する。

**Step 4: 隣接する角のペアから辺（Edge）を構築**
```
for i in 0..5:
  va, vb = cornerVertexIds[i], cornerVertexIds[(i+1)%6]
  edgeId = sort([va, vb]).join("|")
  if edgeId not in edges: create Edge
```
→ 72辺が生成される。

**Step 5: 頂点↔頂点・頂点↔辺の隣接を構築**
```
for each edge(va, vb):
  va.adjacentVertexIds.push(vb); vb.adjacentVertexIds.push(va)
  va.adjacentEdgeIds.push(edge);  vb.adjacentEdgeIds.push(edge)
```

**Step 6: 辺↔辺の隣接を構築（最長道路計算用）**
```
for each vertex:
  for each pair of edges sharing this vertex:
    edgeA.adjacentEdgeIds.push(edgeB)
    edgeB.adjacentEdgeIds.push(edgeA)
```

**期待する出力数**: タイル19, 頂点54, 辺72  
（これ以外の値が出た場合はピクセル丸め精度のバグを疑うこと）

---

### 11. 実装優先順位（Logi 作業順）

| Step | 実装内容 | 依存 |
|------|---------|------|
| 1 | `types.ts` 全型定義 | なし |
| 2 | `constants.ts` 全定数 | types |
| 3 | `engine/board.ts` ボード生成・座標計算 | types, constants |
| 4 | `engine/dice.ts` ダイス・資源配布 | types, board |
| 5 | `engine/actions.ts` BUILD系アクション | types, board |
| 6 | `engine/robber.ts` 強盗ロジック | types, actions |
| 7 | `engine/scoring.ts` VP・最長道路・最大騎士団 | types, board |
| 8 | `engine/devCards.ts` 発展カード効果 | types, actions, scoring |
| 9 | `engine/game.ts` `applyAction()` 統合 | 全engine |
| 10 | `engine/ai.ts` AIプレイヤー | game |
