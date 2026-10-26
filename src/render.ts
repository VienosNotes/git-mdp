// 差分情報から、統合表示と更新後のみの表示を含む単体 HTML を生成する
import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { DocLine, FileDiff, LineKind } from './diff.js';

export type Mode = 'merged' | 'new';

interface RenderEnv {
  lines: DocLine[];
  split: boolean; // 変更行を独立した段落に分割するか
}

const md = createMarkdownIt();

function createMarkdownIt(): MarkdownIt {
  // html は既定の false のまま。文書中の HTML タグは文字として表示する
  const md = new MarkdownIt();
  md.core.ruler.push('md_diff_split', (state) => {
    const env = state.env as RenderEnv;
    if (env.split) state.tokens = splitParagraphs(state.tokens, env.lines, state.Token);
  });
  md.core.ruler.push('md_diff_annotate', (state) => {
    annotate(state.tokens, (state.env as RenderEnv).lines);
  });

  const defaultText = md.renderer.rules.text!;
  md.renderer.rules.text = (tokens, idx, options, env, self) => {
    const html = defaultText(tokens, idx, options, env, self);
    return wrapLine(html, tokens[idx], env);
  };
  const defaultCodeInline = md.renderer.rules.code_inline!;
  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const html = defaultCodeInline(tokens, idx, options, env, self);
    return wrapLine(html, tokens[idx], env);
  };
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    if (t.meta?.codeFrom === undefined) return defaultFence(tokens, idx, options, env, self);
    const lang = t.info.trim().split(/\s+/)[0];
    const cls = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : '';
    return `<pre${self.renderAttrs(t)}><code${cls}>${codeLines(t, env)}</code></pre>\n`;
  };
  const defaultCodeBlock = md.renderer.rules.code_block!;
  md.renderer.rules.code_block = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    if (t.meta?.codeFrom === undefined) return defaultCodeBlock(tokens, idx, options, env, self);
    return `<pre${self.renderAttrs(t)}><code>${codeLines(t, env)}</code></pre>\n`;
  };
  return md;
}

// ブロックに行範囲と装飾を付け、装飾しきれないブロックには行単位の情報を付ける
function annotate(tokens: Token[], lines: DocLine[]): void {
  const marked: boolean[] = []; // 祖先のブロックが装飾済みか
  let lastLine = 0; // map を持たないトークン（表のセルなど）用の直近の行
  for (const t of tokens) {
    if (t.nesting === -1) {
      marked.pop();
      continue;
    }
    const inMarked = marked.length > 0 && marked[marked.length - 1];
    let isMarked = inMarked;
    if (t.map && t.type !== 'inline') {
      lastLine = t.map[0];
      t.attrSet('data-ls', String(t.map[0]));
      t.attrSet('data-le', String(t.map[1]));
      if (!inMarked) {
        const kind = blockKind(lines, t.map[0], t.map[1]);
        if (kind) {
          t.attrJoin('class', `md-${kind}`);
          isMarked = true;
        } else if (t.type === 'fence') {
          t.meta = { codeFrom: t.map[0] + 1 };
        } else if (t.type === 'code_block') {
          t.meta = { codeFrom: t.map[0] };
        }
      }
    }
    if (t.type === 'inline' && !isMarked && t.children) {
      // softbreak / hardbreak の数から各テキストのソース行を求める
      let line = t.map ? t.map[0] : lastLine;
      for (const c of t.children) {
        if (c.type === 'softbreak' || c.type === 'hardbreak') line++;
        else c.meta = { line };
      }
    }
    if (t.nesting === 1) marked.push(isMarked);
  }
}

