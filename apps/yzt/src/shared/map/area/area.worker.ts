// 范围分析的 Worker 入口，按 tsconfig.worker.json 检查
import { serveWorker } from '@mx/utils';
import { areaWorkerHandlers } from './area-worker-handlers';
import type { AreaWorkerProtocol } from './area-worker-protocol';

serveWorker<AreaWorkerProtocol>(self, areaWorkerHandlers);
