// ============================================================
// src/renderer/diceGL.ts — Three.js(WebGL) 3Dダイス描画
// 実写級の立体感（RoundedBox＋PBR＋IBL＋ソフトシャドウ）。出目は外から渡された値を使い、
// diceGLMapping の目標姿勢へ必ず着地させる（物理で出目を決めない）。レンダーオンデマンド。
// ============================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  FACE_NORMALS, PROD_FACE_VALUE, EVENT_FACE_RESULT,
  productionTargetQuaternion, eventTargetQuaternion, type EventResult,
} from './diceGLMapping';
import { ASSETS } from '../assets/manifest';

export interface RollSpec {
  red: { value: number };
  yellow: { value: number };
  event: { result: EventResult } | null;
}
export interface RollTiming { redMs: number; yellowMs: number; eventMs: number; }
export interface RollCallbacks {
  onRedLand?: () => void;
  onYellowLand?: () => void;
  onEventLand?: () => void;
  onDone?: () => void;
}

const TEX = 256;            // 面テクスチャ解像度
const GATE_COLOR: Record<Exclude<EventResult, 'ship'>, string> = {
  politics: '#3f74d8', science: '#3fae62', trade: '#d9a82e',
};
const RING_COLOR: Record<EventResult, number> = {
  ship: 0x9fb2c4, politics: 0x5b8def, science: 0x5fc77a, trade: 0xffd24d,
};

// ---- キャンバス→テクスチャ ----
function canvasTexture(draw: (c: CanvasRenderingContext2D) => void, size = TEX): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
  6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};

/** 生産ダイスのピップ面（透過。平らな塗り＋わずかな凹み陰影＝硬い彫り目）。 */
function pipTexture(value: number, pip: string): THREE.CanvasTexture {
  return canvasTexture((c) => {
    c.clearRect(0, 0, TEX, TEX);
    const step = TEX / 4, r = TEX * 0.082;
    for (const [gx, gy] of PIPS[value] ?? []) {
      const x = gx * step, y = gy * step;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = pip; c.fill();
      // 上に光・下に影でわずかな凹凸（硬さを出す）
      const g = c.createRadialGradient(x, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.38)');
      g.addColorStop(0.55, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.4)');
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    }
  });
}

/** 盾(ヒーターシールド)パス。 */
function shieldPath(c: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const l = cx - w / 2, r = cx + w / 2, t = cy - h / 2;
  c.beginPath();
  c.moveTo(l, t); c.lineTo(r, t);
  c.lineTo(r, cy + h * 0.12);
  c.quadraticCurveTo(r, cy + h * 0.36, cx, cy + h / 2);
  c.quadraticCurveTo(l, cy + h * 0.36, l, cy + h * 0.12);
  c.closePath();
}

