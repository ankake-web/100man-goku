export const meta = {
  name: 'review-sengoku-assets',
  description: 'Parallel QA of 82 generated Sengoku game-icon images; returns keep/regen verdicts with reasons',
  phases: [{ title: 'Evaluate', detail: 'parallel reviewers each view a batch of images' }],
}

const outDir = 'C:/Users/b1242/claude/game/100man-goku/tools/assetgen/out';
const refDir = 'C:/Users/b1242/claude/game/100man-goku/src/assets';

const items = [
  { key: 'res-lumber', ext: 'png', noPeople: true, subject: 'a stack of cut timber logs, rope-tied lumber' },
  { key: 'res-brick', ext: 'png', noPeople: true, subject: 'a stack of quarried rectangular building stones for a castle wall' },
  { key: 'res-wool', ext: 'png', noPeople: true, subject: 'a single riderless full-body Japanese warhorse standing in profile (no rider, empty saddle), natural brown coat' },
  { key: 'res-grain', ext: 'png', noPeople: true, subject: 'a neat tidy bundle of golden rice ears (clean orderly rice sheaf tied with cord)' },
  { key: 'res-ore', ext: 'png', noPeople: true, subject: 'a chunk of raw iron and a tamahagane steel ingot, dark heavy metal' },
  { key: 'com-paper', ext: 'png', noPeople: true, subject: 'a neat bundle of stacked rectangular sheets of washi paper, tied with a cord' },
  { key: 'com-cloth', ext: 'png', noPeople: true, subject: 'a neatly rolled bolt of fine silk fabric (rolled tanmono)' },
  { key: 'com-coin', ext: 'png', noPeople: true, subject: 'a small pile of oval Japanese koban gold coins (flat oval shape)' },
  { key: 'settlement', ext: 'png', noPeople: true, subject: 'a small wooden Japanese stockade fort with a watchtower and palisade' },
  { key: 'settlement-red', ext: 'png', noPeople: true, subject: 'a small wooden Japanese stockade fort with a watchtower, flying a crimson-red war banner' },
  { key: 'settlement-blue', ext: 'png', noPeople: true, subject: 'a small wooden Japanese stockade fort, flying an indigo-blue war banner' },
  { key: 'settlement-purple', ext: 'png', noPeople: true, subject: 'a small wooden Japanese stockade fort, flying a purple war banner' },
  { key: 'settlement-orange', ext: 'png', noPeople: true, subject: 'a small wooden Japanese stockade fort, flying a golden-yellow (yamabuki) war banner' },
  { key: 'city', ext: 'png', noPeople: true, subject: 'a Japanese castle with a white keep on a stone base' },
  { key: 'city-red', ext: 'png', noPeople: true, subject: 'a Japanese castle with white keep, flying a crimson-red war banner' },
  { key: 'city-blue', ext: 'png', noPeople: true, subject: 'a Japanese castle with white keep, flying an indigo-blue war banner' },
  { key: 'city-purple', ext: 'png', noPeople: true, subject: 'a Japanese castle with white keep, flying a purple war banner' },
  { key: 'city-orange', ext: 'png', noPeople: true, subject: 'a Japanese castle with white keep, flying a golden-yellow (yamabuki) war banner' },
  { key: 'ship-red', ext: 'png', noPeople: true, subject: 'a Japanese atakebune wooden warship with a sail, crimson-red banner' },
  { key: 'ship-blue', ext: 'png', noPeople: true, subject: 'a Japanese atakebune wooden warship with a sail, indigo-blue banner' },
  { key: 'ship-purple', ext: 'png', noPeople: true, subject: 'a Japanese atakebune wooden warship with a sail, purple banner' },
  { key: 'ship-orange', ext: 'png', noPeople: true, subject: 'a Japanese atakebune wooden warship with a sail, golden-yellow banner' },
  { key: 'metropolis-red', ext: 'png', noPeople: true, subject: 'a grand multi-tiered castle tenshu keep, crimson-red banner' },
  { key: 'metropolis-blue', ext: 'png', noPeople: true, subject: 'a grand multi-tiered castle tenshu keep, indigo-blue banner' },
  { key: 'metropolis-purple', ext: 'png', noPeople: true, subject: 'a grand multi-tiered castle tenshu keep, purple banner' },
  { key: 'metropolis-orange', ext: 'png', noPeople: true, subject: 'a grand multi-tiered castle tenshu keep, golden-yellow banner' },
  { key: 'metropolis-gate', ext: 'png', noPeople: true, subject: 'an ornate castle gate and yagura turret with gold accents' },
  { key: 'city-wall', ext: 'png', noPeople: true, subject: 'a curved stone castle rampart (ishigaki) section' },
  { key: 'knight-basic', ext: 'png', noPeople: false, subject: 'a foot soldier (ashigaru) holding a spear, light armor' },
  { key: 'knight-strong', ext: 'png', noPeople: false, subject: 'a samurai in full armor holding a katana' },
  { key: 'knight-mighty', ext: 'png', noPeople: false, subject: 'an elite samurai general in ornate o-yoroi armor with a helmet crest' },
  { key: 'merchant', ext: 'png', noPeople: false, subject: 'a traveling merchant carrying a goods box, unarmed and gentle' },
  { key: 'robber', ext: 'png', noPeople: false, subject: 'a masked bandit (nobushi) crouching, ragged clothes' },
  { key: 'pirate', ext: 'png', noPeople: false, subject: 'a Sengoku sea pirate (Murakami suigun) with a banner' },
  { key: 'barbarian-ship', ext: 'png', noPeople: false, subject: 'a ragtag peasant-rebel (ikki) boat crowded with fighters holding bamboo spears' },
  { key: 'defender-badge', ext: 'png', noPeople: true, subject: 'a heraldic defender medallion / war-merit badge, gold, family-crest style' },
  { key: 'knight-activate', ext: 'png', noPeople: true, subject: "a war drum and a commander's baton (saihai)" },
  { key: 'knight-upgrade', ext: 'png', noPeople: true, subject: 'an upgraded samurai helmet with a new crest and an upward rank-up arrow' },
  { key: 'bld-trading-house', ext: 'png', noPeople: true, subject: 'a merchant trading house with a noren curtain and a market stall' },
  { key: 'bld-bank', ext: 'png', noPeople: true, subject: "a money-changer's storehouse (kura) with gold chests" },
  { key: 'bld-fortress', ext: 'png', noPeople: true, subject: 'a fortified outpost castle with palisades and a tower' },
  { key: 'bld-cathedral', ext: 'png', noPeople: true, subject: 'a grand Buddhist temple hall (garan) with a sweeping roof' },
  { key: 'bld-aqueduct', ext: 'png', noPeople: true, subject: 'a wooden water aqueduct and irrigation sluice' },
  { key: 'bld-theater', ext: 'png', noPeople: true, subject: 'a Noh theatre stage with a painted pine backdrop' },
  { key: 'track-trade', ext: 'png', noPeople: true, subject: 'a balance scale and an abacus, commerce, warm gold tone' },
  { key: 'track-politics', ext: 'png', noPeople: true, subject: "a commander's war-fan (gunbai) and an official seal, indigo tone" },
  { key: 'track-science', ext: 'png', noPeople: true, subject: 'a scroll of military strategy and a brush, green tone' },
  { key: 'card-back-trade', ext: 'png', noPeople: true, subject: 'a card back: gold ornament, a commerce crest, washi paper texture' },
  { key: 'card-back-politics', ext: 'png', noPeople: true, subject: 'a card back: indigo ornament, a government crest, washi texture' },
  { key: 'card-back-science', ext: 'png', noPeople: true, subject: 'a card back: green ornament, a strategy crest, washi texture' },
  { key: 'card-pol-bishop', ext: 'png', noPeople: false, subject: 'an alms-soliciting Buddhist monk (kanjin) with a bowl and prayer beads' },
  { key: 'card-pol-diplomat', ext: 'png', noPeople: false, subject: 'two warlords making a truce, handing over a letter' },
  { key: 'card-pol-intrigue', ext: 'png', noPeople: false, subject: 'a strategist winning an enemy over in a secret scheme' },
  { key: 'card-pol-deserter', ext: 'png', noPeople: false, subject: 'an enemy soldier defecting, turning his coat' },
  { key: 'card-pol-warlord', ext: 'png', noPeople: false, subject: 'a war-drum muster calling all troops to sortie' },
  { key: 'card-pol-spy', ext: 'png', noPeople: false, subject: 'a covert spy / ninja (kanja) moving stealthily in the dark' },
  { key: 'card-pol-saboteur', ext: 'png', noPeople: false, subject: 'a night fire-raid burning an enemy storehouse' },
  { key: 'card-pol-wedding', ext: 'png', noPeople: false, subject: 'a political marriage ceremony, formal kimono' },
  { key: 'card-pol-constitution', ext: 'png', noPeople: false, subject: 'a proclaimed domain-law document with a seal' },
  { key: 'card-sci-alchemist', ext: 'png', noPeople: false, subject: 'an onmyoji diviner with mystic dice and paper talismans' },
  { key: 'card-sci-crane', ext: 'png', noPeople: false, subject: 'a master carpenter foreman (toryo) at a building site' },
  { key: 'card-sci-engineer', ext: 'png', noPeople: false, subject: 'a stonemason building a castle stone wall (ishigaki)' },
  { key: 'card-sci-inventor', ext: 'png', noPeople: false, subject: 'a castle-layout planner (nawabari) with a plan, stakes and ropes' },
  { key: 'card-sci-irrigation', ext: 'png', noPeople: false, subject: 'irrigated rice paddies with water channels' },
  { key: 'card-sci-medicine', ext: 'png', noPeople: false, subject: 'a Sengoku physician with an herbal medicine box' },
  { key: 'card-sci-mining', ext: 'png', noPeople: false, subject: 'a mine shaft with ore, miners and lanterns' },
  { key: 'card-sci-road-building', ext: 'png', noPeople: false, subject: 'corvee laborers building a road and embankment (fushin)' },
  { key: 'card-sci-smith', ext: 'png', noPeople: false, subject: 'a swordsmith forging a katana at an anvil with sparks' },
  { key: 'card-sci-printer', ext: 'png', noPeople: false, subject: 'a letter of commendation for valor (kanjo) with a red seal' },
  { key: 'card-com-merchant', ext: 'png', noPeople: false, subject: 'a licensed purveyor merchant setting up his market stall' },
  { key: 'card-com-merchant-fleet', ext: 'png', noPeople: false, subject: 'a fleet of cargo trading ships (kaisen)' },
  { key: 'card-com-master-merchant', ext: 'png', noPeople: false, subject: 'a wealthy great merchant (gosho) with ledgers and gold' },
  { key: 'card-com-commercial-harbor', ext: 'png', noPeople: false, subject: 'a lively free market (rakuichi) with stalls and crates' },
  { key: 'card-com-resource-monopoly', ext: 'png', noPeople: false, subject: 'officials levying and collecting rice tax from peasants' },
  { key: 'card-com-trade-monopoly', ext: 'png', noPeople: false, subject: 'a port checkpoint barrier (sekisho) levying passing goods' },
  { key: 'road', ext: 'png', noPeople: true, subject: 'a built road / wooden path segment, seen from top-down' },
  { key: 'bank-trade', ext: 'png', noPeople: true, subject: "coins and rice bales on a money-changer's exchange table (objects only, no people)" },
  { key: 'player-trade', ext: 'png', noPeople: true, subject: 'goods being exchanged, a handshake of trade' },
  { key: 'frame-decorative', ext: 'png', noPeople: true, subject: 'an ornate Japanese gold border frame, karakusa arabesque, empty hollow center' },
  { key: 'bg-title', ext: 'jpg', noPeople: false, subject: 'a wide Sengoku landscape, a castle town below mountains at dawn' },
  { key: 'bg-victory', ext: 'jpg', noPeople: false, subject: 'a victorious castle keep with banners flying, golden sunset' },
  { key: 'bg-barbarian', ext: 'jpg', noPeople: false, subject: 'a night raid: a peasant ikki mob with torches approaching a castle' },
];

