// サンプルのソース
import { readFileSync } from 'node:fs';

export function load(path: string): string {
	return readFileSync(path, 'utf8').trim();
}

export function f1(): number {
  return 1;
}

export function f2(): number {
  return 2;
}

export function f3(): number {
  return 3;
}

export function f4(): number {
  return 4;
}

export function count(text: string): number {
  return text.split('\n').length;
}

export const VERSION = '1.1.0';
export const NAME = '<script>alert(1)</script>';
