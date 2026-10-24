#!/usr/bin/env node
// git md-diff：Markdown の差分をレンダリングした HTML を生成する
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFileDiff } from './diff.js';
import { repoRoot, toRepoPath, fileDiff, type Comparison } from './git.js';
import { renderPage } from './render.js';

class UsageError extends Error {}

interface Options {
  output: string;
  paths: string[];
  comparison: Comparison;
}

function parseArgs(argv: string[]): Options {
  const sepIdx = argv.indexOf('--');
  const opts = sepIdx < 0 ? argv : argv.slice(0, sepIdx);
  const paths = sepIdx < 0 ? [] : argv.slice(sepIdx + 1);
  let output: string | undefined;
  let cached = false;
  let revision: string | undefined;
  for (let i = 0; i < opts.length; i++) {
    const a = opts[i];
    if (a === '--output') {
      if (i + 1 >= opts.length) throw new UsageError('--output には出力先を指定してください');
      output = opts[++i];
    } else if (a.startsWith('--output=')) {
      output = a.slice('--output='.length);
    } else if (a === '--cached') {
      cached = true;
    } else if (!a.startsWith('-')) {
      if (revision !== undefined) throw new UsageError('リビジョンは一つだけ指定してください');
      revision = a;
    } else {
      throw new UsageError(`未対応の引数です: ${a}`);
    }
  }
  if (!output) throw new UsageError('--output で出力先を指定してください');
  if (paths.length !== 1) throw new UsageError('-- の後に対象の Markdown ファイルを一つ指定してください');
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
  return { output, paths, comparison };
}

function main(argv: string[]): number {
  const opts = parseArgs(argv);
  const cwd = process.cwd();
  const root = repoRoot(cwd);
  const path = toRepoPath(root, cwd, opts.paths[0]);
  if (!/\.(md|markdown)$/i.test(path)) throw new UsageError(`Markdown ファイルを指定してください: ${path}`);
  const { oldText, patch } = fileDiff(root, path, opts.comparison);
  const file = buildFileDiff(path, oldText, patch);
  if (file.hunks.length === 0) {
    console.error('差分はありません');
    return 0;
  }
  const out = resolve(cwd, opts.output);
  try {
    writeFileSync(out, renderPage(file));
  } catch (e) {
    throw new Error(`HTML を保存できません: ${(e as Error).message}`);
  }
  console.error(`${out} に保存しました`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(`git md-diff: ${(e as Error).message}`);
  process.exitCode = e instanceof UsageError ? 2 : 1;
}
