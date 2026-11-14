# 项目级的公共地图能力（shared/map）

> 状态：5A.3 加入地图状态的提示和江苏的范围；5B.1 加入底图（目录、推导、拥有者、联调面板，现状底图已接入）；5B.2 加入行政区边界与默认视角（数据、推导、拥有者、联调面板，现状底图已接入）；5B.3 加入工具栏的外壳。工具栏等公共能力在 5B 陆续加入。分层见 ADR 0027：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue（[map-vue.md](map-vue.md)），这里放要读项目配置、用 Element 和 `SvgIcon` 的公共地图能力。

绘制范围、逐点编辑、测量、框选手势、鼠标旁的提示、发给后端的几何和临时拖动的键 2026-11-05 搬到了 `@mx/map-tools`（ADR 0145），见 [map-tools.md](map-tools.md)。这里留下的模块可以依赖那个包，反过来不行。

阶段五的界面后置到 5D 专门设计（[docs/archive/roadmap.md](../archive/roadmap.md)"阶段五"）。这里的组件起初都是联调用的界面：状态和文案由纯函数决定，组件只负责显示，5D 只换组件，纯函数保留。5D 已经换掉的：工具栏和基础组（5D.1）、状态栏（5D.3）、区划定位、坐标定位、底图与行政区的面板和卡片行（5D.4）；文件表里还写着"联调用的界面"的是没换的。

## 结构

地图页被布局缓存（ADR 0063）：这里的浮层、状态栏、工具栏的排法量尺寸都用 `@mx/map-vue` 的 `useShownElementSize`，停用期间量到的 0 不采用；Tab 面板在页面停用时把内容当作隐藏；位置点的图钉在页面停用时取消拖动。现状底图按 ADR 0070 使用一组功能标签、独立详情和底图 Popover，页面停用时关闭 Popover。

| 文件 | 内容 |
|---|---|
| `map-status.ts` | `describeMapStatus(viewState, failure)`：由视图状态和失败原因推导要显示的内容（纯函数） |
| `MapStatusNotice.tsx` | 加载中与失败的提示：中间的卡片、上方的警告条（设计稿 5D.7）；三维崩溃降档的提示（ADR 0155） |
| `scene-tier/` | 三维的设备档位：显卡分类、崩溃标记、替页面回答的 Worker、预算来源 `SceneTierSource`（[config/scene-tier.md](../config/scene-tier.md)） |
| `jiangsu.ts` | 江苏省的范围 `JIANGSU_BOUNDS`、创建地图时的相机 `JIANGSU_CAMERA`、缩放范围 `JIANGSU_ZOOM_RANGE` |
| `backend-request.ts` | 业务地图画布的选项 `JIANGSU_MAP_OPTIONS`：缩放范围，以及只给发往后端的瓦片请求带 token 的 `transformRequest`；地图错误的报告器 `reportMapError`：瓦片的 401 按登录过期处理 |
| `useDefaultView.ts` | 默认视角：第一次就绪时按江苏的范围定位，`goToDefaultView()` 回到默认视角（ADR 0033） |
| `useMapLoadMarks.ts` | 登录后第一次进入地图时，记下地图页开始创建、视图就绪、第一次画面稳定（见 [perf.md](perf.md)） |
| `basemap/basemap-style.ts` | 底图目录与推导：可选的底图、初始状态、`createBasemapStyles` 给出两个分组的推导函数（纯函数，ADR 0031） |
| `basemap/static-basemap.ts` | 内网静态底图的两个分组和页面要传的 `BASEMAP_STYLE_ROOT`（ADR 0133） |
| `basemap/static-palette.ts` | 静态底图的配色，地图样式和缩略图共用 |
| `basemap/data/jiangsu-labels.json`、`basemap/images/static-thumbnail.svg` | 静态底图的地名点和缩略图，由 `pnpm basemap:generate` 生成，不手改 |
| `basemap/useBasemap.ts` | 底图的拥有者：持有选择、透明度和标注的显隐，提供操作和两个推导函数 |
| `basemap/BasemapPanel.tsx` | 底图的切换：缩略图只写类型（公网三张、内网两张），点了告诉使用方；当前缩略图角上的入口点开标注和透明度（ADR 0146） |
| `basemap/BasemapCard.tsx` | 底图入口：当前底图的缩略图卡片，点开是左侧的底图浮层，选了底图就关闭；开关由页面持有，现状底图、数据查询、指标、AI 对话、指标 AI 计算共用（ADR 0111） |
| `popover/MapOptionsPopover.tsx` | 底图、行政区边界的左侧箭头 Popover：入口切换、关闭与定位避让，定位后报告顶部，开关由页面持有；内容通过插槽参数拿到 `close`（ADR 0070、0146） |
| `popover/useLightDismiss.ts` | 浮层的轻量关闭：单击外部（拖动不算）、按 Esc（ADR 0146） |
| `OpacityToggle.tsx` | 行政区边界的透明度展开图标，选中状态独立于 Tooltip |
| `tooltip.ts` | 地图 Tooltip 的统一显隐参数，避免快速扫过图标时延迟关闭与淡出重叠 |
| `boundary/BoundarySettingsPanel.tsx` | 行政区边界的内容（现状底图的功能标签、其他地图页的浮层）：复用边界面板，透明度入口和勾选同一行 |
| `panel-group/panel-stack.ts`、`usePanelStack.ts` | 同列功能与详情的高度分配、手动收起和小高度下的自动收起 |
| `basemap/BasemapThumbnail.tsx` | 底图的缩略图：注记叠在底图上，按 `focus` 对准；静态底图只有一张图；无底图是浅色方格与居中禁用图标（面板和底图卡共用） |
| `boundary/data/` | 省、市、县界的 GeoJSON，由转换脚本生成（见"行政区边界的数据"） |
| `boundary/boundary-style.ts` | 边界的级别、初始状态、`boundaryGroup` 推导（纯函数，ADR 0033） |
| `boundary/useBoundaries.ts` | 边界的拥有者：持有每一级是否显示和共用的透明度 |
| `boundary/BoundaryPanel.tsx` | 边界的面板：三级横排，勾选框后面是这一级的线型示意（设计稿 5D.4） |
| `toolbar/toolbar-items.ts` | 工具栏上的工具和动作：名称、图标、按钮上的分行集中在一张表里（ADR 0034） |
| `toolbar/MapToolbar.tsx` | 业务组：竖排、分组、文字每行两个字，矮屏时只显示图标（ADR 0053 第 2 节） |
| `view-controls/zoom.ts` | 层级的显示、按钮缩放的目标级别与连续点击的起点（纯函数），滚轮和触控板的缩放速率 |
| `view-controls/useZoomButtons.ts` | 基础组的层级与放大、缩小：每次 ±1，连续点击累计，被别的相机操作作废后重新开始 |
| `view-controls/compass.ts` | 指北针的提示（转过时写出角度）和图标要转的角度（纯函数，ADR 0058） |
| `view-controls/useCompassButton.ts` | 指北针：旋转和俯仰回到 0，中心和级别不变 |
| `view-controls/MapViewControls.tsx` | 基础组：层级、放大、缩小、指北针、行政区边界（页面给出拥有者才有）、默认视角、2D/3D（不支持三维的页面没有）（ADR 0053 第 3 节、ADR 0058、ADR 0111、ADR 0128） |
| `status-bar/status-bar.ts` | 状态栏的纯函数：比例尺的整齐长度、视点高度的写法、显示的角度、放不下时的取舍（ADR 0053 第 5 节、ADR 0080 第 6 节） |
| `status-bar/useMapReadout.ts` | 状态栏的读数：比例尺（三维是视点高度）、鼠标所在或画布中心的经纬度、角度，步行时的朝向，从地图上下文推导。鼠标所在的经纬度用悬停的拾取（跳过高斯泼溅，ADR 0149）：停在泼溅上时读的是后面的模型或地面，斜着看有视差 |
| `status-bar/MapStatusBar.tsx` | 左下角的状态栏：只显示，按量出的宽度取舍；插槽 `after` 紧跟在右边（请求状态），宽度先让出来 |
| `layer-panel/` | 资源图层面板的通用部件（ADR 0157）：外壳、目录树、当前图层的一组、工具栏、浮层、右键菜单、行的公共样式，目录的选择、节点、浮层位置、上下分割的纯函数（见"资源图层面板"） |
| `request-status/` | 地图数据的请求状态（ADR 0158）：条目和明细 `RequestStatusChip`、`useRequestStatus`、纯函数（见"请求状态"） |
| `area/area-geometry.ts` | 自定义范围的几何：限值 `AREA_LIMITS`、坐标检查、整理成有效的面、节点多时简化、面积与周长（见"自定义范围"，ADR 0121） |
| `area/area-file.ts` | 读范围文件：GeoJSON、Shapefile 的压缩包或同一组文件；读不了时返回原因 |
| `area/area-coverage.ts` | 范围与行政区求交：全部覆盖、部分覆盖、只在边界相交，以及在外面的面积；判定的容差 `COVER_RULES` |
| `area/area.worker.ts`、`area-worker-handlers.ts`、`area-worker-protocol.ts` | 范围分析的 Worker：读文件、整理画的范围、求交 |
| `area/area-analyzer.ts` | 主线程一侧：`createAreaAnalyzer()` 托管 Worker，读文件前先按大小拦下过大的文件 |
| `area/shpjs.d.ts` | shpjs 用到的 `parseShp` 的类型声明（`tsconfig.worker.json` 包含这个文件） |
| `geometry-schema.ts` | 查询接口返回的 GeoJSON 几何（及其字符串）的 zod schema；2026-10-28 从 `features/resource-map/api.ts` 移来 |
| `region/data/jiangsu-regions.json` | 区划目录：13 个市及各自的区县（见"区划目录的数据"） |
| `region/region-catalog.ts` | 区划目录的查询：市的列表、某个市的区县、按代码查找、路径、搜索（纯函数，ADR 0036） |
| `region/region-geometry.ts` | 从市界、县界文件取区划的边界：按代码查找、合并多个要素、外包范围；文件只下载、解析一次 |
| `region/region-style.ts` | `region` 分组的推导：选中区划的高亮（纯函数） |
| `region/region-clip.ts` | `region-clip` 分组的推导：区划外的遮罩，按环的嵌套深度构造（纯函数，ADR 0051） |
| `region/region-scope.ts` | 区划范围的几何判断：点在不在范围里、识别范围和区划求交、要素是否相交（ADR 0051） |
| `region/useRegionLocate.ts` | 区划定位的拥有者：选择、加载边界、定位、回到全省；面板点击的规则 `nextRegionSelection`；生效的边界 `readyBoundary` |
| `region/RegionLocatePanel.tsx` | 区划定位的面板：搜索、当前位置、市和区县的格子、加载与失败（设计稿 5D.4） |
| `region/RegionTrail.tsx` | 当前区划的各级（江苏省 › 市 › 区县），前面几级可以点；面板和区划条共用 |
| `region/RegionScopeBar.tsx` | 当前区划：地图上方可点击的各级和"回到全省"，登记为贴上边的悬浮元素（ADR 0055） |
| `location/coordinate-format.ts` | 经纬度的识别与格式：度分秒、小数、方向，一次粘贴的一对坐标（纯函数，ADR 0037） |
| `location/useLocationPoint.ts` | 位置点的拥有者：位置点、位置信息开关、输入框格式，定位、拾取工具，所在区县的判断 |
| `location/press-gesture.ts` | 图钉上的单击与长按拖动：与 DOM 无关的状态机 |
| `location/location-info.ts` | 位置信息放在可视区域的哪里、小三角的位置、所在区划的文字（纯函数） |
| `location/LocationOverlay.tsx` | 图钉、位置信息和拾取提示（设计稿 5D.7） |
| `location/useCoordinateInput.ts` | 坐标输入的逻辑：每个输入框的文字和精确数值、识别结果与提示、规范写法、切换格式、拆分一对坐标、提交 |
| `location/CoordinateLocatePanel.tsx` | 坐标定位的面板：度分秒 / 小数、经纬度输入、拾取、定位（设计稿 5D.4，逻辑在 `useCoordinateInput`） |
| `OpacitySlider.tsx` | 面板里的透明度一行：名称、不带刻度的滑块、百分比（底图和边界共用） |
| `card/MapCard.tsx` | 卡片行的入口：56 × 56 的白底卡片，上面 48 × 30 的图（图标或铺满的缩略图），下面一行字；面板打开时主色外边框（ADR 0057） |
| `panel-group/panel-group.ts` | 一组 Tab 面板的状态与规则：打开、切换、关闭（纯函数）；窄屏时左右只显示一边 `visibleSides`（ADR 0053） |
| `panel-group/usePanelGroup.ts` | 一组 Tab 面板：已打开的功能、当前的 Tab，页面级的界面状态 |
| `panel-group/useSideExclusion.ts` | 窄屏时左边的资源面板和右边的面板只显示最后操作的一边，只推导显示 |
| `panel-group/MapPanelGroup.tsx` | 一组 Tab 面板的外壳：Tab、关闭、内容的隐藏与 `active`（所在页面被缓存期间也为 false，ADR 0063），登记为贴右边的悬浮元素 |

## 江苏的范围与默认视角（ADR 0033）

```ts
// 页面 setup：只在 provideMap 所在的组件里调用一次，传入页面句柄
const { goToDefaultView } = useDefaultView(map);

// 画布带上缩放范围和瓦片请求的 token
<MapCanvas mapOptions={JIANGSU_MAP_OPTIONS} />
```

