# フェーズ 2：Git 連携の最小実装

## 使い方

```
npm install
npm run build
node dist/src/cli.js --output review.html -- docs/spec.md
```

- index と作業ツリーを比較し、指定した一つの Markdown ファイルの差分を HTML に保存する。
- パスは実行ディレクトリからの相対パスで指定する。リポジトリのサブディレクトリからも実行できる。
- 差分がなければ標準エラー出力に通知し、HTML を生成せずに終了コード `0` で終わる。
- 引数の誤りは終了コード `2`、Git の失敗やファイルの読み書きの失敗は `1` で終わる。
- `git md-diff` として呼び出す導入手順はフェーズ 5 で用意する。

## 本文と差分の取得

- 変更前の本文は index から取得し（`git cat-file blob :<path>`）、更新後の本文は変更前の本文にパッチを当てて復元する。作業ツリーのファイルは直接読まない。
- パッチの解析は、hunk ヘッダーの行数に従って読み進める。

## Git 設定の固定

ユーザーの Git 設定で出力が変わらないよう、次の指定で Git を呼び出す（`src/git.ts`）。

| 指定 | 目的 |
|---|---|
| `-U3`、`--inter-hunk-context=0` | 文脈の行数と hunk の結合を固定する（`diff.context`、`diff.interHunkContext` を無視） |
| `--no-color`、`--no-ext-diff`、`--no-textconv` | 色付け、外部 diff、textconv を無効にする |
| `--no-renames` | リネーム検出を無効にする（フェーズ 3 で扱う） |
| `--src-prefix=a/`、`--dst-prefix=b/` | `diff.noprefix`、`diff.mnemonicPrefix` を無視する |
| `-c core.quotePath=false` 等 | パスのクォート、空の文脈行の出力形式、相対パス表示を固定する |
| `--literal-pathspecs` | 指定したパスを glob として解釈しない |

`diff.algorithm` はユーザーの設定に従う。hunk の切れ目が手元の `git diff` と一致する。

## 対応しない入力

次の場合はエラーとして通知する。

- リポジトリ外での実行、リポジトリ外のパス
- 追跡されていないファイル、存在しないファイル、ディレクトリ
- 拡張子が `.md`・`.markdown` 以外のファイル
- 競合中のファイル、バイナリとして扱われるファイル

文字コードは UTF-8 のみを対象とする。先頭の BOM は描画時に取り除く。

## 確認したこと

`test/git.test.ts` で一時リポジトリを作り、次を確認した。テストは `GIT_CONFIG_GLOBAL` と `GIT_CONFIG_NOSYSTEM` で手元の Git 設定から隔離している。

- HEAD・index・作業ツリーの内容がそれぞれ異なるとき、index と作業ツリーを比較している。
- 複数 hunk、先頭・末尾の変更、末尾改行の削除・追加で、ポップアップの内容が同じ条件で実行した `git diff` の hunk と一致する。改行に関する注記を本文として表示しない。
- 差分の前後を含む全文が HTML に含まれる。
- 出力に影響する Git 設定（`diff.suppressBlankEmpty`、`diff.noprefix`、`diff.relative`、`diff.context`、`diff.interHunkContext`、`diff.external`、`color.ui` など）を有効にしても、生成結果が変わらない。
- サブディレクトリからの実行と、日本語・空白を含むパス。
- 作業ツリーで削除したファイルを全文の削除として表示する。
- 差分なし、および各種エラーの終了コードとメッセージ。

## 気づいた点

- diff ポップアップがマークの右に開くため、対応する本文の変更箇所に重なって隠れる。フェーズ 5 の実文書での確認時に、表示位置を調整するか判断する。
