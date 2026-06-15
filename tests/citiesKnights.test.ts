// ============================================================
// tests/citiesKnights.test.ts — 騎士と商人(Cities & Knights) フェーズ1: 都市産出
// ============================================================

import { describe, it, expect } from 'vitest';
import { computeCkProduction } from '../src/engine/citiesKnights';
import { makeGameState, makePlayer } from './helpers';
import { makeHand } from '../src/constants';
import type { GameState, TileType, BuildingType, PlayerId } from '../src/types';

// 1つのタイルだけ出目8にして（他は number=null）、その頂点に建物を置いた状態を作る。
function oneTile(type: TileType, buildings: Array<[idx: number, b: BuildingType, p: PlayerId]>): GameState {
  const g = makeGameState({
    players: {
      player1: makePlayer('player1'),
      player2: makePlayer('player2'),
    },
    playerOrder: ['player1', 'player2'],
  });
  const tid = Object.keys(g.tileToVertices).find(t => (g.tileToVertices[t]?.length ?? 0) >= 3)!;
  const vids = g.tileToVertices[tid]!;
  const tiles = Object.fromEntries(
    Object.entries(g.tiles).map(([id, t]) =>
      [id, id === tid ? { ...t, type, number: 8, hasRobber: false } : { ...t, number: null }]),
  );
  const vertices = { ...g.vertices };
  for (const [idx, b, p] of buildings) {
    const vid = vids[idx]!;
    vertices[vid] = { ...g.vertices[vid]!, building: { type: b, playerId: p } };
  }
  return { ...g, tiles, vertices } as GameState;
}

describe('C&K 都市産出 computeCkProduction', () => {
  it('都市(森)=木1+紙1、開拓地(森)=木1のみ', () => {
    const s = oneTile('forest', [[0, 'city', 'player1'], [1, 'settlement', 'player2']]);
    const prod = computeCkProduction(s, 8);
    expect(prod.resources.player1).toEqual({ wood: 1 });
    expect(prod.commodities.player1).toEqual({ paper: 1 });
    expect(prod.resources.player2).toEqual({ wood: 1 });
    expect(prod.commodities.player2).toBeUndefined(); // 開拓地は商品を産まない
  });

  it('都市(牧草)=羊1+布1 / 都市(山)=鉱石1+金貨1', () => {
    const pasture = computeCkProduction(oneTile('pasture', [[0, 'city', 'player1']]), 8);
    expect(pasture.resources.player1).toEqual({ wool: 1 });
    expect(pasture.commodities.player1).toEqual({ cloth: 1 });

    const mountain = computeCkProduction(oneTile('mountain', [[0, 'city', 'player1']]), 8);
    expect(mountain.resources.player1).toEqual({ ore: 1 });
    expect(mountain.commodities.player1).toEqual({ coin: 1 });
  });

  it('都市(丘/畑)=資源2で商品なし', () => {
    const hill = computeCkProduction(oneTile('hill', [[0, 'city', 'player1']]), 8);
    expect(hill.resources.player1).toEqual({ brick: 2 });
    expect(hill.commodities.player1).toBeUndefined();

    const field = computeCkProduction(oneTile('field', [[0, 'city', 'player1']]), 8);
    expect(field.resources.player1).toEqual({ grain: 2 });
    expect(field.commodities.player1).toBeUndefined();
  });

  it('7は産出なし', () => {
    const s = oneTile('forest', [[0, 'city', 'player1']]);
    expect(computeCkProduction(s, 7)).toEqual({ resources: {}, commodities: {} });
  });

  it('盗賊のいるタイルは資源も商品も産出しない', () => {
    const s = oneTile('forest', [[0, 'city', 'player1']]);
    const tid = Object.keys(s.tiles).find(t => s.tiles[t]!.number === 8)!;
    const s2 = { ...s, tiles: { ...s.tiles, [tid]: { ...s.tiles[tid]!, hasRobber: true } } };
    expect(computeCkProduction(s2, 8)).toEqual({ resources: {}, commodities: {} });
  });

  it('資源はバンク枯渇ルールを適用（複数需要が在庫超なら配布なし／商品は在庫十分なら配布）', () => {
    // 山タイルに player1/player2 の都市 → 各 鉱石1＋金貨1。ore 需要 1+1=2 を bank.ore=1 にすると
    // 複数需要が在庫超 → ore は誰も貰えない。商品(金貨)は既定の在庫が十分なので両者とも貰える。
    const s0 = oneTile('mountain', [[0, 'city', 'player1'], [1, 'city', 'player2']]);
    const s = { ...s0, bank: makeHand({ ore: 1, wood: 9, brick: 9, wool: 9, grain: 9 }) };
    const prod = computeCkProduction(s, 8);
    expect(prod.resources.player1).toBeUndefined();
    expect(prod.resources.player2).toBeUndefined();
    expect(prod.commodities.player1).toEqual({ coin: 1 });
    expect(prod.commodities.player2).toEqual({ coin: 1 });
  });

  it('商品も枯渇ルールを適用（複数需要が商品在庫超なら配布なし）', () => {
    // 金貨(coin)の在庫を1にすると、coin 需要 1+1=2 > 1 で複数需要在庫超 → 誰も金貨を貰えない。
    const s0 = oneTile('mountain', [[0, 'city', 'player1'], [1, 'city', 'player2']]);
    const s = { ...s0, commodityBank: { coin: 1, cloth: 19, paper: 19 } };
    const prod = computeCkProduction(s, 8);
    expect(prod.commodities.player1).toBeUndefined();
    expect(prod.commodities.player2).toBeUndefined();
  });
});