- `JIANGSU_MAP_OPTIONS` 的 `transformRequest` 每次请求时读取当前 token，只发给 `appConfig.apiBaseUrl` 下的地址，天地图和站内静态文件不带；MapLibre 在主线程转换请求，再连同请求头交给 Worker，所以 Worker 里发出的瓦片请求也带 token。token 放请求头、不拼进地址，避免进入日志和缓存的键。三维不显示矢量瓦片，不经过它
- `reportMapError` 由 app 的 `withRuntimeLoader` 通过 `MAP_ERROR_REPORTER` 提供给所有地图页，页面不用传 `onError`。带 token 发往后端的瓦片返回 401 时，它调用 `onUnauthorized`，和接口的 401 同样结束会话、提示并回到登录页；第三方地址的 401、没带 token 发出的瓦片（如未登录时的 `/dev/resources`）和其他错误只打印到控制台。瓦片的错误只带状态码和地址，带不回请求头，所以交给 `onUnauthorized` 的是最后发给后端的 token。回到登录页后地图已卸载，不会再收到这批瓦片的错误；只有其他标签页同一账号重新登录、这个标签页又立刻发出了新瓦片时，旧瓦片晚到的 401 才分辨不出来（见 [auth.md](auth.md) 的"旧会话的 401"）
- `JIANGSU_BOUNDS` 是省界数据的实际范围向外取整（`[116.35, 30.75, 121.98, 35.15]`），由测试检查它包含省界的全部范围、四边多出的不超过 0.05°。5A 时的 `[116.3, 30.7, 121.9, 35.2]` 东边界切掉了启东一角
- `JIANGSU_ZOOM_RANGE` 是 5～18 级，与旧项目一致：5 级能看到江苏和周边，天地图只有 18 级以内的数据
- `JIANGSU_SCENE_ZOOM_RANGE` 是三维的范围 5～20 级（用户 2026-11-11 定，近看模型），现状底图页把上限交给 `MapCanvas` 的 `sceneMaxZoom`，基础组在三维时用它；超过 18 级时底图是放大的 18 级瓦片。取值时查过的近裁剪面、相机高度、拖动滑动见 [map-three.md](map-three.md)"一个视图两种种类"
- 创建地图时用 `JIANGSU_CAMERA`（沿用旧项目的默认视角 119.5, 33.0, z6.8）
- 本次进入页面后，视图第一次进入 `ready` 时不带动画地 `fitBounds(JIANGSU_BOUNDS)` 一次：不同屏幕尺寸下都完整显示江苏，并避开登记过的悬浮元素（ADR 0029）；首次创建或加载失败、重试成功后同样补做；之后再次就绪（重建、恢复）不再定位，保留用户调整过的视角。初始适配不开始相机操作，setup 时写成 `currentCameraOperation().run(...)`（ADR 0038、0039）：等到第一次就绪、只执行一次、跨失败继续等都由 `run` 负责；就绪之前用户已经开始了操作（在加载期间选了区划、输入坐标定位、点了"默认视角"），这次操作已经作废，就让给用户的操作，不再适配
- `goToDefaultView()` 用 500ms 动画按江苏的范围适配，不传 padding（自动避开悬浮元素），旋转和俯角归零；它是一次相机操作（`runCameraOperation`），作废之前没完成的定位，视图还没就绪时等到就绪再定位。和旧项目"飞到固定相机"不同，不同屏幕和布局下都完整显示江苏
- 两处定位都传 `pitch: 0`：浏览器里实测，倾斜 45°、旋转 30° 后用不带俯角的 `fitBounds`，旋转归零了，俯角仍是 45°（MapLibre 算缩放级别时也不考虑俯角，平视和倾斜时都是 z6.39），所以给视图接口的 `fitBounds` 加了 `pitch` 选项（见 [map-core.md](map-core.md)）。加上后两者都归零，中心和缩放级别与平视时相同
- 现状底图页上有一个临时的"默认视角"按钮，5B.3 换成工具栏
- 只在页面的 setup 里调用一次：画布创建视图之后再调用会抛错。工具栏等需要回到默认视角的组件通过 props 拿到 `goToDefaultView`，不要自己调用 `useDefaultView`，否则它会在下一次就绪（如恢复显示）时把用户调整过的视角重置
- 5A 时写成"挂载时等一次 `whenReady()`"，首次失败后重试成功不会再定位，5A 之后改为侦听视图状态，5C.0d 改为在当前操作下 `run`。页面测试用 `stubs` 把画布换成注入了假地图的同一个组件（改名，避免替身里的画布又被替换）
- 1280 宽的现状底图上实测：相机从 (119.5, 33.0, z6.8) 定位到 (119.1, 32.98, z6.5)；进入后立刻离开，等待被中止，没有报错
- 不会先按初始相机画一帧再跳：5B.1 接入天地图后，在真实的 MapLibre 上记录每一帧的相机，顺序是创建时的 `jumpTo` → 进入就绪时同步会话相机的 `jumpTo`（z6.8）→ 页面的 `fitBounds` → 第一次渲染，第一次渲染时已经是适配后的视角，三步在同一帧之前完成；瓦片也没有按初始相机多请求。原因是 MapLibre 在动画帧里加载样式，就绪和定位在同一帧的微任务里完成，下一帧才渲染

## 底图（ADR 0031）

公网用天地图，内网用本地数据画的静态底图（ADR 0133），按 `appConfig.tianditu` 决定能选哪些：

| 底图 | 环境 | `basemap` 分组 | `basemap-labels` 分组 |
|---|---|---|---|
| 矢量底图 | 公网（默认） | 背景 + 天地图 `vec` | 天地图 `cva` |
| 影像底图 | 公网 | 背景 + 天地图 `img` | 天地图 `cia` |
| 静态底图 | 内网（默认） | 省外底色 + 市界上的面和线 | 市、区县地名；标注默认关，这时是空的 |
| 无底图 | 都有 | 背景 | 空 |

```ts
// 页面 setup：拥有者的状态随页面，进入页面时重新开始；root 给静态底图的地名用（ADR 0133）
const map = provideMap({ groups: ['basemap', 'basemap-labels'], camera: JIANGSU_CAMERA, root: BASEMAP_STYLE_ROOT });
const basemap = useBasemap({ preferences: usePreferenceScope() });
map.bindStyle({ basemap: basemap.deriveGroup, 'basemap-labels': basemap.deriveLabelsGroup });

// 面板通过 props 拿到 basemap，只显示和调用
basemap.options;          // 可选的底图（按 appConfig.tianditu）
basemap.selected.value;   // 当前底图
basemap.opacity.value;    // 当前底图的透明度（0～1），无底图时为 null
basemap.select('imagery');
basemap.setOpacity(0.6);
basemap.selectForDimension('3d'); // 切换二三维后选默认的底图
basemap.labelsVisible.value;      // 标注是否显示，所有底图共用一个
basemap.setLabelsVisible(false);
```

- `selectForDimension(kind)`（ADR 0078 第 2 节）：三维选影像、二维选矢量；没有这种底图（关闭天地图）时不变。页面切换 `map.setDimension` 后调用。它只换显示的底图，偏好只存用户自己用 `select` 选的（ADR 0114）

- `useBasemap()` 默认读取 `appConfig.tianditu`，测试时传入 `{ tianditu }`；不传偏好的范围时不依赖组件的生命周期，没有要清理的东西。推导用的是 `createBasemapStyles(tianditu)` 的两个纯函数
- 不用 Pinia：状态只在一个页面里共享，不带到其他地图页，同一页面上的两张地图互不影响（ADR 0031）
- 状态是一个 `shallowRef`，变化时整体替换；选择或透明度没变时不替换，推导函数包在 `computed` 里（提交器就是这样做的）时不会重新推导。滑块拖动时会重复给出相同的值
- 不合法的调用直接抛错，状态不变：选择不可用的底图（如关闭天地图时选矢量）、透明度不是 0～1 之间的有限数、无底图时修改透明度。界面只提供可用的操作，这些都是编程错误；错误在操作里抛出，不进入推导和 `computed`
- 记住选择（5C.3，ADR 0042）：页面传入偏好的范围 `useBasemap({ preferences })` 时，先用默认值，读到存下的偏好后替换一次（`basemap-preference.ts`）：选中的底图当前可用就恢复它，不可用（换了部署环境）时保留当前的选择；每种底图的透明度经校验（0～1）后照样恢复。之后选择、改透明度防抖写入。格式是版本 2（版本 1 里内网只能存"无底图"，不算用户的选择，ADR 0133）。`.env` 现在关着这一项（`VITE_PREFERENCE_BASEMAP=false`，ADR 0140），每次进入都是默认底图。用法与规则见 [storage.md](storage.md)
- 标注（ADR 0146）：全局一个，切换底图、二三维时沿用；默认公网开、内网关（`initialLabelsVisible`）。偏好单独一项 `basemap-labels`，默认打开，底图偏好关着也记住。状态是单独的 `shallowRef`：和 `BasemapState` 放在一起时，一项偏好恢复会让另一项以为用户操作过而放弃恢复。使用 `useBasemap` 的业务页都传偏好的范围，标注在页面之间共用；开发页不传

- 状态（`BasemapState`）只有选中的底图和每种底图的透明度（0～1），可以直接序列化；透明度同时作用于底图和注记，不影响背景
- 背景是 `basemap-background`（`#F3F5F8`，静态底图时是省外底色 `#E6EAF0`），无论选哪种底图都在最底下：无底图时显示它，瓦片加载中和调低透明度时与它混合
- 天地图的数据源设 `minzoom: 1`、`maxzoom: 18`：2026-10-10 实测 `vec`、`cva`、`img`、`cia` 只有 1～18 级有数据，0 级和 19 级也返回 200，内容是占位图；超过 18 级时放大使用 18 级的瓦片
- 没选中的底图，数据源不在样式里；改透明度只产生 `setPaintProperty`。这一点由 style-spec 的 `diff` 对数据源做深比较保证，与数据源是不是同一个对象无关（改坏验证时发现，见"测试"）
- 关闭天地图（`appConfig.tianditu` 为 `null`，内网部署）时能选"静态底图"和"无底图"，进入时是静态底图；工厂不建天地图的数据源，无论状态是什么，推导结果里都没有天地图
- 瓦片地址里的 `{z}`、`{x}`、`{y}` 由 MapLibre 替换，地址用模板字符串拼，不经过 `URLSearchParams`（会把花括号转义）

### 静态底图（ADR 0133、0134）

- 不用图片：和行政区边界同一份市界（`jiangsu-city.json`）直接画面和线，任何级别都清晰，和边界严格重合。评估过单张图片、瓦片金字塔，实测对比见 ADR 0133
- 地名在页面上开关（ADR 0146），没有代码开关。陆地全省一种颜色 `STATIC_LAND_COLOR`（CREAM），不按市分色：ADR 0134 的分色开关用户 2026-11-11 决定取消，各市的配色一起删掉了，要找回看 git 历史
- 陆地色是不透明的 HEX：原色 `#F7F3E6` 按 75% 叠在省外底色 `#E6EAF0` 上换算成 `#F3F1E9`（ADR 0134），原色写在 `static-palette.ts` 的注释里。没有透明度常量，`fill-opacity` 只有底图的透明度滑块
- 地名点由 `pnpm basemap:generate` 生成，取面内离边界最远的点；打开标注时市名一直显示，区县从 8.5 级起显示，市名避让时优先
- 地名只有汉字，用 `JIANGSU_MAP_OPTIONS` 的 `localIdeographFontFamily` 在本地画，不请求字形。样式校验要求有 `glyphs`，所以绑定注记分组的页面都要在 `provideMap` 传 `root: BASEMAP_STYLE_ROOT`，地址不会被请求；打开标注后漏传时整个视图进入 `failed`，`pages/map-pages.test.ts` 检查
- 三维：和二维是同一个 MapLibre 视图，面、线和地名照常按样式画，被模型挡住还是画在模型上面见 [map-three.md](map-three.md)"叠放"。切换二三维时保持静态底图。ADR 0135 的细节上限（`overlayDetailMetadata`）和 ADR 0146 的"三维画成文字、不做避让"是 Cesium 镜像覆盖物时的做法，随 Cesium 移除（ADR 0153）
- 面的过滤条件要写 `['Polygon', 'MultiPolygon']`：MapLibre 画的时候都是 `Polygon`，按 GeoJSON 原来的类型求值（`featureFilter`）时南京是 `MultiPolygon`，只写 `Polygon` 会被滤掉
- 改了配色或边界数据后运行 `basemap:generate`；缩略图和当前配色是否一致由测试检查

### 面板与底图卡（设计稿 5D.4、ADR 0146）

```tsx
<BasemapPanel basemap={basemap} onPicked={close} />   // close 来自 MapOptionsPopover 默认插槽的参数
const current = basemapOption(basemap.selected.value);   // { id, label: '矢量底图', shortLabel: '矢量' }
<MapCard
  label={current.shortLabel}
  name={`底图：${current.label}`}
  pressed={display.isOpen('basemap')}
  onClick={() => toggleDisplay('basemap')}>
  {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[current.id]} />] }}
</MapCard>
```

- 缩略图只写类型（选项的 `shortLabel`：矢量、影像、静态、无底图），名称叠在缩略图右下角，沿用底图卡的半透明底色，选中时为主色底、反白文字；无障碍名称是全称，当前的用 `aria-pressed`、主色描边和右上角的勾（`SvgIcon` 的 `check`）
- 缩略图由拥有者给出（`basemap.thumbnails`，`basemapThumbnails(tianditu)` 纯函数）：天地图南京所在的那张 10 级瓦片（849, 415），底图和配套的注记各一张，放大到 160% 后按 `focus`（86% 67%，南京在瓦片里的位置）对准。和底图的数据源用同一个地址模板（`tileUrl`）；静态底图是打包的 SVG，没有注记（`labels` 为 `null`），`focus` 居中，放大到 160% 后全省正好露出来；无底图为 `null`，显示和地图背景同色的方格；关闭天地图时矢量、影像为 `null`，不请求天地图。组件不读 `appConfig`
- 底图面板默认只有缩略图（ADR 0146）。当前缩略图左上角的入口（`aria-pressed` 跟着展开状态）点开两行：标注开关（`ElSwitch` 的 small）、透明度滑块；面板接收 `active`（`MapOptionsPopover` 默认插槽的参数），不显示时收起，每次打开都是收起的；调过的值在拥有者里。无底图没有入口。行政区用 `BoundarySettingsPanel`，选项行的 `OpacityToggle` 控制下方滑块
- 透明度用共用的 `OpacitySlider`：滑块按百分比显示、不带刻度、右边写出百分比，拖动过程中实时交出 0～1。Element 的滑块宽 100%，两端各留 `--space-md`（12）并计入宽度（`box-sizing: border-box`）；端点圆点悬浮放大到 24 时，与名称及百分比仍保留至少 8 间距
- 关闭（ADR 0146）：选了底图（内容调插槽参数的 `close`）、再点入口、单击外部、按 Esc、页面停用。`useLightDismiss` 在 `document` 的捕获阶段监听：按下到松开移动超过 4 像素算拖动，不关闭，不靠 MapLibre 拖动后吞掉 click；从浮层里按下、拖到外面松手不关闭；按键触发外部的按钮也算点击；Esc 不再往下传，当前工具不会同时结束。`close` 和 Esc 把焦点还给入口，单击外部不抢焦点。`visible` 与更新监听保持受控，忽略 Element 的自动显隐请求；禁用组件的触发按键拦截，键盘通过原生按钮点击执行同一开关
- 底图 Popover 在入口左侧间隔 12、带箭头，宽 320，固定定位并限制在视口内；窄屏限制宽度，内容自然撑高，无内部滚动区。`afterWrite` 定位修饰器报告真实顶部，右侧面板列在它上方留 12；内容变高和视口变化都会重新定位：外壳自己监听内容的尺寸，Element 的监听只在 `visible` 变化时开始，`persistent` 为 false 时内容挂载时已经可见，它不会开始；顶部要等这一轮渲染后再量，Element 的位置要等 Vue 渲染才写进 DOM（`MapOptionsPopover.browser.test.tsx`）。`OpacityToggle` 的独立选中类和 `aria-pressed` 跟随展开状态，不依赖 Tooltip 的 `aria-expanded`
- 底图不显示标题和操作栏，四周留 12。缩略图等宽、高 60，独占整行，收起时面板高 86；展开的两行在缩略图下方，间隔 12、行距 8，面板高 154，不增加内部滚动区
- 底图卡（ADR 0066）：基础控制栏下方的 80 × 56 缩略图，四周留 2，右下角写简称（矢量、影像、静态、无底图），无障碍名称写全称"底图：矢量底图"（`MapCard` 的 `name`）；名称和简称用 `basemapOption(id)` 按 ID 取
- `MapCard` 有封面时使用缩略图变体，无封面仍保留 56 × 56 的图标卡。面板打开时沿用主色外边框和独立焦点框，缩略图名称使用主色底；现状底图的图例入口已移至右上工具栏
- `Basemap` 接口里的函数都写成函数类型的属性（`readonly deriveGroup: () => StyleGroup`），不写方法签名：它们是闭包，页面直接取出来交给 `bindStyle`，写成方法签名时 lint 的 `unbound-method` 会报错

