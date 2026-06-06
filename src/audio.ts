// ============================================================
// src/audio.ts — BGM + SE（Web Audio API）
// ============================================================
// main.ts から分離した音声サブシステム。ゲーム状態には依存しない（純UIの副作用層）。
// 公開APIはファイル末尾の export を参照（playSE / bgm* / 設定アクセサ）。

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

// -------------------------------------------------------
// BGM: Cメジャーペンタトニックの穏やかなメロディ
// ドローンや不協和音を使わず、酒場風の明るい雰囲気
// -------------------------------------------------------
let _bgmEnabled  = false;
let _bgmVolume   = 0.07;  // かなり控えめ
let _bgmLoopId   = 0;
let _bgmOscs: OscillatorNode[] = [];
let _bgmMaster: GainNode | null = null;   // 手続き生成BGMのマスターゲイン（フェード用）
let _bgmAudio: HTMLAudioElement | null = null;            // 実音源プレイヤー（使用時）
let _bgmFadeTimer: ReturnType<typeof setInterval> | null = null;
// 実音源の音量（控えめ）。スライダー(_bgmVolume)に比例させる。
function bgmAudioVol(): number { return Math.min(1, _bgmVolume * 3.5); }
// 実音源の音量を ms かけて to へフェードする。
function fadeAudio(audio: HTMLAudioElement, to: number, ms: number, onDone?: () => void): void {
  if (_bgmFadeTimer) { clearInterval(_bgmFadeTimer); _bgmFadeTimer = null; }
  const from = audio.volume;
  const steps = 14; let i = 0;
  _bgmFadeTimer = setInterval(() => {
    i++;
    try { audio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps))); } catch { /**/ }
    if (i >= steps) { if (_bgmFadeTimer) { clearInterval(_bgmFadeTimer); _bgmFadeTimer = null; } onDone?.(); }
  }, Math.max(10, ms / steps));
}

// ---- BGM 3種。実音源(public/bgm)を優先再生し、未配置/読込失敗時は手続き生成BGMへ
//      フォールバックする。実音源候補・利用規約メモは docs/BGM候補.md / public/bgm/README.md。 ----
interface BgmTrack {
  id: string;                       // 保存用の安定ID（並び替えしても保存選択を保てる）
  name: string;
  file?: string;                    // 実音源パス(public配下)。無い/読めない時は seq で代替。
  beatSec: number;
  melody: OscillatorType;
  bass: OscillatorType;
  seq: [number, number, number][]; // 手続き生成フォールバック [freq_hz, dur_beats, vol_ratio]
}
// 並びは「港町の酒場」を先頭（=既定）にする。
const BGM_TRACKS: BgmTrack[] = [
  {
    // 港町の酒場（既定）— 中世・ケルト風。実音源候補: PeriTune「Portside Café」
    id: 'tavern', name: '港町の酒場', file: '/bgm/portside_cafe.mp3', beatSec: 0.36, melody: 'triangle', bass: 'triangle',
    seq: [
      [440.0,1,0.7],[523.3,1,0.6],[493.9,1,0.65],[440.0,1,0.6],[392.0,1,0.55],[440.0,2,0.6],
      [493.9,1,0.65],[587.3,1,0.6],[523.3,1,0.6],[493.9,1,0.55],[440.0,1,0.6],[493.9,2,0.6],
      [523.3,1,0.65],[659.3,1,0.7],[587.3,1,0.6],[523.3,1,0.6],[493.9,1,0.55],[523.3,2,0.6],
      [440.0,1,0.6],[392.0,1,0.55],[440.0,1,0.6],[523.3,1,0.65],[493.9,1,0.6],[440.0,3,0.6],
    ],
  },
  {
    // 開拓の朝 — 明るくほのぼの。実音源候補: PeriTune「Village_Fete」
    id: 'morning', name: '開拓の朝', file: '/bgm/village_fete.mp3', beatSec: 0.55, melody: 'sine', bass: 'triangle',
    seq: [
      [261.6,1,0.8],[329.6,1,0.7],[392.0,1,0.8],[523.3,1,0.6],
      [440.0,1,0.7],[392.0,1,0.6],[329.6,2,0.5],
      [261.6,1,0.7],[349.2,1,0.6],[392.0,1,0.7],[349.2,1,0.5],
      [329.6,1,0.6],[293.7,1,0.5],[261.6,2,0.7],
      [392.0,1,0.6],[440.0,1,0.7],[523.3,1,0.8],[440.0,1,0.6],
      [392.0,1,0.6],[329.6,1,0.5],[261.6,3,0.4],
    ],
  },
  {
    // 静かな夜 — 落ち着いたファンタジー。実音源候補: PeriTune「Nocturnal_Bloom」
    id: 'night', name: '静かな夜', file: '/bgm/nocturnal_bloom.mp3', beatSec: 0.74, melody: 'sine', bass: 'triangle',
    seq: [
      [440.0,2,0.5],[523.3,2,0.45],[659.3,2,0.5],[587.3,2,0.4],
      [523.3,2,0.45],[493.9,2,0.4],[440.0,3,0.5],[392.0,1,0.35],
      [349.2,2,0.45],[392.0,2,0.4],[440.0,2,0.5],[523.3,2,0.45],
      [493.9,2,0.4],[440.0,2,0.45],[392.0,3,0.5],[329.6,1,0.35],
    ],
  },
];

