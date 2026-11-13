// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createPingHandlers } from './scene-tier-ping-handlers';

// 假的 BroadcastChannel：消息同步送给处理函数，记下它发出的
function fakeChannel() {
  let listener: ((event: MessageEvent) => void) | undefined;
  const channel = {
    addEventListener: (_type: string, callback: (event: MessageEvent) => void) => {
      listener = callback;
    },
    postMessage: vi.fn<(message: unknown) => void>(),
    close: vi.fn<() => void>()
  };
  return {
    channel,
    asChannel: () => channel as unknown as BroadcastChannel,
    receive: (data: unknown) => listener?.(new MessageEvent('message', { data }))
  };
}

const context = { signal: new AbortController().signal, checkpoint: () => Promise.resolve() };

describe('createPingHandlers', () => {
  it('只回答问还在不在的消息，带上自己页面的 id', async () => {
    const fake = fakeChannel();
    const open = vi.fn<(name: string) => BroadcastChannel>(() => fake.asChannel());
    await createPingHandlers(open).listen({ channel: 'yzt.scene-tier', id: 'page-a' }, context);
    expect(open).toHaveBeenCalledWith('yzt.scene-tier');

    fake.receive({ kind: 'removed', id: 'page-b' });
    fake.receive({ kind: 'alive', id: 'page-b' });
    fake.receive('ping');
    fake.receive(null);
    expect(fake.channel.postMessage).not.toHaveBeenCalled();

    fake.receive({ kind: 'ping' });
    expect(fake.channel.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: 'alive', id: 'page-a' });
  });

  it('再 listen 一次时关掉之前的频道', async () => {
    const first = fakeChannel();
    const second = fakeChannel();
    const open = vi.fn<(name: string) => BroadcastChannel>();
    open.mockReturnValueOnce(first.asChannel()).mockReturnValueOnce(second.asChannel());
    const handlers = createPingHandlers(open);
    await handlers.listen({ channel: 'yzt.scene-tier', id: 'page-a' }, context);
    await handlers.listen({ channel: 'yzt.scene-tier', id: 'page-a' }, context);
    expect(first.channel.close).toHaveBeenCalledOnce();
    expect(second.channel.close).not.toHaveBeenCalled();
  });
});