### 浏览器验证（2026-10-10）

在 `/current-map` 用真实的 MapLibre 验证：

| 场景 | 结果 |
|---|---|
| 公网配置进入页面 | 矢量底图和注记显示；只请求 `vec`、`cva`，8 个子域名都用到 |
| 切到影像底图 | 样式里只剩 `basemap-imagery`、`basemap-labels-imagery`，只请求 `img`、`cia`；没有错误 |
| 拖动透明度到 40% | 影像和注记的 `raster-opacity` 都变成 0.4，没有新的瓦片请求 |
| 切到矢量再切回影像 | 矢量是 100%，影像仍是 40%，各自记住 |
| 无底图 | 样式里只有 `basemap-background`，没有数据源，滑块隐藏 |
| 放大到 z19.6 | 只请求 18 级瓦片，显示的是放大的 18 级瓦片，不是占位图 |
| 内网配置（`dev:intranet`）进入页面 | 当时面板只有"无底图"，2026-11-03 起默认静态底图（ADR 0133）；地图画出背景色（在渲染的那一帧读像素是 243、245、248）；整个页面没有任何外部域名的请求 |
| 375 宽 | 面板宽 220，在屏幕内，没有横向滚动 |

- 缩小时地图最小只到 z0.71（画布尺寸的限制），瓦片按 2 级请求；栅格瓦片按 256 像素换算，瓦片级别总比地图缩放级大 1，所以不会请求 0 级，`minzoom: 1` 只是写明天地图的范围
- 读 WebGL 画布的像素要在渲染的那一帧里读：MapLibre 没有开 `preserveDrawingBuffer`，帧画完后缓冲区被清空，事后用 `drawImage` 读到的是全透明

## 行政区边界（ADR 0033）

```ts
// 页面 setup：边界在注记上面（旧项目把边界移到最顶，见 ADR 0033 第 4 条）
const map = provideMap({ groups: ['basemap', 'basemap-labels', 'boundaries'], camera: JIANGSU_CAMERA });
const boundaries = useBoundaries();
map.bindStyle({ boundaries: boundaries.deriveGroup });

boundaries.options;           // 省界、市界、县界
boundaries.visible.value;     // { province: true, city: false, county: false }
boundaries.opacity.value;     // 三级共用的透明度（0～1）
boundaries.setVisible('city', true);
boundaries.setOpacity(0.6);
```

- 每个打开的级别一个 GeoJSON 数据源和几条线（ADR 0057）：核心线的 ID 是 `boundaries-province` 等，色带、白边是 `boundaries-province-band`、`boundaries-city-casing` 这样加上部位；各级从下到上是县、市、省，一级之内是色带、白边、核心线
- 数据源直接写 `?url` 导入的地址（`{ type: 'geojson', data: url }`），由 MapLibre 在 Worker 里下载和解析；地址带内容哈希，可以长期缓存
- 关闭的级别不在样式里，打开时才下载；关掉再打开要重新解析（下载命中缓存）。打开、关闭一级只增删这一级的数据源和图层，改透明度只产生 `setPaintProperty`
- 线型（ADR 0057，2026-10-16 按用户的优化意见改，原来照搬旧项目，三级同色、只靠线宽区分）：
  - 省界：主色色带（宽 7～16、0.22、虚化 1），白边（3.4～5.6、0.7），`#2F54EB` 的核心线（1.8～3.2、不透明）
  - 市界：白边（2.4～4、0.6），主色实线（1～2、0.95）
  - 县界：主色虚线（3、2 个线宽），宽 0.8～1.4（从 8 级起变化）、0.8
  - 省、市都是实线，共用的边上省界的核心线和白边都不比市界的窄，盖住市界（测试检查各档线宽）；白边在矢量底图上几乎看不见，让影像底图上的线更清楚
- 状态里的透明度乘在每一条线的不透明度上。线宽写成"级别 → 线宽"的几档数据，地图上的插值表达式由它生成，面板的线型示意（`boundarySwatch` 从下到上列出每一条线）取中间一档，不在界面上求值表达式
- `useBoundaries()` 的写法与 `useBasemap()` 相同：状态是一个 `shallowRef`，值没变时不替换；透明度不是 0～1 之间的有限数时抛错。三级都关闭时仍可以改透明度
- 进入页面时只显示省界；指标页（阶段六）要四项全开时再加初始值的参数
- 记住选择（5C.3，ADR 0042）：`useBoundaries({ preferences })` 读到存下的三个级别和透明度后整体替换一次（`boundary-preference.ts` 的 schema 校验通过才用），之后的修改防抖写入
- 面板 `BoundaryPanel`（设计稿 5D.4）：常规宽度三级横排，窄屏自动换行，勾选框后面是这一级的线型示意（ADR 0057：24 宽的 SVG，从下到上叠同样的几条线，高度放得下最宽的一条；色带的虚化只有 1 像素，不画；虚线的线段和间隔按线宽换算，圆头画在线段外面，和 MapLibre 的圆头虚线一样）；文字只显示省 / 市 / 县，`aria-label` 保留省界 / 市界 / 县界。同一行的 `actions` 插槽用细线分隔透明度操作；透明度用共用的 `OpacitySlider`，没有打开任何级别时没有这一行。复选框组给出勾选的全部值，按级别逐一 `setVisible`，值没变的级别不替换状态。现状底图用 `BoundarySettingsPanel` 放进功能标签，不重复标题，透明度默认收起，切走或收起功能面板后恢复收起；关闭标签不清空边界选择（ADR 0070）；其他地图页放在基础组入口的浮层里（ADR 0128，见"基础组"）

### 浏览器验证（2026-10-10）

| 场景 | 结果 |
|---|---|
| 进入页面 | 样式里是底图背景、矢量底图、注记、省界，省界压在注记上面；市界、县界的数据源不在样式里，没有下载 |
| 勾选市界、县界 | 开发服务器上从勾选到数据加载完成：市界 488ms（未压缩的 1.4 MB）、县界 43ms；叠放从下到上是县、市、省；没有错误 |
| 取消市界再勾选 | 数据源先被移除，再勾选时 121ms 加载完成（下载命中缓存，只重新解析） |
| 透明度拖到 50% | 县、市、省的不透明度分别是 0.31、0.39、0.47 |
| 县界与市界对不齐 | 用数据算：县界顶点到最近的市界线段，离市界 2 公里以内的 3809 个顶点里，偏差的中位数约 150 米，90% 在 730 米以内；按 12 级每像素约 16 米算是 10～45 像素，10 级以上能看出来 |
| 倾斜后点"默认视角" | 加 `pitch: 0` 之前俯角保持 45°，加上之后俯角、旋转都归零，中心 119.165°、z6.39 |
| 内网配置 | 省界照常显示在背景色上，没有任何外部请求 |
| 生产构建 | 三份数据是带哈希的独立文件（`assets/jiangsu-city-<hash>.json` 等），没有打进 JS；页面分块 59 KB |

- 开发服务器上，`?url` 导入本身是一个只导出地址的小模块（约 500 字节），真正的数据由 MapLibre 在 Worker 里下载，主线程的 `performance` 记录和浏览器面板的网络记录里都看不到；验证时直接看地图上数据源的状态（`getSource(id).loaded()`、`querySourceFeatures`）

## 行政区边界的数据（ADR 0033）

`boundary/data/` 下的三份边界由 `apps/yzt/tools/boundaries` 的脚本从旧项目转换而来：

| 文件 | 来源（yzt 836f03b `public/static/geojson/`） | 要素 | 原始大小 → 转换后 |
|---|---|---|---|
| `jiangsu-province.json` | `江苏省界.json` | 1 | 798 KB → 464 KB |
| `jiangsu-city.json` | `江苏省市界.json` | 14（连云港分成两块） | 2479 KB → 1441 KB |
| `jiangsu-county.json` | `江苏省县界.json` | 95 | 199 KB → 199 KB |

- 转换：坐标保留 6 位小数（约 0.1 米，原始数据有 14～15 位），属性只留 `name` 和 `code`（省取 `adcode`、市取 `code`、县取 `gb`），去掉 `crs`（县界标的是 CGCS2000，与 WGS 84 相差不到 1 米）。原始文件的结构不符合时报错，不生成残缺的数据
- 县界大幅简化过（每个县约 89 个点），放大后和市界、省界对不齐；没有更精细的数据，原样迁移
- 重新生成：先把旧仓库 `master-demo` 上的三个文件导出到一个临时目录（`git show master-demo:public/static/geojson/江苏省界.json > <目录>/江苏省界.json`，另两个同理），再在仓库根目录运行 `pnpm --filter yzt boundaries:generate <目录>`

## 工具栏（ADR 0034、0053）

```tsx
// 页面：挑选按钮并分组，动作的回调由页面给出；放在 provideMap 所在组件的子孙里
<MapToolbar
  groups={[['browse', 'feature-pick'], ['measure-distance', 'measure-area', 'clear'], ['region-locate', 'coordinate-locate']]}
  actions={{ clear, 'region-locate': () => functions.toggle('region-locate', sides.right.value) }}
  pressed={functions.isOpen('region-locate') ? ['region-locate'] : []}
  compact={compact}
/>
```

- 业务组（ADR 0053 第 2 节，设计稿 5D.1）：竖排、宽 56，组之间画分隔线；按钮 48 × 46，图标 20 在上，文字 12 在下、每行两个字（`labelLines`），"区划定位""坐标定位"分两行、高 62；整组约 380 高
- `compact`：只显示图标，整组宽 40、按钮高 32，名称放进左边的 `ElTooltip`，`aria-label` 始终是完整名称。现状底图按地图操作、测量、定位、显示辅助、清理五组排列；`mapPageLayout` 在地图高度低于 692 时启用双列，宽 72、按钮高 28，清理独占末行。`pressed` 表示当前显示、浅主色底，`opened` 表示已打开标签、仅主色图标；当前工具仍用实心主色（ADR 0070）
- 地图工具栏、右下控制栏、透明度入口和资源状态提示共用 `MAP_TOOLTIP_PROPS`：悬停 200 毫秒后显示、移出立即关闭、不可进入提示内容、关闭后不常驻；`transition="none"` 使用没有 CSS 过渡的名称，避开 Element 默认淡出动画（空字符串会回退到默认动画）。资源透明度滑块已有百分比输出，和公共透明度滑块一样禁用重复的数值 Tooltip
- 状态：当前工具主色实心（`aria-pressed`），打开着面板的动作浅主色底（也是 `aria-pressed`），悬停浅底主色，不可用灰色，键盘焦点 `:focus-visible` 时 2 像素的浅主色描边
- 业务组贴在右边、会挡住定位，组件自己登记为贴右边的悬浮元素（ADR 0053 第 9 节）
- `toolbar-items.ts` 把工具和动作分成两张表，名称、图标集中在这里；图标是 `SvgIcon` 的名字（`map-move` 等，Tabler Icons，见 [icons.md](icons.md)"第三方图标"）。"默认视角"不在这里，移到了基础组。工具的 ID 就是登记到会话里的工具 ID，测距、测面用 `@mx/map-tools` 的 `MEASURE_TOOL_IDS`
- 按钮上的文字默认每行两个字（`labelLines`）；条目可以用 `lines` 指定分行，"点/框选"写成一行（`buttonLines`，2026-10-16 用户要求）。点/框选工具的光标是十字
- 点选的按钮在这里，ID 是 `FEATURE_PICK_TOOL`（`'feature-pick'`），实现由业务模块登记（ADR 0047 第 6 节）：现状底图页登记 `features/resource-map` 的 `useFeaturePick().tools`。按钮放进 `items` 之前必须先登记，否则点击时 `activateTool` 抛错
- 工具按钮读 `useMap().activeTool`，激活的按钮高亮；点击没激活的工具时 `activateTool`，点击激活的工具时 `releaseTool`（临时任务退回上一个常驻模式）。"移动"是常驻模式，再点一次什么也不做
- 动作按钮调用页面通过 `actions` 传入的回调，没有回调时不可用。开关面板的动作（区划定位，以后的坐标定位）也是动作：面板开关是页面的界面状态，页面通过 `pressed` 告诉工具栏哪些显示为按下（高亮、`aria-pressed`），工具栏自己不保存；它和当前工具互不影响（ADR 0036）
- 现状底图页把它放在最右列上方，基础组与底图卡在同列下方，右边缘对齐（ADR 0066）

## 基础组（ADR 0053 第 3 节）

```tsx
// 页面：放在工具栏一列的下面；默认视角的回调来自页面的 useDefaultView，缩放范围和画布的相同
<MapViewControls goToDefaultView={goToDefaultView} zoomRange={JIANGSU_ZOOM_RANGE} />
<MapCanvas mapOptions={JIANGSU_MAP_OPTIONS} scrollZoomRates={SCROLL_ZOOM_RATES} />
```

