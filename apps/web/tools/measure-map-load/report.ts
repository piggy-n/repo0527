import { parseArgs } from 'node:util';

/** 和 src/shared/perf/login-to-map.ts 的步骤一致（由测试保证）；开始是校验通过、发出登录请求的时刻 */
export const TRACE_NAME = 'login-to-map';
export const STEPS = ['session', 'runtime', 'page', 'view-ready', 'settled'] as const;
export type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  session: '登录接口返回',
  runtime: '地图运行时',
  page: '地图页创建',
  'view-ready': '视图就绪',
  settled: '画面稳定'
};

/** CDP 的 Network.emulateNetworkConditions 参数：吞吐量是字节每秒，延迟是毫秒 */
export interface NetworkConditions {
  readonly latency: number;
  readonly downloadThroughput: number;
  readonly uploadThroughput: number;
}

// 限速的两档取 Chrome DevTools 的预设：Fast 4G 是 9 Mbps 下行、1.5 Mbps 上行、60 ms 往返，Slow 4G 是 1.6 Mbps、750 kbps、150 ms，
// DevTools 再按 0.9 折算吞吐量、按 2.75 和 3.75 放大延迟（模拟真实网络的开销）
export const NETWORK_PROFILES = {
  none: { label: '不限速', conditions: null },
  fast4g: {
    label: 'Fast 4G',
    conditions: { latency: 60 * 2.75, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9 }
  },
  slow4g: {
    label: 'Slow 4G',
    conditions: { latency: 150 * 3.75, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 }
  }
} as const satisfies Record<string, { label: string; conditions: NetworkConditions | null }>;
export type ProfileName = keyof typeof NETWORK_PROFILES;

const CHANNELS = ['msedge', 'chrome', 'chromium'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface MeasureOptions {
  readonly runs: number;
  readonly profiles: readonly ProfileName[];
  /** 登录页停留的毫秒数，模拟输入账号密码的时间 */
  readonly dwell: number;
  /** CPU 降速倍数，1 是不降速 */
  readonly cpu: number;
  readonly channel: Channel;
  readonly headless: boolean;
  /** 结果文件名的前缀，如 baseline、preload */
  readonly label: string;
  /** 已经在运行的服务器地址；不给时由脚本启动 vite preview */
  readonly url: string | undefined;
  /** 每一次从点击登录到画面稳定最多等多久（毫秒） */
  readonly timeout: number;
}

function isProfileName(name: string): name is ProfileName {
  return Object.hasOwn(NETWORK_PROFILES, name);
}

function isChannel(name: string): name is Channel {
  return (CHANNELS as readonly string[]).includes(name);
}

function integerAtLeast(text: string, min: number, option: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`--${option} 要是不小于 ${min} 的整数，收到 ${text}`);
  }
  return value;
}

/** 解析命令行参数；不认识的参数、不合法的取值抛错 */
export function parseOptions(argv: readonly string[]): MeasureOptions {
  // pnpm 转发参数时可能带上分隔用的 --
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      runs: { type: 'string', default: '5' },
      profiles: { type: 'string', default: 'none,fast4g,slow4g' },
      dwell: { type: 'string', default: '5000' },
      cpu: { type: 'string', default: '1' },
      channel: { type: 'string', default: 'msedge' },
      headless: { type: 'boolean', default: false },
      label: { type: 'string', default: 'run' },
      url: { type: 'string' },
      timeout: { type: 'string', default: '120000' }
    }
  });
  const profiles = values.profiles.split(',').map(name => name.trim());
  const unknown = profiles.filter(name => !isProfileName(name));
  if (unknown.length > 0 || profiles.length === 0) {
    throw new Error(`--profiles 只能是 ${Object.keys(NETWORK_PROFILES).join('、')}，收到 ${values.profiles}`);
  }
  if (!isChannel(values.channel)) {
    throw new Error(`--channel 只能是 ${CHANNELS.join('、')}，收到 ${values.channel}`);
  }
  if (!/^[\w-]+$/.test(values.label)) {
    throw new Error(`--label 只能有字母、数字、下划线和连字符，收到 ${values.label}`);
  }
  return {
    runs: integerAtLeast(values.runs, 1, 'runs'),
    profiles: profiles.filter(isProfileName),
    dwell: integerAtLeast(values.dwell, 0, 'dwell'),
    cpu: integerAtLeast(values.cpu, 1, 'cpu'),
    channel: values.channel,
    headless: values.headless,
    label: values.label,
    url: values.url,
    timeout: integerAtLeast(values.timeout, 1000, 'timeout')
  };
}

