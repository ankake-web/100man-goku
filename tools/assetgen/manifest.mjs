// 100万石 アセット生成マニフェスト
// 正典: docs/reskin/ART_ASSET_SPEC.md（ファイル名・寸法・透過・英語プロンプトはこの表に準拠）
// 生成は「STYLE_PREFIX（共通画風）＋ subject（各主題）」で組む。

// 共通スタイル接頭辞 ＝ 既存アート（src/assets / dist/assets）に寄せた
// 「ツヤのある半リアル3Dレンダーのゲームアイコン」。カタン／Clash系の質感リッチなアイコン調。
// ※ 透過はネイティブに出ないため「無地のうすい単色背景」で出させ、後段で背景除去する。
export const STYLE_PREFIX = [
  'high-quality 3D rendered game icon, CGI octane/redshift render, smooth volumetric three-dimensional forms',
  'with real depth and soft global illumination, clean SMOOTH simplified surfaces with minimal texture and grain,',
  'glossy soft specular highlights, studio lighting,',
  'looks like a polished stylized 3D model (NOT a 2D drawing, NOT a painting, NOT photorealistic, NOT flat),',
  'mobile-game asset style like Settlers-of-Catan / Clash-of-Clans resource icons,',
  'simple clean rounded shapes, few elements, rich but balanced colors, bold clean readable silhouette, three-quarter view to show depth,',
  'Japanese Sengoku-era (16th century) theme,',
  'single centered object, plain solid pure white background, subtle soft contact shadow beneath,',
  'crisp, premium, no text, no letters, no labels',
].join(' ');

// 盤上の駒（§4）に付ける視点指定（盤に並べたとき統一感を出す）
export const PIECE_SUFFIX =
  'Rendered as a small tabletop game piece, isometric slight top-down view, consistent soft light from the upper-left.';

// 背景（§9.1・横長JPG）用の接頭辞
export const BG_PREFIX = [
  'wide cinematic 16:9 background illustration,',
  'cute 3D diorama / miniature-model style, soft shadows,',
  'Japanese Sengoku-era (16th century) theme, no text, no letters.',
].join(' ');

// プレイヤー色（内部キー固定）→ 旗/幕の差し色（英語表現）
const COLOR_BANNER = {
  red: 'a crimson-red (朱)',
  blue: 'an indigo-blue (藍)',
  purple: 'a purple (紫)',
  orange: 'a golden-yellow / yamabuki (山吹)',
};
const COLORS = ['red', 'blue', 'purple', 'orange'];

// 駒の色別バリエーションを展開するヘルパ
// generic=true なら無印（色なし）も先頭に追加する。
function piece(key, subject, size, { generic = false } = {}) {
  const out = [];
  if (generic) out.push({ key, subject, size, group: 'pieces', kind: 'piece' });
  for (const c of COLORS) {
    out.push({
      key: `${key}-${c}`,
      subject: `${subject}, flying ${COLOR_BANNER[c]} war banner`,
      size,
      group: 'pieces',
      kind: 'piece',
    });
  }
  return out;
}

