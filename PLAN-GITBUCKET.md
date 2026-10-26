# GitBucket プラグイン実装計画

## 目的と進め方

GitBucket の Pull Request から、本ツールの表示（Markdown の差分をレンダリングした全文表示）を開けるようにする。REQUIREMENTS.md の「GitBucket プラグイン」の案を具体化したもの。

CLI と同様に、各フェーズのゲートを満たしてから次へ進み、未対応事項と確認結果を短く記録する。CLI は単体でも引き続き使うため、CLI の動作を変えずに描画処理を共用する。

この計画書は、プラグインのリポジトリを作成するまで git-mdp に置く。作成後はプラグインのリポジトリへ移し、git-mdp 側の作業（フェーズ G0）の記録だけを git-mdp に残す。

## 決定事項

| 項目 | 決定 | 理由 |
|---|---|---|
| 導線 | PR 画面のタブ列に「Markdown Diff」を追加し、全画面の表示を開く（案 1）。GitBucket のヘッダーや PR のタブ列は表示しない | GitBucket に PR のタブを追加する拡張点がない。PR 画面のテンプレートの流用は内部実装への依存が強い |
| 描画する場所 | ブラウザ | サーバーに Node.js や git を必要としない。CLI と描画処理を共用できる |
| 描画結果の隔離 | `sandbox` 付きの iframe に表示する（`allow-same-origin` は付けない） | 他人が書いた Markdown を GitBucket のログインセッションと切り離して描画する |
| 差分の取得 | プラグインが JGit で取得する | GitBucket が使う Git 実装で、サーバーに git コマンドがあるとは限らない |
| リポジトリ | プラグインは別リポジトリとし、git-mdp をサブモジュールとして持つ | CLI のリポジトリに Scala を持ち込まない。プラグインが使う描画処理の版を固定できる |
| 対象の GitBucket | 最新版（調査時点の 4.48.0） | 利用環境をこれから最新に更新する |

## 構成

```
gitbucket-md-diff-plugin/          … プラグインのリポジトリ（名前は仮）
  git-mdp/                         … サブモジュール
  src/main/scala/...               … Plugin 定義、コントローラ（Scala）
  src/main/resources/...           … ブラウザ用 JS の置き場（ビルド時に生成してコピー）
  build.sbt, project/plugins.sbt   … sbt-gitbucket-plugin を使う
```

処理の流れ：

1. PR 画面に差し込んだ JS が、タブ列（`#pullreq-tab`）に「Markdown Diff」を追加する。
2. タブのリンク先 `/:owner/:repository/pull/:id/markdown-diff` で、プラグインのコントローラが PR の比較元・比較先のコミット（`commitIdFrom`、`commitIdTo`）を取得する。
3. JGit で両コミット間の Markdown ファイルの変更を列挙し、ファイルごとに変更種別、変更前後のパス、変更前の本文、パッチを取得する。
4. 取得したデータを JSON としてページに埋め込む。ページは、PR へ戻るリンクを含む見出しと、`sandbox` 付きの iframe だけで構成する。
5. ページ上でブラウザ用 JS が JSON から HTML（CLI の出力と同じもの）を生成し、iframe の `srcdoc` に設定する。マークやポップアップなどの JS は iframe 内で動く。

`commitIdFrom` は分岐点のコミットで、CLI の `base...tip` の比較元と同じ意味を持つ。fork からの PR も、比較先は base 側のリポジトリの `refs/pull/<番号>/head` に取り込まれているため、base 側のリポジトリだけで取得できる。Files Changed タブも同じ二つのコミットを比較している。

### プラグインと描画処理の間のデータ形式

CLI の `collectFileDiffs` が返す形式に合わせる。

```json
{
  "title": "PR のタイトル #12",
  "files": [
    { "status": "M", "oldPath": "docs/a.md", "newPath": "docs/a.md", "oldText": "…", "patch": "diff --git …\n@@ -1,3 +1,3 @@\n…" }
  ]
}
```

- `status` は `A`・`D`・`M`・`R` のいずれか。追加では `oldPath` が `null`、削除では `newPath` が `null`。
- `patch` は一ファイル分の unified diff。文脈は 3 行とする。
- 形式は git-mdp 側で定義・文書化し、変更するときは両リポジトリを同時に更新する。

## フェーズ一覧

