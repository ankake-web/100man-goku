// ============================================================
// src/renderer/board.ts — F-01 + F-02: ボードSVGレンダリング
// ============================================================

import type { GameState, Tile, HarborType, Harbor } from '../types';
import { HEX_SIZE } from '../constants';
import { axialToPixel } from '../engine/board';
import robberImg from '../assets/robber.png'; // 盗賊コマの画像（Vite が base 付きURLへ解決）
import pirateImg from '../assets/pirate.png'; // 海賊船コマの画像
import houseRed from '../assets/house_red.png';
import houseBlue from '../assets/house_blue.png';
import housePurple from '../assets/house_purple.png';
import houseOrange from '../assets/house_orange.png';
import cityRed from '../assets/city_red.png';
import cityBlue from '../assets/city_blue.png';
import cityPurple from '../assets/city_purple.png';
import cityOrange from '../assets/city_orange.png';
import shipRed from '../assets/ship_red.png';
import shipBlue from '../assets/ship_blue.png';
import shipPurple from '../assets/ship_purple.png';
import shipOrange from '../assets/ship_orange.png';

// プレイヤーID→色キー。建物画像（屋根/上部をプレイヤー色に着色済み）の選択に使う。
const BUILDING_COLOR_KEY: Record<string, string> = {
  player1: 'red', player2: 'blue', player3: 'purple', player4: 'orange',
};
// プレイヤーID→HEX色（騎士コマ等）。
const PLAYER_HEX_COLOR: Record<string, string> = {
  player1: '#e03030', player2: '#3060e0', player3: '#a855f7', player4: '#f0a020',
};
const HOUSE_IMG: Record<string, string> = {
  red: houseRed, blue: houseBlue, purple: housePurple, orange: houseOrange,
};
const CITY_IMG: Record<string, string> = {
  red: cityRed, blue: cityBlue, purple: cityPurple, orange: cityOrange,
};
const SHIP_IMG: Record<string, string> = {
  red: shipRed, blue: shipBlue, purple: shipPurple, orange: shipOrange,
};

// ============================================================
// レンダリングオプション（有効配置ハイライト用）
// ============================================================

export interface BoardRenderOptions {
  validVertexIds?: Set<string>;
  validEdgeIds?: Set<string>;
  validTileIds?: Set<string>;
  // 航海者: 船の配置候補（海に面した辺）。
  validShipEdgeIds?: Set<string>;
  // 仮置きプレビュー（確定待ち）のターゲット。ゴースト表示する。
  previewVertexId?: string;
  previewEdgeId?: string;
  // 船の仮置きプレビュー（確定待ち）。
  previewShipEdgeId?: string;
  // 航海者: 海賊コマのいる海タイルID（🏴‍☠️ マーカーを描く）。
  piratePosition?: string;
  // ピンチズーム/パンの永続ビューポート（viewBox座標系）。再描画後も維持される。
  viewport?: BoardViewport;
}

export interface BoardViewport {
  scale: number;
  tx: number;
  ty: number;
}

// 強盗コマをタイル中心から下へずらす量。大きめに下げて、数字チップの数字が
// コマの上に覗くようにする（数字の視認性確保）。
const ROBBER_DY = 31;

