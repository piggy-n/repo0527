import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { localPath } from '../local-files/paths.ts';
import { HELP, parseOptions } from './args.ts';
import { checkTrajectory, CHECK_PASS_RATIO, type TrajectoryCheck } from './check.ts';
import { FIT_WINDOW, fitShift, SCANNER_WINDOW, scoreShift } from './fit.ts';
import { createFloorGridBuilder } from './floor-grid.ts';
import { parseIndex, parsePoses, samplePath, type Vec3 } from './lcc2-data.ts';
import {
  type Correction,
  correctionFromFit,
  NO_CORRECTION,
  type Placement,
  placementFor,
  roundPlacement,
  trajectoryToMesh
} from './placement.ts';
import { parsePly } from './ply.ts';
import { gridProjection } from './projection.ts';

// LCC2 的配准（ADR 0149 第 4 节）：在 apps/yzt 下运行 pnpm lcc2:register <索引>，用法见 docs/commands.md

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

const indexPath = isAbsolute(options.index) ? options.index : localPath('3dt', options.index);
const root = dirname(indexPath);
const index = parseIndex(readFileSync(indexPath, 'utf8'));
const trajectory = parsePoses(readFileSync(join(root, 'info/poses.json'), 'utf8'));
const meshDir = join(root, 'data/mesh');
const meshFiles = readdirSync(meshDir).filter((name) => name.endsWith('.ply'));
const projection = gridProjection(index.epsg);

const signed = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const vector = (value: Vec3) => `(${value.map((part) => signed(part)).join(', ')})`;
const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

console.log(`${basename(indexPath)}：EPSG:${index.epsg}，offset (${index.offset.map((v) => v.toFixed(3)).join(', ')})`);

let started = performance.now();
const builder = createFloorGridBuilder();
for (const name of meshFiles) {
  builder.add(parsePly(readFileSync(join(meshDir, name))));
}
const grid = builder.build();
const seconds = () => `${((performance.now() - started) / 1000).toFixed(1)} 秒`;
console.log(
  `碰撞网格：${meshFiles.length} 个文件，${grid.triangleCount} 个三角形，` +
    `按 ${grid.cellSize} 米的方格采样出 ${grid.heights.length} 个高度（${seconds()}）`
);

const samples = samplePath(trajectory, 0.5);
console.log(`扫描轨迹：${trajectory.length} 个点，每隔 0.5 米取一个，共 ${samples.length} 个`);

let fitted: Vec3 = [0, 0, 0];
if (options.fit) {
  started = performance.now();
  const fit = fitShift(trajectory, grid);
  fitted = correctionFromFit(fit.shift);
  const asIs = scoreShift(samples, grid, [0, 0, 0], FIT_WINDOW);
  console.log(
    `拟合：网格要平移 ${vector(fitted)} 米（东、北、上）才和轨迹对上（${seconds()}）；` +
      `脚下 ${FIT_WINDOW.min}～${FIT_WINDOW.max} 米有地面的点 ${percent(fit.score)}，不平移时 ${percent(asIs)}`
  );
  // 峰有多尖：水平偏 0.5 米时扫描仪高度的窗口满足的比例
  const nearby = [
    [0.5, 0],
    [-0.5, 0],
    [0, 0.5],
    [0, -0.5]
  ].map(([dx, dy]) =>
    scoreShift(samples, grid, [fit.shift[0] + dx, fit.shift[1] + dy, fit.shift[2]], SCANNER_WINDOW)
  );
  console.log(
    `      离地 ${SCANNER_WINDOW.min}～${SCANNER_WINDOW.max} 米的点 ${percent(fit.scannerScore)}，` +
      `水平偏 0.5 米时降到 ${percent(Math.min(...nearby))}～${percent(Math.max(...nearby))}`
  );
  if (fit.score < 0.5) {
    console.log('      不到一半的点对得上：轨迹可能不可信，用 --no-fit 和 --shift 人工配准');
  }
} else {
  console.log('拟合：跳过（--no-fit），只用人工修正');
}

const shift: Vec3 = [
  fitted[0] + options.shift[0],
  fitted[1] + options.shift[1],
  fitted[2] + options.shift[2]
];
const correction: Correction = { shift, yaw: options.yaw };
console.log(
  `修正：拟合 ${vector(fitted)} + 人工 ${vector(options.shift)} = ${vector(shift)} 米，偏航 ${signed(options.yaw, 3)}°` +
    `；高程基准的差 ${signed(options.datum)} 米`
);

const describe = (check: TrajectoryCheck) => {
  const median = check.median === undefined ? '无' : `${check.median.toFixed(2)} 米`;
  return (
    `离脚下的表面 ${SCANNER_WINDOW.min}～${SCANNER_WINDOW.max} 米的点 ${percent(check.inWindow / check.sampled)}` +
    `（脚下有表面的 ${check.withFloor} 个，中位数 ${median}）`
  );
};
const checkFor = (value: Correction) =>
  checkTrajectory(
    samples.map((point) => trajectoryToMesh(point, value)),
    grid
  );
const asIsCheck = checkFor(NO_CORRECTION);
const check = checkFor(correction);
console.log(`轨迹核对：${describe(check)}，${check.passed ? '通过' : '不通过'}（至少 ${percent(CHECK_PASS_RATIO)}）`);
console.log(`      不修正时 ${describe(asIsCheck)}`);
console.log(
  '      高度分布（米）：' +
    check.histogram
      .filter((bin) => bin.count > 0)
      .map((bin) => `${bin.from.toFixed(2)}～ ${bin.count}`)
      .join('，')
);

const json = (placement: Placement) => {
  const { lng, lat, height, heading } = roundPlacement(placement);
  return `{ "lng": ${lng}, "lat": ${lat}, "height": ${height}, "heading": ${heading} }`;
};
console.log(`按 offset 原样换算（对照）："placement": ${json(placementFor(projection, index.offset, NO_CORRECTION))}`);
console.log(
  `配准后的摆放：              "placement": ${json(placementFor(projection, index.offset, correction, options.datum))}`
);
if (!check.passed) {
  process.exitCode = 1;
}
