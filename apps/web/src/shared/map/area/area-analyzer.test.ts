// @vitest-environment node
import { serveWorker } from '@yzt/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAreaAnalyzer } from './area-analyzer';
import { AREA_LIMITS } from './area-geometry';
import { areaWorkerHandlers } from './area-worker-handlers';
import type { AreaWorkerProtocol } from './area-worker-protocol';

const ports: MessagePort[] = [];

// 同一线程里的"Worker"：消息经过真实的结构化克隆和所有权转移
const createWorker = vi.fn<() => MessagePort>(() => {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveWorker<AreaWorkerProtocol>(port2, areaWorkerHandlers);
  return port1;
});

afterEach(() => {
  for (const port of ports.splice(0)) {
    port.close();
  }
  createWorker.mockClear();
});

const square = [
  [
    [118.8, 32],
    [118.82, 32],
    [118.82, 32.02],
    [118.8, 32.02],
    [118.8, 32]
  ]
];
const geojson = JSON.stringify({ type: 'Polygon', coordinates: square });

describe('createAreaAnalyzer', () => {
  it('在 Worker 里读文件、整理范围、与行政区求交', async () => {
    using analyzer = createAreaAnalyzer(createWorker);
    const signal = new AbortController().signal;
    const read = await analyzer.read([new File([geojson], '江宁.geojson')], signal);
    expect(read).toMatchObject({ ok: true, format: 'geojson', features: 1 });
    const prepared = await analyzer.prepare([square], signal);
    expect(prepared.ok && prepared.area.vertices).toBe(4);
    const region = { code: 'A', geometry: { type: 'Polygon' as const, coordinates: square } };
    const covered = await analyzer.cover({ type: 'MultiPolygon', coordinates: [square] }, [region], '测试区', signal);
    expect(covered.ok && covered.coverage.covers.map(cover => cover.relation)).toEqual(['full']);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('超过大小上限的文件不读进内存', async () => {
    using analyzer = createAreaAnalyzer(createWorker);
    const big = new File(['x'], 'big.zip');
    Object.defineProperty(big, 'size', { value: AREA_LIMITS.fileBytes + 1 });
    const arrayBuffer = vi.spyOn(big, 'arrayBuffer');
    const result = await analyzer.read([big], new AbortController().signal);
    expect(result).toMatchObject({ ok: false, problem: { code: 'file-size' } });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('中止时以 AbortError 结束', async () => {
    using analyzer = createAreaAnalyzer(createWorker);
    const controller = new AbortController();
    const pending = analyzer.read([new File([geojson], 'a.geojson')], controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
