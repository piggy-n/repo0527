import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl, CesiumWidget } from 'cesium';
import { MapSession, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { CesiumView } from './cesium-view';
import { mvtFixtureUrl } from './mvt-fixture';
import { MvtWorkerPool } from './mvt-worker-pool';
import type { MvtRenderRequest } from './mvt-worker-protocol';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

// 超时结束等待但由断言报告失败，所有计时器随等待结束清除
async function bounded<T>(promise: Promise<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      promise.then(value => ({ ready: true as const, value })),
      new Promise<{ readonly ready: false }>(resolve => {
        timer = setTimeout(() => resolve({ ready: false }), milliseconds);
      })
    ]);
    expect(result.ready).toBe(true);
    if (!result.ready) { throw new Error('三维验收等待未结束'); }
    return result.value;
  } finally {
    clearTimeout(timer);
  }
}

// 不访问池内部状态，真实消息端口和池的公开统计共同证明背压与缓存预算
function loadRequest(url: string, index: number): Omit<MvtRenderRequest, 'budgetBytes'> {
  const coordinate = { x: index % 16, y: Math.floor(index / 16), z: 4 };
  return {
    data: {
      source: { tiles: [url], dataVersion: String(Math.floor(index / 4)), permissionScope: 'acceptance' },
      coordinate, url, fields: []
    },
    source: { type: 'vector', tiles: [url] },
    layer: { id: 'fill', type: 'fill', source: 'mvt', 'source-layer': 'landuse', paint: { 'fill-color': '#00ff00' } },
    tile: coordinate, cameraZoom: 4, tileSize: 512
  };
}

interface WorkerRecord {
  readonly kind: 'mvt' | 'sdk';
  terminated: boolean;
}

// 只观察浏览器公开 Worker 生命周期，SDK 的模块级线程与视图自己的线程分别计数
function watchWorkers() {
  const NativeWorker = globalThis.Worker;
  const records: WorkerRecord[] = [];
  class ObservedWorker extends NativeWorker {
    readonly record: WorkerRecord;
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.record = { kind: String(url).includes('mvt.worker') ? 'mvt' : 'sdk', terminated: false };
      records.push(this.record);
    }
    override terminate(): void {
      this.record.terminated = true;
      super.terminate();
    }
  }
  vi.stubGlobal('Worker', ObservedWorker);
  return {
    records,
    live: (kind: WorkerRecord['kind']) => records.filter(record => record.kind === kind && !record.terminated).length,
    [Symbol.dispose]: () => vi.stubGlobal('Worker', NativeWorker)
  };
}

// WebGL 的公开创建/删除方法衡量显式资源所有权，不把对象数量冒称为显存字节
function watchGpu() {
  const textures = new Map<WebGLTexture, WebGL2RenderingContext>();
  const buffers = new Map<WebGLBuffer, WebGL2RenderingContext>();
  const contexts = new Set<WebGL2RenderingContext>();
  let texturePeak = 0;
  let bufferPeak = 0;
  let deletedTextures = 0;
  let deletedBuffers = 0;
  const prototype = WebGL2RenderingContext.prototype;
  // oxlint-disable-next-line typescript/unbound-method -- 包装器使用 call 传回原始 WebGL 上下文
  const createTexture = prototype.createTexture;
  // oxlint-disable-next-line typescript/unbound-method -- 包装器使用 call 传回原始 WebGL 上下文
  const deleteTexture = prototype.deleteTexture;
  // oxlint-disable-next-line typescript/unbound-method -- 包装器使用 call 传回原始 WebGL 上下文
  const createBuffer = prototype.createBuffer;
  // oxlint-disable-next-line typescript/unbound-method -- 包装器使用 call 传回原始 WebGL 上下文
  const deleteBuffer = prototype.deleteBuffer;
  const spies = [
    vi.spyOn(prototype, 'createTexture').mockImplementation(function (this: WebGL2RenderingContext) {
      const texture = createTexture.call(this);
      contexts.add(this);
      if (texture) {
        textures.set(texture, this);
        texturePeak = Math.max(texturePeak, [...textures.values()].filter(context => !context.isContextLost()).length);
      }
      return texture;
    }),
    vi.spyOn(prototype, 'deleteTexture').mockImplementation(function (this: WebGL2RenderingContext, texture) {
      if (texture && textures.delete(texture)) { deletedTextures++; }
      deleteTexture.call(this, texture);
    }),
    vi.spyOn(prototype, 'createBuffer').mockImplementation(function (this: WebGL2RenderingContext) {
      const buffer = createBuffer.call(this);
      contexts.add(this);
      if (buffer) {
        buffers.set(buffer, this);
        bufferPeak = Math.max(bufferPeak, [...buffers.values()].filter(context => !context.isContextLost()).length);
      }
      return buffer;
    }),
    vi.spyOn(prototype, 'deleteBuffer').mockImplementation(function (this: WebGL2RenderingContext, buffer) {
      if (buffer && buffers.delete(buffer)) { deletedBuffers++; }
      deleteBuffer.call(this, buffer);
    })
  ];
  return {
    current: () => ({ textures: [...textures].filter(([texture, context]) => context.isTexture(texture)).length,
      buffers: [...buffers].filter(([buffer, context]) => context.isBuffer(buffer)).length }),
    closed: () => [...contexts].every(context => context.isContextLost()),
    deleted: () => ({ textures: deletedTextures, buffers: deletedBuffers }),
    peak: () => ({ textures: texturePeak, buffers: bufferPeak }),
    [Symbol.dispose]: () => spies.forEach(spy => spy.mockRestore())
  };
}

