import type { FillLayerSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImage } from '@yzt/map-core/worker';
import { describe, expect, it } from 'vitest';
import { mvtFixtureUrl } from './mvt-fixture';
import { createMvtProvider, type MvtProvider } from './mvt-provider';
import { MvtWorkerPool } from './mvt-worker-pool';
import { compileStylePlan } from './style-plan';

// 必须经过真实 Worker 消息往返，主线程快照中的像素缓冲区不能被 transfer 剥离
function provider(pool: MvtWorkerPool, source: VectorSourceSpecification, image: StyleImage, color = '#ff0000') {
  const layer: FillLayerSpecification = {
    id: 'pattern', type: 'fill', source: 'sample', 'source-layer': 'landuse',
    paint: { 'fill-pattern': 'sample-pattern', 'fill-color': color, 'fill-antialias': false }
  };
  const plan = compileStylePlan({ version: 8, sources: { sample: source }, layers: [layer] }, { 'sample-pattern': image });
  expect(plan.issues).toEqual([]);
  return createMvtProvider(plan.layers[0], 0, pool);
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      promise.then(value => ({ ready: true as const, value })),
      new Promise<{ readonly ready: false }>(resolve => { timer = setTimeout(() => resolve({ ready: false }), 15000); })
    ]);
    expect(result.ready).toBe(true);
    if (!result.ready) { throw new Error('Worker 没有完成本地花纹任务'); }
    return result.value;
  } finally {
    clearTimeout(timer);
  }
}

async function tile(imagery: MvtProvider): Promise<CanvasRenderingContext2D> {
  const image = await bounded(Promise.resolve(imagery.requestImage(0, 0, 0)));
  expect(image).toBeInstanceOf(HTMLCanvasElement);
  const context = (image as HTMLCanvasElement).getContext('2d');
  if (!context) { throw new Error('测试需要二维画布'); }
  return context;
}

function solidImage(color: readonly [number, number, number, number]): StyleImage {
  return { width: 4, height: 4, pixelRatio: 2, data: new Uint8Array(Array.from({ length: 16 }, () => color).flat()) };
}

describe('MVT Worker 花纹图片所有权', () => {
  it('RGBA 图片完整往返，相同 ID 换像素立即生效并复用瓦片数据缓存', async () => {
    const source: VectorSourceSpecification = { type: 'vector', tiles: [mvtFixtureUrl()], maxzoom: 0 };
    using pool = new MvtWorkerPool({ workerCount: 1 });
    const green = solidImage([0, 255, 0, 255]);
    const blue = solidImage([0, 0, 255, 255]);
    const original = green.data.slice();
    using first = provider(pool, source, green);
    expect([...(await tile(first)).getImageData(64, 64, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(green.data.byteLength).toBe(64);
    expect(green.data).toEqual(original);
    using changed = provider(pool, source, blue);
    expect([...(await tile(changed)).getImageData(64, 64, 1, 1).data]).toEqual([0, 0, 255, 255]);
    expect(blue.data.byteLength).toBe(64);
    expect(green.data).toEqual(original);
    // 原提供者仍持有原快照，图片替换不会把其他快照的内容一并改掉
    expect([...(await tile(first)).getImageData(64, 64, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect((await bounded(pool.stats()))[0]).toMatchObject({ downloads: 1, decodes: 1, hits: 2, inflight: 0 });
  }, 20000);

  it('SDF 距离场在 Worker 中按颜色着色，透明间隙、孔洞和主线程原图保持完整', async () => {
    const source: VectorSourceSpecification = { type: 'vector', tiles: [mvtFixtureUrl()], maxzoom: 0 };
    using pool = new MvtWorkerPool({ workerCount: 1 });
    const image: StyleImage = {
      width: 8, height: 2, sdf: true,
      data: new Uint8Array(Array.from({ length: 16 }, (_, index) => [255, 255, 255, index % 8 < 4 ? 255 : 0]).flat())
    };
    const original = image.data.slice();
    using red = provider(pool, source, image);
    const first = await tile(red);
    expect([...first.getImageData(66, 64, 1, 1).data]).toEqual([255, 0, 0, 255]);
    expect(first.getImageData(70, 64, 1, 1).data[3]).toBe(0);
    expect(first.getImageData(226, 240, 1, 1).data[3]).toBe(0);
    using green = provider(pool, source, image, 'rgba(0,255,0,0.5)');
    expect([...(await tile(green)).getImageData(66, 64, 1, 1).data]).toEqual([0, 255, 0, 128]);
    expect(image.data.byteLength).toBe(64);
    expect(image.data).toEqual(original);
    expect((await bounded(pool.stats()))[0]).toMatchObject({ downloads: 1, decodes: 1, hits: 1 });
  }, 20000);
});
