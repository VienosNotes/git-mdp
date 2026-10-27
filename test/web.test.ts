// ブラウザ用 JS（dist/web/md-diff.js）が CLI と同じ HTML を生成することを確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { loadAssets } from '../src/assets.js';
import { buildDocuments, type FileChange } from '../src/changes.js';
import { renderPage } from '../src/render.js';
import type { DiffData } from '../src/web.js';

// ブラウザと同じく、グローバル変数 MdDiff として読み込む
const context: { MdDiff?: { renderMarkdownDiff(data: DiffData): string } } = {};
runInNewContext(readFileSync('dist/web/md-diff.js', 'utf8'), context);
const web = context.MdDiff!;

const read = (name: string, file: string) => readFileSync(join('fixtures', name, file), 'utf8');
const fixtures = readdirSync('fixtures', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const changes: FileChange[] = fixtures.map((name) => ({
  status: name === 'whole-add' ? 'A' : name === 'whole-del' ? 'D' : 'M',
  oldPath: name === 'whole-add' ? null : `${name}.md`,
  newPath: name === 'whole-del' ? null : `${name}.md`,
  oldText: read(name, 'before.md'),
  patch: read(name, 'diff.patch'),
}));
changes.push({ status: 'R', oldPath: 'old.md', newPath: 'renamed.md', oldText: '# 本文\n', patch: '' });

test('ブラウザ用 JS が CLI と同じ HTML を生成する', () => {
  for (const change of changes) {
    const data = { files: [change] };
    assert.equal(web.renderMarkdownDiff(data), renderPage(buildDocuments(data.files), loadAssets()), change.newPath ?? '');
  }
  const data = { title: 'PR のタイトル #12', files: changes };
  const html = web.renderMarkdownDiff(data);
  assert.equal(html, renderPage(buildDocuments(changes), loadAssets(), { title: data.title }));
  assert.match(html, /<title>PR のタイトル #12 - md-diff<\/title>/);
});

test('ブラウザ用 JS がソースの表示でも CLI と同じ HTML を生成する', () => {
  const src = (f: string, dir = 'app') => readFileSync(join('fixtures-source', dir, f), 'utf8');
  const files: FileChange[] = [
    { status: 'M', oldPath: 'app.ts', newPath: 'app.ts', oldText: src('before.ts'), patch: src('diff.patch') },
    { status: 'M', oldPath: 'a.cs', newPath: 'a.cs', oldText: src('before.cs', 'cs'), patch: src('diff.patch', 'cs') },
    { status: 'M', oldPath: 'b.cs', newPath: 'b.cs', oldText: null, patch: src('diff.patch', 'cs') },
    { status: 'M', oldPath: 'big.ts', newPath: 'big.ts', oldText: null, patch: src('diff.patch') },
    { status: 'A', oldPath: null, newPath: 'a.png', oldText: '', patch: '', binary: true },
  ];
  const html = web.renderMarkdownDiff({ kind: 'source', files });
  assert.match(html, /class="hljs-keyword"/);
  assert.equal(html, renderPage(buildDocuments(files), loadAssets(), { kind: 'source' }));
});
