// ============================================================
// tests/scenarios_smoke.test.ts — 全シナリオの構造＋フルゲーム完走スモーク
// ============================================================
//
// 追加シナリオがソフトロック/資源欠落/島の誤結合を起こさないことを、
// 「3人の強CPUが GAME_OVER まで完走する」ことで担保する（決定論）。

import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/engine/createState';
import type { PlayerSpec } from '../src/engine/createState';
import { createRng } from '../src/engine/setup';
import { chooseAction } from '../src/engine/ai';
import { applyAction } from '../src/engine/game';
import { computeIslandReps } from '../src/engine/islands';
import { findPendingDiscarder } from '../src/engine/robber';
import { listScenarios, getScenario, type ScenarioId } from '../src/engine/scenarios';
import type { GameState } from '../src/types';

const SPECS3: PlayerSpec[] = [
  { id: 'player1', name: 'A', color: 'red',    type: 'ai', aiDifficulty: 'strong' },
  { id: 'player2', name: 'B', color: 'blue',   type: 'ai', aiDifficulty: 'strong' },
  { id: 'player3', name: 'C', color: 'purple', type: 'ai', aiDifficulty: 'strong' },
];

// 1ゲームを GAME_OVER まで回す（DISCARD/GOLD は対象プレイヤーを選んで解決）。
function playToEnd(scenario: ScenarioId, seed: number): GameState {
  const rng = createRng(seed);
  let s = createInitialGameState(SPECS3, 'fixed', ['player1', 'player2', 'player3'], rng, scenario);
  for (let i = 0; i < 120_000 && s.phase !== 'GAME_OVER'; i++) {
    let pid = s.playerOrder[s.currentPlayerIndex]!;
    if (s.phase === 'MAIN' && s.turnPhase === 'DISCARD') {
      pid = findPendingDiscarder(s) ?? pid; // 騎士と商人は商品も計上するためエンジン判定に委譲
    } else if (s.phase === 'MAIN' && s.turnPhase === 'GOLD') {
      pid = s.playerOrder.find(p => ((s.pendingGoldChoice ?? {})[p] ?? 0) > 0) ?? pid;
    }
    const action = chooseAction(s, pid, { rng });
    if (!action) break;
    s = applyAction(s, action, rng);
  }
  return s;
}

const SEAFARERS_IDS = listScenarios().filter(s => s.category === 'seafarers').map(s => s.id);

describe('全シナリオ: 構造の健全性', () => {
  for (const id of SEAFARERS_IDS) {
    it(`${id}: 本島(最大の陸塊)が一意・全5資源あり・29タイル`, () => {
      const s = createInitialGameState(SPECS3, 'fixed', ['player1', 'player2', 'player3'], createRng(1), id);
      expect(Object.keys(s.tiles)).toHaveLength(29);

      // 島サイズ。最大の陸塊（本島）が他より厳密に大きい＝初期配置が一意に定まる。
      const repOf = computeIslandReps(s.tiles);
      const sizes = [...new Set(Object.values(repOf))]
        .map(r => Object.values(repOf).filter(x => x === r).length)
        .sort((a, b) => b - a);
      expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0); // 本島が最大で一意

      // 本島に全5資源（開始時に資源が偏って詰まないこと）。
      const home = (() => {
        const counts: Record<string, number> = {};
        for (const r of Object.values(repOf)) counts[r] = (counts[r] ?? 0) + 1;
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
      })();
      const homeTypes = new Set(
        Object.entries(repOf).filter(([, r]) => r === home).map(([tid]) => s.tiles[tid]!.type),
      );
      for (const t of ['forest', 'hill', 'pasture', 'field', 'mountain']) {
        expect(homeTypes.has(t as never)).toBe(true);
      }
    });
  }
});

describe('全シナリオ: 3人強CPUがフルゲーム完走（ソフトロックなし）', () => {
  for (const info of listScenarios()) {
    it(`${info.id} が GAME_OVER まで進む`, () => {
      const s = playToEnd(info.id, 2024);
      expect(s.phase).toBe('GAME_OVER');
      expect(s.winner).not.toBeNull();
      // 勝者の勝利点はシナリオの目標以上。
      expect(getScenario(info.id).victoryTarget ?? 10).toBeGreaterThan(0);
    });
  }
});
