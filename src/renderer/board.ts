// ============================================================
// src/renderer/board.ts — F-01 + F-02: ボードSVGレンダリング
// ============================================================

import type { GameState, Tile, TileType, HarborType, Harbor } from '../types';
import { HEX_SIZE } from '../constants';
import { axialToPixel } from '../engine/board';

// ============================================================
// レンダリングオプション（有効配置ハイライト用）
// ============================================================

export interface BoardRenderOptions {
  validVertexIds?: Set<string>;
  validEdgeIds?: Set<string>;
  validTileIds?: Set<string>;
}

// 強盗コマをタイル中心から下へずらす量（数字チップとの重なり回避）。
const ROBBER_DY = 22;

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

// タイル群の中心を、指定した中心座標(centerX, centerY)へ合わせるオフセットを返す。
// centerX/Y は viewBox の中心（vb.x + vb.width/2 など）を渡す。
function boardOffset(state: GameState, centerX: number, centerY: number): { ox: number; oy: number } {
  const coords = Object.values(state.tiles).map(t => axialToPixel(t.coord));
  const minX = Math.min(...coords.map(p => p.x));
  const maxX = Math.max(...coords.map(p => p.x));
  const minY = Math.min(...coords.map(p => p.y));
  const maxY = Math.max(...coords.map(p => p.y));
  return {
    ox: centerX - (minX + maxX) / 2,
    oy: centerY - (minY + maxY) / 2,
  };
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

  // 数字トークン（砂漠以外）
  if (tile.number != null) {
    const isRed = tile.number === 6 || tile.number === 8;
    const RADIUS = 18;

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
    setAttrs(dots, { x: cx, y: cy + 14 });
    dots.textContent = DOTS[tile.number] ?? '';
    g.appendChild(dots);
  }

  // 強盗コマ（どろぼう風アイコン）。数字チップ(中央)と丸かぶりしないよう少し下にずらす。
  if (tile.hasRobber) {
    const ry = cy + ROBBER_DY;
    const rg = svgEl('g');
    rg.classList.add('robber');
    const bg = svgEl('circle');
    setAttrs(bg, { cx, cy: ry, r: 14, fill: 'rgba(18,18,24,0.9)', stroke: '#000', 'stroke-width': 1.5 });
    rg.appendChild(bg);
    const icon = svgEl('text');
    setAttrs(icon, {
      x: cx, y: ry + 1,
      'font-size': 18, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'pointer-events': 'none',
    });
    icon.textContent = '🦹';
    rg.appendChild(icon);
    g.appendChild(rg);
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

  // 港辺ライン（太く、色付き）
  const line = svgEl('line');
  line.classList.add('harbor-line');
  setAttrs(line, { x1: ax, y1: ay, x2: bx, y2: by,
    stroke: HARBOR_COLOR[harbor.type], 'stroke-width': 5 });
  g.appendChild(line);

  // 頂点マーカー（港がどの交点に対応しているかを表示）
  for (const [cx, cy] of [[ax, ay], [bx, by]] as [number, number][]) {
    const dot = svgEl('circle');
    dot.classList.add('harbor-dot');
    setAttrs(dot, { cx, cy, r: 5, fill: HARBOR_COLOR[harbor.type], opacity: 0.8 });
    g.appendChild(dot);
  }

  // 背景バッジ（大きめに）
  const badgeW = 44;
  const badgeH = 18;
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
  const roadColor: Record<string, string> = {
    player1: '#e03030', player2: '#3060e0',
    player3: '#a855f7', player4: '#f0a020',
  };

  for (const edge of Object.values(state.edges)) {
    const [va, vb] = edge.vertexIds;
    const vA = state.vertices[va];
    const vB = state.vertices[vb];
    if (!vA || !vB) continue;

    if (edge.road) {
      const line = svgEl('line');
      setAttrs(line, {
        x1: vA.pixel.x + ox, y1: vA.pixel.y + oy,
        x2: vB.pixel.x + ox, y2: vB.pixel.y + oy,
        stroke: roadColor[edge.road.playerId] ?? '#aaa',
        'stroke-width': 7,
        'stroke-linecap': 'round',
      });
      g.appendChild(line);
    } else {
      const isValid = opts?.validEdgeIds?.has(edge.id) ?? false;
      const x1 = vA.pixel.x + ox, y1 = vA.pixel.y + oy;
      const x2 = vB.pixel.x + ox, y2 = vB.pixel.y + oy;
      const line = svgEl('line');
      line.classList.add('edge-line');
      if (isValid) line.classList.add('valid');
      line.setAttribute('data-edge-id', edge.id);
      setAttrs(line, { x1, y1, x2, y2 });
      g.appendChild(line);
      // タッチ用の透明な太い当たり判定（候補のみ）。CSSでタッチ端末のみ有効化。
      if (isValid) {
        const hit = svgEl('line');
        hit.classList.add('edge-hit');
        hit.setAttribute('data-edge-id', edge.id);
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
  const buildingColor: Record<string, string> = {
    player1: '#e03030', player2: '#3060e0',
    player3: '#a855f7', player4: '#f0a020',
  };

  for (const vertex of Object.values(state.vertices)) {
    const vx = vertex.pixel.x + ox;
    const vy = vertex.pixel.y + oy;

    // 頂点ごとの g 要素（クリック委譲用）
    const vg = svgEl('g');
    vg.setAttribute('data-vertex-id', vertex.id);

    const isValid = opts?.validVertexIds?.has(vertex.id) ?? false;

    if (vertex.building) {
      const color = buildingColor[vertex.building.playerId] ?? '#aaa';
      const stroke = isValid ? '#00ff88' : '#fff';
      const sw = isValid ? 2.5 : 1.5;

      if (vertex.building.type === 'settlement') {
        // 家の形：壁(rect) + 屋根(triangle)
        const wall = svgEl('rect');
        setAttrs(wall, { x: vx - 6, y: vy - 3, width: 12, height: 8,
          fill: color, stroke, 'stroke-width': sw });
        const roof = svgEl('polygon');
        roof.setAttribute('points', `${vx},${vy - 11} ${vx - 8},${vy - 2} ${vx + 8},${vy - 2}`);
        setAttrs(roof, { fill: color, stroke, 'stroke-width': sw });
        vg.appendChild(wall);
        vg.appendChild(roof);
      } else {
        // 都市：大きな壁 + 塔(縦長rect) + 小旗
        const wall = svgEl('rect');
        setAttrs(wall, { x: vx - 9, y: vy - 5, width: 18, height: 10,
          fill: color, stroke, 'stroke-width': sw });
        const tower = svgEl('rect');
        setAttrs(tower, { x: vx - 3, y: vy - 13, width: 7, height: 9,
          fill: color, stroke, 'stroke-width': sw });
        // 王冠っぽいジグザグ上部
        const crown = svgEl('polygon');
        crown.setAttribute('points',
          `${vx - 3},${vy - 12} ${vx - 1},${vy - 16} ${vx + 1},${vy - 12} ${vx + 3},${vy - 16} ${vx + 4},${vy - 12}`);
        setAttrs(crown, { fill: color, stroke, 'stroke-width': sw });
        vg.appendChild(wall);
        vg.appendChild(tower);
        vg.appendChild(crown);
      }
    } else {
      const dot = svgEl('circle');
      dot.classList.add('vertex-dot');
      if (isValid) dot.classList.add('valid');
      setAttrs(dot, { cx: vx, cy: vy, r: isValid ? 7 : 5 });
      vg.appendChild(dot);
    }

    // タッチ用の透明な大きめ当たり判定（候補のみ）。CSSでタッチ端末のみ有効化。
    // 開拓地候補・都市候補（建物あり）の両方に付与する。
    if (isValid) {
      const hit = svgEl('circle');
      hit.classList.add('vertex-hit');
      setAttrs(hit, { cx: vx, cy: vy, r: 16 });
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

  // --- 海背景（viewBox 全体を覆う） ---
  const sea = svgEl('rect');
  setAttrs(sea, { x: vbx, y: vby, width: W, height: H, fill: '#1a6ea8', rx: 12 });
  svgEl_.appendChild(sea);

  // --- タイル（最下層） ---
  const tileGroup = svgEl('g');
  tileGroup.setAttribute('class', 'tiles');
  for (const tile of Object.values(state.tiles)) {
    tileGroup.appendChild(renderTile(tile, ox, oy, size, opts));
  }
  svgEl_.appendChild(tileGroup);

  // --- 辺（道）。港ラベルより先に描いて、港表示を道より前面にする ---
  svgEl_.appendChild(renderEdges(state, ox, oy, opts));

  // --- 港（道より後＝前面に描画して、2:1/3:1 や資源アイコンを読めるようにする） ---
  const harborGroup = svgEl('g');
  harborGroup.setAttribute('class', 'harbors');
  for (const harbor of state.harbors) {
    harborGroup.appendChild(renderHarbor(harbor, state, ox, oy));
  }
  svgEl_.appendChild(harborGroup);

  // --- 頂点（建物。最前面） ---
  svgEl_.appendChild(renderVertices(state, ox, oy, opts));
}
