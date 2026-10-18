import type { FillLayerSpecification, LayerSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import { createMvtFixture } from './mvt-fixture';
import { createMvtProvider, type MvtProvider } from './mvt-provider';
import { MvtWorkerPool } from './mvt-worker-pool';
import { compileStylePlan } from './style-plan';

const WAIT_TIMEOUT = 15000;

// Blob 地址由真实 Worker 下载，测试不访问后端或公网
function sourceFixture() {
  const url = URL.createObjectURL(new Blob([createMvtFixture()], { type: 'application/vnd.mapbox-vector-tile' }));
  const source: VectorSourceSpecification = {
    type: 'vector', tiles: [url], maxzoom: 0, promoteId: { landuse: 'bsm', detail: 'guid' }
  };
  return { source, [Symbol.dispose]: () => URL.revokeObjectURL(url) };
}

function imagery(pool: MvtWorkerPool, source: VectorSourceSpecification, specification: LayerSpecification, zoom = 0) {
  const plan = compileStylePlan({ version: 8, sources: { sample: source }, layers: [specification] });
  expect(plan.issues).toEqual([]);
  return createMvtProvider(plan.layers[0], zoom, pool);
}

function fill(color = '#00ff00'): FillLayerSpecification {
  return {
    id: 'fill', type: 'fill', source: 'sample', 'source-layer': 'landuse',
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['id'], ['literal', ['area-primary', 'area-secondary']]]],
    paint: { 'fill-color': ['match', ['get', 'category'], 'primary', color, '#0000ff'] }
  };
}

// 超时只结束等待，实际结果仍由断言检查，所有事件与资源由调用方释放
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      promise.then(value => ({ ready: true as const, value })),
      new Promise<{ readonly ready: false }>(resolve => {
        timer = setTimeout(() => resolve({ ready: false }), WAIT_TIMEOUT);
      })
    ]);
    expect(result.ready).toBe(true);
    if (!result.ready) {
      throw new Error('真实 Worker 没有完成本地瓦片任务');
    }
    return result.value;
  } finally {
    clearTimeout(timer);
  }
}

async function tile(provider: MvtProvider, x = 0, y = 0, level = 0): Promise<HTMLCanvasElement> {
  const requested = provider.requestImage(x, y, level);
  expect(requested).toBeInstanceOf(Promise);
  const image = await bounded(Promise.resolve(requested));
  expect(image).toBeInstanceOf(HTMLCanvasElement);
  return image as HTMLCanvasElement;
}

function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
}

function opaqueSpan(canvas: HTMLCanvasElement, y: number): number {
  const pixels = canvas.getContext('2d')!.getImageData(0, y, canvas.width, 1).data;
  return Array.from({ length: canvas.width }, (_, index) => pixels[index * 4 + 3]).filter(alpha => alpha > 127).length;
}

