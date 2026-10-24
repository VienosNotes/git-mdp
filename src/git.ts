// Git の呼び出し。出力がユーザーの Git 設定に左右されないよう、関係する設定を上書きする
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export class GitError extends Error {}

const CONFIG_OVERRIDES = [
  '-c', 'core.quotePath=false',
  '-c', 'diff.suppressBlankEmpty=false',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
  '-c', 'diff.relative=false',
];

// 文脈の行数と hunk の結合は固定する。diff.algorithm はユーザーの設定に従う
const DIFF_OPTIONS = [
  '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
  '-U3', '--inter-hunk-context=0', '--src-prefix=a/', '--dst-prefix=b/',
];

export function git(args: string[], cwd: string): string {
  const r = spawnSync('git', ['--literal-pathspecs', ...CONFIG_OVERRIDES, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (r.error) throw new GitError(`git を実行できません: ${r.error.message}`);
  if (r.status !== 0) throw new GitError(`git ${args[0]} に失敗しました: ${r.stderr.trim()}`);
  return r.stdout;
}

export function repoRoot(cwd: string): string {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch {
    throw new GitError('Git リポジトリ内で実行してください');
  }
}

// 実行ディレクトリからのパスを、リポジトリのルートからの '/' 区切りのパスにする
export function toRepoPath(root: string, cwd: string, path: string): string {
  const rel = relative(realpathSync(root), resolve(realpathSync(cwd), path));
  if (rel === '' || rel.startsWith('..') || resolve(rel) === rel) {
    throw new GitError(`リポジトリ外のパスです: ${path}`);
  }
  return rel.split(sep).join('/');
}

// index と作業ツリーを比較する一ファイル分の変更前の本文とパッチ
export function worktreeDiff(root: string, path: string): { oldText: string; patch: string } {
  const tracked = git(['ls-files', '-z', '--', path], root).split('\0').filter((p) => p !== '');
  if (tracked.length !== 1 || tracked[0] !== path) {
    throw new GitError(`追跡されているファイルではありません: ${path}`);
  }
  if (git(['ls-files', '-u', '--', path], root) !== '') {
    throw new GitError(`競合中のファイルには対応していません: ${path}`);
  }
  const patch = git(['diff', ...DIFF_OPTIONS, '--', path], root);
  if (/^(Binary files .* differ|GIT binary patch)$/m.test(patch)) {
    throw new GitError(`バイナリファイルには対応していません: ${path}`);
  }
  return { oldText: git(['cat-file', 'blob', `:${path}`], root), patch };
}
