// Git の呼び出し。出力がユーザーの Git 設定に左右されないよう、関係する設定を上書きする
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { FileChange } from './changes.js';
import { parsePatch } from './diff.js';

export class GitError extends Error {}

export type Comparison =
  | { kind: 'worktree' }
  | { kind: 'cached' }
  | { kind: 'revision'; ref: string }
  | { kind: 'three-dot'; base: string; tip: string };

const CONFIG_OVERRIDES = [
  '-c', 'core.quotePath=false',
  '-c', 'diff.suppressBlankEmpty=false',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
  '-c', 'diff.relative=false',
];

// 文脈の行数と hunk の結合は固定する。diff.algorithm はユーザーの設定に従う
const DIFF_OPTIONS = [
  '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--find-renames=50%', '-l0',
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
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
    throw new GitError(`リポジトリ外のパスです: ${path}`);
  }
  return rel === '' ? '.' : rel.split(sep).join('/');
}

// Git のパスは NUL 区切りで取得し、引用符や改行を含む名前もそのまま保持する
export type ChangedFile = FileChange;

function resolveComparison(root: string, comparison: Comparison): { source: string; revisions: string[] } {
  const commit = (ref: string) => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], root).trim();
  if (comparison.kind === 'cached') {
    let source: string;
    try {
      source = commit('HEAD');
    } catch {
      // 初回コミット前は空のツリーと比較する。オブジェクトは書き込まない
      git(['symbolic-ref', 'HEAD'], root);
      source = git(['hash-object', '-t', 'tree', '--stdin'], root).trim();
    }
    return { source, revisions: ['--cached', source] };
  }
  if (comparison.kind === 'revision') {
    const source = commit(comparison.ref);
    return { source, revisions: [source] };
  }
  if (comparison.kind === 'three-dot') {
    const base = commit(comparison.base);
    const tip = commit(comparison.tip);
    const source = git(['merge-base', base, tip], root).trim();
    return { source, revisions: [source, tip] };
  }
  return { source: '', revisions: [] };
}

const isMarkdown = (path: string | null) => path !== null && /\.(md|markdown)$/i.test(path);

// 'markdown' は Markdown のファイル、'source' はそれ以外のファイルを対象にする（--source）
export type Target = 'markdown' | 'source';

// ソースの表示で、全文を表示せず hunk だけを表示するファイルの大きさ（変更前または変更後）
const LARGE_LINES = 5000;
const LARGE_BYTES = 512 * 1024;
const matchesPaths = (path: string | null, paths: string[]) => path !== null &&
  (paths.length === 0 || paths.some((p) => p === '.' || path === p || path.startsWith(`${p}/`)));

// 変更前または変更後が大きすぎるか。変更後の大きさは、変更前の本文とパッチの増減から求める
function isLarge(oldText: string, patch: string): boolean {
  const size = (text: string) => Buffer.byteLength(text, 'utf8') + 1;
  let lines = oldText === '' ? 0 : oldText.split('\n').length - (oldText.endsWith('\n') ? 1 : 0);
  let bytes = Buffer.byteLength(oldText, 'utf8');
  if (lines > LARGE_LINES || bytes > LARGE_BYTES) return true;
  for (const hunk of parsePatch(patch)) {
    for (const l of hunk.lines) {
      if (l.mark === '+') {
        lines++;
        bytes += size(l.text);
      } else if (l.mark === '-') {
        lines--;
        bytes -= size(l.text);
      }
    }
  }
  return lines > LARGE_LINES || bytes > LARGE_BYTES;
}

