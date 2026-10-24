# フェーズ 3a：単一ファイルの比較モード

## 使い方

```sh
npm run build
node dist/src/cli.js --output review.html -- docs/spec.md
node dist/src/cli.js --cached --output review.html -- docs/spec.md
node dist/src/cli.js HEAD~3 --output review.html -- docs/spec.md
node dist/src/cli.js main...feature --output review.html -- docs/spec.md
```

| 指定 | 比較元 | 比較先 |
|---|---|---|
| なし | index | 作業ツリー |
| `--cached` | HEAD | index |
| 単一リビジョン | 指定コミット | 作業ツリー |
| `base...tip` | base と tip の共通祖先 | tip |

リビジョンはコミット ID に解決し、比較元の本文取得とパッチ生成に同じ ID を使用する。三点比較は共通祖先と tip の二つのコミットを明示的に比較し、index や作業ツリーの変更を含めない。

変更前の本文に Git のパッチを適用して全文を復元する方法と、Git 設定の上書きは Ph2 を引き継ぐ。

## この段階の制限

- `--output` と、`--` 以降の単一 Markdown ファイルの指定が必要。
- 比較元にファイルが存在する場合を対象とする。新規追加、リネーム、変更ファイルの列挙は 3b で対応する。
- 初回コミット前の `--cached` は HEAD を解決できないためエラーになる。
- `--cached` とリビジョンの併用、複数リビジョン、二点範囲、省略形の `...tip`・`base...` は引数エラーとする。
- 作業ツリーまたは index を比較する場合、競合中の対象ファイルは従来どおりエラーにする。三点比較は index を参照しない。

## 確認結果

Node.js v24.22.1 で `npm test` を実行し、既存31件と追加5件の計36件が通った。

- HEAD・index・作業ツリーがそれぞれ異なるとき、既定・cached・指定コミットの各モードが正しい本文を比較する。
- 分岐した履歴で、三点比較は共通祖先から tip への変更を表示する。index・作業ツリーの変更を含まない。
- 各比較モードのポップアップ内容が、同条件の Git diff の hunk と一致する。
- 不正な引数の組み合わせと、存在しないリビジョンを非 `0` で通知する。
- cached・三点比較でも差分なしは正常終了し、HTML を生成しない。
- `..notes.md` をリポジトリ外と誤判定していたパス判定を修正し、回帰テストを追加した。

表示処理は変更していないため、このフェーズではブラウザの再確認は行っていない。複数ファイルの表示確認は 3c で行う。
