import {
  delta,
  type FinishedRequest,
  kb,
  type LongTask,
  medianOf,
  ms,
  NETWORK_PROFILES,
  type ProfileName,
  sum
} from './report.ts';

/** 和 src/shared/perf/switch-to-3d.ts 的步骤一致（由测试保证）；开始是点"三维"的时刻 */
export const SCENE_TRACE_NAME = 'switch-to-3d';
export const SCENE_STEPS = ['runtime', 'view-ready', 'settled'] as const;
export type SceneStep = (typeof SCENE_STEPS)[number];

const STEP_LABELS: Record<SceneStep, string> = {
  runtime: '三维运行时',
  'view-ready': '视图就绪',
  settled: '画面稳定'
};

/** 一次切到三维在浏览器里取到的原始数据 */
export interface SceneRawRun {
  readonly settled: boolean;
  /** 各步骤从点"三维"量起的毫秒数，没记到的步骤不在里面 */
  readonly measures: Readonly<Partial<Record<SceneStep, number>>>;
  /** 二维停留开始、点"三维"两个时刻（performance.now），用来挑出停留期间的长任务 */
  readonly stayStart: number;
  readonly traceStart: number;
  readonly longTasks: readonly LongTask[];
  /** 停留开始以后完成的请求，完成时刻从点"三维"量起（负数是停留期间已经下载完，例如预加载） */
  readonly requests: readonly FinishedRequest[];
  /** 三维画面稳定（或超时）时还没下载完的请求地址 */
  readonly unfinished: readonly string[];
  /** 点"三维"之前、三维画面稳定以后的 JS 堆（字节，CDP 的 JSHeapUsedSize） */
  readonly heapBefore: number;
  readonly heapAfter: number;
}

const CHUNK = /\/assets\/map-cesium-[\w-]+\.js$/;
// Cesium 运行时按需取的文件：Worker 脚本、资源、第三方库（复制到产物的 cesium/）
const CESIUM_FILES = /\/cesium\/(Workers|Assets|ThirdParty)\//;

interface Download {
  readonly finish: number;
  readonly bytes: number;
}

