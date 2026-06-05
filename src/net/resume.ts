// ============================================================
// src/net/resume.ts — LAN再接続情報の保存（localStorage）
// ============================================================
//
// リロード・一時切断後に「同じプレイヤー」として復帰するため、
// ルームコード・自分のID・再接続トークンを保存する。
// 秘匿情報（手札など）は保存しない。

import type { PlayerId } from '../types';

export interface ResumeInfo {
  code: string;
  you: PlayerId;
  token: string;
}

const KEY = 'catan_lan_resume';

export function saveResume(info: ResumeInfo): void {
  try { localStorage.setItem(KEY, JSON.stringify(info)); } catch { /* 不可環境は無視 */ }
}

export function loadResume(): ResumeInfo | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<ResumeInfo>;
    if (o && typeof o.code === 'string' && typeof o.you === 'string' && typeof o.token === 'string') {
      return { code: o.code, you: o.you as PlayerId, token: o.token };
    }
  } catch { /* 壊れた値は無視 */ }
  return null;
}

export function clearResume(): void {
  try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
}
