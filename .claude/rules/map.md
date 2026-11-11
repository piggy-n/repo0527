---
paths:
  - "packages/map-core/**"
  - "packages/map-vue/**"
  - "packages/map-tools/**"
  - "packages/map-three/**"
  - "apps/yzt/src/shared/map/**"
  - "apps/yzt/src/features/{resource-map,scene-models,data-query,monitoring-indicators,indicator-simulation,ai-chat}/**"
  - "apps/yzt/src/pages/{current-map,data-query,space-monitoring-indicators,indicator-simulation,ai-chat}/**"
  - "apps/yzt/src/pages/dev/{map,map-3d,map-ui,resources,nav-grid,data-query,monitoring-indicators,indicator-simulation,splat-watch}/**"
  - "apps/yzt/src/app/map-*"
  - "apps/yzt/src/**/*.worker.ts"
---

# 地图（ADR 0020～0063，总览见 `docs/modules/map-overview.md`，设计见 `docs/modules/map-core.md`、`docs/modules/map-vue.md`、`docs/modules/map-tools.md`、`docs/modules/shared-map.md`）

## 选型

- 二维地图用 MapLibre GL JS 6，只用具名导入；`setWorkerUrl`、CSS 这类全局设置由 app 懒加载完成（登录页空闲时预加载，或首次进入地图时）；禁止引入 `mapbox-gl`（2.0 起为专有许可）（ADR 0002、0019、0023、0061）
- 距离和面积用 geographiclib-geodesic 按椭球面计算，不另写公式（ADR 0035）；其他几何计算按需安装 turf v7 的单个包，不用 `@turf/turf` 全家桶（ADR 0037）
- 地图内核的事件用 nanoevents；资源释放用标准的 `Disposable` / `DisposableStack`，运行时由 `app/main.ts` 全局引入的 core-js 补齐（ADR 0023）
- 天地图只通过 `appConfig.tianditu`（`{ key } | null`）使用；为 `null` 时不发任何公网请求，界面上也不出现依赖天地图的选项（ADR 0031）；这时底图是"静态底图"（默认）和"无底图"（ADR 0133）

## 会话、样式与分层

- map-core 持有地图会话状态（样式模型、相机、当前工具、选择状态），它是二维和三维共同的唯一真相源；Manager 修改会话状态，不直接写引擎
- 样式按分组推导：每个拥有者用纯函数从自己的状态推导出分组并整体替换；跨分组的修改用一次 `setGroups` 提交，批次不跨 `await`；交给会话的 GeoJSON 数据和样式图片不能原地修改，要换新对象（ADR 0022、0045）
- 地图能力按 ADR 0027 分层：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue，和业务、江苏都无关的通用交互（绘制、逐点编辑、测量、框选手势、鼠标旁的提示）在 `@mx/map-tools`（ADR 0145），项目级的公共能力（底图、行政区、工具栏界面）在 `shared/map`，业务数据驱动的图层在 feature，页面挑选组合；用组合，不做带开关的全能地图组件。一项能力放哪一层看它是否属于某个业务域，不看有几个使用方
- 页面用 `provideMap()` 创建会话，用 `map.bindStyle()` 把拥有者的推导函数（`() => StyleGroup`）绑定到分组，只能在同一个组件的 setup 里绑定；拥有者不提交样式，"不显示"用推导结果返回空分组表达（ADR 0028）
- 业务地图的画布用 `shared/map/backend-request.ts` 的 `JIANGSU_MAP_OPTIONS`（后端校验瓦片的 token，见 `docs/archive/migration.md`）：只给发往 `appConfig.apiBaseUrl` 的请求带 token，天地图等第三方不带；token 放请求头，不拼进地址。瓦片的 401 由 app 通过 `MAP_ERROR_REPORTER` 注入的 `reportMapError` 接收，和接口的 401 走同一个 `onUnauthorized`，页面不另外处理
- 引用别的分组数据源的推导，要依赖被引用方的状态，保证两者在同一轮变化、一起提交；拥有者的数据源、图层和样式图片的 ID 以分组名为前缀（ADR 0027、0028、0045）
- `shared/map` 和 feature 的地图能力按"拥有者"写（ADR 0031）：组合式函数持有状态（`shallowRef`，整体替换，值没变时不替换）并提供操作（参数不合法时抛错），推导分组的是纯函数；面板等界面通过 props 拿到拥有者，只显示和调用
- 会话的选择状态只存要素身份（数据源 + 业务主键），属性、几何、候选列表和详情留在 feature 的查询缓存里，高亮分组从选择和查询结果推导（ADR 0022、0047）
- 只有 MapLibre 适配器能写二维地图（lint 只允许 `packages/map-core/src/maplibre/` 和 `app/` 导入 maplibre-gl），不提供通用的原生地图出口，其他代码只能通过它的只读方法查询、投影；二三维共用的是生命周期、相机、输入、拾取、投影、渲染要素查询这几个视图接口（ADR 0024、0047；三维的渲染要素查询返回空数组）
- 视图上的差异（如三维期间不画二维标注）由适配器自己处理，不改会话状态；框架独有的功能按能力声明，独有状态由各自的模块保管，切换框架时保留
- 样式表达式和过滤条件在三维、Worker 里一律用 `@maplibre/maplibre-gl-style-spec` 求值，不手写求值器；它保证求值语义一致，不保证渲染效果一致，三维的支持范围按清单降级（ADR 0024）

