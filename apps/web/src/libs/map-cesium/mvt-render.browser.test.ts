import type { LayerSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { DecodedTile, TileCoordinate } from '@yzt/map-core/worker';
import { describe, expect, it } from 'vitest';
import { renderMvt } from './mvt-render';
import { compileStylePlan } from './style-plan';

const SOURCE: VectorSourceSpecification = { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] };

// 直接验证真正 OffscreenCanvas 的像素，下载与消息传输在 Worker 集成测试里覆盖
async function pixels(
  specification: LayerSpecification,
  data: DecodedTile,
  tile: TileCoordinate = { z: 0, x: 0, y: 0 },
  cameraZoom = tile.z
): Promise<OffscreenCanvasRenderingContext2D> {
  const layer = compileStylePlan({ version: 8, sources: { data: SOURCE }, layers: [specification] }).layers[0];
  const signal = new AbortController().signal;
  const bitmap = await renderMvt({
    data, layer, source: SOURCE, coordinate: { z: 0, x: 0, y: 0 }, tile, cameraZoom,
    context: { signal, checkpoint: async () => signal.throwIfAborted() }
  });
  try {
    const context = new OffscreenCanvas(512, 512).getContext('2d');
    if (!context) { throw new Error('测试需要 OffscreenCanvas'); }
    context.drawImage(bitmap, 0, 0);
    return context;
  } finally {
    bitmap.close();
  }
}

function ring(...points: number[]): Int32Array { return new Int32Array(points); }

function opaqueWidth(context: OffscreenCanvasRenderingContext2D, y: number): number {
  const row = context.getImageData(0, y, 512, 1).data;
  let count = 0;
  for (let x = 0; x < 512; x++) { if (row[x * 4 + 3] > 127) { count++; } }
  return count;
}

describe('MVT OffscreenCanvas 画面', () => {
  it('非默认 extent 的面保留孔洞与多个外环，重叠面分别合成透明度', async () => {
    const outer = ring(1024, 1024, 7168, 1024, 7168, 7168, 1024, 7168, 1024, 1024);
    const hole = ring(3072, 3072, 3072, 5120, 5120, 5120, 5120, 3072, 3072, 3072);
    const second = ring(1536, 1536, 2560, 1536, 2560, 2560, 1536, 2560, 1536, 1536);
    const data: DecodedTile = { bytes: 1, layers: { land: { extent: 8192, features: [{
      type: 3, properties: {}, geometry: [outer, hole, second], polygons: [[outer, hole], [second]]
    }] } } };
    const context = await pixels({
      id: 'fill', type: 'fill', source: 'data', 'source-layer': 'land',
      paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.5 }
    }, data);
    expect([...context.getImageData(256, 256, 1, 1).data]).toEqual([0, 0, 0, 0]);
    expect(context.getImageData(80, 80, 1, 1).data[3]).toBeCloseTo(128, 0);
    expect(context.getImageData(128, 128, 1, 1).data[3]).toBeGreaterThan(180);
  });

  it('原始 buffer 路径穿过两个显示子瓦片时接缝处宽度和透明度一致', async () => {
    const data: DecodedTile = { bytes: 1, layers: { road: { extent: 8192, features: [{
      type: 2, properties: {}, geometry: [ring(-1024, 2048, 9216, 2048)]
    }] } } };
    const specification: LayerSpecification = {
      id: 'line', type: 'line', source: 'data', 'source-layer': 'road',
      layout: { 'line-cap': 'round' }, paint: { 'line-color': '#00ff00', 'line-width': 10 }
    };
    const [left, right] = await Promise.all([
      pixels(specification, data, { z: 1, x: 0, y: 0 }),
      pixels(specification, data, { z: 1, x: 1, y: 0 })
    ]);
    expect([...left.getImageData(511, 256, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect([...right.getImageData(0, 256, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(left.getImageData(511, 249, 1, 1).data[3]).toBe(0);
    expect(right.getImageData(0, 249, 1, 1).data[3]).toBe(0);
  });

  it('放大父矢量时重新画点，画布半径随显示瓦片级别补偿', async () => {
    const data: DecodedTile = { bytes: 1, layers: { places: { extent: 8192, features: [{
      type: 1, properties: {}, geometry: [ring(5120, 2560)]
    }] } } };
    const specification: LayerSpecification = {
      id: 'circle', type: 'circle', source: 'data', 'source-layer': 'places',
      paint: { 'circle-color': '#0000ff', 'circle-radius': 10 }
    };
    const [near, child] = await Promise.all([
      pixels(specification, data, { z: 1, x: 1, y: 0 }, 1),
      pixels(specification, data, { z: 2, x: 2, y: 1 }, 1)
    ]);
    expect(opaqueWidth(near, 320)).toBe(20);
    expect(opaqueWidth(child, 128)).toBe(40);
  });
});