/** 一次请求：完成时刻从开始的标记量起（负数是点登录之前已经下载完），大小是压缩后的响应体 */
export interface FinishedRequest {
  readonly url: string;
  readonly finish: number;
  readonly bytes: number;
}

export interface LongTask {
  readonly startTime: number;
  readonly duration: number;
}

/** 一次实测在浏览器里取到的原始数据 */
export interface RawRun {
  readonly settled: boolean;
  /** 各步骤从开始量起的毫秒数，没记到的步骤不在里面 */
  readonly measures: Readonly<Partial<Record<Step, number>>>;
  /** 登录页停留开始、开始标记两个时刻（performance.now），用来挑出停留期间的长任务 */
  readonly dwellStart: number;
  readonly traceStart: number;
  readonly longTasks: readonly LongTask[];
  readonly requests: readonly FinishedRequest[];
  /** 画面稳定（或超时）时还没下载完的请求地址 */
  readonly unfinished: readonly string[];
}

// sized 为 false：浏览器为创建 Worker 下载脚本，Playwright 取不到大小（记为 0）
const RESOURCES = {
  maplibre: { label: 'maplibre-gl', pattern: /\/assets\/maplibre-gl-(?!worker-)[\w-]+\.js$/, sized: true },
  page: { label: '地图页分块', pattern: /\/assets\/CurrentMapPage-[\w-]+\.js$/, sized: true },
  worker: { label: 'Worker 脚本', pattern: /\/assets\/maplibre-gl-worker-[\w-]+\.js$/, sized: false },
  province: { label: '省界', pattern: /\/assets\/jiangsu-province-[\w-]+\.json$/, sized: true },
  catalog: { label: '资源目录', pattern: /\/resource-map\/base\/tree(\?|$)/, sized: true }
} as const;
type ResourceKey = keyof typeof RESOURCES;

const TILE_HOST = /^https:\/\/t\d\.tianditu\.gov\.cn\//;

interface Download {
  readonly finish: number;
  readonly bytes: number;
}

export interface RunSummary {
  readonly settled: boolean;
  readonly steps: Readonly<Partial<Record<Step, number>>>;
  readonly resources: Readonly<Partial<Record<ResourceKey, Download>>>;
  /** 天地图瓦片：张数、最后一张的完成时刻、总大小 */
  readonly tiles: { readonly count: number; readonly lastFinish: number | null; readonly bytes: number };
  /** 开始之后完成的请求的总大小 */
  readonly bytesAfterStart: number;
  /** 还没下载完的请求，只有路径（天地图瓦片带查询串，只留主机和路径） */
  readonly unfinished: readonly string[];
  /** 登录页停留期间的长任务 */
  readonly dwellLongTasks: { readonly count: number; readonly total: number; readonly longest: number };
}

