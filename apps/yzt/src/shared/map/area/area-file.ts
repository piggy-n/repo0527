import { unzipSync } from 'fflate';
import type { Position } from 'geojson';
import { z } from 'zod';
import {
  AREA_LIMITS,
  type AreaFailure,
  coordinateIssue,
  prepareArea,
  type PreparedArea,
  problem
} from './area-geometry';

// 读范围文件（docs/modules/shared-map.md 的"自定义范围"）：GeoJSON，或者 Shapefile（压缩包，或同一组 .shp、.prj 等文件）。
// 在 Worker 里运行，只用相对导入和 npm 包；读不了时返回原因，不抛错

/** 交给 Worker 的一个文件 */
export interface AreaFile {
  readonly name: string;
  readonly buffer: ArrayBuffer;
}

export type AreaFormat = 'geojson' | 'shapefile';

/** 读出的范围 */
export interface AreaFileRead {
  readonly ok: true;
  readonly format: AreaFormat;
  /** 坐标系的说明，如"CGCS2000_3_Degree_GK_Zone_40（已转换为经纬度）" */
  readonly crs: string;
  /** 面要素的个数 */
  readonly features: number;
  readonly area: PreparedArea;
}

export type AreaFileResult = AreaFileRead | AreaFailure;

/** 能上传的扩展名：GeoJSON、压缩包、Shapefile 的各个文件（.shx 等不需要，选了也不报错） */
export const AREA_FILE_ACCEPT = '.geojson,.json,.zip,.shp,.shx,.dbf,.prj,.cpg';

const GEOJSON = /\.(geo)?json$/i;
const SHAPEFILE_PART = /\.(shp|shx|dbf|prj|cpg|sbn|sbx|qix|fix|xml)$/i;
const SUPPORTED = '请上传 GeoJSON（.geojson、.json），或 Shapefile（.zip 压缩包，或同时选择 .shp、.dbf、.prj）';

const extension = (name: string): string => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
const baseName = (name: string): string => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const supported = (name: string): boolean =>
  GEOJSON.test(name) || extension(name) === 'zip' || SHAPEFILE_PART.test(name);

// ---------- GeoJSON ----------

const GEOMETRY_TYPES = [
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection'
] as const;

interface RawGeometry {
  readonly type: (typeof GEOMETRY_TYPES)[number];
  readonly coordinates?: unknown;
  readonly geometries?: readonly RawGeometry[];
}

// 坐标不在这里逐个检查：几十万个节点用 zod 检查太慢，收集面时按形状检查
const geometrySchema: z.ZodType<RawGeometry> = z.lazy(() =>
  z.object({
    type: z.enum(GEOMETRY_TYPES),
    coordinates: z.unknown().optional(),
    geometries: z.array(geometrySchema).optional()
  })
);
const featureSchema = z.object({ type: z.literal('Feature'), geometry: geometrySchema.nullable() });
const crsSchema = z.object({ properties: z.object({ name: z.string() }) }).optional();
const geojsonSchema = z.union([
  z.object({ type: z.literal('FeatureCollection'), features: z.array(featureSchema), crs: crsSchema }),
  featureSchema.extend({ crs: crsSchema }),
  geometrySchema
]);

/** 收集到的面和忽略的要素 */
interface Collected {
  readonly polygons: Position[][][];
  /** 面要素的个数 */
  features: number;
  /** 忽略的点、线 */
  others: number;
  /** 没有几何的要素 */
  empty: number;
  /** 坐标形状不对的面 */
  malformed: number;
}

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) && value.length >= 2 && value.every(item => typeof item === 'number');
const isRing = (value: unknown): value is Position[] => Array.isArray(value) && value.every(isPosition);
const isPolygon = (value: unknown): value is Position[][] =>
  Array.isArray(value) && value.length > 0 && value.every(isRing);

function collect(geometry: RawGeometry | null, into: Collected): void {
  if (geometry === null) {
    into.empty += 1;
    return;
  }
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    into.features += 1;
    if (isPolygon(coordinates)) {
      into.polygons.push(coordinates);
    } else {
      into.malformed += 1;
    }
  } else if (type === 'MultiPolygon') {
    into.features += 1;
    if (Array.isArray(coordinates) && coordinates.every(isPolygon)) {
      into.polygons.push(...coordinates);
    } else {
      into.malformed += 1;
    }
  } else if (type === 'GeometryCollection') {
    for (const item of geometry.geometries ?? []) {
      collect(item, into);
    }
  } else {
    into.others += 1;
  }
}

