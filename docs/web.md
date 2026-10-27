# ブラウザ用 JS（GitBucket プラグインとの共用）

CLI と同じ HTML をブラウザで生成するための JS。GitBucket プラグインは、このファイルを配信し、PR の差分データから表示を生成する。プラグインと計画（PLAN-GITBUCKET.md）は [gitbucket-mdp-plugin](https://github.com/VienosNotes/gitbucket-mdp-plugin) にある。

## ビルド

```sh
npm ci
npm run build:web   # dist/web/md-diff.js を生成する
```

- esbuild で `src/web.ts` を一つのファイルにまとめる。markdown-it、highlight.js（ソースの色付けに使う言語だけ）と、`assets/` の標準 CSS・JS も含まれる。
- 読み込むと、グローバル変数 `MdDiff` が定義される。依存する他のファイルはない。

## API

```js
const html = MdDiff.renderMarkdownDiff(data);
```

CLI が出力するものと同じ HTML（一つの完結した文書）を文字列で返す。同じ入力なら CLI の出力と一致する（`test/web.test.ts` で確認している）。

## データ形式

```json
{
  "title": "PR のタイトル #12",
  "files": [
    {
      "status": "M",
      "oldPath": "docs/a.md",
      "newPath": "docs/a.md",
      "oldText": "変更前の本文",
      "patch": "diff --git a/docs/a.md b/docs/a.md\n…\n@@ -1,3 +1,3 @@\n…"
    }
  ]
}
```

| 項目 | 内容 |
|---|---|
| `title` | 省略可。HTML の `<title>` に使う。省略時はファイル名またはファイル数 |
| `kind` | 省略可。`markdown`（既定）または `source`。`source` ではレンダリングせず、全行を行番号付きで表示する（[PLAN-SOURCE.md](../PLAN-SOURCE.md)） |
| `files` | 表示する変更ファイルの一覧。この順で表示する |
| `status` | `A`（追加）・`D`（削除）・`M`（変更）・`R`（リネーム） |
| `oldPath` | 変更前のパス。追加では `null` |
| `newPath` | 変更後のパス。削除では `null` |
| `oldText` | 変更前の本文。追加では空文字列。`null` のときは全文を復元せず、`patch` の hunk だけを表示する（大きすぎるファイル） |
| `patch` | 一ファイル分の unified diff。`@@` で始まる hunk ヘッダーより前の行は読み飛ばす。文脈は 3 行とする |
| `binary` | 省略可。`true` のときはバイナリファイルとして状態だけを表示する。`patch` は空文字列にする |

- 更新後の本文は、`oldText` に `patch` を当てて復元する。`patch` は `oldText` に対して正しく当たるものでなければならない（当たらない場合は例外になる）。
- 内容に変更のないリネームは、`patch` を空文字列（または hunk のないパッチ）にする。
- 型は `src/changes.ts` の `FileChange` と `src/web.ts` の `DiffData`。CLI の `collectFileDiffs`（`src/git.ts`）も同じ形式を返す。
- 形式を変える場合は、GitBucket プラグインも同時に更新する。

## 表示のしかた

生成した HTML は、`sandbox="allow-scripts"` を付けた iframe の `srcdoc` に設定して表示する。`allow-same-origin` は付けない。iframe 内のスクリプトは、親ページや親ページのオリジンの Cookie を参照できない。

```html
<iframe id="md-diff" sandbox="allow-scripts" title="Markdown Diff"></iframe>
<script type="application/json" id="md-diff-input">…データ（"<" を < にエスケープした JSON）…</script>
<script src="md-diff.js"></script>
<script>
  const data = JSON.parse(document.getElementById('md-diff-input').textContent);
  document.getElementById('md-diff').srcdoc = MdDiff.renderMarkdownDiff(data);
</script>
```

`npm run sample` で、この形の動作例 `out/web-demo.html` を生成する。

### sandbox 内での注意

- `srcdoc` の文書では、`#file-1` のようなページ内リンクが親ページの URL を基準に解決され、iframe ごと移動してしまう。そのため `assets/client.js` は、`#` で始まるリンクのクリックを受け取り、自前で該当要素までスクロールする。
- 本文中の外部リンクを押すと、iframe 自体がそのページへ移動する。GitBucket プラグインでは、iframe の `sandbox` に `allow-popups allow-popups-to-escape-sandbox` を加え、生成した HTML に `<base target="_blank">` を入れて、新しいタブで開くようにしている。
