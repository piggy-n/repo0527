// @vitest-environment node
import { strToU8, zipSync } from 'fflate';
import type { Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { type AreaFile, type AreaFileRead, type AreaFileResult, readAreaFiles, readGeoJson } from './area-file';
import { AREA_LIMITS } from './area-geometry';

// ---------- 测试数据 ----------

// Shapefile 的外环是顺时针
const clockwise = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [west, north],
  [east, north],
  [east, south],
  [west, south]
];

/** 按 ESRI 的格式写一个 .shp：面（类型 5）的每条记录是一个多边形，点（类型 1）的每条记录取第一个坐标 */
function shp(shapeType: number, records: readonly Position[][][]): Uint8Array {
  const contents = records.map(rings => {
    if (shapeType === 1) {
      const [x = 0, y = 0] = rings[0]?.[0] ?? [];
      const view = new DataView(new ArrayBuffer(20));
      view.setInt32(0, 1, true);
      view.setFloat64(4, x, true);
      view.setFloat64(12, y, true);
      return new Uint8Array(view.buffer);
    }
    const points = rings.flat();
    const view = new DataView(new ArrayBuffer(44 + 4 * rings.length + 16 * points.length));
    view.setInt32(0, shapeType, true);
    view.setInt32(36, rings.length, true);
    view.setInt32(40, points.length, true);
    let offset = 44;
    let start = 0;
    for (const ring of rings) {
      view.setInt32(offset, start, true);
      offset += 4;
      start += ring.length;
    }
    for (const [x = 0, y = 0] of points) {
      view.setFloat64(offset, x, true);
      view.setFloat64(offset + 8, y, true);
      offset += 16;
    }
    return new Uint8Array(view.buffer);
  });
  const total = 100 + contents.reduce((sum, content) => sum + 8 + content.byteLength, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994);
  view.setInt32(24, total / 2);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  let offset = 100;
  contents.forEach((content, index) => {
    view.setInt32(offset, index + 1);
    view.setInt32(offset + 4, content.byteLength / 2);
    bytes.set(content, offset + 8);
    offset += 8 + content.byteLength;
  });
  return bytes;
}

const CGCS2000 =
  'GEOGCS["GCS_China_Geodetic_Coordinate_System_2000",DATUM["D_China_2000",' +
  'SPHEROID["CGCS2000",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
// 江苏常用的 CGCS2000 三度带第 40 带（中央经线 120 度，横坐标加带号）
const GK_ZONE_40 =
  `PROJCS["CGCS2000_3_Degree_GK_Zone_40",${CGCS2000},PROJECTION["Gauss_Kruger"],` +
  'PARAMETER["False_Easting",40500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",120.0],' +
  'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

const NANJING = [clockwise(118.8, 32, 118.82, 32.02)];
const NEIGHBOR = [clockwise(118.9, 32, 118.92, 32.02)];
const PROJECTED = [clockwise(40499000, 3539000, 40501000, 3541000)];

const file = (name: string, content: Uint8Array | string): AreaFile => {
  const bytes = typeof content === 'string' ? strToU8(content) : content;
  return { name, buffer: bytes.slice().buffer };
};
const bytesOf = (value: Uint8Array | string): Uint8Array => (typeof value === 'string' ? strToU8(value) : value);
const zip = (name: string, entries: Record<string, Uint8Array | string>): AreaFile =>
  file(name, zipSync(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, bytesOf(value)]))));
const polygon = (rings: Position[][]) => ({ type: 'Polygon', coordinates: rings });
const collection = (...geometries: object[]) =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: geometries.map(geometry => ({ type: 'Feature', properties: {}, geometry }))
  });
const withCrs = (name: string) =>
  JSON.stringify({
    type: 'FeatureCollection',
    crs: { properties: { name } },
    features: [{ type: 'Feature', geometry: polygon(NANJING) }]
  });

function read(result: AreaFileResult): AreaFileRead {
  if (!result.ok) {
    throw new Error(`应当可以读出：${result.problem.message}`);
  }
  return result;
}

const failure = (result: AreaFileResult) => (result.ok ? null : result.problem);
const readText = (text: string) => readGeoJson(text, 'a.json');
const readFiles = async (...files: AreaFile[]) => read(await readAreaFiles(files));
const failFiles = async (...files: AreaFile[]) => failure(await readAreaFiles(files));

// ---------- GeoJSON ----------

