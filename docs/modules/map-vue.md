# 地图与 Vue 的衔接（map-vue）

> 状态：5A.2 完成了 `provideMap`、样式绑定、画布组件 `<MapCanvas>` 和只读上下文 `useMap()`；5A.3 加入定位可视区域（`useMapOverlay`）、失败原因与重试；5B.3 加入交互工具的登记与切换、视图入口的拾取和投影。设计依据是 ADR 0027（分层）、ADR 0028（上下文）、ADR 0029（定位可视区域）、ADR 0030（失败原因）和 ADR 0034（交互工具）。

`libs/map-vue` 把 map-core 的地图会话和视图接到 Vue 的组件树与响应式系统上。它只做衔接：不依赖 element-plus、pinia、vue-router（lint 强制），不读项目配置，除画布容器外不渲染界面。项目级的地图能力（底图、行政区、工具栏界面、失败提示）在 `shared/map`。

## 结构

| 文件 | 内容 |
|---|---|
| `provide-map.ts` | `provideMap`：在当前组件里创建会话、提供上下文、管理提交与释放的时机 |
| `style-binder.ts` | `StyleBinder`：把各拥有者的推导结果一次提交给样式模型 |
| `context.ts` | `MapContextState`：会话、当前视图、视图状态、`whenReady`、`useCamera`、悬浮元素的登记表与 `overlayPadding`，对外的只读上下文与视图的受限入口 |
| `overlay.ts` | `computeOverlayPadding`：按悬浮元素的实际占用算出定位用的 padding（纯函数） |
| `MapCanvas.tsx` | `<MapCanvas>`：二维地图画布，挂载后创建视图、卸载时释放 |
| `use-map.ts` | `useMap()`：子孙组件取只读上下文；`useMapOverlay()`：悬浮元素登记自己贴着的边 |

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
- 引擎失败后，上下文的 `retry()` 让画布先卸下、释放旧视图，再在同一个容器里创建新视图（ADR 0030）；`createMap` 等 props 按重试时的值生效
- 运行中的错误（MapLibre 的 `error` 事件、应用命令失败）交给 `provideMap` 的 `onError`；视图失败时不弹提示，由 `shared/map` 读视图状态决定

## 只读上下文 `useMap()`

| 内容 | 说明 |
|---|---|
| `view` | 视图的受限入口 `MapViewport`：冻结的普通对象，只有 `kind`、`flyTo`、`fitBounds`、`pick`、`project`；画布还没挂载、已卸载时为 `null`。定位、拾取、投影都只在视图就绪时可用 |
| `viewState` | `idle`（没有视图）、`initializing`、`ready`、`paused`、`failed` |
| `failure` | 视图失败的原因（`MapViewFailure`），只在 `failed` 时有值，卸下视图时清空（ADR 0030） |
| `retry()` | 引擎失败后重新创建视图；样式失败（出现新版本时自动恢复）和没有失败时什么也不做 |
| `whenReady(signal?)` | 等到有视图且这一轮加载完成。视图失败时以失败的原因结束；等待的视图被卸下或替换、`provideMap` 所在的组件卸载时以 `AbortError` 结束；`signal` 中止时以它的原因结束（不是错误对象时改用 `AbortError`，用 `@yzt/utils` 的 `abortReason`）。等待绑定具体的视图实例，旧视图就绪不算新视图就绪 |
| `useCamera()` | 在调用方的作用域里订阅相机，作用域销毁时取消；不在组件 setup 或 `effectScope` 里调用时抛错 |
| `runCameraOperation(action)` | 用户发起的定位（默认视角、坐标定位等）都从这里执行（ADR 0038）：开始一次相机操作，之前没完成的定位作废；视图就绪时立即执行 `action(view)`，还没就绪时等到就绪再执行，期间有新的操作、视图失败或被替换时放弃；就绪后执行时抛出的错误交给 `onError` |
| `beginCameraOperation()` | 要先异步准备数据的定位（如区划定位等边界）在开始时调用，返回这次操作的信号，准备好后用 `whenReady(信号)` 等视图：下一次操作开始时（包括用户开始拖动、缩放）信号中止，等待随之结束 |
| `currentCameraOperation()` | 当前这次相机操作的信号，不开始新的操作。页面的初始适配在 setup 时读它，就绪时已经中止就让给用户的操作（ADR 0038） |
| `projectionRevision` | 屏幕投影的版本：会话相机变化、当前视图的画布尺寸变化（视图的 `resize` 事件）时加 1。按屏幕位置摆放的浮层（测量标签、图钉）在 `computed` 里读它再 `project`；只依赖相机时，窗口尺寸变化后浮层不动（中心和缩放没变，相机不发出变化） |
| `activeTool` | 当前工具的 ID（只读），跟随会话的工具模型 |
| `activateTool(id)` | 激活工具，旧工具先退出；未登记时抛错 |
| `releaseTool(id)` | 让正在激活的工具退出：临时任务回到上一个常驻模式，常驻模式回到移动；没有激活时什么也不做 |

