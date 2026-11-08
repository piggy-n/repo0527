import { homedir, hostname, userInfo } from 'node:os';

// 写进结果的文字：去掉 key、用户目录、用户名、主机名和仓库的绝对路径。结果可能带回来讨论、传到别处

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function pathPattern(path: string): RegExp {
  // 同一个路径可能写成反斜杠、正斜杠或 JSON 转义后的双反斜杠
  const parts = path.split(/[\\/]+/).filter(Boolean).map(escape);
  return new RegExp(parts.join('[\\\\/]+'), 'gi');
}

export function createRedactor(repoRoot: string): (text: string) => string {
  const rules: readonly (readonly [RegExp, string])[] = [
    [/tk=[^&\s"']+/g, 'tk=***'],
    [pathPattern(repoRoot), '<仓库>'],
    [pathPattern(homedir()), '<用户目录>']
  ];
  const { username } = userInfo();
  const machine = hostname();
  return text => {
    let out = text;
    for (const [pattern, replacement] of rules) {
      out = out.replace(pattern, replacement);
    }
    if (machine.length > 2) {
      out = out.replace(new RegExp(`\\b${escape(machine)}\\b`, 'gi'), '<主机>');
    }
    if (username.length > 2) {
      out = out.replace(new RegExp(`\\b${escape(username)}\\b`, 'g'), '<用户>');
    }
    return out;
  };
}
