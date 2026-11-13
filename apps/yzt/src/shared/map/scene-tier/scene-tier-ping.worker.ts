// 替页面回答"还在"的 Worker 入口（ADR 0155 第 4 节），按 tsconfig.worker.json 检查
import { serveWorker } from '@mx/utils';
import { createPingHandlers } from './scene-tier-ping-handlers';
import type { ScenePingProtocol } from './scene-tier-ping-protocol';

serveWorker<ScenePingProtocol>(self, createPingHandlers());
