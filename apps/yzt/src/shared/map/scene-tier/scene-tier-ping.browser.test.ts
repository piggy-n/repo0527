import { WorkerHost } from '@mx/utils';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { ScenePingProtocol } from './scene-tier-ping-protocol';

const createWorker = () => new Worker(new URL('./scene-tier-ping.worker.ts', import.meta.url), { type: 'module' });

// 每个用例一个频道，互不干扰
function openChannel(): { name: string; channel: BroadcastChannel } {
  const name = `scene-tier-test-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
  const channel = new BroadcastChannel(name);
  onTestFinished(() => channel.close());
  return { name, channel };
}

// 等一条回答，或者等到超时（可能永远不来）
function nextMessage(channel: BroadcastChannel, timeoutMs: number): Promise<unknown> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    channel.addEventListener(
      'message',
      event => {
        clearTimeout(timer);
        resolve(event.data);
      },
      { once: true }
    );
  });
}

describe('scene-tier-ping.worker', () => {
  // 只回答问还在不在的消息：见 scene-tier-ping-handlers.test.ts
  it('开始听以后替页面回答"还在"', async () => {
    using host = new WorkerHost<ScenePingProtocol>({ createWorker });
    const { name, channel } = openChannel();
    await host.request('listen', { channel: name, id: 'page-a' });

    const answer = nextMessage(channel, 5000);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel 的 postMessage 没有 targetOrigin
    channel.postMessage({ kind: 'ping' });
    await expect(answer).resolves.toStrictEqual({ kind: 'alive', id: 'page-a' });
  });

  it('Worker 没了（页面崩溃）就没有回答', async () => {
    const host = new WorkerHost<ScenePingProtocol>({ createWorker });
    const { name, channel } = openChannel();
    await host.request('listen', { channel: name, id: 'page-a' });
    host[Symbol.dispose]();

    const answer = nextMessage(channel, 500);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel 的 postMessage 没有 targetOrigin
    channel.postMessage({ kind: 'ping' });
    await expect(answer).resolves.toBe('timeout');
  });
});
