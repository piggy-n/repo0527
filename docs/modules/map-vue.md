# 地图与 Vue 的衔接（map-vue）

> 状态：5A.2a 完成了 `provideMap` 和样式绑定；画布组件 `<MapCanvas>`、只读上下文 `useMap()` 在 5A.2b。设计依据是 ADR 0027（分层）和 ADR 0028（上下文）。

`libs/map-vue` 把 map-core 的地图会话和视图接到 Vue 的组件树与响应式系统上。它只做衔接：不依赖 element-plus、pinia、vue-router（lint 强制），不读项目配置，除画布容器外不渲染界面。项目级的地图能力（底图、行政区、工具栏界面、失败提示）在 `shared/map`。

## 结构

| 文件 | 内容 |
|---|---|
| `provide-map.ts` | `provideMap`：在当前组件里创建会话、提供上下文、管理提交与释放的时机 |
| `style-binder.ts` | `StyleBinder`：把各拥有者的推导结果一次提交给样式模型 |
| `context.ts` | 内部的注入键：画布组件用它拿到会话 |

## 用法

```ts
// 页面 setup
const map = provideMap({
  groups: ['basemap', 'resources', 'highlight'], // 从下到上的叠放顺序
  camera: JIANGSU_CAMERA,
  onError: reportMapError // 可选：样式提交失败、视图运行中的错误；默认打印到控制台
});

const basemap = useBasemap();
const resources = useResourceLayers();
const highlight = useResourceHighlight(resources); // 引用资源分组的数据源，从资源的状态推导

map.bindStyle({
  basemap: basemap.deriveGroup,
  resources: resources.deriveGroup,
  highlight: highlight.deriveGroup
});
```

- `provideMap` 只能在组件的 setup 里同步调用；返回的页面句柄只交给页面自己
- `bindStyle` 只能在同一个组件的 setup 里调用，可以分几次调用；组名受声明的分组约束，写错报类型错误；一个分组只能绑定一次
- 拥有者给出推导函数 `() => StyleGroup`，不提交样式，也不接受 `ref`、`computed`（原因见下文"推导的缓存与失败"）
- "不显示"用推导结果返回空分组（`{ sources: {}, layers: [] }`）表达，不靠组件卸载
- 推导只依赖拥有者自己的状态，不依赖相机：相机每帧都变，依赖它就会每帧重新推导、提交

## 提交的时机与语义

| 时机 | 做什么 |
|---|---|
| setup 中 `bindStyle` | 登记推导函数，每个包进提交器自己的 `computed` |
| `onBeforeMount` | 关闭登记；所有绑定的初始值用一次 `setGroups` 提交；开始侦听 |
| 之后每一轮变化 | 读取所有绑定的结果（`flush: 'pre'`），变化的分组用一次 `setGroups` 提交 |
| `onBeforeUnmount` | 停止侦听和提交，不逐组清空 |
| `onUnmounted` | 释放会话 |

- **初始值在视图创建之前提交**：父组件的 `onBeforeMount` 早于子组件的 setup，画布组件创建视图时，会话里已经是完整的样式，地图第一次加载不用再追一串增量命令
- **同一轮的变化一次提交**：由同一次状态变化引起的多个分组的修改一起校验、一起生效。例如换年份时资源分组换了数据源 ID、高亮分组改了引用，分两次提交时不管先提交哪个，中间状态都引用了不存在的数据源
- **失败时整批跳过**：同一轮里只要有一个推导函数抛错，或者组合后的样式通不过 `StyleModel` 的校验，这一轮都不提交，错误交给 `onError`，会话保持上一份完整的快照。提交器记着每个分组上次提交成功的结果，之后的变化会连同上次没提交成功的分组一起提交，最终收敛到最新的合法组合
- **同一个推导失败只报告一次**：失败结果在依赖变化前保持同一个对象，用 `WeakSet` 去重；校验失败每次重试都报告
- **一致优先于及时**：有推导失败时，测量这类高频更新也会停在上一份快照，直到失败的推导修好
- **引用方要依赖被引用方的状态**：两者才会在同一轮变化。引用方晚一轮才变时，前一轮的提交因为引用不存在被拒绝并报告，这个报告说明数据流写得不对；引用合法但业务上不配套（数据源 ID 不变、年份不配套）校验发现不了，只能靠"同一轮变化"保证

## 推导的缓存与失败

提交器把每个推导函数包进自己的 `computed`，在里面用 `try/catch` 调用，结果是"成功的分组"或"失败"两种值之一：

- 每个绑定只在自己用到的依赖变化时重新推导。测量时鼠标每动一下只重新推导测量分组
- 失败作为值缓存，直到这个推导函数用到的依赖变化

为什么不直接接受拥有者的 `computed`：2026-10-09 在 Vue 3.5.43 上验证，`computed` 自己抛错时：

1. 异常在调度器检查依赖是否变化时抛出，读取它的一方即使包了 `try/catch` 也接不住，侦听器这一轮不执行
2. 之后依赖没变时再读取，它不再抛错，而是返回上一次成功的旧值

第 2 条会让"资源换了新年份、高亮还是旧年份的结果"被当成成功提交。所以拥有者内部的 `computed` 也不能抛异常（AGENTS.md"TypeScript 与 Vue"）：可能失败的计算放在推导函数里直接做，或者把失败表示成数据。

## 卸载与释放

Vue 3.5.43 卸载组件的顺序（读源码确认）：本组件的 `onBeforeUnmount` → 本组件的 `scope.stop()`（`onScopeDispose` 在这里执行）→ 卸载子组件 → 本组件的 `onUnmounted`（晚于子组件的 `onUnmounted`）。

- 会话在 `onUnmounted` 释放，不用 `onScopeDispose`：后者早于子组件卸载，会话会先于画布里的视图被释放
- `scope.stop()` 依次执行清理回调，不逐个捕获异常；回调抛错会让子组件卸载和后续的卸载钩子都不执行。所以卸载路径上 map-vue 的释放都包在 `try/catch` 里，错误交给 `onError`
- 页面卸载时不逐组清空分组：会话马上就要释放，清空只会多一次提交；跨分组引用时逐组清空还可能通不过校验

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `style-binder.test.ts` | 初始提交、同一轮的跨分组修改、晚一轮时的拒绝与收敛、推导失败时整批跳过、缓存、重复绑定、释放 | Node |
| `provide-map.test.tsx` | 必须在 setup 中调用、初始值早于子组件 setup、挂载后绑定抛错、卸载顺序、卸载路径上的错误、组名的类型检查、默认的错误输出 | jsdom |

- 推导失败的用例用 `await expect(nextTick()).resolves.toBeUndefined()` 等待：异常冒出侦听器时，失败落在断言上，而不是测试本身报错
- 逐一改坏 15 处实现（逐组提交、只跳过失败的分组、不把异常变成值、重复报告、校验失败也更新记录、初始值不立即提交、挂载后仍可绑定、重复检查不先整体检查、释放后不停止侦听、同步侦听、共用一次推导、在 `onScopeDispose` 里释放会话、卸载时不捕获异常、在 `onMounted` 才提交、不检查是否在组件中），全部由断言发现
