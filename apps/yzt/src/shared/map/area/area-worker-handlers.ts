import type { WorkerHandlers } from '@yzt/utils';
import { coverRegions } from './area-coverage';
import { readAreaFiles } from './area-file';
import { prepareArea } from './area-geometry';
import type { AreaWorkerProtocol } from './area-worker-protocol';

/** Worker 里的处理函数；放在普通模块里，测试用 MessageChannel 直接跑 */
export const areaWorkerHandlers: WorkerHandlers<AreaWorkerProtocol> = {
  read: ({ files }) => readAreaFiles(files),
  prepare: ({ polygons }) => prepareArea(polygons),
  cover: ({ area, regions, scopeName }, { checkpoint }) => coverRegions(area, regions, { scopeName, checkpoint })
};
