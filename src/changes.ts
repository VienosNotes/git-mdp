// 変更ファイルの一覧から描画用の文書を作る。
// CLI（git.ts）と GitBucket プラグインは、この形式で変更ファイルを渡す
import { buildFileDiff, buildHunkLines, parsePatch, type FileDiff } from './diff.js';

export interface FileChange {
  status: 'A' | 'D' | 'M' | 'R';
  oldPath: string | null; // 追加では null
  newPath: string | null; // 削除では null
  // 変更前の本文。追加では空文字列。大きすぎるファイルでは null とし、hunk だけを表示する
  oldText: string | null;
  patch: string; // 一ファイル分の unified diff。バイナリでは空文字列
  binary?: boolean; // バイナリファイル。状態だけを表示する
}

export function buildDocuments(changes: FileChange[]): FileDiff[] {
  return changes.map((change) => {
    const path = change.status === 'R' ? `${change.oldPath} → ${change.newPath}` : (change.newPath ?? change.oldPath)!;
    let file: FileDiff;
    if (change.binary) {
      file = { path, hunks: [], lines: [], view: 'binary' };
    } else if (change.oldText === null) {
      const hunks = parsePatch(change.patch);
      file = { path, hunks, lines: buildHunkLines(hunks), view: 'hunks' };
    } else {
      file = buildFileDiff(path, change.oldText, change.patch);
    }
    file.change = { status: change.status, oldPath: change.oldPath, newPath: change.newPath };
    return file;
  });
}
