// フィクスチャから検証用の HTML を out/ に生成する
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDocuments, type FileChange } from './changes.js';
import { buildFileDiff, type FileDiff } from './diff.js';
import { loadAssets } from './assets.js';
import { renderPage } from './render.js';

const fixtures = 'fixtures';
mkdirSync('out', { recursive: true });
const files: FileDiff[] = [];
for (const name of readdirSync(fixtures, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  const dir = join(fixtures, name.name);
  const before = readFileSync(join(dir, 'before.md'), 'utf8');
  const patch = readFileSync(join(dir, 'diff.patch'), 'utf8');
  const file = buildFileDiff(`${name.name}.md`, before, patch);
  if (name.name === 'whole-add') file.change = { status: 'A', oldPath: null, newPath: file.path };
  if (name.name === 'whole-del') file.change = { status: 'D', oldPath: file.path, newPath: null };
  files.push(file);
  const out = join('out', `${name.name}.html`);
  writeFileSync(out, renderPage(file, loadAssets()));
  console.error(`${out} (${file.hunks.length} hunks)`);
}
const renamed = buildFileDiff('old.md → renamed.md', '# 変更のない本文\n', '');
renamed.change = { status: 'R', oldPath: 'old.md', newPath: 'renamed.md' };
files.push(renamed);
writeFileSync('out/multi.html', renderPage(files, loadAssets()));
console.error(`out/multi.html (${files.length} ファイル)`);

// ブラウザ用 JS を sandbox 付きの iframe で表示するデモ（GitBucket プラグインの表示画面の参考）
const changes: FileChange[] = readdirSync(fixtures, { withFileTypes: true }).filter((d) => d.isDirectory()).map(({ name }) => ({
  status: name === 'whole-add' ? 'A' : name === 'whole-del' ? 'D' : 'M',
  oldPath: name === 'whole-add' ? null : `${name}.md`,
  newPath: name === 'whole-del' ? null : `${name}.md`,
  oldText: readFileSync(join(fixtures, name, 'before.md'), 'utf8'),
  patch: readFileSync(join(fixtures, name, 'diff.patch'), 'utf8'),
}));
const input = JSON.stringify({ title: 'デモ', files: changes }).replace(/</g, '\\u003c');
writeFileSync('out/web-demo.html', `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>md-diff ブラウザ用 JS のデモ</title>
<style>
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; }
header { padding: 8px 16px; border-bottom: 1px solid #d1d9e0; font-family: sans-serif; }
iframe { flex: 1; width: 100%; border: 0; }
</style>
</head>
<body>
<header>sandbox 付きの iframe での表示例</header>
<iframe id="md-diff" sandbox="allow-scripts" title="Markdown Diff"></iframe>
<script type="application/json" id="md-diff-input">${input}</script>
<script src="../dist/web/md-diff.js"></script>
<script>
const data = JSON.parse(document.getElementById('md-diff-input').textContent);
document.getElementById('md-diff').srcdoc = MdDiff.renderMarkdownDiff(data);
</script>
</body>
</html>
`);
console.error('out/web-demo.html');

// ソースの表示のサンプル（全文、色付けする言語、大きすぎるファイル、バイナリ、追加、削除）
const src = (f: string, dir = 'app') => readFileSync(join('fixtures-source', dir, f), 'utf8');
const sourceChanges: FileChange[] = [
  { status: 'M', oldPath: 'app.ts', newPath: 'app.ts', oldText: src('before.ts'), patch: src('diff.patch') },
  { status: 'M', oldPath: 'OrderService.cs', newPath: 'OrderService.cs', oldText: src('before.cs', 'cs'), patch: src('diff.patch', 'cs') },
  { status: 'M', oldPath: 'MainWindow.xaml', newPath: 'MainWindow.xaml', oldText: src('before.xaml', 'xaml'), patch: src('diff.patch', 'xaml') },
  { status: 'M', oldPath: 'settings.json', newPath: 'settings.json', oldText: src('before.json', 'json'), patch: src('diff.patch', 'json') },
  { status: 'M', oldPath: 'Large.cs', newPath: 'Large.cs', oldText: null, patch: src('diff.patch', 'cs') },
  { status: 'M', oldPath: 'large.ts', newPath: 'large.ts', oldText: null, patch: src('diff.patch') },
  { status: 'M', oldPath: 'logo.png', newPath: 'logo.png', oldText: '', patch: '', binary: true },
  { status: 'A', oldPath: null, newPath: 'new.ts', oldText: '', patch: '@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;\n' },
  { status: 'D', oldPath: 'old.ts', newPath: null, oldText: 'export const x = 0;\n', patch: '@@ -1 +0,0 @@\n-export const x = 0;\n' },
];
writeFileSync('out/source.html', renderPage(buildDocuments(sourceChanges), loadAssets(), { kind: 'source' }));
console.error('out/source.html');
