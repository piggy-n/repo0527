// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { connect, flushMessages, settled } from './testing';

interface TestProtocol {
  echo: { request: string; response: string };
}

// 同步占住线程，相当于负载高时进程被挂起：时间在走，事件循环不动
function blockThread(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // 忙等
  }
}

describe('worker testing helpers', () => {
  it('settled waits by event loop turns, so a reply still arrives after the thread was blocked', async () => {
    using ctx = connect<TestProtocol>({ echo: text => text });

    const reply = settled(ctx.client.request('echo', 'hello'));
    blockThread(50);

    await expect(reply).resolves.toBe('hello');
  });

  it('settled gives pending for a promise that never ends', async () => {
    expect(await settled(new Promise(() => undefined))).toBe('pending');
  });

  it('flushMessages returns after the messages sent before it have arrived', async () => {
    const received: unknown[] = [];
    const { port1, port2 } = new MessageChannel();
    port1.addEventListener('message', ({ data }: MessageEvent) => received.push(data));
    port1.start();
    port2.postMessage('sent before');

    await flushMessages();

    expect(received).toEqual(['sent before']);
    port1.close();
  });
});