// リスト外の段落を、変更なし・削除・追加の連続する行ごとに別の段落へ分割する。
// 分割位置をまたぐ強調やリンクは、そこでいったん閉じて次の段落で開き直す
function splitParagraphs(tokens: Token[], lines: DocLine[], TokenClass: typeof Token): Token[] {
  const result: Token[] = [];
  let listDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') listDepth++;
    if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') listDepth--;
    const inline = tokens[i + 1];
    if (t.type !== 'paragraph_open' || listDepth > 0 || !t.map || !inline?.children) {
      result.push(t);
      continue;
    }
    const kindOf = (line: number) => lines[line]?.kind ?? 'same';
    let line = t.map[0];
    let start = line;
    let children: Token[] = [];
    const open: Token[] = []; // 開いている強調やリンク
    const flush = (end: number) => {
      for (const o of [...open].reverse()) {
        children.push(new TokenClass(o.type.replace(/_open$/, '_close'), o.tag, -1));
      }
      const p = new TokenClass('paragraph_open', 'p', 1);
      p.map = [start, end];
      p.block = true;
      const body = new TokenClass('inline', '', 0);
      body.map = [start, end];
      body.children = children;
      body.content = '';
      const close = new TokenClass('paragraph_close', 'p', -1);
      close.block = true;
      result.push(p, body, close);
      children = open.map((o) => {
        const copy = new TokenClass(o.type, o.tag, 1);
        copy.attrs = o.attrs;
        copy.markup = o.markup;
        return copy;
      });
      start = end;
    };
    for (const c of inline.children) {
      if ((c.type === 'softbreak' || c.type === 'hardbreak') && kindOf(line + 1) !== kindOf(line)) {
        line++;
        flush(line);
        continue;
      }
      if (c.type === 'softbreak' || c.type === 'hardbreak') line++;
      if (c.nesting === 1) open.push(c);
      if (c.nesting === -1) open.pop();
      children.push(c);
    }
    if (start === t.map[0]) {
      // 分割が不要な段落はそのまま残す
      result.push(t);
      continue;
    }
    flush(t.map[1]);
    i += 2; // inline と paragraph_close は置き換え済み
  }
  return result;
}

// 空行を除く全行が同じ変更ならその種類を返す
function blockKind(lines: DocLine[], start: number, end: number): Exclude<LineKind, 'same'> | null {
  let kind: LineKind | null = null;
  for (let i = start; i < end && i < lines.length; i++) {
    if (lines[i].text.trim() === '') continue;
    if (lines[i].kind === 'same') return null;
    if (kind && kind !== lines[i].kind) return null;
    kind = lines[i].kind;
  }
  return kind === 'same' ? null : kind;
}

function wrapLine(html: string, t: Token, env: RenderEnv): string {
  const line = t.meta?.line;
  if (line === undefined) return html;
  const kind = env.lines[line]?.kind;
  if (kind !== 'del' && kind !== 'add') return html;
  return `<span class="md-${kind}" data-l="${line}">${html}</span>`;
}

function codeLines(t: Token, env: RenderEnv): string {
  const from: number = t.meta.codeFrom;
  const content = t.content.endsWith('\n') ? t.content.slice(0, -1) : t.content;
  return content
    .split('\n')
    .map((text, i) => {
      const escaped = md.utils.escapeHtml(text);
      const kind = env.lines[from + i]?.kind;
      if (kind !== 'del' && kind !== 'add') return escaped;
      return `<span class="md-${kind} md-code-line" data-l="${from + i}">${escaped}</span>`;
    })
    .join('\n') + '\n';
}

// 表示モードごとの本文の行
function modeLines(lines: DocLine[], mode: Mode): DocLine[] {
  return mode === 'merged' ? lines : lines.filter((l) => l.kind !== 'del');
}

// 各 hunk のマークを置く行（表示モードの本文での 0 始まりの行番号）。
// 表示される変更行がなければ、変更位置の直後の行を指す
function hunkTargets(file: FileDiff, mode: Mode): number[] {
  const visibleAt: number[] = file.hunks.map(() => -1);
  const changeAt: number[] = file.hunks.map(() => -1);
  let modeIdx = 0;
  for (const l of file.lines) {
    const visible = mode === 'merged' || l.kind !== 'del';
    if (l.hunk >= 0 && l.kind !== 'same') {
      if (changeAt[l.hunk] < 0) changeAt[l.hunk] = modeIdx;
      if (visible && visibleAt[l.hunk] < 0) visibleAt[l.hunk] = modeIdx;
    }
    if (visible) modeIdx++;
  }
  return visibleAt.map((v, i) => (v >= 0 ? v : changeAt[i]));
}

