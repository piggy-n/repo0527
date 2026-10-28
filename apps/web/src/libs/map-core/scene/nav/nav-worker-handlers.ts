import { transfer, type WorkerHandlers } from '@yzt/utils';
import { parseB3dmTriangles } from './b3dm';
import { buildNavGrid } from './heightfield';
import type { NavWorkerProtocol } from './nav-worker-protocol';
import { labelRegions } from './regions';

/** Worker 里的处理函数：解析、构建高度场、算区域；放在普通模块里，测试用 MessageChannel 直接跑 */
export const navWorkerHandlers: WorkerHandlers<NavWorkerProtocol> = {
  async build({ tiles, options }, { checkpoint }) {
    const sets = tiles.map(tile => parseB3dmTriangles(tile.buffer, tile.toLocal));
    await checkpoint();
    const raw = buildNavGrid(sets, options);
    await checkpoint();
    const grid = labelRegions(raw, options);
    return transfer(grid, [
      grid.chunkIndex.buffer,
      grid.data.buffer,
      grid.headroom.buffer,
      grid.labels.buffer,
      grid.sizes.buffer
    ]);
  }
};
