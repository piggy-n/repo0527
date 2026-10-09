# 地图与 Vue 的衔接（map-vue）

> 状态：5A.2 完成了 `provideMap`、样式绑定、画布组件 `<MapCanvas>` 和只读上下文 `useMap()`。设计依据是 ADR 0027（分层）和 ADR 0028（上下文）。

`libs/map-vue` 把 map-core 的地图会话和视图接到 Vue 的组件树与响应式系统上。它只做衔接：不依赖 element-plus、pinia、vue-router（lint 强制），不读项目配置，除画布容器外不渲染界面。项目级的地图能力（底图、行政区、工具栏界面、失败提示）在 `shared/map`。

## 结构

| 文件 | 内容 |
|---|---|
| `provide-map.ts` | `provideMap`：在当前组件里创建会话、提供上下文、管理提交与释放的时机 |
| `style-binder.ts` | `StyleBinder`：把各拥有者的推导结果一次提交给样式模型 |
| `context.ts` | `MapContextState`：会话、当前视图、视图状态、`whenReady`、`useCamera`，对外的只读上下文与视图的受限入口 |
| `MapCanvas.tsx` | `<MapCanvas>`：二维地图画布，挂载后创建视图、卸载时释放 |
| `use-map.ts` | `useMap()`：子孙组件取只读上下文 |

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

```tsx
// 页面的渲染：画布和悬浮面板都放在 provideMap 所在的组件下面
return () => (
  <div class={styles.page}>
    <MapCanvas class={styles.map} mapOptions={{ minZoom: 5 }} />
    <MapToolbar />
  </div>
);

// 子孙组件：只读的地图上下文
const { view, viewState, whenReady, useCamera } = useMap();
const camera = useCamera(); // 每帧更新，只在用到相机的组件里订阅
await whenReady(signal);
view.value?.fitBounds(JIANGSU_BOUNDS, { padding: 40 });
```

- 页面句柄（`provideMap` 的返回值）同样带着 `view`、`viewState`、`whenReady`、`useCamera`
- 路由组件仍要用 `withMapRuntime` 包装（ADR 0023），画布创建地图前 maplibre-gl 的全局设置要已经完成

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

## 画布组件 `<MapCanvas>`

- 渲染两层元素：外层接收页面的 `class`、`style`；内层交给 MapLibre，只用一个静态 class。页面的 class 变化时 Vue 只重设外层，MapLibre 加在内层的 `maplibregl-map` 等 class 不会被冲掉（map-core.md"MapLibre 6 的实测行为"）
- 内层容器的尺寸是 `width/height: 100%`，不用绝对定位：MapLibre 的 CSS 会给它加 `position: relative`
- `onMounted` 时用会话的当前快照创建 `MapLibreView` 并挂到上下文上；`onUnmounted` 时先卸下再释放，等待中的 `whenReady` 以 `AbortError` 结束
- `mapOptions` 只在创建地图时生效；要换选项、或者引擎失败后重新创建，给组件换一个 `key`
- 一个上下文只能有一个画布：第二个画布挂不上时，先释放它刚创建的视图，再把错误交给 Vue
- 运行中的错误（MapLibre 的 `error` 事件、应用命令失败）交给 `provideMap` 的 `onError`；视图失败时不弹提示，由 `shared/map` 读视图状态决定

## 只读上下文 `useMap()`

| 内容 | 说明 |
|---|---|
| `view` | 视图的受限入口 `MapViewport`：冻结的普通对象，只有 `kind`、`flyTo`、`fitBounds`；画布还没挂载、已卸载时为 `null` |
| `viewState` | `idle`（没有视图）、`initializing`、`ready`、`paused`、`failed` |
| `whenReady(signal?)` | 等到有视图且这一轮加载完成。视图失败时以失败的原因结束；等待中视图被释放、或者 `provideMap` 所在的组件卸载时以 `AbortError` 结束；`signal` 中止时以它的原因结束（不是错误对象时改用 `AbortError`，用 `@yzt/utils` 的 `abortReason`） |
| `useCamera()` | 在调用方的作用域里订阅相机，作用域销毁时取消；不在组件 setup 或 `effectScope` 里调用时抛错 |

- **只读**：`view`、`viewState`、相机引用对外都用 `shallowReadonly` 包了一层。对 `.value` 赋值被忽略，开发环境给出警告；里面的对象不被代理。不对视图、会话这类引擎对象用深层的 `readonly()`：深层代理会让内核类的私有字段访问报错
- **受限入口**：暂停、恢复、释放、订阅都不在 `MapViewport` 上，JS 里也调不到。暂停和恢复以后由框架切换负责，释放由画布负责，状态从 `viewState` 读
- **等待者的清理**：`whenReady` 同时监听上下文的生命周期和调用方的 `signal`；任一个中止、或者等待结束时，两边的监听都会移除，不会因为一直等不到视图而留在另一个 `signal` 上

## 卸载与释放

Vue 3.5.43 卸载组件的顺序（读源码确认）：本组件的 `onBeforeUnmount` → 本组件的 `scope.stop()`（`onScopeDispose` 在这里执行）→ 卸载子组件 → 本组件的 `onUnmounted`（晚于子组件的 `onUnmounted`）。