// リネーム検出は全体に対して行い、その後で変更前後どちらかのパスで絞り込む
export function collectFileDiffs(root: string, comparison: Comparison, paths: string[] = [], target: Target = 'markdown'): ChangedFile[] {
  const isTarget = (path: string | null) => path !== null && isMarkdown(path) === (target === 'markdown');
  const { source, revisions } = resolveComparison(root, comparison);
  const args = ['diff', ...DIFF_OPTIONS, ...revisions];
  const fields = git([...args, '--name-status', '-z', '--'], root).split('\0');
  fields.pop();
  let changes: { status: string; oldPath: string | null; newPath: string | null }[] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    const path = fields[i++];
    if (path === undefined) throw new GitError('変更ファイル一覧の形式が不正です');
    if (status.startsWith('R')) {
      const next = fields[i++];
      if (next === undefined) throw new GitError('リネーム情報の形式が不正です');
      changes.push({ status: 'R', oldPath: path, newPath: next });
    } else {
      changes.push({ status, oldPath: status === 'A' ? null : path, newPath: status === 'D' ? null : path });
    }
  }
  // Markdown は変更前後のどちらかが Markdown なら対象。ソースはそれ以外のすべて
  const selected = (c: typeof changes[number]) =>
    (target === 'markdown' ? isMarkdown(c.oldPath) || isMarkdown(c.newPath) : !isMarkdown(c.oldPath) && !isMarkdown(c.newPath)) &&
    (matchesPaths(c.oldPath, paths) || matchesPaths(c.newPath, paths));
  // 競合中は diff に現れない場合もあるため、index を別途調べる
  const conflictPaths = new Set<string>();
  if (comparison.kind !== 'three-dot') {
    const conflicts = git(['ls-files', '-u', '-z'], root).split('\0').filter(Boolean);
    for (const entry of conflicts) {
      const path = entry.slice(entry.indexOf('\t') + 1);
      conflictPaths.add(path);
      if (isTarget(path) && matchesPaths(path, paths)) {
        throw new GitError(`競合中のファイルには対応していません: ${path}`);
      }
    }
  }
  // 対象外の競合が出力する combined diff は、通常のパッチ列に含めない
  changes = changes.filter((c) => !conflictPaths.has(c.oldPath ?? '') && !conflictPaths.has(c.newPath ?? ''));
  if (!changes.some(selected)) return [];
  // 同じ全体比較から生成したパッチをファイル順に対応付ける。
  // 本文行には必ず diff の接頭文字が付くため、この境界とは衝突しない
  const patchPaths = conflictPaths.size === 0 ? [] : [...new Set(changes.flatMap((c) => [c.oldPath, c.newPath].filter((p): p is string => p !== null)))];
  const patch = git([...args, '--patch', '--', ...patchPaths], root);
  const patches = patch.split(/^(?=diff --git )/m).filter(Boolean);
  if (patches.length !== changes.length) throw new GitError('変更ファイル一覧とパッチが一致しません');
  const result: ChangedFile[] = [];
  changes.forEach((c, i) => {
    if (!selected(c)) return;
    if (!['A', 'D', 'M', 'R'].includes(c.status)) {
      throw new GitError(`未対応の変更種別です: ${c.status} ${c.newPath ?? c.oldPath}`);
    }
    const status = c.status as ChangedFile['status'];
    if (/^(Binary files .* differ|GIT binary patch)$/m.test(patches[i])) {
      // ソースではバイナリも珍しくないため、エラーにせず状態だけを表示する
      if (target === 'source') {
        result.push({ ...c, status, oldText: '', patch: '', binary: true });
        return;
      }
      throw new GitError(`バイナリファイルには対応していません: ${c.newPath ?? c.oldPath}`);
    }
    const blob = `${source}:${c.oldPath}`;
    // 大きすぎる変更前の本文は読み込まない
    if (target === 'source' && c.oldPath !== null && Number(git(['cat-file', '-s', blob], root)) > LARGE_BYTES) {
      result.push({ ...c, status, oldText: null, patch: patches[i] });
      return;
    }
    const oldText = c.oldPath === null ? '' : git(['cat-file', 'blob', blob], root);
    const large = target === 'source' && isLarge(oldText, patches[i]);
    result.push({ ...c, status, oldText: large ? null : oldText, patch: patches[i] });
  });
  return result;
}