/** 交易品グリフ（ベクター・漢字不使用）。coin/paper/cloth。 */
function drawGood(c: CanvasRenderingContext2D, good: 'coin' | 'paper' | 'cloth', cx: number, cy: number, s: number): void {
  c.save(); c.translate(cx, cy);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (good === 'coin') {
    const g = c.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
    g.addColorStop(0, '#ffe79a'); g.addColorStop(1, '#b8860b');
    c.beginPath(); c.arc(0, 0, s, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    c.lineWidth = s * 0.12; c.strokeStyle = '#8a6508'; c.stroke();
    c.beginPath(); c.arc(0, 0, s * 0.6, 0, Math.PI * 2); c.strokeStyle = 'rgba(120,90,8,0.7)'; c.lineWidth = s * 0.08; c.stroke();
    c.fillStyle = '#7a5606'; c.font = `900 ${s * 1.0}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    // ※「文字」ではなく貨幣記号の刻印（漢字ではない）。
    c.fillText('✶', 0, s * 0.04);
  } else if (good === 'paper') {
    // 巻物
    c.fillStyle = '#f3e7c6'; c.strokeStyle = '#9c7b3a'; c.lineWidth = s * 0.1;
    c.fillRect(-s * 0.62, -s * 0.5, s * 1.24, s); c.strokeRect(-s * 0.62, -s * 0.5, s * 1.24, s);
    for (const ex of [-s * 0.62, s * 0.62]) {
      c.beginPath(); c.ellipse(ex, 0, s * 0.16, s * 0.56, 0, 0, Math.PI * 2);
      c.fillStyle = '#d8c290'; c.fill(); c.stroke();
    }
    c.strokeStyle = 'rgba(120,90,40,0.55)'; c.lineWidth = s * 0.05;
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(-s * 0.35, i * s * 0.22); c.lineTo(s * 0.35, i * s * 0.22); c.stroke(); }
  } else {
    // 布（畳んだ織物）
    const g = c.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, '#7fb0ff'); g.addColorStop(1, '#2f63c8');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-s * 0.7, -s * 0.45);
    c.quadraticCurveTo(0, -s * 0.7, s * 0.7, -s * 0.45);
    c.lineTo(s * 0.7, s * 0.45);
    c.quadraticCurveTo(0, s * 0.7, -s * 0.7, s * 0.45);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = s * 0.06;
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(-s * 0.55, i * s * 0.3); c.quadraticCurveTo(0, i * s * 0.3 - s * 0.16, s * 0.55, i * s * 0.3); c.stroke(); }
  }
  c.restore();
}

/** イベント・ゲート面（透過。色付き盾＋交易品。漢字なし・エンボス風）。 */
function gateTexture(track: Exclude<EventResult, 'ship'>): THREE.CanvasTexture {
  const good = track === 'politics' ? 'coin' : track === 'science' ? 'paper' : 'cloth';
  return canvasTexture((c) => {
    c.clearRect(0, 0, TEX, TEX);
    const cx = TEX / 2, cy = TEX / 2;
    // 盾（陰影で彫り込み風）
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
    shieldPath(c, cx, cy + 6, TEX * 0.74, TEX * 0.82);
    const g = c.createLinearGradient(0, cy - TEX * 0.4, 0, cy + TEX * 0.4);
    g.addColorStop(0, GATE_COLOR[track]); g.addColorStop(1, '#11151c');
    c.fillStyle = g; c.fill();
    c.restore();
    shieldPath(c, cx, cy + 6, TEX * 0.74, TEX * 0.82);
    c.lineWidth = 7; c.strokeStyle = 'rgba(255,255,255,0.5)'; c.stroke();
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.5)'; c.stroke();
    drawGood(c, good as 'coin' | 'paper' | 'cloth', cx, cy + 2, TEX * 0.2);
  });
}

/** 船面（透過。蛮族船アートを石面に“彫り込み”として）。画像ロード後に差し替え。 */
function shipTexture(): { tex: THREE.CanvasTexture; setImg: (img: HTMLImageElement) => void } {
  const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
  const ctx = cv.getContext('2d')!;
  const fallback = (): void => {
    ctx.clearRect(0, 0, TEX, TEX);
    ctx.fillStyle = 'rgba(220,225,235,0.85)'; ctx.font = `${TEX * 0.5}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⛵', TEX / 2, TEX / 2);
  };
  fallback();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  const setImg = (img: HTMLImageElement): void => {
    ctx.clearRect(0, 0, TEX, TEX);
    const m = TEX * 0.1;
    ctx.drawImage(img, m, m, TEX - 2 * m, TEX - 2 * m);
    // 彫り込み: 影を内側に
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(20,26,34,0.22)'; ctx.fillRect(0, 0, TEX, TEX);
    ctx.globalCompositeOperation = 'source-over';
    tex.needsUpdate = true;
  };
  return { tex, setImg };
}

// ---- ダイス1個（ボディ＋6面デカール） ----
interface DieAnim {
  startQuat: THREE.Quaternion; targetQuat: THREE.Quaternion;
  axis: THREE.Vector3; totalAngle: number;
  baseY: number; landMs: number; t0: number; landed: boolean;
  onLand?: (() => void) | undefined;
}
interface Die { group: THREE.Group; body: THREE.MeshStandardMaterial; anim: DieAnim | null; restQuat: THREE.Quaternion; }

class DiceGLController {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private dice: { red: Die; yellow: Die; event: Die };
  private shipSetters: ((img: HTMLImageElement) => void)[] = [];
  private running = false;
  private climax: { mat: THREE.MeshStandardMaterial; t0: number; color: THREE.Color } | null = null;
  private done?: (() => void) | undefined;
  private tailUntil = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;   // 少し締めてコントラストを上げる＝硬い印象
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'dice-gl-canvas';

    // やや上・前方から。結果は正面の面に出る。少し引いてダイスを小さめのフレーミングに。
    this.camera = new THREE.PerspectiveCamera(27, 2, 0.1, 100);
    this.camera.position.set(0, 1.15, 5.95);
    this.camera.lookAt(0, 0.42, 0);

    // IBL（HDRI不要の自然な反射）
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // 強いキーライト＋シャープシャドウ＋弱い補助光＝硬く締まった陰影（柔らかい均一光をやめる）。
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(2.9, 5.2, 2.8); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 14;
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -4; c.right = 4; c.top = 4; c.bottom = -4;
    key.shadow.bias = -0.0007; key.shadow.radius = 1.0;   // 影をくっきり＝硬い接地
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xcdd9ee, 0x2a2014, 0.18)); // 補助は控えめ＝コントラスト維持

    // 接地影プレーン
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.55 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = true;
    this.scene.add(ground);

    this.dice = {
      red: this.makeProdDie('#cf2f29', '#fff2ee', -1.3),     // 赤いダイス＋クリームの目
      yellow: this.makeProdDie('#e8b21e', '#3a2a06', 0),     // 黄色いダイス＋濃い目
      event: this.makeEventDie(1.3),
    };

    // 蛮族船アートを非同期ロード→船面に反映
    if (ASSETS.piece.barbarianShip) {
      const img = new Image();
      img.onload = () => { this.shipSetters.forEach(s => s(img)); this.requestRender(); };
      img.src = ASSETS.piece.barbarianShip;
    }

    // リサイズ対応（マウント中のみ反映）。
    window.addEventListener('resize', () => { if (this.canvas.isConnected) this.resize(); });
  }

  private faceDecal(tex: THREE.Texture, faceIdx: number, sizeScale = 0.8): THREE.Mesh {
    const n = FACE_NORMALS[faceIdx]!.clone();
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.32, metalness: 0.0, envMapIntensity: 0.45 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sizeScale, sizeScale), mat);
    plane.position.copy(n.clone().multiplyScalar(0.5 + 0.004));
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    plane.castShadow = false;
    return plane;
  }

  private makeBody(color: string, roughness: number, metalness: number): { group: THREE.Group; body: THREE.MeshStandardMaterial } {
    const body = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.45 });
    // 角丸をごく小さく＝エッジの立った硬い立方体（柔らかい丸みをやめる。面取り程度）。
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.02), body);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const group = new THREE.Group(); group.add(mesh);
    return { group, body };
  }

  private makeProdDie(bodyColor: string, pip: string, x: number): Die {
    const { group, body } = this.makeBody(bodyColor, 0.3, 0.06);  // 硬い緻密な質感（くっきりハイライト）
    for (let i = 0; i < 6; i++) group.add(this.faceDecal(pipTexture(PROD_FACE_VALUE[i]!, pip), i));
    group.position.set(x, 0.5, 0);
    this.scene.add(group);
    return { group, body, anim: null, restQuat: new THREE.Quaternion() };
  }

  private makeEventDie(x: number): Die {
    const { group, body } = this.makeBody('#39434f', 0.5, 0.18);  // 硬い石/金属寄りの締まった質感
    for (let i = 0; i < 6; i++) {
      const r = EVENT_FACE_RESULT[i]!;
      if (r === 'ship') {
        const { tex, setImg } = shipTexture();
        this.shipSetters.push(setImg);
        group.add(this.faceDecal(tex, i, 0.84));
      } else {
        group.add(this.faceDecal(gateTexture(r), i, 0.86));
      }
    }
    group.position.set(x, 0.5, 0);
    this.scene.add(group);
    return { group, body, anim: null, restQuat: new THREE.Quaternion() };
  }

  /** 親要素にキャンバスを載せ、サイズを合わせる。 */
  mountTo(parent: HTMLElement): void {
    if (this.canvas.parentElement !== parent) parent.appendChild(this.canvas);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || 320, h = this.canvas.clientHeight || 170;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private setDieTo(die: Die, q: THREE.Quaternion): void {
    die.group.quaternion.copy(q); die.group.position.y = 0.5; die.group.scale.setScalar(1);
    die.restQuat.copy(q);
  }

  // ダイスの横位置: 基本ゲーム(2個)は中央寄せ、騎士と商人(3個)は赤/黄/イベントを横並び。
  private layoutDice(hasEvent: boolean): void {
    if (hasEvent) {
      this.dice.red.group.position.x = -1.3;
      this.dice.yellow.group.position.x = 0;
      this.dice.event.group.position.x = 1.3;
    } else {
      this.dice.red.group.position.x = -0.72;
      this.dice.yellow.group.position.x = 0.72;
    }
  }

  /** 即着地（reduced-motion / instant）。出目の正しさのみ担保。 */
  showStatic(spec: RollSpec): void {
    this.layoutDice(!!spec.event);
    this.setDieTo(this.dice.red, productionTargetQuaternion(spec.red.value));
    this.setDieTo(this.dice.yellow, productionTargetQuaternion(spec.yellow.value));
    if (spec.event) this.setDieTo(this.dice.event, eventTargetQuaternion(spec.event.result));
    this.dice.event.group.visible = !!spec.event;
    this.requestRender();
  }

  private armDie(die: Die, target: THREE.Quaternion, landMs: number, onLand?: (() => void) | undefined): void {
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() - 0.5) * 0.5);
    const finalQ = target.clone().multiply(roll); // 視軸(Z)回りのロールは正面=出目を変えない（自然な散らし）
    const axis = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.6 + 0.4, Math.random() * 2 - 1).normalize();
    const startQ = new THREE.Quaternion().setFromAxisAngle(axis, Math.random() * Math.PI * 2).multiply(finalQ);
    die.anim = {
      startQuat: startQ, targetQuat: finalQ, axis,
      totalAngle: Math.PI * (4 + Math.random() * 2), // 2〜3回転
      baseY: 0.5, landMs, t0: performance.now(), landed: false, onLand,
    };
    die.group.quaternion.copy(startQ);
  }

  /** ロール開始。出目→目標姿勢へタンブル着地。各着地で callbacks を発火。 */
  roll(spec: RollSpec, timing: RollTiming, cb: RollCallbacks): void {
    this.dice.event.group.visible = !!spec.event;
    this.layoutDice(!!spec.event);
    this.armDie(this.dice.red, productionTargetQuaternion(spec.red.value), timing.redMs, cb.onRedLand);
    this.armDie(this.dice.yellow, productionTargetQuaternion(spec.yellow.value), timing.yellowMs, cb.onYellowLand);
    if (spec.event) {
      this.armDie(this.dice.event, eventTargetQuaternion(spec.event.result), timing.eventMs, () => {
        this.triggerClimax(spec.event!.result); cb.onEventLand?.();
      });
    } else {
      this.dice.event.anim = null;
    }
    this.done = cb.onDone;
    this.tailUntil = performance.now() + Math.max(timing.redMs, timing.yellowMs, timing.eventMs) + 420;
    this.start();
  }

  private triggerClimax(result: EventResult): void {
    const mat = this.dice.event.body;
    mat.emissive = new THREE.Color(RING_COLOR[result]);
    this.climax = { mat, t0: performance.now(), color: new THREE.Color(RING_COLOR[result]) };
  }

  private start(): void { if (!this.running) { this.running = true; requestAnimationFrame(this.loop); } }
  private requestRender(): void { this.renderer.render(this.scene, this.camera); }

  private smoother(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private tickDie(die: Die, now: number): boolean {
    const a = die.anim; if (!a) return true;
    const u = Math.min(1, (now - a.t0) / a.landMs);
    const decel = 1 - Math.pow(1 - u, 3);
    const spin = new THREE.Quaternion().setFromAxisAngle(a.axis, a.totalAngle * decel);
    const tumble = a.startQuat.clone().premultiply(spin);
    const blend = this.smoother(0.5, 1.0, u);
    die.group.quaternion.copy(tumble.slerp(a.targetQuat, blend));
    // 放物の持ち上げ＋着地スカッシュ
    const hop = Math.sin(Math.PI * u) * 0.5;
    let sy = 1, sxz = 1;
    if (u > 0.84) { const k = (u - 0.84) / 0.16; const s = Math.sin(k * Math.PI); sy = 1 - s * 0.16; sxz = 1 + s * 0.1; }
    die.group.position.y = a.baseY + hop;
    die.group.scale.set(sxz, sy, sxz);
    if (u >= 1 && !a.landed) {
      a.landed = true; die.group.scale.setScalar(1); die.restQuat.copy(a.targetQuat);
      a.onLand?.();
    }
    return u >= 1;
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    let allLanded = true;
    for (const die of [this.dice.red, this.dice.yellow, this.dice.event]) {
      if (die === this.dice.event && !die.group.visible) continue;
      if (die.anim) allLanded = this.tickDie(die, now) && allLanded;
    }
    // クライマックス発光の減衰
    if (this.climax) {
      const k = (now - this.climax.t0) / 360;
      if (k >= 1) { this.climax.mat.emissiveIntensity = 0; this.climax.mat.emissive.setRGB(0, 0, 0); this.climax = null; }
      else { this.climax.mat.emissiveIntensity = Math.sin(k * Math.PI) * 0.9; }
    }
    this.requestRender();
    if (allLanded && !this.climax && now >= this.tailUntil) {
      this.running = false;
      for (const d of [this.dice.red, this.dice.yellow, this.dice.event]) d.anim = null;
      this.done?.(); this.done = undefined;
      return;
    }
    requestAnimationFrame(this.loop);
  };

  /** 連続ロールの後始末（次ロールで再利用するため renderer は破棄しない）。 */
  reset(): void {
    this.running = false; this.climax = null; this.done = undefined;
    for (const d of [this.dice.red, this.dice.yellow, this.dice.event]) {
      d.anim = null; d.body.emissiveIntensity = 0; d.body.emissive.setRGB(0, 0, 0);
    }
  }

  dispose(): void {
    this.running = false;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.renderer.dispose();
    this.canvas.remove();
  }
}

let _ctrl: DiceGLController | null = null;
let _failed = false;

/** WebGL対応なら DiceGL を遅延生成して返す。非対応/失敗時は null（呼び出し側でフォールバック）。 */
export function ensureDiceGL(): DiceGLController | null {
  if (_ctrl) return _ctrl;
  if (_failed) return null;
  try {
    const test = document.createElement('canvas');
    if (!(test.getContext('webgl2') || test.getContext('webgl'))) { _failed = true; return null; }
    _ctrl = new DiceGLController();
    return _ctrl;
  } catch (e) {
    console.warn('DiceGL init failed; falling back', e);
    _failed = true; _ctrl = null; return null;
  }
}

export type { DiceGLController };