// 個別アイコン定義（kind 既定: 'icon' / ext 既定: png / transparent 既定: true）
export const ITEMS = [
  // --- §2 資源5（256・透過PNG）---
  { key: 'res-lumber', group: 'resources', size: 256, subject: 'a stack of cut timber logs, rope-tied lumber' },
  { key: 'res-brick', group: 'resources', size: 256, subject: 'a stack of quarried rectangular building stones for a castle wall' },
  { key: 'res-wool', group: 'resources', size: 256, subject: 'a single brown horse standing alone in profile, calm and riderless, just the horse animal by itself with only a simple bridle, absolutely no rider and no people on or near it, natural brown coat' },
  { key: 'res-grain', group: 'resources', size: 256, subject: 'a neat tidy bundle of golden rice ears (a clean orderly rice sheaf tied with cord)' },
  { key: 'res-ore', group: 'resources', size: 256, subject: 'a chunk of raw iron and a tamahagane steel ingot, dark heavy metal' },

  // --- §3 物産3（256・透過PNG）---
  { key: 'com-paper', group: 'products', size: 256, subject: 'a neat bundle of stacked rectangular sheets of washi paper, tied with a cord' },
  { key: 'com-cloth', group: 'products', size: 256, subject: 'a neatly rolled bolt of fine silk fabric (a rolled tanmono roll) with an elegant sheen' },
  { key: 'com-coin', group: 'products', size: 256, subject: 'a small pile of oval Japanese koban gold coins (flat oval koban shape, not round western coins), Sengoku-era gold' },

  // --- §4.1 駒（砦/城/船・384、天守・256）色別 ---
  ...piece('settlement', 'a small wooden Japanese stockade fort with a watchtower and a palisade', 384, { generic: true }),
  ...piece('city', 'a Japanese castle with a white keep on a stone base', 384, { generic: true }),
  ...piece('ship', 'a Japanese atakebune wooden warship with a plain blank sail (no writing, no kanji, no symbols on the sail)', 384),
  ...piece('metropolis', 'a grand multi-tiered castle tenshu keep', 256),

  // --- §4.2 城下と武将コマ ---
  { key: 'metropolis-gate', group: 'ck', size: 256, kind: 'piece', subject: 'an ornate castle gate and yagura turret with gold accents' },
  { key: 'city-wall', group: 'ck', size: 256, kind: 'piece', subject: 'a curved stone castle rampart (ishigaki) section' },
  { key: 'knight-basic', group: 'ck', size: 256, kind: 'piece', subject: 'a foot soldier (ashigaru) holding a spear, light armor' },
  { key: 'knight-strong', group: 'ck', size: 256, kind: 'piece', subject: 'a samurai in full armor holding a katana' },
  { key: 'knight-mighty', group: 'ck', size: 256, kind: 'piece', subject: 'an elite samurai general in ornate o-yoroi armor with a helmet crest' },
  { key: 'merchant', group: 'ck', size: 256, kind: 'piece', subject: 'a traveling merchant carrying a goods box, unarmed and gentle' },
  { key: 'robber', group: 'ck', size: 384, kind: 'piece', subject: 'a masked bandit (nobushi) crouching, ragged clothes' },
  { key: 'pirate', group: 'ck', size: 384, kind: 'piece', subject: 'a Sengoku sea pirate (Murakami suigun) with a banner' },
  { key: 'barbarian-ship', group: 'ck', size: 256, kind: 'piece', subject: 'a ragtag peasant-rebel (ikki) boat crowded with fighters holding bamboo spears' },
  { key: 'defender-badge', group: 'ck', size: 256, subject: 'a heraldic defender medallion / war-merit badge, gold, family-crest style' },

  // --- §4.3 武将アクション・アイコン ---
  { key: 'knight-activate', group: 'knight-actions', size: 256, subject: 'a war drum and a commander’s baton (saihai), a sense of sortie' },
  { key: 'knight-upgrade', group: 'knight-actions', size: 256, subject: 'an upgraded samurai helmet with a new crest and an upward rank-up arrow' },

  // --- §5 改良建築6（256・透過PNG）---
  { key: 'bld-trading-house', group: 'buildings', size: 256, subject: 'a merchant trading house with a noren curtain and a market stall' },
  { key: 'bld-bank', group: 'buildings', size: 256, subject: 'a money-changer’s storehouse (kura) with gold chests' },
  { key: 'bld-fortress', group: 'buildings', size: 256, subject: 'a fortified outpost castle with palisades and a tower' },
  { key: 'bld-cathedral', group: 'buildings', size: 256, subject: 'a grand Buddhist temple hall (garan) with a sweeping roof' },
  { key: 'bld-aqueduct', group: 'buildings', size: 256, subject: 'a wooden water aqueduct and irrigation sluice' },
  { key: 'bld-theater', group: 'buildings', size: 256, subject: 'a Noh theatre stage with a painted pine backdrop' },

  // --- §6.1 トラック・アイコン3 ---
  { key: 'track-trade', group: 'tracks', size: 256, subject: 'a balance scale and an abacus, commerce, warm gold tone' },
  { key: 'track-politics', group: 'tracks', size: 256, subject: 'just two objects lying together: a Japanese commander’s round oval signaling war-fan (gunbai, a paddle-shaped fan) and a red official seal stamp, indigo and gold tone, only these objects and absolutely no warrior or person' },
  { key: 'track-science', group: 'tracks', size: 256, subject: 'just two objects: a single rolled paper scroll that is completely blank with no writing, and a calligraphy brush lying beside it, green tone, no text and no symbols on the scroll' },

  // --- §6.2 カード裏3 ---
  { key: 'card-back-trade', group: 'card-backs', size: 256, subject: 'a card back: gold ornament, a commerce crest, washi paper texture' },
  { key: 'card-back-politics', group: 'card-backs', size: 256, subject: 'a card back: indigo ornament, a government crest, washi paper texture' },
  { key: 'card-back-science', group: 'card-backs', size: 256, subject: 'a card back: green ornament, a strategy crest, washi paper texture' },

  // --- §7.1 政策デッキ9 ---
  { key: 'card-pol-bishop', group: 'cards-pol', size: 256, subject: 'an alms-soliciting Buddhist monk (kanjin) with a bowl and prayer beads' },
  { key: 'card-pol-diplomat', group: 'cards-pol', size: 256, subject: 'two warlords making a truce, handing over a letter' },
  { key: 'card-pol-intrigue', group: 'cards-pol', size: 256, subject: 'two samurai conspiring secretly in the shadows, one leaning in close to whisper a scheme into the other’s ear, hushed conspiratorial plotting' },
  { key: 'card-pol-deserter', group: 'cards-pol', size: 256, subject: 'a samurai soldier switching sides, running away from his own war banner toward the enemy camp while glancing back over his shoulder, a clear act of defection and betrayal' },
  { key: 'card-pol-warlord', group: 'cards-pol', size: 256, subject: 'a war-drum muster calling all troops to sortie' },
  { key: 'card-pol-spy', group: 'cards-pol', size: 256, subject: 'a covert spy / ninja (kanja) moving stealthily in the dark' },
  { key: 'card-pol-saboteur', group: 'cards-pol', size: 256, subject: 'a night fire-raid burning an enemy storehouse' },
  { key: 'card-pol-wedding', group: 'cards-pol', size: 256, subject: 'a political marriage ceremony, formal kimono' },
  { key: 'card-pol-constitution', group: 'cards-pol', size: 256, subject: 'a proclaimed domain-law (bunkokuho) document with a seal' },

  // --- §7.2 兵学デッキ10 ---
  { key: 'card-sci-alchemist', group: 'cards-sci', size: 256, subject: 'an onmyoji diviner with mystic dice and paper talismans' },
  { key: 'card-sci-crane', group: 'cards-sci', size: 256, subject: 'a master carpenter foreman (toryo) at a building site, plans in hand' },
  { key: 'card-sci-engineer', group: 'cards-sci', size: 256, subject: 'a stonemason building a castle stone wall (ishigaki)' },
  { key: 'card-sci-inventor', group: 'cards-sci', size: 256, subject: 'a top-down castle ground-plan blueprint drawn on washi paper with measuring stakes, ropes and a brush laid on it — only the castle LAYOUT PLAN on paper, NOT a finished or built castle' },
  { key: 'card-sci-irrigation', group: 'cards-sci', size: 256, subject: 'irrigated rice paddies with water channels' },
  { key: 'card-sci-medicine', group: 'cards-sci', size: 256, subject: 'a Sengoku physician with an herbal medicine box' },
  { key: 'card-sci-mining', group: 'cards-sci', size: 256, subject: 'a mine shaft with ore, miners and lanterns' },
  { key: 'card-sci-road-building', group: 'cards-sci', size: 256, subject: 'corvee laborers building a road and embankment (fushin)' },
  { key: 'card-sci-smith', group: 'cards-sci', size: 256, subject: 'a swordsmith forging a katana at an anvil with sparks' },
  { key: 'card-sci-printer', group: 'cards-sci', size: 256, subject: 'an open formal honor certificate document (a letter of commendation) on washi paper, laid out flat and legible, with a bright red round wax seal and a ribbon, elegant' },

  // --- §7.3 商策デッキ6 ---
  { key: 'card-com-merchant', group: 'cards-com', size: 256, subject: 'a licensed purveyor merchant setting up his market stall' },
  { key: 'card-com-merchant-fleet', group: 'cards-com', size: 256, subject: 'a fleet of cargo trading ships (kaisen)' },
  { key: 'card-com-master-merchant', group: 'cards-com', size: 256, subject: 'a wealthy great merchant (gosho) with ledgers and gold' },
  { key: 'card-com-commercial-harbor', group: 'cards-com', size: 256, subject: 'a lively free market (rakuichi) with stalls and crates' },
  { key: 'card-com-resource-monopoly', group: 'cards-com', size: 256, subject: 'officials levying and collecting rice tax from peasants' },
  { key: 'card-com-trade-monopoly', group: 'cards-com', size: 256, subject: 'a port checkpoint barrier (sekisho) levying passing goods' },

  // --- §8 アクション・アイコン3 ---
  { key: 'road', group: 'actions', size: 256, subject: 'a built road / wooden path segment, seen from top-down' },
  { key: 'bank-trade', group: 'actions', size: 256, subject: 'exchanging coins for rice bales at a money-changer’s table' },
  { key: 'player-trade', group: 'actions', size: 256, subject: 'two merchants exchanging goods, a friendly handshake of trade' },

  // --- §9.2 装飾枠（512・透過PNG・中央は空ける／自動背景除去はしない）---
  { key: 'frame-decorative', group: 'frame', size: 512, bgremove: false,
    subject: 'an ornate Japanese gold border frame, karakusa arabesque, with a completely empty hollow center' },

  // --- §9.1 背景3（1024x576・不透明JPG・16:9）---
  { key: 'bg-title', group: 'backgrounds', kind: 'bg', width: 1024, height: 576, aspect: '16:9', ext: 'jpg', transparent: false,
    subject: 'a wide Sengoku landscape, a castle town below mountains at dawn' },
  { key: 'bg-victory', group: 'backgrounds', kind: 'bg', width: 1024, height: 576, aspect: '16:9', ext: 'jpg', transparent: false,
    subject: 'a victorious castle keep with banners flying, golden sunset, triumphant mood' },
  { key: 'bg-barbarian', group: 'backgrounds', kind: 'bg', width: 1024, height: 576, aspect: '16:9', ext: 'jpg', transparent: false,
    subject: 'a night raid: a peasant ikki mob with torches approaching a castle, ominous mood' },
];