// タッチ端末（スマホ等）か。港・数字チップを少し大きくして見やすくする。
function isTouchDevice(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

// ============================================================
// SVGユーティリティ
// ============================================================

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function setAttrs(el: SVGElement, attrs: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
}

/** タイルの6頂点ピクセル座標を返す（フラットトップ六角形） */
function hexCorners(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    const x = cx + size * Math.cos(a);
    const y = cy + size * Math.sin(a);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

// ============================================================
// 数字トークンの点（確率ドット）
// ============================================================

const DOTS: Record<number, string> = {
  2: '•', 3: '••', 4: '•••', 5: '••••', 6: '•••••',
  8: '•••••', 9: '••••', 10: '•••', 11: '••', 12: '•',
};

// ============================================================
// 港ラベル
// ============================================================

const HARBOR_LABEL: Record<HarborType, string> = {
  generic: '⚓3:1',
  wood:    '🌲2:1',
  brick:   '🧱2:1',
  wool:    '🐑2:1',
  grain:   '🌾2:1',
  ore:     '⛰2:1',
};

const HARBOR_COLOR: Record<HarborType, string> = {
  generic: '#ffe080',
  wood:    '#6dbf4a',
  brick:   '#e07040',
  wool:    '#b0e070',
  grain:   '#f0c840',
  ore:     '#c0c0c0',
};

// ============================================================
// ボード中心オフセット計算
// ============================================================

// タイル群の中心座標の境界（ピクセル）。中央寄せと自動フィット縮小の両方に使う。
function boardBounds(state: GameState): { minX: number; maxX: number; minY: number; maxY: number } {
  const coords = Object.values(state.tiles).map(t => axialToPixel(t.coord));
  return {
    minX: Math.min(...coords.map(p => p.x)), maxX: Math.max(...coords.map(p => p.x)),
    minY: Math.min(...coords.map(p => p.y)), maxY: Math.max(...coords.map(p => p.y)),
  };
}

// タイル群の中心を、指定した中心座標(centerX, centerY)へ合わせるオフセットを返す。
function boardOffset(state: GameState, centerX: number, centerY: number): { ox: number; oy: number } {
  const b = boardBounds(state);
  return {
    ox: centerX - (b.minX + b.maxX) / 2,
    oy: centerY - (b.minY + b.maxY) / 2,
  };
}

// 盤面コンテンツの実寸（ヘックスの張り出しを含む）。viewBox に収める縮小率の計算に使う。
// 大きい航海者マップで盤面が viewBox(800×700) を超えても自動で縮小して全タイルを表示する。
function boardContentScale(state: GameState, vbW: number, vbH: number, size: number): number {
  const b = boardBounds(state);
  const w = (b.maxX - b.minX) + size * 2;      // フラットトップ六角の横張り出し ±size
  const h = (b.maxY - b.minY) + size * 1.74;   // 縦張り出し ±sqrt3/2·size
  // 余白(0.94)を残して収まる倍率。基本盤は >1 になるので（縮小せず）1 を上限にする。
  return Math.min((vbW * 0.94) / w, (vbH * 0.94) / h);
}

// ============================================================
// タイル描画
// ============================================================

function renderTile(
  tile: Tile,
  ox: number,
  oy: number,
  size: number,
  opts?: BoardRenderOptions,
): SVGGElement {
  const g = svgEl('g');
  // data属性でクリック判定用
  g.setAttribute('data-tile-id', tile.id);

  const p = axialToPixel(tile.coord, size);
  const cx = p.x + ox;
  const cy = p.y + oy;

  const isValidRobber = opts?.validTileIds?.has(tile.id) ?? false;

  // 六角形
  const poly = svgEl('polygon');
  poly.setAttribute('points', hexCorners(cx, cy, size - 1));
  poly.classList.add('hex-tile', tile.type);
  if (isValidRobber) poly.classList.add('valid-robber');
  g.appendChild(poly);

  // 金タイル: 麦(field)と色が紛らわしいので、光沢ゴールド＋発光（CSS）に加えて
  // 下部に「任意資源」ラベルで明示する。絵文字マーカーは環境差で崩れるため使わない。
  if (tile.type === 'gold') {
    const tag = svgEl('text');
    tag.classList.add('gold-tag');
    setAttrs(tag, { x: cx, y: cy + size * 0.6, 'text-anchor': 'middle', 'font-size': String(size * 0.24) });
    tag.textContent = '任意資源';
    g.appendChild(tag);
  }

  // 数字トークン（砂漠以外）。タッチ端末では少し大きく見やすくする。
  if (tile.number != null) {
    const isRed = tile.number === 6 || tile.number === 8;
    const touch = isTouchDevice();
    const RADIUS = touch ? 21 : 18;
    const dotsY = touch ? 16 : 14;

    const circle = svgEl('circle');
    circle.classList.add('token-circle');
    setAttrs(circle, { cx, cy: cy - 2, r: RADIUS });
    g.appendChild(circle);

    const num = svgEl('text');
    num.classList.add('token-number');
    if (isRed) num.classList.add('red');
    setAttrs(num, { x: cx, y: cy - 2 });
    num.textContent = String(tile.number);
    g.appendChild(num);

    const dots = svgEl('text');
    dots.classList.add('token-dots');
    if (isRed) dots.classList.add('red');
    setAttrs(dots, { x: cx, y: cy + dotsY });
    dots.textContent = DOTS[tile.number] ?? '';
    g.appendChild(dots);
  }

  // 強盗コマ: フィギュア画像（asset）。数字チップと丸かぶりしないよう下にずらす。
  if (tile.hasRobber) {
    const touch = isTouchDevice();
    const ry = cy + ROBBER_DY;
    const w = size * (touch ? 0.92 : 0.8);          // 小さめ表示（数字チップと被っても数字が上に見えるよう）
    const rg = svgEl('g');
    rg.classList.add('robber');

    // 接地影（フィギュアの足元）。stroke:none を明示（.robber の白フチを継承させない）
    const shadow = svgEl('ellipse');
    setAttrs(shadow, { cx, cy: ry + w * 0.27, rx: w * 0.20, ry: w * 0.055, fill: 'rgba(0,0,0,0.32)', stroke: 'none' });
    rg.appendChild(shadow);

    // 盗賊フィギュア画像（正方形・中央寄せ）。足元が ry より少し下に来るよう配置。
    const img = svgEl('image');
    setAttrs(img, { x: cx - w / 2, y: ry - w * 0.62, width: w, height: w, preserveAspectRatio: 'xMidYMid meet' });
    img.setAttribute('href', robberImg);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', robberImg); // 旧ブラウザ互換
    rg.appendChild(img);

    g.appendChild(rg);
  }

  // 海賊コマ（航海者）: 海タイルに海賊船フィギュア画像。盗賊と排他（海タイルに盗賊は乗らない）。
  // 海タイルは数字がないので強盗ほど下げず、中央寄りに置く。
  if (opts?.piratePosition === tile.id) {
    const touch = isTouchDevice();
    const ry = cy + 18;
    const w = size * (touch ? 1.2 : 1.05);
    const pg = svgEl('g');
    pg.classList.add('pirate');
    const shadow = svgEl('ellipse');
    setAttrs(shadow, { cx, cy: ry + w * 0.27, rx: w * 0.20, ry: w * 0.055, fill: 'rgba(0,0,0,0.32)', stroke: 'none' });
    pg.appendChild(shadow);
    const img = svgEl('image');
    setAttrs(img, { x: cx - w / 2, y: ry - w * 0.62, width: w, height: w, preserveAspectRatio: 'xMidYMid meet' });
    img.setAttribute('href', pirateImg);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', pirateImg);
    pg.appendChild(img);
    g.appendChild(pg);
  }

  return g;
}

// ============================================================
// 港描画
// ============================================================

function renderHarbor(
  harbor: Harbor,
  state: GameState,
  ox: number,
  oy: number,
): SVGGElement {
  const g = svgEl('g');
  const [va, vb] = harbor.vertexIds;
  const vA = state.vertices[va];
  const vB = state.vertices[vb];
  if (!vA || !vB) return g;

  const ax = vA.pixel.x + ox;
  const ay = vA.pixel.y + oy;
  const bx = vB.pixel.x + ox;
  const by = vB.pixel.y + oy;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;

  const touch = isTouchDevice();

  // 港辺ライン（太く、色付き）
  const line = svgEl('line');
  line.classList.add('harbor-line');
  setAttrs(line, { x1: ax, y1: ay, x2: bx, y2: by,
    stroke: HARBOR_COLOR[harbor.type], 'stroke-width': touch ? 6 : 5 });
  g.appendChild(line);

  // 頂点マーカー（港がどの交点に対応しているかを表示）
  for (const [cx, cy] of [[ax, ay], [bx, by]] as [number, number][]) {
    const dot = svgEl('circle');
    dot.classList.add('harbor-dot');
    setAttrs(dot, { cx, cy, r: touch ? 6 : 5, fill: HARBOR_COLOR[harbor.type], opacity: 0.8 });
    g.appendChild(dot);
  }

  // 背景バッジ（タッチ端末では大きめに：中心(mx,my)基準なので拡大しても中央のまま）
  const badgeW = touch ? 52 : 44;
  const badgeH = touch ? 22 : 18;
  const bg = svgEl('rect');
  setAttrs(bg, { x: mx - badgeW / 2, y: my - badgeH / 2, width: badgeW, height: badgeH,
    rx: 4, fill: 'rgba(0,0,0,0.82)', stroke: HARBOR_COLOR[harbor.type], 'stroke-width': 1.5 });
  g.appendChild(bg);

  // ラベルテキスト（大きめ）
  const label = svgEl('text');
  label.classList.add('harbor-label');
  setAttrs(label, { x: mx, y: my,
    fill: HARBOR_COLOR[harbor.type],
    'text-anchor': 'middle', 'dominant-baseline': 'central' });
  label.textContent = HARBOR_LABEL[harbor.type];
  g.appendChild(label);

  return g;
}

// ============================================================
// 辺描画
// ============================================================

function renderEdges(
  state: GameState,
  ox: number,
  oy: number,
  opts?: BoardRenderOptions,
): SVGGElement {
  const g = svgEl('g');
  // 道のプレビュー中は、選択した道だけが目立つよう他候補を暗くする目印クラス。
  if (opts?.previewEdgeId || opts?.previewShipEdgeId) g.classList.add('edges-previewing');
  const roadColor: Record<string, string> = {
    player1: '#e03030', player2: '#3060e0',
    player3: '#a855f7', player4: '#f0a020',
  };

  for (const edge of Object.values(state.edges)) {
    const [va, vb] = edge.vertexIds;
    const vA = state.vertices[va];
    const vB = state.vertices[vb];
    if (!vA || !vB) continue;

    const x1 = vA.pixel.x + ox, y1 = vA.pixel.y + oy;
    const x2 = vB.pixel.x + ox, y2 = vB.pixel.y + oy;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

    // 船コマ: プレイヤー色に着色した帆船フィギュア画像を辺の中点に描く。
    const drawBoat = (colorKey: string): void => {
      const w = HEX_SIZE * 0.66;
      const img = svgEl('image');
      setAttrs(img, { x: mx - w / 2, y: my - w * 0.6, width: w, height: w, preserveAspectRatio: 'xMidYMid meet' });
      const href = SHIP_IMG[colorKey] ?? shipRed;
      img.setAttribute('href', href);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
      img.classList.add('ship-glyph');
      g.appendChild(img);
    };

    if (edge.road) {
      const line = svgEl('line');
      line.classList.add('road-line-built');
      // 設置アニメ(C-4)で対象を引けるよう id を付ける（敷設済みは配置対象にならないので無害）。
      line.setAttribute('data-road-edge-id', edge.id);
      setAttrs(line, {
        x1, y1, x2, y2,
        stroke: roadColor[edge.road.playerId] ?? '#aaa',
        'stroke-width': 7,
        'stroke-linecap': 'round',
      });
      g.appendChild(line);
    } else if (edge.ship) {
      // 船: 破線＋ボート。道と視覚的に区別する。
      const line = svgEl('line');
      line.classList.add('ship-line-built');
      line.setAttribute('data-ship-built-id', edge.id);
      setAttrs(line, {
        x1, y1, x2, y2,
        stroke: roadColor[edge.ship.playerId] ?? '#aaa',
        'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': '9 6',
      });
      g.appendChild(line);
      drawBoat(BUILDING_COLOR_KEY[edge.ship.playerId] ?? 'red');
    } else {
      const isValid = opts?.validEdgeIds?.has(edge.id) ?? false;
      const isValidShip = opts?.validShipEdgeIds?.has(edge.id) ?? false;
      const line = svgEl('line');
      line.classList.add('edge-line');
      if (isValid) line.classList.add('valid');
      if (isValidShip) line.classList.add('ship-valid');
      line.setAttribute('data-edge-id', edge.id);
      setAttrs(line, { x1, y1, x2, y2 });
      g.appendChild(line);
      // 道の仮置きプレビュー（白ケーシング＋手番色の芯）。
      if (opts?.previewEdgeId === edge.id) {
        const curPid = state.playerOrder[state.currentPlayerIndex];
        const casing = svgEl('line');
        casing.classList.add('edge-preview-casing');
        setAttrs(casing, { x1, y1, x2, y2 });
        g.appendChild(casing);
        const ghost = svgEl('line');
        ghost.classList.add('edge-preview');
        ghost.setAttribute('stroke', (curPid && roadColor[curPid]) || '#ffffff');
        setAttrs(ghost, { x1, y1, x2, y2 });
        g.appendChild(ghost);
      }
      // 船の仮置きプレビュー（破線ゴースト＋ボート）。
      if (opts?.previewShipEdgeId === edge.id) {
        const curPid = state.playerOrder[state.currentPlayerIndex];
        const casing = svgEl('line');
        casing.classList.add('edge-preview-casing');
        setAttrs(casing, { x1, y1, x2, y2 });
        g.appendChild(casing);
        const ghost = svgEl('line');
        ghost.classList.add('ship-preview');
        ghost.setAttribute('stroke', (curPid && roadColor[curPid]) || '#ffffff');
        setAttrs(ghost, { x1, y1, x2, y2 });
        g.appendChild(ghost);
        drawBoat(curPid ? (BUILDING_COLOR_KEY[curPid] ?? 'red') : 'red');
      }
      // タッチ用の透明な太い当たり判定（候補のみ）。CSSでタッチ端末のみ有効化。
      if (isValid) {
        const hit = svgEl('line');
        hit.classList.add('edge-hit');
        hit.setAttribute('data-edge-id', edge.id);
        setAttrs(hit, { x1, y1, x2, y2 });
        g.appendChild(hit);
      }
      if (isValidShip) {
        const hit = svgEl('line');
        hit.classList.add('edge-hit');
        hit.setAttribute('data-ship-edge-id', edge.id);
        setAttrs(hit, { x1, y1, x2, y2 });
        g.appendChild(hit);
      }
    }
  }
  return g;
}

// ============================================================
// 頂点描画
// ============================================================

function renderVertices(
  state: GameState,
  ox: number,
  oy: number,
  opts?: BoardRenderOptions,
): SVGGElement {
  const g = svgEl('g');
  // 頂点プレビュー中は、選択した頂点だけが目立つよう他候補(緑ドット)を暗くする。
  if (opts?.previewVertexId) g.classList.add('vertices-previewing');
  // 建物は実機で目立つよう大きめに描く（従来比 約1.5倍）。タッチ端末はさらに少し大きく。
  const bs = isTouchDevice() ? 1.7 : 1.5;

  for (const vertex of Object.values(state.vertices)) {
    const vx = vertex.pixel.x + ox;
    const vy = vertex.pixel.y + oy;

    // 頂点ごとの g 要素（クリック委譲用）
    const vg = svgEl('g');
    vg.setAttribute('data-vertex-id', vertex.id);

    const isValid = opts?.validVertexIds?.has(vertex.id) ?? false;

    if (vertex.building) {
      // 開拓地＝家、都市＝城のフィギュア画像。屋根/上部がプレイヤー色に着色済み。
      const ckey = BUILDING_COLOR_KEY[vertex.building.playerId] ?? 'red';
      const isCity = vertex.building.type === 'city';
      const w = (isCity ? 32 : 24) * bs;          // 表示サイズ
      const by = vy + 5.2 * bs;                    // 足元の基準（旧コマの影位置に合わせる）
      // 接地影
      const shadow = svgEl('ellipse');
      setAttrs(shadow, { cx: vx, cy: by, rx: w * (isCity ? 0.30 : 0.26), ry: w * 0.06,
        fill: 'rgba(0,0,0,0.30)', stroke: 'none' });
      vg.appendChild(shadow);
      // フィギュア画像（足元 by が下に来るよう配置）
      const img = svgEl('image');
      const href = isCity ? CITY_IMG[ckey]! : HOUSE_IMG[ckey]!;
      setAttrs(img, { x: vx - w / 2, y: by - w * 0.9, width: w, height: w, preserveAspectRatio: 'xMidYMid meet' });
      img.setAttribute('href', href);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
      img.classList.add('building-img');
      if (isValid) img.classList.add('building-valid');   // 都市化など有効ターゲット
      vg.appendChild(img);
      // 騎士と商人: メトロポリス(勝利点4)は冠マークで強調。
      if (vertex.building.metropolis) {
        const crown = svgEl('text');
        crown.classList.add('metropolis-mark');
        setAttrs(crown, { x: vx, y: vy - w * 0.95, 'text-anchor': 'middle', 'font-size': 14 * bs });
        crown.textContent = '👑';
        vg.appendChild(crown);
      }
    } else if (vertex.knight) {
      // 騎士と商人: 騎士コマ（プレイヤー色の盾＋強さ数字。起動=明るい/非起動=暗い）。
      const k = vertex.knight;
      const col = PLAYER_HEX_COLOR[k.playerId] ?? '#aaa';
      const kg = svgEl('g'); kg.classList.add('knight-piece');
      const r = 8.5 * bs;
      const shield = svgEl('circle');
      setAttrs(shield, { cx: vx, cy: vy, r, fill: col, stroke: '#10100c',
        'stroke-width': 2 * bs, opacity: k.active ? 1 : 0.55 });
      kg.appendChild(shield);
      const num = svgEl('text');
      setAttrs(num, { x: vx, y: vy + 0.5 * bs, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 10 * bs, 'font-weight': 'bold', fill: '#fff', 'pointer-events': 'none' });
      num.textContent = String(k.strength);
      kg.appendChild(num);
      if (k.active) {
        const ring = svgEl('circle');
        setAttrs(ring, { cx: vx, cy: vy, r: r + 1.5 * bs, fill: 'none', stroke: '#ffe066', 'stroke-width': 1.5 * bs });
        kg.appendChild(ring);
      }
      if (isValid) { // 騎士移動モードの操作対象（移動元 or 押し出し先）
        const vr = svgEl('circle');
        setAttrs(vr, { cx: vx, cy: vy, r: r + 3.5 * bs, fill: 'none', stroke: '#00ff88', 'stroke-width': 2 * bs });
        kg.appendChild(vr);
      }
      vg.appendChild(kg);
    } else {
      const dot = svgEl('circle');
      dot.classList.add('vertex-dot');
      if (isValid) dot.classList.add('valid');
      setAttrs(dot, { cx: vx, cy: vy, r: isValid ? 7 : 5 });
      vg.appendChild(dot);
    }

    // 仮置きプレビュー（確定待ち）のゴースト。建物の有無に関わらず目立つリングを出す。
    if (opts?.previewVertexId === vertex.id) {
      const ghost = svgEl('circle');
      ghost.classList.add('vertex-preview');
      setAttrs(ghost, { cx: vx, cy: vy, r: 12 });
      vg.appendChild(ghost);
    }

    // タッチ用の透明な大きめ当たり判定（候補のみ）。CSSでタッチ端末のみ有効化。
    // 開拓地候補・都市候補（建物あり）の両方に付与する。
    if (isValid) {
      const hit = svgEl('circle');
      hit.classList.add('vertex-hit');
      setAttrs(hit, { cx: vx, cy: vy, r: 24 });
      vg.appendChild(hit);
    }

    g.appendChild(vg);
  }
  return g;
}

// ============================================================
// メイン描画関数
// ============================================================

/**
 * SVG 要素にカタンボードを描画する。
 * 呼び出すたびに SVG を完全再描画する。
 */
export function renderBoard(
  svgEl_: SVGSVGElement,
  state: GameState,
  opts?: BoardRenderOptions,
): void {
  while (svgEl_.firstChild) svgEl_.removeChild(svgEl_.firstChild);

  // 中央寄せ・海背景はビューボックスのユーザ座標系(800×700)を基準にする。
  // clientWidth/Height は CSS 縮小後のレンダリング px のため、盤面が縮むと
  // タイル群が viewBox 内で左に寄り、左右の余白が非対称に見える原因になる。
  // viewBox 寸法を使えば、レンダリング倍率に関係なく常に中央＝viewBox中心に揃う。
  const vb = svgEl_.viewBox?.baseVal;
  const W = vb && vb.width  ? vb.width  : (svgEl_.clientWidth  || 800);
  const H = vb && vb.height ? vb.height : (svgEl_.clientHeight || 700);
  const vbx = vb && vb.width ? vb.x : 0;
  const vby = vb && vb.height ? vb.y : 0;
  // タイル群は viewBox の中心に合わせる（viewBox を狭めて余白を削ると相対的にタイルが拡大する）。
  const { ox, oy } = boardOffset(state, vbx + W / 2, vby + H / 2);
  const size = HEX_SIZE;

  // --- 海背景（viewBox 全体を覆う。スケール対象外＝海・余白・外枠は不変） ---
  // 深いティールの縦グラデで「海の深み」を出す（フラットな水色をやめる）。
  // renderBoard は毎回 SVG をクリアするので defs も毎回作り直す。
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient');
  setAttrs(grad, { id: 'sea-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
  const stopTop = svgEl('stop'); setAttrs(stopTop, { offset: '0', 'stop-color': '#1c6b78' });
  const stopBot = svgEl('stop'); setAttrs(stopBot, { offset: '1', 'stop-color': '#0f4049' });
  grad.appendChild(stopTop); grad.appendChild(stopBot);
  defs.appendChild(grad);
  // 金タイル用の光沢ゴールド（麦の落ち着いた黄土色と差別化）。
  const gold = svgEl('linearGradient');
  setAttrs(gold, { id: 'gold-grad', x1: '0', y1: '0', x2: '0.3', y2: '1' });
  const g1 = svgEl('stop'); setAttrs(g1, { offset: '0', 'stop-color': '#fff6c2' });
  const g2 = svgEl('stop'); setAttrs(g2, { offset: '0.45', 'stop-color': '#ffd11a' });
  const g3 = svgEl('stop'); setAttrs(g3, { offset: '1', 'stop-color': '#d99000' });
  gold.appendChild(g1); gold.appendChild(g2); gold.appendChild(g3);
  defs.appendChild(gold);
  svgEl_.appendChild(defs);

  const sea = svgEl('rect');
  sea.setAttribute('class', 'sea');
  // 1px内側に寄せて細い真鍮の海岸線フレームを縁に出す（レイアウト非依存）。
  setAttrs(sea, {
    x: vbx + 1, y: vby + 1, width: W - 2, height: H - 2, fill: 'url(#sea-grad)', rx: 12,
    stroke: 'rgba(208,168,108,0.22)', 'stroke-width': 2,
  });
  svgEl_.appendChild(sea);

  // タッチ端末では盤面コンテンツ（タイル/数字/建物/港/盗賊）だけを viewBox 中心まわりに
  // 少しだけ拡大して見やすくする。海背景(sea)は対象外なので水色の余白・外枠は不変。
  // ピンチズーム/パンの永続ビューポート（海背景の上、盤面コンテンツを包む）。
  // ここに transform を載せるため、getScreenCTM 経由のタップ座標逆算（events.ts）が
  // ズーム/パンに自動追従する。海背景(sea)は外側なので拡縮しない。
  const viewport = svgEl('g');
  viewport.setAttribute('class', 'board-viewport');
  const vp = opts?.viewport;
  if (vp && (vp.scale !== 1 || vp.tx !== 0 || vp.ty !== 0)) {
    viewport.setAttribute('transform', `translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`);
  }

  const content = svgEl('g');
  // タップ座標→盤面ピクセル座標の変換に使う（events.ts が CTM とこの offset で逆算）。
  content.setAttribute('class', 'board-content');
  content.dataset.ox = String(ox);
  content.dataset.oy = String(oy);
  // タッチ端末は少し拡大して見やすく。ただし viewBox に収まる範囲を超えない（大きい盤面は自動縮小）。
  const boardZoom = isTouchDevice() ? 1.06 : 1.0;
  const scale = Math.min(boardZoom, boardContentScale(state, W, H, size));
  if (Math.abs(scale - 1) > 0.001) {
    const cx = vbx + W / 2, cy = vby + H / 2;
    content.setAttribute('transform', `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`);
  }

  // --- タイル（最下層） ---
  const tileGroup = svgEl('g');
  tileGroup.setAttribute('class', 'tiles');
  for (const tile of Object.values(state.tiles)) {
    tileGroup.appendChild(renderTile(tile, ox, oy, size, opts));
  }
  content.appendChild(tileGroup);

  // --- 辺（道）。港ラベルより先に描いて、港表示を道より前面にする ---
  content.appendChild(renderEdges(state, ox, oy, opts));

  // --- 港（道より後＝前面に描画して、2:1/3:1 や資源アイコンを読めるようにする） ---
  const harborGroup = svgEl('g');
  harborGroup.setAttribute('class', 'harbors');
  for (const harbor of state.harbors) {
    harborGroup.appendChild(renderHarbor(harbor, state, ox, oy));
  }
  content.appendChild(harborGroup);

  // --- 頂点（建物。最前面） ---
  content.appendChild(renderVertices(state, ox, oy, opts));

  viewport.appendChild(content);
  svgEl_.appendChild(viewport);
}
