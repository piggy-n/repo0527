import { checkTrajectory, type TrajectoryCheck } from './check.ts';
import { ToolError } from './errors.ts';
import { type Fit, FIT_WINDOW, fitShift, SCANNER_WINDOW, scoreShift } from './fit.ts';
import { createFloorGridBuilder, type FloorGrid } from './floor-grid.ts';
import { type Lcc2Index, samplePath, type Vec3 } from './lcc2-data.ts';
import {
  type Correction,
  correctionFromFit,
  NO_CORRECTION,
  type Placement,
  placementFor,
  trajectoryToMesh
} from './placement.ts';
import { parsePly } from './ply.ts';
import { gridProjection } from './projection.ts';

// 配准的计算（ADR 0149 第 4 节），不读文件、不打印：source.ts 读文件，cli.ts 交进来、按结果打印

/** 核对和打分时轨迹的取样间隔（米） */
export const SAMPLE_SPACING = 0.5;

export interface RegisterOptions {
  /** 人工修正（米，网格的东、北、上），加在拟合的结果上 */
  readonly shift: Vec3;
  /** 偏航（度），绕局部系原点逆时针 */
  readonly yaw: number;
  /** 高程基准的差（米），只加在高度上 */
  readonly datum: number;
  readonly fit: boolean;
}

export interface RegisterInput {
  readonly index: Lcc2Index;
  /** 扫描轨迹，LCC2 局部系 */
  readonly trajectory: readonly Vec3[];
  /** 碰撞网格：文件名（报错时用）和内容；可以边读边交，读完的不留在内存里 */
  readonly meshes:
    | Iterable<{ readonly name: string; readonly bytes: Uint8Array }>
    | AsyncIterable<{ readonly name: string; readonly bytes: Uint8Array }>;
}

export interface FitReport {
  /** 在转过 -yaw 的轨迹上拟合的结果 */
  readonly fit: Fit;
  /** 只转 -yaw、不平移时，宽窗口满足的比例 */
  readonly asIsScore: number;
  /** 拟合的平移沿网格系的 x、y 各偏 ±0.5 米（给了偏航时是转过的网格轴，不是正东正北）时扫描仪窗口满足的比例：看峰有多尖 */
  readonly nearby: readonly number[];
}

export interface Registration {
  readonly grid: FloorGrid;
  readonly meshCount: number;
  readonly sampleCount: number;
  /** --no-fit 时为 null */
  readonly fit: FitReport | null;
  /** 拟合得到的修正（米，网格的东、北、上），已经按偏航转好 */
  readonly fitted: Vec3;
  readonly correction: Correction;
  readonly check: TrajectoryCheck;
  readonly asIsCheck: TrajectoryCheck;
  readonly placement: Placement;
  readonly asIsPlacement: Placement;
  /** 轨迹核对不通过：命令以失败退出 */
  readonly failed: boolean;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function register(input: RegisterInput, options: RegisterOptions): Promise<Registration> {
  const builder = createFloorGridBuilder();
  let meshCount = 0;
  for await (const { name, bytes } of input.meshes) {
    try {
      builder.add(parsePly(bytes));
    } catch (error) {
      // 数据的问题带上文件名照样是一行的原因；别的错是程序的问题，原因留在 cause 里
      const Wrapper = error instanceof ToolError ? ToolError : Error;
      throw new Wrapper(`${name}：${message(error)}`, { cause: error });
    }
    meshCount++;
  }
  const grid = builder.build();

  // 拟合只求平移：给了偏航时先把轨迹转 -yaw（网格的系里），拟合出的平移再转回来，和偏航一起组成修正
  const turn = { shift: [0, 0, 0], yaw: options.yaw } as const;
  const samples = samplePath(input.trajectory, SAMPLE_SPACING);
  const turnedSamples = samples.map((point) => trajectoryToMesh(point, turn));
  let fit: FitReport | null = null;
  let fitted: Vec3 = [0, 0, 0];
  if (options.fit) {
    const result = fitShift(
      input.trajectory.map((point) => trajectoryToMesh(point, turn)),
      grid
    );
    const [tx, ty, tz] = result.shift;
    fit = {
      fit: result,
      asIsScore: scoreShift(turnedSamples, grid, [0, 0, 0], FIT_WINDOW),
      nearby: [
        [0.5, 0],
        [-0.5, 0],
        [0, 0.5],
        [0, -0.5]
      ].map(([dx, dy]) => scoreShift(turnedSamples, grid, [tx + dx, ty + dy, tz], SCANNER_WINDOW))
    };
    fitted = correctionFromFit(result.shift, options.yaw);
  }

  const correction: Correction = {
    shift: [fitted[0] + options.shift[0], fitted[1] + options.shift[1], fitted[2] + options.shift[2]],
    yaw: options.yaw
  };
  const checkFor = (value: Correction) =>
    checkTrajectory(
      samples.map((point) => trajectoryToMesh(point, value)),
      grid
    );
  const check = checkFor(correction);
  const projection = gridProjection(input.index.epsg);
  return {
    grid,
    meshCount,
    sampleCount: samples.length,
    fit,
    fitted,
    correction,
    check,
    asIsCheck: checkFor(NO_CORRECTION),
    placement: placementFor(projection, input.index.offset, correction, options.datum),
    asIsPlacement: placementFor(projection, input.index.offset, NO_CORRECTION),
    failed: !check.passed
  };
}