const BATCH = 7;
const batches = [];
for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          verdict: { type: 'string', enum: ['keep', 'regen'] },
          severity: { type: 'string', enum: ['ok', 'minor', 'major'] },
          issue: { type: 'string', description: 'short concrete issue, or "good" if keep' },
        },
        required: ['key', 'verdict', 'severity', 'issue'],
      },
    },
  },
  required: ['verdicts'],
};

const RUBRIC = [
  'TARGET STYLE: a glossy, semi-realistic 3D-RENDERED mobile-game icon (like Settlers of Catan / Clash of Clans).',
  'Smooth dimensional forms, soft studio highlights, clean readable silhouette, single centered subject.',
  'A plain WHITE background is intentional and correct here — never flag white background.',
  '',
  'For EACH item: use the Read tool to VIEW the generated image at its "generated" path.',
  'You MAY also Read the "reference" image to calibrate the target rendering style — the reference shows a',
  'possibly-different/older SUBJECT but the SAME glossy 3D rendering style we are matching; judge STYLE family, not subject sameness.',
  '',
  'Mark verdict "regen" ONLY for a clear problem:',
  ' - STYLE: looks flat 2D / a sketch / a photo / cartoonish-wrong, not a polished 3D-rendered icon.',
  ' - SUBJECT: does not clearly read as the intended subject, or depicts the wrong thing.',
  ' - DRIFT: noPeople=true but a person/character/face appears (object icons must have NO people).',
  ' - BROKEN: messy/cluttered, deformed, duplicated subject, gibberish text or letters baked in.',
  'Otherwise verdict "keep". Minor stylistic nits = keep (severity "minor"). Good = severity "ok".',
  'Return exactly one verdict object for every key in your batch.',
].join('\n');

function promptFor(batch) {
  const lines = batch.map((it) =>
    [
      `key: ${it.key}  (noPeople: ${it.noPeople})`,
      `  intended subject: ${it.subject}`,
      `  generated: ${outDir}/${it.key}.${it.ext}`,
      `  reference(style only): ${refDir}/${it.key}.${it.ext}`,
    ].join('\n')
  ).join('\n\n');
  return `You are a meticulous game-art QA reviewer.\n\n${RUBRIC}\n\nEvaluate these ${batch.length} items:\n\n${lines}`;
}

const results = await parallel(
  batches.map((b, i) => () =>
    agent(promptFor(b), { label: `eval-${i + 1}/${batches.length}`, phase: 'Evaluate', schema: SCHEMA })
  )
);

const verdicts = results.filter(Boolean).flatMap((r) => r.verdicts || []);
const regen = verdicts.filter((v) => v.verdict === 'regen');
log(`評価完了: ${verdicts.length}件 / 再生成候補 ${regen.length}件`);
return {
  total: verdicts.length,
  keep: verdicts.filter((v) => v.verdict === 'keep').length,
  regen,
  all: verdicts,
};
