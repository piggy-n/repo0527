// @vitest-environment node
import type { LayerSpecification, SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { ImageryLayerCollection, Rectangle } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { createImageryStylePort } from './imagery-style-port';
import { compileStylePlan } from './style-plan';

const RASTER: SourceSpecification = { type: 'raster', tiles: ['/tiles/{z}/{x}/{y}.png'] };
const GEOJSON: SourceSpecification = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };

function plan(layer: LayerSpecification, source = RASTER) {
  const result = compileStylePlan({ version: 8, sources: { data: source }, layers: [layer] });
  expect(result.issues).toEqual([]);
  return result.layers[0];
}

function fixture(fetchData?: typeof fetch) {
  const layers = new ImageryLayerCollection();
  const render = vi.fn<() => void>();
  const port = createImageryStylePort({ layers, requestRender: render, geojson: { fetch: fetchData } });
  return {
    layers, render,
    port,
    [Symbol.dispose]: () => { port[Symbol.dispose](); layers.destroy(); }
  };
}

// 推进 Promise 加载链，晚一轮的计时器同时防止错误等待挂起
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function pendingFetch() {
  const pending: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  const fetchData = vi.fn<typeof fetch>((_url, options) => new Promise(resolve => {
    pending.push({ signal: options?.signal as AbortSignal, resolve });
  }));
  return { pending, fetchData };
}

