// oxlint-disable no-await-in-loop -- 瓦片一张接一张地请求，耗时才准；后端共用，并发只由 eachLimit 控制
import { readTileBody, unzippedTile } from './mvt.ts';
import {
  eachLimit,
  fetchTree,
  ProbeAuthError,
  type ProbeIO,
  type ProbeOptions,
  request,
  type ResourceInfo,
  ZOOM_FLOORS
} from './probe.ts';
import { tilesToCheck } from './tile-check.ts';

// 实测瓦片的大小和耗时，给出最小显示级别的建议（docs/migration.md"最小显示级别的实测"）。
// 每个瓦片集从高级别往低查，一超标就停：更低的级别往往更重（旧环境有 42 MB、20 s 的瓦片），不为了测量去请求它们

export interface TileCostLimits {
  /** 单张解压后的上限（字节） */
  readonly maxBytes: number;
  /** 单张收完的上限（毫秒） */
  readonly maxMs: number;
}

export interface TileCost {
  readonly x: number;
  readonly y: number;
  /** 解压后的大小：MapLibre 要解析的量，是否超标按它判断 */
  readonly bytes: number;
  /** 传输的大小：响应头有 content-length 时按它，压缩时比 bytes 小 */
  readonly transferBytes: number;
  /** 收到响应头的耗时：瓦片现场生成时基本就是生成的时间 */
  readonly firstByteMs: number;
  /** 整张收完的耗时，是否超标按它判断 */
  readonly totalMs: number;
  readonly features: number;
  /** 第一次超过耗时上限、复测过的瓦片：第一次的耗时，上面的耗时是复测的 */
  readonly firstTryMs?: number;
}

export type ZoomCostVerdict = 'ok' | 'empty' | 'heavy' | 'failed';

export interface ZoomCost {
  readonly zoom: number;
  readonly requested: number;
  readonly tiles: readonly TileCost[];
  readonly errors: readonly string[];
  readonly verdict: ZoomCostVerdict;
  /** 超标的那张瓦片和超了什么 */
  readonly reason: string | null;
}

/** 建议的最小显示级别：none 是不用限制，unknown 是没有查到要素或一开始就失败，判断不了 */
export type MinZoomSuggestion = number | 'none' | 'unknown';

export interface TileCostResult {
  readonly code: string;
  readonly year: number;
  readonly tileset: string;
  readonly name: string;
  /** 代码里现在的最小显示级别，没有时是 null */
  readonly current: number | null;
  readonly suggested: MinZoomSuggestion;
  /** 按 ADR 0041 不限制：照样测，不参与建议 */
  readonly exempt: boolean;
  /** 第一张成功的瓦片的响应头：看后端是否压缩、能否缓存 */
  readonly headers: Readonly<Record<string, string>>;
  /** 从高级别到低级别 */
  readonly zooms: readonly ZoomCost[];
}

export interface TileCostOptions extends ProbeOptions {
  readonly tilesPerZoom: number;
  readonly limits: TileCostLimits;
}

export interface TileCostIO extends Pick<ProbeIO, 'fetch' | 'sleep' | 'log'> {
  /** 当前时刻（毫秒），测试注入假时钟 */
  readonly now: () => number;
  /** 上次没跑完时已有的结果：token 过期后重新运行不用从头测 */
  readonly load: () => readonly TileCostResult[];
  /** 每测完一个瓦片集存一次 */
  readonly save: (results: readonly TileCostResult[]) => void;
}

// 地类图斑默认勾选，全省视图必须有，按 ADR 0041 不限制
const EXEMPT: ReadonlySet<string> = new Set(['bgdc_dltb']);

// 大小没超，但第一次请求 5～7 级要等十几秒；瓦片生成过后实测看不出来，不按实测放开（ADR 0136）
const SLOW_FIRST_REQUEST: ReadonlySet<string> = new Set(['bgdc_cjdcq', 'bgdc_cjdcqjx', 'bgdc_lmfw']);

// 重试的等待会算进耗时，失败就记下来
const NO_RETRY: readonly number[] = [];

const RECORDED_HEADERS = ['content-type', 'content-encoding', 'cache-control', 'etag', 'last-modified', 'x-cache'];

const MB = 1024 * 1024;

