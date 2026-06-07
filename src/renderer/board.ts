// ============================================================
// src/renderer/board.ts — F-01 + F-02: ボードSVGレンダリング
// ============================================================

import type { GameState, Tile, HarborType, Harbor } from '../types';
import { HEX_SIZE } from '../constants';
import { axialToPixel } from '../engine/board';

// ============================================================
// レンダリングオプション（有効配置ハイライト用）
// ============================================================

export interface BoardRenderOptions {
  validVertexIds?: Set<string>;
  validEdgeIds?: Set<string>;
  validTileIds?: Set<string>;
  // 仮置きプレビュー（確定待ち）のターゲット。ゴースト表示する。
  previewVertexId?: string;
  previewEdgeId?: string;
  // ピンチズーム/パンの永続ビューポート（viewBox座標系）。再描画後も維持される。
  viewport?: BoardViewport;
}

export interface BoardViewport {
  scale: number;
  tx: number;
  ty: number;
}

// 強盗コマをタイル中心から下へずらす量（数字チップとの重なり回避）。
const ROBBER_DY = 22;

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

  // 強盗コマ: フード付きの黒いコマ（影＋不気味な光る目）。数字チップと丸かぶりしないよう下にずらす。
  if (tile.hasRobber) {
    const ry = cy + ROBBER_DY;
    const touch = isTouchDevice();
    const rs = touch ? 1.15 : 1.0;                 // 盗賊スケール
    const rg = svgEl('g');
    rg.classList.add('robber');
    const P = (dx: number, dy: number): string => `${(cx + dx * rs).toFixed(1)},${(ry + dy * rs).toFixed(1)}`;

    // 影
    const shadow = svgEl('ellipse');
    setAttrs(shadow, { cx, cy: ry + 10 * rs, rx: 8.5 * rs, ry: 2.4 * rs, fill: 'rgba(0,0,0,0.38)' });
    rg.appendChild(shadow);

    // フード付きの黒マント（雫型: 頭の丸み→裾が広がる）
    const cloak = svgEl('path');
    cloak.setAttribute('d',
      `M ${P(-7.5, 9)} Q ${P(-8.5, -2)} ${P(-4, -7)} Q ${P(0, -10.5)} ${P(4, -7)} Q ${P(8.5, -2)} ${P(7.5, 9)} Z`);
    setAttrs(cloak, { fill: '#15151c', stroke: '#000', 'stroke-width': 1.6 * rs, 'stroke-linejoin': 'round' });
    rg.appendChild(cloak);

    // フード内側の影
    const face = svgEl('ellipse');
    setAttrs(face, { cx, cy: ry - 2.5 * rs, rx: 3.8 * rs, ry: 4.4 * rs, fill: 'rgba(0,0,0,0.6)' });
    rg.appendChild(face);

    // 不気味に光る目（2点）
    for (const ex of [-1.8, 1.8]) {
      const eye = svgEl('circle');
      setAttrs(eye, { cx: cx + ex * rs, cy: ry - 2.5 * rs, r: 0.95 * rs, fill: '#ffcf4d' });
      rg.appendChild(eye);
    }
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
      line.classList.add('road-line-built');
      // 設置アニメ(C-4)で対象を引けるよう id を付ける（敷設済みは配置対象にならないので無害）。
      line.setAttribute('data-road-edge-id', edge.id);
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
      // 仮置きプレビュー（確定待ち）のゴースト道。
      if (opts?.previewEdgeId === edge.id) {
        const ghost = svgEl('line');
        ghost.classList.add('edge-preview');
        setAttrs(ghost, { x1, y1, x2, y2 });
        g.appendChild(ghost);
      }
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
      const color = buildingColor[vertex.building.playerId] ?? '#aaa';
      const stroke = isValid ? '#00ff88' : '#fff';
      const sw = (isValid ? 2.5 : 1.5) * bs;
      // 頂点中心(vx,vy)基準で dx,dy を bs 倍した座標文字列を返す。
      const P = (dx: number, dy: number): string => `${(vx + dx * bs).toFixed(1)},${(vy + dy * bs).toFixed(1)}`;

      if (vertex.building.type === 'settlement') {
        // 開拓地：小さくて分かりやすい家（影 + 丸みのある壁 + 三角屋根 + ドア）。都市より小さい。
        const shadow = svgEl('ellipse');
        setAttrs(shadow, { cx: vx, cy: vy + 6.3 * bs, rx: 7.5 * bs, ry: 2 * bs, fill: 'rgba(0,0,0,0.28)' });
        vg.appendChild(shadow);
        const wall = svgEl('rect');
        setAttrs(wall, { x: vx - 6.5 * bs, y: vy - 2.5 * bs, width: 13 * bs, height: 8.5 * bs, rx: 1.5 * bs,
          fill: color, stroke, 'stroke-width': sw, 'paint-order': 'stroke' });
        vg.appendChild(wall);
        const roof = svgEl('polygon');
        roof.setAttribute('points', `${P(0, -11)} ${P(-8.5, -2)} ${P(8.5, -2)}`);
        setAttrs(roof, { fill: color, stroke, 'stroke-width': sw, 'stroke-linejoin': 'round', 'paint-order': 'stroke' });
        vg.appendChild(roof);
        // ドア（家らしさ＋視認性）
        const door = svgEl('rect');
        setAttrs(door, { x: vx - 1.8 * bs, y: vy + 1.2 * bs, width: 3.6 * bs, height: 4.8 * bs, rx: 0.8 * bs,
          fill: 'rgba(0,0,0,0.4)' });
        vg.appendChild(door);
      } else {
        // 都市：開拓地より明確に大きい「城」型。
        //   影 → 横長の城壁 → 城壁上部の鋸歯(銃眼) → 金色の王冠。
        // 城壁はプレイヤーカラー、王冠は金色固定（「格上げ済み」の共通サイン）。
        // 黒枠で縁取って、明るいタイル上でも一目で都市と分かるよう強調する。
        const cityStroke = isValid ? '#00ff88' : '#0a0a0a';
        const citySw = (isValid ? 2.6 : 2.2) * bs;
        const shadow = svgEl('ellipse');
        setAttrs(shadow, { cx: vx, cy: vy + 6.8 * bs, rx: 11.5 * bs, ry: 2.7 * bs,
          fill: 'rgba(0,0,0,0.32)' });
        vg.appendChild(shadow);

        const wall = svgEl('rect');
        setAttrs(wall, { x: vx - 11 * bs, y: vy - 2 * bs, width: 22 * bs, height: 9 * bs, rx: 1,
          fill: color, stroke: cityStroke, 'stroke-width': citySw, 'paint-order': 'stroke' });
        vg.appendChild(wall);

        // 城壁上部の鋸歯（3つの銃眼=メルロン）。城らしさを出す。
        const merlons = svgEl('polygon');
        merlons.setAttribute('points', [
          P(-11, -2), P(-11, -7), P(-7.5, -7), P(-7.5, -4),
          P(-3, -4), P(-3, -7), P(3, -7), P(3, -4),
          P(7.5, -4), P(7.5, -7), P(11, -7), P(11, -2),
        ].join(' '));
        setAttrs(merlons, { fill: color, stroke: cityStroke, 'stroke-width': citySw, 'paint-order': 'stroke' });
        vg.appendChild(merlons);

        // 窓（建物らしさ）。城壁に小さな明かり取りを3つ並べる。
        for (const wx of [-6.5, 0, 6.5]) {
          const win = svgEl('rect');
          setAttrs(win, { x: vx + (wx - 1.2) * bs, y: vy + 0.8 * bs, width: 2.4 * bs, height: 4 * bs, rx: 0.6 * bs,
            fill: 'rgba(0,0,0,0.45)' });
          vg.appendChild(win);
        }

        // 金色の王冠（都市の識別マーク）。プレイヤーカラーとは別色で「都市」を一目で示す。
        const crown = svgEl('polygon');
        crown.setAttribute('points', [
          P(-5, -8), P(-5, -11.5), P(-2.5, -9), P(0, -13.5), P(2.5, -9), P(5, -11.5), P(5, -8),
        ].join(' '));
        setAttrs(crown, { fill: '#ffd24a', stroke: '#7a5800', 'stroke-width': Math.max(1, 1 * bs),
          'stroke-linejoin': 'round' });
        vg.appendChild(crown);
      }
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
  const boardZoom = isTouchDevice() ? 1.06 : 1.0;
  if (boardZoom !== 1) {
    const cx = vbx + W / 2, cy = vby + H / 2;
    content.setAttribute('transform', `translate(${cx} ${cy}) scale(${boardZoom}) translate(${-cx} ${-cy})`);
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
