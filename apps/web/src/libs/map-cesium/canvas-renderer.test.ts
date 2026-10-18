// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { drawCanvas, drawCanvasCooperatively, prepareCanvasDrawing, type CanvasContext } from './canvas-renderer';
import { compileStylePlan } from './style-plan';

// 只记录画布命令，取消契约不依赖真实浏览器布局
function context(): CanvasContext {
  return {
    beginPath: vi.fn<CanvasContext['beginPath']>(), moveTo: vi.fn<CanvasContext['moveTo']>(),
    lineTo: vi.fn<CanvasContext['lineTo']>(), closePath: vi.fn<CanvasContext['closePath']>(),
    fill: vi.fn<CanvasContext['fill']>(), stroke: vi.fn<CanvasContext['stroke']>(),
    clip: vi.fn<CanvasContext['clip']>(), setLineDash: vi.fn<CanvasContext['setLineDash']>(),
    createPattern: vi.fn<CanvasContext['createPattern']>(), drawImage: vi.fn<CanvasContext['drawImage']>(),
    arc: vi.fn<CanvasContext['arc']>(), save: vi.fn<CanvasContext['save']>(), restore: vi.fn<CanvasContext['restore']>(),
    fillStyle: '', strokeStyle: '', globalAlpha: 1,
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    canvas: { width: 512, height: 512 }, lineDashOffset: 0, shadowBlur: 0, shadowColor: 'transparent'
  };
}

function lineLayer(paint: { 'line-offset'?: number; 'line-dasharray'?: number[] }) {
  return compileStylePlan({
    version: 8,
    sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [{ id: 'line', type: 'line', source: 'data', paint }]
  }).layers[0];
}

describe('Canvas 共用绘制器', () => {
  it('在单个长路径中分段检查取消，恢复画布且不提交未完成的描边', async () => {
    const layer = compileStylePlan({
      version: 8,
      sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'line', type: 'line', source: 'data', paint: { 'line-width': 3 } }]
    }).layers[0];
    const path = new Int32Array(2000);
    const draw = prepareCanvasDrawing(layer, {
      type: 'LineString', paths: [path], feature: { type: 'LineString', properties: {} }
    }, 10);
    if (!draw) { throw new Error('测试需要线绘制器'); }
    const canvas = context();
    const controller = new AbortController();
    const checkpoint = vi.fn<() => Promise<void>>(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    });
    await expect(drawCanvasCooperatively(canvas, draw, (x, y) => [x, y], 1, checkpoint)).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(canvas.lineTo).not.toHaveBeenCalled();
    expect(canvas.stroke).not.toHaveBeenCalled();
    expect(canvas.restore).toHaveBeenCalledOnce();
  });

  it('同一多点要素的每个点都使用同一套属性求值和像素比例', () => {
    const layer = compileStylePlan({
      version: 8,
      sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'points', type: 'circle', source: 'data', paint: { 'circle-radius': ['get', 'radius'] } }]
    }).layers[0];
    const draw = prepareCanvasDrawing(layer, {
      type: 'Point', paths: [new Int32Array([10, 20, 30, 40])],
      feature: { type: 'Point', properties: { radius: 5 } }
    }, 10);
    if (!draw) { throw new Error('测试需要点绘制器'); }
    const canvas = context();
    drawCanvas(canvas, draw, (x, y) => [x + 1, y + 2], 2);
    expect(canvas.arc).toHaveBeenNthCalledWith(1, 11, 22, 10, 0, 2 * Math.PI);
    expect(canvas.arc).toHaveBeenNthCalledWith(2, 31, 42, 10, 0, 2 * Math.PI);
    expect(canvas.fill).toHaveBeenCalledTimes(2);
  });

  it('细描边同样按半个线宽内收，虚线仍按原始线宽计量并保留光晕', () => {
    const layer = compileStylePlan({
      version: 8,
      sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{
        id: 'outline', type: 'line', source: 'data',
        paint: { 'line-width': 0.6, 'line-offset': 0.3, 'line-dasharray': [3, 2], 'line-blur': 2 }
      }]
    }).layers[0];
    const draw = prepareCanvasDrawing(layer, {
      type: 'Polygon', paths: [[0, 0, 10, 0, 10, 10, 0, 0]], feature: { type: 'Polygon', properties: {} }
    }, 10);
    if (!draw) { throw new Error('测试需要面描边绘制器'); }
    const canvas = context();
    drawCanvas(canvas, draw, (x, y) => [x, y], 2);
    expect(canvas.clip).toHaveBeenCalledWith('evenodd');
    expect(canvas.lineWidth).toBe(2.4);
    expect(canvas.setLineDash).toHaveBeenCalledWith([]);
    expect(canvas.stroke).toHaveBeenCalledOnce();
    expect(canvas.shadowBlur).toBe(4);
  });

  it('不把任意线偏移或全零虚线静默画成正常实线', () => {
    const shape = { type: 'LineString', paths: [[0, 0, 10, 0]], feature: { type: 'LineString', properties: {} } } as const;
    expect(() => prepareCanvasDrawing(lineLayer({ 'line-offset': 1 }), shape, 10)).toThrow('内收半个线宽');
    expect(() => prepareCanvasDrawing(lineLayer({ 'line-dasharray': [0, 0] }), shape, 10)).toThrow('不能全为零');
  });
});