// 保存は曲ID（並び替えしても選択が崩れない）。未保存/不正値（旧数値含む）は既定=先頭(港町の酒場)。
const BGM_TRACK_KEY = 'catan_bgm_track';
function loadBgmTrack(): number {
  try {
    const id = localStorage.getItem(BGM_TRACK_KEY) ?? '';
    const idx = BGM_TRACKS.findIndex(t => t.id === id);
    return idx >= 0 ? idx : 0;
  } catch { return 0; }
}
function saveBgmTrack(i: number): void {
  try { const id = BGM_TRACKS[i]?.id; if (id) localStorage.setItem(BGM_TRACK_KEY, id); } catch { /* 無視 */ }
}
let _bgmTrack = loadBgmTrack();

function bgmStart(): void {
  if (!_bgmEnabled) return;
  bgmStop();
  const tr = BGM_TRACKS[_bgmTrack] ?? BGM_TRACKS[0]!;
  // まず実音源(public/bgm)を再生。未配置/読込失敗時は手続き生成BGMへフォールバック。
  if (tr.file && typeof Audio !== 'undefined') {
    try {
      const audio = new Audio(tr.file);
      audio.loop = true;
      audio.volume = 0;
      _bgmAudio = audio;
      const onFail = (): void => {
        if (_bgmAudio !== audio) return;   // 既に切替済みなら何もしない（多重起動防止）
        _bgmAudio = null;
        try { audio.pause(); } catch { /**/ }
        bgmStartProcedural(tr);            // 読み込めない曲は手続き生成で代替
      };
      audio.addEventListener('error', onFail, { once: true });
      const playP = audio.play();
      if (playP && typeof playP.then === 'function') {
        playP.then(() => { if (_bgmAudio === audio) fadeAudio(audio, bgmAudioVol(), 700); }).catch(onFail);
      } else {
        fadeAudio(audio, bgmAudioVol(), 700);
      }
      return;
    } catch { /* 実音源不可 → 手続き生成へ */ }
  }
  bgmStartProcedural(tr);
}

// 手続き生成BGM（実音源フォールバック）。WebAudio オシレータで tr.seq を鳴らす。
function bgmStartProcedural(tr: BgmTrack): void {
  let ctx: AudioContext;
  try { ctx = getAudioCtx(); } catch { return; } // Audio 不可でもゲームは壊さない
  const totalBeats = tr.seq.reduce((s, [, b]) => s + b, 0);

  const masterGain = ctx.createGain();
  // 開始時はフェードイン（切替時に急に鳴り出さない）
  masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(_bgmVolume, ctx.currentTime + 0.8);
  masterGain.connect(ctx.destination);
  _bgmMaster = masterGain;
  const loopId = ++_bgmLoopId;

  // ループは「絶対オーディオ時刻」で連続スケジュールする（setTimeout のドリフトに依存しない）。
  // 各音は音長いっぱいまで鳴らし(終端でやわらかく減衰)、音間・ループ継ぎ目に無音/クリックを作らない。
  const loopDur = totalBeats * tr.beatSec;
  let nextStart = ctx.currentTime + 0.1;
  function scheduleLoop() {
    if (_bgmLoopId !== loopId) return;
    let t = nextStart;
    for (const [freq, beats, volR] of tr.seq) {
      const dur = beats * tr.beatSec;
      // 主旋律
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = tr.melody;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volR, t + 0.03);
      g.gain.setValueAtTime(volR, t + dur * 0.82);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);  // 終端まで鳴らす＝隙間を作らない
      osc.connect(g); g.connect(masterGain);
      osc.start(t); osc.stop(t + dur + 0.02);
      _bgmOscs.push(osc);
      // 低音ハーモニー（一オクターブ下、半音量）
      if (beats >= 2) {
        const bass = ctx.createOscillator();
        const bg = ctx.createGain();
        bass.type = tr.bass;
        bass.frequency.value = freq / 2;
        bg.gain.setValueAtTime(0, t);
        bg.gain.linearRampToValueAtTime(volR * 0.35, t + 0.08);
        bg.gain.linearRampToValueAtTime(0.0001, t + dur);
        bass.connect(bg); bg.connect(masterGain);
        bass.start(t); bass.stop(t + dur + 0.02);
        _bgmOscs.push(bass);
      }
      t += dur;
    }
    nextStart = t;  // 次ループは今ループの終端から連続（隙間/重なりなし）
    // ループ終端の少し前に次ループを先行スケジュール（絶対時刻なのでズレない）。
    setTimeout(scheduleLoop, Math.max(50, (loopDur - 0.25) * 1000));
  }
  scheduleLoop();
}

