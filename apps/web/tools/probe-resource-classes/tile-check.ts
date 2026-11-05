// oxlint-disable no-await-in-loop -- 后端共用：同一个瓦片集的瓦片一张接一张地请求，并发只由 eachLimit 控制
import { textOf } from './analyze.ts';
import { partsOf, readTileBody, type TileFeature, type TileLayer } from './mvt.ts';
import {
  eachLimit,
  fetchTree,
  ProbeAuthError,
  type ProbeIO,
  type ProbeOptions,
  request,
  type ResourceInfo,
  SAMPLE_POINTS,
  tileAt,
  ZOOM_FLOORS
} from './probe.ts';
import { CURRENT_RULE_FIELDS } from './report.ts';

// 查同一级别的瓦片颜色为什么不一致（docs/archive/migration.md"低级别瓦片的颜色"）：解码几何，看瓦片是不是把要素合并成了一个。
// 前端按每个要素的属性配色，合并后整张瓦片只有一种颜色，颜色取决于这个要素带的属性

export type MainGeometry = 'polygon' | 'line' | 'point';

export interface ValueShare {
  readonly value: string;
  readonly share: number;
}

export interface TileSummary {
  readonly x: number;
  readonly y: number;
  /** 这个资源主要几何类型的要素数，其余类型不算 */
  readonly features: number;
  readonly clustered: number;
  /** 这张瓦片的总量：面是面积，线是长度，点是个数 */
  readonly weight: number;
  /** 最大的要素占总量的比例 */
  readonly largestShare: number;
  /** 最大的要素有几个部件（面的环、线的折线、点）：合并出来的要素部件很多 */
  readonly largestParts: number;
  /** 各取值占总量的比例，从大到小 */
  readonly values: readonly ValueShare[];
}

export type ZoomVerdict = 'merged' | 'partial' | 'normal' | 'empty';

export interface ZoomCheck {
  readonly zoom: number;
  readonly requested: number;
  readonly tiles: readonly TileSummary[];
  readonly mergedTiles: number;
  readonly verdict: ZoomVerdict;
  /** 这个级别查到的瓦片合起来，各取值的比例 */
  readonly values: readonly ValueShare[];
  readonly errors: readonly string[];
}

export interface TileCheckResult {
  readonly tileset: string;
  readonly name: string;
  readonly field: string;
  readonly geometry: MainGeometry;
  readonly sourceLayers: readonly string[];
  readonly zooms: readonly ZoomCheck[];
}

export interface TileCheckTarget {
  readonly code: string;
  readonly field: string;
}

export interface TileCheckIO extends Pick<ProbeIO, 'fetch' | 'sleep' | 'log'> {
  /** 每查完一个瓦片集存一次，中断时已查完的结果还在 */
  readonly save: (results: readonly TileCheckResult[]) => void;
}

const JIANGSU_BOUNDS = { west: 116.3, south: 30.7, east: 121.95, north: 35.15 } as const;

/** 算合并的瓦片：最大要素的比例和部件数的下限；真实的大面（太湖）比例高，但部件少 */
const MERGED_SHARE = 0.9;
const MERGED_PARTS = 10;
/** 一个级别多少瓦片是合并的，算这个级别合并、部分合并 */
const MERGED_RATIO = 0.8;
const PARTIAL_RATIO = 0.2;

const VERDICT_LABELS: Readonly<Record<ZoomVerdict, string>> = {
  merged: '合并',
  partial: '部分合并',
  normal: '没有合并',
  empty: '没有要素'
};

const NO_FIELD = '(无字段)';
const EMPTY_VALUE = '(空)';

// 瓦片里没有 dlmc，前端由 dlbm 换成名称再配色
const TILE_FIELD_OVERRIDES: Readonly<Record<string, string>> = { bgdc_dltb_czc: 'dlbm' };

function ruleField(code: string): string | undefined {
  return TILE_FIELD_OVERRIDES[code] ?? CURRENT_RULE_FIELDS[code];
}