describe('readGeoJson', () => {
  it('读出面，忽略点、线和没有几何的要素并说明', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: polygon(NANJING) },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [118.8, 32] } },
        { type: 'Feature', properties: {}, geometry: null }
      ]
    });
    const result = read(readGeoJson(text, '江宁.geojson'));
    expect(result).toMatchObject({ format: 'geojson', features: 1, crs: 'WGS84 / CGCS2000 经纬度' });
    expect(result.area.notices).toEqual(['忽略了 1 个点、线要素', '忽略了 1 个没有几何的要素']);
  });

  it('要素、单独的几何和几何集合都能读', () => {
    expect(read(readText(JSON.stringify(polygon(NANJING)))).features).toBe(1);
    expect(read(readText(JSON.stringify({ type: 'Feature', geometry: polygon(NANJING) }))).features).toBe(1);
    const nested = { type: 'GeometryCollection', geometries: [polygon(NANJING), polygon(NEIGHBOR)] };
    expect(read(readText(JSON.stringify(nested))).features).toBe(2);
  });

  it('旧版的 crs 成员：经纬度可以读，投影坐标系说明要转换', () => {
    expect(read(readText(withCrs('urn:ogc:def:crs:EPSG::4490'))).crs).toBe('urn:ogc:def:crs:EPSG::4490 经纬度');
    expect(failure(readText(withCrs('EPSG:4528')))).toEqual({
      code: 'crs',
      message: '文件声明的坐标系是 EPSG:4528，请转换为 CGCS2000（EPSG:4490）或 WGS84（EPSG:4326）经纬度后上传'
    });
  });

  it('格式错误时说明大致的行号，不是 GeoJSON 时说明', () => {
    const broken = '{\n  "type": "FeatureCollection",\n  "features": [],\n}';
    expect(failure(readGeoJson(broken, 'a.geojson'))?.message).toBe(
      'a.geojson 不是有效的 JSON，第 4 行附近有格式错误'
    );
    expect(failure(readGeoJson('{"type": [', 'a.geojson'))?.message).toMatch(/^a\.geojson 不是有效的 JSON/);
    expect(failure(readText('{"name": "x"}'))?.code).toBe('file-corrupt');
    expect(failure(readGeoJson('   ', 'a.geojson'))).toEqual({ code: 'file-empty', message: 'a.geojson 是空文件' });
  });

  it('没有面时说明原因', () => {
    const line = { type: 'LineString', coordinates: [[118, 32], [119, 32]] };
    expect(failure(readText(collection(line)))).toEqual({
      code: 'geometry-type',
      message: '文件里只有点、线要素，没有面，不能作为范围'
    });
    expect(failure(readText(collection()))?.message).toBe('文件里没有要素');
    expect(failure(readText(JSON.stringify({ type: 'Feature', geometry: null })))?.message).toBe('文件里的要素都没有几何');
  });

  it('坐标是投影坐标、经纬度颠倒、结构不对时说明', () => {
    expect(failure(readText(collection(polygon(PROJECTED))))?.message).toContain('可能是投影坐标');
    const swapped = [NANJING[0]?.map(([x = 0, y = 0]) => [y, x]) ?? []];
    expect(failure(readText(collection(polygon(swapped))))?.message).toContain('经度、纬度可能颠倒');
    expect(failure(readText(collection({ type: 'Polygon', coordinates: 'x' })))).toEqual({
      code: 'file-corrupt',
      message: '有 1 个面的坐标结构不正确，文件可能已损坏'
    });
  });
});

// ---------- Shapefile 与整体 ----------

