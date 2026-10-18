import type { FillLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Cartographic, GeographicTilingScheme, type ImageryProvider } from 'cesium';
import type { GeoJSON, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { createGeoJsonProvider } from './geojson-provider';
import { compileStylePlan } from './style-plan';

const WORLD: Position[] = [
  [-180, -85.051129], [180, -85.051129], [180, 85.051129], [-180, 85.051129], [-180, -85.051129]
];

function ring(west: number, south: number, east: number, north: number): Position[] {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

function provider(data: GeoJSON, paint: FillLayerSpecification['paint'] = {}): ImageryProvider {
  const plan = compileStylePlan({
    version: 8, sources: { mask: { type: 'geojson', data } },
    layers: [{ id: 'mask', type: 'fill', source: 'mask',
      paint: { 'fill-color': '#f3f5f8', 'fill-antialias': false, ...paint } }]
  });
  expect(plan.issues).toEqual([]);
  return createGeoJsonProvider(plan.layers[0], 0);
}

async function tile(imagery: ImageryProvider, x = 1, y = 0, level = 0): Promise<HTMLCanvasElement> {
  const result = await imagery.requestImage(x, y, level);
  expect(result).toBeInstanceOf(HTMLCanvasElement);
  return result as HTMLCanvasElement;
}

function pixel(canvas: HTMLCanvasElement, longitude: number, latitude: number, tileX = 1, tileY = 0, level = 0) {
  const bounds = new GeographicTilingScheme().tileXYToRectangle(tileX, tileY, level);
  const position = Cartographic.fromDegrees(longitude, latitude);
  const x = Math.min(511, Math.max(0, Math.floor((position.longitude - bounds.west) / (bounds.east - bounds.west) * 512)));
  const y = Math.min(511, Math.max(0, Math.floor((bounds.north - position.latitude) / (bounds.north - bounds.south) * 512)));
  return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

describe('全球区划遮罩的真实影像', () => {
  it('世界补集覆盖两极和远处，区划、洞、洞中岛及更深一层保持奇偶语义', async () => {
    const imagery = provider({ type: 'MultiPolygon', coordinates: [
      [WORLD, ring(20, -20, 80, 40)],
      [ring(30, -10, 50, 10), ring(35, -5, 45, 5)],
      [ring(38, -2, 42, 2)]
    ] });
    expect(imagery.rectangle.north).toBe(Math.PI / 2);
    expect(imagery.rectangle.south).toBe(-Math.PI / 2);
    const image = await tile(imagery);
    expect(pixel(image, 100, 0)).toEqual([243, 245, 248, 255]);
    expect(pixel(image, 25, 0)[3]).toBe(0);
    expect(pixel(image, 32, 0)).toEqual([243, 245, 248, 255]);
    expect(pixel(image, 36, 0)[3]).toBe(0);
    expect(pixel(image, 40, 0)).toEqual([243, 245, 248, 255]);
    expect(pixel(image, 40, 89.9)).toEqual([243, 245, 248, 255]);
    expect(pixel(image, 40, -89.9)).toEqual([243, 245, 248, 255]);
    expect(pixel(await tile(imagery, 0), -179.9, 30, 0)).toEqual([243, 245, 248, 255]);
    expect(pixel(image, 179.9, 30)).toEqual([243, 245, 248, 255]);
  });

  it('经度零点两侧的孔洞连续，硬覆盖不留下半透明接缝或边缘像素', async () => {
    const imagery = provider({ type: 'Polygon', coordinates: [WORLD, ring(-10.2, -10.2, 10.2, 10.2)] });
    const left = await tile(imagery, 0);
    const right = await tile(imagery, 1);
    expect(pixel(left, -0.01, 0, 0)[3]).toBe(0);
    expect(pixel(right, 0.01, 0)[3]).toBe(0);
    expect(pixel(left, -0.01, 20, 0)[3]).toBe(255);
    expect(pixel(right, 0.01, 20)[3]).toBe(255);
    const pixels = right.getContext('2d')!.getImageData(0, 0, 512, 512).data;
    expect(new Set(pixels.filter((_value, index) => index % 4 === 3))).toEqual(new Set([0, 255]));
  });

  it('颜色alpha与fill-opacity相乘，不把半透明样式错误二值化，图层过滤仍生效', async () => {
    const imagery = provider({ type: 'Polygon', coordinates: [WORLD, ring(20, 0, 30, 10)] }, {
      'fill-color': 'rgba(255,0,0,0.5)', 'fill-opacity': 0.5
    });
    const image = await tile(imagery);
    expect(pixel(image, 40, 0)).toEqual([255, 0, 0, 64]);
    expect(pixel(image, 25, 5)[3]).toBe(0);
    const plan = compileStylePlan({ version: 8, sources: { mask: { type: 'geojson', data: {
      type: 'Feature', id: 7, properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD] }
    } } }, layers: [{ id: 'mask', type: 'fill', source: 'mask', filter: ['==', ['id'], 8],
      paint: { 'fill-antialias': false } }] });
    expect(pixel(await tile(createGeoJsonProvider(plan.layers[0], 0)), 40, 0)[3]).toBe(0);
  });

  it('世界外环本身不收缩；非法洞与仍不支持的普通跨经线数据明确失败', () => {
    expect(() => provider({ type: 'Polygon', coordinates: [WORLD, ring(179, 0, -179, 10)] }))
      .toThrow('跨 180°');
    expect(() => provider({ type: 'Polygon', coordinates: [WORLD, ring(10, 84, 20, 89)] }))
      .toThrow('Web Mercator');
    expect(() => provider({ type: 'Polygon', coordinates: [ring(179, 0, -179, 10)] })).toThrow('跨 180°');
  });
});
