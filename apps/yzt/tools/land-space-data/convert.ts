import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLandSpaceFile, type City, type LandSpaceFile } from './land-space.ts';
import { readWorkbook } from './xlsx.ts';

// 把《指标汇总.xlsx》转成综合分析驾驶舱的数据：在 apps/yzt 下运行 pnpm land-space:data <xlsx 路径> [输出路径]
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_OUTPUT = 'src/features/land-space-dashboard/data/land-space-2025.json';
const REGION_CATALOG = 'src/shared/map/region/data/jiangsu-regions.json';
const USAGE = `用法：pnpm --filter yzt land-space:data <指标汇总.xlsx> [输出路径，默认 apps/yzt/${DEFAULT_OUTPUT}]`;

// 13 个市和顺序取区划目录，与驾驶舱一致
function readCities(): City[] {
  const catalog = JSON.parse(readFileSync(resolve(APP_DIR, REGION_CATALOG), 'utf8')) as readonly City[];
  return catalog.map(({ code, name }) => ({ code, name }));
}

function summary(file: LandSpaceFile, cities: readonly City[]): string[] {
  const subIndices = file.domains.flatMap(domain => domain.subIndices);
  const indicators = subIndices.flatMap(sub => sub.indicators);
  const cityName = new Map(cities.map(city => [city.code, city.name]));
  const empty = Object.entries(file.values).flatMap(([id, byCity]) =>
    Object.entries(byCity)
      .filter(([, value]) => value === null)
      .map(([code]) => `${id}（${cityName.get(code) ?? code}）`)
  );
  const parts = indicators.reduce((sum, indicator) => sum + indicator.parts.length, 0);
  const withoutValues = subIndices.filter(sub => !sub.hasValues).map(sub => `${sub.indexId} ${sub.name}`);
  return [
    `一级 ${file.domains.length} 项，二级 ${subIndices.length} 项，三级 ${indicators.length} 项，分项 ${parts} 项`,
    `值 ${Object.keys(file.values).length} 组，全省值 ${Object.keys(file.province).length} 个`,
    `没有指数值的二级：${withoutValues.join('、') || '无'}`,
    `空值：${empty.join('、') || '无'}`
  ];
}

function main(): void {
  const [input, output, ...rest] = process.argv.slice(2);
  if (input === undefined || input === '--help' || input === '-h' || rest.length > 0) {
    console.log(USAGE);
    process.exitCode = input === undefined || rest.length > 0 ? 1 : 0;
    return;
  }
  // pnpm --filter 在 apps/yzt 下运行脚本：命令行里的相对路径按运行 pnpm 时所在的目录解析
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const source = resolve(cwd, input);
  const target = output === undefined ? resolve(APP_DIR, DEFAULT_OUTPUT) : resolve(cwd, output);
  const cities = readCities();
  const file = buildLandSpaceFile(readWorkbook(readFileSync(source)), basename(source), cities);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
  for (const line of summary(file, cities)) {
    console.log(`[land-space:data] ${line}`);
  }
  console.log(`[land-space:data] 已写入 ${relative(cwd, target)}，用 git diff 检查后提交`);
}

try {
  main();
} catch (error) {
  console.error(`[land-space:data] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