describe('C&K 統合: フルCPU対戦が拡張機構を使って完走する', () => {
  it('改善・騎士・蛮族が発生し、勝者が13点に到達して GAME_OVER', async () => {
    const { createInitialGameState } = await import('../src/engine/createState');
    const { chooseAction } = await import('../src/engine/ai');
    const { applyAction } = await import('../src/engine/game');
    const { createRng } = await import('../src/engine/setup');
    const { calcVP } = await import('../src/engine/scoring');
    const { findPendingDiscarder } = await import('../src/engine/robber');
    const specs = [
      { id: 'player1' as const, name: 'A', color: 'red' as const,    type: 'ai' as const, aiDifficulty: 'strong' as const },
      { id: 'player2' as const, name: 'B', color: 'blue' as const,   type: 'ai' as const, aiDifficulty: 'strong' as const },
      { id: 'player3' as const, name: 'C', color: 'purple' as const, type: 'ai' as const, aiDifficulty: 'strong' as const },
    ];
    const rng = createRng(777);
    let s = createInitialGameState(specs, 'fixed', ['player1', 'player2', 'player3'], rng, 'cities_knights');
    let improvements = 0, knights = 0, progress = 0;
    for (let i = 0; i < 200_000 && s.phase !== 'GAME_OVER'; i++) {
      let pid = s.playerOrder[s.currentPlayerIndex]!;
      if (s.phase === 'MAIN' && s.turnPhase === 'DISCARD') {
        pid = findPendingDiscarder(s) ?? pid; // 商品も計上するエンジン判定に委譲
      }
      const action = chooseAction(s, pid, { rng });
      if (!action) break;
      if (action.type === 'BUILD_IMPROVEMENT') improvements++;
      if (action.type === 'BUILD_KNIGHT') knights++;
      if (action.type === 'PLAY_PROGRESS') progress++;
      s = applyAction(s, action, rng);
    }
    expect(s.phase).toBe('GAME_OVER');
    expect(s.winner).not.toBeNull();
    expect(calcVP(s, s.winner!)).toBeGreaterThanOrEqual(13);
    expect(improvements).toBeGreaterThan(0);   // 都市改善が行われた
    expect(knights).toBeGreaterThan(0);        // 騎士が建設された
    expect(s.barbarianAttacks ?? 0).toBeGreaterThan(0);
    expect(progress).toBeGreaterThan(0); // 進歩カードが使われた
  }, 30000);
});

