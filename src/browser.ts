// 既定のブラウザで HTML ファイルを開く
import { spawn } from 'node:child_process';

// 起動コマンドが終わるのを待つ時間。過ぎても動いていれば起動できたとみなす
const WAIT_MS = 3000;

function command(path: string): { cmd: string; args: string[]; verbatim?: boolean } {
  // テストや任意のブラウザ指定のため、環境変数で起動コマンドを置き換えられる
  const override = process.env.GIT_MD_DIFF_BROWSER;
  if (override) return { cmd: override, args: [path] };
  if (process.platform === 'darwin') return { cmd: 'open', args: [path] };
  if (process.platform === 'win32') {
    return { cmd: 'cmd', args: ['/d', '/s', '/c', `start "" "${path}"`], verbatim: true };
  }
  return { cmd: 'xdg-open', args: [path] };
}

export function openBrowser(path: string): Promise<void> {
  const { cmd, args, verbatim } = command(path);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: verbatim });
    const timer = setTimeout(() => {
      child.unref();
      resolve();
    }, WAIT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} を実行できません: ${e.message}`));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} が終了コード ${code} で終了しました`));
    });
  });
}
