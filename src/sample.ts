// フィクスチャから検証用の HTML を out/ に生成する
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFileDiff } from './diff.js';
import { renderPage } from './render.js';

const fixtures = 'fixtures';
mkdirSync('out', { recursive: true });
for (const name of readdirSync(fixtures, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  const dir = join(fixtures, name.name);
  const before = readFileSync(join(dir, 'before.md'), 'utf8');
  const patch = readFileSync(join(dir, 'diff.patch'), 'utf8');
  const file = buildFileDiff(`${name.name}.md`, before, patch);
  const out = join('out', `${name.name}.html`);
  writeFileSync(out, renderPage(file));
  console.error(`${out} (${file.hunks.length} hunks)`);
}
