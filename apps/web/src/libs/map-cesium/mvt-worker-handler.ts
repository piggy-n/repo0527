import { TileDataService, type TileDataStats } from '@yzt/map-core/worker';
import { transfer, type WorkerHandlers } from '@yzt/utils';
import { renderMvt } from './mvt-render';
import type { MvtWorkerProtocol } from './mvt-worker-protocol';
import { compileStylePlan } from './style-plan';

export interface MvtWorkerHandler extends Disposable {
  readonly handlers: WorkerHandlers<MvtWorkerProtocol>;
}

/** 一个 Worker 拥有一个数据服务，重建时由首个请求重新确认预算 */
export function createMvtWorkerHandler({
  fetch: fetchTile = globalThis.fetch,
  render = renderMvt
}: { readonly fetch?: typeof fetch; readonly render?: typeof renderMvt } = {}): MvtWorkerHandler {
  let service: TileDataService | undefined;
  let budget: number | undefined;
  let disposed = false;
  return {
    handlers: {
      render: async (request, context) => {
        if (disposed) { throw new DOMException('MVT Worker 已释放', 'AbortError'); }
        context.signal.throwIfAborted();
        if (!service) {
          service = new TileDataService({ budgetBytes: request.budgetBytes, fetch: fetchTile });
          budget = request.budgetBytes;
        } else if (budget !== request.budgetBytes) {
          throw new Error('同一 MVT Worker 的缓存预算不能在绘制期间改变');
        }
        const sourceId = 'source' in request.layer ? request.layer.source : undefined;
        if (!sourceId) { throw new Error('MVT 图层缺少数据源'); }
        const plan = compileStylePlan({
          version: 8, sources: { [sourceId]: request.source }, layers: [request.layer]
        }, request.images);
        const layer = plan.layers[0];
        if (!layer || plan.issues.length > 0) {
          throw plan.issues[0]?.error ?? new Error('无法编译 MVT 图层');
        }
        const data = await service.acquire(request.data, { signal: context.signal });
        context.signal.throwIfAborted();
        const bitmap = await render({
          data, layer, source: request.source, coordinate: request.data.coordinate,
          tile: request.tile, cameraZoom: request.cameraZoom, tileSize: request.tileSize, context
        });
        try {
          context.signal.throwIfAborted();
          return transfer(bitmap, [bitmap]);
        } catch (error) {
          bitmap.close();
          throw error;
        }
      },
      stats: (): TileDataStats | null => service?.stats ?? null
    },
    [Symbol.dispose]: () => {
      if (disposed) { return; }
      disposed = true;
      service?.[Symbol.dispose]();
      service = undefined;
    }
  };
}
