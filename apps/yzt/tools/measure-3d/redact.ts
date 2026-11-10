import { homedir, hostname, userInfo } from 'node:os';

// 写进结果的文字：去掉 key、用户目录、用户名、主机名和仓库的绝对路径。结果可能带回来讨论、传到别处

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function pathPattern(path: string): RegExp {
  // 同一个路径可能写成反斜杠、正斜杠或 JSON 转义后的双反斜杠；Linux 的绝对路径开头的分隔符也要一起匹配
  const separator = '[\\\\/]+';
  const leading = /^[\\/]/.test(path) ? separator : '';
  const parts = path.split(/[\\/]+/).filter(Boolean).map(escape);
  return new RegExp(leading + parts.join(separator), 'gi');
}

// 全是数字的名字不当成名字：结果里到处是数字，替换了 raw.json 就不是合法的 JSON 了。它们在路径里时由用户目录那条规则去掉
const replaceable = (name: string) => name.length > 2 && !/^\d+$/.test(name);

export function createRedactor(
  repoRoot: string,
  { username, machine }: { readonly username: string; readonly machine: string } = { username: userInfo().username, machine: hostname() }
): (text: string) => string {
  const rules: readonly (readonly [RegExp, string])[] = [
    [/tk=[^&\s"']+/g, 'tk=***'],
    [pathPattern(repoRoot), '<仓库>'],
    [pathPattern(homedir()), '<用户目录>']
  ];
  return text => {
    let out = text;
    for (const [pattern, replacement] of rules) {
      out = out.replace(pattern, replacement);
    }
    if (replaceable(machine)) {
      out = out.replace(new RegExp(`\\b${escape(machine)}\\b`, 'gi'), '<主机>');
    }
    if (replaceable(username)) {
      out = out.replace(new RegExp(`\\b${escape(username)}\\b`, 'g'), '<用户>');
    }
    return out;
  };
}
