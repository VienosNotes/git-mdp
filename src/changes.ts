// 変更ファイルの一覧から描画用の文書を作る。
// CLI（git.ts）と GitBucket プラグインは、この形式で変更ファイルを渡す
import { buildFileDiff, type FileDiff } from './diff.js';

export interface FileChange {
  status: 'A' | 'D' | 'M' | 'R';
  oldPath: string | null; // 追加では null
  newPath: string | null; // 削除では null
  oldText: string; // 変更前の本文。追加では空文字列
  patch: string; // 一ファイル分の unified diff
}

export function buildDocuments(changes: FileChange[]): FileDiff[] {
  return changes.map((change) => {
    const path = change.status === 'R' ? `${change.oldPath} → ${change.newPath}` : (change.newPath ?? change.oldPath)!;
    const file = buildFileDiff(path, change.oldText, change.patch);
    file.change = { status: change.status, oldPath: change.oldPath, newPath: change.newPath };
    return file;
  });
}
