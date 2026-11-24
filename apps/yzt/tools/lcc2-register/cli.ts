import { basename } from 'node:path';
import { localPath } from '../local-files/paths.ts';
import { HELP, parseOptions } from './args.ts';
import { CHECK_PASS_RATIO, type TrajectoryCheck } from './check.ts';
import { ToolError } from './errors.ts';
import { FIT_WINDOW, SCANNER_WINDOW } from './fit.ts';
import type { Vec3 } from './lcc2-data.ts';
import { type Placement, roundPlacement, trajectoryToMesh } from './placement.ts';
import { gridProjection } from './projection.ts';
import { writePlan } from './plan-file.ts';
import { type PlanInput, planSvg } from './plan-svg.ts';
import { manifestPath, manifestSpawn, manifestWalkway, outline, type RoamFrame } from './roam-manifest.ts';
import { cornerLine, cornerSummary, gapLine, toleranceLabel } from './roam-report.ts';
import { routeWithCorners, spawnOf, STRAIGHT_HORIZONTAL, trackOf } from './roam.ts';
import { register, SAMPLE_SPACING } from './register.ts';
import { readModel } from './source.ts';
import { suggestedSpan, WALKWAY_WIDTH, walkwayFloors, walkwayGaps, walkwayOf } from './walkway.ts';

// LCC2 的配准（ADR 0149 第 4 节）：在 apps/yzt 下运行 pnpm lcc2:register <索引> --datum <米>，用法见 docs/commands.md

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

// 出生点、轨迹的概要和路线（ADR 0156 第 4 节）：轨迹按这次的修正换到网格的局部系，贴着同一份地面方格；
// 给了 --plan 时返回平面图要画的内容，由 main 在打印摆放以后画和写
function printRoam(
  result: Awaited<ReturnType<typeof register>>,
  model: Awaited<ReturnType<typeof readModel>>,
  options: ReturnType<typeof parseOptions>
): PlanInput | null {
  const { index, trajectory } = model;
  const frame: RoamFrame = {
    projection: gridProjection(index.epsg),
    offset: index.offset,
    correction: result.correction,
    datum: options.datum,
    placement: result.placement
  };
  const track = trackOf(
    trajectory.map((point) => trajectoryToMesh(point, result.correction)),
    result.grid
  );
  console.log(`轨迹共 ${(track.at(-1)?.distance ?? 0).toFixed(0)} 米，概要（局部系，米）：`);
  outline(track).forEach((line) => console.log(line));
  const spawn = manifestSpawn(track, options.spawnAt, frame);
  console.log(`出生点（轨迹 ${options.spawnAt} 米以后）："spawn": ${JSON.stringify(spawn)}`);
  // 路线先在局部系里算一遍，清单的写法和平面图都用它；拉直留下的拐点按原因计数，--diagnose 时逐个列出
  // 补的地板经过的取样点，路线也走在补的地板上（ADR 0170），不落到玻璃下面的坑底；几段重叠时取写在后面的
  const walkwayFloorsAt = new Map<number, number>();
  options.walkways.forEach((span) =>
    walkwayFloors(track, result.grid, span).forEach((floor, i) => walkwayFloorsAt.set(i, floor))
  );
  const localRoutes = options.routes.map((span) => {
    const tolerance = span.tolerance ?? STRAIGHT_HORIZONTAL;
    const { points, corners } = routeWithCorners(track, span.from, span.to, result.grid, {
      tolerance,
      stretches: options.stretches,
      floors: walkwayFloorsAt
    });
    const label = toleranceLabel(span, tolerance, options.stretches);
    console.log(`路线 ${span.id}（${label}）：${cornerSummary(corners)}`);
    if (options.diagnose) {
      corners.forEach((corner) => console.log(cornerLine(corner)));
    }
    return { ...span, points };
  });
  if (localRoutes.length > 0) {
    const routes = localRoutes.map(({ id, name, points }) => ({ id, name, path: manifestPath(points, frame) }));
    const lines = routes.map(
      ({ id, name, path }) =>
        `    { "id": ${JSON.stringify(id)}, "name": ${JSON.stringify(name)}, "path": [\n` +
        path.map((point) => `      ${JSON.stringify(point)}`).join(',\n') +
        '\n    ] }'
    );
    const counts = routes.map(({ path }) => `${path.length} 个点`).join('、');
    console.log(`路线（${counts}）："routes": [\n${lines.join(',\n')}\n  ]`);
  }
  // 补的地板（ADR 0170）：先列断口候选，给了 --walkway 再算
  const gaps = walkwayGaps(track);
  if (gaps.length === 0) {
    console.log('断口候选：没有');
  } else {
    console.log(
      '断口候选（脚下缺人走的那层表面：玻璃栈道、网格的洞、数据的边；在 /dev/nav-grid 上确认两边断成了两片，要补时照建议写 --walkway）：'
    );
    gaps.forEach((gap) => console.log(gapLine(gap, suggestedSpan(gap, track))));
  }
  const localWalkways = options.walkways.map((span) => {
    const width = span.width ?? WALKWAY_WIDTH;
    return { ...span, width, points: walkwayOf(track, result.grid, span) };
  });
  if (localWalkways.length > 0) {
    const walkways = localWalkways.map(({ points, width }) => manifestWalkway(points, width, frame));
    const lines = walkways.map(
      ({ width, path }) =>
        `    { "width": ${width}, "path": [\n` +
        path.map((point) => `      ${JSON.stringify(point)}`).join(',\n') +
        '\n    ] }'
    );
    const counts = walkways.map(({ path }) => `${path.length} 个点`).join('、');
    console.log(`补的地板（${counts}）："walkways": [\n${lines.join(',\n')}\n  ]`);
  }
  if (options.plan === null) {
    return null;
  }
  return {
    title: basename(options.index),
    heading: result.placement.heading,
    grid: result.grid,
    track,
    spawn: spawnOf(track, options.spawnAt),
    routes: localRoutes,
    walkways: localWalkways,
    gaps
  };
}

/** 跑一遍配准并打印，返回退出码 */
async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const model = await readModel(options.index, { localRoot: localPath('3dt'), proxy: process.env.YZT_3DT_PROXY });
  const { index, trajectory } = model;
  console.log(`${model.location}：EPSG:${index.epsg}，offset (${index.offset.map((v) => v.toFixed(3)).join(', ')})`);
  const started = performance.now();
  const result = await register(model, options);
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
  const plan = options.roam ? printRoam(result, model, options) : null;
  if (result.failed) {
    console.error(`核对不通过，不要写进清单："placement": ${json(result.placement)}`);
  } else {
    console.log(`配准后的摆放：              "placement": ${json(result.placement)}`);
  }
  // 平面图最后画、最后写：写不了时摆放、出生点、路线已经打印出来；相对路径放在 local/ 下，不入库
  if (plan !== null && options.plan !== null) {
    console.log(`平面图：${await writePlan(options.plan, planSvg(plan), localPath())}`);
  }
  return result.failed ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  // 参数、文件、网络、数据不对时只打印一行原因；别的错是程序的问题，打印完整的错误、堆栈和原因
  if (error instanceof ToolError) {
    console.error(`[lcc2-register] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