| フェーズ | 主な成果物 | 次へ進むためのゲート | 状態 |
|---|---|---|---|
| G0. 描画処理の共用準備（git-mdp） | ブラウザ用 JS とデータ形式の文書 | CLI の動作を変えずに、ブラウザで CLI と同じ HTML を生成できる | **完了**（[記録](docs/web.md)） |
| G1. プラグインの土台 | 読み込めるプラグインの jar とビルド手順 | 利用する GitBucket に導入でき、ブラウザ用 JS を配信できる | 未着手 |
| G2. 差分データの取得 | PR の差分を返すコントローラ | PR の Markdown の変更を漏れなく、正しい内容で取得できる | 未着手 |
| G3. 表示画面と導線 | Markdown Diff タブと表示画面 | PR 画面から開いて、CLI と同じ操作でレビューできる | 未着手 |
| G4. 実運用での受け入れ | 導入・更新手順と初版 | 実際の PR のレビュー補助として使える | 未着手 |

## フェーズ G0：描画処理の共用準備（git-mdp）

### 実装すること

- `render.ts` が CSS・JS のファイルを Node.js の `fs` で読み込む処理を外し、標準の CSS・JS を引数で受け取れるようにする。CLI からは従来どおりファイルを読み込んで渡す。
- CLI の `main` にある「取得した変更から描画用のデータを作る」処理を共通部分に移し、CLI とブラウザ用の入口で共用する。
- ブラウザ用の入口（`src/web.ts`）を追加し、上記のデータ形式から HTML を生成する関数を公開する。
- `npm run build:web` で、markdown-it と標準の CSS・JS を含む一つの JS ファイルを生成する。バンドラーには esbuild を使う（開発用の依存として追加）。
- データ形式を文書化する。

### ゲート

- 既存のテストがすべて通り、CLI の出力が変わらない。
- 同じ入力に対し、ブラウザ用 JS が生成する HTML と CLI が生成する HTML が一致する。
- ブラウザ用 JS を読み込んだページで、生成した HTML を iframe（`sandbox="allow-scripts"`）に表示し、マーク・ポップアップ・目次・折りたたみなどが動く。

### 結果：完了

- `render.ts` からファイルの読み込みを外し、標準の CSS・JS を引数で受け取るようにした。CLI は `assets.ts` で読み込んで渡す。
- 変更一覧から描画用の文書を作る処理を `changes.ts`（`buildDocuments`）に移し、CLI とブラウザ用の入口で共用する。
- ブラウザ用の入口 `src/web.ts`（`MdDiff.renderMarkdownDiff`）と、`npm run build:web`（esbuild）を追加した。生成物は `dist/web/md-diff.js`（約 285KB、圧縮なし）。
- データ形式と表示のしかたを [docs/web.md](docs/web.md) に記載した。
- 全フィクスチャと複数ファイル（追加・削除・リネームを含む）で、ブラウザ用 JS と CLI の HTML が一致することをテストで確認した（計58テスト）。
- `npm run sample` で生成する `out/web-demo.html`（sandbox 付きの iframe での表示例）を Chromium で開き、マーク・ポップアップ・前後の hunk への移動・目次・折りたたみ・表示モードの切り替えが動くこと、iframe 内から親ページと Cookie を参照できないこと（SecurityError、オリジンは `null`）を確認した。
- sandbox 内では、ページ内リンク（`#file-1` など）が親ページの URL を基準に解決され、iframe ごと移動してしまう問題が見つかった。`assets/client.js` で `#` で始まるリンクを自前でスクロールするよう修正した（CLI の動作は変わらない）。

## フェーズ G1：プラグインの土台

### 実装すること

- プラグインのリポジトリを作成し（作成は利用者）、git-mdp をサブモジュールとして追加する。
- gitbucket-plugin-template を元に、sbt のプロジェクトと Plugin 定義を作る。
- ビルド手順を一つのスクリプトにまとめる：サブモジュールで `npm ci && npm run build:web` → 生成した JS をプラグインのリソースへコピー → `sbt assembly`。
- `assetsMappings` でブラウザ用 JS を配信する。
- 導入手順（jar を `GITBUCKET_HOME/plugins` に置いて再起動）を README に書く。

### ゲート

- 利用する GitBucket（最新版）にプラグインを導入でき、プラグイン一覧に表示される。
- 配信したブラウザ用 JS を、GitBucket の URL から取得できる。
- サブモジュールを含めてクローンし直しても、記載した手順でビルドできる。