describe('C&K メトロポリス', () => {
  it('Lv5到達でLv4保持者からメトロポリスを奪取する', async () => {
    const { buildImprovement } = await import('../src/engine/citiesKnights');
    let s = oneTile('mountain', [[0, 'city', 'player1'], [1, 'city', 'player2']]);
    const tid = Object.keys(s.tileToVertices).find(t => (s.tileToVertices[t]?.length ?? 0) >= 3)!;
    const vids = s.tileToVertices[tid]!;
    const vidA = vids[0]!, vidB = vids[1]!;
    s = {
      ...s,
      expansion: 'cities_knights',
      metropolis: { science: { playerId: 'player1', vertexId: vidA } },
      vertices: {
        ...s.vertices,
        [vidA]: { ...s.vertices[vidA]!, building: { type: 'city', playerId: 'player1', metropolis: true } },
      },
      players: {
        ...s.players,
        player1: makePlayer('player1', { improvements: { trade: 0, politics: 0, science: 4 } }),
        player2: makePlayer('player2', { improvements: { trade: 0, politics: 0, science: 4 }, commodities: { coin: 0, cloth: 0, paper: 5 } }),
      },
    } as GameState;
    const r = buildImprovement(s, 'player2', 'science');
    expect(r.metropolis!.science!.playerId).toBe('player2');
    expect(r.vertices[vidB]!.building!.metropolis).toBe(true);
    expect(r.vertices[vidA]!.building!.metropolis ?? false).toBe(false); // 旧保持者は平の都市へ
    expect(r.players.player2!.improvements!.science).toBe(5);
  });

  it('同レベル(Lv4同士)では先着保持者が維持し奪取されない', async () => {
    const { buildImprovement } = await import('../src/engine/citiesKnights');
    let s = oneTile('mountain', [[0, 'city', 'player1'], [1, 'city', 'player2']]);
    const tid = Object.keys(s.tileToVertices).find(t => (s.tileToVertices[t]?.length ?? 0) >= 3)!;
    const vids = s.tileToVertices[tid]!;
    const vidA = vids[0]!;
    s = {
      ...s,
      expansion: 'cities_knights',
      metropolis: { science: { playerId: 'player1', vertexId: vidA } },
      vertices: {
        ...s.vertices,
        [vidA]: { ...s.vertices[vidA]!, building: { type: 'city', playerId: 'player1', metropolis: true } },
      },
      players: {
        ...s.players,
        player1: makePlayer('player1', { improvements: { trade: 0, politics: 0, science: 4 } }),
        player2: makePlayer('player2', { improvements: { trade: 0, politics: 0, science: 3 }, commodities: { coin: 0, cloth: 0, paper: 4 } }),
      },
    } as GameState;
    // player2 が Lv3→4: 既に player1 が保持しているので奪取できない。
    const r = buildImprovement(s, 'player2', 'science');
    expect(r.metropolis!.science!.playerId).toBe('player1');
    expect(r.players.player2!.improvements!.science).toBe(4);
  });
});

