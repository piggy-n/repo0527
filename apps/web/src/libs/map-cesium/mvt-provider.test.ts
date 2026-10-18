import { describe, expect, it, vi } from 'vitest';
import { createMvtProvider, type MvtProvider } from './mvt-provider';
import { MvtWorkerPool } from './mvt-worker-pool';
import { compileStylePlan } from './style-plan';

describe('MVT 数据最小级别与影像祖先', () => {
  it('非主动取消的绘制失败仍拒绝影像请求，不把真正失败换成透明内容', async () => {
    using pool = new MvtWorkerPool();
    const failure = new Error('实际绘制失败');
    const render = vi.spyOn(pool, 'render').mockRejectedValue(failure);
    const plan = compileStylePlan({
      version: 8,
      sources: { data: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] } },
      layers: [{ id: 'fill', type: 'fill', source: 'data', 'source-layer': 'landuse' }]
    });
    using provider = createMvtProvider(plan.layers[0], 2, pool);
    await expect(provider.requestImage(0, 0, 0)).rejects.toBe(failure);
    expect(render).toHaveBeenCalledOnce();
  });

  it('局部范围以完整影像根级交给 SDK，范围外只返回透明瓦片且不创建 Worker', async () => {
    const createWorker = vi.fn<() => never>(() => { throw new Error('范围外不应启动 Worker'); });
    using pool = new MvtWorkerPool({ workerCount: 1, createWorker });
    const plan = compileStylePlan({
      version: 8,
      sources: { data: {
        type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'], bounds: [-90, 0, 0, 60]
      } },
      layers: [{ id: 'fill', type: 'fill', source: 'data', 'source-layer': 'landuse' }]
    });
    using provider = createMvtProvider(plan.layers[0], 2, pool);
    expect(provider.rectangle).toEqual(provider.tilingScheme.rectangle);
    const outside = await provider.requestImage(3, 3, 2);
    expect(outside).toMatchObject({ width: 1, height: 1 });
    expect(await provider.requestImage(3, 2, 2)).toBe(outside);
    expect([provider.tileWidth, provider.tileHeight]).toEqual([512, 512]);
    expect(createWorker).not.toHaveBeenCalled();
    expect(await pool.stats()).toEqual([]);
  });

  it('无 bounds 的高最小级别来源合法，低级祖先只返回透明画布且不创建 Worker', async () => {
    const createWorker = vi.fn<() => never>(() => { throw new Error('透明祖先不应启动 Worker'); });
    using pool = new MvtWorkerPool({ workerCount: 1, createWorker });
    const plan = compileStylePlan({
      version: 8,
      sources: { data: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'], minzoom: 8, maxzoom: 15 } },
      layers: [{ id: 'fill', type: 'fill', source: 'data', 'source-layer': 'landuse', minzoom: 8 }]
    });
    expect(plan.issues).toEqual([]);
    let provider: MvtProvider | undefined;
    try {
      expect(() => { provider = createMvtProvider(plan.layers[0], 10, pool); }).not.toThrow();
      expect(provider?.minimumLevel).toBe(0);
      expect(provider?.maximumLevel).toBe(22);
      const [root, ancestor] = await Promise.all([
        provider?.requestImage(0, 0, 0), provider?.requestImage(127, 127, 7)
      ]);
      expect(root).toBeInstanceOf(HTMLCanvasElement);
      expect(ancestor).toBeInstanceOf(HTMLCanvasElement);
      expect(root).toMatchObject({ width: 1, height: 1 });
      expect(ancestor).toBe(root);
      expect([provider?.tileWidth, provider?.tileHeight]).toEqual([512, 512]);
      expect(createWorker).not.toHaveBeenCalled();
      expect(await pool.stats()).toEqual([]);
    } finally {
      provider?.[Symbol.dispose]();
    }
  });
});
