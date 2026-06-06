// ============================================================
// src/engine/lanCpu.ts — LAN混合対戦のサーバ側CPUオーケストレーション（純粋）
// ============================================================
//
// サーバ権威モデルで CPU を動かすための「次に CPU が打つ一手」を決める純粋関数。
// 既存の純粋AI（chooseAction）を再利用し、交易応答だけ簡易ロジックで補う。
// 乱数は rng 注入（サーバ=Math.random、テスト=seed）。
//
// 方針:
//   - CPU は自分からはプレイヤー間交易を提案しない（skipPlayerTrade=true）。
//     → 人間応答待ちでのスタールを避ける（CPU→人間提案は残課題）。
//   - 人間が CPU をターゲットにした交易には CPU が承認/拒否で応答する。
//   - 捨て札・盗賊・初期配置・通常ターンは chooseAction に委譲。
//
// 単一端末のローカルCPU経路（main.ts）には一切触れない（CPU戦は無傷）。

import type { GameState, Action, PlayerId } from '../types';
import { RESOURCE_TYPES } from '../constants';
import { chooseAction } from './ai';
import { canBuildSettlement, canBuildRoad } from './actions';

export interface CpuStep {
  readonly pid: PlayerId;
  readonly action: Action;
}

const isCpu = (state: GameState, pid: PlayerId): boolean =>
  state.players[pid]?.type === 'ai';

/**
 * 現在の state で「次に動くべき CPU の一手」を返す。CPU が動く必要が無い
 * （人間の手番・人間の入力待ち・GAME_OVER）なら null。
 *
 * @param rng 交易承諾の確率判定に使う乱数（0..1）。
 */
export function nextCpuAction(state: GameState, rng: () => number = Math.random): CpuStep | null {
  if (state.phase === 'GAME_OVER') return null;

  // ---- 交易の応答（人間起案 → CPU ターゲット / CPU起案 → 確定）----
  const trade = state.pendingTrade;
  if (trade) {
    if (trade.state === 'TRADE_OFFER') {
      // 未応答の対象のうち先頭が CPU なら応答する。人間が先頭なら待つ。
      const pending = trade.targetPlayerIds.find(t => !trade.responses[t]);
      if (pending && isCpu(state, pending)) {
        const cpu = state.players[pending]!;
        const canAfford = RESOURCE_TYPES.every(r => cpu.hand[r] >= (trade.offer.receive[r] ?? 0));
        const accepts = canAfford && rng() < 0.6; // 既存ローカルCPUと同じ簡易判断
        return { pid: pending, action: { type: 'RESPOND_TRADE', response: { playerId: pending, status: accepts ? 'ACCEPT' : 'REJECT' } } };
      }
      return null; // 人間ターゲットの応答待ち
    }
    if (trade.state === 'TRADE_RESPONSE' && isCpu(state, trade.initiatorId)) {
      // CPU起案（通常は発生しない）。承諾者がいれば成立、いなければ取消。
      const acceptor = trade.targetPlayerIds.find(t => trade.responses[t]?.status === 'ACCEPT') as PlayerId | undefined;
      return { pid: trade.initiatorId, action: acceptor ? { type: 'CONFIRM_TRADE', responderId: acceptor } : { type: 'CANCEL_TRADE' } };
    }
    return null; // 人間起案の応答収集中 / 人間の確定待ち
  }

  // ---- 捨て札（手番に関わらず 8枚以上の CPU を1人ずつ処理）----
  if (state.phase === 'MAIN' && state.turnPhase === 'DISCARD') {
    const dpid = state.playerOrder.find(p =>
      isCpu(state, p) && RESOURCE_TYPES.reduce((s, r) => s + state.players[p]!.hand[r], 0) >= 8,
    );
    if (dpid) {
      const action = chooseAction(state, dpid, { rng });
      if (action) return { pid: dpid, action };
    }
    return null; // 人間の捨て札待ち
  }

  // ---- 手番が CPU なら通常の一手（初期配置 / ダイス / 盗賊 / 建設等）----
  const cur = state.playerOrder[state.currentPlayerIndex];
  if (cur && isCpu(state, cur)) {
    // CPU は自分からプレイヤー間交易を提案しない（スタール回避）
    const action = chooseAction(state, cur, { skipPlayerTrade: true, rng });
    if (action) return { pid: cur, action };
    // フォールバック: 何も選べない場合でも進行させる
    return { pid: cur, action: cpuFallbackAction(state, cur) };
  }

  return null; // 人間の手番
}

/**
 * どのフェーズでも「合法で進行する」安全な行動を1つ返す（最終手段）。
 * CPU の選択 or 適用が失敗した時に、サーバがゲームを止めないために使う。
 */
export function cpuFallbackAction(state: GameState, pid: PlayerId): Action {
  // セットアップ: 最初の合法な配置（これが無いことは通常起こらない）。
  if (state.phase === 'SETUP_FORWARD' || state.phase === 'SETUP_BACKWARD') {
    if (state.setupSubPhase === 'PLACE_ROAD') {
      const e = Object.keys(state.edges).find(eid => canBuildRoad(state, pid, eid));
      if (e) return { type: 'BUILD_ROAD', edgeId: e };
    }
    const v = Object.keys(state.vertices).find(vid => canBuildSettlement(state, pid, vid));
    if (v) return { type: 'BUILD_SETTLEMENT', vertexId: v };
  }
  // ペンディング交易: 取り消し（CPU起案時のみ実質有効）。
  if (state.pendingTrade) return { type: 'CANCEL_TRADE' };
  if (state.turnPhase === 'PRE_ROLL') return { type: 'ROLL_DICE' };
  if (state.turnPhase === 'ROBBER') {
    const robberTile = Object.values(state.tiles).find(t => t.hasRobber)?.id;
    const tileId = Object.keys(state.tiles).find(t => t !== robberTile) ?? robberTile!;
    return { type: 'MOVE_ROBBER', tileId, stealFromPlayerId: null };
  }
  if (state.turnPhase === 'DISCARD') {
    return chooseAction(state, pid) ?? { type: 'END_TURN' };
  }
  return { type: 'END_TURN' };
}
