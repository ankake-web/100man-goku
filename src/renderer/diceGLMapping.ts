// ============================================================
// src/renderer/diceGLMapping.ts
// 3Dダイス(WebGL)の「面→値」マッピングと、出目に対応する面を正面(カメラ側=+Z)へ向ける
// 目標クォータニオン。★決定性の核: 物理ではなく、ここで決めた目標姿勢へ必ず着地させる。
// カメラはやや上・前方にあるため、結果は「正面の面」に出すと最も読みやすい（上面は補助的に見える）。
// three の数学クラスのみ使用（DOM不要）。tests/diceGLMapping.test.ts で厳密検証する。
// ============================================================
import { Quaternion, Vector3 } from 'three';

const FORWARD = new Vector3(0, 0, 1); // カメラ側（正面）

// RoundedBoxGeometry / BoxGeometry のマテリアル面インデックス順 → ローカル面法線。
//   0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export const FACE_NORMALS: ReadonlyArray<Vector3> = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

// 生産ダイス: 面インデックス→目（向かい合う面の和=7）。
//   +X=3 / -X=4 / +Y=5 / -Y=2 / +Z=1 / -Z=6
export const PROD_FACE_VALUE: ReadonlyArray<number> = [3, 4, 5, 2, 1, 6];

export type EventResult = 'ship' | 'politics' | 'science' | 'trade';
// イベントダイス: 面インデックス→結果（船×3＋ゲート×3）。
//   +X=科学 / -X=商業 / +Y=船 / -Y=政治 / +Z=船 / -Z=船
export const EVENT_FACE_RESULT: ReadonlyArray<EventResult> = [
  'science', 'trade', 'ship', 'politics', 'ship', 'ship',
];

/** 目Vの面を正面(+Z)へ向ける基準クォータニオン（ピップは回転対称なので最短回転でよい）。 */
export function productionTargetQuaternion(value: number): Quaternion {
  const i = PROD_FACE_VALUE.indexOf(value);
  if (i < 0) return new Quaternion();
  return new Quaternion().setFromUnitVectors(FACE_NORMALS[i]!.clone(), FORWARD);
}

/** 結果に対応する面を正面(+Z)へ向ける目標クォータニオン（紋章/船が正立する軸を選ぶ）。 */
export function eventTargetQuaternion(result: EventResult): Quaternion {
  switch (result) {
    case 'ship':     return new Quaternion();                                                    // +Z(船)をそのまま正面
    case 'politics': return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2); // -Y→+Z
    case 'science':  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2); // +X→+Z
    case 'trade':    return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0),  Math.PI / 2); // -X→+Z
  }
}

/** ある姿勢で「最も正面(+Z)を向いている面」のインデックス（検証/アサート用）。 */
export function frontFaceIndex(q: Quaternion): number {
  let best = -1, bestZ = -Infinity;
  for (let i = 0; i < FACE_NORMALS.length; i++) {
    const z = FACE_NORMALS[i]!.clone().applyQuaternion(q).z;
    if (z > bestZ) { bestZ = z; best = i; }
  }
  return best;
}
