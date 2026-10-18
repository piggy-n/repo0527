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
    arc: vi.fn<CanvasContext['arc']>(), save: vi.fn<CanvasContext['save']>(), restore: vi.fn<CanvasContext['restore']>(),
    fillStyle: '', strokeStyle: '', globalAlpha: 1,
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10
  };
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
    expect(canvas.lineTo).toHaveBeenCalledTimes(256);
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
});