## 相机与视图

- 默认视角 `useDefaultView(map)` 只在 `provideMap` 所在组件的 setup 里调用一次，其他组件通过 props 拿到 `goToDefaultView`（ADR 0033）
- 用户发起的定位是一次相机操作，作废之前没完成的定位：用上下文的 `runCameraOperation(camera => ...)` 执行；要先异步准备数据的，开始时 `const operation = beginCameraOperation()`，准备好、确认自己的请求没过期后 `operation.run(camera => ...)`；页面初始化的定位用 `currentCameraOperation().run(...)`，不开始新的操作。等就绪、跨视图失败等待、等待后的再确认都由 `run` 负责；每个操作只能 `run` 一次；回调拿到的相机控制只在回调期间有效，不要存下来。不要用相机变化判断请求是否过期（ADR 0038、0039）
- 上下文的 `view` 只在视图就绪时有值，只有 `kind`、`pick`、`project`、`queryRendered`；浮层只判断 `view` 是否为 `null`，不另外判断 `viewState`（ADR 0039）
- 和当前工具无关的鼠标位置（如状态栏的经纬度）用上下文的 `pointer`（工具模型的输入事件，一帧最多更新一次），不自己监听画布或原生地图的鼠标事件（ADR 0053 第 5 节）
- 贴边、会挡住定位的悬浮元素用 `useMapOverlay(element, edge)` 登记，`fitBounds`、`flyTo` 不传 `padding` 时自动避开；不定位、只要让被挡住的位置露出来时用相机控制的 `reveal`；页面不自己算定位用的 padding 和平移量，也不用布局的尺寸常量（ADR 0029、0037）
- 相机事件带 `view` 和 `cause`（`user` / `program` / `sync`），不用时间窗口判断回声（ADR 0024）
- 一个不合法的图层会让整个视图进入 `failed`，样式出现新版本时自动恢复（ADR 0026）；来自后端等外部配置的图层，由拥有者在配置变化时先校验自己的分组，不合法的不提交给会话
- 带 `sourceId` 的错误（瓦片、GeoJSON 加载失败）不算样式失败，记在视图的数据源错误里；拥有者从上下文的 `sourceErrors` 按数据源 ID 推导自己的加载失败，不监听原生的 `error` 事件，也不自己清除（ADR 0041）
- 地图的加载与失败提示由 `shared/map` 的 `describeMapStatus` 推导，界面只负责显示；引擎失败用上下文的 `retry()` 重建，不在页面里换画布的 `key`（ADR 0030）；MapLibre 引擎的三维模块加载失败（原因 `module`）只让三维失败，`retry()` 只重新加载模块（ADR 0147）