- **只读**：`view`、`viewState`、`failure`、相机引用对外都用 `shallowReadonly` 包了一层。对 `.value` 赋值被忽略，开发环境给出警告；里面的对象不被代理。不对视图、会话这类引擎对象用深层的 `readonly()`：深层代理会让内核类的私有字段访问报错
- **受限入口**：暂停、恢复、释放、订阅都不在 `MapViewport` 上，JS 里也调不到。暂停和恢复以后由框架切换负责，释放由画布负责，状态从 `viewState` 读
- **等待绑定视图实例**（5A 之后的修复）：每个挂上的视图带一个自己的 `AbortController`，卸下时中止，等它的 `whenReady` 立即以 `AbortError` 结束，不等视图自己释放时的拒绝；返回前再确认等的仍是当前视图。后一道是纵深防御：等待结束后、继续执行之前隔着一两个微任务，期间被替换时监听已经移除。这个窗口取决于微任务的个数，测试无法稳定命中，改坏它测不出来
- **等待者的清理**：`whenReady` 同时监听上下文的生命周期和调用方的 `signal`；任一个中止、或者等待结束时，两边的监听都会移除，不会因为一直等不到视图而留在另一个 `signal` 上

## 交互工具（ADR 0034）

```ts
// 页面 setup：和 bindStyle 一样只能在这里登记
map.registerTools({ measure: measureTool, pick: pickTool });

// 工具栏等子组件：读当前工具、切换工具
const { activeTool, activateTool, releaseTool } = useMap();
activeTool.value === 'measure' ? releaseTool('measure') : activateTool('measure');
```

- 工具模型在会话里（map-core 的 `session.tool`），map-vue 只负责登记和把当前工具桥接成 Vue 的状态。工具的语义（常驻模式与临时任务、Esc、光标与手势）见 [map-core.md](map-core.md)"ToolModel"
- `registerTools` 在 `provideMap` 所在组件的 `onBeforeMount` 关闭；先全部检查再登记：ID 是内置的 `browse` 或已经登记过时抛错，这一次的工具都不登记
- 输入不经过 map-vue：视图把输入直接交给会话的工具模型，只有就绪且没有暂停的视图转交
- 上下文释放时取消对工具模型的订阅

## 定位可视区域（ADR 0029）

悬浮的面板、工具栏会盖住地图的一部分。程序定位要把目标放进没被盖住的区域，而且计算不能依赖具体的布局（画布型页面的界面在 5D 才定稿）。

```ts
// 悬浮组件的 setup：登记这个元素贴着画布的哪一边
const panel = ref<HTMLElement>();
useMapOverlay(panel, 'left');

// 任何地方：不传 padding 时自动避开登记过的元素
useMap().view.value?.fitBounds(bounds);
// 需要自己组合时
const padding = useMap().overlayPadding();
```