// 「物だけ（人物NG）」にすべき素材の判定。
// 資源・物産・建物・トラック・カード裏・操作アイコン・装飾枠・武将アクション(太鼓/兜)・
// 構造物の駒(砦/城/船/天守/門/石垣/街道/勲章)は“物”。武将/商人/野盗/海賊/一揆船はキャラOK。
// 進歩カード(cards-*)は人物を含む画も多いのでキャラ許容（個別に noPeople 指定可）。
const OBJECT_GROUPS = new Set(['resources', 'products', 'buildings', 'tracks', 'card-backs', 'actions', 'frame', 'knight-actions']);
function isObjectSubject(it) {
  if (OBJECT_GROUPS.has(it.group)) return true;
  if (it.group === 'pieces' || it.group === 'ck') {
    return !/^(knight|merchant|robber|pirate|barbarian)/.test(it.key);
  }
  return false;
}

// 既定値を補完したアイテム配列
export const ASSETS = ITEMS.map((it) => ({
  kind: 'icon',
  ext: 'png',
  transparent: true,
  aspect: '1:1',
  noPeople: isObjectSubject(it),
  ...it,
}));

// グループ一覧（出力順 ＝ ART_ASSET_SPEC.md §10 推奨制作順）
export const GROUP_ORDER = [
  'resources', 'products', 'pieces', 'ck', 'knight-actions',
  'backgrounds', 'tracks', 'card-backs', 'buildings',
  'cards-pol', 'cards-sci', 'cards-com', 'actions', 'frame',
];

// 試作の既定グループ（まず画風確認用：資源5＋物産3）
export const DEFAULT_GROUPS = ['resources', 'products'];

// 「物だけ」を強制する一文（人物・キャラの混入を防ぐ）
const NO_PEOPLE = 'Show ONLY the inanimate object itself as a product shot — absolutely no people, no characters, no human or mascot figures, no faces.';

// 指定アイテムの最終プロンプトを組み立てる
export function buildPrompt(item) {
  if (item.kind === 'bg') return `${BG_PREFIX}\nScene: ${item.subject}.`;
  const head = item.kind === 'piece' ? `${STYLE_PREFIX}\n${PIECE_SUFFIX}` : STYLE_PREFIX;
  const tail = item.noPeople ? `\n${NO_PEOPLE}` : '';
  return `${head}\nSubject: ${item.subject}.${tail}`;
}