describe('C&K 蛮族防衛の報酬', () => {
  function barbState(extra: (g: GameState, vs: string[]) => GameState): GameState {
    const g = makeGameState({
      expansion: 'cities_knights',
      players: { player1: makePlayer('player1'), player2: makePlayer('player2') },
      playerOrder: ['player1', 'player2'],
    } as Partial<GameState>);
    return extra(g, Object.keys(g.vertices));
  }

  it('単独最大の貢献者は守護者VP+1（カードは引かない）', async () => {
    const { resolveBarbarianAttack, buildProgressDecks } = await import('../src/engine/citiesKnights');
    const { createRng } = await import('../src/engine/setup');
    const s = barbState((g, vs) => ({
      ...g,
      progressDecks: buildProgressDecks(createRng(1)),
      vertices: {
        ...g.vertices,
        [vs[0]!]: { ...g.vertices[vs[0]!]!, building: { type: 'city', playerId: 'player1' } },
        [vs[1]!]: { ...g.vertices[vs[1]!]!, knight: { playerId: 'player1', strength: 2, active: true } },
        [vs[2]!]: { ...g.vertices[vs[2]!]!, knight: { playerId: 'player2', strength: 1, active: true } },
      },
    }));
    const r = resolveBarbarianAttack(s);
    expect(r.players.player1!.defenderVP).toBe(1);
    expect(r.players.player2!.defenderVP ?? 0).toBe(0);
    expect((r.players.player1!.progressCards ?? []).length).toBe(0);
  });

  it('同点最大は守護VPなしで各同点者が進歩カードを1枚引く', async () => {
    const { resolveBarbarianAttack, buildProgressDecks } = await import('../src/engine/citiesKnights');
    const { createRng } = await import('../src/engine/setup');
    const s = barbState((g, vs) => ({
      ...g,
      progressDecks: buildProgressDecks(createRng(2)),
      vertices: {
        ...g.vertices,
        [vs[0]!]: { ...g.vertices[vs[0]!]!, building: { type: 'city', playerId: 'player1' } },
        [vs[1]!]: { ...g.vertices[vs[1]!]!, knight: { playerId: 'player1', strength: 2, active: true } },
        [vs[2]!]: { ...g.vertices[vs[2]!]!, knight: { playerId: 'player2', strength: 2, active: true } },
      },
    }));
    const r = resolveBarbarianAttack(s);
    expect(r.players.player1!.defenderVP ?? 0).toBe(0);
    expect(r.players.player2!.defenderVP ?? 0).toBe(0);
    expect((r.players.player1!.progressCards ?? []).length).toBe(1);
    expect((r.players.player2!.progressCards ?? []).length).toBe(1);
  });

  it('同点でも手札上限4の防衛者はカードを引かない', async () => {
    const { resolveBarbarianAttack, buildProgressDecks } = await import('../src/engine/citiesKnights');
    const { createRng } = await import('../src/engine/setup');
    const four = Array.from({ length: 4 }, (_, i) => ({ id: `x${i}`, type: 'warlord' as const, deck: 'politics' as const }));
    const s = barbState((g, vs) => ({
      ...g,
      progressDecks: buildProgressDecks(createRng(3)),
      players: {
        ...g.players,
        player1: makePlayer('player1', { progressCards: four }),
      },
      vertices: {
        ...g.vertices,
        [vs[0]!]: { ...g.vertices[vs[0]!]!, building: { type: 'city', playerId: 'player1' } },
        [vs[1]!]: { ...g.vertices[vs[1]!]!, knight: { playerId: 'player1', strength: 2, active: true } },
        [vs[2]!]: { ...g.vertices[vs[2]!]!, knight: { playerId: 'player2', strength: 2, active: true } },
      },
    }));
    const r = resolveBarbarianAttack(s);
    expect((r.players.player1!.progressCards ?? []).length).toBe(4); // 上限のため引かない
    expect((r.players.player2!.progressCards ?? []).length).toBe(1);
  });
});

describe('C&K 強盗・海賊', () => {
  it('資源0・商品のみの相手も奪取対象で、商品が奪われる', async () => {
    const { stealResource, robbableCardCount } = await import('../src/engine/robber');
    const { createRng } = await import('../src/engine/setup');
    let s = oneTile('mountain', [[0, 'city', 'player1'], [1, 'city', 'player2']]);
    s = {
      ...s,
      expansion: 'cities_knights',
      players: {
        ...s.players,
        player1: makePlayer('player1', { hand: makeHand(), commodities: { coin: 0, cloth: 0, paper: 0 } }),
        player2: makePlayer('player2', { hand: makeHand(), commodities: { coin: 3, cloth: 0, paper: 0 } }),
      },
    } as GameState;
    expect(robbableCardCount(s, 'player2')).toBe(3); // 商品3枚＝奪取対象
    const r = stealResource(s, 'player1', 'player2', createRng(1));
    expect(r.players.player1!.commodities!.coin).toBe(1);
    expect(r.players.player2!.commodities!.coin).toBe(2);
  });

  it('基本ゲームでは商品を数えない（後方互換）', async () => {
    const { robbableCardCount } = await import('../src/engine/robber');
    const s = makeGameState({
      players: { player1: makePlayer('player1', { hand: makeHand({ wood: 2 }) }), player2: makePlayer('player2') },
      playerOrder: ['player1', 'player2'],
    });
    expect(robbableCardCount(s, 'player1')).toBe(2);
  });
});