- 只登记贴边、会挡住定位的元素（侧面板、横向工具栏）；角落的小控件、弹出层、抽屉不登记。边要显式写明
- 定位的那一刻才用 `getBoundingClientRect` 量画布和各元素，不持续测量：面板展开、收起、改尺寸都不用另外监听。量的是元素的实际尺寸，例如 `width: 320px` 加上左右内边距 16 的面板，按 352 算
- 每一边的 padding 取 `max(边距, 占用 + 间隔)`；同一边取最大的占用；元素为空、尺寸为 0、不在文档里、和画布不相交时不算
- 可视区域的宽、高至少保留画布的 1/3，超出时两侧按比例缩小。极窄的画布上目标可能有一部分落在面板下面，这是为了不缩到几乎看不见
- 默认值：边距 16、间隔 16、至少保留 1/3，用 `provideMap({ overlay: { edgePadding, gap, minVisibleRatio } })` 修改，取值不合法时抛错
- 视图入口的 `fitBounds`、`flyTo` 没传 `padding` 时使用 `overlayPadding()`；明确传入（包括 `0`）时以传入的为准。这是 `MapViewport` 比 `MapView` 多出的一层默认行为。`flyTo` 只在给了中心时把它放在避开悬浮元素后的区域中央（5B.6，ADR 0037）
- `useMapOverlay` 要放在 `provideMap` 所在组件的子孙组件里：提供上下文的组件 `inject` 不到自己 provide 的值（Vue 的 `inject` 从父组件开始找）；不在作用域里调用时抛错，作用域销毁时注销

## 错误上报

- `provideMap` 在入口把 `onError`（没传时是打印到控制台）用 `@yzt/utils` 的 `safeReporter` 包一层，map-vue 内部（提交器、卸载时的释放、画布、交给视图的报告器）都经由它上报
- 外部的报告器自己抛错时，改为打印到控制台（连同原始错误），不打断提交、视图的状态转换和卸载。之前的问题：报告器在卸载路径上抛错会让后续的卸载钩子都不执行；在挂载时的提交里抛错会让挂载失败
- 视图（`MapLibreView`）自己也包了一层：map-core 可以脱离 map-vue 单独使用

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
| 提交不合法的图层；打开"模拟引擎失败"后重新创建视图，取消模拟后点提示里的"重试"（5A.3） | 样式失败时上方出现警告条，去掉图层后消失；引擎失败时地图画不出来，中间出现"地图无法显示"和"重试"；重试后在原来的容器里创建了真实地图，回到 `ready` |
| 右侧悬浮面板登记为贴右边，`fitBounds` 不传 `padding`（5A.3） | 1280 宽：面板实际宽 352（含内边距），padding 为右 384、其余 16，中心 120.80°；隐藏面板后 padding 四边 16，中心回到江苏范围的几何中心 119.10°。420 宽：原本左右合计 400，按下限缩成左 11、右 268，可视区域 141px，结果 z4.15（没有下限时是 z1.33） |
| 提交不合法的图层、在不合法的快照下重新创建视图（换 `key`） | 进入 `failed`，去掉后自动恢复；重建时旧画布被移除，新视图按会话里的相机创建，相机保持在重建前的位置 |
| 坐标拾取（5B.3，开发页的临时任务工具）：点按钮激活 | 当前工具是 `probe`，画布光标是 `crosshair`，只有双击放大被关掉，拖动平移和 Shift 框选放大照常 |
| 单击地图上的 (300, 200) | 拾取到 118.999922°, 33.572507°，和 MapLibre 自己 `unproject` 的结果相同；立刻投影回屏幕的偏差 0.000 像素；标签由 `project` 放在 (300, 200) |
| 拖动地图（在画布上派发鼠标事件，见 map-core.md"MapLibre 6 的实测行为"） | 地图平移，标签跟着移到 `project` 算出的新位置；拖完松手没有被当成一次拾取 |
| 双击、按 Esc、再双击 | 拾取模式下双击不放大（z6.5 不变）；地图获得焦点后按 Esc 退回移动，光标清空、双击放大恢复；之后双击放大到 z7.5，不再记录拾取 |
| 离开页面再回来 | 离开后页面上没有地图容器，没有错误和未处理的拒绝；回来后重新进入 `ready` |