// 按路径和查询串匹配资源，不看主机：脚本可能连接任意地址的服务器
function pathOf(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/** 把一次实测的原始数据整理成要比较的数字 */
export function summarizeRun(raw: RawRun): RunSummary {
  const resources: Partial<Record<ResourceKey, Download>> = {};
  for (const [key, { pattern }] of Object.entries(RESOURCES) as [ResourceKey, (typeof RESOURCES)[ResourceKey]][]) {
    // 同一种资源请求了多次（如重试）时取最后完成的
    const matched = raw.requests.filter(({ url }) => pattern.test(pathOf(url)));
    const last = matched.reduce<FinishedRequest | undefined>(
      (latest, request) => (!latest || request.finish > latest.finish ? request : latest),
      undefined
    );
    if (last) {
      resources[key] = { finish: last.finish, bytes: last.bytes };
    }
  }
  const tiles = raw.requests.filter(({ url }) => TILE_HOST.test(url));
  const dwellTasks = raw.longTasks.filter(
    ({ startTime }) => startTime >= raw.dwellStart && startTime < raw.traceStart
  );
  return {
    settled: raw.settled,
    steps: raw.measures,
    resources,
    tiles: {
      count: tiles.length,
      lastFinish: tiles.length > 0 ? Math.max(...tiles.map(({ finish }) => finish)) : null,
      bytes: sum(tiles.map(({ bytes }) => bytes))
    },
    bytesAfterStart: sum(raw.requests.filter(({ finish }) => finish > 0).map(({ bytes }) => bytes)),
    unfinished: raw.unfinished.map(url => {
      const { host, pathname } = new URL(url);
      return TILE_HOST.test(url) ? `${host}${pathname}` : pathname;
    }),
    dwellLongTasks: {
      count: dwellTasks.length,
      total: sum(dwellTasks.map(({ duration }) => duration)),
      longest: dwellTasks.length > 0 ? Math.max(...dwellTasks.map(({ duration }) => duration)) : 0
    }
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** 中位数；没有数据时为 undefined */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const ms = (value: number | undefined) => (value === undefined ? '—' : String(Math.round(value)));
const kb = (bytes: number | undefined) => (bytes === undefined ? '—' : `${Math.round(bytes / 1024)} KB`);

function medianOf<T>(runs: readonly T[], pick: (run: T) => number | undefined | null): number | undefined {
  return median(runs.map(pick).filter((value): value is number => typeof value === 'number'));
}

export interface ProfileResult {
  readonly profile: ProfileName;
  readonly runs: readonly RunSummary[];
}

/** 每档网络一行的三张表：步骤、资源、登录页停留期间的长任务；都是完成了的几次的中位数 */
export function formatReport(results: readonly ProfileResult[]): string {
  const rows = results.map(({ profile, runs }) => ({
    label: NETWORK_PROFILES[profile].label,
    done: runs.filter(({ settled }) => settled),
    total: runs.length
  }));
  const steps = [
    `| 网络 | 完成 | ${STEPS.map(step => STEP_LABELS[step]).join(' | ')} |`,
    `|---|---|${STEPS.map(() => '---|').join('')}`,
    ...rows.map(
      ({ label, done, total }) =>
        `| ${label} | ${done.length}/${total} | ${STEPS.map(step => ms(medianOf(done, run => run.steps[step]))).join(' | ')} |`
    )
  ];
  const resourceKeys = Object.keys(RESOURCES) as ResourceKey[];
  const resources = [
    `| 网络 | ${resourceKeys.map(key => RESOURCES[key].label).join(' | ')} | 天地图瓦片（最后一张） | 开始后下载的总量 |`,
    `|---|${resourceKeys.map(() => '---|').join('')}---|---|`,
    ...rows.map(({ label, done }) => {
      const cells = resourceKeys.map(key => {
        const finish = ms(medianOf(done, run => run.resources[key]?.finish));
        return RESOURCES[key].sized ? `${finish}（${kb(medianOf(done, run => run.resources[key]?.bytes))}）` : finish;
      });
      const tiles = `${ms(medianOf(done, run => run.tiles.lastFinish))}（${ms(medianOf(done, run => run.tiles.count))} 张，${kb(medianOf(done, run => run.tiles.bytes))}）`;
      return `| ${label} | ${cells.join(' | ')} | ${tiles} | ${kb(medianOf(done, run => run.bytesAfterStart))} |`;
    })
  ];
  const longTasks = [
    '| 网络 | 个数 | 总时长 | 最长 |',
    '|---|---|---|---|',
    ...rows.map(
      ({ label, done }) =>
        `| ${label} | ${ms(medianOf(done, run => run.dwellLongTasks.count))} | ${ms(medianOf(done, run => run.dwellLongTasks.total))} | ${ms(medianOf(done, run => run.dwellLongTasks.longest))} |`
    )
  ];
  // 画面稳定时还没下载完的请求：每个地址在几次里出现过
  const unfinished = rows.map(({ label, done }) => {
    const counts = new Map<string, number>();
    for (const path of done.flatMap(run => [...new Set(run.unfinished)])) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    const listed = [...counts].map(([path, count]) => `${path}（${count}/${done.length} 次）`);
    return `- ${label}：${listed.length > 0 ? listed.join('，') : '没有'}`;
  });
  return [
    '步骤（毫秒，从发出登录请求算起，完成了的几次取中位数）：',
    '',
    ...steps,
    '',
    '资源的完成时刻（毫秒，负数是点登录之前已经下载完；括号里是压缩后的大小，Worker 脚本的大小取不到）：',
    '',
    ...resources,
    '',
    '画面稳定时还没下载完的请求：',
    '',
    ...unfinished,
    '',
    '登录页停留期间的长任务（超过 50 毫秒的任务，毫秒）：',
    '',
    ...longTasks
  ].join('\n');
}