- 宽 40，只有图标，悬停在左边提示名称：层级（32 × 28）、放大、缩小、指北针（32 × 32）、默认视角、2D/3D（上下两格，各 32 × 24）；整组 241 高（加指北针以前是 209）。角落里的小控件，不登记为悬浮元素
- 指北针（ADR 0058，2026-10-16 用户要求）：在"缩小"下面，和放大、缩小在同一段。图标是多色的 `map-compass-color`（北半红、南半灰），用 `SvgIcon` 的 `rotate` 转 `-bearing`，指针总是指向地图上的正北。点击是一次新的相机操作（`runCameraOperation`），只交出 `flyTo({ bearing: 0, pitch: 0 })`，动画和放大缩小一样（`VIEW_BUTTON_DURATION`，300 ms）；不传中心，相机控制不换算避让的留白，中心和级别都不变。提示和无障碍名称是"指北针：恢复正北、垂直俯视"，转过时加上"（旋转 35°）"，角度的写法和状态栏一样（`visibleAngles`）；正北、没有俯仰时照常可以点
- 层级向下取整（`levelOf`，加 1e-6 再取整），悬停和无障碍名称是"当前层级 13（13.6）"；面板的"放大至第 N 级显示"、点选的 14 级界限都按"级别 ≥ N"判断，所以不四舍五入
- 放大、缩小每次 ±1（13.6 → 14.6），截断在缩放范围里，到头时按钮不可用；动画 300 ms。每次点击是一次新的相机操作（`beginCameraOperation`），记下这次的目标级别：上一次按钮缩放还没被作废时接着它的目标累计（连点两下就是 +2，不读动画的中间值），被别的相机操作（滚轮、拖动、默认视角、区划定位等）作废后从当时的级别算起。信号的中止不是响应式的，作废时清掉记下的目标，按钮的可用状态马上按当时的级别重新计算
- 缩放范围随 `zoomRange` 变化：支持三维的页面按维度传（现状底图三维是 `JIANGSU_SCENE_ZOOM_RANGE`）。切换维度时视图按会话的相机跳过去（打断动画，三维切二维时收回超过 18 级的部分），但不作废相机操作，所以维度一变就丢掉记下的目标（同步侦听 `dimension`），之后从当时的级别算起：否则三维放大到 20、切二维、再切回三维时，记下的 20 又生效，级别显示 18 却不能放大、缩小变成放大
- 页面不传 `dimension` 时（不支持三维）不显示 2D/3D 和它前面的分隔线，默认视角是最后一段（ADR 0111；原来 3D 照常显示、`aria-disabled`，提示"三维暂未开放"）
- 页面传了 `dimension`（`ViewKind`）时两格都可用：当前的一格高亮，点另一格发出 `update:dimension`，点当前的不发；切换本身和切换时换底图都由页面决定（三维原型 `/dev/map-3d` 已使用，业务页在三维阶段接入）
- `defaultView`（默认 true）为 false 时不显示默认视角和它下面的分隔线：现状底图在地下空间时传 false，飞到全省会离开模型（ADR 0084）
- 行政区边界（ADR 0128）：页面传 `boundaries` 才有这个入口，排在指北针一段和默认视角之间，整组 223 高（没有 2D/3D 时）。开关由页面持有，写法同底图卡：`boundariesOpen`、`update:boundariesOpen`，窄屏让给另一边时 `boundariesVisible` 为 false，页面把 `boundariesOpen` 计入 `useSideExclusion` 的 `rightOpen`。点开是 `MapOptionsPopover`（`placement="left-end"`）+ `BoundarySettingsPanel`（透明度入口和勾选同一行，ADR 0146）；现状底图的入口在业务组，不传。名称和图标取 `TOOLBAR_ACTIONS.boundaries`，和业务组是同一条
- 滚轮和触控板的缩放速率 `SCROLL_ZOOM_RATES`：滚轮 1/600、触控板 1/150（MapLibre 默认 1/450、1/100），首轮先调低灵敏度，用普通鼠标和触控板实际试过后再定。画布的 `scrollZoomRates` 只在创建地图时生效，由适配器设到 MapLibre 的 `scrollZoom` 上

## 状态栏（ADR 0053 第 5 节）

```tsx
// 页面 setup：读数从地图上下文推导；状态栏在左下角、资源面板下面（ADR 0095）
const readout = useMapReadout(map);
<MapStatusBar class={styles.status} readout={readout} format={location.state.value.format} />
```

- 内容：比例尺（三维里换成视点高度，ADR 0080 第 6 节）；鼠标所在的经纬度（鼠标不在画布上时是画布中心，前面标"中心"）；旋转、俯仰取整后不为 0 时显示。不写署名（5D.3 用户决定，以后换成内网底图），适配器关掉了 MapLibre 的版权控件
- 读数 `useMapReadout`：视图不在就绪时比例尺和经纬度都为 null，整条不显示。经纬度用上下文的 `pointer` 拾取（来自工具模型的输入事件，和当前工具无关）；画布中心直接取相机的中心（二维里就是画布中心：适配器定位时把留白换算成偏移，不给 MapLibre 设长期的 padding）。比例尺把相机的中心投影到屏幕，在这条水平线上取相距 100 像素的两点拾取，用 map-core 的 `geodesicDistance` 按椭球面算距离（和测量同一套）。两者都读 `projectionRevision`，鼠标不动、地图缩放或画布尺寸变化时重新计算
- 三维（ADR 0080 第 6 节）：没有比例尺，第一段是"视点高度"，读就绪视图的 `eyeHeight()`（相机在椭球面以上的高度），相机每次变化时重新读；写法按 `eyeHeightLabel`：不到 1 km 写整米，不到 10 km 保留一位小数，再高写整千米，按取整后的值分档（不出现"1000 m""10.0 km"）；视点在地表以下（钻地、站内漫游，取整后深 1 米以上）时写"视点在地表以下 18 m"（`eyeText`，原型 `/dev/map-3d`，ADR 0083），并且鼠标不在画布上时不显示"中心"：相机的中心是视线穿出椭球面的远处（抬头时可能在几千千米外），不是画面中间看到的地方。排不下时的取舍不变，只留第一段时就是视点高度
- 步行（ADR 0086）：视图报告步行中（`roamStatus` 的 `phase` 是 `walking`）时，三段换成"第一视角""眼高 1.6 m""朝向 76°"（原型 `/dev/map-3d`），第三人称是"第三视角""朝向 76°"（ADR 0090，人称取步行状态的 `view`），不显示视点高度、经纬度和角度；读数是 `walking`（人称和朝向）；朝向读就绪视图的 `heading()`（相机的朝向，取整到 0～359），会话的方位按画布中心对着的地面点算，视点在地下时不可靠。排不下时同样先去掉后面的段；地下空间时页面不显示状态栏（ADR 0095），在地下的模型里步行看不到这三段
- 比例尺 `scaleBar`：不超过 80 像素的整齐长度（1、2、5 × 10ⁿ 米，满 1000 米写 km），线段在 32～80 像素之间
- 角度 `visibleAngles`：旋转和 MapLibre 的 bearing 一样是 -179～180（起初换成 0～359 的方位，浏览器验证时逆时针转 2° 显示成"358°"，改了）
- 经纬度的写法跟着坐标定位面板（`location.state.value.format`），用 `formatLngLat`；状态栏自己不切换
- 放不下时（`fitStatusLayout`）先去掉旋转和俯仰，再去掉经纬度，比例尺一直保留。三种排法各在隐藏的量尺里排一份，用 `useElementSize` 量出宽度，和根元素的宽度比较；还量不到时（测试环境没有布局）全部显示。没有用 `flex-wrap` 加 `overflow: hidden` 藏掉后面的段：背景会撑满可用宽度，分隔线也会落单
- 只显示（`pointer-events: none`），不登记为悬浮元素
- 页面的浮层是三列的 grid（资源面板、中间、工具栏；左列是 `minmax(0, auto)`，手机宽度时资源面板可以变窄）。2026-10-28 起（ADR 0095）状态栏在最下一行、横跨左边两列，从左边缘开始、到卡片左边为止，和卡片同一底边；左列仍从上到下，底部留出状态栏的高度（24）加 12，面板最高到状态栏上方。地下空间时不显示状态栏，左列不再留位置。原来状态栏在中间一列、资源面板（或竖条）的右边（ADR 0053 第 5 节）

### 浏览器验证（2026-10-28，ADR 0095）

- 1440 × 900：面板底边 848、状态栏 860～884（隔 12），状态栏左边 16、和底图卡片同一底边；收起成竖条后状态栏位置不变
- 375 × 812：面板底边 760、状态栏 772～796，宽度只放得下比例尺
- 三维步行进入地下空间：没有状态栏和视图控件，左列到底；退出漫游仍在钻地，退出钻地后恢复（第 6 步起没有单独的钻地，退出漫游就恢复，ADR 0097）

### 浏览器验证（2026-10-15）

- 1440 × 900：状态栏从 352（16 + 320 + 16）开始，底边和卡片行对齐；没有 MapLibre 的版权控件
- 鼠标在地图上时经纬度跟着变，移到资源面板上变成"中心"；激活测距时照样更新
- Shift + 方向键旋转、俯仰后显示"旋转 -1° 俯仰 10°"
- 比例尺和级别相符：5.4 级时 100 km、约 62 像素
- 768 宽：展开资源面板时只剩比例尺（可用 128，卡片现在是两个 80 宽的联调按钮），收起后全部显示

## 资源图层面板（ADR 0157）

现状底图左侧的面板，二三维共用。和业务无关的部件在 `shared/map/layer-panel`，各 feature 给出目录节点和行的内容，`pages/current-map/layer-panel/CurrentMapLayerPanel` 拼起来。界面细节见 [current-map-reference.md](../design/current-map-reference.md)"资源图层面板"。

| 文件 | 内容 |
|---|---|
| `LayerPanelShell.tsx` | 外壳：标题和页签、收起后的竖条、上下两段和分隔条（比例由页面持有），插槽 `catalogTools`、`catalogFilter`、`catalog`、`currentTools`、`current`、`floating`；登记为贴左边的悬浮元素 |
| `catalog-tree.ts`、`CatalogTree.tsx` | 目录的节点（`CatalogLeaf`、`CatalogBranch`，键带种类前缀）和树：只有项能选中，Ctrl、Shift 多选，分类单击展开、收起；键盘；行尾一列是项数或勾，悬停时是添加、移除；`catalogCover` 算出选中的项里能添加、能移除的 |
| `catalog-selection.ts` | 目录的多选：选中、锚点、焦点，搜索掉的节点不再算选中 |
| `CurrentLayerGroup.tsx` | 当前图层的一组：手柄、复选框和插槽 `row` 给的内容；单选，键盘，拖动排序用 `useSortableList`（两组各一个实例，不能跨组），整组变淡、标签（二维里的模型组），`headless` 时不显示标题（只有这一组时） |
| `PanelToolbar.tsx`、`PanelMenu.tsx`、`LayerPopover.tsx` | 工具栏（不可用的用 `aria-disabled`，悬停照样有提示）、右键菜单、开在面板右边的浮层（箭头对着选中的行，手机宽度时盖在下段上） |
| `popover-placement.ts`、`panel-split.ts`、`scroll.ts` | 浮层的位置、上下两段的高度、在滚动区里露出一行（纯函数和小工具） |
| `layer-row.module.scss` | 行的公共部分：符号（24 × 22）、名称、紧跟名称的状态、行尾的框（宽 56）、移除、加载中的转圈 |

- 选中、浮层、菜单这些界面状态在 `CurrentMapLayerPanel` 里，不持久化；图层的状态在拥有者里（`useResourceLayers`、`useSceneModels`）。工具栏和菜单按选中项的键（`resource:`、`model:` 前缀）把操作交给对应的拥有者
- 页面给 `reveal` 一个新对象时，面板在当前图层里选中这一行、滚到中间、闪两下（请求状态的明细里点了一行）；`requests` 给出加载超过 0.4 秒的行，资源行在名称后面转圈

## 请求状态（ADR 0158）

```tsx
// 页面 setup：来源从各拥有者推导；条目放在状态栏的 after 插槽里
const requests = useRequestStatus(() => [
  ...resourceRequests(resources.state.value, map.sourceActivity.value),
  ...(map.dimension.value === '3d' ? modelRequests(models) : [])
]);
<MapStatusBar readout={readout} format={format}>
  {{ after: () => [<RequestStatusChip status={requests} selectable={key => key !== 'basemap'} onSelect={reveal} onRetry={retry} />] }}
</MapStatusBar>
```

- 来源 `RequestSource`：瓦片是一个或几个数据源这一轮的请求（上下文的 `sourceActivity`，几个合成一项用 `mergedActivity`），模型只有加载中、就绪、失败。`useRequestStatus` 把它们整理成明细的各项，模型按状态变化记下开始、结束的时间
- 时钟只在有加载、刚结束时每 250 毫秒走一格，只在 `RequestStatusChip` 里读，不带动页面重渲染；`loadingKeys`（加载超过 0.4 秒的项）内容不变时是同一个集合，用它的行不跟着时钟重渲染
- 条目和明细的规则是纯函数：`requestSummary`（加载中、几项失败、已加载完成、不显示）、`requestGroups`、`requestRowText`；常量 `SHOW_DELAY`（0.4 秒）、`DONE_HOLD`（1.5 秒）、`SLOW_AFTER`（5 秒）
- 条目自己拦截鼠标（状态栏不拦截）；明细用 `useLightDismiss`，点外面、Esc 关闭

## 自定义范围（ADR 0121）

上传的文件和画的范围都在 Worker 里整理、分析（`createAreaAnalyzer`），结果对象说明读不了、不能用的原因，不抛错。这些模块只用相对导入和 npm 包，按 `tsconfig.worker.json` 检查。

```ts
using analyzer = createAreaAnalyzer();
const read = await analyzer.read(files, signal);                 // 一个 GeoJSON、一个压缩包，或同一组 Shapefile
const prepared = await analyzer.prepare(polygons, signal);       // 画的范围
const covered = await analyzer.cover(area, regions, '江苏省', signal);
```

**文件**：

| 检查 | 不通过时 |
|---|---|
| 类型：`.geojson`、`.json`、`.zip`，或 Shapefile 的各个文件；一次只能一个范围 | 说明支持的格式；GeoJSON 和压缩包混选、选了多个 .shp 时说明 |
| 大小：合计 50 MB；压缩包先读目录，解压后超过 200 MB 不解压；主线程先按大小拦下，不读进内存 | 说明大小和上限 |
| 结构：JSON 格式（说明大约第几行）、GeoJSON 的 type 和要素结构、坐标的数组形状；.shp 的文件码、文件长度（被截断）、要素类型 | 说明哪个文件、哪里不对 |
| 几何类型：只用面；点、线、空几何忽略并提示；全是点、线时不能用；压缩包里有几个图层时合并面图层 | 说明是点图层、线图层 |
| 坐标系：GeoJSON 要经纬度，旧版 `crs` 成员写了投影坐标系时说明要转换；Shapefile 按 .prj 转换，没有 .prj 时按经纬度读并提示；坐标不在经纬度范围里时分"可能是投影坐标""经纬度颠倒"说明 | 说明坐标系的问题 |

