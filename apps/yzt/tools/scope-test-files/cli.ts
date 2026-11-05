import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { localPath } from '../local-files/paths.ts';

// 生成自定义监测范围的验收文件（同目录的 说明.md）：pnpm --filter yzt scope-files:generate

type Point = [number, number];
type Transform = (point: Point) => Point;
type Files = Record<string, Uint8Array>;
// Shapefile 每条记录的结构：1 是一个点，3 是若干条线，5 是若干个面（外环 + 洞）
interface ShapeRecord {
  1: Point;
  3: Point[][];
  5: Point[][][];
}
interface BoundaryGeometry {
  type: string;
  coordinates: Point[][][];
}
interface BoundaryFile {
  features: { properties: { name: string }; geometry: BoundaryGeometry }[];
}
interface Projection {
  forward: (point: Point) => Point;
}

const out = localPath('scope-test-files');
// proj4 是 shpjs 的依赖，应用没有直接依赖它：经 shpjs 取同一份，投影和页面读取时用的是同一个版本
const requireApp = createRequire(import.meta.url);
const proj4 = createRequire(requireApp.resolve('shpjs'))('proj4') as (wkt: string) => Projection;

const data = resolve(import.meta.dirname, '../../src/shared/map/boundary/data');
const load = (name: string) => JSON.parse(readFileSync(join(data, name), 'utf8')) as BoundaryFile;
const county = load('jiangsu-county.json');
const city = load('jiangsu-city.json');
const province = load('jiangsu-province.json');

// 只清掉生成的三个目录
for (const group of ['A-正常的GeoJSON', 'B-Shapefile', 'C-异常']) {
  rmSync(join(out, group), { recursive: true, force: true });
}

const write = (path: string, content: string | Uint8Array) => {
  const full = join(out, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const roundDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(roundDeep);
  }
  return typeof value === 'number' ? round(value) : value;
};
const json = (path: string, value: unknown, pretty = true) => {
  write(path, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
};

const box = (w: number, s: number, e: number, n: number): Point[] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s]
];
const feature = (geometry: unknown, properties = {}) => ({ type: 'Feature', properties, geometry });
// C06 要写坐标结构错误的面，这里不限制环的类型
const polygon = (...rings: unknown[]) => ({ type: 'Polygon', coordinates: rings });
const multi = (...polygons: unknown[]) => ({ type: 'MultiPolygon', coordinates: polygons });
const collection = (features: unknown[], extra = {}) => ({ type: 'FeatureCollection', ...extra, features });

function circle(lng: number, lat: number, radius: number, count: number): Point[] {
  const ring: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    ring.push([lng + (Math.cos(angle) * radius) / Math.cos((lat * Math.PI) / 180), lat + Math.sin(angle) * radius]);
  }
  ring.push(ring[0]);
  return ring;
}

// 绕外环节点的平均位置缩放
function scale(geometry: BoundaryGeometry, factor: number) {
  const outer = geometry.coordinates[0][0];
  const cx = outer.reduce((sum, [x]) => sum + x, 0) / outer.length;
  const cy = outer.reduce((sum, [, y]) => sum + y, 0) / outer.length;
  const map = (rings: Point[][]) => rings.map(ring => ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]));
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(map) };
}

const countyOf = (name: string) => {
  const found = county.features.find(item => item.properties.name === name);
  if (!found) {
    throw new Error(`没有 ${name}`);
  }
  return found.geometry;
};

// ---------- A 正常的 GeoJSON ----------

