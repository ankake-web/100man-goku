// 3Dダイス(WebGL)の決定性検証: 出目に対応する面が必ず上(+Y)で静止することを担保する。
// ★物理ではなく目標姿勢で出目を表現する、の核。生産6面・イベント4結果すべてを厳密に確認。
import { describe, it, expect } from 'vitest';
import { Vector3, Quaternion } from 'three';
import {
  PROD_FACE_VALUE, EVENT_FACE_RESULT, FACE_NORMALS,
  productionTargetQuaternion, eventTargetQuaternion, frontFaceIndex, type EventResult,
} from '../src/renderer/diceGLMapping';

const FORWARD = new Vector3(0, 0, 1);

describe('3Dダイス面マッピング（決定性）', () => {
  it('生産ダイス: 各目の目標姿勢で、その目の面が正面(+Z)で静止する', () => {
    for (let v = 1; v <= 6; v++) {
      const q = productionTargetQuaternion(v);
      const front = frontFaceIndex(q);
      // 正面を向いた面の目＝渡された出目
      expect(PROD_FACE_VALUE[front]).toBe(v);
      // 法線がほぼ真正面（誤読しない）
      const n = FACE_NORMALS[front]!.clone().applyQuaternion(q);
      expect(n.dot(FORWARD)).toBeGreaterThan(0.999);
    }
  });

  it('生産ダイス: 向かい合う面の和が7（本物のダイス配置）', () => {
    expect(PROD_FACE_VALUE[0]! + PROD_FACE_VALUE[1]!).toBe(7); // ±X
    expect(PROD_FACE_VALUE[2]! + PROD_FACE_VALUE[3]!).toBe(7); // ±Y
    expect(PROD_FACE_VALUE[4]! + PROD_FACE_VALUE[5]!).toBe(7); // ±Z
  });

  it('イベントダイス: 各結果の目標姿勢で、その結果の面が正面(+Z)で静止する', () => {
    for (const r of ['ship', 'politics', 'science', 'trade'] as EventResult[]) {
      const q = eventTargetQuaternion(r);
      const front = frontFaceIndex(q);
      expect(EVENT_FACE_RESULT[front]).toBe(r);
      const n = FACE_NORMALS[front]!.clone().applyQuaternion(q);
      expect(n.dot(FORWARD)).toBeGreaterThan(0.999);
    }
  });

  it('イベントダイス: 船×3面＋政治/科学/商業ゲート×1面ずつ（6面の内訳）', () => {
    const count = (r: EventResult) => EVENT_FACE_RESULT.filter(x => x === r).length;
    expect(count('ship')).toBe(3);
    expect(count('politics')).toBe(1);
    expect(count('science')).toBe(1);
    expect(count('trade')).toBe(1);
  });

  it('正面軸(Z)回りの任意ロールを加えても正面=出目は不変（自然な散らし用）', () => {
    // 目標 * Zロール は正面の面を変えない（z成分が保存される）。
    for (let v = 1; v <= 6; v++) {
      const base = productionTargetQuaternion(v);
      const roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3);
      const composed = base.clone().multiply(roll);
      expect(PROD_FACE_VALUE[frontFaceIndex(composed)]).toBe(v);
    }
  });
});
