import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFileDiff, newText, splitLines } from '../src/diff.js';
import { renderBody, renderPage } from '../src/render.js';

const fixtures = readdirSync('fixtures', { withFileTypes: true }).filter((d) => d.isDirectory());
const read = (name: string, file: string) => readFileSync(join('fixtures', name, file), 'utf8');

for (const { name } of fixtures) {
  test(`${name}: 変更前とパッチから更新後の本文を復元できる`, () => {
    const file = buildFileDiff(name, read(name, 'before.md'), read(name, 'diff.patch'));
    assert.deepEqual(splitLines(newText(file.lines)), splitLines(read(name, 'after.md')));
    // 変更前の本文も行の並びから復元できる
    const old = file.lines.filter((l) => l.kind !== 'add').map((l) => l.text);
    assert.deepEqual(old, splitLines(read(name, 'before.md')));
  });

  test(`${name}: すべての hunk の内容が HTML に埋め込まれる`, () => {
    const file = buildFileDiff(name, read(name, 'before.md'), read(name, 'diff.patch'));
    const html = renderPage(file);
    const json = /<script type="application\/json" id="md-diff-data">(.*?)<\/script>/s.exec(html)![1];
    const data = JSON.parse(json);
    assert.equal(data.hunks.length, file.hunks.length);
    for (const h of data.hunks) {
      assert.ok(h.target.merged >= 0 && h.target.new >= 0);
    }
  });
}

test('末尾改行の注記を本文の行として扱わない', () => {
  const file = buildFileDiff('no-eol', read('no-eol', 'before.md'), read('no-eol', 'diff.patch'));
  assert.ok(file.lines.every((l) => !l.text.startsWith(' No newline')));
});

test('埋め込んだ JSON が script 要素を閉じない', () => {
  const before = 'a\n';
  const patch = '@@ -1 +1 @@\n-a\n+</script><!-- x\n';
  const html = renderPage(buildFileDiff('x.md', before, patch));
  assert.equal(html.match(/<\/script>/g)!.length, 2);
});

test('変更行を独立した段落に分割する', () => {
  const file = buildFileDiff('basic', read('basic', 'before.md'), read('basic', 'diff.patch'));
  const html = renderBody(file, 'merged', true);
  // 長い段落の一行目の削除・追加と、変更のない二〜九行目がそれぞれ段落になる
  assert.match(html, /<p data-ls="12" data-le="13" class="md-del">一行目の文章はここにある。<\/p>/);
  assert.match(html, /<p data-ls="13" data-le="14" class="md-add">一行目の文章を変更した。<\/p>/);
  assert.match(html, /<p data-ls="14" data-le="22">二行目/);
  // 分割しない場合は一つの段落のまま
  assert.doesNotMatch(renderBody(file, 'merged', false), /<p data-ls="13"/);
});

test('分割位置をまたぐ強調を閉じて開き直す', () => {
  const before = 'a **強調が\nまたがる** b\n';
  const patch = '@@ -1,2 +1,2 @@\n a **強調が\n-またがる** b\n+変更された** b\n';
  const html = renderBody(buildFileDiff('x.md', before, patch), 'merged', true);
  assert.equal(html.match(/<p /g)!.length, 3);
  // 一行目と二行目にまたがる強調が、それぞれの段落で閉じている
  assert.match(html, /<p [^>]*>a <strong>強調が<\/strong><\/p>/);
  assert.match(html, /<p [^>]*><strong>またがる<\/strong> b<\/p>/);
});

test('リスト内の段落は分割しない', () => {
  const before = '- a\n  b\n';
  const patch = '@@ -1,2 +1,2 @@\n - a\n-  b\n+  c\n';
  const html = renderBody(buildFileDiff('x.md', before, patch), 'merged', true);
  assert.equal(html.match(/<p/g), null);
});
