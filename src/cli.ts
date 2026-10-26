#!/usr/bin/env node
// git md-diff：Markdown の差分をレンダリングした HTML を生成する
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAssets } from './assets.js';
import { openBrowser } from './browser.js';
import { buildDocuments } from './changes.js';
import { repoRoot, toRepoPath, collectFileDiffs, type Comparison } from './git.js';
import { renderPage } from './render.js';

class UsageError extends Error {}

const HELP = `使い方: git md-diff [--cached | <リビジョン> | <base>...<tip>] [オプション] [-- <パス>...]

Markdown 文書の差分を、レンダリングした HTML で表示する。

比較対象:
  （指定なし）        index と作業ツリー
  --cached            HEAD と index
  <リビジョン>        指定コミットと作業ツリー
  <base>...<tip>      共通祖先と tip

オプション:
  --output <ファイル> HTML を指定ファイルに保存する（ブラウザは起動しない）
  --output -          HTML を標準出力に出す
  --open              保存後に既定のブラウザで開く
  --no-open           ブラウザを起動しない。一時ファイルの場合はそのパスを標準出力に出す
  --css <ファイル>    標準 CSS の後ろに追加する CSS
  -h, --help          この説明を表示する

出力先を省略すると一時ファイルに保存し、既定のブラウザで開く。一時ファイルは削除しない。
`;

interface Options {
  help: boolean;
  output?: string;
  open?: boolean;
  css?: string;
  paths: string[];
  comparison: Comparison;
}

function parseArgs(argv: string[]): Options {
  const sepIdx = argv.indexOf('--');
  const opts = sepIdx < 0 ? argv : argv.slice(0, sepIdx);
  const paths = sepIdx < 0 ? [] : argv.slice(sepIdx + 1);
  let output: string | undefined;
  let css: string | undefined;
  let open: boolean | undefined;
  let help = false;
  let cached = false;
  let revision: string | undefined;
  // 値を取るオプション。二回指定は誤りとする
  const value = (name: string, current: string | undefined, i: number, a: string): [string, number] => {
    if (current !== undefined) throw new UsageError(`${name} は一度だけ指定してください`);
    const [v, next] = a.startsWith(`${name}=`) ? [a.slice(name.length + 1), i] : [opts[i + 1], i + 1];
    if (!v) throw new UsageError(`${name} の値を指定してください`);
    return [v, next];
  };
  for (let i = 0; i < opts.length; i++) {
    const a = opts[i];
    if (a === '--output' || a.startsWith('--output=')) {
      [output, i] = value('--output', output, i, a);
    } else if (a === '--css' || a.startsWith('--css=')) {
      [css, i] = value('--css', css, i, a);
    } else if (a === '--open' || a === '--no-open') {
      if (open !== undefined && open !== (a === '--open')) throw new UsageError('--open と --no-open は併用できません');
      open = a === '--open';
    } else if (a === '-h' || a === '--help') {
      help = true;
    } else if (a === '--cached') {
      cached = true;
    } else if (!a.startsWith('-')) {
      if (revision !== undefined) throw new UsageError('リビジョンは一つだけ指定してください');
      revision = a;
    } else {
      throw new UsageError(`未対応の引数です: ${a}`);
    }
  }
  if (output === '-' && open) throw new UsageError('--output - と --open は併用できません');
  if (cached && revision !== undefined) throw new UsageError('--cached とリビジョンは併用できません');
  let comparison: Comparison = cached ? { kind: 'cached' } : { kind: 'worktree' };
  if (revision !== undefined) {
    if (revision.includes('..')) {
      const parts = revision.split('...');
      if (parts.length !== 2 || parts.some((p) => !p || p.includes('..'))) {
        throw new UsageError('範囲指定は base...tip の形式で指定してください');
      }
      comparison = { kind: 'three-dot', base: parts[0], tip: parts[1] };
    } else comparison = { kind: 'revision', ref: revision };
  }
  return { help, output, open, css, paths, comparison };
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const cwd = process.cwd();
  let css: string | undefined;
  if (opts.css !== undefined) {
    try {
      css = readFileSync(resolve(cwd, opts.css), 'utf8');
    } catch (e) {
      throw new Error(`CSS ファイルを読み込めません: ${(e as Error).message}`);
    }
    // 埋め込んだ style 要素が途中で閉じないよう、"</style" を含む CSS は受け付けない
    if (/<\/style/i.test(css)) throw new Error(`CSS ファイルに "</style" を含めることはできません: ${opts.css}`);
  }
  const root = repoRoot(cwd);
  const paths = opts.paths.map((path) => toRepoPath(root, cwd, path));
  const files = collectFileDiffs(root, opts.comparison, paths);
  if (files.length === 0) {
    console.error('差分はありません');
    return 0;
  }
  const html = renderPage(buildDocuments(files), loadAssets(), { customCss: css });
  if (opts.output === '-') {
    // head などで読み取り側が先に閉じても、エラーを表示せずに終わる
    process.stdout.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EPIPE') throw e;
    });
    process.stdout.write(html);
    return 0;
  }
  const temp = opts.output === undefined;
  let out: string;
  try {
    out = temp ? join(mkdtempSync(join(tmpdir(), 'git-md-diff-')), 'review.html') : resolve(cwd, opts.output!);
    writeFileSync(out, html);
  } catch (e) {
    throw new Error(`HTML を保存できません: ${(e as Error).message}`);
  }
  console.error(`${out} に保存しました`);
  // ブラウザは一時ファイルなら既定で開き、指定ファイルなら --open のときだけ開く
  const open = opts.open ?? temp;
  if (temp && !open) console.log(out);
  if (open) {
    try {
      await openBrowser(out);
    } catch (e) {
      throw new Error(`ブラウザを起動できません（${(e as Error).message}）。${out} を手動で開いてください`);
    }
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(`git md-diff: ${(e as Error).message}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  },
);
