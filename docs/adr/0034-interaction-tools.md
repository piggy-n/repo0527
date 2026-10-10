# 0034. 交互工具：视图输入、工具模型与工具栏

- 状态：已接受
- 日期：2026-10-10
- 落实 ADR 0020 第 6 条（当前工具是会话状态）、ADR 0024 第 2、7、8 条（拾取、投影、输入）、ADR 0027 第 4 条（同一时间只有一个工具）和 ADR 0028 第 5 条（当前工具进入上下文）

## 背景

5B.3 做交互的基础：二维的输入、拾取、投影，会话里的当前工具，以及工具栏的外壳。测距、测面（5B.4）、点选（5C.6）、数据查询的空间绘制（阶段六）都建在它上面。

旧项目（yzt `master-demo` 836f03b）：

- 工具栏里移动、点选、测距、测面四选一。移动是默认的浏览模式；测量关掉后回到之前的浏览模式（移动或点选，代码里叫 `navigationMode`）。区划定位、坐标定位只开关面板，和四选一并存；默认视角、清除是一次性的动作
- 工具栏发事件，`MapService.handleToolbarAction` 用 switch 逐个开关各管理器；多处传入 `isInteractionBlocked()` 互相询问能不能用鼠标
- 移动：拖动平移、抓手光标、单击不处理。点选：单击选中、拖动画矩形框选（不平移），框选在滚轮、Esc、失焦、地图移动时取消。测量：单击加点、双击结束、十字光标
- 绘制时逐个禁用拖动平移、Shift 框选放大、双击放大，结束时只恢复自己禁用的
- 测量、绘制、点选都通过 `getNativeMap()` 直接监听地图事件、改光标

已有的约定：只有适配器写二维地图（ADR 0024 第 9 条）；输入只带屏幕坐标、按键和修饰键，要经纬度时再调用拾取（ADR 0024 第 8 条）；二维拾取的表面是 `map`、没有高度（ADR 0024 第 2 条）。

## 候选方案

| 问题 | 候选 | 选择 |
|---|---|---|
| 工具的关系 | 所有工具平等，关掉就回到移动；分常驻模式和临时任务 | 分两类：移动、点选是常驻模式，测距、测面是临时任务，关掉后回到之前的常驻模式（旧项目的语义） |
| 光标和手势 | 视图提供 `setCursor`、`setGestures`，工具自己调；工具声明，视图读会话后应用 | 工具声明：和样式、相机一样只有适配器写地图，三维以后读同一份声明 |
| 输入怎样到达工具 | map-vue 订阅当前视图的输入再转交；视图自己交给会话的工具模型 | 视图自己转交：视图本来就读写会话，只有就绪且没有暂停的视图转交，不用另外判断当前是哪个视图 |
| 工具在哪里登记 | `provideMap` 的选项；页面句柄的 `registerTools` | `registerTools`，和 `bindStyle` 一样只在页面的 setup 里登记 |
| 谁能切换工具 | 只有页面，通过 props 交给工具栏；上下文 | 上下文：工具栏这样的子组件直接切换（ADR 0028 第 5 条预留过） |
| 输入用哪种事件 | DOM 的指针事件；MapLibre 的地图事件 | 地图事件：MapLibre 的 `click` 只在拖动小于 3 像素时触发，拖完地图松手不会被当成单击 |

## 决定

### 1. 视图接口：输入、拾取、投影（map-core）

```ts
interface ScreenPoint { readonly x: number; readonly y: number }       // 画布左上角为原点的 CSS 像素
type LngLat = readonly [lng: number, lat: number];
type PickResult = { kind: 'miss' } | { kind: 'hit'; surface: PickSurface; lngLat: LngLat; height?: number };

type MapInputEvent =
  | { type: 'down' | 'move' | 'up' | 'click' | 'dblclick' | 'leave'; point: ScreenPoint; button: number; modifiers: Modifiers }
  | { type: 'key'; key: string };

interface MapView {
  pick(point: ScreenPoint): PickResult;
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
}
```

- 二维的 `pick` 总是命中地图平面（`surface: 'map'`，没有高度）；`project` 总有值，可能在画布之外。三维在相机背后时 `project` 返回 `null`
- 二维的输入来自 MapLibre 的地图事件（`mousedown`、`mousemove`、`mouseup`、`click`、`dblclick`、`mouseout`），按键来自地图容器的 `keydown`（地图获得焦点时）。双击时的顺序是单击、单击、双击，由工具自己处理
- 不支持触屏：这是桌面端的系统，旧项目也没有处理

