import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { localPath } from '../local-files/paths.ts';
import { HELP, parseOptions } from './args.ts';
import { CHECK_PASS_RATIO, type TrajectoryCheck } from './check.ts';
import { ToolError } from './errors.ts';
import { FIT_WINDOW, SCANNER_WINDOW } from './fit.ts';
import { parseIndex, parsePoses, type Vec3 } from './lcc2-data.ts';
import { type Placement, roundPlacement } from './placement.ts';
import { register, SAMPLE_SPACING } from './register.ts';

// LCC2 的配准（ADR 0149 第 4 节）：在 apps/yzt 下运行 pnpm lcc2:register <索引>，用法见 docs/commands.md

const signed = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const vector = (value: Vec3) => `(${value.map((part) => signed(part)).join(', ')})`;
const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

const describe = (check: TrajectoryCheck) => {
  const median = check.median === undefined ? '无' : `${check.median.toFixed(2)} 米`;
  return (
    `离脚下的表面 ${SCANNER_WINDOW.min}～${SCANNER_WINDOW.max} 米的点 ${percent(check.inWindow / check.sampled)}` +
    `（脚下有表面的 ${check.withFloor} 个，中位数 ${median}）`
  );
};

const json = (placement: Placement) => {
  const { lng, lat, height, heading } = roundPlacement(placement);
  return `{ "lng": ${lng}, "lat": ${lat}, "height": ${height}, "heading": ${heading} }`;
};

// 读 JSON 文件并校验：格式不对时说是哪个文件
function readJson<T>(path: string, parse: (text: string) => T): T {
  const text = readFileSync(path, 'utf8');
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = z.prettifyError(error).split(/\r?\n/).join('；');
      throw new ToolError(`${path} 的内容不对：${issues}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ToolError(`${path} 不是合法的 JSON：${error.message}`, { cause: error });
    }
    throw error;
  }
}

// 一次读一个网格文件：彭城广场的样例有 79 个、约 200 MB
function* readMeshes(root: string, files: readonly string[]) {
  for (const file of files) {
    yield { name: file, bytes: readFileSync(join(root, file)) };
  }
}

/** 跑一遍配准并打印，返回退出码 */
function main(): number {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const indexPath = isAbsolute(options.index) ? options.index : localPath('3dt', options.index);
  const root = dirname(indexPath);
  const index = readJson(indexPath, parseIndex);
  const trajectory = readJson(join(root, 'info/poses.json'), parsePoses);
  const { meshFiles } = index.root;
  if (meshFiles.length === 0) {
    throw new ToolError('索引的 root.meshFiles 是空的：这份数据没有碰撞网格，没法拟合和核对');
  }
  const missing = meshFiles.filter((file) => !existsSync(join(root, file)));
  if (missing.length > 0) {
    throw new ToolError(`索引里列的碰撞网格找不到 ${missing.length} 个，如 ${join(root, missing[0])}`);
  }

  console.log(`${basename(indexPath)}：EPSG:${index.epsg}，offset (${index.offset.map((v) => v.toFixed(3)).join(', ')})`);
  const started = performance.now();
  const result = register(
    {
      index,
      trajectory,
      meshes: readMeshes(root, meshFiles)
    },
    options
  );
  const { grid, fit, fitted, correction, check, asIsCheck } = result;
  console.log(
    `碰撞网格：${result.meshCount} 个文件，${grid.triangleCount} 个三角形，按 ${grid.cellSize} 米的方格采样出 ` +
      `${grid.heights.length} 个高度；扫描轨迹 ${trajectory.length} 个点，每隔 ${SAMPLE_SPACING} 米取一个，` +
      `共 ${result.sampleCount} 个（${((performance.now() - started) / 1000).toFixed(1)} 秒）`
  );

  if (fit) {
    console.log(
      `拟合：网格要平移 ${vector(fitted)} 米（东、北、上）才和轨迹对上；` +
        `脚下 ${FIT_WINDOW.min}～${FIT_WINDOW.max} 米有地面的点 ${percent(fit.fit.score)}，不平移时 ${percent(fit.asIsScore)}`
    );
    console.log(
      `      离地 ${SCANNER_WINDOW.min}～${SCANNER_WINDOW.max} 米的点 ${percent(fit.fit.scannerScore)}，` +
        `水平偏 0.5 米时降到 ${percent(Math.min(...fit.nearby))}～${percent(Math.max(...fit.nearby))}`
    );
    if (fit.fit.score < 0.5) {
      console.log('      不到一半的点对得上：轨迹可能不可信，用 --no-fit 和 --shift 人工配准');
    }
  } else {
    console.log('拟合：跳过（--no-fit），只用人工修正');
  }
  console.log(
    `修正：拟合 ${vector(fitted)} + 人工 ${vector(options.shift)} = ${vector(correction.shift)} 米，` +
      `偏航 ${signed(options.yaw, 3)}°；高程基准的差 ${signed(options.datum)} 米`
  );

  console.log(`轨迹核对：${describe(check)}，${check.passed ? '通过' : '不通过'}（至少 ${percent(CHECK_PASS_RATIO)}）`);
  console.log(`      不修正时 ${describe(asIsCheck)}`);
  const bins = check.histogram.filter((bin) => bin.count > 0);
  console.log(
    '      高度分布（米）：' +
      (bins.length > 0 ? bins.map((bin) => `${bin.from.toFixed(2)}～ ${bin.count}`).join('，') : '无（脚下没有表面）')
  );

  console.log(`按 offset 原样换算（对照）："placement": ${json(result.asIsPlacement)}`);
  if (result.failed) {
    console.error(`核对不通过，不要写进清单："placement": ${json(result.placement)}`);
    return 1;
  }
  console.log(`配准后的摆放：              "placement": ${json(result.placement)}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  // 参数、文件、数据不对时只打印一行原因；别的错是程序的问题，打印完整的错误、堆栈和原因
  if (error instanceof ToolError) {
    console.error(`[lcc2-register] ${error.message}`);
  } else if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    console.error(`[lcc2-register] ${error.message}`);
    console.error(
      `[lcc2-register] 索引的相对路径从 ${localPath('3dt')} 下找，worktree 里设 YZT_LOCAL_DIR 指回主目录；` +
        '模型目录里要有 info/poses.json 和索引 root.meshFiles 列的碰撞网格'
    );
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