function bgmStop(): void {
  _bgmLoopId++;
  _bgmOscs.forEach(o => { try { o.stop(); } catch { /**/ } });
  _bgmOscs = [];
  if (_bgmMaster) { try { _bgmMaster.disconnect(); } catch { /**/ } _bgmMaster = null; }
  if (_bgmFadeTimer) { clearInterval(_bgmFadeTimer); _bgmFadeTimer = null; }
  if (_bgmAudio) {
    const a = _bgmAudio; _bgmAudio = null;
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /**/ }
  }
}

function bgmSetVolume(v: number): void {
  _bgmVolume = v;
  if (_bgmMaster) {
    try {
      const ctx = getAudioCtx();
      _bgmMaster.gain.cancelScheduledValues(ctx.currentTime);
      _bgmMaster.gain.setValueAtTime(Math.max(0.0001, v), ctx.currentTime);
    } catch { /**/ }
  }
  if (_bgmAudio && !_bgmFadeTimer) { try { _bgmAudio.volume = bgmAudioVol(); } catch { /**/ } }
}

// BGM トラックを切り替える（localStorage 保存＋再生中なら自然にフェード差し替え）。
function setBgmTrack(i: number): void {
  i = Math.max(0, Math.min(BGM_TRACKS.length - 1, i));
  saveBgmTrack(i);
  if (i === _bgmTrack) return;
  _bgmTrack = i;
  if (!_bgmEnabled) return;
  // 現行をフェードアウト → 少し後に新トラック開始（bgmStart 内で旧音源/旧オシレータは停止）。
  if (_bgmAudio) {
    fadeAudio(_bgmAudio, 0, 450);
  } else if (_bgmMaster) {
    try {
      const ctx = getAudioCtx();
      _bgmMaster.gain.cancelScheduledValues(ctx.currentTime);
      _bgmMaster.gain.setValueAtTime(_bgmMaster.gain.value, ctx.currentTime);
      _bgmMaster.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    } catch { /**/ }
  }
  setTimeout(() => bgmStart(), 500);
}

// -------------------------------------------------------
// SE: 短くシンプル、連打・鳴りすぎ防止付き
// -------------------------------------------------------
let _seEnabled = true;
let _seVolume  = 0.28;
const _seCooldown = new Map<string, number>();  // SE種別 → 最後に鳴らした時刻(ms)
const SE_MIN_INTERVAL: Record<string, number> = {
  resource: 80,   // 資源獲得は連続OK（少しずらす）
  click:    150,
  discardLose: 250, // 連続で捨てる場合にうるさくならないよう少し間隔を空ける
  default:  200,
};

export type SEType = 'click'|'dice'|'resource'|'build'|'tradeOk'|'tradeNg'|'devCard'|'robber'|'turnStart'|'victory'
  |'sevenRoll'|'discardWarn'|'discardLose'|'vpGain'|'bonusGain'|'yourTurn';