describe('三维影像样式端口', () => {
  it('URL GeoJSON 多层共享下载，就绪前保留位置，缩放继续复用数据', async () => {
    const { pending, fetchData } = pendingFetch();
    using ctx = fixture(fetchData);
    const source: SourceSpecification = { type: 'geojson', data: '/boundary.json' };
    const report = vi.fn<(error: unknown) => void>();
    using fill = ctx.port.create(plan({ id: 'fill', type: 'fill', source: 'data' }, source), 8, report);
    using line = ctx.port.create(plan({ id: 'line', type: 'line', source: 'data' }, source), 8, report);
    expect(ctx.port.ready).toBe(false);
    await nextTurn();
    expect(fetchData).toHaveBeenCalledOnce();
    const first = ctx.layers.get(1);
    const second = ctx.layers.get(2);
    ctx.port.order([line, fill]);
    pending[0].resolve(Response.json(GEOJSON.data));
    await nextTurn();
    expect(ctx.port.ready).toBe(true);
    expect([ctx.layers.get(1), ctx.layers.get(2)]).toEqual([second, first]);
    expect(first.ready).toBe(true);
    fill.setZoom(9);
    await nextTurn();
    expect(fetchData).toHaveBeenCalledOnce();
    expect(first.isDestroyed()).toBe(true);
    expect(ctx.layers.get(2).ready).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it('URL 隐藏、暂停和释放取消等待，恢复与迟到返回互不覆盖', async () => {
    const { pending, fetchData } = pendingFetch();
    using ctx = fixture(fetchData);
    const report = vi.fn<(error: unknown) => void>();
    const layer = plan({ id: 'fill', type: 'fill', source: 'data' }, { type: 'geojson', data: '/boundary.json' });
    const handle = ctx.port.create(layer, 8, report);
    await nextTurn();
    handle.setVisible(false);
    const hidden = ctx.layers.get(1);
    handle.setZoom(8.5);
    handle.setZoom(9.25);
    expect(pending[0].signal.aborted).toBe(true);
    expect(ctx.port.ready).toBe(true);
    ctx.port.pause();
    ctx.port.resume();
    await nextTurn();
    expect(ctx.layers.get(1)).toBe(hidden);
    expect(fetchData).toHaveBeenCalledOnce();
    handle.setVisible(true);
    await nextTurn();
    expect(fetchData).toHaveBeenCalledTimes(2);
    expect(pending[1].signal.aborted).toBe(false);
    expect(ctx.port.ready).toBe(false);
    ctx.port.pause();
    expect(pending[1].signal.aborted).toBe(true);
    ctx.port.resume();
    await nextTurn();
    const current = ctx.layers.get(1);
    pending[0].resolve(Response.json({ type: 'not-geojson' }));
    pending[1].resolve(new Response('failed', { status: 500 }));
    await nextTurn();
    expect(ctx.port.ready).toBe(false);
    expect(report).not.toHaveBeenCalled();
    pending[2].resolve(Response.json(GEOJSON.data));
    await nextTurn();
    expect(current.ready).toBe(true);
    expect(ctx.port.ready).toBe(true);
    handle[Symbol.dispose]();
    expect(ctx.layers.length).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('MVT 隐藏时不换影像，显示先追精确级别且只重建一次', () => {
    using globals = new DisposableStack();
    globals.defer(() => vi.unstubAllGlobals());
    // 本用例不请求瓦片，只提供来源 URL 解析所需的文档基址
    vi.stubGlobal('document', { baseURI: 'https://local.test/' });
    using ctx = fixture();
    const source: SourceSpecification = { type: 'vector', tiles: ['/tiles/{z}/{x}/{y}.pbf'] };
    using handle = ctx.port.create(plan({ id: 'fill', type: 'fill', source: 'data', 'source-layer': 'areas' }, source),
      8, () => {});
    const added = vi.fn<() => void>();
    const unsubscribe = ctx.layers.layerAdded.addEventListener(added);
    const initial = ctx.layers.get(1);
    handle.setVisible(false);
    handle.setZoom(8.75);
    handle.setZoom(9.25);
    expect(ctx.layers.get(1)).toBe(initial);
    expect(added).not.toHaveBeenCalled();
    handle.setVisible(true);
    expect(ctx.layers.get(1)).not.toBe(initial);
    expect(added).toHaveBeenCalledOnce();
    handle.setZoom(9.25);
    expect(added).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('URL 就绪后的外部重绘回调抛错不误报来源加载失败', async () => {
    using consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    using ctx = fixture(async () => Response.json(GEOJSON.data));
    ctx.render.mockImplementationOnce(() => { throw new Error('外部重绘失败'); });
    const report = vi.fn<(error: unknown) => void>();
    ctx.port.create(plan({ id: 'fill', type: 'fill', source: 'data' }, {
      type: 'geojson', data: '/boundary.json'
    }), 8, report);
    await nextTurn();
    expect(ctx.port.ready).toBe(true);
    expect(report).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('端口释放后 URL 迟到完成仍给 SDK 空提供者，不再读取已释放的几何缓存', async () => {
    const { pending, fetchData } = pendingFetch();
    using ctx = fixture(fetchData);
    const handle = ctx.port.create(plan({ id: 'fill', type: 'fill', source: 'data' }, {
      type: 'geojson', data: '/boundary.json'
    }), 8, () => {});
    const rejected = vi.fn<(error: unknown) => void>();
    const imagery = ctx.layers.get(1);
    imagery.errorEvent.addEventListener(rejected);
    await nextTurn();
    ctx.port[Symbol.dispose]();
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve(Response.json(GEOJSON.data));
    await nextTurn();
    expect(rejected).not.toHaveBeenCalled();
    expect(imagery.isDestroyed()).toBe(true);
    handle[Symbol.dispose]();
  });

  it('URL 下载失败只报告来源错误并结束等待，释放前晚到失败不再报告', async () => {
    const { pending, fetchData } = pendingFetch();
    using ctx = fixture(fetchData);
    const report = vi.fn<(error: unknown) => void>();
    const layer = plan({ id: 'fill', type: 'fill', source: 'data' }, { type: 'geojson', data: '/boundary.json' });
    const handle = ctx.port.create(layer, 8, report);
    await nextTurn();
    pending[0].resolve(new Response('failed', { status: 500 }));
    await nextTurn();
    expect(report).toHaveBeenCalledOnce();
    expect(ctx.port.ready).toBe(true);
    handle[Symbol.dispose]();
    const next = ctx.port.create(layer, 8, report);
    await nextTurn();
    next[Symbol.dispose]();
    pending[1].resolve(new Response('failed', { status: 500 }));
    await nextTurn();
    expect(report).toHaveBeenCalledOnce();
    expect(ctx.layers.length).toBe(0);
  });

  it('全部图层共享顺序，透明全球锚定层随最后一个 handle 释放', () => {
    using ctx = fixture();
    const report = vi.fn<(error: unknown) => void>();
    expect(ctx.layers.length).toBe(0);
    const background = ctx.port.create(plan({ id: 'base', type: 'background' }), 8, report);
    const raster = ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }), 8, report);
    const fill = ctx.port.create(plan({ id: 'area', type: 'fill', source: 'data' }, GEOJSON), 8, report);
    const [anchor, first, second, third] = Array.from({ length: 4 }, (_, index) => ctx.layers.get(index));
    expect(anchor.imageryProvider.rectangle).toEqual(Rectangle.MAX_VALUE);
    expect(first.isBaseLayer()).toBe(false);
    expect(anchor.isBaseLayer()).toBe(true);
    ctx.port.order([raster, fill, background]);
    expect(Array.from({ length: 4 }, (_, index) => ctx.layers.get(index))).toEqual([anchor, second, third, first]);
    background.setVisible(false);
    expect(first.show).toBe(false);
    expect(anchor.show).toBe(true);
    background[Symbol.dispose]();
    raster[Symbol.dispose]();
    expect(ctx.layers.length).toBe(2);
    fill[Symbol.dispose]();
    fill[Symbol.dispose]();
    expect(ctx.layers.length).toBe(0);
    expect(anchor.isDestroyed()).toBe(true);
    expect([first, second, third].every(layer => layer.isDestroyed())).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it('栅格缩放只改变透明度，显式关闭调色不替换影像实例', () => {
    using ctx = fixture();
    using handle = ctx.port.create(plan({
      id: 'tiles', type: 'raster', source: 'data',
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.2, 10, 0.8] }
    }), 8, () => {});
    const imagery = ctx.layers.get(1);
    expect(imagery.alpha).toBeCloseTo(0.2);
    expect([imagery.gamma, imagery.brightness, imagery.contrast, imagery.saturation, imagery.hue]).toEqual([1, 1, 1, 1, 0]);
    handle.setZoom(9);
    expect(ctx.layers.get(1)).toBe(imagery);
    expect(imagery.alpha).toBeCloseTo(0.5);
    ctx.port.requestRender();
    expect(ctx.render).toHaveBeenCalledOnce();
  });

  it('跨 180° 经线的影像范围保留左右两半，不被图层默认全球范围截短', () => {
    using ctx = fixture();
    using lifetime = new DisposableStack();
    lifetime.use(ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }, {
      ...RASTER, bounds: [170, -20, -170, 20]
    }), 8, () => {}));
    const imagery = ctx.layers.get(1);
    expect(imagery.getImageryRectangle()).toEqual(Rectangle.fromDegrees(170, -20, -170, 20));
  });

  it('隐藏 GeoJSON 只记录最新级别，重新显示时重建一次并保留索引', () => {
    using ctx = fixture();
    const report = vi.fn<(error: unknown) => void>();
    using area = ctx.port.create(plan({ id: 'area', type: 'fill', source: 'data' }, GEOJSON), 8, report);
    using top = ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }), 8, report);
    const previous = ctx.layers.get(1);
    const oldProvider = previous.imageryProvider;
    const above = ctx.layers.get(2);
    area.setVisible(false);
    area.setZoom(9);
    area.setZoom(9.25);
    expect(ctx.layers.get(1)).toBe(previous);
    expect(previous.isDestroyed()).toBe(false);
    expect(previous.show).toBe(false);
    area.setVisible(true);
    const current = ctx.layers.get(1);
    expect(current).not.toBe(previous);
    expect(previous.isDestroyed()).toBe(true);
    expect(current.show).toBe(true);
    expect(ctx.layers.get(2)).toBe(above);
    expect(oldProvider.errorEvent.numberOfListeners).toBe(0);
    oldProvider.errorEvent.raiseEvent(new Error('旧错误'));
    expect(report).not.toHaveBeenCalled();
    const failure = new Error('当前错误');
    current.imageryProvider.errorEvent.raiseEvent(failure);
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    area.setZoom(9.25);
    expect(ctx.layers.get(1)).toBe(current);
    ctx.port.order([top, area]);
    expect(ctx.layers.get(2)).toBe(current);
  });

  it('固定背景不随 zoom 重建，zoom 表达式背景才重建', () => {
    using ctx = fixture();
    using fixed = ctx.port.create(plan({ id: 'fixed', type: 'background' }), 8, () => {});
    using dependent = ctx.port.create(plan({
      id: 'dependent', type: 'background', paint: {
        'background-color': ['step', ['zoom'], '#ff0000', 9, '#00ff00']
      }
    }), 8, () => {});
    const beforeFixed = ctx.layers.get(1);
    const beforeDependent = ctx.layers.get(2);
    fixed.setZoom(9);
    dependent.setZoom(9);
    expect(ctx.layers.get(1)).toBe(beforeFixed);
    expect(ctx.layers.get(2)).not.toBe(beforeDependent);
    expect(beforeDependent.isDestroyed()).toBe(true);
  });

  it('创建失败清理锚定层，释放后不再响应方法或 provider 事件', () => {
    using ctx = fixture();
    expect(() => ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }, {
      ...RASTER, minzoom: 10
    }), 8, () => {})).toThrow('最多支持 4 块');
    expect(ctx.layers.length).toBe(0);
    const report = vi.fn<(error: unknown) => void>();
    const handle = ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }), 8, report);
    const provider = ctx.layers.get(1).imageryProvider;
    handle[Symbol.dispose]();
    handle.setVisible(true);
    handle.setZoom(12);
    provider.errorEvent.raiseEvent(new Error('已释放'));
    expect(provider.errorEvent.numberOfListeners).toBe(0);
    expect(ctx.layers.length).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('错误报告器抛错不影响资源释放', () => {
    using consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    using ctx = fixture();
    const handle = ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }), 8, () => {
      throw new Error('报告器失败');
    });
    expect(() => ctx.layers.get(1).imageryProvider.errorEvent.raiseEvent(new Error('加载失败'))).not.toThrow();
    handle[Symbol.dispose]();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(ctx.layers.length).toBe(0);
  });
});