function sizeText(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function timeText(milliseconds: number): string {
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} s` : `${Math.round(milliseconds)} ms`;
}

function overLimit(tile: TileCost, { maxBytes, maxMs }: TileCostLimits): string | null {
  if (tile.bytes > maxBytes) {
    return `${tile.x}/${tile.y} 有 ${sizeText(tile.bytes)}`;
  }
  return tile.totalMs > maxMs ? `${tile.x}/${tile.y} 用了 ${timeText(tile.totalMs)}` : null;
}

interface TileMeasure {
  readonly cost: TileCost;
  readonly headers: Readonly<Record<string, string>>;
}

async function measureTile(
  tileset: string,
  zoom: number,
  at: { readonly x: number; readonly y: number },
  options: TileCostOptions,
  io: TileCostIO
): Promise<TileMeasure> {
  const url = `${options.baseUrl}/api/tiles/${tileset}/${zoom}/${at.x}/${at.y}.pbf`;
  const started = io.now();
  const response = await request(url, options, io, NO_RETRY);
  const firstByteMs = io.now() - started;
  const raw = new Uint8Array(await response.arrayBuffer());
  const totalMs = io.now() - started;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const bytes = unzippedTile(raw);
  const body = readTileBody(bytes);
  if (body.kind === 'error') {
    throw new Error(body.message);
  }
  const features = body.kind === 'tile' ? body.layers.reduce((sum, layer) => sum + layer.features.length, 0) : 0;
  const length = Number(response.headers.get('content-length'));
  const headers: Record<string, string> = {};
  for (const name of RECORDED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) {
      headers[name] = value;
    }
  }
  return {
    cost: {
      ...at,
      bytes: bytes.length,
      transferBytes: length > 0 ? length : raw.length,
      firstByteMs,
      totalMs,
      features
    },
    headers
  };
}

// 单次耗时波动很大：同一张瓦片两轮能差几十倍，只有几 KB 的瓦片也有用了 1、2、3 秒的。超过上限时再测一次，两次都超才算；
// 大小是稳定的，已经超标的不用再请求一次
async function confirmedCost(
  tileset: string,
  zoom: number,
  at: { readonly x: number; readonly y: number },
  headers: Record<string, string>,
  options: TileCostOptions,
  io: TileCostIO
): Promise<TileCost> {
  const measured = await measureTile(tileset, zoom, at, options, io);
  if (Object.keys(headers).length === 0) {
    Object.assign(headers, measured.headers);
  }
  const { maxBytes, maxMs } = options.limits;
  if (measured.cost.totalMs <= maxMs || measured.cost.bytes > maxBytes) {
    return measured.cost;
  }
  const again = await measureTile(tileset, zoom, at, options, io);
  return { ...again.cost, firstTryMs: measured.cost.totalMs };
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

function verdictOf(requested: number, tiles: readonly TileCost[], errors: readonly string[], reason: string | null) {
  if (reason !== null) {
    return 'heavy';
  }
  if (errors.length === requested) {
    return 'failed';
  }
  return tiles.some(tile => tile.features > 0) ? 'ok' : 'empty';
}

// exempt 的资源要看到全部数字，超标也不停
async function measureZoom(
  tileset: string,
  zoom: number,
  exempt: boolean,
  headers: Record<string, string>,
  options: TileCostOptions,
  io: TileCostIO
): Promise<ZoomCost> {
  const wanted = tilesToCheck(zoom, options.tilesPerZoom);
  const tiles: TileCost[] = [];
  const errors: string[] = [];
  let reason: string | null = null;
  for (const at of wanted) {
    try {
      const cost = await confirmedCost(tileset, zoom, at, headers, options, io);
      tiles.push(cost);
      reason ??= overLimit(cost, options.limits);
    } catch (error) {
      if (error instanceof ProbeAuthError) {
        throw error;
      }
      if (isTimeout(error)) {
        reason ??= `${at.x}/${at.y} 超过 ${options.timeoutSeconds} 秒没有收完`;
      } else {
        errors.push(`${at.x}/${at.y}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (reason !== null && !exempt) {
      break;
    }
  }
  const verdict: ZoomCostVerdict = verdictOf(wanted.length, tiles, errors, reason);
  return { zoom, requested: wanted.length, tiles, errors, verdict, reason };
}

/** 按从高到低的结果给建议：最高的一个超标级别的上一级 */
export function suggestMinZoom(zooms: readonly ZoomCost[]): MinZoomSuggestion {
  const heavy = zooms.find(({ verdict }) => verdict === 'heavy');
  const failed = zooms.find(({ verdict }) => verdict === 'failed');
  const stop = heavy && failed ? (heavy.zoom > failed.zoom ? heavy : failed) : (heavy ?? failed);
  if (stop?.verdict === 'heavy') {
    return stop.zoom + 1;
  }
  // 没见过要素时，失败、全空都可能只是瓦片集有问题，不能当成可以不限制
  if (!zooms.some(({ tiles }) => tiles.some(tile => tile.features > 0))) {
    return 'unknown';
  }
  return stop ? stop.zoom + 1 : 'none';
}

