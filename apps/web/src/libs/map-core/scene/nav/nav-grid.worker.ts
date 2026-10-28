// 导航网格的 Worker 入口（ADR 0085 第 3 节），按 tsconfig.worker.json 检查
import { serveWorker } from '@yzt/utils';
import { navWorkerHandlers } from './nav-worker-handlers';
import type { NavWorkerProtocol } from './nav-worker-protocol';

serveWorker<NavWorkerProtocol>(self, navWorkerHandlers);