function hunkKind(file: FileDiff, hunk: number): 'add' | 'del' | 'mix' {
  const lines = file.hunks[hunk].lines;
  const hasDel = lines.some((l) => l.mark === '-');
  const hasAdd = lines.some((l) => l.mark === '+');
  return hasDel && hasAdd ? 'mix' : hasDel ? 'del' : 'add';
}

export function renderBody(file: FileDiff, mode: Mode, split: boolean): string {
  const lines = modeLines(file.lines, mode);
  const env: RenderEnv = { lines, split };
  // 先頭の BOM は見出しなどの解釈を妨げるため取り除く
  const source = lines.map((l) => l.text).join('\n').replace(/^\uFEFF/, '');
  return md.render(source, env);
}

const assetUrl = (name: string) => new URL(`../../assets/${name}`, import.meta.url);

// customCss は標準 CSS の後ろに埋め込み、色やフォントを上書きできるようにする
export function renderPage(input: FileDiff | FileDiff[], customCss?: string): string {
  const files = Array.isArray(input) ? input : [input];
  const esc = md.utils.escapeHtml;
  const labels = { A: '追加', D: '削除', M: '変更', R: 'リネーム' };
  const statusOf = (file: FileDiff) => file.change?.status ?? 'M';
  const data = {
    files: files.map((file) => {
      const merged = hunkTargets(file, 'merged');
      const updated = hunkTargets(file, 'new');
      return {
        path: file.path,
        hunks: file.hunks.map((h, i) => ({
          header: h.header,
          lines: h.lines,
          kind: hunkKind(file, i),
          target: { merged: merged[i], new: updated[i] },
        })),
      };
    }),
  };
  // JSON 内の "<" をエスケープし、"</script>" や "<!--" で HTML の構造が壊れないようにする
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const css = readFileSync(assetUrl('style.css'), 'utf8');
  const js = readFileSync(assetUrl('client.js'), 'utf8');
  // 既定は統合表示で、変更行を独立して表示する
  const section = (file: FileDiff, mode: Mode, split: boolean) =>
    `<section class="doc" data-mode="${mode}" data-split="${split}"${mode === 'merged' && split ? '' : ' hidden'}>
<div class="gutter"></div>
<div class="markdown-body">
${renderBody(file, mode, split)}</div>
<div class="doc-end"></div>
</section>`;
  const document = (file: FileDiff, i: number) => {
    const status = statusOf(file);
    const stateOnly = status === 'R' && file.hunks.length === 0;
    const note = stateOnly ? '本文の変更はありません。' : file.lines.length === 0 ? '空のファイルです。' : '';
    return `<article class="file" id="file-${i}" data-file="${i}">
<header class="file-header"><h2>${esc(file.path)}</h2><span class="file-status">${labels[status]}</span><span class="hunk-count">${file.hunks.length} hunks</span></header>
${note ? `<p class="file-note">${note}</p>` : ''}
${stateOnly ? '' : section(file, 'merged', true) + section(file, 'merged', false) + section(file, 'new', true) + section(file, 'new', false)}
</article>`;
  };
  const hunkCount = files.reduce((sum, file) => sum + file.hunks.length, 0);
  const title = files.length === 1 ? files[0].path : `${files.length} ファイル`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - md-diff</title>
<style>
${css}</style>${customCss === undefined ? '' : `
<style>
${customCss}
</style>`}
</head>
<body>
<header class="toolbar">
<span>${files.length} ファイル / ${hunkCount} hunks</span>
<span id="current-file" aria-live="polite"></span>
<span class="hunk-nav"><button type="button" id="prev-hunk">◀ 前の hunk</button><button type="button" id="next-hunk">次の hunk ▶</button></span>
<label><input type="checkbox" id="split-toggle" checked> 変更行を独立して表示</label>
<button type="button" id="mode-toggle"></button>
</header>
<main>
<nav class="file-list" aria-label="変更ファイル"><ul>
${files.map((file, i) => `<li><a href="#file-${i}">${esc(file.path)}</a> <span class="file-status">${labels[statusOf(file)]}</span></li>`).join('\n')}
</ul></nav>
${files.map(document).join('\n')}
</main>
<div id="popup" hidden></div>
<script type="application/json" id="md-diff-data">${json}</script>
<script>
${js}</script>
</body>
</html>
`;
}
