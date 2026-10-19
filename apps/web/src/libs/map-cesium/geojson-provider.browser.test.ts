import { Cartesian3, WebMercatorProjection, WebMercatorTilingScheme, type ImageryProvider } from 'cesium';
import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GeoJSON, Position } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { createGeoJsonProvider } from './geojson-provider';
import { compileStylePlan } from './style-plan';

const EMPTY: GeoJSON = { type: 'FeatureCollection', features: [] };

// 用 SDK 的逆投影将第零级世界像素转为经纬度，测试不重复实现墨卡托公式
function position(x: number, y: number): Position {
  const tiling = new WebMercatorTilingScheme();
  const bounds = tiling.tileXYToNativeRectangle(0, 0, 0);
  const point = new WebMercatorProjection().unproject(new Cartesian3(
    bounds.west + x / 512 * (bounds.east - bounds.west),
    bounds.north - y / 512 * (bounds.north - bounds.south)
  ));
  return [point.longitude * 180 / Math.PI, point.latitude * 180 / Math.PI];
}

function ring(left: number, top: number, right: number, bottom: number): Position[] {
  return [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]
    .map(([x, y]) => position(x, y));
}

function provider(layer: LayerSpecification, data: GeoJSON = EMPTY, zoom = 0): ImageryProvider {
  const plan = compileStylePlan({ version: 8, sources: { data: { type: 'geojson', data } }, layers: [layer] });
  expect(plan.issues).toEqual([]);
  return createGeoJsonProvider(plan.layers[0], zoom);
}

// requestImage 的实现无异步请求，直接读取返回画布的实际像素
async function tile(imagery: ImageryProvider, x = 0, y = 0, level = 0): Promise<HTMLCanvasElement> {
  const image = await imagery.requestImage(x, y, level);
  expect(image).toBeInstanceOf(HTMLCanvasElement);
  return image as HTMLCanvasElement;
}

function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
}

function opaqueSpan(canvas: HTMLCanvasElement, fixed: number, vertical = false): number {
  let count = 0;
  for (let index = 0; index < canvas.width; index += 1) {
    if (pixel(canvas, vertical ? fixed : index, vertical ? index : fixed)[3] > 127) {
      count += 1;
    }
  }
  return count;
}