/** --tile-check 的写法：rules 是全部有分类规则的资源；a,b:f 是资源 a 按规则的字段、资源 b 按字段 f */
export function parseTileCheckTargets(text: string): TileCheckTarget[] {
  if (text.trim() === 'rules') {
    return Object.keys(CURRENT_RULE_FIELDS).map(code => ({ code, field: ruleField(code) ?? '' }));
  }
  return text.split(',').map(item => {
    const [code = '', explicit] = item.trim().split(':');
    const field = explicit ?? ruleField(code);
    if (!code || !field) {
      throw new Error(`--tile-check 里的 ${item} 没有分类规则，要写成 资源:字段`);
    }
    return { code, field };
  });
}

function mainGeometryOf(geoType: string): MainGeometry {
  const type = geoType.toLowerCase();
  if (type.includes('line')) {
    return 'line';
  }
  return type.includes('point') ? 'point' : 'polygon';
}

// 外环为正、内环为负（瓦片坐标 y 向下），加起来就是扣掉洞的面积
function signedArea(ring: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 2) {
    const next = (index + 2) % ring.length;
    sum += (ring[index] ?? 0) * (ring[next + 1] ?? 0) - (ring[next] ?? 0) * (ring[index + 1] ?? 0);
  }
  return sum / 2;
}

function lineLength(line: readonly number[]): number {
  let sum = 0;
  for (let index = 2; index < line.length; index += 2) {
    sum += Math.hypot((line[index] ?? 0) - (line[index - 2] ?? 0), (line[index + 1] ?? 0) - (line[index - 1] ?? 0));
  }
  return sum;
}

/** 要素的量（面是面积，线是长度，点是个数）和部件数 */
export function measureFeature(feature: TileFeature): { readonly weight: number; readonly parts: number } {
  const parts = partsOf(feature.commands);
  if (feature.geometry === 'polygon') {
    return { weight: Math.abs(parts.reduce((sum, ring) => sum + signedArea(ring), 0)), parts: parts.length };
  }
  if (feature.geometry === 'line') {
    return { weight: parts.reduce((sum, line) => sum + lineLength(line), 0), parts: parts.length };
  }
  return { weight: parts.length, parts: parts.length };
}

// 和前端的 ['get', 字段] 一样取值：字段名不做大小写转换
function valueOf(feature: TileFeature, field: string): string {
  const value = feature.properties[field];
  if (value === undefined) {
    return NO_FIELD;
  }
  return value === '' ? EMPTY_VALUE : textOf(value);
}

function sharesOf(weights: ReadonlyMap<string, number>): ValueShare[] {
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  return [...weights]
    .map(([value, weight]) => ({ value, share: total > 0 ? weight / total : 0 }))
    .toSorted((a, b) => b.share - a.share || a.value.localeCompare(b.value));
}

/** 一张瓦片的概况：只算这个资源主要的几何类型 */
export function summarizeTile(
  layers: readonly TileLayer[],
  geometry: MainGeometry,
  field: string,
  at: { readonly x: number; readonly y: number }
): TileSummary {
  const weights = new Map<string, number>();
  let features = 0;
  let clustered = 0;
  let total = 0;
  let largest = 0;
  let largestParts = 0;
  for (const feature of layers.flatMap(layer => layer.features)) {
    if (feature.geometry === geometry) {
      const { weight, parts } = measureFeature(feature);
      const value = valueOf(feature, field);
      weights.set(value, (weights.get(value) ?? 0) + weight);
      features += 1;
      clustered += feature.properties.clustered === true ? 1 : 0;
      total += weight;
      if (weight >= largest) {
        largest = weight;
        largestParts = parts;
      }
    }
  }
  return {
    ...at,
    features,
    clustered,
    weight: total,
    largestShare: total > 0 ? largest / total : 0,
    largestParts,
    values: sharesOf(weights)
  };
}

