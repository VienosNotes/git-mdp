// ブラウザ用の JS を dist/web/md-diff.js に生成する
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const text = (path) => JSON.stringify(readFileSync(path, 'utf8'));

await build({
  entryPoints: ['src/web.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'MdDiff',
  target: 'es2020',
  outfile: 'dist/web/md-diff.js',
  define: {
    __MD_DIFF_CSS__: text('assets/style.css'),
    __MD_DIFF_JS__: text('assets/client.js'),
  },
  logLevel: 'warning',
});