describe('MVT provider 的真实 Worker 绘制', () => {
  it('真实下载解码与位图转移保留分类、孔洞、来源层和 promoteId', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1 });
    using provider = imagery(pool, fixture.source, fill());
    const image = await tile(provider);
    expect(pixel(image, 64, 64)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 220, 240)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 450, 200)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 10, 10)).toEqual([0, 0, 0, 0]);
    using absent = imagery(pool, fixture.source, { ...fill(), 'source-layer': 'absent' });
    expect(pixel(await tile(absent), 64, 64)).toEqual([0, 0, 0, 0]);
    const stats = await bounded(pool.stats());
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ downloads: 1, decodes: 1, tiles: 1, inflight: 0 });
    expect(stats[0]?.bytes).toBeGreaterThan(createMvtFixture().byteLength);
  }, 20000);

  it('变色和相邻显示子瓦片复用同一份父数据，孔洞与填充跨边界不断开', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1 });
    using first = imagery(pool, fixture.source, fill());
    expect(pixel(await tile(first), 64, 64)).toEqual([0, 255, 0, 255]);
    using changed = imagery(pool, fixture.source, fill('#ff0000'));
    expect(pixel(await tile(changed), 64, 64)).toEqual([255, 0, 0, 255]);
    const [left, right] = await Promise.all([tile(changed, 0, 0, 1), tile(changed, 1, 0, 1)]);
    expect(pixel(left, 511, 100)).toEqual([255, 0, 0, 255]);
    expect(pixel(right, 0, 100)).toEqual([255, 0, 0, 255]);
    expect(pixel(left, 511, 400)).toEqual([0, 0, 0, 0]);
    expect(pixel(right, 0, 400)).toEqual([0, 0, 0, 0]);
    const stats = await bounded(pool.stats());
    expect(stats[0]).toMatchObject({ downloads: 1, decodes: 1, tiles: 1, inflight: 0 });
    expect(stats[0]?.hits).toBe(3);
  }, 20000);

  it('不同 extent 的点线使用相机级别求值，父矢量放大后重新绘制尺寸', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1 });
    const point: LayerSpecification = {
      id: 'points', type: 'circle', source: 'sample', 'source-layer': 'detail',
      filter: ['==', ['id'], 'points-secondary'],
      paint: {
        'circle-color': ['step', ['zoom'], '#ff0000', 1, '#0000ff'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 1, 12]
      }
    };
    using native = imagery(pool, fixture.source, point);
    const image = await tile(native);
    expect(pixel(image, 128, 256)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 384, 256)).toEqual([255, 0, 0, 255]);
    expect(opaqueSpan(image, 256)).toBe(32);
    const child = await tile(native, 0, 1, 1);
    expect(pixel(child, 256, 0)).toEqual([255, 0, 0, 255]);
    expect(opaqueSpan(child, 0)).toBe(32);
    using zoomed = imagery(pool, fixture.source, point, 1);
    const zoomedChild = await tile(zoomed, 0, 1, 1);
    expect(pixel(zoomedChild, 256, 0)).toEqual([0, 0, 255, 255]);
    expect(opaqueSpan(zoomedChild, 0)).toBe(24);
    using line = imagery(pool, fixture.source, {
      id: 'line', type: 'line', source: 'sample', 'source-layer': 'detail',
      filter: ['==', ['id'], 'path-buffer'],
      paint: { 'line-color': '#00ff00', 'line-width': 8 }
    });
    const [left, right] = await Promise.all([tile(line, 0, 0, 1), tile(line, 1, 0, 1)]);
    expect(pixel(left, 511, 511)).toEqual([0, 255, 0, 255]);
    expect(pixel(right, 0, 511)).toEqual([0, 255, 0, 255]);
    expect((await bounded(pool.stats()))[0]?.downloads).toBe(1);
  }, 20000);

  it('真实绘制超过驻留预算时不缓存，下一次仍能重新下载并正确显示', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1, budgetBytes: 1 });
    using provider = imagery(pool, fixture.source, fill());
    expect(pixel(await tile(provider), 64, 64)).toEqual([0, 255, 0, 255]);
    expect(pixel(await tile(provider), 64, 64)).toEqual([0, 255, 0, 255]);
    expect((await bounded(pool.stats()))[0]).toMatchObject({ bytes: 0, tiles: 0, downloads: 2, decodes: 2 });
  }, 20000);

  it('高最小级别来源的低级祖先实际透明，既不下载也不启动 Worker', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1 });
    using provider = imagery(pool, { ...fixture.source, minzoom: 8, maxzoom: 8 }, fill(), 10);
    const [root, ancestor] = await Promise.all([tile(provider), tile(provider, 127, 127, 7)]);
    expect(provider.minimumLevel).toBe(0);
    expect(pixel(root, 64, 64)).toEqual([0, 0, 0, 0]);
    expect(pixel(ancestor, 450, 200)).toEqual([0, 0, 0, 0]);
    expect(await bounded(pool.stats())).toEqual([]);
    const native = await tile(provider, 127, 127, 8);
    expect(pixel(native, 64, 64)).toEqual([0, 255, 0, 255]);
    expect((await bounded(pool.stats()))[0]).toMatchObject({ downloads: 1, tiles: 1 });
  }, 20000);

  it('局部范围之外不下载，部分瓦片按墨卡托边界裁剪实际像素', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1 });
    using provider = imagery(pool, { ...fixture.source, bounds: [-90, 0, 0, 66.51326044311186] }, fill());
    expect(provider.rectangle).toEqual(provider.tilingScheme.rectangle);
    expect(pixel(await tile(provider, 3, 3, 2), 64, 64)).toEqual([0, 0, 0, 0]);
    expect(await bounded(pool.stats())).toEqual([]);
    const image = await tile(provider);
    expect(pixel(image, 140, 140)).toEqual([0, 255, 0, 255]);
    for (const [x, y] of [[127, 140], [256, 140], [140, 127], [140, 256]]) {
      expect(pixel(image, x, y)).toEqual([0, 0, 0, 0]);
    }
    for (const [x, y] of [[129, 140], [254, 140], [140, 129], [140, 254]]) {
      expect(pixel(image, x, y)).toEqual([0, 255, 0, 255]);
    }
    expect((await bounded(pool.stats()))[0]).toMatchObject({ downloads: 1, tiles: 1 });
  }, 20000);

  it('跨 180° 的范围保留两侧并裁掉中间，显示子瓦片仍复用父数据', async () => {
    using fixture = sourceFixture();
    using pool = new MvtWorkerPool({ workerCount: 1 });
    using provider = imagery(pool, { ...fixture.source, bounds: [90, -60, -90, 60] }, fill());
    const image = await tile(provider);
    expect(pixel(image, 64, 200)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 450, 200)).toEqual([0, 0, 255, 255]);
    expect(pixel(image, 140, 200)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 64, 100)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 64, 400)).toEqual([0, 0, 0, 0]);
    const [left, right] = await Promise.all([tile(provider, 0, 0, 1), tile(provider, 1, 0, 1)]);
    expect(pixel(left, 100, 400)).toEqual([0, 255, 0, 255]);
    expect(pixel(right, 100, 400)).toEqual([0, 0, 0, 0]);
    expect(pixel(right, 388, 400)).toEqual([0, 0, 255, 255]);
    expect((await bounded(pool.stats()))[0]).toMatchObject({ downloads: 1, decodes: 1, tiles: 1 });
  }, 20000);

  it('暂停取消等待，晚到的真实位图被关闭，恢复保留数据，销毁终止线程', async () => {
    using fixture = sourceFixture();
    const worker = new Worker(new URL('./mvt.worker.ts', import.meta.url), { type: 'module' });
    const terminate = vi.spyOn(worker, 'terminate');
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const received = new Promise<ImageBitmap>(resolve => { resolveBitmap = resolve; });
    let held: unknown;
    let holding = true;
    // 只延迟一次已经完成的真实响应，制造稳定的取消与晚到顺序
    worker.addEventListener('message', event => {
      const data: unknown = event.data;
      if (holding && typeof data === 'object' && data !== null && 'kind' in data && data.kind === 'result' &&
        'method' in data && data.method === 'render' && 'value' in data && data.value instanceof ImageBitmap) {
        holding = false;
        held = data;
        event.stopImmediatePropagation();
        resolveBitmap(data.value);
      }
    });
    using pool = new MvtWorkerPool({ workerCount: 1, createWorker: () => worker });
    using provider = imagery(pool, fixture.source, fill());
    const waiting = Promise.resolve(provider.requestImage(0, 0, 0)).then(value => ({ value }), (error: unknown) => ({ error }));
    const response = await bounded(Promise.race([received.then(bitmap => ({ bitmap })), waiting]));
    expect('bitmap' in response).toBe(true);
    if (!('bitmap' in response)) {
      throw new Error('Worker 在交付位图之前结束了任务');
    }
    const bitmap = response.bitmap;
    try {
      expect(bitmap.width).toBe(512);
      pool.pause();
      expect(await bounded(waiting)).toMatchObject({ error: { name: 'AbortError' } });
      expect(provider.requestImage(0, 0, 0)).toBeUndefined();
      worker.dispatchEvent(new MessageEvent('message', { data: held }));
      expect(bitmap.width).toBe(0);
      expect(bitmap.height).toBe(0);
      pool.resume();
      expect(pixel(await tile(provider), 64, 64)).toEqual([0, 255, 0, 255]);
      expect((await bounded(pool.stats()))[0]).toMatchObject({ downloads: 1, tiles: 1 });
      const pending = Promise.resolve(provider.requestImage(0, 0, 0))
        .then(value => ({ value }), (error: unknown) => ({ error }));
      pool[Symbol.dispose]();
      expect(await bounded(pending)).toMatchObject({ error: { name: 'AbortError' } });
      expect(terminate).toHaveBeenCalledOnce();
      expect(provider.requestImage(0, 0, 0)).toBeUndefined();
    } finally {
      bitmap.close();
      terminate.mockRestore();
    }
  }, 20000);
});