另外发现：浏览器面板只有 420px 宽时，`fitBounds` 的左右 padding（40 + 360）几乎占满画布，只剩 20px 可用，结果缩到 z1.33、中心偏到 163.9°；1280 宽时正常（中心 120.65°，比江苏的几何中心偏东，是右侧留白的预期效果）。"被占用的区域"换算成 padding 时要考虑画布尺寸，在 5A.3 处理。

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `style-binder.test.ts` | 初始提交、同一轮的跨分组修改、晚一轮时的拒绝与收敛、推导失败时整批跳过、缓存、重复绑定、释放 | Node |
| `provide-map.test.tsx` | 必须在 setup 中调用、初始值早于子组件 setup、挂载后绑定抛错、卸载顺序、卸载路径上的错误、组名的类型检查、默认的错误输出；工具的登记、挂载后登记抛错、重复或 `browse` 时这一次都不登记 | jsdom |
| `MapCanvas.test.tsx` | 用完整快照创建视图、页面的 class 不冲掉 MapLibre 的 class、视图状态的变化、受限入口、只读引用、`whenReady` 的各种结局、`useCamera` 的订阅与取消、先释放视图后释放会话、运行中的错误、画布的数量限制、失败原因、引擎失败后的重试；受限入口的 `pick`、`project`；工具通过上下文激活和退出、`activeTool` 只读、地图上的点击经视图交给工具 | jsdom |
| `context.test.ts` | 卸下视图后旧视图的事件不再改变状态、卸下的不是当前视图时不做任何事；悬浮元素的登记、注销与现量现算，视图入口 `fitBounds` 的默认 padding，`useMapOverlay` 不在作用域里时抛错；`activeTool` 跟随工具模型、上下文释放后不再跟随；相机操作：开始时中止上一次、读当前的不开始新的，`runCameraOperation` 就绪时立即执行、没就绪时等到就绪、期间有新的操作时放弃、等待的视图失败时放弃、执行出错交给 `onError` | Node |
| `overlay.test.ts` | 占用与间隔、同一边取最大、不算的元素、画布的位置、横向和纵向的下限、选项 | Node |

- 推导失败的用例用 `await expect(nextTick()).resolves.toBeUndefined()` 等待：异常冒出侦听器时，失败落在断言上，而不是测试本身报错
- `MapCanvas.test.tsx` 注入实现 `MapLike` 的假地图（`MapLike` 等类型从 `@yzt/map-core` 导出），走真实的 `MapLibreView`；`context.test.ts` 用一个实现 `MapView` 的假视图，测 `MapLibreView` 本身覆盖不到的情况
- 画布与上下文逐一改坏 20 处，19 处由断言发现。"卸载时先卸下再释放"改成先释放后卸下测不出来：两步都是同步的，等待者的回调在微任务里才执行，侦听器也在之后才运行，看到的都是最终结果，这个顺序不影响行为。"卸下时不取消订阅"起初也没有被发现：`MapLibreView` 释放时会清空自己的监听，碰巧不出问题；`MapView` 接口并不保证这一点，补了 `context.test.ts` 后由断言发现
- 5A 之后的三处修复（`whenReady` 绑定视图实例、初始定位改为第一次就绪时、错误上报的包装）逐一改坏 9 处，起初 2 处没被发现："返回前不确认仍是当前视图"是上面说的纵深防御；"初始定位不停止侦听"是页面测试的场景不对（就绪后收到 `error` 只上报、状态不变，侦听器根本没被触发），改成画布重建后再次就绪才测出来
- 失败原因与重试（连同 map-core 的 `failure` 和 `shared/map` 的提示）逐一改坏 14 处，全部发现；"重试时不释放旧视图"起初是挂上新视图时抛错、不是断言失败，等待重试的那一步改成 `resolves` 断言后由断言发现
- 定位可视区域逐一改坏 16 处，起初有 2 处没被发现："不检查是否相交"（画布外的元素算出的占用本来是负数，被限制到 0；补了"登记为左、但整个在画布下方"的用例）和"不随作用域注销"（组件卸载时模板引用变为空，元素本来就不算；补了登记外部元素的用例）。补上后全部由断言发现
- 提交器与 `provideMap` 逐一改坏 15 处实现（逐组提交、只跳过失败的分组、不把异常变成值、重复报告、校验失败也更新记录、初始值不立即提交、挂载后仍可绑定、重复检查不先整体检查、释放后不停止侦听、同步侦听、共用一次推导、在 `onScopeDispose` 里释放会话、卸载时不捕获异常、在 `onMounted` 才提交、不检查是否在组件中），全部由断言发现