export interface SceneRunSummary {
  readonly settled: boolean;
  readonly steps: Readonly<Partial<Record<SceneStep, number>>>;
  /** map-cesium 分块（含 Cesium）的完成时刻和压缩后的大小 */
  readonly chunk: Download | null;
  /** Cesium 运行时文件：个数、最后一个的完成时刻 */
  readonly cesiumFiles: { readonly count: number; readonly lastFinish: number | null };
  /** 停留期间下载的总量（预加载花的流量），点了以后下载的总量 */
  readonly bytesBeforeStart: number;
  readonly bytesAfterStart: number;
  readonly unfinished: readonly string[];
  /** 二维停留期间的长任务：预加载执行脚本会不会卡住二维 */
  readonly stayLongTasks: { readonly count: number; readonly total: number; readonly longest: number };
  /** 三维画面稳定后比切换前多出来的 JS 堆（字节） */
  readonly heapGrowth: number;
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

/** 把一次切到三维的原始数据整理成要比较的数字 */
export function summarizeSceneRun(raw: SceneRawRun): SceneRunSummary {
  const chunk = raw.requests
    .filter(({ url }) => CHUNK.test(pathOf(url)))
    .reduce<FinishedRequest | undefined>(
      (latest, request) => (!latest || request.finish > latest.finish ? request : latest),
      undefined
    );
  const files = raw.requests.filter(({ url }) => CESIUM_FILES.test(pathOf(url)));
  const stayTasks = raw.longTasks.filter(({ startTime }) => startTime >= raw.stayStart && startTime < raw.traceStart);
  return {
    settled: raw.settled,
    steps: raw.measures,
    chunk: chunk ? { finish: chunk.finish, bytes: chunk.bytes } : null,
    cesiumFiles: {
      count: files.length,
      lastFinish: files.length > 0 ? Math.max(...files.map(({ finish }) => finish)) : null
    },
    bytesBeforeStart: sum(raw.requests.filter(({ finish }) => finish <= 0).map(({ bytes }) => bytes)),
    bytesAfterStart: sum(raw.requests.filter(({ finish }) => finish > 0).map(({ bytes }) => bytes)),
    unfinished: raw.unfinished.map(pathOf),
    stayLongTasks: {
      count: stayTasks.length,
      total: sum(stayTasks.map(({ duration }) => duration)),
      longest: stayTasks.length > 0 ? Math.max(...stayTasks.map(({ duration }) => duration)) : 0
    },
    heapGrowth: raw.heapAfter - raw.heapBefore
  };
}

export interface SceneProfileResult {
  readonly profile: ProfileName;
  readonly runs: readonly SceneRunSummary[];
}

const mb = (bytes: number | undefined) => (bytes === undefined ? '—' : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** 每档网络一行：步骤、资源和流量、停留期间的长任务；都是完成了的几次的中位数 */
export function formatSceneReport(results: readonly SceneProfileResult[]): string {
  const rows = results.map(({ profile, runs }) => ({
    label: NETWORK_PROFILES[profile].label,
    done: runs.filter(({ settled }) => settled),
    total: runs.length
  }));
  const steps = [
    `| 网络 | 完成 | ${SCENE_STEPS.map(step => STEP_LABELS[step]).join(' | ')} |`,
    `|---|---|${SCENE_STEPS.map(() => '---|').join('')}`,
    ...rows.map(({ label, done, total }) => {
      const cells = SCENE_STEPS.map(step => ms(medianOf(done, run => run.steps[step])));
      return `| ${label} | ${done.length}/${total} | ${cells.join(' | ')} |`;
    })
  ];
  const resources = [
    '| 网络 | map-cesium 分块 | Cesium 文件（最后一个） | 停留期间下载 | 点了以后下载 | JS 堆增加 |',
    '|---|---|---|---|---|---|',
    ...rows.map(({ label, done }) => {
      const chunk = `${ms(medianOf(done, run => run.chunk?.finish))}（${kb(medianOf(done, run => run.chunk?.bytes))}）`;
      const lastFile = ms(medianOf(done, run => run.cesiumFiles.lastFinish));
      const files = `${lastFile}（${ms(medianOf(done, run => run.cesiumFiles.count))} 个）`;
      const before = kb(medianOf(done, run => run.bytesBeforeStart));
      const after = kb(medianOf(done, run => run.bytesAfterStart));
      return `| ${label} | ${chunk} | ${files} | ${before} | ${after} | ${mb(medianOf(done, run => run.heapGrowth))} |`;
    })
  ];
  const longTasks = [
    '| 网络 | 个数 | 总时长 | 最长 |',
    '|---|---|---|---|',
    ...rows.map(({ label, done }) => {
      const keys = ['count', 'total', 'longest'] as const;
      const cells = keys.map(key => ms(medianOf(done, run => run.stayLongTasks[key])));
      return `| ${label} | ${cells.join(' | ')} |`;
    })
  ];
  const unfinished = rows.map(({ label, done }) => {
    const counts = new Map<string, number>();
    for (const path of done.flatMap(run => [...new Set(run.unfinished)])) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    const listed = [...counts].map(([path, count]) => `${path}（${count}/${done.length} 次）`);
    return `- ${label}：${listed.length > 0 ? listed.join('，') : '没有'}`;
  });
  return [
    '步骤（毫秒，从点"三维"算起，完成了的几次取中位数）：',
    '',
    ...steps,
    '',
    '资源的完成时刻和流量（毫秒，负数是点之前已经下载完；括号里是压缩后的大小）：',
    '',
    ...resources,
    '',
    '三维画面稳定时还没下载完的请求：',
    '',
    ...unfinished,
    '',
    '二维停留期间的长任务（超过 50 毫秒的任务，毫秒）：',
    '',
    ...longTasks
  ].join('\n');
}

export interface SceneBuildResult {
  readonly build: string;
  readonly profiles: readonly SceneProfileResult[];
}

/** 多份构建的对比：每份一行，第一份是参照；画面稳定、三维运行时、停留期间长任务的总时长和下载量，都是中位数 */
export function formatSceneComparison(builds: readonly SceneBuildResult[]): string {
  const [reference] = builds;
  if (!reference) {
    return '';
  }
  const profiles = reference.profiles.map(({ profile }) => profile);
  const done = (result: SceneBuildResult, profile: ProfileName) =>
    result.profiles.find(item => item.profile === profile)?.runs.filter(({ settled }) => settled) ?? [];
  const table = (
    title: string,
    pick: (run: SceneRunSummary) => number | undefined | null,
    format: (value: number | undefined) => string,
    withDelta: boolean
  ) => [
    title,
    '',
    `| 构建 | ${profiles.map(profile => NETWORK_PROFILES[profile].label).join(' | ')} |`,
    `|---|${profiles.map(() => '---|').join('')}`,
    ...builds.map(result => {
      const cells = profiles.map(profile => {
        const value = medianOf(done(result, profile), pick);
        const base = medianOf(done(reference, profile), pick);
        return `${format(value)}${withDelta && result !== reference ? delta(value, base) : ''}`;
      });
      return `| ${result.build} | ${cells.join(' | ')} |`;
    })
  ];
  return [
    ...table(`三维画面稳定（毫秒，括号里是和 ${reference.build} 的差）：`, run => run.steps.settled, ms, true),
    '',
    ...table(`三维运行时（毫秒，括号里是和 ${reference.build} 的差）：`, run => run.steps.runtime, ms, true),
    '',
    ...table('二维停留期间长任务的总时长（毫秒）：', run => run.stayLongTasks.total, ms, false),
    '',
    ...table('二维停留期间下载的总量：', run => run.bytesBeforeStart, kb, false)
  ].join('\n');
}
