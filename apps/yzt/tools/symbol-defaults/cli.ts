import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import type { ImportSymbolDefaults } from '../../src/features/resource-map/symbol-defaults/contract.ts';
import { parseCommand, USAGE } from './args.ts';

// 把控制台片段导出的图例样式合并进发布的默认符号（ADR 0154）。合并、校验和差异在 import.ts 里，用的是页面的 schema
// 和登记表；应用的模块导入时不写扩展名，Node 直接加载不了，所以交给 Vite 加载
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULTS_FILE = 'src/features/resource-map/resource-symbol-defaults.json';
const IMPORT_MODULE = 'src/features/resource-map/symbol-defaults/import.ts';

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  if (!command) {
    console.log(USAGE);
    return;
  }
  // pnpm --filter 在 apps/yzt 下运行脚本：导出文件的相对路径按运行 pnpm 时所在的目录解析
  const exported = readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), command.file), 'utf8');
  const defaultsFile = resolve(APP_DIR, DEFAULTS_FILE);
  const { module } = await runnerImport<{ importSymbolDefaults: ImportSymbolDefaults }>(
    resolve(APP_DIR, IMPORT_MODULE),
    { root: APP_DIR, logLevel: 'error' }
  );
  const result = module.importSymbolDefaults({
    exported,
    current: readFileSync(defaultsFile, 'utf8'),
    ...(command.login === undefined ? {} : { login: command.login }),
    ...(command.only === undefined ? {} : { only: command.only })
  });
  console.log(result.report.join('\n'));
  if (!result.changed) {
    return;
  }
  if (command.write) {
    writeFileSync(defaultsFile, result.next);
    console.log(`\n已写入 ${DEFAULTS_FILE}，用 git diff 检查后提交`);
  } else {
    console.log(`\n只打印了差异，没有写入；确认后加 --write 写入 ${DEFAULTS_FILE}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`[symbols:import] ${error instanceof Error ? error.message : String(error)}（--help 看用法）`);
  process.exitCode = 1;
}