**整理**（`prepareArea`）：去掉相邻的重复点、闭合环、去掉不足 3 个节点的环；节点超过 50 万个不整理；多于 5000 个时按约 1 米起、最多约 100 米的容差逐步简化（县界本身只有约 8400 个节点）；自己和自己求交得到有效的面，合并重叠、拆开交叉的边；面积不足 1 公顷、超过 15 万平方千米时不能用。简化、修正了交叉的边、去掉了环都写进提示。缩略图另有不超过 400 个节点的轮廓。

**覆盖**（`coverRegions`，规则在 `COVER_RULES`）：

| 情况 | 判定 |
|---|---|
| 交集小于 1 公顷，或平均宽度（2 × 面积 ÷ 周长）小于 25 米的细条 | 边界相交，算未覆盖（范围本身平均宽度不到 300 米时不按宽度判断） |
| 行政区在范围外的部分不超过"面积的 0.5%"与"周长 × 25 米"中大的一个 | 全部覆盖（县界简化过，精确的边界和它有出入） |
| 其余有交集的 | 部分覆盖，带范围内的面积和占比 |
| 不在任何行政区里的面积超过 0.1 平方千米且超过范围的 0.5% | 在外面（省外）的面积，不参与计算 |
| 一个行政区也没覆盖 | 不能用：说明不在范围内，或只沿边界略有重叠 |

节点多于 500 个时先把范围裁到行政区的外包框再求交；每个行政区之后让出一次，可以取消。

**实测**（2026-10-31，Node 24，真实县界，带起伏的环）：

| 节点 | 整理 | 求交 | 覆盖的区县 |
|---|---|---|---|
| 2000 | 185 ms | 455 ms | 16 |
| 5 万 | 391 ms | 1.1 s | 38 |
| 20 万 | 1.1 s | 424 ms | 72 |
| 50 万 | 2.3 s | 490 ms | 78 |

简化前 20 万个节点要 16 秒、50 万个要 54 秒（求交的耗时和范围的节点数成正比，单次约 15 微秒 / 节点）；简化后面积变化不到 0.01%，覆盖的区县不变。

## 区划定位（ADR 0036）

```ts
// 页面 setup：在 useDefaultView 之后创建，回到全省时用它回到默认视角；region 分组叠在边界之上、测量之下
const { goToDefaultView } = useDefaultView(map);
const region = useRegionLocate(map, { goToDefaultView });
map.bindStyle({ region: region.deriveGroup });

region.select('320213');   // 梁溪区：加载边界、高亮，视图就绪后定位
region.select(null);       // 回到全省：清掉高亮，回到默认视角
```

- 状态是 `{ selected, boundary }`：`selected` 为 `null` 是全省；`boundary` 是 `none`（全省）、`loading`、`ready`（带边界）或 `failed`（带原因，`retry()` 重新加载）。只有 `ready` 时有高亮，加载中不显示上一个区划的高亮
- 每次选择从 `LatestController`（`@mx/utils`，ADR 0039 第 2 条）取一个信号：换选、回到全省、作用域销毁时中止，晚到的结果（成功或失败）都不写入。边界到位后在选择时开始的相机操作下定位：`fitBounds(范围, { duration: 1100, maxZoom: 14.5, pitch: 0 })`，四边留白由登记的悬浮元素决定（ADR 0029）。视图没就绪时等到就绪（引擎失败后重试成功也照样定位）；有了新的相机操作时不定位，高亮照常
- 选择（和重试）是一次相机操作（ADR 0038、0039）：开始时用 `beginCameraOperation()` 作废之前没完成的定位，边界到位、确认自己的选择没过期后 `operation.run(...)`；等视图、等待返回后再确认都在 `run` 里。之后又有了新的操作（用户拖动缩放、"默认视角"、坐标定位、再选别的区划），边界到位后只高亮、不定位；相机的变化本身（如上一次定位的动画）不算新的操作。页面加载期间选的区划，就绪时初始适配让给它
- 再选当前的区划什么也不做；不认识的代码抛错。从市或区县回到全省时调用页面传入的 `goToDefaultView`，本来就是全省时不调用
- 面板上的点击由 `nextRegionSelection(selected, clicked)` 换成 `select` 的参数（同旧项目）：点别的区划选它；选中市或它的区县时这个市都算选中，再点它回到全省；再点已选中的区县回到所在的市
- 没有注入加载器时用 `sharedRegionBoundaryLoader()`：整个应用共用一个，区划定位和位置点的所在区县用同一份解析结果，市界、县界在应用里只下载、解析一次
- `region` 分组是红色光晕（宽 8、模糊 5、不透明度 0.8）在下、实线（宽 2、不透明度 0.9）在上，沿用旧项目

面板与页面：

```tsx
// 面板放在功能面板的 Tab 里（ADR 0053 第 4 节）；关闭面板不清掉选择
<MapToolbar items={[..., 'region-locate']} actions={{ 'region-locate': () => functions.toggle('region-locate', sides.right.value) }} pressed={...} />
<MapPanelGroup group={functions} labels={PANEL_LABELS}>
  {{ 'region-locate': () => [<RegionLocatePanel region={region} />] }}
</MapPanelGroup>
```

- 格子按宽度排列（`repeat(auto-fill, minmax(64px, 1fr))`）：320 宽的面板里是 4 列，手机宽度变窄时少几列（设计稿 5D.8）
- 设计稿 5D.4 及 2026-10-20 截图反馈：最上面是搜索框（前面是放大镜，没有"搜索"按钮，占位文字"搜索市、区/县"）；下面一行是当前位置"江苏省 › 南京市 › 江宁区"（`regionTrail`），前面几级可以点：点江苏省回到全省，点市回到市，最后一级是 `aria-current`。下面直接列 13 个市（去掉"市"字）与选中市的区县，移除两处文字说明，仅有区县时显示 `--color-divider` 浅灰分隔线。按钮字号 12、高 24、间隔 4、最小宽 52，常规 320 宽面板每行 5 个，窄屏减少列数，4 字名称完整显示；原生按钮加 `aria-pressed`，选中的浅主色底，选中区县时所在的市也是选中，点格子的规则仍是 `nextRegionSelection`
- 输入时下面换成搜索结果（`searchRegions`，内部滚动）：名称在左、所属的市（`parentCityName`）在右，关键字在名称或市名里都标出来；第一条浅底，回车选它，输入法选字时的回车不算；点一条直接选中并清空关键字；没有结果时说明"没有找到"
- 边界加载超过 300ms 才在当前位置这一行的右边显示"正在加载边界…"（`useDelayedFlag`）；失败时显示"边界加载失败"和"重试"
- 标题、关闭和悬浮元素的登记由外壳负责，定位时避开整组面板

当前区划（ADR 0055）：

```tsx
// 页面把它放在浮层网格第一行、横跨三列居中，排在面板前面：重叠时（窄屏）被面板盖住
<RegionScopeBar region={region} />
```

- 选中区划后写出和区划定位面板一样的各级（共用 `RegionTrail`，点哪一级就选哪一级，"江苏省"回到全省），竖线后面是"回到全省"（`select(null)`，图标和基础组的"默认视角"相同，做的是同一件事）；没选时不渲染（2026-10-16 按用户的意见去掉了"区划"两个字）
- 关掉区划定位面板后靠它知道遮罩外是哪里；面板开着时也显示，规则简单
- 手机宽度（设计稿 5D.8）：页面把它放进中间一列，名称过长时省略（"回到全省"保留）；资源面板展开时中间一列没有宽度，页面不渲染它
- 贴着地图上边，用 `useMapOverlay(element, 'top')` 登记：选中区划期间定位的上边留白是 16 + 32 + 16；没选时元素不在文档里，不算

区划目录与边界的加载：

```ts
const loader = createRegionBoundaryLoader();     // 默认用 fetch；测试注入读取函数
const { geometry, bounds } = await loader.load(findRegion('320213'));  // 县界里的要素，Polygon 或 MultiPolygon
```

- 区划目录是江苏的 13 个市、95 个区县，没有"全省"这一项：没有选择就是全省。`Region` 有代码（6 位）、名称、级别（`city` / `district`）和所在的市
- 搜索：路径（如"南京市 / 玄武区"）包含关键字的区划，按目录顺序（每个市后面跟着它的区县），最多 20 条，去掉首尾空白。旧项目把完全相同的排在前面，是因为"江苏省"一项包含所有关键字；目录里没有这一项，完全相同的本来就排在最前，所以只保留"包含"
- 边界从 5B.2 的市界、县界文件里取，和边界图层是同一个地址（命中 HTTP 缓存）。边界数据的代码换成 6 位再查找：市界的代码是 12 位、取前 6 位，县界去掉 `156` 前缀。同一代码有多个要素时合并（连云港的市界是两块），只有一个多边形时是 `Polygon`
- 每个文件只下载、解析一次，同时发起的加载共用一次；失败不缓存，下次重新下载。下载由各次加载共用，不随某一次选择取消，过期的结果由拥有者丢弃
- 读取的 JSON 用 zod 检查结构（代码、几何类型），坐标只确认是数组：坐标由转换脚本生成并检查过，逐个检查 1.4 MB 的市界在 Node 里约 40 ms（`JSON.parse` 约 13 ms）
- 外包范围从外环算出，没有为它引入 turf

### 浏览器验证（2026-10-10）

| 场景 | 结果 |
|---|---|
| 点"区划定位" | 工具栏按钮显示为按下，面板出现在工具栏下面 |
| 选南京 | 红色光晕加实线高亮南京市界，定位到面板左侧的可视区域，面板不挡住区划 |
| 选无锡、梁溪区 | 高亮的是梁溪区（天地图注记的"梁溪区"在红框里）；旧项目这里高亮的是锡山区。县界简化过，线条比较粗略 |
| 选连云港 | 两个要素一起高亮，定位范围包含海上那一块 |
| 再点连云港 | 回到全省：高亮消失，回到默认视角。面板开着时默认视角也避开面板，703 宽的画布里江苏显示得比较小（ADR 0029 的设计如此） |
| 搜索"鼓楼"、点"徐州市 / 鼓楼区" | 列出南京、徐州的鼓楼区；选中后徐州的按钮也显示为选中，下面列出徐州的区县 |
| 第一次按市定位的耗时 | 新建加载器取市界（1.4 MB，命中缓存）：下载约 15 ms，`JSON.parse` 约 8 ms，zod 检查与建索引约 3 ms；之后用缓存。应用里市界、县界各只请求一次 |
| 375 宽 | 面板占满控件列（左右各留 16），没有横向滚动；起初面板的内边距加在 360 的宽度外面，左边超出 8 像素，改为 `box-sizing: border-box` |
| 控制台 | 没有错误 |
| 生产构建 | 三份边界数据仍是带哈希的独立文件；页面分块 105 KB（5B.2 时 59 KB，增加的主要是测量用的 geographiclib 和区划目录） |

### 区划目录的数据

`region/data/jiangsu-regions.json` 由旧项目（yzt `master-demo` 836f03b）的 `src/components/CommonMap/boundary/regionLabelPoints.ts` 转换而来，只保留代码、名称和所在的市，顺序沿用原表。

- 没有用旧面板的 `src/views/space-monitoring-query/region.js`：其中 8 个区县的代码是旧的或错位的（无锡的锡山、惠山、滨湖、梁溪、新吴，南通的崇川、海门、如东、海安，淮安的涟水），比如梁溪区写成 320205（锡山区的代码）。旧项目找边界时先按代码匹配，所以选梁溪区高亮的是锡山区
- 测试检查目录与边界数据逐条对应（代码、名称都相同，两边都不多不少）。区划调整时同时更新边界数据和目录，测试会指出对不上的地方

## 区划裁剪（ADR 0051）

```ts
// 页面 setup：选中市或区县、边界加载好后，区划外盖上遮罩
map.bindStyle({ 'region-clip': () => regionClipGroup(readyBoundary(region.state.value)) });
```

- 范围是区划定位的拥有者生效的边界：`readyBoundary(state)` 在全省、从全省开始加载、加载失败时为 `null`；从一个区划换到另一个时，新边界加载期间仍是上一个（加载中的状态带着 `previous`），新边界到了才一起换。区划轮廓、遮罩和点选的查询范围都用它，显示和查询因此一致。原来加载中一律为 `null`：换选时先撤掉遮罩、露出全部区划，一两帧后再换上新的，肉眼能看出闪一下（2026-10-16 用户发现，先写测试复现再修）。页面决定要不要裁剪，只定位、不裁剪的页面不绑定这个分组
- `region-clip` 分组在 `selection` 之上、`basemap-labels` 之下：区划外的资源和选中的高亮被盖住，注记、边界、区划轮廓和测量在遮罩上面。外观沿用旧项目（`#F3F5F8`，不透明），关掉抗锯齿，避免大面积的面在瓦片接缝处出现细线
- 遮罩的几何 `clipMask` 按环的嵌套深度构造（奇偶规则）：区划的环不分外环和洞放在一起，被几个环包含，深度就是几加 1，整个世界是 0；深度为偶数的环是遮罩的外环，直接在它里面的环是它的洞。所以区划的洞被盖住，洞里属于区划的小岛不被盖住。方向按深度重新定（外环逆时针、洞顺时针），不依赖数据；判断包含时跳过落在另一个环边界上的顶点
- 前提是环之间不交叉、各部分不重叠。测试检查本地边界数据：同一个区划的每两个环，要么互不包含，要么一个的全部顶点都在另一个里面。目前只有吴中区有一个洞
- 区划范围的几何判断（`region-scope.ts`，给点选用）：`scopeContains` 判断点在不在范围里（边界上的算）；`clipToScope` 把识别范围和区划求交（只相接时没有交集，用 `@turf/intersect`）；`intersectsScope` 判断要素的几何和范围是否相交（相接也算，用 `@turf/boolean-intersects`）
- `clipToScope` 先按识别范围的外包矩形裁掉区划远处的边（`@turf/bbox-clip`，Sutherland–Hodgman），再精确求交：南京市界约 1 万个坐标，直接求交约 140 ms，先裁剪后 1～20 ms。矩形边上留下的退化边由精确求交处理，在全部市、区县上随机取 400 个框（一半旋转过）比较，结果都和直接求交相同。整个在矩形外的部分裁剪后是空数组，要去掉，否则求交报错（多部分的南京、连云港）
- `intersectsScope` 先看要素的一个顶点在不在范围里，在就是相交，跨过边界的才逐段求交：框选时大多数要素在范围里面
- 点选的拥有者从页面拿到范围：`useFeaturePick(map, resources, { scope: () => readyBoundary(region.state.value)?.geometry ?? null })`，识别和发给后端的几何见 ADR 0051 第 3、4 节

### 浏览器验证（2026-10-15）

