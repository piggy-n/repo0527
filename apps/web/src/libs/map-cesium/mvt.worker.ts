import 'core-js/es/symbol/dispose';
import { serveWorker } from '@yzt/utils';
import { createMvtWorkerHandler } from './mvt-worker-handler';
import type { MvtWorkerProtocol } from './mvt-worker-protocol';

// 多个消费者可共享同一父瓦片的下载，绘制各自拥有独立画布
const worker = createMvtWorkerHandler();
serveWorker<MvtWorkerProtocol>(self, worker.handlers, { concurrency: 4 });