function isMerged(tile: TileSummary): boolean {
  return tile.largestShare >= MERGED_SHARE && tile.largestParts >= MERGED_PARTS;
}

/** 一个级别的判断：没有要素的瓦片不算 */
export function verdictOf(tiles: readonly TileSummary[]): ZoomVerdict {
  const present = tiles.filter(tile => tile.features > 0);
  if (present.length === 0) {
    return 'empty';
  }
  const ratio = present.filter(isMerged).length / present.length;
  if (ratio >= MERGED_RATIO) {
    return 'merged';
  }
  return ratio >= PARTIAL_RATIO ? 'partial' : 'normal';
}

/** 一个级别要查的瓦片：放得下时是覆盖全省的整个网格；放不下时取抽样城市的瓦片，其余在网格里均匀取 */
export function tilesToCheck(zoom: number, limit: number): { x: number; y: number }[] {
  const low = tileAt(JIANGSU_BOUNDS.west, JIANGSU_BOUNDS.north, zoom);
  const high = tileAt(JIANGSU_BOUNDS.east, JIANGSU_BOUNDS.south, zoom);
  const grid: { x: number; y: number }[] = [];
  for (let y = low.y; y <= high.y; y += 1) {
    for (let x = low.x; x <= high.x; x += 1) {
      grid.push({ x, y });
    }
  }
  if (grid.length <= limit) {
    return grid;
  }
  const picked = new Map<string, { x: number; y: number }>();
  for (const [lng, lat] of SAMPLE_POINTS.slice(0, limit)) {
    const tile = tileAt(lng, lat, zoom);
    picked.set(`${tile.x}/${tile.y}`, tile);
  }
  const rest = limit - picked.size;
  for (let index = 0; index < grid.length && picked.size < limit; index += Math.max(1, Math.floor(grid.length / rest))) {
    const tile = grid[index];
    if (tile) {
      picked.set(`${tile.x}/${tile.y}`, tile);
    }
  }
  return [...picked.values()];
}

function mergeZoomValues(tiles: readonly TileSummary[]): ValueShare[] {
  const weights = new Map<string, number>();
  for (const tile of tiles) {
    for (const { value, share } of tile.values) {
      weights.set(value, (weights.get(value) ?? 0) + share * tile.weight);
    }
  }
  return sharesOf(weights);
}

