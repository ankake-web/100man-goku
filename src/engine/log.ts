// ============================================================
// src/engine/log.ts — アクションログ生成（公開情報のみ）
// ============================================================
//
// このモジュールは「観戦者・人間プレイヤーに見せてよい公開情報」だけから
// ログ項目を生成する。秘匿すべき情報は文字列に含めない：
//   - CPUの手札内訳・VPカード・VPカード込みの内部VP・内部評価
//   - 盗み取り／捨て札の「資源の種類」（枚数のみ公開）
//   - CPUの資源獲得の内訳（人間プレイヤー自身の分のみ内訳を出す）
// ============================================================

import type { GameState, Action, PlayerId, LogEntry, ResourceType } from '../types';
import { RESOURCE_TYPES } from '../constants';

export const RES_EMOJI: Record<ResourceType, string> = {
  wood: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '⛰',
};

const DEV_PLAY_LABEL: Record<string, string> = {
  PLAY_KNIGHT:         '⚔ 騎士',
  PLAY_ROAD_BUILDING:  '🛤 街道建設',
  PLAY_YEAR_OF_PLENTY: '🌾 年の豊穣',
  PLAY_MONOPOLY:       '🏛 独占',
};

export const MAX_LOG_ENTRIES = 60;

/**
 * 1アクション分のログ項目を生成する（公開情報のみ）。
 * - CPUの手札内訳・VPカード込み内部VP・内部評価・非公開の捨て札内容は出さない。
 * - 資源獲得の内訳は人間プレイヤー自身の分のみ（自分の情報）。
 * - 捨て札・盗み取りは「枚数」のみ（種類は秘匿）。
 */
export function buildActionLog(prev: GameState, action: Action, next: GameState): LogEntry[] {
  const turn = next.globalTurnNumber;
  const nm = (pid: string): string => next.players[pid]?.name ?? prev.players[pid]?.name ?? pid;
  const actor = prev.playerOrder[prev.currentPlayerIndex] ?? next.playerOrder[next.currentPlayerIndex] ?? '';
  const entries: LogEntry[] = [];
  const push = (playerId: string, type: LogEntry['type'], message: string) =>
    entries.push({ turn, playerId: playerId as PlayerId, type, message });

  switch (action.type) {
    case 'ROLL_DICE': {
      const [d1, d2] = next.lastDiceRoll ?? [0, 0];
      push(actor, 'DICE_ROLL', `🎲 ${nm(actor)} がダイス ${d1}+${d2}=${d1 + d2}`);
      // 人間自身の獲得資源のみ内訳を出す（自分の情報なので漏洩ではない）
      const humanPid = next.playerOrder.find(p => next.players[p]?.type === 'human');
      if (humanPid) {
        const gains = RESOURCE_TYPES
          .map(r => ({ r, n: next.players[humanPid]!.hand[r] - (prev.players[humanPid]?.hand[r] ?? 0) }))
          .filter(g => g.n > 0);
        if (gains.length > 0) {
          push(humanPid, 'RESOURCE_GAIN', `📥 あなたが ${gains.map(g => `${RES_EMOJI[g.r]}×${g.n}`).join(' ')} 獲得`);
        }
      }
      break;
    }
    case 'BUILD_ROAD':       push(actor, 'BUILD', `🛤 ${nm(actor)} が道を建設`); break;
    case 'BUILD_SETTLEMENT': push(actor, 'BUILD', `🏠 ${nm(actor)} が開拓地を建設`); break;
    case 'BUILD_CITY':       push(actor, 'BUILD', `🏙 ${nm(actor)} が都市を建設`); break;
    case 'BUY_DEV_CARD':     push(actor, 'DEV_CARD', `🃏 ${nm(actor)} が発展カードを購入`); break;
    case 'PLAY_KNIGHT':
    case 'PLAY_ROAD_BUILDING':
    case 'PLAY_YEAR_OF_PLENTY':
      push(actor, 'DEV_CARD', `${DEV_PLAY_LABEL[action.type]} を ${nm(actor)} が使用`); break;
    case 'PLAY_MONOPOLY':
      // 独占は宣言した資源が公開情報
      push(actor, 'DEV_CARD', `🏛 ${nm(actor)} が独占を使用（${RES_EMOJI[action.resource]}）`); break;
    case 'BANK_TRADE':
      push(actor, 'TRADE_BANK', `💱 ${nm(actor)} が銀行交易（${RES_EMOJI[action.give]}→${RES_EMOJI[action.receive]}）`); break;
    case 'MOVE_ROBBER': {
      let msg = `🦹 ${nm(actor)} が盗賊を移動`;
      if (action.stealFromPlayerId) msg += `し ${nm(action.stealFromPlayerId)} から1枚奪った`; // 種類は秘匿
      push(actor, 'ROBBER', msg);
      break;
    }
    case 'DISCARD_RESOURCES': {
      // 捨てた枚数のみ（内容は秘匿）
      const count = RESOURCE_TYPES.reduce((s, r) => s + (action.resources[r] ?? 0), 0);
      if (count > 0) push(action.playerId, 'DISCARD', `🗑 ${nm(action.playerId)} が ${count}枚 捨てた`);
      break;
    }
    case 'OFFER_TRADE': {
      const isCpu = prev.players[actor]?.type === 'ai';
      push(actor, 'TRADE_PLAYER', isCpu ? `🤝 ${nm(actor)} が交易を提案` : `🤝 あなたが交易を提案`);
      break;
    }
    case 'CONFIRM_TRADE': {
      const trade = prev.pendingTrade;
      if (trade) push(trade.initiatorId, 'TRADE_PLAYER', `🤝 交易成立（${nm(trade.initiatorId)} ⇄ ${nm(action.responderId)}）`);
      break;
    }
    case 'CANCEL_TRADE': {
      const trade = prev.pendingTrade;
      if (trade && prev.players[trade.initiatorId]?.type === 'ai' && trade.state === 'TRADE_RESPONSE') {
        push(trade.initiatorId, 'TRADE_PLAYER', `🤝 あなたは ${nm(trade.initiatorId)} の交易提案を拒否`);
      } else if (trade) {
        push(trade.initiatorId, 'TRADE_PLAYER', `🤝 交易は不成立`);
      }
      break;
    }
    default: break;
  }

  // ボーナス称号の移動（公開情報）
  if (prev.longestRoadHolder !== next.longestRoadHolder && next.longestRoadHolder) {
    push(next.longestRoadHolder, 'BONUS_CHANGE', `🛤 ${nm(next.longestRoadHolder)} が最長交易路を獲得`);
  }
  if (prev.largestArmyHolder !== next.largestArmyHolder && next.largestArmyHolder) {
    push(next.largestArmyHolder, 'BONUS_CHANGE', `⚔ ${nm(next.largestArmyHolder)} が最大騎士力を獲得`);
  }
  // 勝利
  if (next.phase === 'GAME_OVER' && prev.phase !== 'GAME_OVER' && next.winner) {
    push(next.winner, 'VICTORY', `🏆 ${nm(next.winner)} の勝利！`);
  }

  return entries;
}