## フェーズ G2：差分データの取得

### 実装すること

- コントローラに `/:owner/:repository/pull/:id/markdown-diff` を追加し、PR の `commitIdFrom` と `commitIdTo` を取得する。
- 閲覧権限は GitBucket 本体の PR 画面と同じ扱いにする（本体と同じ権限確認の仕組みを使う）。
- JGit の `DiffFormatter` で、文脈 3 行の unified diff を取得する。リネーム検出を有効にし、変更前後どちらかのパスが `.md`・`.markdown` の変更を対象とする。
- 変更前の本文を、比較元のコミットから取得する。
- バイナリとして扱われるファイルは、対象外として一覧に状態だけを示すか、エラーにするかを決める（CLI ではエラーにしている）。
- 文字コードは UTF-8 として扱う。

### ゲート

- 追加・削除・変更・リネームを含む PR で、対象の Markdown ファイルに欠落や重複がない。
- fork からの PR と、マージ・クローズ済みの PR でも取得できる。
- 各ファイルのパッチと変更前の本文から、比較先の本文を復元できる（CLI と同じ復元処理で確認する）。
- 閲覧権限のない利用者が、非公開リポジトリの差分を取得できない。

## フェーズ G3：表示画面と導線

### 実装すること

- 表示画面：PR のタイトルと PR へ戻るリンクを含む見出しを置き、その下に `sandbox` 付きの iframe を画面いっぱいに表示する。
- 取得したデータを JSON としてページに埋め込む。`<` などをエスケープし、HTML の構造が壊れないようにする。
- `javaScripts` で PR 画面（Conversation、Commits、Files Changed）に JS を差し込み、タブ列に「Markdown Diff」を追加する。
- Markdown の変更がない PR では、表示画面で「Markdown ファイルの変更はありません」と表示する。タブは常に表示する（タブ表示のたびに差分を計算しないため）。

### ゲート

- 各 PR 画面のタブ列に「Markdown Diff」が表示され、表示画面に移動できる。
- 表示画面で、CLI と同じ操作（マーク、ポップアップ、表示モードの切り替え、前後の hunk への移動、目次、折りたたみ）ができる。
- 描画結果が iframe の中で GitBucket のオリジンと切り離されている（iframe 内のスクリプトから親ページや GitBucket の Cookie を参照できない）。

## フェーズ G4：実運用での受け入れ

### 実施すること

- 実際の PR で一通り使い、ファイル数・hunk 数・表示までの時間・操作感を記録する。
- 導入・更新の手順を README に記載する。git-mdp の更新を取り込む手順（サブモジュールの更新 → ビルド → 再導入）も含める。
- GitBucket を更新したときの確認事項（タブの差し込みが効くか、プラグインが読み込まれるか）を記載する。

### ゲート

- 実際の PR のレビュー補助として、CLI と同等に使える。
- 記載した手順で導入・更新でき、既知の制限を利用者が把握できる。

## 実装前または該当フェーズで相談する事項

- iframe 内のリンクの扱い。`sandbox` の中では、通常のリンクは iframe 自体の移動になる。外部リンクを新しいタブで開けるようにするか（`allow-popups` の追加など）を G3 で決める。
- バイナリとして扱われるファイルの扱い（G2）。
- 相対パスの画像の表示。GitBucket 上ではリポジトリのファイルの URL に置き換えられるため、CLI より実現しやすい。初版の後に必要性を確認する。

## 既知のリスク

- タブの追加は、GitBucket の PR 画面の HTML 構造（`#pullreq-tab`）に依存する。GitBucket の更新で構造が変わると、タブが表示されなくなる。表示画面の URL は直接開けるので、レビュー自体は続けられる。
- プラグインは特定の GitBucket のバージョン向けにビルドする。GitBucket を更新したら動作確認し、必要なら再ビルドする。
- JGit と git コマンドでは、既定の diff アルゴリズムが異なることがある。hunk の切れ目が CLI の出力や `git diff` と一致しない場合があるが、どちらも正しい差分なので許容する。
- 描画には markdown-it を使うため、GitBucket 本体のファイル表示とは細部の描画が異なることがある。

## 初版では行わないこと

- GitBucket のヘッダーや PR のタブ列を表示画面に表示すること（案 2）。
- タブに Markdown の変更件数を表示すること。
- PR 以外の画面（コミット比較画面など）からの表示。
- サーバー側での HTML の生成。