// JSON.parse 的错误里常有出错的行号或位置（各浏览器的写法不同），有就换算成行号
function jsonErrorLine(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const line = /line (\d+)/.exec(message)?.[1];
  const position = /position (\d+)/.exec(message)?.[1];
  const at = line ?? (position === undefined ? undefined : String(text.slice(0, Number(position)).split('\n').length));
  return at === undefined ? '' : `，第 ${at} 行附近有格式错误`;
}

// GeoJSON 规定用 WGS84 经纬度；旧版的 crs 成员写了别的坐标系时不读
const GEOGRAPHIC_CRS = /CRS84|EPSG:{1,2}(4326|4490)$/i;

/** 读 GeoJSON 的文字 */
export function readGeoJson(text: string, fileName: string): AreaFileResult {
  if (text.trim() === '') {
    return problem('file-empty', `${fileName} 是空文件`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return problem('file-corrupt', `${fileName} 不是有效的 JSON${jsonErrorLine(text, error)}`);
  }
  const parsed = geojsonSchema.safeParse(json);
  if (!parsed.success) {
    return problem('file-corrupt', `${fileName} 不是有效的 GeoJSON：缺少 type，或要素、几何的结构不正确`);
  }
  const value = parsed.data;
  const crsName = 'crs' in value ? value.crs?.properties.name : undefined;
  if (crsName !== undefined && !GEOGRAPHIC_CRS.test(crsName)) {
    return problem('crs', `文件声明的坐标系是 ${crsName}，请转换为 CGCS2000（EPSG:4490）或 WGS84（EPSG:4326）经纬度后上传`);
  }
  const collected: Collected = { polygons: [], features: 0, others: 0, empty: 0, malformed: 0 };
  if (value.type === 'FeatureCollection') {
    for (const feature of value.features) {
      collect(feature.geometry, collected);
    }
  } else {
    collect(value.type === 'Feature' ? value.geometry : value, collected);
  }
  return finish(collected, {
    format: 'geojson',
    crs: crsName === undefined ? 'WGS84 / CGCS2000 经纬度' : `${crsName} 经纬度`,
    projected: '坐标不是经纬度，可能是投影坐标。GeoJSON 要求 CGCS2000 或 WGS84 经纬度，请转换后上传',
    swapped: '坐标的经度、纬度可能颠倒：GeoJSON 要求先经度、后纬度，请检查后重新上传'
  });
}

interface FinishOptions {
  readonly format: AreaFormat;
  readonly crs: string;
  readonly projected: string;
  readonly swapped: string;
  readonly notices?: readonly string[];
}

// 检查收集到的面，再交给 prepareArea 整理
function finish(collected: Collected, options: FinishOptions): AreaFileResult {
  const { polygons, features, others, empty, malformed } = collected;
  if (malformed > 0) {
    return problem('file-corrupt', `有 ${malformed} 个面的坐标结构不正确，文件可能已损坏`);
  }
  if (polygons.length === 0) {
    if (others > 0) {
      return problem('geometry-type', '文件里只有点、线要素，没有面，不能作为范围');
    }
    return problem('file-empty', empty > 0 ? '文件里的要素都没有几何' : '文件里没有要素');
  }
  const issue = coordinateIssue(polygons);
  if (issue === 'invalid') {
    return problem('file-corrupt', '坐标里有不是数字的值，文件可能已损坏');
  }
  if (issue !== null) {
    return problem('crs', issue === 'swapped' ? options.swapped : options.projected);
  }
  const notices = [...(options.notices ?? [])];
  if (others > 0) {
    notices.push(`忽略了 ${others} 个点、线要素`);
  }
  if (empty > 0) {
    notices.push(`忽略了 ${empty} 个没有几何的要素`);
  }
  const prepared = prepareArea(polygons, notices);
  if (!prepared.ok) {
    return prepared;
  }
  return { ok: true, format: options.format, crs: options.crs, features, area: prepared.area };
}

// ---------- Shapefile ----------

/** 一个图层：.shp 的内容和同名的 .prj */
interface ShapefileLayer {
  readonly name: string;
  readonly shp: Uint8Array;
  readonly prj: string | null;
}

const SHAPE_TYPES: Readonly<Record<number, string>> = { 0: '空', 1: '点', 3: '线', 5: '面', 8: '多点', 31: '多面体' };

// .shp 的文件头：文件码 9994（大端）、文件长度（大端，单位 16 位字）、要素类型（小端）
function checkHeader(layer: ShapefileLayer): AreaFailure | null {
  const { shp, name } = layer;
  if (shp.byteLength < 100) {
    return problem('file-corrupt', `${name}.shp 不完整或不是有效的 Shapefile`);
  }
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (view.getInt32(0) !== 9994) {
    return problem('file-corrupt', `${name}.shp 不是有效的 Shapefile`);
  }
  if (view.getInt32(24) * 2 > shp.byteLength) {
    return problem('file-corrupt', `${name}.shp 不完整：文件被截断，请重新导出后上传`);
  }
  // 带 Z、M 的类型加 10、20；多面体是 31
  const raw = view.getInt32(32, true);
  const type = raw === 31 ? raw : raw % 10;
  if (type !== 5) {
    const kind = SHAPE_TYPES[type] ?? `类型 ${type}`;
    return problem('geometry-type', `${name}.shp 是${kind}图层，只能使用面图层`);
  }
  return null;
}

// .prj 第一段里的坐标系名称
const crsNameOf = (prj: string): string => /^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\["([^"]+)"/.exec(prj)?.[1] ?? '';