describe('C&K 進歩カード', () => {
  it('buildProgressDecks: 3ツリーの山札が生成される', async () => {
    const { buildProgressDecks } = await import('../src/engine/citiesKnights');
    const { createRng } = await import('../src/engine/setup');
    const decks = buildProgressDecks(createRng(1));
    expect(decks.science.length).toBeGreaterThan(0);
    expect(decks.trade.length).toBeGreaterThan(0);
    expect(decks.politics.length).toBeGreaterThan(0);
  });

  function ckState(extra: Partial<GameState> = {}): GameState {
    return makeGameState({
      expansion: 'cities_knights',
      players: { player1: makePlayer('player1'), player2: makePlayer('player2') },
      playerOrder: ['player1', 'player2'],
      ...extra,
    } as Partial<GameState>);
  }

  it('warlord: 自分の騎士を全て起動する', async () => {
    const { playProgress, canPlayProgress } = await import('../src/engine/citiesKnights');
    const { createRng } = await import('../src/engine/setup');
    const g = ckState();
    const kv = Object.keys(g.vertices)[0]!;
    const s: GameState = {
      ...g,
      vertices: { ...g.vertices, [kv]: { ...g.vertices[kv]!, knight: { playerId: 'player1', strength: 1, active: false } } },
      players: { ...g.players, player1: makePlayer('player1', { progressCards: [{ id: 'w1', type: 'warlord', deck: 'politics' }] }) },
    };
    expect(canPlayProgress(s, 'player1', 'w1')).toBe(true);
    const next = playProgress(s, 'player1', 'w1', createRng(1));
    expect(next.vertices[kv]!.knight!.active).toBe(true);
    expect((next.players.player1!.progressCards ?? []).length).toBe(0); // 使用後は手札から消える
  });

  it('resource_monopoly: 相手が最も多く持つ資源を各相手から2枚奪う', async () => {
    const { playProgress } = await import('../src/engine/citiesKnights');
    const { createRng } = await import('../src/engine/setup');
    const { makeHand } = await import('../src/constants');
    const g = ckState();
    const s: GameState = {
      ...g,
      players: {
        player1: makePlayer('player1', { hand: makeHand(), progressCards: [{ id: 'm1', type: 'resource_monopoly', deck: 'trade' }] }),
        player2: makePlayer('player2', { hand: makeHand({ wood: 3 }) }),
      },
    };
    const next = playProgress(s, 'player1', 'm1', createRng(1));
    expect(next.players.player1!.hand.wood).toBe(2); // 2枚奪取
    expect(next.players.player2!.hand.wood).toBe(1); // 残り1
  });
});