const A = 'A-正常的GeoJSON';
json(
  `${A}/A01-宁镇交界-跨两市.geojson`,
  collection([feature(polygon(box(118.95, 32.02, 119.25, 32.16)), { name: '宁镇交界' })])
);
const qinhuai = countyOf('秦淮区');
json(`${A}/A02-秦淮区-与县界重合.geojson`, feature(qinhuai, { name: '秦淮区' }));
json(`${A}/A03-秦淮区-外扩约5米.geojson`, feature(roundDeep(scale(qinhuai, 1.00127)), { name: '秦淮区外扩' }));
json(`${A}/A04-秦淮区-内缩约10米.geojson`, feature(roundDeep(scale(qinhuai, 0.99747)), { name: '秦淮区内缩' }));
json(
  `${A}/A05-南京与苏州-两处不相连.geojson`,
  feature(multi([box(118.76, 32.0, 118.84, 32.06)], [box(120.56, 31.28, 120.66, 31.34)]), { name: '两处' })
);
json(
  `${A}/A06-南京主城-带洞.geojson`,
  polygon(box(118.7, 31.95, 118.95, 32.15), box(118.78, 32.05, 118.82, 32.09).toReversed())
);
json(
  `${A}/A07-沿江八市-大范围.geojson`,
  collection([
    feature(
      polygon([
        [118.6, 31.9],
        [119.4, 32.05],
        [120.0, 31.85],
        [120.9, 31.68],
        [121.05, 31.85],
        [121.0, 32.05],
        [120.4, 32.15],
        [119.9, 32.3],
        [119.4, 32.45],
        [118.7, 32.3],
        [118.6, 31.9]
      ]),
      { name: '沿江' }
    )
  ])
);
const suzhou = city.features.find(item => item.properties.name === '苏州市');
json(`${A}/A08-苏州市全域-精确市界.geojson`, collection([suzhou]), false);
json(`${A}/A09-江苏全省.geojson`, province, false);
json(`${A}/A10-跨省-一部分在安徽.geojson`, collection([feature(polygon(box(118.3, 31.85, 118.65, 32.1)))]));
json(
  `${A}/A11-扬州到镇江-细长带.geojson`,
  collection([
    feature(
      polygon([
        [119.43, 32.42],
        [119.4315, 32.42],
        [119.4515, 32.0],
        [119.45, 32.0],
        [119.43, 32.42]
      ])
    )
  ])
);
json(
  `${A}/A12-蝴蝶结-自相交.geojson`,
  collection([
    feature(
      polygon([
        [119.9, 31.7],
        [120.1, 31.9],
        [120.1, 31.7],
        [119.9, 31.9],
        [119.9, 31.7]
      ])
    )
  ])
);
json(
  `${A}/A13-两个面互相重叠.geojson`,
  collection([feature(polygon(box(119.9, 31.5, 120.1, 31.65))), feature(polygon(box(120.0, 31.55, 120.2, 31.7)))])
);
json(
  `${A}/A14-混合要素-面点线和空几何.geojson`,
  collection([
    feature(polygon(box(120.25, 31.5, 120.4, 31.62)), { name: '面' }),
    feature({ type: 'Point', coordinates: [120.3, 31.55] }, { name: '点' }),
    feature(
      {
        type: 'LineString',
        coordinates: [
          [120.2, 31.5],
          [120.45, 31.6]
        ]
      },
      { name: '线' }
    ),
    { type: 'Feature', properties: { name: '空几何' }, geometry: null }
  ])
);
json(
  `${A}/A15-高精度圆形-3万个节点.geojson`,
  collection([feature(polygon(roundDeep(circle(119.42, 32.39, 0.08, 30000))))]),
  false
);
json(
  `${A}/A16-声明了EPSG4490.geojson`,
  collection([feature(polygon(box(120.85, 31.95, 121.0, 32.08)))], {
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4490' } }
  })
);

// ---------- Shapefile ----------

const signedArea = (ring: Point[]) =>
  ring.reduce((sum, [x, y], index) => {
    const [nx, ny] = ring[(index + 1) % ring.length];
    return sum + (x * ny - nx * y);
  }, 0) / 2;
// Shapefile 的外环顺时针、洞逆时针
const orient = (ring: Point[], clockwise: boolean) => ((signedArea(ring) < 0) === clockwise ? ring : ring.toReversed());