## 工具与工具栏

- 交互工具用 `map.registerTools()` 在页面的 setup 里登记，同一时间只有一个当前工具；工具声明光标和手势，只由适配器应用；工具只拿到 `ToolView`（`kind`、`pick`、`project`、`queryRendered`），不碰原生地图（ADR 0034、0047）
- 工具要接管按在自己手柄上的拖动（如逐点编辑的节点）时声明 `capturesPress(point, view)`，只对手柄返回 true，按在别处仍平移地图（ADR 0122）
- 关掉拖动平移的工具要临时拖动地图时声明 `panModifier`，值取 `@mx/map-tools` 的 `currentPanKey()`（Mac 用 ⌘，其他用 Ctrl），平移和手型光标由适配器负责，工具不自己监听修饰键（ADR 0056）
- 工具栏的按钮由页面挑选（`items`），动作的回调由页面给出（`actions`）；开关面板的动作，由页面通过 `pressed` 告诉工具栏显示为按下，工具栏不保存开关（ADR 0034、0036）
- 地图上跟着鼠标的提示用 `@mx/map-tools` 的 `PointerHint`（靠边时翻到另一侧），不在各个浮层里各写一套；挂在地图上某一点的卡片（如位置信息）只放在可视区域里（上下文的 `overlayPadding()`，ADR 0055）

## MapLibre 的写法

- fill 图层要用 `['geometry-type']` 限定为面：MapLibre 会把线也当成环填充；要写 `['Polygon', 'MultiPolygon']`，三维按要素原来的类型求值
- line 图层的 `line-dasharray` 不在常量和按要素取值之间切换（MapLibre 6.12 的缺陷会报错）：线型不同的要素按线型拆成多个图层，每层的线型是常量，实线不设（ADR 0046）
- 只随级别变化（常量或按 `zoom` 的 `step`）的 `fill-pattern` 设 `'fill-pattern-transition': { duration: 0 }`：过渡期间 MapLibre 按旧图片取图集位置，换花纹后会画错约 300 毫秒（见 `docs/archive/migration.md` 的"切换填充方式的闪烁"）

## 底图、边界、区划

- 行政区边界的入口：现状底图在业务组，打开功能标签；其他地图页给 `MapViewControls` 传 `boundaries` 和 `boundariesOpen`，点开是底图同款的浮层，不另放工具栏，开关由页面持有（窄屏时计入 `useSideExclusion`）；默认级别由页面设置（ADR 0128）
- 底图和行政区的浮层 `MapOptionsPopover` 没有操作栏：选了底图、再点入口、单击外部、按 Esc 都关闭，拖动和滚轮缩放地图不算点外部（`useLightDismiss`）；底图面板默认只有缩略图，当前缩略图角上的入口点开才有标注和透明度；标注是拥有者的 `labelsVisible`，全局一个，偏好单独一项 `basemap-labels`（ADR 0146）
- 内网的静态底图用本地市界直接绘制面、线和地名，不用图片，也不用天地图的截图或瓦片；地名在页面上开关，默认关（ADR 0146）；各市分色是 `shared/config/static-basemap-options.ts` 里的开关，不进 `.env`，默认关（全省 CREAM）；陆地色是换算好的不透明 HEX，不用透明度变量；绑定 `basemap-labels` 分组的页面在 `provideMap` 传 `root: BASEMAP_STYLE_ROOT`，打开地名后漏传时整个视图进入 `failed`；改了配色、分色开关或边界数据运行 `basemap:generate`（ADR 0133、0134）
- 区划目录和区划边界只用本地数据（`shared/map/region`），目录与市界、县界数据由测试保证逐条一致（ADR 0036）；经纬度的识别、显示和复制只用 `shared/map/location/coordinate-format.ts` 的纯函数（ADR 0037）
- 区划裁剪按区划边界的几何，不按要素属性里的区划代码过滤（业务数据的代码和区划目录对不上）：区划外用 `region-clip` 分组的遮罩盖住；显示和查询的范围都取 `readyBoundary`；点选、框选的渲染要素先按范围过滤再去重、计数，发给后端的几何只用 `@mx/map-tools` 的 `queryGeometry` 整理（误差不超过 2 像素、有效、最多 120 个坐标），整理不出来时提示范围太复杂（ADR 0051）

