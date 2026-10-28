// @vitest-environment node
import { abortReason, serveWorker } from '@yzt/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedTileset } from '../prepare-tileset';
import { buildNavigation, type NavBuildProgress } from './nav-build';
import { toEcef, translation } from './nav-frame';
import { b3dmOf, floorQuad, triangles } from './nav-testing';
import { navWorkerHandlers } from './nav-worker-handlers';
import type { NavWorkerProtocol } from './nav-worker-protocol';

// 原点在苏州站附近、局部系是东北天的根节点
function enuAt(lng: number, lat: number): number[] {
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return [...east, 0, ...north, 0, ...up, 0, ...toEcef(lng, lat, 0), 1];
}

const box = { box: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10] };
// 两个叶节点各是 6 × 4 米室内地板的一半，第二个的内容坐标往东平移了 6 米
const TILESET: PreparedTileset = {
  geometricError: 100,
  root: {
    geometricError: 50,
    boundingVolume: box,
    transform: enuAt(120.6647, 31.3175),
    children: [
      { geometricError: 0, boundingVolume: box, content: { uri: 'https://maps.test/a.b3dm' } },
      {
        geometricError: 0,
        boundingVolume: box,
        transform: Array.from(translation(6, 0, 0)),
        content: { uri: 'https://maps.test/b.b3dm' }
      }
    ]
  }
};
const TILES: Readonly<Record<string, Float32Array>> = {
  'https://maps.test/a.b3dm': triangles(floorQuad(0, 0, 6, 4, -5), floorQuad(0, 0, 6, 4, -2)),
  'https://maps.test/b.b3dm': triangles(floorQuad(0, 0, 6, 4, -5), floorQuad(0, 0, 6, 4, -2))
};

const ports: MessagePort[] = [];
afterEach(() => {
  ports.splice(0).forEach(port => port.close());
});

// 同一线程里的"Worker"：另一端口挂上真实的处理函数
const createWorker = vi.fn<() => MessagePort>(() => {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveWorker<NavWorkerProtocol>(port2, navWorkerHandlers);
  return port1;
});

const download = (url: string) => {
  const points = TILES[url];
  return points ? Promise.resolve(b3dmOf(points)) : Promise.reject(new Error(`没有 ${url}`));
};

describe('buildNavigation', () => {
  it('下载叶节点、报告进度，在 Worker 里构建；得到网格和局部系', async () => {
    const progress: NavBuildProgress[] = [];
    const { grid, frame } = await buildNavigation(TILESET, {
      signal: new AbortController().signal,
      download,
      createWorker,
      onProgress: item => progress.push(item)
    });

    expect(progress).toStrictEqual([
      { stage: 'download', done: 1, total: 2 },
      { stage: 'download', done: 2, total: 2 },
      { stage: 'build' }
    ]);
    expect(frame.north).toBeCloseTo(0, 6);
    expect(grid.meta).toMatchObject({ width: 61, height: 21 });
    // 两块拼起来是一整片：两端的地板属于同一个区域
    const west = grid.componentAt(1, 2, -5);
    expect(west).toBeGreaterThan(0);
    expect(grid.componentAt(11, 2, -5)).toBe(west);
    expect(grid.nodeHeadroom(grid.nodeAt(1, 2, -5))).toBeCloseTo(3, 1);
  });

  it('中止时停下下载、不创建 Worker，以 AbortError 结束', async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const pending = buildNavigation(TILESET, {
      signal: controller.signal,
      createWorker,
      download: (_url, signal) => {
        seen.push(signal);
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(abortReason(signal))));
      }
    });
    controller.abort();
    // 中止只经过微任务就该结束；没传下去的话会一直挂着，和 setTimeout(0) 赛跑
    const outcome = await Promise.race([
      pending.then(
        () => 'resolved',
        (error: unknown) => error
      ),
      new Promise(resolve => setTimeout(() => resolve('pending'), 0))
    ]);

    expect(outcome).toMatchObject({ name: 'AbortError' });
    expect(seen.every(signal => signal.aborted)).toBe(true);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('一个瓦片下载失败：停下其余的下载，报告这个错误', async () => {
    const seen: AbortSignal[] = [];
    const pending = buildNavigation(TILESET, {
      signal: new AbortController().signal,
      createWorker,
      download: (url, signal) => {
        seen.push(signal);
        if (url.endsWith('a.b3dm')) {
          return Promise.reject(new Error('瓦片下载失败（404）'));
        }
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(abortReason(signal))));
      }
    });

    await expect(pending).rejects.toThrow('瓦片下载失败（404）');
    expect(seen.every(signal => signal.aborted)).toBe(true);
  });

  it('根节点没有 transform 时抛错，不下载', async () => {
    const fetchTile = vi.fn<typeof download>(download);
    const plain: PreparedTileset = { ...TILESET, root: { ...TILESET.root, transform: undefined } };
    await expect(
      buildNavigation(plain, { signal: new AbortController().signal, download: fetchTile, createWorker })
    ).rejects.toThrow('瓦片集根节点没有 transform');
    expect(fetchTile).not.toHaveBeenCalled();
  });
});
