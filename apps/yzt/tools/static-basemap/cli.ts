import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  STATIC_CITY_LINE_COLOR,
  STATIC_LAND_COLOR,
  STATIC_OUTSIDE_COLOR
} from '../../src/shared/map/basemap/static-palette.ts';
import { labelCollection, type RegionCollection, thumbnailSvg } from './generate.ts';

// 由边界数据生成静态底图的地名点和缩略图：在 apps/yzt 下运行 pnpm basemap:generate（ADR 0133、0134）
const dataDir = resolve(process.cwd(), 'src/shared/map/boundary/data');
const outputDir = resolve(process.cwd(), 'src/shared/map/basemap');
const read = (name: string) => JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')) as RegionCollection;

const cities = read('jiangsu-city.json');
const counties = read('jiangsu-county.json');

const outputs = {
  'data/jiangsu-labels.json': JSON.stringify(labelCollection(cities, counties)),
  'images/static-thumbnail.svg': thumbnailSvg(cities, {
    landColor: STATIC_LAND_COLOR,
    outsideColor: STATIC_OUTSIDE_COLOR,
    lineColor: STATIC_CITY_LINE_COLOR
  })
};

for (const [name, content] of Object.entries(outputs)) {
  const path = resolve(outputDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`[static-basemap] ${name}：${(Buffer.byteLength(content) / 1024).toFixed(1)} KB`);
}
