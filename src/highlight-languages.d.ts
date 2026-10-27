// highlight.js の言語定義には型定義が付属しないため、ここで宣言する
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js';
  const language: LanguageFn;
  export default language;
}
