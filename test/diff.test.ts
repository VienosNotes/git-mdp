import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFileDiff, newText, splitLines } from '../src/diff.js';
import { renderPage } from '../src/render.js';

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
