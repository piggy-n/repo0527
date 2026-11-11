// 方案 B 的 PoC：矢量瓦片栅格化的 Worker 入口，按 tsconfig.worker.json 检查
import { serveWorker } from '@mx/utils';
import type { MvtWorkerProtocol } from './mvt-protocol';
import { mvtWorkerHandlers } from './mvt-worker-handlers';

// 同时处理几个请求：下载可以重叠，解码和绘制本来就是一个一个来
serveWorker<MvtWorkerProtocol>(self, mvtWorkerHandlers, { concurrency: 4 });