function playSE(type: SEType): void {
  if (!_seEnabled) return;
  const now = Date.now();
  const minInterval = SE_MIN_INTERVAL[type] ?? SE_MIN_INTERVAL['default'] ?? 200;
  const last = _seCooldown.get(type) ?? 0;
  if (now - last < minInterval) return;  // 間隔が短すぎる場合はスキップ
  _seCooldown.set(type, now);

  try {
    const ctx = getAudioCtx();
    const mg = ctx.createGain();
    mg.gain.value = _seVolume;
    mg.connect(ctx.destination);
    const t = ctx.currentTime;

    // ノート1個ヘルパー（attack/decay を柔らかく）
    function note(freq: number, dur: number, tp: OscillatorType = 'sine', vol = 1, delay = 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = tp; osc.frequency.value = freq;
      const s = t + delay;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + Math.min(0.03, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.001, s + dur);
      osc.connect(g); g.connect(mg);
      osc.start(s); osc.stop(s + dur + 0.01);
    }

    switch (type) {
      case 'click':
        note(900, 0.05, 'sine', 0.5);
        break;
      case 'dice':
        note(320, 0.07, 'triangle', 0.6, 0.00);
        note(420, 0.07, 'triangle', 0.5, 0.04);
        note(520, 0.10, 'triangle', 0.4, 0.08);
        break;
      case 'resource':
        note(660, 0.12, 'sine', 0.4);
        note(880, 0.10, 'sine', 0.25, 0.05);
        break;
      case 'build':
        note(440, 0.10, 'triangle', 0.55);
        note(554, 0.15, 'triangle', 0.45, 0.07);
        break;
      case 'tradeOk':
        note(523, 0.10, 'sine', 0.5, 0.00);
        note(659, 0.10, 'sine', 0.5, 0.10);
        note(784, 0.18, 'sine', 0.5, 0.20);
        break;
      case 'tradeNg':
        note(350, 0.12, 'triangle', 0.45, 0.00);
        note(280, 0.16, 'triangle', 0.35, 0.08);
        break;
      case 'devCard':
        note(587, 0.10, 'sine', 0.45, 0.00);
        note(740, 0.12, 'sine', 0.40, 0.08);
        break;
      case 'robber':
        note(220, 0.12, 'triangle', 0.5, 0.00);
        note(196, 0.20, 'triangle', 0.4, 0.10);
        break;
      case 'turnStart':
        note(523, 0.10, 'sine', 0.35);
        break;
      case 'victory': {
        // 明るいファンファーレ（上昇アルペジオ → 高音で締め）
        [523, 659, 784, 1047].forEach((f, i) => note(f, 0.32, 'triangle', 0.5, i * 0.10));
        // 締めの和音（C メジャー）
        [1047, 1319, 1568].forEach(f => note(f, 0.7, 'triangle', 0.38, 0.46));
        note(2093, 0.5, 'sine', 0.22, 0.5);
        break;
      }
      case 'sevenRoll':
        // 7（盗賊）: 少し不穏な下降音
        note(240, 0.18, 'sawtooth', 0.4, 0.00);
        note(180, 0.28, 'sawtooth', 0.32, 0.12);
        break;
      case 'discardWarn':
        // 捨て札警告: 短い2音の注意音
        note(466, 0.10, 'square', 0.3, 0.00);
        note(349, 0.16, 'square', 0.26, 0.10);
        break;
      case 'discardLose':
        // 資源を失う: 短い下降音（控えめ）
        note(392, 0.10, 'triangle', 0.38, 0.00);
        note(294, 0.16, 'triangle', 0.30, 0.07);
        break;
      case 'vpGain':
        // 得点獲得: 明るく短い2音の上昇（建設SEに少し遅れて「+点」を知らせる）
        note(784, 0.10, 'sine', 0.42, 0.00);
        note(1047, 0.16, 'sine', 0.38, 0.07);
        break;
      case 'bonusGain':
        // 称号獲得（最長交易路/最大騎士力）: 少し派手な3音ファンファーレ
        note(659, 0.14, 'triangle', 0.5, 0.00);
        note(880, 0.14, 'triangle', 0.5, 0.10);
        note(1175, 0.26, 'triangle', 0.46, 0.20);
        break;
      case 'yourTurn':
        // 自分の手番開始: やわらかい2音チャイム（他人の手番開始と区別）
        note(660, 0.10, 'sine', 0.4, 0.00);
        note(990, 0.16, 'sine', 0.36, 0.08);
        break;
    }
  } catch { /* ignore */ }
}

// ---- 公開API（main.ts の設定UI・dispatch から使用）----
export function isBgmEnabled(): boolean { return _bgmEnabled; }
export function setBgmEnabled(v: boolean): void { _bgmEnabled = v; }
export function getBgmVolume(): number { return _bgmVolume; }
export function getBgmTrack(): number { return _bgmTrack; }
export function isSeEnabled(): boolean { return _seEnabled; }
export function setSeEnabled(v: boolean): void { _seEnabled = v; }
export { playSE, bgmStart, bgmStop, bgmSetVolume, setBgmTrack, BGM_TRACKS };
