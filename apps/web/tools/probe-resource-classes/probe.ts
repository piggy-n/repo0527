// oxlint-disable no-await-in-loop -- 后端共用：同一个瓦片集的请求一个接一个地发，并发只由 eachLimit 控制
import {
  addRecord,
  emptySample,
  findLabelFields,
  type LabelField,
  mergeSamples,
  type SampleStats,
  textOf
} from './analyze.ts';
import { readTileBody } from './mvt.ts';

// 请求后端做只读探查：资源树、属性分页、瓦片，接口的行为见 docs/migration.md；后端共用，默认只开 2 个并发

export interface ResourceInfo {
  readonly code: string;
  readonly name: string;
  readonly geoType: string;
  readonly years: readonly number[];
  readonly category: string;
}

export interface TileSample {
  readonly zoom: number;
  readonly requested: number;
  readonly features: number;
  /** 聚合要素的个数：低级别的瓦片把多个要素聚合成一个，属性只是代表要素的 */
  readonly clustered: number;
  readonly sourceLayers: readonly string[];
  readonly geometries: Readonly<Record<string, number>>;
  readonly errors: readonly string[];
  readonly stats: SampleStats;
}

export interface AttributeSample {
  /** 接口报错时为 null */
  readonly total: number | null;
  readonly sampled: number;
  readonly error: string | null;
  readonly stats: SampleStats;
}

export interface ExactCounts {
  readonly counts: Readonly<Record<string, number>>;
  /** 总数减去上面各值之和：样本里没见过的取值和空值 */
  readonly other: number;
}

export interface TilesetProbe {
  readonly code: string;
  readonly year: number;
  readonly tileset: string;
  /** 识别规则改过时旧缓存作废，见 PROBE_VERSION */
  readonly version: number;
  readonly attributes: AttributeSample;
  readonly tiles: readonly TileSample[];
  readonly labels: Readonly<Record<string, LabelField>>;
  readonly exact?: Readonly<Record<string, ExactCounts>>;
}

export interface ProbeOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly codes: ReadonlySet<string> | null;
  readonly years: 'all' | 'latest';
  readonly zooms: readonly number[];
  readonly concurrency: number;
  /** 按取值逐个查总数：结果准确，但每个取值一次 COUNT，只在选定的资源上用 */
  readonly exact: boolean;
  /** 总数超过它的表不查准确分布：62 万个要素统计一次要 8 s（docs/roadmap.md 5C.6） */
  readonly exactLimit: number;
  readonly refresh: boolean;
  /** 单个请求的上限（秒）：千万行的表一次 COUNT 可能要几分钟，枚举时调大 */
  readonly timeoutSeconds: number;
}

export interface ProbeIO {
  readonly fetch: typeof globalThis.fetch;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly log: (message: string) => void;
  readonly load: (tileset: string) => TilesetProbe | null;
  readonly save: (probe: TilesetProbe) => void;
}

export interface ProbeResult {
  readonly resources: readonly ResourceInfo[];
  readonly probes: readonly TilesetProbe[];
  /** 网络失败、重试后仍没有结果的瓦片集：不写缓存，再运行一次会重试 */
  readonly failures: readonly { readonly tileset: string; readonly message: string }[];
}

/** token 失效或没有权限：继续请求没有意义，整个探查停下来 */
export class ProbeAuthError extends Error {}

/** 抽样的城市：南北、沿海都有，稀疏的资源也能取到要素（docs/migration.md 的实测用的也是这几处） */
export const SAMPLE_POINTS: readonly (readonly [lng: number, lat: number, name: string])[] = [
  [118.8, 32.05, '南京'],
  [120.62, 31.3, '苏州'],
  [117.18, 34.26, '徐州'],
  [119.42, 32.39, '扬州']
];

// 这些资源的低级别瓦片很重（乡村道路线层 7 级最大 17.7 MB）：同样式登记表的最小显示级别，更低的级别不请求
export const ZOOM_FLOORS: Readonly<Record<string, number>> = {
  csxhjctb_lrdl: 9,
  csxhjctb_lctl: 9,
  csxhjctb_lvll: 8,
  bgdc_yjjbnttb: 8,
  bgdc_lmfw: 8,
  bgdc_cjdcq: 8,
  bgdc_cjdcqjx: 8,
  szy_hl_fs: 8,
  szy_hl_ks: 8
};

