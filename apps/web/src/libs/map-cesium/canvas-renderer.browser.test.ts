import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImages } from '@yzt/map-core/worker';
import { describe, expect, it } from 'vitest';
import { CanvasPatternCache } from './canvas-pattern';
import { drawCanvas, drawCanvasCooperatively, prepareCanvasDrawing, type CanvasPath } from './canvas-renderer';
import { compileStylePlan } from './style-plan';

// 不依赖引擎和网络，直接检查浏览器画布的颜色、覆盖与接缝
function drawing(specification: LayerSpecification, paths: readonly CanvasPath[], images: StyleImages = {}) {
  const plan = compileStylePlan({
    version: 8, sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [specification]
  }, images);
  expect(plan.issues).toEqual([]);
  const type = specification.type === 'line' ? 'LineString' : 'Polygon';
  const draw = prepareCanvasDrawing(plan.layers[0], { type, paths, feature: { type, properties: {} } }, 10);
  if (!draw) { throw new Error('测试需要有效的 Canvas 绘制器'); }
  return draw;
}

function canvas(width = 128, height = 128): OffscreenCanvasRenderingContext2D {
  const context = new OffscreenCanvas(width, height).getContext('2d');
  if (!context) { throw new Error('测试需要 OffscreenCanvas'); }
  return context;
}

const square = (left: number, top: number, right: number, bottom: number) =>
  [left, top, right, top, right, bottom, left, bottom, left, top];
const identity = (x: number, y: number): readonly [number, number] => [x, y];
const stripe: StyleImages = { pattern: {
  width: 12, height: 2, pixelRatio: 2,
  data: new Uint8Array(Array.from({ length: 24 }, (_, index) => index % 12 < 6 ? [0, 0, 255, 255] : [0, 0, 0, 0]).flat())
} };

describe('Canvas 资源符号画面', () => {
  it('普通 RGBA 图片保留原色与像素比，局部硬边面仍与相邻瓦片同相位', () => {
    const draw = drawing({
      id: 'fill', type: 'fill', source: 'data',
      paint: { 'fill-pattern': 'pattern', 'fill-color': '#ff0000', 'fill-antialias': false }
    }, [square(-10, -10, 300, 130)], stripe);
    const reference = canvas(256);
    drawCanvas(reference, draw, identity, 1.3, { patterns: new CanvasPatternCache() });
    const left = canvas();
    const right = canvas();
    drawCanvas(left, draw, identity, 1.3, { origin: [0, 0], patterns: new CanvasPatternCache() });
    drawCanvas(right, draw, identity, 1.3, { origin: [128, 0], patterns: new CanvasPatternCache() });
    expect([...left.getImageData(0, 64, 128, 1).data]).toEqual([...reference.getImageData(0, 64, 128, 1).data]);
    const actual = right.getImageData(0, 64, 128, 1).data;
    const expected = reference.getImageData(128, 64, 128, 1).data;
    // 非整数相位经 Canvas 插值会有 1 级量化误差，不能出现真正错相位的颜色或透明度跳变
    expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))).toBeLessThanOrEqual(1);
    const sample = left.getImageData(0, 64, 128, 1).data;
    expect([...sample].filter((_, index) => index % 4 === 2)).toContain(255);
    expect([...sample].filter((_, index) => index % 4 === 0).every(value => value === 0)).toBe(true);
  });

  it('关闭抗锯齿的填充边缘只有完整覆盖或透明，孔洞和显式透明度保留', () => {
    const draw = drawing({
      id: 'fill', type: 'fill', source: 'data',
      paint: { 'fill-color': '#00ff00', 'fill-opacity': 0.4, 'fill-antialias': false }
    }, [[10.2, 10.2, 117.7, 16.8, 35.5, 117.8, 10.2, 10.2], square(32, 32, 42, 42)]);
    const context = canvas();
    drawCanvas(context, draw, identity, 1);
    const pixels = context.getImageData(0, 0, 128, 128).data;
    expect(new Set([...pixels].filter((_, index) => index % 4 === 3))).toEqual(new Set([0, 102]));
    expect(context.getImageData(36, 36, 1, 1).data[3]).toBe(0);
    expect([...context.getImageData(28, 28, 1, 1).data]).toEqual([0, 255, 0, 102]);
  });

  it('面描边只进入外环内侧和孔洞外侧，低于1像素也不越界', () => {
    const specification: LayerSpecification = {
      id: 'outline', type: 'line', source: 'data',
      paint: { 'line-color': '#ff0000', 'line-width': 8, 'line-offset': 4 }
    };
    const layer = compileStylePlan({
      version: 8, sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [specification]
    }).layers[0];
    const draw = prepareCanvasDrawing(layer, {
      type: 'Polygon', paths: [square(20, 20, 108, 108), square(40, 40, 88, 88)],
      feature: { type: 'Polygon', properties: {} }
    }, 10);
    if (!draw) { throw new Error('测试需要面描边'); }
    const context = canvas();
    drawCanvas(context, draw, identity, 1);
    expect(context.getImageData(18, 24, 1, 1).data[3]).toBe(0);
    expect(context.getImageData(22, 24, 1, 1).data[3]).toBe(255);
    expect(context.getImageData(36, 50, 1, 1).data[3]).toBe(255);
    expect(context.getImageData(42, 50, 1, 1).data[3]).toBe(0);
    const small = canvas();
    drawCanvas(small, draw, identity, 0.075);
    expect(small.getImageData(19, 24, 1, 1).data[3]).toBe(0);
    expect(small.getImageData(20, 24, 1, 1).data[3]).toBeGreaterThan(0);
  });

  it('虚线保留间隙，line-blur 的光晕在主线之外可见', () => {
    const dash = drawing({
      id: 'line', type: 'line', source: 'data', paint: { 'line-width': 4, 'line-dasharray': [3, 2] }
    }, [[0, 64, 128, 64]]);
    const context = canvas();
    drawCanvas(context, dash, identity, 1);
    expect(context.getImageData(5, 64, 1, 1).data[3]).toBe(255);
    expect(context.getImageData(16, 64, 1, 1).data[3]).toBe(0);
    const glow = drawing({
      id: 'line', type: 'line', source: 'data', paint: { 'line-width': 4, 'line-color': '#ff0000', 'line-blur': 8 }
    }, [[0, 64, 128, 64]]);
    const blurred = canvas();
    drawCanvas(blurred, glow, identity, 1);
    expect(blurred.getImageData(64, 58, 1, 1).data[3]).toBeGreaterThan(0);
    expect(context.getImageData(64, 58, 1, 1).data[3]).toBe(0);
  });

  it('大面积硬边覆盖让出事件循环后取消，不提交半成品', async () => {
    const draw = drawing({
      id: 'fill', type: 'fill', source: 'data', paint: { 'fill-antialias': false }
    }, [square(0, 0, 256, 256)]);
    const context = canvas(256, 256);
    const controller = new AbortController();
    await expect(drawCanvasCooperatively(context, draw, identity, 1, async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(context.getImageData(128, 128, 1, 1).data[3]).toBe(0);
  });
});
