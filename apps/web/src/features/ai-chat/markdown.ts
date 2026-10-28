import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked();

// 回答里用到的排版标签（沿用旧项目的白名单）；属性只留链接，不允许脚本、样式和图片
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'span',
  'div'
];
const ALLOWED_ATTR = ['href', 'title'];

/** 把回答的 Markdown 转成净化过的 HTML；流式输出时传入的是不完整的文本，同样可以转换 */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), { ALLOWED_TAGS, ALLOWED_ATTR });
}