function bboxOf(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function shapefile<T extends keyof ShapeRecord>(type: T, records: ShapeRecord[T][], transform: Transform = point => point) {
  const contents = records.map(record => {
    if (type === 1) {
      const [x, y] = transform(record as ShapeRecord[1]);
      const buffer = Buffer.alloc(20);
      buffer.writeInt32LE(1, 0);
      buffer.writeDoubleLE(x, 4);
      buffer.writeDoubleLE(y, 12);
      return { buffer, points: [[x, y] as Point] };
    }
    const parts =
      type === 5
        ? (record as ShapeRecord[5]).flatMap(rings => rings.map((ring, index) => orient(ring.map(transform), index === 0)))
        : (record as ShapeRecord[3]).map(line => line.map(transform));
    const points = parts.flat();
    const buffer = Buffer.alloc(44 + 4 * parts.length + 16 * points.length);
    buffer.writeInt32LE(type, 0);
    bboxOf(points).forEach((value, index) => buffer.writeDoubleLE(value, 4 + index * 8));
    buffer.writeInt32LE(parts.length, 36);
    buffer.writeInt32LE(points.length, 40);
    let start = 0;
    parts.forEach((part, index) => {
      buffer.writeInt32LE(start, 44 + index * 4);
      start += part.length;
    });
    points.forEach(([x, y], index) => {
      const offset = 44 + 4 * parts.length + index * 16;
      buffer.writeDoubleLE(x, offset);
      buffer.writeDoubleLE(y, offset + 8);
    });
    return { buffer, points };
  });
  const header = (length: number, all: Point[]) => {
    const buffer = Buffer.alloc(100);
    buffer.writeInt32BE(9994, 0);
    buffer.writeInt32BE(length / 2, 24);
    buffer.writeInt32LE(1000, 28);
    buffer.writeInt32LE(type, 32);
    bboxOf(all).forEach((value, index) => buffer.writeDoubleLE(value, 36 + index * 8));
    return buffer;
  };
  const all = contents.flatMap(content => content.points);
  const shpLength = 100 + contents.reduce((sum, content) => sum + 8 + content.buffer.length, 0);
  const shp = [header(shpLength, all)];
  const shx = [header(100 + 8 * contents.length, all)];
  let offset = 100;
  contents.forEach((content, index) => {
    const recordHeader = Buffer.alloc(8);
    recordHeader.writeInt32BE(index + 1, 0);
    recordHeader.writeInt32BE(content.buffer.length / 2, 4);
    shp.push(recordHeader, content.buffer);
    const entry = Buffer.alloc(8);
    entry.writeInt32BE(offset / 2, 0);
    entry.writeInt32BE(content.buffer.length / 2, 4);
    shx.push(entry);
    offset += 8 + content.buffer.length;
  });
  return { shp: Buffer.concat(shp), shx: Buffer.concat(shx) };
}

function dbf(names: string[]) {
  const width = 50;
  const headerLength = 65;
  const recordLength = 1 + width;
  const buffer = Buffer.alloc(headerLength + recordLength * names.length + 1, 0);
  buffer[0] = 0x03;
  buffer[1] = 126;
  buffer[2] = 11;
  buffer[3] = 1;
  buffer.writeUInt32LE(names.length, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  buffer.write('NAME', 32, 'ascii');
  buffer[43] = 0x43;
  buffer[48] = width;
  buffer[64] = 0x0d;
  names.forEach((name, index) => {
    const offset = headerLength + index * recordLength;
    buffer.fill(0x20, offset, offset + recordLength);
    Buffer.from(name, 'utf8').copy(buffer, offset + 1, 0, width);
  });
  buffer[buffer.length - 1] = 0x1a;
  return buffer;
}

const GCS_CGCS2000 =
  'GEOGCS["GCS_China_Geodetic_Coordinate_System_2000",DATUM["D_China_2000",SPHEROID["CGCS2000",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const gk = (name: string, falseEasting: string) =>
  `PROJCS["${name}",${GCS_CGCS2000},PROJECTION["Gauss_Kruger"],PARAMETER["False_Easting",${falseEasting}],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",120.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
const GK_ZONE_40 = gk('CGCS2000_3_Degree_GK_Zone_40', '40500000.0');
const GK_CM_120 = gk('CGCS2000_3_Degree_GK_CM_120E', '500000.0');
const forward = (wkt: string): Transform => {
  const projection = proj4(wkt);
  return point => projection.forward(point);
};

/** 一组 Shapefile 的文件：{ 'name.shp': bytes, ... }；prj 传 null 表示不带坐标系文件 */
function layer<T extends keyof ShapeRecord>(
  name: string,
  type: T,
  records: ShapeRecord[T][],
  { prj = GCS_CGCS2000, names, transform }: { prj?: string | null; names?: string[]; transform?: Transform } = {}
) {
  const { shp, shx } = shapefile(type, records, transform);
  const files: Files = {
    [`${name}.shp`]: shp,
    [`${name}.shx`]: shx,
    [`${name}.dbf`]: dbf(names ?? records.map((_, index) => `${name}${index + 1}`)),
    [`${name}.cpg`]: Buffer.from('UTF-8')
  };
  if (prj) {
    files[`${name}.prj`] = Buffer.from(prj);
  }
  return files;
}
const zip = (path: string, files: Files) => {
  write(path, zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, new Uint8Array(bytes)]))));
};
const folder = (path: string, files: Files) => {
  for (const [name, bytes] of Object.entries(files)) {
    write(`${path}/${name}`, bytes);
  }
};

const B = 'B-Shapefile';
zip(
  `${B}/B01-无锡-CGCS2000经纬度.zip`,
  layer('wuxi', 5, [[[box(120.25, 31.45, 120.42, 31.58)]], [[box(120.45, 31.52, 120.6, 31.65)]]], {
    names: ['无锡西片', '无锡东片']
  })
);
folder(
  `${B}/B02-常州-分开的文件（全选后上传）`,
  layer('常州武进', 5, [[[box(119.85, 31.6, 120.05, 31.75), box(119.92, 31.65, 119.97, 31.7)]]])
);
zip(
  `${B}/B03-苏州-投影坐标-3度带第40带.zip`,
  layer('suzhou_gk40', 5, [[[box(120.5, 31.2, 120.75, 31.4)]]], { prj: GK_ZONE_40, transform: forward(GK_ZONE_40) })
);
zip(
  `${B}/B04-南通-投影坐标-中央经线120度.zip`,
  layer('nantong_cm120', 5, [[[box(120.8, 32.0, 121.0, 32.15)]]], { prj: GK_CM_120, transform: forward(GK_CM_120) })
);
zip(`${B}/B05-泰州-没有prj-经纬度.zip`, layer('taizhou', 5, [[[box(119.85, 32.4, 120.05, 32.55)]]], { prj: null }));
zip(`${B}/B06-多图层-面和点-嵌套文件夹.zip`, {
  ...Object.fromEntries(
    Object.entries(layer('范围', 5, [[[box(119.35, 32.3, 119.5, 32.45)]]])).map(([name, bytes]) => [
      `扬州数据/${name}`,
      bytes
    ])
  ),
  ...Object.fromEntries(
    Object.entries(
      layer('站点', 1, [
        [119.4, 32.35],
        [119.45, 32.4]
      ])
    ).map(([name, bytes]) => [`扬州数据/${name}`, bytes])
  ),
  '__MACOSX/扬州数据/._范围.shp': Buffer.from('junk')
});
zip(`${B}/B07-压缩包里是GeoJSON.zip`, {
  '盐城.geojson': Buffer.from(JSON.stringify(collection([feature(polygon(box(120.05, 33.3, 120.25, 33.45)))])))
});

// ---------- C 不能使用的文件 ----------

const C = 'C-异常';
const valid = JSON.stringify(collection([feature(polygon(box(119.0, 32.0, 119.1, 32.08)))]), null, 2);
write(`${C}/C01-不是JSON-内容被截断.geojson`, valid.slice(0, Math.floor(valid.length * 0.6)));
write(`${C}/C02-空文件.geojson`, '');
json(`${C}/C03-不是GeoJSON.json`, { name: '范围', points: [1, 2, 3] });
json(`${C}/C04-没有要素.geojson`, collection([]));
json(
  `${C}/C05-只有点和线.geojson`,
  collection([
    feature({ type: 'Point', coordinates: [119.0, 32.0] }),
    feature({
      type: 'LineString',
      coordinates: [
        [119.0, 32.0],
        [119.1, 32.1]
      ]
    })
  ])
);
json(
  `${C}/C06-坐标结构错误.geojson`,
  collection([feature(polygon(box(119.0, 32.0, 119.1, 32.08).map(([x, y]) => [String(x), String(y)])))])
);
const toGk40 = forward(GK_ZONE_40);
json(
  `${C}/C07-投影坐标-没有声明坐标系.geojson`,
  collection([feature(polygon(box(120.5, 31.2, 120.75, 31.4).map(point => toGk40(point).map(value => Math.round(value)))))])
);
json(
  `${C}/C08-声明了投影坐标系EPSG4528.geojson`,
  collection([feature(polygon(box(120.5, 31.2, 120.75, 31.4)))], {
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4528' } }
  })
);
json(`${C}/C09-经纬度颠倒.geojson`, collection([feature(polygon(box(119.0, 32.0, 119.1, 32.08).map(([x, y]) => [y, x])))]));
json(`${C}/C10-范围在省外-合肥.geojson`, collection([feature(polygon(box(117.2, 31.75, 117.35, 31.9)))]));
json(`${C}/C11-面积不足1公顷.geojson`, collection([feature(polygon(box(119.0, 32.0, 119.0005, 32.00045)))]));
json(`${C}/C12-面积超过15万平方千米.geojson`, collection([feature(polygon(box(113, 27, 124, 37)))]));
json(
  `${C}/C13-少于3个节点.geojson`,
  collection([
    feature(
      polygon([
        [119.0, 32.0],
        [119.1, 32.1],
        [119.0, 32.0]
      ])
    )
  ])
);
json(
  `${C}/C14-节点在一条直线上.geojson`,
  collection([
    feature(
      polygon([
        [119.0, 32.0],
        [119.05, 32.0],
        [119.1, 32.0],
        [119.0, 32.0]
      ])
    )
  ])
);
json(
  `${C}/C15-节点超过50万（约13MB）.geojson`,
  collection([feature(polygon(roundDeep(circle(119.42, 32.39, 0.05, 520000))))]),
  false
);
write(`${C}/C16-超过50MB.geojson`, `${valid}${' '.repeat(51 * 1024 * 1024)}`);
write(
  `${C}/C17-不支持的格式.kml`,
  '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>范围</name></Placemark></kml>'
);
zip(
  `${C}/C18-线图层.zip`,
  layer('river', 3, [
    [
      [
        [119.0, 32.0],
        [119.2, 32.1]
      ]
    ]
  ])
);
zip(
  `${C}/C19-投影坐标-缺少prj.zip`,
  layer('noprj_gk40', 5, [[[box(120.5, 31.2, 120.75, 31.4)]]], { prj: null, transform: toGk40 })
);
zip(`${C}/C20-压缩包里没有shp.zip`, {
  'range.dbf': dbf(['范围']),
  'readme.txt': Buffer.from('只有属性表')
});
write(`${C}/C21-损坏的压缩包.zip`, Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) % 256)));
write(`${C}/C22-解压后超过200MB.zip`, zipSync({ 'big.shp': new Uint8Array(210 * 1024 * 1024) }, { level: 9 }));
const cut = layer('截断', 5, [[[box(119.0, 32.0, 119.1, 32.08)]], [[box(119.2, 32.0, 119.3, 32.08)]]]);
folder(`${C}/C23-截断的shp（全选后上传）`, {
  '截断.shp': cut['截断.shp'].subarray(0, Math.floor(cut['截断.shp'].length * 0.6)),
  '截断.prj': cut['截断.prj']
});
const plot = layer('地块', 5, [[[box(119.0, 32.0, 119.1, 32.08)]]]);
folder(`${C}/C24-文件名不一致（全选后上传）`, {
  '地块.shp': plot['地块.shp'],
  '地块.dbf': plot['地块.dbf'],
  '范围.prj': plot['地块.prj']
});
folder(`${C}/C25-两组shp（全选后上传）`, {
  ...layer('甲', 5, [[[box(119.0, 32.0, 119.1, 32.08)]]]),
  ...layer('乙', 5, [[[box(119.2, 32.0, 119.3, 32.08)]]])
});
folder(`${C}/C26-只有dbf和prj（全选后上传）`, {
  '地块.dbf': plot['地块.dbf'],
  '地块.prj': plot['地块.prj']
});

console.log(`[scope-files] 已生成：${out}`);