### 2. 工具模型（map-core，会话的 `tool`）

```ts
interface MapTool {
  readonly persistent: boolean;           // 常驻模式（移动、点选）还是临时任务（测距、测面）
  readonly cursor?: string;               // 激活时的光标；不写时用地图默认的抓手
  readonly gestures?: Partial<Gestures>;  // 激活时要关掉的地图手势：dragPan、doubleClickZoom、boxZoom
  activate?(): void;
  deactivate?(): void;                    // 退出时丢掉瞬时状态
  handleInput?(event: MapInputEvent, view: ToolView): boolean | void;  // 返回 true 表示已处理
}
```

- 同一时间只有一个激活的工具：`activate(id)` 先让旧工具 `deactivate`，再让新工具 `activate`，然后发出 `change`
- 内置的 `browse`（移动）是默认的常驻模式，不改光标、不关手势；ID `browse` 保留，不能登记
- 激活一个常驻模式时，它成为"回退的目标"；`release(id)` 让正在激活的工具退出：临时任务退回上一个常驻模式，常驻模式退回 `browse`；没有激活时什么也不做
- 输入只交给当前工具。按 Esc 时先交给工具，工具没有处理（没有返回 `true`）并且它是临时任务时，退回常驻模式
- `ToolView` 只有 `kind`、`pick`、`project`，工具拿不到视图的其他能力
- 工具的状态（如测量已经确定的顶点）由工具自己保管，ADR 0024 第 5 条"切换视图时保留"在三维阶段实现；工具的状态怎样变成 Vue 的响应式、推导成样式分组，在 5B.4 做测量时定
- 工具的钩子不应抛错：视图在 MapLibre 的事件回调里调用它们，抛错时交给 `onError`，不打断 MapLibre 的事件分发

### 3. 光标和手势由视图应用

- 视图订阅工具模型的 `change`，把当前工具的光标写到地图的画布上（没写时清空，交回 MapLibre 的默认样式），按 `gestures` 关掉对应的手势
- 视图只恢复自己关掉的手势：页面创建地图时就关掉的（如 `mapOptions` 里的 `doubleClickZoom: false`），切换工具时不会被打开
- 只有就绪且没有暂停的视图转交输入；暂停（切到三维）期间不转交，光标和手势在恢复显示时按当前工具重新应用

### 4. map-vue：登记与上下文

- 页面句柄增加 `registerTools({ id: tool })`：只能在 `provideMap` 所在组件的 setup 里调用，挂载前关闭；同一个 ID 只能登记一次
- `useMap()` 的上下文增加只读的 `activeTool`，以及 `activateTool(id)`、`releaseTool(id)`；视图的受限入口 `MapViewport` 增加 `pick`、`project`

### 5. 工具栏外壳（shared/map，联调界面）

- 一张表集中写工具和动作的 ID、名称、图标（先用 Element 图标）和种类；工具栏按页面给出的列表显示按钮
- 工具按钮读 `activeTool`，点击时激活或退出（`releaseTool`）；动作按钮调用页面通过 props 传入的回调（如默认视角）
- 5B.3 只有"默认视角"和"移动"；测距、测面在 5B.4 加入，点选在 5C.6 加入。工具栏放在角落，不登记为悬浮元素，5D 再设计

### 6. 在真实的 MapLibre 上验证

开发页 `/dev/map` 放一个只在开发页用的"坐标拾取"工具（临时任务）：十字光标、关掉双击放大；单击时用 `pick` 取经纬度并画一个点，用 `project` 把标签放回屏幕位置；按 Esc 退回移动。用它验证输入、拾取、投影、光标、手势和工具切换。

### 7. 模型共用的"事件加释放"

`StyleModel`、`CameraModel` 各有一段相同的逻辑（已释放的标记、释放后订阅和写入抛错、释放时清空监听器），工具模型是第三个。抽成一个小辅助对象，三个模型各持有一个实例（组合）；不用继承，免得占掉唯一的一层基类（map-core.md"总体思路"）。

## 后果

- 好处：工具互斥、回退到常驻模式由模型保证，不再互相询问；光标和手势只由适配器改；工具只拿到拾取和投影，不碰原生地图
- 好处：输入由视图转交，二三维切换时自然只有当前视图在转交
- 代价：工具的光标、手势只能是声明的固定值；需要随状态变化（例如框选拖动中）时，在工具里重新声明，以后有使用方时再扩展
- 待定：工具在不同视图里的支持情况与状态保留（三维阶段）；工具状态到 Vue 和样式的桥接（5B.4）；Esc 之外的按键、右键菜单（有使用方时）