async function readLayers(layers: readonly ShapefileLayer[], notices: string[]): Promise<AreaFileResult> {
  const { parseShp } = await import('shpjs');
  const collected: Collected = { polygons: [], features: 0, others: 0, empty: 0, malformed: 0 };
  let polygonLayers = 0;
  for (const layer of layers) {
    const failure = checkHeader(layer);
    if (failure) {
      if (layers.length > 1 && failure.problem.code === 'geometry-type') {
        // 压缩包里有几个图层时只用面图层
        continue;
      }
      return failure;
    }
    polygonLayers += 1;
    let rows: ReturnType<typeof parseShp>;
    try {
      rows = parseShp(layer.shp, layer.prj ?? undefined);
    } catch {
      return problem('file-corrupt', `${layer.name}.shp 解析失败，文件可能已损坏`);
    }
    for (const geometry of rows) {
      collect(geometry, collected);
    }
  }
  if (polygonLayers === 0) {
    return problem('geometry-type', '压缩包里没有面图层，只能使用面图层');
  }
  if (layers.length > 1) {
    notices.push(`压缩包里有 ${layers.length} 个图层，合并了其中 ${polygonLayers} 个面图层`);
  }
  const prjs = layers.map(layer => layer.prj);
  const named = [...new Set(prjs.flatMap(prj => (prj ? [crsNameOf(prj)] : [])))].filter(Boolean);
  const missing = prjs.some(prj => prj === null);
  if (missing) {
    notices.push('没有 .prj 坐标系文件，按经纬度坐标读取');
  }
  return finish(collected, {
    format: 'shapefile',
    crs: named.length > 0 ? `${named.join('、')}（已转换为经纬度）` : '经纬度（未提供 .prj）',
    projected: missing
      ? '缺少 .prj 坐标系文件，坐标也不是经纬度，无法确定坐标系。请连同 .prj 一起上传'
      : `无法识别 .prj 中的坐标系${named.length > 0 ? `（${named.join('、')}）` : ''}，请转换为 CGCS2000 或 WGS84 后上传`,
    swapped: '坐标的经度、纬度可能颠倒，请检查后重新上传',
    notices
  });
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// 压缩包里用得上的文件
const wanted = (name: string): boolean => !name.includes('__MACOSX') && /\.(shp|prj|geojson|json)$/i.test(name);

// 压缩包：先只看目录、算解压后的大小，再解压用得上的文件
async function readZip(file: AreaFile): Promise<AreaFileResult> {
  const bytes = new Uint8Array(file.buffer);
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    unzipSync(bytes, {
      filter: entry => {
        if (wanted(entry.name)) {
          total += entry.originalSize;
        }
        return false;
      }
    });
    if (total > AREA_LIMITS.unzippedBytes) {
      return problem('file-size', `压缩包解压后约 ${formatBytes(total)}，超过 ${formatBytes(AREA_LIMITS.unzippedBytes)} 的上限`);
    }
    entries = unzipSync(bytes, { filter: entry => wanted(entry.name) });
  } catch {
    return problem('file-corrupt', `${file.name} 已损坏或不是 zip 压缩包`);
  }
  const names = Object.keys(entries);
  const shps = names.filter(name => extension(name) === 'shp');
  if (shps.length === 0) {
    const json = names.find(name => GEOJSON.test(name));
    const content = json === undefined ? undefined : entries[json];
    if (json !== undefined && content !== undefined) {
      return readGeoJson(decode(content), baseName(json));
    }
    return problem('file-parts', `${file.name} 里没有 .shp 文件`);
  }
  const prjOf = (shp: string) => {
    const stem = shp.slice(0, -4).toLowerCase();
    const key = names.find(name => extension(name) === 'prj' && name.slice(0, -4).toLowerCase() === stem);
    const content = key === undefined ? undefined : entries[key];
    return content === undefined ? null : decode(content);
  };
  const layers = shps.flatMap(name => {
    const shp = entries[name];
    return shp ? [{ name: baseName(name), shp, prj: prjOf(name) }] : [];
  });
  return readLayers(layers, []);
}