| 场景 | 结果 |
|---|---|
| 选南京 | 南京市外变成灰色，地名注记、省界和红色轮廓在遮罩上面 |
| 选吴中区，11 级，画布里每隔 50 像素取一点（184 个） | 每一点上遮罩图层有没有要素，和"按县界不在吴中区里"逐点一致；吴中区的洞里也被盖住 |
| 生产构建 | 页面分块增加 1.2 KB（gzip 0.5 KB）；求交的库在点选接入范围后才进入页面 |

### 耗时与体积（2026-10-15，5C.7b）

在 Node 里用仓库的市界，按 1158 × 862 视口的整屏框测（取 5 次平均）：

| 场景 | 求交 | 发给后端的几何 |
|---|---|---|
| 南京东界 14 级 | 1.4 ms，12 个坐标 | 0.1 ms，12 个坐标 |
| 南京东界 12 级 | 3.1 ms，88 个坐标 | 0.6 ms，88 个坐标 |
| 南京东界 11 级 | 6.7 ms，291 个坐标 | 1.1 ms，简化到 100 个坐标 |
| 南京东界 10 级 | 22.5 ms，877 个坐标 | 1.7 ms，范围太复杂（2 个像素时还有 172 个坐标） |
| 南京北界 12 级 | 19.8 ms，967 个坐标 | 2.3 ms，简化到 111 个坐标 |
| 常州 12 级 | 8.0 ms，421 个坐标 | 0.5 ms，简化到 73 个坐标 |

- 14 级整屏框里 1000 个约 30 米见方的面判断和求交范围是否相交：6.1 ms
- 生产构建：页面分块从 358.9 KB 增加到 424.5 KB（gzip 111.3 KB → 133.3 KB），主要是求交用的 `polyclip-ts`（压缩后约 42 KB）和它依赖的 `bignumber.js`
- 5E.2 实测（2026-10-16）：把求交换成空实现，地图页分块少 42 KB（gzip 15 KB），登录到画面稳定 Fast 4G 只快 2 ms、Slow 4G 快 138 ms；登录页又会预加载地图页分块，所以不按需加载，区划范围仍是同步的（ADR 0061 第 4 节）

## 坐标定位与位置点（ADR 0037）

```ts
// 页面 setup：创建拥有者，登记拾取工具
const location = useLocationPoint(map);
map.registerTools(location.tools);

location.locate([118.7978, 32.0486]);   // 输入后定位：放下位置点，飞过去（至少 14 级，避开悬浮元素）
location.place(lngLat, 'drag');         // 拖动：移动位置点，不移动地图
location.remove();                      // 删除位置点，连同位置信息
```

- 状态是 `{ point, infoOpen, format }`：`point` 是经纬度和来源（`input` / `pick` / `drag`），同一时间最多一个；`format` 是面板输入框的格式（默认度分秒），放在拥有者里，关掉面板再打开时还记得。值没变时不替换状态
- `locate` 先放下位置点，再用 `runCameraOperation` 飞过去（ADR 0038、0039）：作废之前没完成的定位，视图还没就绪时等到就绪再飞；飞行 1000 ms，缩放取执行时的缩放和 14 的较大者
- 拾取工具 `LOCATION_PICK_TOOL`（`location-pick`）：临时任务、十字光标。移动时记下鼠标位置（`pickPointer`，给提示定位），离开画布或退出时清掉；左键单击一次（双击里的第二次单击、右键不算）放下位置点、打开位置信息并 `releaseTool` 退出，地图不移动；拾取不到时不放点、不退出；Esc 不处理，由工具模型退回常驻模式
- 所在区县（`region`）：位置点的经纬度变化时用县界判断（`RegionBoundaryLoader.districtCodeAt`），结果是 `loading`、`ready`（区县，或 `null` 表示不在江苏省内）、`failed`；只开关位置信息时不重新判断，拖动时只采用最后一次判断的结果（每次判断从 `LatestController` 取一个信号，返回后检查是否中止），作用域销毁后晚到的结果不写入。没有注入时用 `sharedRegionBoundaryLoader()`，和区划定位共用县界
- `districtCodeAt`：先用每个区县的外包范围排除，再用 `@turf/boolean-point-in-polygon` 按多边形判断（外包范围会互相重叠，例如浦口区的点也在江宁区的外包范围里）。县界简化过，边界附近可能判错

### 图钉与位置信息

```tsx
// 和画布放在同一个定位参照里
<MapCanvas />
<LocationOverlay location={location} />
```

- 图钉的尖端对准坐标，下方显示"坐标定位点"，随相机和画布尺寸（`projectionRevision`）用 `project` 重新投影，视图没就绪时不显示（`view` 为 `null`）。当前工具不是"移动"时图钉不响应鼠标（`pointer-events: none`），单击落到地图上
- 按下手势 `createPressGesture`：按下后 0.5 秒内松开是单击（开关位置信息）；按住满 0.5 秒（图钉周围的一圈进度用 CSS 动画走满）进入拖动，拖动时图钉抬起，每次移动把视口坐标换成画布上的点，用 `pick` 取经纬度后 `place(…, 'drag')`；松开放下；还没到时间就移动超过 4 像素时取消。拖动中按 Esc 或指针被浏览器取消时回到拖动开始时的位置点（连同来源）。按下时 `setPointerCapture`，拖出图钉也能收到移动和松开；屏蔽浏览器的长按菜单
- 图钉是实心的 `location-pin` 图标（尖端在图标高度的 22.5 / 24 处），拖动时坐标处留一个影子
- 位置信息 `placeLocationInfo(图钉, 卡片, 画布, padding)`（ADR 0055）：放在图钉上方（留出图钉的 40），超出可视区域的上边时翻到下方（留出名称的 28）；左右限制在可视区域里，可视区域比它窄时靠左；可视区域是画布去掉登记的悬浮元素，`padding` 取上下文的 `overlayPadding()`，每次渲染时现量（面板开关后，下一次重新投影时跟上）。小三角对着图钉，离卡片两边至少 18。尺寸用 VueUse 的 `useElementSize` 量（`border-box`）
- 内容：标题用 `MxTitle`，右边是关闭；小数、度分秒两行（`formatLngLat`），各带复制按钮，复制后变成绿色的勾 1.5 秒（无障碍名称"已复制…坐标"）；所在区划（`describeLocationRegion`：区县路径、"不在江苏省内"、"正在判断…"、"判断失败"）；"删除位置点"
- 复制用 VueUse 的 `useClipboard({ legacy: true })`：剪贴板接口要求 https 或 localhost，内网的 http 部署退回 `execCommand('copy')`
- 拾取工具激活、鼠标在画布上时，鼠标旁显示"单击地图拾取点位"和"Esc 取消"（`PointerHint`）

### 面板与页面

```tsx
// 区划定位和坐标定位是功能面板的两个 Tab，可以同时打开，同一时间显示一个（ADR 0053 第 4 节）
<MapPanelGroup group={functions} labels={PANEL_LABELS}>
  {{ 'coordinate-locate': ({ active }: PanelSlotProps) => [<CoordinateLocatePanel location={location} active={active} />] }}
</MapPanelGroup>
```

- 面板的格式切换（度分秒 / 小数）写进拥有者的 `format`；切换时识别得了的输入框换成新写法，识别不了的保留原文。打开面板时、位置点变化时（定位、拾取、拖动）输入框显示位置点
- 输入框下方一行：输入时显示识别结果（`= 118°46′40.00″`，已经是规范写法时不显示），认不出来时显示原因；空白的输入框在点"定位"之前不提示，定位成功后重新开始；纬度超出范围而经度不超过 90 时提示"经纬度可能填反了"
- 输入的逻辑在 `useCoordinateInput`：每个输入框是"显示的文字"和"精确数值"两部分。输入时数值按文字重新识别；离开输入框、切换格式时只把文字换成规范写法，数值不变（度分秒的秒只显示两位小数，约 0.3 米，不能反过来影响定位）；位置点变化时两部分都取位置点的值
- 离开输入框时规范成标准写法；经度框里是一对坐标时（`splitCoordinatePair`）分到两个框，输入时下方提示"识别为一对坐标"
- 回车和"定位"走同一个 `submit`：先拆分一对坐标、规范写法，两个数值都有时按精确数值定位；输入法选字时的回车不算
- 写法切换、经度、纬度、底部按钮都占满宽度（写法切换用 Element 变体 `radio-group-block`），之间的间距都是 24；说明写在输入框下面的间距里（绝对定位），有没有说明各块的距离都不变（2026-10-16 用户要求统一间距）
- 设计稿 5D.4：写法切换在第一行；经度、纬度的名称在输入框左边，说明在输入框下面（灰色是识别结果，红色是错误；"可能填反"也是红色，纬度超出范围本身就是错误）。Element 的输入框只有表单校验时才有错误边框，这里没有用表单，所以只靠红字
- "拾取"开关拾取工具，拾取中显示为按下（`plain` 的主色按钮，浅主色底），文字是"拾取中"，无障碍名称保持"拾取"；面板隐藏（`active` 为 false：切到别的 Tab、窄屏时让给另一边）和卸载时都取消拾取，输入框的文字保留。标题、关闭和登记由外壳负责
- 现状底图页：`location` 登记拾取工具，`LocationOverlay` 和画布放在一起；工具栏的"清除"调用 `measure.clear()` 和 `location.remove()`

### 浏览器验证（2026-10-10）

| 场景 | 结果 |
|---|---|
| 用键盘在经度框输入 `1184752.3` | 下方显示 `= 118°47′52.30″` |
| 纬度输入 `320255.1` 后回车 | 两个框规范成 `118°47′52.30″`、`32°02′55.10″`；地图飞到玄武区、14 级，图钉在面板左侧可视区域的中央（x ≈ (16 + 371) / 2），下面是"坐标定位点" |
| 单击图钉 | 位置信息：`118.797861, 32.048639`、`118°47′52.30″E, 32°02′55.10″N`、"南京市 / 玄武区"；点复制后系统剪贴板里是这段文字，按钮上的"已复制"约 1.5 秒后消失 |
| 拾取 | 十字光标，鼠标旁有提示；单击后图钉放在单击的地方、位置信息打开（"南京市 / 秦淮区"）、输入框更新、拾取按钮不再按下，地图没有移动 |
| 图钉上的按下（用 `PointerEvent` 模拟，拖动前临时替换了 `setPointerCapture`：模拟的指针不是"活动的指针"） | 按 0.3 秒松开：开关位置信息；按下后马上移动 30 像素：不拖动，位置不变；按住 0.6 秒后拖动：图钉和输入框实时跟着走，松开后留在新位置；拖动中按 Esc：回到这次拖动开始时的位置 |
| 测距时 | 图钉的 `pointer-events` 是 `none`，退出测距后恢复 |
| "清除" | 图钉消失，输入框保留，再点"定位"可以放回 |
| `flyTo` 之后点"默认视角" | 江苏照常居中，`flyTo` 没有把留白留在地图上 |
| 375 宽 | 面板在控件列里（59～359），没有横向滚动 |
| 控制台 | 没有错误 |

没有验证：内网 http 部署下的复制（开发服务器是 localhost，属于安全上下文，走的是剪贴板接口）。

### 坐标的识别与格式

```ts
parseCoordinate('1184640.5', 'lng');            // { ok: true, value: 118.7779… }
parseCoordinate('118 60', 'lng');               // { ok: false, reason: 'minutes', message: '分要小于 60' }
formatCoordinate(118.777778, 'dms');            // '118°46′40.00″'（输入框里的写法）
formatLngLat([118.7778, 32.0565], 'decimal');   // '118.777800, 32.056500'（复制）
splitCoordinatePair('118°46′40″E 32°03′23″N');  // 粘贴的一对坐标分到两个框
```

度分秒和小数两种模式按同一套规则识别，格式只决定显示：

| 写法 | 例子 | 识别为 |
|---|---|---|
| 标准度分秒，半角 `'"`、两个单引号、汉字单位、全角数字和符号 | `118°46′40.5″`、`118度46分40.5秒` | 118°46′40.50″ |
| 带单位的按单位放进度、分、秒 | `118°40″` | 118°00′40.00″ |
| 空格、逗号分隔的数字，依次是度、分、秒 | `118 46 40.5`、`118,46` | 118°46′40.50″、118°46′00.00″ |
| 连写的数字：经度的度 3 位（前 3 位超过 180 时 2 位），纬度的度 2 位（前 2 位超过 90 时 1 位），后面是 2 位分、其余是秒 | `1184640.5`、`320323`、`984640` | 118°46′40.50″、32°03′23.00″、98°46′40.00″ |
| 连写但不够"度 + 2 位分"时当作度 | `118.7778`、`1184` | 118.7778°；1184° 超出范围 |
| 方向写在开头或末尾，大小写都认；负号 | `118.5W`、`北纬32.5`、`-118.5` | 负数是西经、南纬 |

- 报错的原因分开（`reason`），面板据此显示：空白、认不出来（带这个轴的写法例子）、方向和输入框对不上、只有最后一段可以带小数、分或秒不小于 60、超出范围
- `looksSwapped`：纬度超出范围而经度不超过 90，多半是填反了
- 输入框里的写法：度分秒补齐两位，秒保留两位小数（约 0.3 米），不带方向，负数带负号；小数 6 位（约 0.1 米）。按百分之一秒取整后再拆，进位不会出现 60″；接近 0 的负数不显示负号
- 复制的格式：小数 `118.777800, 32.056500`（经度在前），度分秒 `118°46′40.00″E, 32°03′23.40″N`（规范的 `′″`，带方向）
- 一次粘贴的一对坐标：按逗号、分号、换行拆，或按 `…E …N`、`E… N…` 这样的方向拆，或两个空格分隔的小数；两段都要"看起来完整"（带小数点、单位或方向），`118, 46` 这类只有整数的当作度、分

## 功能 Tab 面板、独立详情与底图（ADR 0070）

```tsx
// 页面 setup：参数限定可用功能，显示顺序按入口调用更新
const functions = usePanelGroup(['boundaries', 'legend', 'region-locate', 'coordinate-locate'] as const);
functions.toggle('region-locate', sides.right.value); // 入口的点击：第二个参数是点击时整组是否显示
functions.show('boundaries');        // 打开、前移并切到它
functions.select('region-locate');   // 点击已有标签只切换，不改顺序
functions.close('boundaries');       // 关掉当前的时切到最近显示过的另一个
functions.closeAll();                // 清空整组；外壳还会逐项发出 close，页面处理连带操作

// 窄屏时左右只显示一边：右边的入口、展开资源面板时告诉它操作了哪一边
const sides = useSideExclusion({ leftExpanded: () => !collapsed.value, rightOpen: () => functions.state.value.open.length > 0 });
sides.activate('right');

// 外壳：每个功能一个插槽，插槽拿到 active
<MapPanelGroup group={functions} labels={PANEL_LABELS} visible={sides.right.value} onClose={id => ...}>
  {{ 'coordinate-locate': ({ active }: PanelSlotProps) => [<CoordinateLocatePanel location={location} active={active} />] }}
</MapPanelGroup>
```

