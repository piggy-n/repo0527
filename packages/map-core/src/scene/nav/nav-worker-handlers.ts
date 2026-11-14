import { type TaskContext, transfer, type WorkerHandlers } from '@mx/utils';
import { parseB3dmTriangles } from './b3dm';
import { buildNavGrid } from './heightfield';
import type { NavOptions } from './nav-data';
import type { NavWorkerProtocol } from './nav-worker-protocol';
import { parsePlyTriangles } from './ply';
import { labelRegions } from './regions';

// 解析好的三角形 → 高度场 → 区域，网格的类型化数组转移回主线程
async function buildGrid(sets: readonly Float32Array[], options: Partial<NavOptions>, { checkpoint }: TaskContext) {
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

/** Worker 里的处理函数：解析、构建高度场、算区域；放在普通模块里，测试用 MessageChannel 直接跑 */
export const navWorkerHandlers: WorkerHandlers<NavWorkerProtocol> = {
  build: ({ tiles, options }, context) =>
    buildGrid(
      tiles.map(tile => parseB3dmTriangles(tile.buffer, tile.toLocal)),
      options,
      context
    ),
  buildScan: ({ meshes, options }, context) =>
    buildGrid(
      meshes.map(buffer => parsePlyTriangles(buffer)),
      options,
      context
    )
};
