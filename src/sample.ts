// フィクスチャから検証用の HTML を out/ に生成する
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFileDiff, type FileDiff } from './diff.js';
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
  writeFileSync(out, renderPage(file));
  console.error(`${out} (${file.hunks.length} hunks)`);
}
const renamed = buildFileDiff('old.md → renamed.md', '# 変更のない本文\n', '');
renamed.change = { status: 'R', oldPath: 'old.md', newPath: 'renamed.md' };
files.push(renamed);
writeFileSync('out/multi.html', renderPage(files));
console.error(`out/multi.html (${files.length} ファイル)`);