describe('C&K 騎士の移動', () => {
  function ckBoard(): GameState {
    return makeGameState({
      expansion: 'cities_knights',
      players: { player1: makePlayer('player1'), player2: makePlayer('player2') },
      playerOrder: ['player1', 'player2'],
    } as Partial<GameState>);
  }
  it('自分の道沿いの隣接空き頂点へ起動騎士を移動でき、1ターン1回', async () => {
    const { canMoveKnight, moveKnight } = await import('../src/engine/citiesKnights');
    const g = ckBoard();
    const eid = Object.keys(g.edges)[0]!;
    const [v1, v2] = g.edges[eid]!.vertexIds;
    const s: GameState = {
      ...g,
      edges: { ...g.edges, [eid]: { ...g.edges[eid]!, road: { playerId: 'player1' } } },
      vertices: { ...g.vertices, [v1]: { ...g.vertices[v1]!, knight: { playerId: 'player1', strength: 2, active: true } } },
    };
    expect(canMoveKnight(s, 'player1', v1, v2)).toBe(true);
    const next = moveKnight(s, 'player1', v1, v2);
    expect(next.vertices[v1]!.knight).toBeNull();
    expect(next.vertices[v2]!.knight!.playerId).toBe('player1');
    expect(next.knightMovedThisTurn).toBe(true);
    expect(canMoveKnight(next, 'player1', v2, v1)).toBe(false); // 1ターン1回
  });
  it('弱い敵騎士は押し出せるが、同等以上は不可。非起動・道なしも不可', async () => {
    const { canMoveKnight } = await import('../src/engine/citiesKnights');
    const g = ckBoard();
    const eid = Object.keys(g.edges)[0]!;
    const [v1, v2] = g.edges[eid]!.vertexIds;
    const base: GameState = {
      ...g,
      edges: { ...g.edges, [eid]: { ...g.edges[eid]!, road: { playerId: 'player1' } } },
      vertices: { ...g.vertices, [v1]: { ...g.vertices[v1]!, knight: { playerId: 'player1', strength: 2, active: true } } },
    };
    const weak: GameState = { ...base, vertices: { ...base.vertices, [v2]: { ...base.vertices[v2]!, knight: { playerId: 'player2', strength: 1, active: false } } } };
    expect(canMoveKnight(weak, 'player1', v1, v2)).toBe(true); // 弱い敵→押し出し可
    const strong: GameState = { ...base, vertices: { ...base.vertices, [v2]: { ...base.vertices[v2]!, knight: { playerId: 'player2', strength: 2, active: true } } } };
    expect(canMoveKnight(strong, 'player1', v1, v2)).toBe(false); // 同等以上→不可
    // 非起動は移動不可
    const inactive: GameState = { ...base, vertices: { ...base.vertices, [v1]: { ...base.vertices[v1]!, knight: { playerId: 'player1', strength: 2, active: false } } } };
    expect(canMoveKnight(inactive, 'player1', v1, v2)).toBe(false);
    // 道が無い辺沿いは不可
    const noRoad: GameState = { ...base, edges: { ...base.edges, [eid]: { ...base.edges[eid]!, road: null } } };
    expect(canMoveKnight(noRoad, 'player1', v1, v2)).toBe(false);
  });

  it('押し出された弱い敵騎士は所有者の隣接空き頂点へ再配置され、strength/activeを保持', async () => {
    const { moveKnight } = await import('../src/engine/citiesKnights');
    const g = ckBoard();
    const eid = Object.keys(g.edges)[0]!;
    const [v1, v2] = g.edges[eid]!.vertexIds;
    // v2 に隣接する別頂点 v3 とその間の辺 e23 を探し、player2 の道を置く。
    let v3: string | undefined; let e23: string | undefined;
    for (const e of g.vertices[v2]!.adjacentEdgeIds) {
      const ed = g.edges[e]!;
      const other = ed.vertexIds[0] === v2 ? ed.vertexIds[1] : ed.vertexIds[0];
      if (other !== v1) { v3 = other; e23 = e; break; }
    }
    const s: GameState = {
      ...g,
      edges: {
        ...g.edges,
        [eid]: { ...g.edges[eid]!, road: { playerId: 'player1' } },
        [e23!]: { ...g.edges[e23!]!, road: { playerId: 'player2' } },
      },
      vertices: {
        ...g.vertices,
        [v1]: { ...g.vertices[v1]!, knight: { playerId: 'player1', strength: 2, active: true } },
        [v2]: { ...g.vertices[v2]!, knight: { playerId: 'player2', strength: 1, active: true } },
      },
    };
    const next = moveKnight(s, 'player1', v1, v2);
    expect(next.vertices[v2]!.knight!.playerId).toBe('player1'); // 強い騎士が入る
    expect(next.vertices[v1]!.knight).toBeNull();
    expect(next.vertices[v3!]!.knight).toEqual({ playerId: 'player2', strength: 1, active: true }); // 再配置・状態保持
  });

  it('再配置先が無ければ押し出された騎士は供給へ戻る（盤から消える）', async () => {
    const { moveKnight } = await import('../src/engine/citiesKnights');
    const g = ckBoard();
    const eid = Object.keys(g.edges)[0]!;
    const [v1, v2] = g.edges[eid]!.vertexIds;
    const s: GameState = {
      ...g,
      edges: { ...g.edges, [eid]: { ...g.edges[eid]!, road: { playerId: 'player1' } } }, // player2の道なし
      vertices: {
        ...g.vertices,
        [v1]: { ...g.vertices[v1]!, knight: { playerId: 'player1', strength: 2, active: true } },
        [v2]: { ...g.vertices[v2]!, knight: { playerId: 'player2', strength: 1, active: true } },
      },
    };
    const before = Object.values(s.vertices).filter(v => v.knight?.playerId === 'player2').length;
    const next = moveKnight(s, 'player1', v1, v2);
    const after = Object.values(next.vertices).filter(v => v.knight?.playerId === 'player2').length;
    expect(after).toBe(before - 1); // 供給へ戻る
    expect(next.vertices[v2]!.knight!.playerId).toBe('player1');
  });
});
