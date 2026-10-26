// 標準の CSS と JS を assets/ から読み込む（Node 用）
import { readFileSync } from 'node:fs';
import type { Assets } from './render.js';

const assetUrl = (name: string) => new URL(`../../assets/${name}`, import.meta.url);

export function loadAssets(): Assets {
  return {
    css: readFileSync(assetUrl('style.css'), 'utf8'),
    js: readFileSync(assetUrl('client.js'), 'utf8'),
  };
}
