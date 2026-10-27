// Git の unified diff を解析し、行の状態と hunk の対応を保持する

export type LineKind = 'same' | 'del' | 'add';

// 全文を構成する一行。hunk に含まれない行は hunk が -1
export interface DocLine {
  kind: LineKind;
  text: string;
  oldNo: number | null; // 1 始まり
  newNo: number | null; // 1 始まり
  hunk: number;
}

export interface HunkLine {
  mark: ' ' | '-' | '+' | '\\';
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  lines: HunkLine[];
}

export interface FileDiff {
  path: string;
  change?: {
    status: 'A' | 'D' | 'M' | 'R';
    oldPath: string | null;
    newPath: string | null;
  };
  hunks: Hunk[];
  lines: DocLine[];
  // 'hunks'：大きすぎるため hunk の行だけを持つ。'binary'：バイナリのため本文を持たない
  view?: 'hunks' | 'binary';
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// 一ファイル分のパッチから hunk を取り出す。ヘッダー部分は読み飛ばす。
// hunk の終わりはヘッダーの行数で判断する（空の文脈行が空行で出力される設定もあるため）
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of splitLines(patch)) {
    if (current && line.startsWith('\\')) {
      // 末尾改行に関する注記は、直前の行の後に付く
      current.lines.push({ mark: '\\', text: line.slice(1) });
      continue;
    }
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const mark = line === '' ? ' ' : line[0];
      if (mark === '-' && oldLeft > 0) oldLeft--;
      else if (mark === '+' && newLeft > 0) newLeft--;
      else if (mark === ' ' && oldLeft > 0 && newLeft > 0) {
        oldLeft--;
        newLeft--;
      } else throw new Error(`パッチの形式が不正: ${line}`);
      current.lines.push({ mark: mark as HunkLine['mark'], text: line.slice(1) });
      continue;
    }
    const m = HUNK_HEADER.exec(line);
    if (m) {
      current = {
        header: line,
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        lines: [],
      };
      oldLeft = current.oldCount;
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      hunks.push(current);
    }
  }
  if (oldLeft > 0 || newLeft > 0) throw new Error('パッチが途中で終わっている');
  return hunks;
}

// 変更前の本文と hunk から、差分に含まれない行も含めた全文の行列を作る
export function buildLines(oldText: string, hunks: Hunk[]): DocLine[] {
  const oldLines = splitLines(oldText);
  const result: DocLine[] = [];
  let oldIdx = 0; // 次に読む変更前の行（0 始まり）
  let newNo = 1;
  const pushSame = (upto: number) => {
    while (oldIdx < upto) {
      result.push({ kind: 'same', text: oldLines[oldIdx], oldNo: oldIdx + 1, newNo: newNo++, hunk: -1 });
      oldIdx++;
    }
  };
  hunks.forEach((h, hi) => {
    // 変更前が 0 行の hunk は oldStart が「直前の行番号」を指す
    pushSame(h.oldCount === 0 ? h.oldStart : h.oldStart - 1);
    for (const l of h.lines) {
      if (l.mark === '\\') continue; // 末尾改行に関する注記は本文ではない
      if (l.mark === '+') {
        result.push({ kind: 'add', text: l.text, oldNo: null, newNo: newNo++, hunk: hi });
        continue;
      }
      if (oldLines[oldIdx] !== l.text) {
        throw new Error(`パッチと変更前の本文が一致しない（変更前 ${oldIdx + 1} 行目）`);
      }
      if (l.mark === '-') {
        result.push({ kind: 'del', text: l.text, oldNo: oldIdx + 1, newNo: null, hunk: hi });
      } else {
        result.push({ kind: 'same', text: l.text, oldNo: oldIdx + 1, newNo: newNo++, hunk: hi });
      }
      oldIdx++;
    }
  });
  pushSame(oldLines.length);
  return result;
}

export function buildFileDiff(path: string, oldText: string, patch: string): FileDiff {
  const hunks = parsePatch(patch);
  return { path, hunks, lines: buildLines(oldText, hunks) };
}

// 変更前の本文がない場合（大きすぎるファイル）は、hunk の行だけを並べる。
// 行番号は hunk ヘッダーの開始行から数える
export function buildHunkLines(hunks: Hunk[]): DocLine[] {
  const result: DocLine[] = [];
  hunks.forEach((h, hi) => {
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const l of h.lines) {
      if (l.mark === '\\') continue;
      if (l.mark === '-') result.push({ kind: 'del', text: l.text, oldNo: oldNo++, newNo: null, hunk: hi });
      else if (l.mark === '+') result.push({ kind: 'add', text: l.text, oldNo: null, newNo: newNo++, hunk: hi });
      else result.push({ kind: 'same', text: l.text, oldNo: oldNo++, newNo: newNo++, hunk: hi });
    }
  });
  return result;
}

// 更新後の本文（末尾改行の有無は区別しない）
export function newText(lines: DocLine[]): string {
  return lines.filter((l) => l.kind !== 'del').map((l) => l.text).join('\n');
}

// 末尾の改行は行を増やさない
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
