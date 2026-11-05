import { type WorkerEndpoint, WorkerHost } from '@mx/utils';
import type { CoverOutcome, RegionShape } from './area-coverage';
import type { AreaFileResult } from './area-file';
import { type AreaCheck, type AreaGeometry, AREA_LIMITS, type PolygonCoordinates, problem } from './area-geometry';
import type { AreaWorkerProtocol } from './area-worker-protocol';

/** 范围分析：读文件、整理范围、与行政区求交都在 Worker 里做，页面不卡；中止时以 AbortError 结束 */
export interface AreaAnalyzer extends Disposable {
  /** 读用户选的文件：一个 GeoJSON、一个压缩包，或同一组 Shapefile */
  read(files: readonly File[], signal: AbortSignal): Promise<AreaFileResult>;
  /** 整理画的范围：多边形 → 环 → 节点 */
  prepare(polygons: PolygonCoordinates, signal: AbortSignal): Promise<AreaCheck>;
  /** 与行政区求交；scopeName 是这组行政区合起来的名称，写进提示 */
  cover(
    area: AreaGeometry,
    regions: readonly RegionShape[],
    scopeName: string,
    signal: AbortSignal
  ): Promise<CoverOutcome>;
}

const createAreaWorker = (): WorkerEndpoint =>
  new Worker(new URL('./area.worker.ts', import.meta.url), { type: 'module', name: 'area' });

const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** 创建范围分析；Worker 在第一次请求时创建，崩溃后重建，释放时终止。测试注入同一线程里的端点 */
export function createAreaAnalyzer(createWorker: () => WorkerEndpoint = createAreaWorker): AreaAnalyzer {
  const host = new WorkerHost<AreaWorkerProtocol>({ createWorker });
  return {
    async read(files, signal) {
      // 读进内存之前先按大小拦下：Worker 里还会按类型、内容再检查
      const size = files.reduce((sum, file) => sum + file.size, 0);
      if (size > AREA_LIMITS.fileBytes) {
        return problem('file-size', `文件共 ${formatBytes(size)}，超过 ${formatBytes(AREA_LIMITS.fileBytes)} 的上限`);
      }
      const loaded = await Promise.all(
        files.map(async file => ({ name: file.name, buffer: await file.arrayBuffer() }))
      );
      signal.throwIfAborted();
      return host.request('read', { files: loaded }, { signal, transfer: loaded.map(file => file.buffer) });
    },
    prepare: (polygons, signal) => host.request('prepare', { polygons }, { signal }),
    cover: (area, regions, scopeName, signal) => host.request('cover', { area, regions, scopeName }, { signal }),
    [Symbol.dispose]: () => host[Symbol.dispose]()
  };
}