// 在动作前登记稳定帧，并检查实际像素，不能把状态 ready 当成纹理已经显示
function rendered(view: CesiumView, container: HTMLElement, action: () => void = () => {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { throw new Error('验收需要二维画布'); }
  const started = performance.now();
  let remove: (() => void) | undefined;
  const result = new Promise<number>(resolve => {
    remove = view.on('settle', () => {
      const output = container.querySelector('canvas');
      if (!output) { return; }
      context.drawImage(output, output.width / 2, output.height / 2, 1, 1, 0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      if (red < 5 && green > 250 && blue < 5) { resolve(performance.now() - started); }
    });
  });
  action();
  return bounded(result).finally(() => remove?.());
}

function sampleGroup(): StyleGroup {
  return {
    sources: { mvt: { type: 'vector', tiles: [mvtFixtureUrl()], maxzoom: 0 } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
      { id: 'fill', type: 'fill', source: 'mvt', 'source-layer': 'landuse', paint: { 'fill-color': '#00ff00' } }
    ]
  };
}

describe('三维负载与资源释放验收', () => {
  it.each([64 * 1024 * 1024, 8 * 1024])('真实 Worker 连续负载遵守 %i 字节缓存与 16 请求上限', async budgetBytes => {
    using workers = watchWorkers();
    using pool = new MvtWorkerPool({ budgetBytes });
    const url = mvtFixtureUrl();
    const times: number[] = [];
    for (let round = 0; round < 6; round++) {
      const started = performance.now();
      const requests = Array.from({ length: 16 }, (_, index) => pool.render(loadRequest(url, round * 16 + index),
        new AbortController().signal).then(bitmap => {
        expect(bitmap.width).toBe(512);
        bitmap.close();
        expect(bitmap.width).toBe(0);
        return undefined;
      }));
      expect(pool.hasCapacity).toBe(false);
      // oxlint-disable-next-line no-await-in-loop -- 每批先确认第 17 个任务受到背压，再观察本批资源归还
      await expect(pool.render(loadRequest(url, 128), new AbortController().signal))
        .rejects.toMatchObject({ name: 'AbortError' });
      // oxlint-disable-next-line no-await-in-loop -- 批次串行才能检查上批完成后没有累计工作集
      await bounded(Promise.all(requests));
      times.push(performance.now() - started);
      // oxlint-disable-next-line no-await-in-loop -- 缓存统计属于当前已完成批次
      const stats = await bounded(pool.stats());
      expect(stats).toHaveLength(2);
      for (const worker of stats) {
        expect(worker).not.toBeNull();
        expect(worker?.budget).toBe(budgetBytes / 2);
        expect(worker?.bytes).toBeLessThanOrEqual(budgetBytes / 2);
        expect(worker?.inflight).toBe(0);
        expect(worker?.sources).toBeLessThanOrEqual(worker?.tiles ?? 0);
      }
      expect(pool.hasCapacity).toBe(true);
    }
    const final = await bounded(pool.stats());
    expect(final.reduce((sum, worker) => sum + (worker?.downloads ?? 0), 0)).toBe(96);
    expect(final.reduce((sum, worker) => sum + (worker?.tiles ?? 0), 0))
      .toBeLessThanOrEqual(budgetBytes === 8192 ? 95 : 96);
    const cancelled = Array.from({ length: 16 }, (_, index) => pool.render(loadRequest(url, index),
      new AbortController().signal).then(() => 'resolved', (error: unknown) => error));
    pool.pause();
    for (const result of await bounded(Promise.all(cancelled))) {
      expect(result).toMatchObject({ name: 'AbortError' });
    }
    pool.resume();
    const bitmap = await bounded(pool.render(loadRequest(url, 0), new AbortController().signal));
    bitmap.close();
    expect((await bounded(pool.stats())).every(worker => worker?.inflight === 0)).toBe(true);
    expect(workers.live('mvt')).toBe(2);
    pool[Symbol.dispose]();
    expect(workers.live('mvt')).toBe(0);
    expect(await pool.stats()).toEqual([]);
    // oxlint-disable-next-line no-console -- 验收保留本机批次计时，时间不是跨机器性能门槛
    console.info('3D.4 Worker 批次毫秒', JSON.stringify({ budgetBytes, times, final }));
  }, 30000);

  it('真实视图连续移动和暂停恢复后，重复销毁归还 Worker、监听、GPU 对象与 DOM', async () => {
    using workers = watchWorkers();
    using gpu = watchGpu();
    const failures: unknown[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- 诊断包装保持池实例和参数，记录取消后继续抛出原错误
    const render = MvtWorkerPool.prototype.render;
    const renderSpy = vi.spyOn(MvtWorkerPool.prototype, 'render').mockImplementation(function (
      this: MvtWorkerPool, request, signal
    ) {
      return render.call(this, request, signal).catch((error: unknown) => { failures.push(error); throw error; });
    });
    const sdkLogs: unknown[][] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { sdkLogs.push(values); });
    const destroyed: CesiumWidget[] = [];
    const releasedListeners: number[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- 只包装公开销毁方法，call 保留 SDK 实例
    const destroy = CesiumWidget.prototype.destroy;
    const destroySpy = vi.spyOn(CesiumWidget.prototype, 'destroy').mockImplementation(function (this: CesiumWidget) {
      const { preRender, postRender } = this.scene;
      destroy.call(this);
      releasedListeners.push(preRender.numberOfListeners + postRender.numberOfListeners);
      destroyed.push(this);
    });
    const timings: {
      readonly cold: number; readonly moves: readonly number[]; readonly resumes: readonly number[]
    }[] = [];
    let initialSdkWorkers: number | undefined;
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const container = document.body.appendChild(document.createElement('div'));
        container.style.cssText = 'width:512px;height:512px;';
        using session = new MapSession({
          groups: ['sample'], camera: { center: [-100, 40], zoom: 8, bearing: 0, pitch: 0 }
        });
        session.style.setGroup('sample', sampleGroup());
        const errors: unknown[] = [];
        using view = new CesiumView({
          session, container, assetBaseUrl: '/cesium/', onError: error => errors.push(error)
        });
        try {
          // oxlint-disable-next-line no-await-in-loop -- 每次新建场景分别测量首次画面，旧场景已彻底释放
          const cold = await rendered(view, container);
          const context = container.querySelector('canvas')?.getContext('webgl2');
          expect(context).not.toBeNull();
          const moves: number[] = [];
          const resumes: number[] = [];
          for (let step = 0; step < 3; step++) {
            // oxlint-disable-next-line no-await-in-loop -- 连续移动结束后确认最后一帧收敛，不能并行覆盖相机意图
            moves.push(await rendered(view, container, () => {
              view.flyTo({ center: [-100 + step * 0.05, 40], zoom: 8 + step * 0.2 }, { duration: 100 });
            }));
            view.pause();
            expect(view.state).toBe('paused');
            expect(context?.isContextLost()).toBe(false);
            const camera = session.camera.current;
            expect(workers.live('mvt')).toBeLessThanOrEqual(2);
            // oxlint-disable-next-line no-await-in-loop -- 每次暂停恢复都验证真实画面和缓存视图的状态
            resumes.push(await rendered(view, container, () => view.resume()));
            expect(session.camera.current.center[0]).toBeCloseTo(camera.center[0], 7);
          }
          timings.push({ cold, moves, resumes });
          expect(view.sourceErrors.size).toBe(0);
          expect(errors).toEqual([]);
          view[Symbol.dispose]();
          expect(container.querySelector('canvas')).toBeNull();
          expect(view.state).toBe('disposed');
          expect(destroyed).toHaveLength(cycle + 1);
          expect(destroyed.every(widget => widget.isDestroyed())).toBe(true);
          expect(workers.live('mvt')).toBe(0);
          expect(releasedListeners.at(-1)).toBe(0);
          expect(context?.isContextLost()).toBe(true);
          expect(gpu.closed()).toBe(true);
          expect(gpu.current()).toEqual({ textures: 0, buffers: 0 });
          const sdkWorkers = workers.records.filter(record => record.kind === 'sdk').length;
          initialSdkWorkers ??= sdkWorkers;
          expect(sdkWorkers).toBe(initialSdkWorkers);
        } finally {
          view[Symbol.dispose]();
          container.remove();
        }
      }
      expect(gpu.peak().textures).toBeGreaterThan(0);
      expect(gpu.peak().buffers).toBeGreaterThan(0);
      expect(failures.length).toBeGreaterThan(0);
      for (const failure of failures) { expect(failure).toMatchObject({ name: 'AbortError' }); }
      expect(sdkLogs).toEqual([]);
      // oxlint-disable-next-line no-console -- 验收分别记录耗时与公开 GPU 对象计数，不声称总内存上限
      console.info('3D.4 场景毫秒及资源峰值', JSON.stringify({ timings, gpu: gpu.peak(), deleted: gpu.deleted(),
        sdkWorkers: initialSdkWorkers, cancellations: failures.length, sdkLogs: sdkLogs.length }));
    } finally {
      renderSpy.mockRestore();
      logSpy.mockRestore();
      destroySpy.mockRestore();
    }
  }, 90000);
});