async function measureTileset(
  resource: ResourceInfo,
  year: number,
  options: TileCostOptions,
  io: TileCostIO
): Promise<TileCostResult> {
  const tileset = `${resource.code}_${year}`;
  const exempt = EXEMPT.has(resource.code);
  const headers: Record<string, string> = {};
  const zooms: ZoomCost[] = [];
  for (const zoom of options.zooms.toSorted((a, b) => b - a)) {
    const check = await measureZoom(tileset, zoom, exempt, headers, options, io);
    zooms.push(check);
    io.log(`${tileset} z${zoom}：${check.verdict}${check.reason === null ? '' : `（${check.reason}）`}`);
    if ((check.verdict === 'heavy' || check.verdict === 'failed') && !exempt) {
      break;
    }
  }
  return {
    code: resource.code,
    year,
    tileset,
    name: resource.name,
    current: ZOOM_FLOORS[resource.code] ?? null,
    suggested: suggestMinZoom(zooms),
    exempt,
    headers,
    zooms
  };
}

/** 实测瓦片集；已有结果的跳过（--refresh 时重测），token 失效时抛 ProbeAuthError */
export async function runTileCost(options: TileCostOptions, io: TileCostIO): Promise<TileCostResult[]> {
  const all = await fetchTree(options, io);
  const missing = [...(options.codes ?? [])].filter(code => !all.some(resource => resource.code === code));
  if (missing.length > 0) {
    throw new Error(`资源树里没有 ${missing.join('、')}`);
  }
  const jobs = all
    .filter(({ code }) => options.codes?.has(code) ?? true)
    .flatMap(resource => {
      const years = options.years === 'latest' ? resource.years.slice(-1) : resource.years;
      return years.map(year => ({ resource, year }));
    });
  const results: TileCostResult[] = options.refresh ? [] : [...io.load()];
  const done = new Set(results.map(({ tileset }) => tileset));
  const pending = jobs.filter(({ resource, year }) => !done.has(`${resource.code}_${year}`));
  await eachLimit(pending, options.concurrency, async ({ resource, year }) => {
    results.push(await measureTileset(resource, year, options, io));
    io.save(results);
  });
  return results;
}

