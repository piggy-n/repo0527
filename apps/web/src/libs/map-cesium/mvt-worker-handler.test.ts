// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMvtWorkerHandler } from './mvt-worker-handler';
import type { renderMvt } from './mvt-render';
import type { MvtRenderRequest } from './mvt-worker-protocol';

function request(): MvtRenderRequest {
  return {
    data: {
      source: { tiles: ['https://example.test/{z}/{x}/{y}.pbf'], dataVersion: '1', permissionScope: 'session' },
      coordinate: { z: 0, x: 0, y: 0 }, url: 'https://example.test/0/0/0.pbf', fields: []
    },
    source: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
    layer: { id: 'fill', type: 'fill', source: 'data', 'source-layer': 'land' },
    tile: { z: 0, x: 0, y: 0 }, cameraZoom: 0, budgetBytes: 1024
  };
}

function context(controller = new AbortController()) {
  return { signal: controller.signal, checkpoint: async () => controller.signal.throwIfAborted() };
}

describe('MVT Worker 处理函数', () => {
  it('惰性建立服务，换绘制样式复用数据缓存并返回独立位图', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(new ArrayBuffer(0)));
    const bitmaps: ImageBitmap[] = [];
    const render = vi.fn<typeof renderMvt>(async () => {
      const bitmap: ImageBitmap = { width: 512, height: 512, close: vi.fn<() => void>() };
      bitmaps.push(bitmap);
      return bitmap;
    });
    using worker = createMvtWorkerHandler({ fetch: fetchTile, render });
    expect(await worker.handlers.stats(undefined, context())).toBeNull();
    const first = await worker.handlers.render(request(), context());
    const second = await worker.handlers.render({
      ...request(), layer: {
        id: 'fill', type: 'fill', source: 'data', 'source-layer': 'land', paint: { 'fill-color': 'red' }
      }
    }, context());
    expect(first).toMatchObject({ value: bitmaps[0] });
    expect(second).toMatchObject({ value: bitmaps[1] });
    expect(bitmaps[0]).not.toBe(bitmaps[1]);
    expect(fetchTile).toHaveBeenCalledOnce();
    expect(await worker.handlers.stats(undefined, context())).toMatchObject({ downloads: 1, decodes: 1, hits: 1 });
  });

  it('缓存预算不能在同一 Worker 生命周期内改变', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(new ArrayBuffer(0)));
    using worker = createMvtWorkerHandler({
      fetch: fetchTile, render: async () => ({ width: 1, height: 1, close: vi.fn<() => void>() })
    });
    await worker.handlers.render(request(), context());
    await expect(worker.handlers.render({ ...request(), budgetBytes: 2048 }, context())).rejects.toThrow('预算');
    expect(fetchTile).toHaveBeenCalledOnce();
  });

  it('等待绘制返回后再次检查取消，并关闭已经产生的位图', async () => {
    const controller = new AbortController();
    const close = vi.fn<() => void>();
    const bitmap: ImageBitmap = { width: 1, height: 1, close };
    using worker = createMvtWorkerHandler({
      fetch: async () => new Response(new ArrayBuffer(0)),
      render: async () => { controller.abort(); return bitmap; }
    });
    await expect(worker.handlers.render(request(), context(controller))).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('无效样式在下载前失败，销毁后不允许重新创建服务', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(new ArrayBuffer(0)));
    const worker = createMvtWorkerHandler({ fetch: fetchTile });
    await expect(worker.handlers.render({
      ...request(), layer: { id: 'symbol', type: 'symbol', source: 'data', 'source-layer': 'land' }
    }, context())).rejects.toThrow('暂不支持');
    expect(fetchTile).not.toHaveBeenCalled();
    worker[Symbol.dispose]();
    await expect(worker.handlers.render(request(), context())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
