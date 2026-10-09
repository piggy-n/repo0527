# libs/utils（@yzt/utils）

纯 TS 的通用工具，不依赖 Vue、Element、Pinia（AGENTS.md"依赖方向"）。目前只有一部分：Worker 通信层。

相关决策：ADR 0021（Worker 策略）、ADR 0025（Worker 通信契约）。

## Worker 通信层

所有自建的 Worker 都用它：有类型的协议、请求与响应按 ID 配对、三层取消、明确的故障语义、可以转移所有权的数据。二维不自建渲染 Worker（ADR 0021），第一批使用方是以后三维的瓦片栅格化、二维图例统计（实测后决定）。

### 结构

| 文件 | 内容 |
|---|---|
| `worker/protocol.ts` | 协议与消息的类型、`WorkerEndpoint`、错误的序列化与错误类、`transfer` 标记 |
| `worker/worker-server.ts` | Worker 里的一侧：`serveWorker`（任务队列、取消、`checkpoint`） |
| `worker/worker-client.ts` | 主线程的一侧：`WorkerClient` |
| `worker/worker-host.ts` | 托管一个 Worker：`WorkerHost`（第一次请求时创建、崩溃后重建、次数上限） |
| `worker/yield.ts` | `yieldToEventLoop` |
| `worker/testing.ts` | 只供测试使用：`TestEndpoint`、`connect`、`gate`、`settled` |

两侧只依赖窄接口 `WorkerEndpoint`（`postMessage`、`addEventListener`，可选的 `start`、`terminate`）。`Worker`、`MessagePort` 和 Worker 里的 `self` 都满足它，所以 utils 不需要 `WebWorker` 环境的类型；真实的 Worker 入口文件出现时，再配置单独的 tsconfig（ADR 0018 的待定事项）。

### 用法

```ts
// 协议是普通 interface，主线程和 Worker 入口各自 import type 同一份
interface TileProtocol {
  decode: { request: { url: string; fields: string[] }; response: DecodedTile };
  stats: { request: undefined; response: CacheStats };
}

// 主线程：参数和返回值按方法名推断，写错方法名会报类型错误
using host = new WorkerHost<TileProtocol>({
  createWorker: () => new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' }),
  discard: { decode: tile => tile.bitmap.close() }
});
const tile = await host.request('decode', { url, fields }, { signal });

// Worker 里
serveWorker<TileProtocol>(self, {
  async decode({ url, fields }, { signal, checkpoint }) {
    const buffer = await (await fetch(url, { signal })).arrayBuffer();
    for (const layer of layers) {
      decodeLayer(layer);
      // oxlint-disable-next-line no-await-in-loop -- 分段执行：每段之间让出事件循环，取消消息才能被处理
      await checkpoint();
    }
    return transfer(result, [result.bitmap]);
  },
  stats: () => cache.stats()
});
```

- 创建 Worker 的函数由使用方提供，utils 不写死任何地址
- 只想直接用一个端点（例如测试、或者自己管理 Worker 的生命周期）时，用 `WorkerClient`；它不负责终止 Worker
- 循环里 `await checkpoint()` 会触发 lint 的 `no-await-in-loop`，这是分段让出的标准写法，按 AGENTS.md 写关闭注释并说明原因
- `checkpoint` 声明为函数属性，从 context 里解构出来使用不会丢 `this`

### 取消

| 层次 | 实现 |
|---|---|
| 调用方 | `signal` 一中止，Promise 立即以 `signal.reason` 结束（默认 `AbortError`，`AbortSignal.timeout()` 为 `TimeoutError`；原因不是错误对象时改用 `AbortError`），同时发出取消消息 |
| 排队中的任务 | `serveWorker` 默认一次执行一个任务（`concurrency` 可配置），取消消息到达时还没开始的任务直接移除，不再回复 |
| 执行中的任务 | 取消消息到达时中止处理函数收到的 `signal`，它可以直接传给 `fetch` |
| 计算 | `checkpoint()` 通过 `MessageChannel` 让出一次事件循环，再 `throwIfAborted()` |

`safeReporter(report, label)` 从入口导出：包装外部传入的错误报告器，报告器自己抛错时改为打印到控制台（连同原始错误），调用方后续的状态转换和资源释放不受影响。MapLibre 视图和 map-vue 的 `provideMap` 在入口用它包装 `onError`。

