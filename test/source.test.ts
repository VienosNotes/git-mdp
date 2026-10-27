// ソースの表示（全文、hunk だけ、バイナリ）を確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAssets } from '../src/assets.js';
import { buildDocuments, type FileChange } from '../src/changes.js';
import { splitLines } from '../src/diff.js';
import { renderPage, renderSource } from '../src/render.js';

const read = (file: string) => readFileSync(join('fixtures-source', 'app', file), 'utf8');
const before = splitLines(read('before.ts'));
const after = splitLines(read('after.ts'));
const change: FileChange = { status: 'M', oldPath: 'app.ts', newPath: 'app.ts', oldText: read('before.ts'), patch: read('diff.patch') };

// 本文の行を [変更前の行番号, 変更後の行番号, 本文] として取り出す
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function rows(html: string, merged: boolean): [number | null, number | null, string][] {
  const re = merged
    ? /<tr[^>]*data-l="\d+"><td class="ln">(\d*)<\/td><td class="ln">(\d*)<\/td><td class="code">(.*?)<\/td><\/tr>/g
    : /<tr[^>]*data-l="\d+"><td class="ln">(\d*)<\/td><td class="code">(.*?)<\/td><\/tr>/g;
  return [...html.matchAll(re)].map((m) => merged
    ? [m[1] ? Number(m[1]) : null, m[2] ? Number(m[2]) : null, unescape(m[3])]
    : [null, Number(m[1]), unescape(m[2])]);
}

test('統合表示で全行を変更前・変更後の行番号付きで表示する', () => {
  const [file] = buildDocuments([change]);
  const r = rows(renderSource(file, 'merged'), true);
  for (const [oldNo, newNo, text] of r) {
    if (oldNo !== null) assert.equal(text, before[oldNo - 1], `変更前 ${oldNo} 行目`);
    if (newNo !== null) assert.equal(text, after[newNo - 1], `変更後 ${newNo} 行目`);
  }
  assert.deepEqual(r.filter((x) => x[0] !== null).map((x) => x[0]), before.map((_, i) => i + 1));
  assert.deepEqual(r.filter((x) => x[1] !== null).map((x) => x[1]), after.map((_, i) => i + 1));
});

test('更新後のみの表示では変更後の行番号だけを表示する', () => {
  const [file] = buildDocuments([change]);
  const r = rows(renderSource(file, 'new'), false);
  assert.deepEqual(r.map((x) => x[2]), after);
  assert.deepEqual(r.map((x) => x[1]), after.map((_, i) => i + 1));
});

test('大きすぎるファイルは hunk の行だけを区切り付きで表示する', () => {
  const [file] = buildDocuments([{ ...change, oldText: null }]);
  const html = renderSource(file, 'merged');
  assert.equal(html.match(/class="hunk-sep"/g)!.length, 2);
  const r = rows(html, true);
  for (const [oldNo, newNo, text] of r) {
    if (oldNo !== null) assert.equal(text, before[oldNo - 1]);
    if (newNo !== null) assert.equal(text, after[newNo - 1]);
  }
  assert.ok(r.length < before.length);
  const page = renderPage(buildDocuments([{ ...change, oldText: null }]), loadAssets(), { kind: 'source' });
  assert.match(page, /ファイルが大きいため、差分の前後だけを表示しています。/);
});

test('バイナリファイルは状態だけを表示する', () => {
  const page = renderPage(buildDocuments([{ status: 'M', oldPath: 'a.png', newPath: 'a.png', oldText: '', patch: '', binary: true }]), loadAssets(), { kind: 'source' });
  assert.match(page, /バイナリファイルのため表示しません。/);
  assert.doesNotMatch(page, /<section class="doc"/);
});

test('ソースの表示では「変更行を独立して表示」を出さず、本文を 2 通りだけ生成する', () => {
  const page = renderPage(buildDocuments([change]), loadAssets(), { kind: 'source' });
  assert.doesNotMatch(page, /<input type="checkbox" id="split-toggle"/);
  assert.equal(page.match(/<section class="doc"/g)!.length, 2);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const markdown = renderPage(buildDocuments([change]), loadAssets());
  assert.match(markdown, /<input type="checkbox" id="split-toggle"/);
  assert.equal(markdown.match(/<section class="doc"/g)!.length, 4);
});