- 状态是 `{ open, current, recent }`：`open` 是显示顺序，入口调用 `showPanel` 时对应标签移到最前；标签调用 `selectPanel` 时只切换、不重排。`recent` 记录最近显示顺序，关闭当前时切到最近显示过的另一个。规则放在纯函数里，不在这组里的功能直接抛错，没有改变时不替换状态
- `PanelGroup` 的操作写成方法签名，具体 Id 的面板组可以交给只认 `string` 的外壳
- 入口的点击按实际的显示决定（ADR 0053 第 4 节"正在显示时关闭它"）：没打开、打开了但没在显示、整组被隐藏（窄屏时让给了左边）时打开并切到它，正在显示时才关闭。页面在调用 `activate('right')` 之前取下右边是否显示，交给 `toggle` 的第二个参数；入口显示为按下也要右边在显示。原来只看当前的 Tab：窄屏时右边让出去以后再点入口，面板被关掉、输入丢失，要再点一次才打开（2026-10-16 评审发现，页面测试先复现再修）
- 外壳只渲染已打开的功能：打开期间内容一直挂载，切走时用 `display: none` 隐藏（输入、滚动、展开状态都在），关闭时卸载。插槽拿到 `active`（整组在显示、并且是当前的 Tab），内容据此结束临时的交互：坐标定位退出拾取，图例不渲染条目（编辑器卸载、丢弃取色预览、收起弹出层），条目的展开、搜索词和编辑目标留在图例里，切回时照旧；图例内部按 ADR 0074 分为浏览和编辑视图，返回浏览时恢复滚动位置，不改外壳滚动规则
- 标题与标签区按打开数量切换（ADR 0071～0073 及后续界面反馈）：单功能用功能名称作面板标题、隐藏标签区；多个功能用「地图工具」标题、显示标签区。两种布局都直接用 `MxTitle` 的面板级标题，数量变化不重新挂载仍打开的内容。标签每行两项，三至四项两行，名称与关闭按钮都完整展示，极窄时名称换行。标签沿用资源详情区块副标题的 14 / 600、`--color-text-title`，前置 4 × 14 主色竖条、间距 8，最小行高 28；选中使用整块浅蓝底和内描边，悬浮保持，不改变文字样式。标题、标签固定在内容滚动区外，不再横向滚动；原 `revealScrollLeft` 已移除。标题右侧使用与资源详情相同的箭头和关闭图标；单功能的关闭图标无障碍名称标明该功能，多功能标明「关闭全部功能」，标签旁小叉只关闭单项，不再添加重复 Tooltip
- Tab 上的关闭按钮先关闭该功能，再发出 `close`；统一关闭只清空四个功能标签，不清查询结果、底图选择或边界设置。`useSideExclusion` 的 `rightOpen` 同时考虑功能组、底图和独立详情
- 用户的单击、框选开始识别时，`onIdentifyStart` 只打开并展开独立 `FeatureDetailWindow`，功能当前标签不变；详情关闭调用点选拥有者的 `close()`，拥有者回到空闲时详情窗口随之关闭
- `MapPanelGroup` 的 `collapsed` 隐藏标签与内容、只保留 48 高标题行，向内容插槽传 `active: false`；`collapsible` 显示收起 / 展开箭头按钮，也可从工具栏恢复功能。详情外壳同样用 `MxPanel`，收起不卸载内容，分别登记定位避让
- 功能和详情的主标题栏采用 `--color-neutral-bg-light` 浅灰背景，功能标题背景铺满外壳，文字仍与内容对齐。多个功能时标签区上下各留 8，底部用 `--color-divider` 的 1 像素浅灰虚线区分内容；单功能与收起状态不显示标签分隔线
- `usePanelStack` 记录手动收起和最近操作，`panelStackLayout` 推导显示：两块内容同时展开时功能上限为 40%；可用高度低于 500 时仅最近操作内容展开，另一块保留 48 高标题。只有一块展开时使用剩余高度，窗口间隔 12；`panelStackHeight` 按底图浮层真实顶部预留空间，外层列尺寸不随内容变化
- 内容区在外壳可滚动的区域里，上面留出 `--space-sm`（8 像素），与标题或标签分隔线保持间距；这也避免裁掉 Element 单选按钮的 `outline` 边框与键盘焦点框
- `MapPanelGroup` 支持可选的 `<功能 ID>-footer` 插槽，参数仍为 `PanelSlotProps`，返回空数组时不占底栏空间；仅渲染当前且正在显示的功能底栏，切走、收起、隐藏或页面停用时卸载，确认弹层随之关闭。内容交给 `MxPanel.footer`，与滚动内容同级，位置不随滚动变化。现状底图仅在有符号覆盖时通过 `legend-footer` 提供 `ResourceLegendReset`，沿用原有恢复全部符号的确认操作
- 内容区不随外壳压缩（`flex: none`）。原来是 `min-height: 0`：两组面板都打开、外壳被压矮时，内容区缩到可见的高度，子元素溢出到它外面；纵向 flex 的滚动区域把下内边距算在内容区的下边，滚到底时内容贴着底边（2026-10-16 用户在区划定位、资源详情上发现，浏览器测试 `MapPanelGroup.browser.test.tsx` 先复现再修）
- 外壳代表整组登记为贴右边的悬浮元素；隐藏（没有打开的功能、窄屏时让给左边）时尺寸为 0，不算进定位的留白。原来区划定位、坐标定位、点选、图例各自的登记去掉了
- 窄屏用全应用的断点（`@mx/ui` 的 `COMPACT_MEDIA_QUERY`，1200）：两边都有东西要显示时只显示最后操作的一边；`visibleSides` 只推导显示，不改资源面板的收起状态和右边已打开的功能，变宽后两边按各自的状态显示

## 地图状态的提示（ADR 0030）

```tsx
// 放在地图区域里，父元素要能作为定位参照（position: relative）
<div class={styles.mapArea}>
  <MapCanvas />
  <MapStatusNotice />
</div>
```

| 视图状态 | 显示 | 说明 |
|---|---|---|
| `initializing` | 加载中 | 用 `useDelayedFlag` 延迟出现，很快加载完就不显示；不拦截地图上的操作 |
| `failed`，引擎失败，不支持 WebGL2 | "地图无法显示"，说明浏览器和硬件加速的要求，"重试" | 原因由适配器用 `instanceof GPUInitializationError` 判断 |
| `failed`，引擎失败，其他原因 | 中间的卡片："地图无法显示"，可以重试，技术细节用小字放在浅灰底里 | 处于 `failed` 却没有原因时也按这一种处理 |
| `failed`，样式失败 | 上方的警告条："地图样式加载失败"，说明改动图层后会自动重新加载，技术细节用小字 | 不提供重试：样式出现新版本时自动恢复 |
| 其他（`idle`、`ready`、`paused`、`disposed`） | 不显示 | — |
| 三维因为上次崩溃降了档（ADR 0155） | 上方的警告条："三维画质已自动降低"和原因，"恢复原来的画质""知道了" | 只在三维里、样式没失败时显示；状态由 app 经 `SCENE_TIER_NOTICE` 提供，没有时不显示；文字见 [config/scene-tier.md](../config/scene-tier.md)"自动降档" |

- "重试"调用 `useMap().retry()`，由画布组件在同一个容器里重新创建视图，页面不用管理画布的 `key`
- 文案集中在 `describeMapStatus`，测试也在它上面；组件只测"点重试会重新创建地图"这一个关键交互
- 技术细节是 MapLibre 的原始信息（如 `layers[3].paint.line-width: number expected, string found`），给开发和运维看，普通用户看前面的说明即可

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `useDefaultView.test.ts` | 初始适配在进入页面时的操作下 `run`、不开始新的操作，和它的参数；回到默认视角是一次相机操作和它的参数；画布已经创建视图或不在作用域里时抛错。第一次就绪、失败重试后补做、让给用户的操作、页面卸载时放弃由 `run` 负责，见 map-vue 的 `context.test.ts` 和现状底图页的测试 | Node |
| `jiangsu.test.ts` | 江苏的范围包含省界数据，四边多出的不超过 0.05° | Node |
| `backend-request.test.ts` | 三种瓦片地址带 token；天地图、其他域名、站内静态文件、前缀相近的路径不带；每次请求读取当前 token；后端瓦片的 401 交给 `onUnauthorized` 并带上发出时的 token；没带 token 的瓦片、第三方地址、其他状态码只打印。Worker 里的请求真正带上请求头、401 回到登录页见冒烟 `data-query.spec.ts` | jsdom |
| `pages/current-map/CurrentMapPage.test.tsx` | 页面绑定的分组与叠放（底图、注记、省界，区划高亮在边界之上，测量叠在最上面）；区划定位：工具栏开关面板、选中后高亮并定位、用关闭按钮或工具栏关面板都不清选择、再点回到全省和默认视角（市界用替换的 fetch 提供）；坐标定位：区划定位和坐标定位是功能面板的两个 Tab（切走时隐藏、取消拾取、输入保留，再点正在显示的入口关闭）、窄屏时右边让出去以后再点坐标定位、图例是重新显示（输入保留，让出去时入口不显示为按下）、资源详情切走时保留、再单击时切回、关闭时清除选择（ADR 0053）、输入后定位与位置信息（两种格式、所在区划）、拾取与提示、长按拖动与 Esc（假定时器）、关闭面板取消拾取、图钉随相机移动、单击开关位置信息（右键不算）、画布重建时先隐藏、拖动时视口坐标换成画布坐标、测量时图钉不响应、"清除"；状态栏：比例尺、"中心"、鼠标的位置在下一帧写入、写法跟着坐标定位面板、没有版权控件；把缩放范围交给画布；第一次就绪时定位、画布重建后不再定位；"默认视角"按钮；失败重试后补做；测量的完整交互：提示跟随鼠标和状态、画的过程中含鼠标所在点的长度、末点的总长、标签随相机移动、× 和"清除"、换成测面，结果标签的摆放（总长在旁边、总面积居中），画布重建时标签先隐藏、就绪后重新显示；当前区划：没选时不显示，选中后写出区划，"回到全省"清除；区划定位与其他相机操作的先后（ADR 0038）：加载期间点"默认视角"（相机没变）、上一次定位的动画中选中区县、地图加载期间选中区划、加载期间拖动或坐标定位（这几个用例重新导入页面，区划边界从没有缓存开始，边界文件的请求由用例放行）（用假地图，鼠标事件经过真实的适配器） | jsdom |
| `map-status.test.ts` | 各状态的显示内容、引擎失败（不支持 WebGL2、其他错误）、三维模块加载失败、样式失败、没有原因、不是 Error 的原因 | Node |
| `MapStatusNotice.test.tsx` | 引擎失败时显示原因和"重试"，点击后重新创建地图，重试过程不抛错 | jsdom |
| `basemap/BasemapPanel.test.tsx` | 默认只有缩略图；点一张选中并告诉使用方；入口跟着当前底图、无底图没有，点开有标注和透明度、再点收起；标注开关交给拥有者；缩略图叠着注记和底图、无底图没有图片；滑块按百分比显示、拖动时交给拥有者 0～1 的值；关闭天地图时是"静态"和"无底图"，标注默认关；静态底图的缩略图只有一张图 | jsdom |
| `basemap/BasemapCard.test.tsx` | 卡片的简称和全称；选了底图、单击外部、Esc、再点卡片关闭，焦点按规则回到卡片；入口和开关不关闭；不能显示时不算按下 | jsdom |
| `popover/useLightDismiss.test.ts` | 单击外部关闭且照常传给被点的元素；拖动、从里面拖出去不关闭；按键触发也算；Esc 不再往下传；没显示时和作用域结束后不管 | jsdom |
| `popover/MapOptionsPopover.browser.test.tsx` | 真实布局：内容变高后重新定位、不超出视口，上方的面板拿到新的顶部 | Chromium |
| `card/MapCard.test.tsx` | 图在上、字在下（图标和铺满的图都一样）、点击通知、按下、只写简称时的无障碍名称 | jsdom |
| `basemap/useBasemap.test.ts` | 默认读取配置；两种配置下的初始状态；切换后推导出所选底图和注记；透明度作用于当前底图、每种底图各自记住；标注全局一个、切换时沿用，切换标注不重新推导底图；相同的值不触发重新推导；不合法的调用抛错且状态不变 | Node |
| `boundary/boundary-style.test.ts` | 级别与初始状态；数据源是三份文件的地址；三级的叠放、线宽、虚线；透明度乘在基础值上；关闭的级别不在样式里；ID 前缀与校验；改透明度只产生 `setPaintProperty`；开关一级只增删这一级；面板的线型示意（同色、同不透明度和虚线，线宽取中间一档） | Node |
| `panel-group/panel-group.test.ts` | 打开的功能按固定顺序、切换不改已打开的、关掉当前的切到最近显示过的、入口的三种点击、整组被隐藏时入口不关闭；Tab 区的滚动位置；面板组不替换没变的状态、不认识的功能抛错；窄屏时左右只显示一边 | Node |
| `panel-group/useSideExclusion.test.ts` | 窄屏时操作哪边显示哪边，变宽后两边都显示 | jsdom |
| `panel-group/MapPanelGroup.browser.test.tsx` | 真实布局：内容滚到底时仍有外壳的 16 内边距；320 与 215 宽时四标签分两行完整可见，文字使用区块副标题规格，内容滚动不隐藏标签；单项与全部关闭；收起为 48 高标题行，展开恢复标签与内容 | Chromium 无界面版 |
| `panel-group/MapPanelGroup.test.tsx` | 没有打开时整组隐藏；Tab 的顺序与当前；切走的内容隐藏不卸载、输入保留、`active` 为 false；关闭按钮关掉、卸载、通知页面、切到最近的；让给另一边时整组隐藏、功能保留 | jsdom |
| `toolbar/MapToolbar.test.tsx` | 文字每行两个字；按分组显示按钮和分隔线；只显示图标时不渲染文字；工具按钮跟随当前工具、点击时激活；点击已激活的工具时退出；动作按钮调用回调、没有回调时不可用；按下的动作和当前工具样式不同 | jsdom |
| `view-controls/zoom.test.ts` | 层级向下取整与浮点误差；目标级别 ±1 与截断、到头不能再缩放；累计的起点；按钮缩放每次 ±1、连续点击累计、被作废后重新开始、到头时不可用、被作废后恢复可用 | Node |
| `view-controls/compass.test.ts` | 提示的写法（正北、转过、取整、358° 写成 -2°、只俯仰时不写）；图标的角度；点击只交出旋转和俯仰 0、正北时照常执行 | Node |
| `view-controls/MapViewControls.test.tsx` | 层级与完整的提示；最大、最小级别时按钮不可用；指北针的位置、提示和图标的旋转；默认视角调用回调；不给当前视图时没有 2D/3D；给出当前视图时两格可用、只有点另一格才通知切换；不显示默认视角时连同分隔线去掉 | jsdom |
| `status-bar/status-bar.test.ts` | 比例尺的整齐长度与线段长度、各级别都在 32～80 像素、距离不是正数时为 null；长度的单位；角度取整、为 0 时不显示、旋转在 -179～180；放不下时的取舍顺序、量不到宽度时全部显示 | Node |
| `status-bar/useMapReadout.test.ts` | 视图不在就绪时没有比例尺和经纬度；比例尺的取样点和距离；鼠标下的点与画布中心；随投影修订号重新计算；拾取不到时为 null（用假的上下文） | Node |
| `status-bar/MapStatusBar.test.tsx` | 比例尺和经纬度、按写法显示、"中心"、角度不为 0 时才显示、没有读数时不显示；按根元素和三把量尺量出的宽度取舍（`ResizeObserver` 替身） | jsdom |
| `region/RegionLocatePanel.test.tsx` | 市的列表与简称；点市、点区县、再点退回上一级，格子的按下；当前位置的各级、只有上一级能点、点上一级回去；搜索结果、标出关键字（包括只在市名里的）、点一条选中、没有结果；回车，输入法选字不算；延迟显示加载中；失败与重试 | jsdom |
| `boundary/BoundaryPanel.test.tsx` | 勾选、取消某一级后改变状态，都不勾选时没有滑块；线型示意（省界的线宽、县界的虚线）；滑块按百分比显示、拖动时交给拥有者 0～1 的值 | jsdom |
| `basemap/basemap-preference.test.ts` | 恢复上次的底图和透明度（包括内网的静态底图）；标注单独一项，两项一起恢复时互不干扰；修改后防抖写入；存下的底图不可用时保留当前的选择；版本 1 的"无底图"不盖住默认的静态底图；透明度越界时当作没有存过；合并函数（假定时器、内存存储） | jsdom |
| `basemap/static-basemap.test.ts` | 地名两层、市名在上；ID 前缀与组合后的校验；底色、面和线，颜色已经换算好；滑块的透明度；面保留 MultiPolygon；陆地色 CREAM 的换算、全省一种颜色、缩略图和当前配色一致；地名和区划目录逐条对应、只有汉字、落在自己的行政区里；区县地名的最小级别 | Node |
| `boundary/boundary-preference.test.ts` | 恢复上次的级别和透明度、推导随之变化；修改后防抖写入；缺少级别时当作没有存过；不传范围时和原来一样 | jsdom |
| `boundary/useBoundaries.test.ts` | 初始状态；开关某一级、透明度；值没变时不重新推导；不合法的透明度抛错；每次调用各有一份状态 | Node |
| `region/region-catalog.test.ts` | 目录与市界、县界数据逐条对应；市、区县的数量与所在的市；旧项目写错代码的区县；查找、路径、简称；当前位置的各级、区县所在的市；搜索的规则、顺序与条数 | Node |
| `region/region-geometry.test.ts` | 代码换成 6 位；外包范围；点在哪个区县（外包范围重叠时按多边形）；市从市界、区县从县界取，Polygon 与 MultiPolygon；连云港合并；每个文件只读一次；失败不缓存；没有这个区划、结构不对时报错；默认的 fetch 与下载失败 | Node |
| `region/region-style.test.ts` | 没有边界时是空分组；数据源与两个图层；ID 前缀与组合后的校验；每次推导的数据都是新对象 | Node |
| `region/useRegionLocate.test.ts` | 开始时是全省；加载中、到位后的状态与高亮，在选择时开始的操作下定位一次；换选、回到全省后晚到的成功和失败都不写入；回到默认视角；选同一个、不认识的代码；失败与重试；选择是一次相机操作、相机移动不算新的操作、加载期间有新的操作时只高亮、重试时重新开始；作用域销毁后不写入、不定位；共享的加载器；面板点击的规则（用相机操作的替身：视图一直就绪、没作废就执行；真实的相机模型和手动放行的加载器。等待就绪、跨失败等待由 map-vue 的测试负责） | Node |
| `location/coordinate-format.test.ts` | 各种写法的识别（标准、单位、分隔、连写、小数度、方向）；各种错误的原因与提示；输入框和复制的格式、进位、负零；格式化后能识别回原值；一对坐标的拆分；填反的判断 | Node |
| `location/useLocationPoint.test.ts` | 初始状态；定位与最小缩放、定位是一次相机操作（没就绪时就绪后再飞，级别按那时算，回调拿到的是相机控制）；放下、删除、格式、值没变不替换；拾取工具的光标、鼠标位置、单击放点并退出、不算的单击与 Esc；所在区县的判断、只采用最后一次（成功和失败都试过）、作用域销毁；共享的县界（用假的上下文和手动放行的判断） | Node |
| `location/press-gesture.test.ts` | 单击、长按进入拖动、移动的容差、拖动与按住时的取消、重复按下、没按下时的操作、释放后停止计时（假定时器） | Node |
| `location/location-info.test.ts` | 位置信息放在上方、超出可视区域上边时翻到下方（包括上边登记了元素）、左右限制在可视区域里（避开右侧面板）、小三角的位置和限制、可视区域比卡片窄；所在区划的各种文字 | Node |
| `location/CoordinateLocatePanel.test.tsx` | 空白时不提示；打开时显示已有的点；识别结果、规范写法、认不出来；切换格式；粘贴一对坐标；填反；"定位"按原值、空白时提示；回车与输入法；拾取开关、"拾取中"、关闭；卸载时取消拾取 | jsdom |
| `apps/yzt/tools/boundaries/boundaries.test.ts` | 边界数据的转换：文件对应关系、坐标取整与去掉高程、只留名称和代码、去掉 `crs`、原始结构不符合或没有要素时报错 | Node |
| `basemap/basemap-style.test.ts` | 可选的底图与初始状态；每种底图的组成、瓦片地址、缩放范围与透明度；ID 的分组前缀与组合后的校验；改透明度只产生 `setPaintProperty`；切换底图时背景不动；关闭天地图时任何选择都没有天地图；静态底图的组成、只引用本地文件、透明度、切到无底图；缩略图（南京附近的 10 级瓦片，底图加注记；静态底图是打包的小图；无底图、关闭天地图时矢量和影像没有） | Node |

