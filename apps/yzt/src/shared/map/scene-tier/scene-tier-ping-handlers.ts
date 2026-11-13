import type { WorkerHandlers } from '@mx/utils';
import type { PingMessage, ScenePingProtocol } from './scene-tier-ping-protocol';

// 别的页面发来的消息：Worker 里只认"问还在不在"，不为这一项带上 zod
const isPing = (data: unknown): boolean =>
  typeof data === 'object' && data !== null && 'kind' in data && data.kind === 'ping';

/**
 * Worker 里的处理函数：页面的主线程忙着加载三维时 Worker 照样马上回答，页面崩溃时 Worker 跟着没了，
 * 所以"忙"和"死"分得开。频道一直开着，随 Worker 结束
 */
export function createPingHandlers(
  open: (name: string) => BroadcastChannel = name => new BroadcastChannel(name)
): WorkerHandlers<ScenePingProtocol> {
  let channel: BroadcastChannel | undefined;
  return {
    listen: ({ channel: name, id }) => {
      channel?.close();
      const opened = open(name);
      opened.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (isPing(event.data)) {
          const alive: PingMessage = { kind: 'alive', id };
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel 的 postMessage 没有 targetOrigin
          opened.postMessage(alive);
        }
      });
      channel = opened;
    }
  };
}
