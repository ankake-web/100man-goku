// ============================================================
// tests/log.test.ts — アクションログの秘匿仕様 回帰テスト
// ============================================================
//
// 目的：buildActionLog が「非公開情報」を文字列へ漏らさないことを保証する。
//   - CPUの捨て札／盗み取りは枚数のみ（資源の種類を出さない）
//   - ダイス生産（このロールの増加分）は公開情報なので全員分を出してよい
//     （ただし手札の既存ストック・内訳までは漏らさない）
//   - 人間プレイヤー自身の獲得は内訳を出してよい（本人向け情報）
//   - 勝利ログにVPカード名や内部VP数値を出さない
// 文言の完全一致ではなく「秘匿すべき文字列が含まれないこと」を重視する。
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildActionLog, RES_EMOJI } from '../src/engine/log';
import { makeGameState, makePlayer } from './helpers';
import type { GameState, LogEntry } from '../src/types';

// 全資源絵文字（種類の漏洩検査に使う）
const ALL_RES_EMOJI = Object.values(RES_EMOJI);
// 資源名（日本語）も念のため検査
const RES_NAMES_JA = ['木材', '木', 'レンガ', '羊', '羊毛', '小麦', '麦', '鉱石', '石'];

function joinMessages(entries: LogEntry[]): string {
  return entries.map(e => e.message).join('\n');
}

/** 文字列に「どの資源絵文字も」含まれないことを表明 */
function expectNoResourceEmoji(text: string): void {
  for (const emoji of ALL_RES_EMOJI) {
    expect(text).not.toContain(emoji);
  }
}