- 底图的推导逐一改坏 22 处（关闭时仍给出全部选项或仍建数据源、注记图层用错、少一个子域名、缺少缩放范围、占位符被转义、行列写反、不带 key、背景缺失或在底图上面、注记不跟透明度、影像用矢量的透明度、ID 不带前缀或重复等），全部由断言发现
- 默认视角逐一改坏 10 处、江苏的范围 2 处、页面 2 处，只有"调用时先立即定位一次"测不出来：调用时视图一定还不存在（否则抛错），立即定位什么也不做，行为没有变化。这一处起初暴露了一个隐患——在地图就绪之后调用会在下一次就绪时重置用户的视角——所以加了"视图已存在时抛错"，把只能在页面里调用一次写进代码
- 5D.4 的面板逐一改坏 26 处（当前位置少一级、区县没有所属的市、点上一级的目标、最后一级也能点、格子不按下、选中区县时市不按下、输入时不换成结果、不标关键字、没有结果时不说明、"拾取中"、缩略图的注记和层叠顺序、无底图也有缩略图、缩略图的按下和名称、透明度交出百分比、百分比写错、线型示意的线宽和虚线、地图上的线宽少一档、虚线画成实线、卡片的按下和点击、文字在图的后面、底图卡总是矢量、图例卡不按下），全部由断言发现；"最后一级也能点"起初只是让 `wrapper.get('[aria-current]')` 报错，改成断言"能点的只有上一级"
- 状态栏和页面逐一改坏 13 处（整齐长度的顺序、旋转的范围两处、量不到宽度时也取舍、取舍顺序、比例尺和经纬度不随投影修订号重算、中心不标为中心、取样宽度、量错量尺、不显示"中心"、组件或页面不按坐标定位的写法），全部由断言发现；输入事件和版权控件的 3 处见 map-core.md，鼠标位置的 6 处见 map-vue.md
- 工具栏逐一改坏 5 处（不跟随当前工具、点击不激活、动作不调用回调、没有回调也可用、不按列表显示），全部发现
- 边界面板逐一改坏 6 处、页面 3 处（按钮不回默认视角、不绑定边界、边界放在注记下面），全部由断言发现；"不绑定边界"起初没被发现，页面测试补了"创建地图时的样式里有哪些图层、按什么顺序"
- 视图接口加 `pitch` 后改坏 2 处（适配器丢掉 `pitch`、默认视角不传），全部发现
- 边界的推导逐一改坏 12 处、拥有者 10 处（初始状态、面板顺序、叠放顺序、透明度不乘基础值或被忽略、县界没有虚线、地址用错、关闭的级别留在样式里、ID 不带前缀、线宽和颜色、相同的值也替换状态、透明度的校验与边界、状态在模块里共享等），全部由断言发现
- 面板逐一改坏 5 处（选择时不调用拥有者、透明度不换算、滑块显示 0～1、无底图时仍显示滑块、选项写死），全部发现；"透明度不换算"起初是 `setOpacity` 抛出的 `RangeError` 直接冒出来，把触发拖动的那一步包进 `not.toThrow()` 后由断言发现
- 拥有者逐一改坏 18 处，起初有 1 处没被发现、1 处的失败原因不是断言："推导不随传入的配置"（关闭天地图的用例选的是无底图，推导结果与配置无关），补了"瓦片地址里是传入的 key"；"透明度的边界写成开区间"时 `setOpacity(0)` 直接抛错，改用 `not.toThrow()` 断言。补上后全部由断言发现
- 起初还有一条"同一种底图的数据源始终是同一个对象"的用例，改坏验证时发现它测的是实现细节：数据源每次都新建时，`diffStyle` 的用例照样通过（style-spec 对数据源做深比较），于是删掉；数据源仍在工厂里一次建好，只是省去重复拼地址
- 区划目录逐一改坏 10 处、边界的加载 13 处。起初有 2 处没被发现："区县排在所有市后面"（搜索的用例只匹配到一个市，补了"州"的结果顺序）、"简称去掉所有的市"（江苏没有名称中间带"市"的区划，补了"市中区"）；"区县也从市界取"起初是代码自己抛错，改成用 `resolves` 断言后由断言发现
- 区划定位的拥有者逐一改坏 20 处、高亮的推导 8 处。起初"加载失败时不看是否中止"没被发现（只测了晚到的成功），补了换选、回到全省后晚到的失败；另有 3 处是改坏的写法本身有误（行尾符不匹配、语法错误、实际没改变行为），重写后全部由断言发现
- 区划定位的面板逐一改坏 16 处、工具栏的按下状态 2 处、页面的接线 7 处。"面板不登记为悬浮元素"测不出来：jsdom 没有布局，元素的尺寸都是 0，不会算进留白，改在浏览器里验证定位避开了面板；"关闭面板时清掉选择"起初没被发现（页面测试只用工具栏关面板），补了用面板上的关闭按钮关闭。其余全部由断言发现
- 写面板时发现 `nextRegionSelection` 和旧项目不一致：旧项目选中区县时所在的市也算选中，再点这个市回到全省，原来的实现会选中这个市。先补了复现的用例再改
- 坐标的识别与格式逐一改坏 42 处，起初 4 处没被发现：纬度前两位超过 90 时度只有 1 位、写了单位的长数字不当作连写、`E… N…` 前缀方向的度分秒、三段时不当作一对，各补了用例
- 位置点的拥有者逐一改坏 27 处、区县判断 4 处，起初 2 处没被发现：前一次判断晚到的失败（只测了晚到的成功）、只用外包范围判断（测试的点刚好落在第一个外包范围对的区县），补了用例，后者用旧项目标签坐标表里浦口区的点（也在江宁区的外包范围里）
- 按下手势逐一改坏 13 处、位置信息的位置与文字 10 处，全部由断言发现；图钉组件的交互在现状底图页的测试里覆盖（5B.6f）
- 区划定位和位置点改用 `LatestController` 后（5C.0c）改坏 5 处，4 处由断言发现；"重试时不开始新的选择、沿用当前的信号"是等价改动：重试只在加载失败后执行，这时当前的信号属于那次已经结束的选择，没有人在等它，沿用和换新的行为相同
- 坐标定位的面板逐一改坏 18 处、图钉浮层 14 处、页面接线 4 处。面板起初 3 处没被发现（空白时也提示、定位成功后不清提示、输入法选字时的回车），图钉浮层起初 7 处没被发现（不随相机移动、画布重建时、拖动不换成画布坐标、右键、位置信息不看开关），各补了用例；剩下 2 处测不出来："拖动时记的来源"目前没有使用方，界面上看不出来；"拾取提示不看当前工具"是等价改动，鼠标位置只在拾取工具激活时才有。"视图没就绪也投影"失败在适配器自己的"只能在 ready 时投影"，这正是判断要防止的
- 写页面测试时发现：面板回车定位时先规范再识别，度分秒会把输入的小数度取整到百分之一秒再定位，改成先识别、后规范
- 相机操作（ADR 0038）逐一改坏 15 处：相机模型 2 处、适配器 3 处、上下文 4 处、默认视角 3 处、区划定位 2 处、坐标定位 1 处，全部由断言发现。坐标定位那一处只在页面测试里改坏：单元测试的假上下文只有相机操作、没有 `view`，改回直接调用视口时失败的是代码报错而不是断言
- 等待返回后的再次确认（上下文执行前、`whenReady` 返回前的 `signal` 和视图、区划定位前）逐一改坏 4 处，全部由断言发现。先登记的等待者在就绪时开始新的操作，就能稳定地让旧操作排在新操作之后返回
- 改用相机操作对象（5C.0d，ADR 0039）后，拥有者和浮层改坏 8 处：区划定位 3 处（边界到位时才开始操作、到位后不确认选择是否过期、定位不带选项）、默认视角 3 处（初始适配开始新的操作、不做初始适配、视图已创建时不抛错）、浮层 2 处，全部发现。其中"测量标签在视图没就绪时也投影"失败在 `view` 为 `null` 的报错上：`view` 只在就绪时有值以后，这种写法过不了类型检查
- 原来区划定位、默认视角的测试里"等视图就绪""等待失败""地图刚就绪时的竞争""作用域销毁后不定位"这几类用例移到了 map-vue 的 `context.test.ts`：等待和作废现在是 `run` 的职责，拥有者只决定在哪次操作下、什么时候 `run`。完整的组合场景仍在现状底图页的测试里，并加了"引擎失败期间选中区划，重试成功后定位到区划"
