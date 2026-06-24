# アセット生成ツール（Gemini・無料）

戦国テーマ「100万石」のアイコン／駒／カード／背景を、**Google Gemini の無料APIキー**で生成し、
**背景透過 → 指定寸法へ縮小 → `out/` に保存**するツールです。
画風・寸法・ファイル名の正典は [`../../docs/reskin/ART_ASSET_SPEC.md`](../../docs/reskin/ART_ASSET_SPEC.md)。

> 仕組み: Gemini で生成（透過は不可なので単色背景で出力）→ `@imgly/background-removal-node` で
> 透過PNG化 → `sharp` で寸法調整。背景（`bg-*.jpg`）だけは不透明JPGで書き出します。

---

## 1. 無料APIキーを取得（クレカ不要）

1. <https://aistudio.google.com/apikey> を開く（Googleアカウントでログイン）
2. **「Create API key」** でキーを発行してコピー

無料枠の目安: **1日あたり約500枚**（`gemini-2.5-flash-image` / 通称 Nano Banana）。
本ツールのフルセット（約80枚）でも1日で十分収まります。

## 2. セットアップ

```powershell
cd tools/assetgen
npm install        # @google/genai, @imgly/background-removal-node, sharp を入れる
```

> 初回は背景除去モデル（数十MB）と sharp のバイナリを取得するため、少し時間がかかります。

## 3. キーを渡す（どちらか）

```powershell
# 方法A: 環境変数（このセッションのみ）
$env:GEMINI_API_KEY = "発行したキー"

# 方法B: .env ファイル（gitignore 済み・推奨）
#   tools/assetgen/.env に1行:
#   GEMINI_API_KEY=発行したキー
```

## 4. 実行

```powershell
# まず画風確認：資源5＋物産3 の8枚だけ（既定）
npm run gen

# 良ければ全部
node generate.mjs --all

# グループ指定 / キー直接指定
node generate.mjs --group=pieces,ck
node generate.mjs res-lumber settlement-red

# API不要のプレビュー（依存も不要）
npm run list      # 生成対象の一覧
npm run dry       # 各プロンプトを表示
```

生成物は `tools/assetgen/out/` に出ます。**`src/assets/` は直接上書きしません**（安全のため）。

## 5. 反映

`out/` の画風を確認してから、`src/assets/` へコピー（同名で上書き＝コードは触らず反映）:

```powershell
Copy-Item tools/assetgen/out/* src/assets/ -Force
npm run dev      # 盤面と「🖼 コマ・カード図鑑」で目視確認
```

問題なければコミット: `git add src/assets && git commit`。

---

## オプション一覧

| オプション | 説明 |
|---|---|
| `--all` | 全グループを生成 |
| `--group=a,b` | グループ指定（`resources,products,pieces,ck,knight-actions,backgrounds,tracks,card-backs,buildings,cards-pol,cards-sci,cards-com,actions,frame`） |
| `<key...>` | キー直接指定（例 `res-lumber city-red`） |
| `--out=DIR` | 出力先（既定 `./out`） |
| `--no-bgremove` | 背景除去をスキップ |
| `--model=NAME` | モデル上書き（既定 `gemini-2.5-flash-image`。新しい `gemini-3.x` 系が出ていれば指定可） |
| `--concurrency=N` | 並列数（既定3。レート制限が出るなら下げる） |
| `--overwrite` | `out/` の同名を作り直す（既定はスキップ＝再実行で続きから） |
| `--list` / `--dry-run` | 一覧／プロンプト確認（API・依存とも不要） |

## メモ・注意

- **`frame-decorative`** は中央を空ける装飾枠のため自動背景除去をOFFにしています（手直し前提）。
- 無料枠は**プロンプト等が品質改善に使われる場合あり**（Geminiの無料ティア仕様）。素材生成なら通常問題ありませんが、気になる場合は有料ティアを検討。
- レート上限（429）が出たら自動で待って再試行します。続けて出るなら `--concurrency=1` に。
- 失敗した分だけ作り直すには、`out/` の該当ファイルを消して同じコマンドを再実行（既定で既存はスキップ）。