/** 部署配置：资源的最小显示级别，多个年份取最严的；所有年份都判断不了的保留现在的值，不限制的不写 */
export function minZoomConfig(results: readonly TileCostResult[]): Record<string, number> {
  const measured = new Set(results.filter(({ suggested }) => suggested !== 'unknown').map(({ code }) => code));
  const config = new Map<string, number>();
  for (const { code, current, suggested, exempt } of results) {
    if (!exempt) {
      const unknownValue = measured.has(code) ? null : current;
      const value = suggested === 'unknown' ? unknownValue : suggested === 'none' ? null : suggested;
      const kept = SLOW_FIRST_REQUEST.has(code) ? current : null;
      const levels = [value, kept, config.get(code) ?? null].filter(level => level !== null);
      if (levels.length > 0) {
        config.set(code, Math.max(...levels));
      }
    }
  }
  return Object.fromEntries([...config].toSorted(([a], [b]) => a.localeCompare(b)));
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const VERDICT_LABELS: Readonly<Record<ZoomCostVerdict, string>> = {
  ok: '未超标',
  empty: '没有要素',
  heavy: '超标',
  failed: '请求失败'
};

function suggestionText(suggested: MinZoomSuggestion): string {
  if (suggested === 'none') {
    return '不限制';
  }
  return suggested === 'unknown' ? '判断不了' : `${suggested} 级`;
}

function changeText({ code, current, suggested, exempt }: TileCostResult): string {
  if (exempt) {
    return '例外，按 ADR 0041 不限制';
  }
  if (suggested === 'unknown') {
    return '保留现在的值';
  }
  const next = suggested === 'none' ? null : suggested;
  if (next === current) {
    return '不变';
  }
  if (SLOW_FIRST_REQUEST.has(code) && current !== null && (next === null || next < current)) {
    return '例外，第一次请求很慢，保留（ADR 0136）';
  }
  if (current === null) {
    return '新增限制';
  }
  if (next === null) {
    return '去掉限制';
  }
  return next > current ? '收紧' : '放宽';
}

function evidenceOf({ zooms, suggested }: TileCostResult): string {
  const stop = zooms.find(({ verdict }) => verdict === 'heavy' || verdict === 'failed');
  if (stop) {
    return `${stop.zoom} 级${stop.reason === null ? '请求失败' : `：${stop.reason}`}`;
  }
  const lowest = zooms.at(-1);
  if (suggested === 'unknown' || !lowest) {
    return '查过的瓦片都没有要素';
  }
  return `查到 ${lowest.zoom} 级都没有超标`;
}

function summaryRow(result: TileCostResult): string {
  const current = result.current === null ? '不限制' : `${result.current} 级`;
  return `| ${result.name} | ${result.tileset} | ${current} | ${suggestionText(result.suggested)} | ${changeText(result)} | ${evidenceOf(result)} |`;
}

const SUMMARY_HEADER = ['| 资源 | 瓦片集 | 现在 | 建议 | 变化 | 依据 |', '|---|---|---|---|---|---|'];

function zoomRow({ zoom, requested, tiles, verdict, reason, errors }: ZoomCost): string {
  const cells = [
    zoom,
    `${tiles.length}/${requested}`,
    tiles.filter(tile => tile.features > 0).length,
    sizeText(median(tiles.map(tile => tile.bytes))),
    sizeText(Math.max(0, ...tiles.map(tile => tile.bytes))),
    sizeText(Math.max(0, ...tiles.map(tile => tile.transferBytes))),
    timeText(median(tiles.map(tile => tile.totalMs))),
    timeText(Math.max(0, ...tiles.map(tile => tile.totalMs))),
    Math.max(0, ...tiles.map(tile => tile.features)),
    reason === null ? VERDICT_LABELS[verdict] : `${VERDICT_LABELS[verdict]}：${reason}`,
    errors.length
  ];
  return `| ${cells.join(' | ')} |`;
}

function tilesetSection(result: TileCostResult): string[] {
  return [
    '',
    `### ${result.tileset}（${result.name}）`,
    '',
    '| 级别 | 收到/计划 | 有要素 | 大小中位 | 大小最大 | 传输最大 | 耗时中位 | 耗时最大 | 要素最多 | 结果 | 失败 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...result.zooms.map(zoomRow)
  ];
}

// 后端是否压缩、能否缓存：换环境时最先要看的，每个响应头的每种取值有多少个瓦片集
function headerRows(results: readonly TileCostResult[]): string[] {
  const counts = new Map<string, number>();
  for (const { headers } of results) {
    for (const name of RECORDED_HEADERS) {
      const key = `| ${name} | ${headers[name] ?? '（没有）'} |`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts].toSorted(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `${key} ${count} |`);
}

// 第一次慢、第二次不慢的瓦片：可能是后端第一次生成，也可能是网络抖动，不算超标，但第一个看这张瓦片的人要等这么久
function retriedRows(results: readonly TileCostResult[], { maxMs }: TileCostLimits): string[] {
  return results.flatMap(({ tileset, zooms }) =>
    zooms.flatMap(({ zoom, tiles }) =>
      tiles
        .filter(tile => tile.firstTryMs !== undefined && tile.totalMs <= maxMs)
        .map(
          ({ x, y, bytes, firstTryMs, totalMs }) =>
            `| ${tileset} | ${zoom} | ${x}/${y} | ${sizeText(bytes)} | ${timeText(firstTryMs ?? 0)} | ${timeText(totalMs)} |`
        )
    )
  );
}

/** 给人看的报告：要确认的资源排在最前，再是响应头和每个瓦片集逐级别的数字 */
export function formatTileCost(results: readonly TileCostResult[], limits: TileCostLimits): string {
  const sorted = results.toSorted((a, b) => a.tileset.localeCompare(b.tileset));
  const changed = sorted.filter(result => changeText(result) !== '不变');
  const same = sorted.filter(result => changeText(result) === '不变');
  const retried = retriedRows(sorted, limits);
  return [
    '# 瓦片大小和耗时实测',
    '',
    `判断标准：单张解压后不超过 ${sizeText(limits.maxBytes)}，整张收完不超过 ${timeText(limits.maxMs)}。每个瓦片集从高级别往低查，一超标就停，更低的级别不再请求；建议的最小显示级别是超标级别的上一级。`,
    '',
    '大小是稳定的；耗时受后端当时的负载和缓存影响，超过上限时再测一次，两次都超才算。建议值写在 resource-min-zooms.json，格式和发布目录里的同名文件一样（ADR 0137）。',
    '',
    `## 要确认的（${changed.length} 个）`,
    '',
    ...SUMMARY_HEADER,
    ...changed.map(summaryRow),
    '',
    `## 不变（${same.length} 个）`,
    '',
    ...SUMMARY_HEADER,
    ...same.map(summaryRow),
    '',
    '## 响应头',
    '',
    '| 响应头 | 取值 | 瓦片集个数 |',
    '|---|---|---|',
    ...headerRows(sorted),
    '',
    `## 复测后没有超标的瓦片（${retried.length} 张）`,
    '',
    '第一次慢、第二次不慢：可能是后端第一次生成，也可能是网络抖动。不算超标，但第一个看这张瓦片的人要等这么久。',
    '',
    '| 瓦片集 | 级别 | 瓦片 | 大小 | 第一次 | 第二次 |',
    '|---|---|---|---|---|---|',
    ...retried,
    '',
    '## 每个瓦片集',
    ...sorted.flatMap(tilesetSection),
    ''
  ].join('\n');
}
