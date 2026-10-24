// 一時リポジトリを使った CLI の結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectFileDiffs, toRepoPath, type Comparison } from '../src/git.js';
import { buildFileDiff, newText } from '../src/diff.js';

const cli = resolve('dist/src/cli.js');
const tmp = mkdtempSync(join(tmpdir(), 'md-diff-test-'));
const cleanConfig = join(tmp, 'clean.gitconfig');
writeFileSync(cleanConfig, '[user]\n\tname = test\n\temail = test@example.com\n');

const envWith = (config: string) => ({ ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' });
const env = envWith(cleanConfig);

function sh(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

let repoSeq = 0;
function newRepo(files: Record<string, string>): string {
  const dir = join(tmp, `repo${repoSeq++}`);
  mkdirSync(dir);
  sh(dir, 'init', '-q');
  for (const [p, content] of Object.entries(files)) write(dir, p, content);
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function write(dir: string, p: string, content: string) {
  mkdirSync(join(dir, p, '..'), { recursive: true });
  writeFileSync(join(dir, p), content);
}

function run(cwd: string, args: string[], e = env) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: e, encoding: 'utf8' });
}

// 生成した HTML から埋め込みデータを取り出す
function generate(cwd: string, path: string, e = env, comparison: string[] = []) {
  const out = join(tmp, `out${repoSeq}-${Math.random()}.html`);
  const r = run(cwd, ['--output', out, ...comparison, '--', path], e);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  const json = /<script type="application\/json" id="md-diff-data">(.*?)<\/script>/s.exec(html)![1];
  return { html, data: JSON.parse(json) as { hunks: { header: string; lines: { mark: string; text: string }[] }[] } };
}

// ポップアップに出す内容を、git diff の hunk 部分と同じ形式にする
function popupText(data: ReturnType<typeof generate>['data']): string {
  return data.hunks.map((h) => [h.header, ...h.lines.map((l) => l.mark + l.text)].join('\n')).join('\n') + '\n';
}

function gitDiffHunks(cwd: string, path: string): string {
  const out = sh(cwd, 'diff', '-U3', '--', path);
  return out.slice(out.indexOf('@@'));
}

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

test('index と作業ツリーを比較する', () => {
  const dir = newRepo({ 'doc.md': '# 版1\n\n本文\n' });
  write(dir, 'doc.md', '# 版2\n\n本文\n');
  sh(dir, 'add', 'doc.md');
  write(dir, 'doc.md', '# 版3\n\n本文\n');
  const { data } = generate(dir, 'doc.md');
  assert.equal(popupText(data), gitDiffHunks(dir, 'doc.md'));
  assert.deepEqual(data.hunks[0].lines.filter((l) => l.mark !== ' ').map((l) => l.mark + l.text), ['-# 版2', '+# 版3']);
});

test('複数 hunk、先頭・末尾の変更、末尾改行の削除を扱える', () => {
  const before = lines(30, (i) => (i % 5 === 0 && i < 30 ? '' : `行 ${i}`));
  const dir = newRepo({ 'doc.md': before });
  const after = before.replace('行 1\n', '行 1 改\n').replace('行 14\n', '').replace('行 29\n行 30\n', '行 29 改\n行 30');
  write(dir, 'doc.md', after);
  const { html, data } = generate(dir, 'doc.md');
  assert.equal(data.hunks.length, 3);
  assert.equal(popupText(data), gitDiffHunks(dir, 'doc.md'));
  assert.ok(data.hunks[2].lines.some((l) => l.mark === '\\'));
  assert.doesNotMatch(html.slice(0, html.indexOf('md-diff-data')), /No newline/);
  // 差分の前後を含む全文が省略されない
  for (const t of ['行 7', '行 21', '行 29 改']) assert.ok(html.includes(t), t);
});

test('末尾改行の追加を扱える', () => {
  const dir = newRepo({ 'doc.md': 'a\nb' });
  write(dir, 'doc.md', 'a\nb\n');
  const { data } = generate(dir, 'doc.md');
  assert.equal(popupText(data), gitDiffHunks(dir, 'doc.md'));
});

test('ユーザーの Git 設定に出力が左右されない', () => {
  const before = lines(40, (i) => (i % 3 === 0 ? '' : `行 ${i}`));
  const dir = newRepo({ 'sub/文書.md': before, 'other.md': 'x\n' });
  write(dir, 'sub/文書.md', before.replace('行 2\n', '行 2 改\n').replace('行 20\n', '行 20 改\n'));
  const expected = generate(dir, 'sub/文書.md').data;
  const hostile = join(tmp, 'hostile.gitconfig');
  writeFileSync(hostile, [
    '[core]', '\tquotePath = true',
    '[color]', '\tui = always',
    '[diff]', '\tsuppressBlankEmpty = true', '\tnoprefix = true', '\tmnemonicPrefix = true',
    '\trelative = true', '\tcontext = 10', '\tinterHunkContext = 20', '\texternal = false', '\trenames = copies',
  ].join('\n') + '\n');
  assert.deepEqual(generate(join(dir, 'sub'), '文書.md', envWith(hostile)).data, expected);
});

test('サブディレクトリから、日本語や空白を含むパスを指定できる', () => {
  const dir = newRepo({ '文書 フォルダ/仕様 書.md': 'a\n', 'top.md': 'b\n' });
  write(dir, '文書 フォルダ/仕様 書.md', 'a2\n');
  write(dir, 'top.md', 'b2\n');
  const sub = join(dir, '文書 フォルダ');
  assert.equal(generate(sub, '仕様 書.md').data.hunks[0].lines[1].text, 'a2');
  assert.equal(generate(sub, '../top.md').data.hunks[0].lines[1].text, 'b2');
});

test('作業ツリーで削除したファイルを全文の削除として表示する', () => {
  const dir = newRepo({ 'doc.md': '# 見出し\n\n本文\n' });
  rmSync(join(dir, 'doc.md'));
  const { data } = generate(dir, 'doc.md');
  assert.equal(data.hunks.length, 1);
  assert.ok(data.hunks[0].lines.every((l) => l.mark === '-'));
});

test('差分がなければ HTML を生成せずに正常終了する', () => {
  const dir = newRepo({ 'doc.md': 'a\n' });
  const out = join(tmp, 'none.html');
  const r = run(dir, ['--output', out, '--', 'doc.md']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /差分はありません/);
  assert.equal(r.stdout, '');
  assert.equal(existsSync(out), false);
});

test('誤った入力やエラーを非 0 で通知する', () => {
  const dir = newRepo({ 'doc.md': 'a\n', 'note.txt': 'x\n', 'd/x.md': 'y\n' });
  write(dir, 'doc.md', 'b\n');
  write(dir, 'new.md', 'c\n');
  const out = join(tmp, 'err.html');
  const cases: [string, string[], number, RegExp][] = [
    ['出力先なし', ['--', 'doc.md'], 2, /--output/],
    ['未対応の引数', ['--output', out, '--unknown', '--', 'doc.md'], 2, /未対応/],
    ['リポジトリ外', ['--output', out, '--', '../x.md'], 1, /リポジトリ外/],
    ['保存失敗', ['--output', join(tmp, 'no-such-dir', 'a.html'), '--', 'doc.md'], 1, /保存できません/],
  ];
  for (const [name, args, status, message] of cases) {
    const r = run(dir, args);
    assert.equal(r.status, status, name);
    assert.match(r.stderr, message, name);
  }
  const outside = mkdtempSync(join(tmpdir(), 'md-diff-outside-'));
  const r = run(outside, ['--output', out, '--', 'doc.md']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /リポジトリ内で実行/);
});


test('cached と指定コミットがそれぞれ正しい本文を比較する', () => {
  const dir = newRepo({ 'doc.md': '# 版1\n' });
  write(dir, 'doc.md', '# 版2\n');
  sh(dir, 'add', 'doc.md');
  sh(dir, 'commit', '-q', '-m', 'second');
  write(dir, 'doc.md', '# 版3\n');
  sh(dir, 'add', 'doc.md');
  write(dir, 'doc.md', '# 版4\n');
  for (const [args, old, next] of [
    [[], '版3', '版4'],
    [['--cached'], '版2', '版3'],
    [['HEAD~1'], '版1', '版4'],
  ] as [string[], string, string][]) {
    const { data } = generate(dir, 'doc.md', env, args);
    const expected = sh(dir, 'diff', '-U3', ...args, '--', 'doc.md');
    assert.equal(popupText(data), expected.slice(expected.indexOf('@@')));
    assert.deepEqual(data.hunks[0].lines.map((l) => l.mark + l.text), [`-# ${old}`, `+# ${next}`]);
  }
});

test('三点比較は共通祖先と tip を使い index と作業ツリーを参照しない', () => {
  const dir = newRepo({ 'doc.md': '# 共通\n' });
  sh(dir, 'branch', 'base');
  sh(dir, 'checkout', '-q', '-b', 'feature');
  write(dir, 'doc.md', '# feature\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'feature');
  sh(dir, 'checkout', '-q', 'base');
  write(dir, 'doc.md', '# base\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'base');
  write(dir, 'doc.md', '# index\n');
  sh(dir, 'add', '.');
  write(dir, 'doc.md', '# worktree\n');
  const { data } = generate(dir, 'doc.md', env, ['base...feature']);
  const expected = sh(dir, 'diff', '-U3', 'base...feature', '--', 'doc.md');
  assert.equal(popupText(data), expected.slice(expected.indexOf('@@')));
  assert.deepEqual(data.hunks[0].lines.map((l) => l.mark + l.text), ['-# 共通', '+# feature']);
});

test('比較モードの誤った指定と存在しないリビジョンを通知する', () => {
  const dir = newRepo({ 'doc.md': 'a\n' });
  const out = join(tmp, 'invalid-comparison.html');
  for (const args of [['--cached', 'HEAD'], ['HEAD', 'HEAD~1'], ['HEAD..HEAD'], ['...HEAD']]) {
    const r = run(dir, ['--output', out, ...args, '--', 'doc.md']);
    assert.equal(r.status, 2, r.stderr);
  }
  const r = run(dir, ['--output', out, 'no-such-revision', '--', 'doc.md']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rev-parse/);
});

test('cached と三点比較で差分がなければ正常終了する', () => {
  const dir = newRepo({ 'doc.md': 'a\n' });
  const out = join(tmp, 'no-comparison-diff.html');
  for (const args of [['--cached'], ['HEAD...HEAD']]) {
    const r = run(dir, ['--output', out, ...args, '--', 'doc.md']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /差分はありません/);
    assert.equal(existsSync(out), false);
  }
});

test('二つのドットで始まるリポジトリ内のファイルを扱える', () => {
  const dir = newRepo({ '..notes.md': 'a\n' });
  write(dir, '..notes.md', 'b\n');
  assert.equal(generate(dir, '..notes.md').data.hunks.length, 1);
});


// 取得 API も CLI と同じ隔離した Git 設定で確認する
function changes(dir: string, comparison: Comparison, paths: string[] = [], config = cleanConfig) {
  const previous = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    return collectFileDiffs(dir, comparison, paths);
  } finally {
    if (previous.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous.global;
    if (previous.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = previous.system;
  }
}

const restored = (f: ReturnType<typeof changes>[number]) => newText(buildFileDiff(f.newPath ?? f.oldPath!, f.oldText, f.patch).lines);

test('cached で追加・削除・リネームを列挙し、本文変更なしも保持する', () => {
  const dir = newRepo({ 'old.md': '移動する本文\n', 'delete.md': '削除する本文\n', 'keep.md': '維持\n' });
  sh(dir, 'mv', 'old.md', 'new.md');
  sh(dir, 'rm', '-q', 'delete.md');
  write(dir, 'add.markdown', '追加\n');
  write(dir, 'ignored.txt', '対象外\n');
  sh(dir, 'add', '.');
  write(dir, 'untracked.md', '未追跡\n');
  const result = changes(dir, { kind: 'cached' });
  assert.equal(result.length, 3);
  const added = result.find((f) => f.status === 'A')!;
  assert.equal(added.oldPath, null);
  assert.equal(added.newPath, 'add.markdown');
  assert.equal(restored(added), '追加');
  const deleted = result.find((f) => f.status === 'D')!;
  assert.equal(deleted.newPath, null);
  assert.equal(restored(deleted), '');
  const renamed = result.find((f) => f.status === 'R')!;
  assert.equal(renamed.oldPath, 'old.md');
  assert.equal(renamed.newPath, 'new.md');
  assert.equal(buildFileDiff('new.md', renamed.oldText, renamed.patch).hunks.length, 0);
  assert.equal(restored(renamed), '移動する本文');
  for (const path of ['old.md', 'new.md']) assert.deepEqual(changes(dir, { kind: 'cached' }, [path]), [renamed]);
});

test('全比較モードでファイル列挙と本文が Git の比較対象に一致する', () => {
  const dir = newRepo({ 'doc.md': '共通\n' });
  sh(dir, 'branch', 'base');
  write(dir, 'added.md', 'コミット追加\n');
  write(dir, 'doc.md', 'コミット\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'second');
  sh(dir, 'branch', 'tip');
  write(dir, 'doc.md', 'index\n');
  sh(dir, 'add', '.');
  write(dir, 'doc.md', '作業ツリー\n');
  const cases: [Comparison, string[], string, number][] = [
    [{ kind: 'worktree' }, [], '作業ツリー', 1],
    [{ kind: 'cached' }, ['--cached'], 'index', 1],
    [{ kind: 'revision', ref: 'base' }, ['base'], '作業ツリー', 2],
    [{ kind: 'three-dot', base: 'base', tip: 'tip' }, ['base...tip'], 'コミット', 2],
  ];
  for (const [comparison, args, expected, count] of cases) {
    const result = changes(dir, comparison);
    assert.equal(result.length, count);
    assert.equal(restored(result.find((f) => f.newPath === 'doc.md')!), expected);
    for (const f of result) {
      const patch = sh(dir, 'diff', '--no-renames', '--find-renames=50%', '-U3', ...args, '--', f.newPath!);
      assert.equal(f.patch, patch);
    }
  }
});

test('ディレクトリと複数パスの絞り込みは重複せず、ルートも指定できる', () => {
  const dir = newRepo({ '文書 空白/a.md': 'a\n', '文書 空白/b.MD': 'b\n', 'top.markdown': 'c\n', '[literal].md': 'd\n' });
  for (const path of ['文書 空白/a.md', '文書 空白/b.MD', 'top.markdown', '[literal].md']) write(dir, path, '変更\n');
  const sub = join(dir, '文書 空白');
  const paths = ['.', 'a.md', '../top.markdown'].map((p) => toRepoPath(dir, sub, p));
  assert.equal(changes(dir, { kind: 'worktree' }, paths).length, 3);
  assert.equal(changes(dir, { kind: 'worktree' }, [toRepoPath(dir, sub, '..')]).length, 4);
  assert.equal(changes(dir, { kind: 'worktree' }, ['[literal].md']).length, 1);
  assert.equal(changes(dir, { kind: 'worktree' }, ['*.md']).length, 0);
  const config = join(tmp, 'enumeration.gitconfig');
  writeFileSync(config, '[diff]\n relative = true\n renames = false\n noprefix = true\n context = 20\n');
  assert.deepEqual(changes(dir, { kind: 'worktree' }, paths, config), changes(dir, { kind: 'worktree' }, paths));
});

test('拡張子をまたぐリネームと本文変更を取得できる', () => {
  const body = lines(20, (i) => `本文 ${i}`);
  const dir = newRepo({ 'old.txt': body, 'out.md': '拡張子変更\n' });
  sh(dir, 'mv', 'old.txt', 'new.md');
  write(dir, 'new.md', body.replace('本文 10', '本文 10 改'));
  sh(dir, 'mv', 'out.md', 'out.txt');
  sh(dir, 'add', '.');
  const result = changes(dir, { kind: 'cached' });
  assert.equal(result.length, 2);
  assert.ok(result.every((f) => f.status === 'R'));
  const modified = result.find((f) => f.newPath === 'new.md')!;
  assert.equal(restored(modified), body.replace('本文 10', '本文 10 改').trimEnd());
  assert.equal(buildFileDiff('new.md', modified.oldText, modified.patch).hunks.length, 1);
});

test('初回コミット前の cached は空のツリーと比較する', () => {
  const dir = join(tmp, `unborn${repoSeq++}`);
  mkdirSync(dir);
  sh(dir, 'init', '-q');
  write(dir, 'first.md', '# 最初\n');
  sh(dir, 'add', '.');
  const result = changes(dir, { kind: 'cached' });
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'A');
  assert.equal(result[0].oldText, '');
  assert.equal(restored(result[0]), '# 最初');
});

test('対象の競合とバイナリは明示的なエラー、対象外なら影響しない', () => {
  const dir = newRepo({ 'doc.md': '元\n', 'ok.md': 'a\n' });
  sh(dir, 'checkout', '-q', '-b', 'other');
  write(dir, 'doc.md', '別\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'other');
  sh(dir, 'checkout', '-q', '-b', 'main-test', 'HEAD~1');
  write(dir, 'doc.md', '本線\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'main');
  const merge = spawnSync('git', ['merge', 'other'], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(merge.status, 0);
  assert.throws(() => changes(dir, { kind: 'worktree' }), /競合中/);
  write(dir, 'ok.md', 'b\n');
  assert.equal(changes(dir, { kind: 'worktree' }, ['ok.md']).length, 1);
  assert.equal(changes(dir, { kind: 'three-dot', base: 'HEAD', tip: 'other' }).length, 1);
  const binary = newRepo({ 'binary.md': 'text\n', 'ok.md': 'a\n' });
  write(binary, 'binary.md', '\0binary');
  write(binary, 'ok.md', 'b\n');
  assert.throws(() => changes(binary, { kind: 'worktree' }), /バイナリ/);
  assert.equal(changes(binary, { kind: 'worktree' }, ['ok.md']).length, 1);
});

test('CLI はパス省略と絞り込みに対応し、複数文書を黙って省略しない', () => {
  const dir = newRepo({ 'a.md': 'a\n', 'b.md': 'b\n' });
  write(dir, 'a.md', '変更\n');
  const out = join(tmp, 'enumerated.html');
  assert.equal(run(dir, ['--output', out]).status, 0);
  write(dir, 'b.md', '変更\n');
  const r = run(dir, ['--output', out]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /複数ファイル/);
  for (const path of ['none.md', '*.md']) {
    const filtered = run(dir, ['--output', out, '--', path]);
    assert.equal(filtered.status, 0);
    assert.match(filtered.stderr, /差分はありません/);
  }
});


test('追加・削除・リネームを全比較モードで取得できる', () => {
  const comparisons: Comparison[] = [
    { kind: 'worktree' }, { kind: 'cached' }, { kind: 'revision', ref: 'base' },
    { kind: 'three-dot', base: 'base', tip: 'tip' },
  ];
  for (const comparison of comparisons) {
    const dir = newRepo({ 'old.md': '移動\n', 'delete.md': '削除\n' });
    sh(dir, 'branch', 'base');
    renameSync(join(dir, 'old.md'), join(dir, 'new.md'));
    rmSync(join(dir, 'delete.md'));
    write(dir, 'add.md', '追加\n');
    if (comparison.kind === 'worktree') sh(dir, 'add', '-N', 'new.md', 'add.md');
    else sh(dir, 'add', '-A');
    if (comparison.kind === 'three-dot') {
      sh(dir, 'commit', '-q', '-m', 'changes');
      sh(dir, 'branch', 'tip');
    }
    const result = changes(dir, comparison);
    assert.deepEqual(result.map((f) => f.status).sort(), ['A', 'D', 'R']);
    assert.equal(restored(result.find((f) => f.status === 'A')!), '追加');
    assert.equal(restored(result.find((f) => f.status === 'D')!), '');
    assert.equal(restored(result.find((f) => f.status === 'R')!), '移動');
  }
});

test('改行や引用符を含むファイル名でもパッチの対応が崩れない', () => {
  const name = '文書\n"名前.md';
  const dir = newRepo({ [name]: '元\n', 'other.md': '他\n' });
  write(dir, name, '変更\n');
  write(dir, 'other.md', '他変更\n');
  const result = changes(dir, { kind: 'worktree' }, [name]);
  assert.equal(result.length, 1);
  assert.equal(result[0].oldPath, name);
  assert.equal(restored(result[0]), '変更');
});
