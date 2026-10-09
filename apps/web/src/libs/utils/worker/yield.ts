/**
 * 让出一次事件循环，已经到达的消息（如取消）得以先处理
 * 用 MessageChannel 而不是 setTimeout(0)：后者嵌套几层后至少延迟 4ms；scheduler.yield 的浏览器支持还不够
 */
export function yieldToEventLoop(): Promise<void> {
  const { port1, port2 } = new MessageChannel();
  return new Promise(resolve => {
    port1.addEventListener(
      'message',
      () => {
        port1.close();
        port2.close();
        resolve();
      },
      { once: true }
    );
    port1.start();
    port2.postMessage(null);
  });
}
