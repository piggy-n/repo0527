// 写进结果的文字：去掉 key、用户目录、用户名、主机名和仓库的绝对路径
import { homedir, hostname, userInfo } from 'node:os';
import { REPO_ROOT } from './paths.mjs';

const escape = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function pathPattern(path) {
  // 同一个路径可能写成反斜杠、正斜杠或 JSON 转义后的双反斜杠
  const parts = path.split(/[\\/]+/).filter(Boolean).map(escape);
  return new RegExp(parts.join('[\\\\/]+'), 'gi');
}

const RULES = [
  [/tk=[^&\s"']+/g, 'tk=***'],
  [pathPattern(REPO_ROOT), '<仓库>'],
  [pathPattern(homedir()), '<用户目录>']
];

const username = userInfo().username;
const machine = hostname();

export function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  if (machine.length > 2) {
    out = out.replace(new RegExp(`\\b${escape(machine)}\\b`, 'gi'), '<主机>');
  }
  if (username.length > 2) {
    out = out.replace(new RegExp(`\\b${escape(username)}\\b`, 'g'), '<用户>');
  }
  return out;
}