describe('GeoJSON 透明瓦片真实画布', () => {
  it('没有匹配几何的层复用单像素透明纹理，保持瓦片级别与层身份', async () => {
    const imagery = provider({ id: 'empty', type: 'circle', source: 'data' }, {
      type: 'LineString', coordinates: [position(100, 200), position(200, 200)]
    });
    const first = await tile(imagery);
    const next = await tile(imagery, 1, 1, 1);
    expect(imagery.tileWidth).toBe(512);
    expect(imagery.maximumLevel).toBe(0);
    expect(first.width).toBe(1);
    expect(first.height).toBe(1);
    expect(next).toBe(first);
    expect(pixel(first, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('画布创建失败返回被拒绝的 Promise，不同步打断 SDK 渲染循环', async () => {
    const imagery = provider({ id: 'background', type: 'background' });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      let image: ReturnType<ImageryProvider['requestImage']>;
      expect(() => { image = imagery.requestImage(0, 0, 0); }).not.toThrow();
      expect(image).toBeInstanceOf(Promise);
      await expect(image).rejects.toThrow('无法创建三维样式的二维画布');
    } finally {
      getContext.mockRestore();
    }
  });

  it('背景颜色 alpha 与 opacity 相乘，隐藏层返回透明瓦片', async () => {
    const background = provider({
      id: 'background', type: 'background',
      paint: { 'background-color': 'rgba(255,0,0,0.5)', 'background-opacity': 0.5 }
    });
    const image = await tile(background);
    expect(background.rectangle.north).toBe(Math.PI / 2);
    expect(background.rectangle.south).toBe(-Math.PI / 2);
    expect(background.maximumLevel).toBe(0);
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 64]);
    expect(await tile(background, 1, 0, 0)).toBe(image);
    const hidden = await tile(provider({ id: 'hidden', type: 'background', layout: { visibility: 'none' } }));
    expect(pixel(hidden, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('缩放样式改变后替换纯色提供者，重新求值颜色与透明度', async () => {
    const layer: LayerSpecification = {
      id: 'background-zoom', type: 'background', paint: {
        'background-color': ['step', ['zoom'], 'rgba(255,0,0,0.5)', 1, 'rgba(0,0,255,0.5)'],
        'background-opacity': ['step', ['zoom'], 0.5, 1, 1]
      }
    };
    const low = provider(layer, EMPTY, 0);
    const high = provider(layer, EMPTY, 1);
    expect(low.maximumLevel).toBe(0);
    expect(high.maximumLevel).toBe(0);
    expect(pixel(await tile(low), 0, 0)).toEqual([255, 0, 0, 64]);
    expect(pixel(await tile(high), 0, 0)).toEqual([0, 0, 255, 128]);
  });

  it('逐个 Polygon 填充孔洞，半透明重叠区不会被 evenodd 挖空', async () => {
    const image = await tile(provider({
      id: 'areas', type: 'fill', source: 'data',
      paint: { 'fill-color': 'rgba(0,128,255,0.5)', 'fill-opacity': 0.5 }
    }, {
      type: 'MultiPolygon', coordinates: [
        [ring(150, 150, 350, 350), ring(220, 220, 280, 280)],
        [ring(300, 250, 400, 350)]
      ]
    }));
    expect(pixel(image, 200, 200)).toEqual([0, 128, 255, 64]);
    expect(pixel(image, 250, 250)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 330, 300)[3]).toBe(112);
    expect(pixel(image, 420, 300)[3]).toBe(0);
  });

  it('FeatureCollection 与 GeometryCollection 保留属性和身份，过滤与 match 使用简单几何类型', async () => {
    const image = await tile(provider({
      id: 'points', type: 'circle', source: 'data',
      filter: ['all', ['==', ['id'], 7], ['==', ['geometry-type'], 'Point']],
      paint: { 'circle-radius': 10, 'circle-color': ['match', ['get', 'category'], 'water', 'blue', 'red'] }
    }, {
      type: 'FeatureCollection', features: [
        {
          type: 'Feature', id: 7, properties: { category: 'water' },
          geometry: { type: 'GeometryCollection', geometries: [
            { type: 'MultiPoint', coordinates: [position(100, 200), position(200, 200)] },
            { type: 'LineString', coordinates: [position(100, 300), position(200, 300)] }
          ] }
        },
        {
          type: 'Feature', id: 8, properties: { category: 'road' },
          geometry: { type: 'Point', coordinates: position(300, 200) }
        }
      ]
    }));
    expect(pixel(image, 100, 200)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 200, 200)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 300, 200)[3]).toBe(0);
    expect(pixel(image, 150, 300)[3]).toBe(0);
  });

  it('圆半径和外描边按 camera zoom 求值，瓦片层级改变后显示宽度相同', async () => {
    const imagery = provider({
      id: 'points', type: 'circle', source: 'data',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 2, 16],
        'circle-color': 'red', 'circle-stroke-color': 'green', 'circle-stroke-width': 4
      }
    }, { type: 'Point', coordinates: position(384, 384) });
    const low = await tile(imagery);
    const high = await tile(imagery, 1, 1, 1);
    expect(opaqueSpan(low, 384)).toBe(24);
    expect(opaqueSpan(high, 256)).toBe(48);
    expect(pixel(low, 384, 384)).toEqual([255, 0, 0, 255]);
    expect(pixel(low, 394, 384)).toEqual([0, 128, 0, 255]);
    expect(pixel(high, 276, 256)).toEqual([0, 128, 0, 255]);
    expect(pixel(high, 284, 256)[3]).toBe(0);
  });

  it('线宽使用相机级别且按瓦片比例换算，MultiLineString 不丢失', async () => {
    const imagery = provider({
      id: 'line', type: 'line', source: 'data',
      paint: { 'line-color': 'red', 'line-width': ['step', ['zoom'], 10, 1, 20] }
    }, { type: 'MultiLineString', coordinates: [
      [position(300, 384), position(450, 384)], [position(100, 200), position(200, 200)]
    ] });
    const low = await tile(imagery);
    const high = await tile(imagery, 1, 1, 1);
    expect(low.getContext('2d')!.getContextAttributes().willReadFrequently).toBe(true);
    expect(high.getContext('2d')!.getContextAttributes().willReadFrequently).toBe(true);
    expect(opaqueSpan(low, 384, true)).toBe(10);
    expect(opaqueSpan(high, 256, true)).toBe(20);
    expect(pixel(low, 150, 200)).toEqual([255, 0, 0, 255]);
  });

  it('零 miter limit 将尖角转成 bevel，正值和显式 round 保留各自连接形状', async () => {
    const data: GeoJSON = {
      type: 'LineString', coordinates: [position(220, 300), position(256, 200), position(292, 300)]
    };
    const image = (join: 'miter' | 'round', limit: number) => tile(provider({
      id: 'corner', type: 'line', source: 'data',
      layout: { 'line-join': join, 'line-miter-limit': limit },
      paint: { 'line-color': 'red', 'line-width': 20 }
    }, data));
    const bevel = await image('miter', 0);
    const miter = await image('miter', 4);
    const round = await image('round', 0);
    expect(pixel(bevel, 256, 180)[3]).toBe(0);
    expect(pixel(bevel, 256, 194)[3]).toBe(0);
    expect(pixel(bevel, 245, 230)).toEqual([255, 0, 0, 255]);
    expect(pixel(miter, 256, 180)).toEqual([255, 0, 0, 255]);
    expect(pixel(round, 256, 180)[3]).toBe(0);
    expect(pixel(round, 256, 194)).toEqual([255, 0, 0, 255]);
  });

  it('相机级别变化重建 provider 后表达式变化，瓦片层级本身不改变过滤和颜色', async () => {
    const layer: LayerSpecification = {
      id: 'zoom', type: 'circle', source: 'data', filter: ['>=', ['zoom'], 1],
      paint: { 'circle-radius': 8, 'circle-color': ['step', ['zoom'], 'red', 1, 'blue'] }
    };
    const data: GeoJSON = { type: 'Point', coordinates: position(384, 384) };
    const before = await tile(provider(layer, data, 0), 1, 1, 1);
    const after = await tile(provider(layer, data, 1), 1, 1, 1);
    expect(pixel(before, 256, 256)[3]).toBe(0);
    expect(pixel(after, 256, 256)).toEqual([0, 0, 255, 255]);
    expect(opaqueSpan(after, 256)).toBe(16);
  });

  it('相邻瓦片保留完整线段和跨边界孔洞，不生成假端点或填实孔洞', async () => {
    const line = provider({
      id: 'seam-line', type: 'line', source: 'data',
      layout: { 'line-cap': 'round' }, paint: { 'line-color': 'blue', 'line-width': 8 }
    }, { type: 'LineString', coordinates: [position(128, 128), position(384, 128)] });
    const left = await tile(line, 0, 0, 1);
    const right = await tile(line, 1, 0, 1);
    expect(pixel(left, 511, 256)).toEqual([0, 0, 255, 255]);
    expect(pixel(right, 0, 256)).toEqual([0, 0, 255, 255]);
    const fill = provider({ id: 'seam-hole', type: 'fill', source: 'data', paint: { 'fill-color': 'red' } }, {
      type: 'Polygon', coordinates: [ring(128, 64, 384, 192), ring(240, 100, 280, 160)]
    });
    const fillLeft = await tile(fill, 0, 0, 1);
    const fillRight = await tile(fill, 1, 0, 1);
    expect(pixel(fillLeft, 511, 256)[3]).toBe(0);
    expect(pixel(fillRight, 0, 256)[3]).toBe(0);
    expect(pixel(fillLeft, 511, 180)).toEqual([255, 0, 0, 255]);
    expect(pixel(fillRight, 0, 180)).toEqual([255, 0, 0, 255]);
  });

  it('几何在相邻瓦片内时，圆外描边、宽线、尖角和模糊仍能覆盖当前瓦片边缘', async () => {
    const circle = await tile(provider({
      id: 'outside-circle', type: 'circle', source: 'data',
      paint: { 'circle-radius': 2, 'circle-stroke-width': ['get', 'stroke'], 'circle-stroke-color': 'green' }
    }, { type: 'Feature', properties: { stroke: 8 }, geometry: {
      type: 'Point', coordinates: position(260, 128)
    } }), 0, 0, 1);
    expect(pixel(circle, 511, 256)).toEqual([0, 128, 0, 255]);

    const line: GeoJSON = { type: 'LineString', coordinates: [position(260, 100), position(260, 150)] };
    const wide = await tile(provider({
      id: 'outside-wide', type: 'line', source: 'data', paint: { 'line-color': 'blue', 'line-width': 12 }
    }, line), 0, 0, 1);
    expect(pixel(wide, 511, 256)).toEqual([0, 0, 255, 255]);

    const blurred = await tile(provider({
      id: 'outside-blur', type: 'line', source: 'data',
      paint: { 'line-color': 'red', 'line-width': 2, 'line-blur': 4 }
    }, line), 0, 0, 1);
    expect(pixel(blurred, 511, 256)[3]).toBeGreaterThan(0);

    const corner = await tile(provider({
      id: 'outside-miter', type: 'line', source: 'data', layout: { 'line-join': 'miter', 'line-miter-limit': 4 },
      paint: { 'line-color': 'red', 'line-width': 20 }
    }, { type: 'LineString', coordinates: [position(290, 116), position(260, 128), position(290, 140)] }), 0, 0, 1);
    expect(pixel(corner, 510, 256)).toEqual([255, 0, 0, 255]);
  });

  it('粗筛保留面抗锯齿描边越过瓦片边缘的像素', async () => {
    const fill = await tile(provider({
      id: 'outside-fill', type: 'fill', source: 'data', paint: { 'fill-color': 'red', 'fill-antialias': true }
    }, { type: 'Polygon', coordinates: [ring(256.2, 100, 280, 150)] }), 0, 0, 1);
    expect(pixel(fill, 511, 256)[3]).toBeGreaterThan(0);
  });

  it('面抗锯齿描边的默认尖角连接可以越过几何包围盒进入相邻瓦片', async () => {
    const fill = await tile(provider({
      id: 'outside-fill-miter', type: 'fill', source: 'data',
      paint: { 'fill-color': 'red', 'fill-antialias': true }
    }, { type: 'Polygon', coordinates: [[
      position(258.1, 128), position(280, 125.5), position(280, 130.5), position(258.1, 128)
    ]] }), 0, 0, 1);
    expect(pixel(fill, 511, 256)[3]).toBeGreaterThan(0);
  });

});
