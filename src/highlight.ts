// ソースのシンタックスハイライト。highlight.js の core に、対象の言語だけを登録する
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { DocLine, FileDiff } from './diff.js';

hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

// 拡張子（小文字）と言語の対応。言語を加えるときは、上の登録とここに追加する
const LANGUAGES: Record<string, string> = {
  cs: 'csharp', csx: 'csharp',
  xml: 'xml', xaml: 'xml', axaml: 'xml', csproj: 'xml', vbproj: 'xml', props: 'xml', targets: 'xml',
  config: 'xml', resx: 'xml', nuspec: 'xml', manifest: 'xml', xsd: 'xml', svg: 'xml',
  json: 'json',
  yml: 'yaml', yaml: 'yaml',
};

export function languageOf(path: string): string | null {
  const m = /\.([^./]+)$/.exec(path);
  return m ? LANGUAGES[m[1].toLowerCase()] ?? null : null;
}

// 複数行をまとめて色付けし、行ごとの HTML に分ける。
// 行をまたぐ要素（ブロックコメントなど）は、行の終わりで閉じて次の行の始めで開き直す
export function highlightLines(lines: string[], language: string): string[] {
  const html = hljs.highlight(lines.join('\n'), { language, ignoreIllegals: true }).value;
  const result: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (part === '\n') {
      result.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (part.startsWith('<span')) open.push(part);
      else if (part === '</span>') open.pop();
      line += part;
    }
  }
  result.push(line);
  return result;
}

// 本文の各行（file.lines と同じ順）の色付けした HTML。対象外の言語では null。
// 削除行は変更前の、それ以外の行は変更後の本文の文脈で色付けする。
// hunk だけの表示では全文がないため、hunk ごとに色付けする
const cache = new WeakMap<FileDiff, (string | null)[]>();
export function highlightFile(file: FileDiff): (string | null)[] {
  const cached = cache.get(file);
  if (cached) return cached;
  const language = languageOf(file.path);
  const result: (string | null)[] = file.lines.map(() => null);
  if (language !== null) {
    const segments = new Map<number, number[]>();
    file.lines.forEach((l, i) => {
      const key = file.view === 'hunks' ? l.hunk : 0;
      if (!segments.has(key)) segments.set(key, []);
      segments.get(key)!.push(i);
    });
    for (const indexes of segments.values()) {
      for (const side of ['del', 'add'] as const) {
        // side の行を除いたもの：'del' を除けば変更後、'add' を除けば変更前の本文
        const target = indexes.filter((i) => file.lines[i].kind !== side);
        const html = highlightLines(target.map((i) => file.lines[i].text), language);
        target.forEach((i, j) => {
          const l: DocLine = file.lines[i];
          if (side === 'add' ? l.kind === 'del' : l.kind !== 'del') result[i] = html[j];
        });
      }
    }
  }
  cache.set(file, result);
  return result;
}
