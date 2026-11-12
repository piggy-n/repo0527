import { parseArgs } from 'node:util';

export const USAGE = `用法：pnpm --filter yzt symbols:import <导出文件> [--login 登录名] [--only code1,code2] [--write]

把控制台片段导出的图例样式合并进发布的默认符号（ADR 0154，步骤见 docs/modules/storage.md 的"发布的默认符号"）。
  --login  导出文件里有几个账号时选哪一个
  --only   只导入这些资源（逗号分隔的 code），其他资源保持现在的发布默认
  --write  写入 src/features/resource-map/resource-symbol-defaults.json；不加时只打印差异
导出文件含登录名，放在 local/symbol-defaults/，不要提交。`;

export interface ImportCommand {
  readonly file: string;
  readonly login?: string;
  readonly only?: readonly string[];
  readonly write: boolean;
}

/** 解析命令行参数：要看用法时为 null；参数不对时抛错 */
export function parseCommand(args: readonly string[]): ImportCommand | null {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      login: { type: 'string' },
      only: { type: 'string' },
      write: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  if (values.help) {
    return null;
  }
  const [file, ...rest] = positionals;
  if (file === undefined || rest.length > 0) {
    throw new Error('要给出一个导出文件');
  }
  const only = values.only
    ?.split(/[,，]/)
    .map(code => code.trim())
    .filter(code => code !== '');
  if (only?.length === 0) {
    throw new Error('--only 后面要写资源的 code');
  }
  return {
    file,
    write: values.write,
    ...(values.login === undefined ? {} : { login: values.login }),
    ...(only === undefined ? {} : { only })
  };
}