describe('readAreaFiles', () => {
  it('压缩包：按 .prj 读经纬度，写出坐标系名称', async () => {
    const result = await readFiles(zip('江宁.zip', { '江宁.shp': shp(5, [NANJING]), '江宁.prj': CGCS2000 }));
    expect(result).toMatchObject({
      format: 'shapefile',
      features: 1,
      crs: 'GCS_China_Geodetic_Coordinate_System_2000（已转换为经纬度）'
    });
    expect(result.area.area).toBeCloseTo(4.19, 1);
  });

  it('压缩包：三度带投影坐标按 .prj 转换为经纬度', async () => {
    const result = await readFiles(zip('a.zip', { 'a.shp': shp(5, [PROJECTED]), 'a.prj': GK_ZONE_40 }));
    const [[[[lng = 0, lat = 0] = []] = []] = []] = result.area.geometry.coordinates;
    expect(lng).toBeCloseTo(120, 1);
    expect(lat).toBeCloseTo(31.98, 1);
    expect(result.crs).toBe('CGCS2000_3_Degree_GK_Zone_40（已转换为经纬度）');
    // 2 × 2 千米
    expect(result.area.area).toBeCloseTo(4, 1);
  });

  it('没有 .prj：经纬度坐标照读并说明，投影坐标不能读', async () => {
    const plain = await readFiles(zip('a.zip', { 'a.shp': shp(5, [NANJING]) }));
    expect(plain.area.notices).toContain('没有 .prj 坐标系文件，按经纬度坐标读取');
    expect(await failFiles(zip('a.zip', { 'a.shp': shp(5, [PROJECTED]) }))).toEqual({
      code: 'crs',
      message: '缺少 .prj 坐标系文件，坐标也不是经纬度，无法确定坐标系。请连同 .prj 一起上传'
    });
  });

  it('.prj 认不出时说明', async () => {
    const result = await failFiles(zip('a.zip', { 'a.shp': shp(5, [PROJECTED]), 'a.prj': 'PROJCS["Unknown",GARBAGE' }));
    expect(result?.code).toBe('crs');
    expect(result?.message).toContain('无法识别 .prj 中的坐标系');
  });

  it('点图层、被截断、不是 Shapefile 的 .shp 不能读', async () => {
    expect(await failFiles(zip('a.zip', { 'a.shp': shp(1, [NANJING]) }))).toEqual({
      code: 'geometry-type',
      message: 'a.shp 是点图层，只能使用面图层'
    });
    const whole = shp(5, [NANJING]);
    expect((await failFiles(zip('a.zip', { 'a.shp': whole.slice(0, whole.length - 20) })))?.message).toBe(
      'a.shp 不完整：文件被截断，请重新导出后上传'
    );
    expect((await failFiles(zip('a.zip', { 'a.shp': new Uint8Array(200).fill(7) })))?.message).toBe(
      'a.shp 不是有效的 Shapefile'
    );
  });

  it('压缩包里有几个图层时合并面图层，跳过点图层', async () => {
    const result = await readFiles(
      zip('a.zip', { 'a.shp': shp(5, [NANJING]), 'b.shp': shp(5, [NEIGHBOR]), 'c.shp': shp(1, [NANJING]) })
    );
    expect(result.features).toBe(2);
    expect(result.area.notices).toContain('压缩包里有 3 个图层，合并了其中 2 个面图层');
  });

  it('压缩包里没有 .shp 时读里面的 GeoJSON，都没有时说明', async () => {
    expect((await readFiles(zip('a.zip', { 'a.geojson': collection(polygon(NANJING)) }))).format).toBe('geojson');
    expect(await failFiles(zip('a.zip', { 'a.dbf': 'x' }))).toEqual({
      code: 'file-parts',
      message: 'a.zip 里没有 .shp 文件'
    });
    expect((await failFiles(file('a.zip', 'not a zip')))?.code).toBe('file-corrupt');
  });

  it('解压后过大的压缩包不解压', async () => {
    const archive = zipSync({ 'a.shp': shp(5, [NANJING]) });
    // 把中央目录里记的原始大小改成 300 MB
    const view = new DataView(archive.buffer);
    for (let offset = 0; offset < archive.length - 4; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 300 * 1024 * 1024, true);
      }
    }
    expect((await failFiles(file('a.zip', archive)))?.code).toBe('file-size');
  });

  it('同一组 Shapefile 文件：需要一个 .shp，.prj 要同名', async () => {
    const shpFile = file('江宁.shp', shp(5, [NANJING]));
    const prjFile = file('江宁.prj', CGCS2000);
    const parts = [shpFile, prjFile, file('江宁.dbf', 'x'), file('江宁.shx', 'x')];
    expect((await readFiles(...parts)).format).toBe('shapefile');
    expect((await failFiles(file('江宁.dbf', 'x'), prjFile))?.message).toContain('缺少 .shp 文件');
    expect((await failFiles(shpFile, file('b.shp', shp(5, [NANJING]))))?.message).toContain('选择了多个 .shp 文件');
    expect((await failFiles(shpFile, file('b.prj', CGCS2000)))?.message).toBe(
      'b.prj 与 江宁.shp 的文件名不一致，不是同一组 Shapefile'
    );
  });

  it('类型、组合、大小、空文件不对时不读', async () => {
    expect((await failFiles(file('a.kml', 'x')))?.code).toBe('file-type');
    expect((await failFiles(file('a.geojson', 'x'), file('b.zip', 'x')))?.code).toBe('file-parts');
    const big = { name: 'a.geojson', buffer: new ArrayBuffer(AREA_LIMITS.fileBytes + 1) };
    expect((await failFiles(big))?.code).toBe('file-size');
    expect(await failFiles(file('a.geojson', ''))).toEqual({ code: 'file-empty', message: 'a.geojson 是空文件' });
    expect((await failFiles())?.code).toBe('file-empty');
  });
});
