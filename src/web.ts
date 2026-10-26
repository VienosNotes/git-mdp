// ブラウザ用の入口。scripts/build-web.mjs で dist/web/md-diff.js にまとめ、
// グローバル変数 MdDiff として公開する
import { buildDocuments, type FileChange } from './changes.js';
import { renderPage } from './render.js';

// ビルド時に assets/ の標準 CSS と JS を埋め込む
declare const __MD_DIFF_CSS__: string;
declare const __MD_DIFF_JS__: string;

export interface DiffData {
  title?: string;
  files: FileChange[];
}

// CLI と同じ HTML を文字列で返す。iframe の srcdoc などに設定して表示する
export function renderMarkdownDiff(data: DiffData): string {
  return renderPage(buildDocuments(data.files), { css: __MD_DIFF_CSS__, js: __MD_DIFF_JS__ }, { title: data.title });
}