/** 缓存的版本：探查或配对的规则变化时加一，旧版本的缓存不再使用 */
export const PROBE_VERSION = 2;

const PAGE_SIZE = 200;
const SAMPLE_PAGES = 4;
/** 超过这么多行的表只读第一页：深分页要 OFFSET，其他地方的数据由瓦片抽样补上 */
const DEEP_PAGE_LIMIT = 2_000_000;
/** 一个级别取够这么多要素就不再请求别的城市 */
const ENOUGH_FEATURES = 1500;
/** 找名称字段用的记录数上限 */
const MAX_PAIR_RECORDS = 3000;
const MAX_EXACT_FIELDS = 2;
const MAX_EXACT_VALUES = 40;
const RETRY_DELAYS: readonly number[] = [2000, 5000];
const PROVINCE_CODE = '320000';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 资源树按 code 合并年份，同 catalog.ts；只读脚本用到的字段 */
export function flattenTree(tree: unknown): ResourceInfo[] {
  const byCode = new Map<string, ResourceInfo>();
  const walk = (nodes: unknown, path: readonly string[]) => {
    if (!Array.isArray(nodes)) {
      return;
    }
    for (const node of nodes) {
      if (!isRecord(node)) {
        continue;
      }
      if (Array.isArray(node.children)) {
        walk(node.children, [...path, String(node.name)]);
      } else if (typeof node.code === 'string' && Array.isArray(node.yearList)) {
        const previous = byCode.get(node.code);
        const years = [...(previous?.years ?? []), ...node.yearList.map(Number)];
        byCode.set(node.code, {
          code: node.code,
          name: String(node.name),
          geoType: String(node.geoType),
          years: [...new Set(years)].toSorted((a, b) => a - b),
          category: previous?.category ?? path.join(' / ')
        });
      }
    }
  };
  walk(tree, []);
  return [...byCode.values()];
}

/** 瓦片坐标 */
export function tileAt(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const radians = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * scale),
    y: Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale)
  };
}

/** 抽样的页码：表小时读完，表大时均匀取几页，避开数据按区划排序时只看到一个地方 */
export function samplePages(total: number, pageSize: number, pages: number): number[] {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= pages) {
    return Array.from({ length: last }, (_, index) => index + 1);
  }
  const picked = Array.from({ length: pages }, (_, index) => Math.round(1 + (index * (last - 1)) / (pages - 1)));
  return [...new Set(picked)];
}

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** 条件的写法：字段名加双引号、小写，值里的单引号要双写（docs/migration.md 的接口实测） */
export function equalsCondition(field: string, value: string): string {
  return `"${field}" = ${quoted(value)}`;
}

/** 排除已知取值的条件；NOT IN 不会选中 NULL，所以空值不算没枚举完 */
export function notInCondition(field: string, values: readonly string[]): string {
  return values.length === 0 ? `"${field}" IS NOT NULL` : `"${field}" NOT IN (${values.map(quoted).join(',')})`;
}