async function checkZoom(
  tileset: string,
  zoom: number,
  field: string,
  geometry: MainGeometry,
  sourceLayers: Set<string>,
  limit: number,
  options: ProbeOptions,
  io: TileCheckIO
): Promise<ZoomCheck> {
  const wanted = tilesToCheck(zoom, limit);
  const tiles: TileSummary[] = [];
  const errors: string[] = [];
  for (const at of wanted) {
    try {
      const url = `${options.baseUrl}/api/tiles/${tileset}/${zoom}/${at.x}/${at.y}.pbf`;
      const response = await request(url, options, io);
      const body = readTileBody(new Uint8Array(await response.arrayBuffer()));
      if (body.kind === 'error') {
        errors.push(`${at.x}/${at.y}：${body.message}`);
      } else if (body.kind === 'tile') {
        for (const layer of body.layers) {
          sourceLayers.add(layer.name);
        }
        tiles.push(summarizeTile(body.layers, geometry, field, at));
      }
    } catch (error) {
      if (error instanceof ProbeAuthError) {
        throw error;
      }
      errors.push(`${at.x}/${at.y}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const present = tiles.filter(tile => tile.features > 0);
  return {
    zoom,
    requested: wanted.length,
    tiles: present,
    mergedTiles: present.filter(isMerged).length,
    verdict: verdictOf(present),
    values: mergeZoomValues(present),
    errors
  };
}

export interface TileCheckOptions extends ProbeOptions {
  /** 一个级别最多查多少张瓦片 */
  readonly tilesPerZoom: number;
}

interface TileCheckJob {
  readonly resource: ResourceInfo;
  readonly year: number;
  readonly field: string;
}

/** 按级别解码瓦片的几何；请求失败的瓦片记下来继续，token 失效时抛 ProbeAuthError */
export async function runTileCheck(
  targets: readonly TileCheckTarget[],
  options: TileCheckOptions,
  io: TileCheckIO
): Promise<TileCheckResult[]> {
  const resources = await fetchTree(options, io);
  const jobs: TileCheckJob[] = targets.flatMap(({ code, field }) => {
    const resource = resources.find(item => item.code === code);
    if (!resource) {
      throw new Error(`资源树里没有 ${code}`);
    }
    const years = options.years === 'latest' ? resource.years.slice(-1) : resource.years;
    return years.map(year => ({ resource, year, field }));
  });
  const results: TileCheckResult[] = [];
  await eachLimit(jobs, options.concurrency, async ({ resource, year, field }) => {
    const tileset = `${resource.code}_${year}`;
    const geometry = mainGeometryOf(resource.geoType);
    const sourceLayers = new Set<string>();
    const zooms: ZoomCheck[] = [];
    const floor = ZOOM_FLOORS[resource.code] ?? 0;
    for (const zoom of options.zooms) {
      if (zoom >= floor) {
        const check = await checkZoom(tileset, zoom, field, geometry, sourceLayers, options.tilesPerZoom, options, io);
        zooms.push(check);
        io.log(`${tileset} z${zoom}：查 ${check.requested} 张，${check.tiles.length} 张有要素，${VERDICT_LABELS[check.verdict]}`);
      }
    }
    results.push({ tileset, name: resource.name, field, geometry, sourceLayers: [...sourceLayers], zooms });
    io.save(results);
  });
  return results;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** 连续的级别写成范围：6、7、8、10 写成 6～8、10 */
export function zoomRanges(zooms: readonly number[]): string {
  const ranges: [number, number][] = [];
  for (const zoom of zooms) {
    const last = ranges.at(-1);
    if (last && last[1] === zoom - 1) {
      last[1] = zoom;
    } else {
      ranges.push([zoom, zoom]);
    }
  }
  return ranges.map(([from, to]) => (from === to ? String(from) : `${from}～${to}`)).join('、') || '-';
}

function zoomsWith(result: TileCheckResult, verdict: ZoomVerdict): string {
  return zoomRanges(result.zooms.filter(zoom => zoom.verdict === verdict).map(({ zoom }) => zoom));
}

function shareText(values: readonly ValueShare[], count: number): string {
  return values.slice(0, count).map(({ value, share }) => `${value} ${percent(share)}`).join('、') || '-';
}

function mainValue(tile: TileSummary | undefined): string {
  return tile ? shareText(tile.values, 1) : '·';
}

function zoomRow(check: ZoomCheck): string {
  const { tiles } = check;
  const cells = [
    check.zoom,
    check.requested,
    tiles.length,
    median(tiles.map(tile => tile.features)),
    percent(median(tiles.map(tile => tile.largestShare))),
    median(tiles.map(tile => tile.largestParts)),
    check.mergedTiles,
    tiles.reduce((sum, tile) => sum + tile.clustered, 0),
    shareText(check.values, 5),
    VERDICT_LABELS[check.verdict]
  ];
  return `| ${cells.join(' | ')} |`;
}

// 查了整个网格的低级别才画表，能和页面上的瓦片一一对照
function tileGrid(check: ZoomCheck, limit: number): string[] {
  const low = tileAt(JIANGSU_BOUNDS.west, JIANGSU_BOUNDS.north, check.zoom);
  const high = tileAt(JIANGSU_BOUNDS.east, JIANGSU_BOUNDS.south, check.zoom);
  const width = high.x - low.x + 1;
  const height = high.y - low.y + 1;
  if (check.tiles.length === 0 || width * height > limit) {
    return [];
  }
  const columns = Array.from({ length: width }, (_, index) => low.x + index);
  const rows = Array.from({ length: height }, (_, index) => low.y + index);
  const cell = (x: number, y: number) => mainValue(check.tiles.find(tile => tile.x === x && tile.y === y));
  return [
    '',
    `${check.zoom} 级每张瓦片的主要取值（上北下南，· 是没有要素）：`,
    '',
    `| y \\ x | ${columns.join(' | ')} |`,
    `|---|${columns.map(() => '---').join('|')}|`,
    ...rows.map(y => `| ${y} | ${columns.map(x => cell(x, y)).join(' | ')} |`)
  ];
}

function spotRows(result: TileCheckResult): string[] {
  const { zooms } = result;
  return [
    '',
    '同一地点所在瓦片的主要取值，级别之间不同就是放大时颜色跳变：',
    '',
    `| 地点 | ${zooms.map(({ zoom }) => zoom).join(' | ')} |`,
    `|---|${zooms.map(() => '---').join('|')}|`,
    ...SAMPLE_POINTS.map(([lng, lat, name]) => {
      const cells = zooms.map(check => {
        const { x, y } = tileAt(lng, lat, check.zoom);
        return mainValue(check.tiles.find(tile => tile.x === x && tile.y === y));
      });
      return `| ${name} | ${cells.join(' | ')} |`;
    })
  ];
}

function errorRows(result: TileCheckResult): string[] {
  const errors = result.zooms.flatMap(({ zoom, errors: messages }) => messages.map(message => `- z${zoom} ${message}`));
  return errors.length === 0 ? [] : ['', '请求失败的瓦片：', '', ...errors];
}

function tilesetSection(result: TileCheckResult, limit: number): string[] {
  return [
    '',
    `## ${result.tileset}（${result.name}，${result.field}）`,
    '',
    `瓦片里的图层名：${result.sourceLayers.join('、') || '-'}`,
    '',
    '| 级别 | 查了 | 有要素 | 每张要素数（中位） | 最大要素占比（中位） | 最大要素的部件数（中位） | 合并的瓦片 | 聚合要素 | 主要取值 | 判断 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...result.zooms.map(zoomRow),
    ...result.zooms.flatMap(check => tileGrid(check, limit)),
    ...spotRows(result),
    ...errorRows(result)
  ];
}

/** 给人看的报告：结论表、每个瓦片集逐级别的数字和低级别的瓦片网格 */
export function formatTileCheck(results: readonly TileCheckResult[], limit: number): string {
  const sorted = results.toSorted((a, b) => a.tileset.localeCompare(b.tileset));
  return [
    '# 瓦片一致性探查',
    '',
    `一张瓦片算"合并"：最大的要素占这张瓦片 ${percent(MERGED_SHARE)} 以上，而且有 ${MERGED_PARTS} 个以上的部件（面的环、线的折线、点）。` +
      `一个级别至少 ${percent(MERGED_RATIO)} 的瓦片合并算"合并"，至少 ${percent(PARTIAL_RATIO)} 算"部分合并"。比例：面按面积，线按长度，点按个数。`,
    '',
    '前端按每个要素的属性配色。合并的瓦片整张只有一种颜色，颜色取决于这个要素带的属性，不代表真实分布。把下面的取值和页面上同一级别的颜色对照：对得上，说明前端画的就是瓦片里的数据。',
    '',
    '## 结论',
    '',
    '| 瓦片集 | 资源 | 字段 | 合并 | 部分合并 | 没有合并 |',
    '|---|---|---|---|---|---|',
    ...sorted.map(
      result =>
        `| ${result.tileset} | ${result.name} | ${result.field} | ${zoomsWith(result, 'merged')} | ${zoomsWith(result, 'partial')} | ${zoomsWith(result, 'normal')} |`
    ),
    ...sorted.flatMap(result => tilesetSection(result, limit)),
    ''
  ].join('\n');
}