`abortReason(signal)` 从入口导出，其他模块按同样的规则把 `signal.reason` 变成错误对象（map-vue 的 `whenReady` 在用）：`signal.reason` 的类型是 `any`，不是错误对象时改用 `AbortError`；判断时兼容 jsdom 里 `DOMException` 不是 `Error` 实例的情况。

取消消息在路上时，排队的任务可能已经开始，这个窗口无法消除：这时由"执行中的任务"这一层中止它。服务端仍可能回复结果，结果消息里带着方法名，客户端据此调用 `discard` 释放（例如 `ImageBitmap.close()`），不需要另外记录哪些请求被取消了。

### 故障

| 情况 | 结果 |
|---|---|
| 处理函数抛错 | 以 `WorkerTaskError` 结束，`name` 保留原错误名，Worker 里的调用栈在 `workerStack` |
| 结果无法克隆 | Worker 里 `postMessage` 抛 `DataCloneError`，改为回复失败 |
| 参数无法克隆 | 主线程同步捕获，只结束这一个请求 |
| 主线程一侧的端点触发 `error` 或 `messageerror` | 等待中的请求都以 `WorkerCrashedError` 结束，客户端失效，之后的请求立即以同一个错误结束 |
| Worker 一侧触发 `messageerror`（收到的消息无法反序列化） | 事件不带数据，Worker 不知道是哪个请求，主线程也推断不出来（还有消息在路上）：`serveWorker` 回复一条不带 ID 的 `fault` 消息后停止服务、中止执行中的任务；客户端收到后按上一行处理 |
| `WorkerHost` 托管的 Worker 崩溃 | 终止它，下次请求时新建；连续崩溃超过 `maxRestarts`（默认 3）后以 `WorkerUnavailableError` 拒绝；成功一次就重新计数；创建 Worker 本身失败（如浏览器不支持）不算崩溃 |
| 释放 | 等待中的请求以 `AbortError` 结束，之后的请求以"已释放"拒绝；`WorkerHost` 同时终止 Worker |
| 超时 | 默认不设，需要时传 `AbortSignal.timeout(ms)` |

### 实现时核实的浏览器差异

| 事实 | 处理 |
|---|---|
| Safari 不支持错误对象的结构化克隆（MDN：Chrome 77、Firefox 103 支持） | 错误显式序列化为 `{ name, message, stack }` |
| `AbortSignal.any()` 要 Chrome 116、Safari 17.4，不在目标浏览器内 | 不使用 |
| `scheduler.yield` 支持不全；`setTimeout(0)` 嵌套后至少 4ms | 用 `MessageChannel` 让出 |
| jsdom 里 `DOMException` 不是 `Error` 的实例（浏览器里是） | 判断错误时同时认 `instanceof DOMException` |

### 测试

- 客户端和服务端分别接在同一个 `MessageChannel` 的两端（`testing.ts` 的 `connect`），结构化克隆、所有权转移、`DataCloneError` 都是真实发生的
- jsdom 里不能往真实的 `MessagePort` 派发事件（端口来自 Node，`Event` 来自 jsdom），模拟崩溃用 `TestEndpoint`：消息转发给端口，`crash()` 触发 `error` 或 `messageerror`
- 测试和"Worker"在同一个线程里：取消消息要等下一个任务才送达，测"排队时被取消"要先等它到达
- 实现出错时可能一直挂起的等待都包进 `settled()`，测试因断言失败而不是超时
- `connect` 的两端都是 `TestEndpoint`：`endpoint.crash()` 模拟主线程一侧的故障，`serverEndpoint.crash()` 模拟 Worker 一侧的故障
- 逐一改坏 25 处，24 处由断言发现（补上 Worker 一侧的 `messageerror` 后又改坏 6 处，全部发现）；"释放后不移除服务端的消息监听"测不出来：消息处理函数开头的 `disposed` 检查已经挡住了消息，移除监听只是让对象可以被回收

### 还没做的

等第一个真实使用方出现、用真实瓦片验证后再做（ADR 0025 第 7 条）：多个 Worker 之间的调度（负载均衡、父瓦片固定给同一个 Worker）、空闲一段时间后终止 Worker、缓存与内存预算；真实 Worker 在 Vite 下的打包与加载，到时在 `/dev` 开发页里验证。