// 同一组 Shapefile 文件：一个 .shp，同名的 .prj 可选；.dbf 等属性文件用不到
function readParts(files: readonly AreaFile[]): Promise<AreaFileResult> | AreaFileResult {
  const shps = files.filter(file => extension(file.name) === 'shp');
  if (shps.length === 0) {
    return problem('file-parts', '缺少 .shp 文件：Shapefile 至少要有 .shp，坐标系文件 .prj 也要一起选择');
  }
  if (shps.length > 1) {
    return problem('file-parts', '选择了多个 .shp 文件，请一次只上传一组 Shapefile，或打包成一个压缩包');
  }
  const [shp] = shps;
  if (!shp) {
    return problem('file-parts', '缺少 .shp 文件');
  }
  const name = baseName(shp.name);
  const prjs = files.filter(file => extension(file.name) === 'prj');
  const prj = prjs.find(file => baseName(file.name).toLowerCase() === name.toLowerCase());
  if (prjs.length > 0 && !prj) {
    return problem('file-parts', `${prjs[0]?.name ?? '.prj'} 与 ${shp.name} 的文件名不一致，不是同一组 Shapefile`);
  }
  const layer = { name, shp: new Uint8Array(shp.buffer), prj: prj ? decode(new Uint8Array(prj.buffer)) : null };
  return readLayers([layer], []);
}

/** 读一个范围：一个 GeoJSON、一个压缩包，或同一组 Shapefile 文件 */
export async function readAreaFiles(files: readonly AreaFile[]): Promise<AreaFileResult> {
  if (files.length === 0) {
    return problem('file-empty', '没有选择文件');
  }
  const unknown = files.find(file => !supported(file.name));
  if (unknown) {
    return problem('file-type', `不支持 ${unknown.name}。${SUPPORTED}`);
  }
  const size = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
  if (size > AREA_LIMITS.fileBytes) {
    return problem('file-size', `文件共 ${formatBytes(size)}，超过 ${formatBytes(AREA_LIMITS.fileBytes)} 的上限`);
  }
  const empty = files.find(file => file.buffer.byteLength === 0);
  if (empty) {
    return problem('file-empty', `${empty.name} 是空文件`);
  }
  const jsons = files.filter(file => GEOJSON.test(file.name));
  const zips = files.filter(file => extension(file.name) === 'zip');
  const [single] = files;
  if (files.length === 1 && single && jsons.length === 1) {
    return readGeoJson(decode(new Uint8Array(single.buffer)), single.name);
  }
  if (files.length === 1 && single && zips.length === 1) {
    return readZip(single);
  }
  if (jsons.length > 0 || zips.length > 0) {
    return problem('file-parts', '一次只能上传一个范围：一个 GeoJSON、一个压缩包，或同一组 Shapefile 文件');
  }
  return readParts(files);
}
