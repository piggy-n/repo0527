// @vitest-environment node
import type { LayerSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { DecodedTile } from '@yzt/map-core/worker';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasContext } from './canvas-renderer';
import { renderMvt, type MvtCanvas } from './mvt-render';
import { compileStylePlan } from './style-plan';

const SOURCE: VectorSourceSpecification = { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] };
const ROOT = { z: 0, x: 0, y: 0 };

function harness(specification: LayerSpecification, source = SOURCE) {
  const drawing: CanvasContext = {
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
  const close = vi.fn<() => void>();
  const bitmap: ImageBitmap = { width: 512, height: 512, close };
  const getContext = vi.fn<MvtCanvas['getContext']>(() => drawing);
  const createCanvas = vi.fn<(size: number) => MvtCanvas>(() => ({
    getContext, transferToImageBitmap: () => bitmap
  }));
  const controller = new AbortController();
  const layer = compileStylePlan({ version: 8, sources: { data: source }, layers: [specification] }).layers[0];
  const options = {
    layer, source, coordinate: ROOT, tile: ROOT, cameraZoom: 0, createCanvas,
    context: {
      signal: controller.signal, checkpoint: vi.fn<() => Promise<void>>(async () => controller.signal.throwIfAborted())
    }
  };
  return { drawing, close, createCanvas, getContext, controller, options };
}

describe('MVT 绘制任务', () => {
  it('按原始 extent 重画父瓦片子块，线宽按相机级别求值', async () => {
    const { drawing, getContext, options } = harness({
      id: 'line', type: 'line', source: 'data', 'source-layer': 'roads',
      paint: { 'line-width': ['step', ['zoom'], 2, 1.5, 8] }
    });
    const data: DecodedTile = { bytes: 1, layers: { roads: { extent: 8192, features: [{
      type: 2, properties: {}, geometry: [new Int32Array([4096, 2048, 8192, 2048])]
    }] } } };
    await renderMvt({ ...options, data, tile: { z: 1, x: 1, y: 0 }, cameraZoom: 1.25 });
    expect(getContext).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: true });
    expect(drawing.moveTo).toHaveBeenCalledWith(0, 256);
    expect(drawing.lineTo).toHaveBeenCalledWith(512, 256);
    expect(drawing.lineWidth).toBeCloseTo(2 * 2 ** -0.25);
  });

  it('只绘制指定 source-layer，promoteId 用于过滤且多点保留全部坐标', async () => {
    const { drawing, getContext, options } = harness({
      id: 'points', type: 'circle', source: 'data', 'source-layer': 'places', filter: ['==', ['id'], 'chosen'],
      paint: { 'circle-radius': ['get', 'radius'] }
    }, { ...SOURCE, promoteId: { places: 'business' } });
    const data: DecodedTile = { bytes: 1, layers: {
      other: { extent: 4096, features: [{ type: 1, properties: {}, geometry: [new Int32Array([1, 2])] }] },
      places: { extent: 8192, features: [{
        id: 42, type: 1, properties: { business: 'chosen', radius: 7 },
        geometry: [new Int32Array([2048, 4096, 6144, 4096])]
      }] }
    } };
    await renderMvt({ ...options, data });
    expect(getContext).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: false });
    expect(drawing.arc).toHaveBeenNthCalledWith(1, 128, 256, 7, 0, 2 * Math.PI);
    expect(drawing.arc).toHaveBeenNthCalledWith(2, 384, 256, 7, 0, 2 * Math.PI);
    expect(drawing.arc).toHaveBeenCalledTimes(2);
  });

  it('promoteId 缺失时不回退原始 ID，布尔 ID 按规范转换为数字', async () => {
    const { drawing, options } = harness({
      id: 'points', type: 'circle', source: 'data', 'source-layer': 'places', filter: ['==', ['id'], 1]
    }, { ...SOURCE, promoteId: 'business' });
    const data: DecodedTile = { bytes: 1, layers: { places: { extent: 512, features: [
      { id: 1, type: 1, properties: {}, geometry: [new Int32Array([100, 100])] },
      { id: 2, type: 1, properties: { business: true }, geometry: [new Int32Array([200, 200])] }
    ] } } };
    await renderMvt({ ...options, data });
    expect(drawing.arc).toHaveBeenCalledExactlyOnceWith(200, 200, 5, 0, 2 * Math.PI);
  });

  it('位图产生后取消会关闭它，空 source-layer 仍检查取消', async () => {
    const { close, controller, options } = harness({
      id: 'points', type: 'circle', source: 'data', 'source-layer': 'missing'
    });
    await expect(renderMvt({
      ...options, data: { bytes: 1, layers: {} },
      context: { signal: controller.signal, checkpoint: async () => { controller.abort(); } }
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('无效父子关系在创建画布前拒绝', async () => {
    const { options, createCanvas } = harness({ id: 'points', type: 'circle', source: 'data', 'source-layer': 'places' });
    await expect(renderMvt({
      ...options, data: { bytes: 1, layers: {} }, coordinate: { z: 1, x: 1, y: 0 }, tile: { z: 2, x: 0, y: 0 }
    })).rejects.toThrow('祖先');
    expect(createCanvas).not.toHaveBeenCalled();
  });
});
