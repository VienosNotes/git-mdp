// 一時リポジトリを使った CLI の結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
function generate(cwd: string, path: string, e = env) {
  const out = join(tmp, `out${repoSeq}-${Math.random()}.html`);
  const r = run(cwd, ['--output', out, '--', path], e);
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
    ['パスなし', ['--output', out], 2, /--/],
    ['未対応の引数', ['--output', out, 'HEAD', '--', 'doc.md'], 2, /未対応/],
    ['Markdown 以外', ['--output', out, '--', 'note.txt'], 2, /Markdown/],
    ['未追跡', ['--output', out, '--', 'new.md'], 1, /追跡/],
    ['存在しない', ['--output', out, '--', 'none.md'], 1, /追跡/],
    ['パスの glob を解釈しない', ['--output', out, '--', '[d]oc.md'], 1, /追跡/],
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