## 地图页

- 地图页的区域按 ADR 0070：行政区、图例、区划定位、坐标定位共用 `usePanelGroup` + `MapPanelGroup`，查询详情由独立 `FeatureDetailWindow` 展示，底图保留按钮左侧的 `MapOptionsPopover`；外壳负责标题、关闭和悬浮元素登记，内容不重复处理。功能入口打开时标签前移，直接点标签只切换；统一关闭只影响功能组。功能与详情同列上下排列，布局由 `panelStackLayout`、`usePanelStack` 管理，空间不足只收起非当前内容。有临时交互的内容接收 `active`，隐藏或收起时结束交互，关闭时卸载；窄屏仍由 `useSideExclusion` 决定最后操作的一边
- 地图页的界面按 5D 的设计稿（ADR 0053～0055）及后续已确认调整：当前工具、面板开关、视图状态、失败原因等仍是组合式函数、store 或纯函数里的数据，组件只显示和调用，测试放在逻辑上；随尺寸变化的排法写成纯函数（如 `mapPageLayout`、`fitStatusLayout`），组件只交给它量到的尺寸。新的界面块先出可操作的 HTML 原型（`local/design/`，不入库，用 `/design.local/<主题>/` 打开）或真实组件预览，用户确认后再实现，按 `docs/design/ui-workflow.md` 验证
- 地图页的路由组件用 `app/map-framework.ts` 的 `withMapRuntime` 包装：同时加载 MapLibre 的运行时和页面，都到了以后设置运行时、预热 Worker 池再返回页面；登录页空闲时 `app/map-preload.ts` 用同一个加载函数预加载，所以地图页分块的模块不在顶层做重的计算（ADR 0061）；二维第一次画面稳定后由画布把要预加载的内容（三维模块 map-three）交给 app 注入的 `MAP_RUNTIME_PRELOAD`，app 决定空闲时加载、省流量模式跳过（ADR 0091、0147）；交给 MapLibre 的容器元素只用静态 class，可变的 class 放在外层元素上，否则 Vue 会冲掉 MapLibre 自己加的 class
- 地图页被缓存时（ADR 0063）：`MapCanvas` 在页面停用时暂停视图、激活时恢复，隐藏期间的定位等恢复后再执行；视图恢复时先按容器尺寸调整画布，暂停时进行中的定位动画直接到终点并写回会话；面板内容在页面停用时按隐藏处理（`active` 为 false）

## 资源与 Worker

- 接收外部回调的模块（如 `onError`）在入口用 `@mx/utils` 的 `safeReporter` 包装：回调自己抛错不能打断内部的状态转换和资源释放
- 持有资源的对象实现 `Disposable`，监听和子对象都登记进内部的 `DisposableStack`；释放后等待中的操作以 `AbortError` 结束（ADR 0023）
- 二维不自建渲染 Worker；主线程热点先实测再移出；自建的 Worker 一律用 `@mx/utils` 的通信层（有类型的消息、`AbortSignal` 取消、归实例所有并可释放），取消分层与故障语义见 ADR 0025，用法见 `docs/modules/utils.md`；Worker 入口 `*.worker.ts` 只调用 `serveWorker`，处理函数放在普通模块里，入口由 `tsconfig.worker.json`（`webworker` 环境，不含 DOM）检查（ADR 0085）；Worker 内的缓存不转移出去，对外只传复制品或一次性产物
