# 3Dダイス演出（Cities & Knights）— 設計と実装メモ

旧「2D平面サイコロがくるくる回る＋最後に目をスロット式にすり替える」演出を廃し、
**本物の6面立方体を CSS 3D（`transform-style: preserve-3d`）で表現**し、決定済みの出目に
対応する面が正面で静止するように転がして着地させる。出目・抽選・蛮族判定のロジックは一切変更しない
（表示のみ）。外部ライブラリ不使用（CSS 3D transform + 既存 Web Audio SE）。

## 1. 出目はどこで決まり、どこへ渡るか

| 値 | 決定箇所 | state フィールド | 用途 |
|----|----------|------------------|------|
| 生産2ダイス d1(赤)/d2(黄) | `engine/dice.ts rollDice()` → `engine/game.ts ROLL_DICE` | `state.lastDiceRoll: [number, number]` | 合計=生産。**赤(d1)単体=進歩カード抽選のしきい値** |
| イベントダイス | `engine/citiesKnights.ts rollEventDie()` → `applyEventDie()` | `state.lastEventDie: 'ship' | CkTrack` | 船=蛮族前進 / 色=その色トラックの抽選 |
| 蛮族位置・襲来 | `applyEventDie()` / `resolveBarbarianAttack()` | `state.barbarianPosition`, `state.barbarianAttacks` | 結果演出（前進/襲来） |

演出のエントリは `src/main.ts`：
- `runWithDiceAnim(action, prevState, finish)` … `ROLL_DICE` のとき `playDiceRoll()` を呼ぶ。
- `buildDiceEventInfo(prev, next)` … CK 用の可視化情報（赤/抽選しきい値・蛮族前進・色別抽選照合）を導出。
- 演出は **値を受け取って見せるだけ**。`playDiceRoll` 内で乱数による出目の再決定はしない
  （タンブル中に乱数で目をすり替える旧実装＝スロット表現を撤廃）。

## 2. 立方体と面マッピング（厳密）

各立方体は6枚の面 `.cube-face` を CSS で配置（`--h` = 1辺/2）：

```
front  : translateZ(h)
back   : rotateY(180deg) translateZ(h)
right  : rotateY(90deg)  translateZ(h)
left   : rotateY(-90deg) translateZ(h)
top    : rotateX(90deg)  translateZ(h)
bottom : rotateX(-90deg) translateZ(h)
```

### 生産ダイス（赤/黄・象牙色＋ピップ）
面に**固定**で目を割り当てる（向かい合う面の和=7）。面は固定なので目のすり替えは起きない。

| 面 | 目 | 「その面を正面に出す」最終回転 [rotX,rotY] |
|----|----|--------------------------------------------|
| front | 1 | [0, 0] |
| bottom | 2 | [90, 0] |
| right | 3 | [0, -90] |
| left | 4 | [0, 90] |
| top | 5 | [-90, 0] |
| back | 6 | [0, 180] |

各 show 回転は**単軸のみ**。アニメ用に各軸へ 360°×整数 の回転を足しても、満回転は恒等変換なので
着地面は厳密に一致する（= 渡された出目と静止面が常に一致）。

### イベントダイス（濃い石/木・船とゲート記号）
6面 = 船×3 ＋ 色ゲート×3（青=政治 / 緑=科学 / 黄=商業）。

| 面 | 結果 | 記号 | show回転 [rotX,rotY] |
|----|------|------|----------------------|
| front/back/right | ship | 蛮族船アート | [0,0]（front を正面に） |
| left | trade（商業） | 黄ゲート「商」 | [0, 90] |
| top | politics（政治） | 青ゲート「政」 | [-90, 0] |
| bottom | science（科学） | 緑ゲート「科」 | [90, 0] |

結果が `ship` の場合は front（船面）を正面に。色は対応面を正面へ。静止面で船/青/緑/黄が誤読なく判別できる。

## 3. アニメーション

- **イージング非線形**：`cubic-bezier(0.16,0.74,0.18,1.04)`（速く回って減速＋末尾でわずかにオーバーシュート）。
- 開始姿勢を「着地姿勢＋360°×数回転＋わずかな傾き」に置き、着地姿勢へ transition。X・Y 両軸が同時に
  回るため角度のついたタンブルになり、最後に目的面へスナップして静止する。
- 回転中は `filter: blur(0.5px)`、着地で除去（輪郭がシャープに）。
- 着地で `cubeLand`（1〜2px の微バウンド）と影の収縮（`.dice-shadow` を scale 1.7→1.0、影が締まる）。
- 着地リング `diceRing`（赤/黄は自色、イベントは結果色で強め）。

## 4. 段階演出（3個同時確定をやめる）

着地時刻（normal、`fxSpeed` で 0.62x/1.4x）：
1. **赤** … 約1000ms で先着地（軽いクラッタ音 `dice`）。
2. **黄** … 約1150ms（赤＋約150ms 遅れ）。赤＋黄が揃った瞬間に **生産合計** をポップ表示。
3. **イベント** … 約1380ms（さらに遅れ・持続も長い＝見せ場）。重い着地音 `diceLandHeavy`。
4. 着地後に結果パネル（`buildEventResolutionPanel`）：
   - **船** → 蛮族トラック前進表示＋（残り1〜2マス/襲来で）`board-shake-danger` の画面揺れ。
   - **色ゲート** → `dice-color-wash` で画面にその色が広がり、抽選照合（赤≤Lv+1 で引けるプレイヤーを強調）。
- ターンパネルの常時表示チップは、色ゲートのターンは**赤チップを強調**（赤＝抽選しきい値）。

## 5. アクセシビリティ / レイアウト
- `prefers-reduced-motion` … 回転を省き即着地（出目の正しさは維持）。
- `fxSpeed()==='instant'` … 演出スキップ。
- 立方体サイズ `clamp(54px,16vw,74px)` でスマホ縦でも3個が破綻なく収まる。タップでロール（既存 `🎲 ダイスを振る`）。

## 6. 受け入れ自己チェック
- [x] 旧2D `.dice-die`/`diceTumble`/スロット式すり替えを撤廃し3D立方体に置換。
- [x] 静止面＝渡された出目（単軸 show 回転＋満回転加算で厳密一致）。
- [x] イベントダイス静止面で 船/青/緑/黄 を判別可能。
- [x] 赤→黄→イベントの時間差着地、イベントが最後。
- [x] 船→トラック前進＋揺れ / 色→色 wash＋抽選ハイライト の分岐。
- [x] ロジック（抽選条件 赤≤Lv+1・蛮族判定）不変。

## 7. 残課題 / メモ
- 効果音は Web Audio 合成（音声ファイル無し）。`diceLandHeavy` を新規追加（イベント着地の重い音）。
- 影・色 wash は `#board-area` に対する相対配置。パン/ズーム変換は内側 `<g.board-viewport>` にあるため
  `#board-area` への一時 transform（揺れ）と競合しない。
</content>
</invoke>
