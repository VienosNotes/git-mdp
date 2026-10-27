// ソースのシンタックスハイライトを確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDocuments, type FileChange } from '../src/changes.js';
import { highlightLines, languageOf } from '../src/highlight.js';
import { renderSource, type Mode } from '../src/render.js';

const read = (dir: string, file: string) => readFileSync(join('fixtures-source', dir, file), 'utf8');
const change = (dir: string, ext: string, path = `sample.${ext}`, full = true): FileChange =>
  ({ status: 'M', oldPath: path, newPath: path, oldText: full ? read(dir, `before.${ext}`) : null, patch: read(dir, 'diff.patch') });
const fixtures = [['cs', 'cs'], ['xaml', 'xaml'], ['json', 'json']] as const;

// 本文の行を { 変更前の行番号, 変更後の行番号, 本文の HTML } として取り出す
function rows(html: string, mode: Mode) {
  const re = mode === 'merged'
    ? /<tr[^>]*data-l="\d+"><td class="ln">(\d*)<\/td><td class="ln">(\d*)<\/td><td class="code">(.*?)<\/td><\/tr>/g
    : /<tr[^>]*data-l="\d+"><td class="ln">()(\d*)<\/td><td class="code">(.*?)<\/td><\/tr>/g;
  return [...html.matchAll(re)].map((m) => ({ oldNo: m[1] ? Number(m[1]) : null, newNo: m[2] ? Number(m[2]) : null, code: m[3] }));
}
// 色付けを外した HTML。highlight.js は ' もエスケープするため、それだけ戻す
const plain = (html: string) => html.replace(/<\/?span[^>]*>/g, '').replace(/&#x27;/g, "'");
// 指定した行の本文が、指定したクラスの要素の中にあるか
const inside = (code: string, cls: string) => code.startsWith(`<span class="${cls}">`) && code.endsWith('</span>');

test('拡張子から言語を判定する', () => {
  assert.equal(languageOf('src/A.cs'), 'csharp');
  assert.equal(languageOf('Views/Main.XAML'), 'xml');
  assert.equal(languageOf('App.csproj'), 'xml');
  assert.equal(languageOf('Directory.Build.props'), 'xml');
  assert.equal(languageOf('appsettings.Development.json'), 'json');
  assert.equal(languageOf('.github/workflows/ci.yml'), 'yaml');
  assert.equal(languageOf('app.ts'), null);
  assert.equal(languageOf('Makefile'), null);
  assert.equal(languageOf('dir.cs/README'), null);
});

test('行をまたぐ要素は、行の終わりで閉じて次の行の始めで開き直す', () => {
  const lines = ['int a; /* one', 'two', 'three */ int b;'];
  const html = highlightLines(lines, 'csharp');
  assert.equal(html.length, 3);
  assert.equal(html[1], '<span class="hljs-comment">two</span>');
  assert.match(html[2], /^<span class="hljs-comment">three \*\/<\/span> <span class="hljs-built_in">int<\/span> b;$/);
  for (const h of html) assert.equal(h.match(/<span/g)?.length ?? 0, h.match(/<\/span>/g)?.length ?? 0);
  assert.deepEqual(html.map(plain), lines);
});

for (const [dir, ext] of fixtures) {
  for (const mode of ['merged', 'new'] as const) {
    for (const full of [true, false]) {
      test(`${ext}（${mode === 'merged' ? '統合表示' : '更新後のみ'}、${full ? '全文' : 'hunk だけ'}）：色付けを外すと色付けしない場合と一致する`, () => {
        const [file] = buildDocuments([change(dir, ext, `sample.${ext}`, full)]);
        const [untouched] = buildDocuments([change(dir, ext, 'sample.txt', full)]);
        const html = renderSource(file, mode);
        assert.match(html, /class="hljs-/);
        const r = rows(html, mode);
        const expected = rows(renderSource(untouched, mode), mode);
        assert.deepEqual(r.map((x) => ({ ...x, code: plain(x.code) })), expected);
        for (const { code } of r) assert.equal(code.match(/<span/g)?.length ?? 0, code.match(/<\/span>/g)?.length ?? 0);
      });
    }
  }
}

test('C#：ブロックコメントと複数行の文字列の中の変更でも、前後の行の色が崩れない', () => {
  const [file] = buildDocuments([change('cs', 'cs')]);
  for (const mode of ['merged', 'new'] as const) {
    const r = rows(renderSource(file, mode), mode);
    const at = (oldNo: number | null, newNo: number | null) => r.find((x) => x.oldNo === oldNo && x.newNo === newNo)!.code;
    if (mode === 'merged') {
      assert.ok(inside(at(8, null), 'hljs-comment'), '削除行（コメントの中）');
      assert.ok(inside(at(13, null), 'hljs-string'), '削除行（文字列の中）');
    }
    const n = (no: number) => r.find((x) => x.newNo === no)!.code;
    assert.ok(inside(n(8), 'hljs-comment'), '追加行（コメントの中）');
    assert.ok(inside(n(9), 'hljs-comment'), 'コメントの終わり');
    assert.match(n(10), /^ {4}<span class="hljs-keyword">public<\/span>/, 'コメントの後');
    assert.ok(inside(n(13), 'hljs-string'), '追加行（文字列の中）');
    assert.match(n(15), /<\/span>;$/, '文字列の後');
    assert.match(n(18), /<span class="hljs-number">200<\/span>/);
  }
});

test('変更で文脈が変わる場合、削除行は変更前、それ以外の行は変更後の文脈で色付けする', () => {
  // 変更後はコメントが始まり、変更のない 2 行目がコメントの中になる
  const oldText = 'int a;\nint b;\nint c; */\n';
  const patch = '@@ -1 +1 @@\n-int a;\n+/* int a;\n';
  const [file] = buildDocuments([{ status: 'M', oldPath: 'a.cs', newPath: 'a.cs', oldText, patch }]);
  const r = rows(renderSource(file, 'merged'), 'merged');
  assert.match(r.find((x) => x.oldNo === 1 && x.newNo === null)!.code, /^<span class="hljs-built_in">int<\/span> a;$/);
  assert.ok(inside(r.find((x) => x.newNo === 1)!.code, 'hljs-comment'));
  assert.ok(inside(r.find((x) => x.newNo === 2)!.code, 'hljs-comment'));
});

test('XAML：コメントの中の変更でも、前後の行の色が崩れない', () => {
  const [file] = buildDocuments([change('xaml', 'xaml')]);
  const r = rows(renderSource(file, 'merged'), 'merged');
  assert.ok(inside(r.find((x) => x.oldNo === 7 && x.newNo === null)!.code, 'hljs-comment'));
  assert.ok(inside(r.find((x) => x.oldNo === null && x.newNo === 7)!.code, 'hljs-comment'));
  assert.match(r.find((x) => x.newNo === 9)!.code, /<span class="hljs-name">Grid<\/span>/);
  assert.match(r.find((x) => x.newNo === 10)!.code, /<span class="hljs-attr">IsReadOnly<\/span>/);
});

test('色付けしても本文の HTML はエスケープされる', () => {
  const [cs] = buildDocuments([change('cs', 'cs')]);
  const [json] = buildDocuments([change('json', 'json')]);
  for (const html of [renderSource(cs, 'merged'), renderSource(json, 'merged')]) {
    assert.doesNotMatch(html, /<script>|<c>/);
  }
  assert.match(renderSource(cs, 'merged'), /&quot;&lt;script&gt;&quot;/);
});

test('対象外の言語は色付けしない', () => {
  const [file] = buildDocuments([{ status: 'M', oldPath: 'app.ts', newPath: 'app.ts', oldText: read('app', 'before.ts'), patch: read('app', 'diff.patch') }]);
  assert.doesNotMatch(renderSource(file, 'merged'), /hljs-/);
});

test('5,000 行の C# を色付けできる', () => {
  const unit = readFileSync(join('fixtures-source', 'cs', 'before.cs'), 'utf8');
  const lines = unit.repeat(Math.ceil(5000 / 29)).split('\n').slice(0, 5000);
  const oldText = `${lines.join('\n')}\n`;
  const patch = `@@ -1,1 +1,1 @@\n-${lines[0]}\n+// changed\n`;
  const start = performance.now();
  const [file] = buildDocuments([{ status: 'M', oldPath: 'Big.cs', newPath: 'Big.cs', oldText, patch }]);
  const html = renderSource(file, 'merged') + renderSource(file, 'new');
  const elapsed = performance.now() - start;
  assert.match(html, /hljs-keyword/);
  assert.ok(elapsed < 3000, `${elapsed.toFixed(0)}ms`);
});
