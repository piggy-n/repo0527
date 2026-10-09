# 0023. 资源释放、事件与地图运行时装配

- 状态：已接受
- 日期：2026-10-09

## 背景

旧项目（yzt `master-demo` 836f03b）在资源释放上的问题（见 [modules/map-core.md](../modules/map-core.md)"要改进的地方"）：

- 先把处理函数存下来，销毁时逐个解绑：`MapService` 存了 11 个，`GeometryDrawManager` 存了 9 个
- `MapService.destroy()` 手写十几个对象的销毁顺序
- 资源归属不清导致过崩溃：路由切换时子组件先 `map.remove()`，父页面后销毁绘制管理器，此时 `map.style` 已经是 undefined
- `MapboxEngine.destroy` 丢掉了 `whenReady` 的 resolver，等待中的 Promise 永远不结束
- 通信渠道很多，其中 mitt 全局总线的事件名是字符串，没有类型

阶段四的学习点包括 `using` / Disposable。2026-10-09 实测的支持情况：

| 环节 | 结果 |
|---|---|
| TS 7.0.2 | `lib` 要加 `esnext.disposable`，否则找不到 `Disposable`、`DisposableStack`、`Symbol.dispose` 的类型 |
| Vite 8 构建 | 默认目标是 `chrome111`、`edge111`、`firefox114`、`safari16.4`、`ios16.4`；Oxc 把 `using` 语法降级成辅助函数，但 `new DisposableStack()` 和 `Symbol.dispose` 原样保留 |
| Node 24（Vitest） | 原生支持 |
| 浏览器（MDN 兼容性数据 8.1.5） | `DisposableStack`、`using`：Chrome 134、Firefox 141，Safari 只有预览版；`Symbol.dispose`：Chrome 125 |
| core-js 3.50 补齐两项（`es/symbol/dispose`、`es/disposable-stack`） | 22.7 KB，gzip 7.6 KB |

也就是说，在项目的目标浏览器里，运行时必须补上 `DisposableStack` 和 `Symbol.dispose`。

另外，maplibre-gl 主模块约 1 MB（ADR 0019），`setWorkerUrl` 等全局设置又由 app 负责（ADR 0018），装配代码不能把它带进入口包。

## 候选方案

资源释放：

1. 标准的 `Disposable` + `DisposableStack`，在 `main.ts` 用 core-js 全局补齐
2. 同上，但只在进入地图前补齐，登录页不承担这 7.6 KB
3. 在 utils 里自己实现一个约 60 行、与标准接口一致的类
4. 不用标准，自定一个 `dispose()` 方法约定，放弃 `using` 语法

事件：

1. nanoevents：实现 25 行，无依赖，`on` 返回取消订阅的函数，事件表有类型；10.0.0 于 2026-07 发布
2. mitt：`on` 不返回取消函数，要另外调用 `off`；最后一次发布是 2023 年
3. 自己写：内容和 nanoevents 差不多，但 AGENTS.md 要求通用问题优先用成熟的库
4. `EventTarget` + `CustomEvent`：事件名是字符串，类型写起来别扭

## 决定

### 1. 资源释放用标准的 Disposable

- 持有资源的对象都实现 `Disposable`（`[Symbol.dispose]()`），内部用一个 `DisposableStack`：
  - 注册监听：`stack.defer(unsubscribe)`
  - 创建子对象：`stack.use(child)`
  - 释放时按后进先出的顺序，子对象一定先于父对象释放，旧项目那次崩溃在这个结构下不会发生
- 异步初始化接收拥有者提供的 `AbortSignal`。拥有者在栈里登记 `controller.abort()`，释放时等待中的操作（例如 `whenReady`）以 `AbortError` 结束
- 释放之后：
  - 重复调用 `[Symbol.dispose]()` 不做任何事
  - 等待中的 Promise 以 `AbortError` 结束
  - 晚到的异步回调直接丢弃
  - 再显式调用已释放对象的其他方法会抛错，属于程序错误
- 测试中用 `using` 声明，作用域结束时自动释放
- 运行时：选方案 1，在 `app/main.ts` 的最前面导入 core-js 的 `es/symbol/dispose` 和 `es/disposable-stack`，全局补齐。不选方案 2，是因为开发用的浏览器和测试用的 Node 都原生支持：非地图代码如果用了 `using` 却漏了补丁，只有低版本浏览器会出错，开发和测试都发现不了
- tsconfig 的 `lib` 加上 `esnext.disposable`
- 目标浏览器全部原生支持后（目前 Safari 最晚），删掉这两行导入，代码不用改

### 2. 事件用 nanoevents

- 每个对象把 emitter 设为私有，只对外暴露 `on`，外部不能替它发事件
- `on` 返回取消订阅的函数，直接登记到拥有者的释放栈：`stack.defer(unsubscribe)`
- 事件表用函数签名描述，回调参数的类型由事件表推断
- 某个监听器抛错时，后面的监听器不再执行。监听器抛错属于程序错误，应该暴露出来，不吞掉

### 3. 地图运行时由 app 懒加载

- `setWorkerUrl`、maplibre-gl 的 CSS、Worker 数量（如果要调整，ADR 0019）放在 app 的一个地图运行时模块里，第一次进入地图功能时动态导入并执行一次
- `main.ts` 不能静态导入这个模块；实现后用构建产物确认入口包里没有 maplibre-gl
- core-js 的补丁不放在这里，按第 1 条全局加载

## 后果

- 好处：释放顺序由结构保证，不再靠人记；加一个监听只需要一行登记，不用再到 `destroy` 里补解绑
- 好处：写的是标准代码，浏览器原生支持后只删补丁
- 代价：入口包增加 7.6 KB（gzip）
- 代价：新增依赖 `core-js` 和 `nanoevents`
- 约束：`DisposableStack` 的 `use` 只接受实现了 `[Symbol.dispose]` 的对象；第三方对象的清理用 `defer` 或 `adopt` 包装
