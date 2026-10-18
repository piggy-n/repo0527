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

function fixture() {
  const layers = new ImageryLayerCollection();
  const render = vi.fn<() => void>();
  return {
    layers, render,
    port: createImageryStylePort({ layers, requestRender: render }),
    [Symbol.dispose]: () => layers.destroy()
  };
}

describe('三维影像样式端口', () => {
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

  it('GeoJSON 缩放重建影像但保留索引和显隐，旧 provider 错误不再报告', () => {
    using ctx = fixture();
    const report = vi.fn<(error: unknown) => void>();
    using area = ctx.port.create(plan({ id: 'area', type: 'fill', source: 'data' }, GEOJSON), 8, report);
    using top = ctx.port.create(plan({ id: 'tiles', type: 'raster', source: 'data' }), 8, report);
    const previous = ctx.layers.get(1);
    const oldProvider = previous.imageryProvider;
    const above = ctx.layers.get(2);
    area.setVisible(false);
    area.setZoom(9);
    const current = ctx.layers.get(1);
    expect(current).not.toBe(previous);
    expect(previous.isDestroyed()).toBe(true);
    expect(current.show).toBe(false);
    expect(ctx.layers.get(2)).toBe(above);
    expect(oldProvider.errorEvent.numberOfListeners).toBe(0);
    oldProvider.errorEvent.raiseEvent(new Error('旧错误'));
    expect(report).not.toHaveBeenCalled();
    const failure = new Error('当前错误');
    current.imageryProvider.errorEvent.raiseEvent(failure);
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    area.setZoom(9);
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
