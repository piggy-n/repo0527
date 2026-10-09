# 0030. 视图失败的原因作为数据

- 状态：已接受
- 日期：2026-10-10
- 修正 ADR 0026 第 4 条"两种失败共用 `failed` 状态，原因从 `whenReady()` 取得，不另加 API"

## 背景

ADR 0026 把视图的失败分成两种：

| 原因 | 例子 | 恢复方式 |
|---|---|---|
| 引擎失败 | 不支持 WebGL2（MapLibre 6 抛出 `GPUInitializationError`）、`setStyle` 本身抛错 | 不能恢复，只能释放后重新创建视图 |
| 样式失败 | 整份样式通不过校验，MapLibre 只发 `error` 事件 | 样式出现新版本时自动重新加载 |

当时没有使用方，决定两种失败共用 `failed`，原因只从 `whenReady()` 的拒绝里取得。5A.3 要做失败提示，遇到三个问题：

- 两种失败的提示不同：引擎失败要说明原因并提供"重试"；样式失败会自动恢复，提供重试反而误导
- 只看错误对象分不出是哪一种：适配器在两条路径上拿到的都是普通的错误，只有适配器自己知道走的是哪条路径
- 判断"不支持 WebGL2"要用 `instanceof GPUInitializationError`，而只有 `libs/map-core/maplibre/` 和 `app/` 能导入 maplibre-gl（ADR 0024），放提示的 `shared/map` 做不到
- 界面要和逻辑解耦（5A.3 决定界面后置到 5D）：状态和原因应当是可以直接读取的数据，而不是从一个 Promise 里异步取出来

## 决定

### 1. `MapView` 增加 `failure`

```ts
type MapViewFailure =
  | { kind: 'engine'; cause: 'webgl-unavailable' | 'unknown'; error: unknown }
  | { kind: 'style'; error: unknown };

interface MapView {
  /** 只在 failed 状态下有值 */
  readonly failure: MapViewFailure | null;
}
```

- 适配器按自己走的路径给出 `kind`；引擎失败时用 `instanceof GPUInitializationError` 判断 `webgl-unavailable`。三维视图遇到 WebGL 创建失败时给出同样的值
- 离开 `failed`（重新加载、恢复）和释放时清空
- 状态或失败原因任一变化都发出 `statechange`，监听者收到 `failed` 时已经能读到原因。实际流程里从一种失败到另一种失败总会先经过 `initializing`，这只是兜底
- `whenReady()` 的语义不变，仍以失败的原因结束

### 2. map-vue：只读的 `failure` 与 `retry()`

- 上下文和页面句柄增加 `failure`（`shallowReadonly`），与 `viewState` 一起更新，卸下视图时清空
- 增加 `retry()`：只在引擎失败时有效，由画布组件先卸下、释放旧视图，再在同一个容器里创建新视图；样式失败和没有失败时什么也不做。页面不需要为重试管理画布的 `key`

### 3. 提示的内容由纯函数推导

`shared/map` 的 `describeMapStatus(viewState, failure)` 决定显示什么：加载中、引擎失败（标题、说明、技术细节、可以重试）、样式失败（标题、说明、技术细节，不重试）。界面组件只负责显示，5D 重新设计界面时这个函数保留。

### 4. 暂不处理的

运行中 WebGL 上下文丢失（`webglcontextlost`）：适配器目前没有处理，MapLibre 恢复上下文失败时会通过 `error` 事件发出 `GPUInitializationError`。等真实环境里遇到再做，记在 roadmap。

## 后果

- 好处：提示可以准确地区分两种失败；原因是同步可读的数据，界面不用从 Promise 里取；`shared/map` 不需要知道 MapLibre 的错误类
- 代价：`MapView` 接口多了一个属性，三维视图实现时要同样给出；`MapViewport` 之外，上下文多了 `retry()` 这个写操作，但它只在引擎失败时生效