- 会话在 `onUnmounted` 释放，不用 `onScopeDispose`：后者早于子组件卸载，会话会先于画布里的视图被释放
- `scope.stop()` 依次执行清理回调，不逐个捕获异常；回调抛错会让子组件卸载和后续的卸载钩子都不执行。所以卸载路径上 map-vue 的释放都包在 `try/catch` 里，错误交给 `onError`
- 页面卸载时不逐组清空分组：会话马上就要释放，清空只会多一次提交；跨分组引用时逐组清空还可能通不过校验

## 开发页验证（5A.2c）

`/dev/map` 改用 `provideMap`、`bindStyle`、`<MapCanvas>` 和页面句柄，不再直接操作会话。2026-10-09 在真实的 MapLibre 6 上验证：

| 场景 | 结果 |
|---|---|
| 首次加载 | 视图进入 `ready`；交给 MapLibre 的容器是静态 class 加 `maplibregl-map`，页面的 class 落在外层 |
| 切换颜色、加上和去掉 `minzoom`、高亮的显示移动清除 | 与阶段四相同：去掉 `minzoom` 后填充仍在描边下面，高亮走 `setGeoJSONSourceData` |
| 切换数据版本（区域换数据源 ID，选区引用它） | 同一轮一次提交，没有错误，选区描边跟着换了数据源 |
| 切换数据版本，选区晚 800ms 才跟上 | 第一轮被拒绝，报告"图层 selection-line 引用的数据源 regions-v1 不存在"；地图停在原来的快照，视图仍是 `ready`（不合法的组合没有到达 MapLibre）；选区跟上后两者一起提交，只有这一条报错 |
| 让选区的推导出错，再切换颜色 | 只报告一次推导失败；颜色没有变化（整批跳过）；修好后颜色和选区一起生效 |
| `flyTo`、`fitBounds` | 经受限入口转发到视图，会话相机随之更新 |
| 提交不合法的图层、在不合法的快照下重新创建视图（换 `key`） | 进入 `failed`，去掉后自动恢复；重建时旧画布被移除，新视图按会话里的相机创建，相机保持在重建前的位置 |
| 离开页面再回来 | 离开后页面上没有地图容器，没有错误和未处理的拒绝；回来后重新进入 `ready` |

另外发现：浏览器面板只有 420px 宽时，`fitBounds` 的左右 padding（40 + 360）几乎占满画布，只剩 20px 可用，结果缩到 z1.33、中心偏到 163.9°；1280 宽时正常（中心 120.65°，比江苏的几何中心偏东，是右侧留白的预期效果）。"被占用的区域"换算成 padding 时要考虑画布尺寸，在 5A.3 处理。

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `style-binder.test.ts` | 初始提交、同一轮的跨分组修改、晚一轮时的拒绝与收敛、推导失败时整批跳过、缓存、重复绑定、释放 | Node |
| `provide-map.test.tsx` | 必须在 setup 中调用、初始值早于子组件 setup、挂载后绑定抛错、卸载顺序、卸载路径上的错误、组名的类型检查、默认的错误输出 | jsdom |
| `MapCanvas.test.tsx` | 用完整快照创建视图、页面的 class 不冲掉 MapLibre 的 class、视图状态的变化、受限入口、只读引用、`whenReady` 的各种结局、`useCamera` 的订阅与取消、先释放视图后释放会话、运行中的错误、画布的数量限制 | jsdom |
| `context.test.ts` | 卸下视图后旧视图的事件不再改变状态、卸下的不是当前视图时不做任何事 | Node |

- 推导失败的用例用 `await expect(nextTick()).resolves.toBeUndefined()` 等待：异常冒出侦听器时，失败落在断言上，而不是测试本身报错
- `MapCanvas.test.tsx` 注入实现 `MapLike` 的假地图（`MapLike` 等类型从 `@yzt/map-core` 导出），走真实的 `MapLibreView`；`context.test.ts` 用一个实现 `MapView` 的假视图，测 `MapLibreView` 本身覆盖不到的情况
- 画布与上下文逐一改坏 20 处，19 处由断言发现。"卸载时先卸下再释放"改成先释放后卸下测不出来：两步都是同步的，等待者的回调在微任务里才执行，侦听器也在之后才运行，看到的都是最终结果，这个顺序不影响行为。"卸下时不取消订阅"起初也没有被发现：`MapLibreView` 释放时会清空自己的监听，碰巧不出问题；`MapView` 接口并不保证这一点，补了 `context.test.ts` 后由断言发现
- 提交器与 `provideMap` 逐一改坏 15 处实现（逐组提交、只跳过失败的分组、不把异常变成值、重复报告、校验失败也更新记录、初始值不立即提交、挂载后仍可绑定、重复检查不先整体检查、释放后不停止侦听、同步侦听、共用一次推导、在 `onScopeDispose` 里释放会话、卸载时不捕获异常、在 `onMounted` 才提交、不检查是否在组件中），全部由断言发现