export async function request(
  url: string,
  options: ProbeOptions,
  io: Pick<ProbeIO, 'fetch' | 'sleep'>,
  retryDelays: readonly number[] = RETRY_DELAYS
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    if (attempt > 0) {
      await io.sleep(retryDelays[attempt - 1] ?? 0);
    }
    try {
      const response = await io.fetch(url, {
        headers: { token: options.token },
        signal: AbortSignal.timeout(options.timeoutSeconds * 1000)
      });
      if (response.status === 401 || response.status === 403) {
        throw new ProbeAuthError(`后端返回 ${response.status}：token 失效或没有权限，请更新 YZT_PROBE_TOKEN`);
      }
      if (response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      // 超时重试只会给后端多压几次重查询，要调大 --timeout
      if (error instanceof ProbeAuthError || (error instanceof DOMException && error.name === 'TimeoutError')) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchTree(options: ProbeOptions, io: Pick<ProbeIO, 'fetch' | 'sleep'>): Promise<ResourceInfo[]> {
  const response = await request(`${options.baseUrl}/resource-map/base/tree`, options, io);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error(`资源树的返回不符合预期：${JSON.stringify(body).slice(0, 200)}`);
  }
  return flattenTree(body.data);
}

interface AttributePage {
  readonly total: number;
  readonly list: readonly Record<string, unknown>[];
}

async function fetchPage(
  layerCode: string,
  conditions: string,
  pageNum: number,
  pageSize: number,
  options: ProbeOptions,
  io: ProbeIO
): Promise<AttributePage> {
  const query = new URLSearchParams({
    layerCode,
    xzqdm: PROVINCE_CODE,
    conditions,
    pageNum: String(pageNum),
    pageSize: String(pageSize)
  });
  const response = await request(`${options.baseUrl}/api/query/attr/page?${query.toString()}`, options, io);
  const body: unknown = await response.json();
  // 失败时 HTTP 200，返回 { success: false, msg }
  if (!isRecord(body) || typeof body.total !== 'number' || !Array.isArray(body.list)) {
    throw new Error(isRecord(body) && typeof body.msg === 'string' ? body.msg : '查询接口的返回不符合预期');
  }
  return { total: body.total, list: body.list.filter(isRecord) };
}

function lowerKeys(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
}

// 属性接口：表的完整字段。不是随机抽样，分布只是参考，要准确的分布用 --exact
async function sampleAttributes(
  layerCode: string,
  records: Record<string, unknown>[],
  options: ProbeOptions,
  io: ProbeIO
): Promise<AttributeSample> {
  const stats = emptySample();
  let first: AttributePage;
  try {
    first = await fetchPage(layerCode, '', 1, PAGE_SIZE, options, io);
  } catch (error) {
    if (error instanceof ProbeAuthError) {
      throw error;
    }
    return { total: null, sampled: 0, error: messageOf(error), stats };
  }
  const add = (list: readonly Record<string, unknown>[]) => {
    for (const record of list) {
      addRecord(stats, record);
      records.push(lowerKeys(record));
    }
  };
  add(first.list);
  const pages = first.total > DEEP_PAGE_LIMIT ? [] : samplePages(first.total, PAGE_SIZE, SAMPLE_PAGES);
  let pageError: string | null = null;
  for (const pageNum of pages) {
    if (pageNum !== 1) {
      try {
        const page = await fetchPage(layerCode, '', pageNum, PAGE_SIZE, options, io);
        add(page.list);
      } catch (error) {
        if (error instanceof ProbeAuthError) {
          throw error;
        }
        // 已经取到的数据还能用
        pageError = messageOf(error);
      }
    }
  }
  return { total: first.total, sampled: stats.records, error: pageError, stats };
}

async function sampleZoom(
  tileset: string,
  zoom: number,
  records: Record<string, unknown>[],
  options: ProbeOptions,
  io: ProbeIO
): Promise<TileSample> {
  const stats = emptySample();
  const sourceLayers = new Set<string>();
  const geometries: Record<string, number> = {};
  const errors: string[] = [];
  let requested = 0;
  let clustered = 0;
  for (const [lng, lat] of SAMPLE_POINTS) {
    if (stats.records >= ENOUGH_FEATURES) {
      break;
    }
    const { x, y } = tileAt(lng, lat, zoom);
    const response = await request(`${options.baseUrl}/api/tiles/${tileset}/${zoom}/${x}/${y}.pbf`, options, io);
    requested += 1;
    const body = readTileBody(new Uint8Array(await response.arrayBuffer()));
    if (body.kind === 'error') {
      // 瓦片集不存在时每一张都报错，不用再试别的城市
      errors.push(body.message);
      break;
    }
    if (body.kind === 'tile') {
      for (const layer of body.layers) {
        sourceLayers.add(layer.name);
        for (const { geometry, properties } of layer.features) {
          geometries[geometry] = (geometries[geometry] ?? 0) + 1;
          clustered += properties.clustered === true ? 1 : 0;
          addRecord(stats, properties);
          if (records.length < MAX_PAIR_RECORDS) {
            records.push(lowerKeys(properties));
          }
        }
      }
    }
  }
  return {
    zoom,
    requested,
    features: stats.records,
    clustered,
    sourceLayers: [...sourceLayers],
    geometries,
    errors,
    stats
  };
}

async function probeTileset(resource: ResourceInfo, year: number, options: ProbeOptions, io: ProbeIO) {
  const tileset = `${resource.code}_${year}`;
  const records: Record<string, unknown>[] = [];
  const attributes = await sampleAttributes(tileset, records, options, io);
  const tiles: TileSample[] = [];
  const floor = ZOOM_FLOORS[resource.code] ?? 0;
  for (const zoom of options.zooms) {
    if (zoom >= floor) {
      tiles.push(await sampleZoom(tileset, zoom, records, options, io));
    }
  }
  const merged = mergeSamples([attributes.stats, ...tiles.map(tile => tile.stats)]);
  return {
    code: resource.code,
    year,
    tileset,
    version: PROBE_VERSION,
    attributes,
    tiles,
    labels: findLabelFields(records, merged)
  } satisfies TilesetProbe;
}

// 候选字段的准确分布：属性抽样和瓦片里见过的每个取值查一次总数；瓦片才有、表里没有的字段查不了，跳过
async function exactCounts(
  probe: TilesetProbe,
  options: ProbeOptions,
  io: ProbeIO,
  fieldsOf: (probe: TilesetProbe) => readonly string[]
): Promise<Record<string, ExactCounts>> {
  const result: Record<string, ExactCounts> = {};
  const total = probe.attributes.total;
  if (total === null || total > options.exactLimit) {
    return result;
  }
  const seen = mergeSamples([probe.attributes.stats, ...probe.tiles.map(tile => tile.stats)]);
  for (const field of fieldsOf(probe).slice(0, MAX_EXACT_FIELDS)) {
    const values = Object.entries(seen.fields[field]?.values ?? {})
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, MAX_EXACT_VALUES);
    const counts: Record<string, number> = {};
    try {
      for (const [value] of values) {
        const page = await fetchPage(probe.tileset, equalsCondition(field, value), 1, 1, options, io);
        counts[value] = page.total;
      }
      const counted = Object.values(counts).reduce((sum, count) => sum + count, 0);
      result[field] = { counts, other: total - counted };
    } catch (error) {
      if (error instanceof ProbeAuthError) {
        throw error;
      }
      io.log(`${probe.tileset} 查 ${field} 的准确分布失败：${messageOf(error)}`);
    }
  }
  return result;
}

export interface EnumerateTarget {
  readonly code: string;
  readonly field: string;
}

export interface EnumeratedField {
  readonly tileset: string;
  readonly field: string;
  /** 全部取值，升序；空字符串、-9999 这类占位也算取值，由人判断 */
  readonly values: readonly string[];
  /** 抽样里没见过、这次才发现的取值 */
  readonly discovered: readonly string[];
  /** 排除这些取值后还剩多少行：0 才说明列全了；第一次请求就失败时为 null */
  readonly remaining: number | null;
  readonly error: string | null;
}

const MAX_ENUMERATE_ROUNDS = 30;

// 枚举一个字段的全部取值：排除已知的值再查，还有记录就从这一页取新值，直到没有。
// 比逐个取值 COUNT 省请求，也不用深分页，超大的表也能查全
async function enumerateField(tileset: string, field: string, seed: readonly string[], options: ProbeOptions, io: ProbeIO) {
  const known = new Set(seed);
  let remaining: number | null = null;
  let error: string | null = null;
  for (let round = 0; round < MAX_ENUMERATE_ROUNDS && remaining !== 0; round += 1) {
    try {
      const page = await fetchPage(tileset, notInCondition(field, [...known]), 1, PAGE_SIZE, options, io);
      remaining = page.total;
      const before = known.size;
      for (const record of page.list) {
        const value = lowerKeys(record)[field];
        if (value !== null && value !== undefined) {
          known.add(textOf(value));
        }
      }
      if (remaining > 0 && known.size === before) {
        error = `还有 ${remaining} 行，但取不到新的取值`;
        break;
      }
    } catch (cause) {
      if (cause instanceof ProbeAuthError) {
        throw cause;
      }
      error = messageOf(cause);
      break;
    }
  }
  const values = [...known].toSorted();
  const discovered = values.filter(value => !seed.includes(value));
  return { tileset, field, values, discovered, remaining, error } satisfies EnumeratedField;
}

/** 枚举字段的全部取值：抽样只能发现常见的，要确认图例列全了时用；已有探查缓存的从抽样见过的取值开始 */
export async function runEnumerate(
  targets: readonly EnumerateTarget[],
  options: ProbeOptions,
  io: ProbeIO
): Promise<EnumeratedField[]> {
  const resources = await fetchTree(options, io);
  const jobs = targets.flatMap(({ code, field }) => {
    const resource = resources.find(item => item.code === code);
    if (!resource) {
      throw new Error(`资源树里没有 ${code}`);
    }
    const years = options.years === 'latest' ? resource.years.slice(-1) : resource.years;
    return years.map(year => ({ tileset: `${code}_${year}`, field }));
  });
  const results: EnumeratedField[] = [];
  await eachLimit(jobs, options.concurrency, async ({ tileset, field }) => {
    const cached = io.load(tileset);
    const samples = cached ? [cached.attributes.stats, ...cached.tiles.map(tile => tile.stats)] : [];
    const seed = Object.keys(mergeSamples(samples).fields[field]?.values ?? {});
    const result = await enumerateField(tileset, field, seed, options, io);
    results.push(result);
    const state = result.remaining === 0 ? '列全了' : `没列全：${result.error ?? `还剩 ${result.remaining} 行`}`;
    io.log(`${tileset}.${field} 共 ${result.values.length} 个取值，${state}；新发现：${result.discovered.join('、') || '无'}`);
  });
  return results;
}

export async function eachLimit<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) {
        await task(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
}

/** 逐个瓦片集探查；已有缓存的不再请求，网络失败的记下来继续，token 失效时抛 ProbeAuthError */
export async function runProbe(
  options: ProbeOptions,
  io: ProbeIO,
  candidateFields: (probe: TilesetProbe) => readonly string[]
): Promise<ProbeResult> {
  const all = await fetchTree(options, io);
  const resources = options.codes ? all.filter(({ code }) => options.codes?.has(code)) : all;
  const jobs = resources.flatMap(resource => {
    const years = options.years === 'latest' ? resource.years.slice(-1) : resource.years;
    return years.map(year => ({ resource, year }));
  });
  const probes: TilesetProbe[] = [];
  const failures: { tileset: string; message: string }[] = [];
  let done = 0;
  await eachLimit(jobs, options.concurrency, async ({ resource, year }) => {
    const tileset = `${resource.code}_${year}`;
    const isLatest = year === resource.years.at(-1);
    try {
      const saved = options.refresh ? null : io.load(tileset);
      const cached = saved?.version === PROBE_VERSION ? saved : null;
      let probe: TilesetProbe = cached ?? (await probeTileset(resource, year, options, io));
      if (options.exact && isLatest && !probe.exact) {
        probe = { ...probe, exact: await exactCounts(probe, options, io, candidateFields) };
      }
      io.save(probe);
      probes.push(probe);
      const features = probe.tiles.map(tile => `z${tile.zoom}:${tile.features}`).join(' ');
      done += 1;
      io.log(`[${done}/${jobs.length}] ${tileset}${cached ? '（缓存）' : ''} 表 ${probe.attributes.total ?? '报错'} ${features}`);
    } catch (error) {
      if (error instanceof ProbeAuthError) {
        throw error;
      }
      done += 1;
      const message = messageOf(error);
      failures.push({ tileset, message });
      io.log(`[${done}/${jobs.length}] ${tileset} 失败：${message}`);
    }
  });
  return { resources, probes, failures };
}