describe('buildActionLog: 秘匿仕様', () => {
  // CPU(player1) が手番、人間(player2) が存在する基本状態
  function cpuTurnState(partial: Partial<GameState> = {}): GameState {
    return makeGameState({
      players: {
        player1: makePlayer('player1', { name: 'CPU α', type: 'ai', aiDifficulty: 'normal' }),
        player2: makePlayer('player2', { name: 'あなた', type: 'human' }),
      },
      playerOrder: ['player1', 'player2'],
      currentPlayerIndex: 0,
      ...partial,
    });
  }

  it('1. CPUの捨て札ログは枚数のみで資源種類を出さない', () => {
    const prev = cpuTurnState();
    const next = prev; // 捨て札ログは action.resources のみから生成される
    const entries = buildActionLog(prev, {
      type: 'DISCARD_RESOURCES',
      playerId: 'player1',
      resources: { wood: 2, ore: 1 }, // 合計3枚
    }, next);

    const text = joinMessages(entries);
    expect(text).toContain('3枚'); // 枚数は出る
    expectNoResourceEmoji(text);   // 種類（絵文字）は出ない
    for (const n of RES_NAMES_JA) expect(text).not.toContain(n);
  });

  it('2a. CPUが盗んだログは「1枚奪った」のみで奪った資源を出さない', () => {
    const prev = cpuTurnState();
    const next = prev;
    const entries = buildActionLog(prev, {
      type: 'MOVE_ROBBER',
      tileId: Object.keys(prev.tiles)[0]!,
      stealFromPlayerId: 'player2',
    }, next);

    const text = joinMessages(entries);
    expect(text).toContain('1枚奪った');
    expectNoResourceEmoji(text);
    for (const n of RES_NAMES_JA) expect(text).not.toContain(n);
  });

  it('2b. CPUに盗まれた（人間が被害者）ログでも奪われた資源種類を出さない', () => {
    // 人間(player2)が手番でCPU(player1)から盗むケースの逆 — ここでは
    // CPUが人間から盗む = 人間の手札が減るが、ログは枚数のみ。
    const prev = cpuTurnState();
    const next = prev;
    const entries = buildActionLog(prev, {
      type: 'MOVE_ROBBER',
      tileId: Object.keys(prev.tiles)[0]!,
      stealFromPlayerId: 'player2',
    }, next);
    expectNoResourceEmoji(joinMessages(entries));
  });

  it('3. 人間プレイヤー自身の資源獲得は内訳（種類×枚数）を出してよい', () => {
    // 人間(player2)が手番でダイスを振り、人間が wood×1, grain×2 獲得
    const prev = makeGameState({
      players: {
        player1: makePlayer('player1', { name: 'CPU α', type: 'ai', aiDifficulty: 'normal' }),
        player2: makePlayer('player2', { name: 'あなた', type: 'human' }),
      },
      playerOrder: ['player1', 'player2'],
      currentPlayerIndex: 1,
    });
    const next: GameState = {
      ...prev,
      lastDiceRoll: [3, 4],
      players: {
        ...prev.players,
        player2: makePlayer('player2', {
          name: 'あなた', type: 'human',
          hand: { wood: 1, brick: 0, wool: 0, grain: 2, ore: 0 },
        }),
      },
    };
    const entries = buildActionLog(prev, { type: 'ROLL_DICE' }, next);
    const gainEntry = entries.find(e => e.type === 'RESOURCE_GAIN');
    expect(gainEntry).toBeDefined();
    // 本人向け情報なので内訳（絵文字）を含んでよい
    expect(gainEntry!.message).toContain(RES_EMOJI.wood);
    expect(gainEntry!.message).toContain(RES_EMOJI.grain);
    expect(gainEntry!.message).toContain('あなた');
  });

  it('4. ダイス生産はCPU分も公開してよいが、手札の既存ストックは漏らさない', () => {
    // CPU(player1)が手番でダイス。CPUはこのロールで wood×3 を得る。
    // ただし CPU は以前から ore×2 を持っている（既存ストック）。人間は何も得ない。
    const prev = cpuTurnState({ currentPlayerIndex: 0 });
    const prevWithStock: GameState = {
      ...prev,
      players: {
        ...prev.players,
        player1: makePlayer('player1', {
          name: 'CPU α', type: 'ai', aiDifficulty: 'normal',
          hand: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 2 }, // 既存ストック
        }),
      },
    };
    const next: GameState = {
      ...prevWithStock,
      lastDiceRoll: [2, 4],
      players: {
        ...prevWithStock.players,
        player1: makePlayer('player1', {
          name: 'CPU α', type: 'ai', aiDifficulty: 'normal',
          hand: { wood: 3, brick: 0, wool: 0, grain: 0, ore: 2 }, // wood×3 を新たに獲得
        }),
      },
    };
    const entries = buildActionLog(prevWithStock, { type: 'ROLL_DICE' }, next);
    const gain = entries.find(e => e.type === 'RESOURCE_GAIN');
    // このロールでの増加分（公開情報）は出る: CPU名 + wood×3
    expect(gain).toBeDefined();
    expect(gain!.message).toContain(RES_EMOJI.wood);
    expect(gain!.message).toContain('CPU α');
    // 視点は人間(player2)なので CPU を「あなた」と取り違えない
    expect(gain!.message).not.toContain('あなた');
    // 既存ストック（ore×2）は増加分ではないので漏れない
    expect(gain!.message).not.toContain(RES_EMOJI.ore);
  });

  it('5. CPU勝利ログにVPカード名・内部VP数値が出ない', () => {
    const prev = cpuTurnState({ phase: 'MAIN' });
    const next: GameState = {
      ...prev,
      phase: 'GAME_OVER',
      winner: 'player1',
    };
    const entries = buildActionLog(prev, { type: 'BUILD_CITY', vertexId: Object.keys(prev.vertices)[0]! }, next);
    const victory = entries.find(e => e.type === 'VICTORY');
    expect(victory).toBeDefined();
    const text = victory!.message;
    // VPカード名・内部VPらしき表現を含まない
    for (const banned of ['VP', 'ＶＰ', '勝利点', '発展カード', '騎士', 'チャペル', '大学', '図書館', '市場', '議事堂']) {
      expect(text).not.toContain(banned);
    }
    // 「○点」のような数値+点 の内部VP表示が無いこと
    expect(text).not.toMatch(/\d+\s*点/);
    expect(text).toContain('勝利');
  });
});
