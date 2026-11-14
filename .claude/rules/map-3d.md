---
paths:
  - "packages/map-three/**"
  - "packages/map-core/src/scene/**"
  - "packages/map-core/src/maplibre/roam/**"
  - "apps/yzt/src/features/scene-models/**"
  - "apps/yzt/src/shared/map/scene-tier/**"
  - "apps/yzt/src/pages/current-map/**"
  - "apps/yzt/src/pages/dev/{map-3d,nav-grid,splat-watch}/**"
  - "apps/yzt/public/{3dt,roam}/**"
---

# 三维（ADR 0078、0147、0153，设计见 `docs/modules/map-three.md`）

- 三维只用 MapLibre + Three.js（`@mx/map-three`，ADR 0147）。Cesium 引擎由 ADR 0153 移除，代码在标签 `cesium-engine-2026-11`，不要再引入 Cesium 或第二种三维引擎；要改这一点先写 ADR
- `MapCanvas` 的一个视图同时担任二三维：第一次切到三维时由 map-vue 动态导入 map-three（只有 map-vue 能导入它，只有 map-three 和驾驶舱能导入 `three`、`3d-tiles-renderer`）；三维模块加载失败只让三维失败，二维照常可用，`retry` 只重新加载这个模块。二维第一次画面稳定后由画布交给 `MAP_RUNTIME_PRELOAD` 预加载 map-three（ADR 0091）
- 页面和拥有者不判断引擎，按上下文的 `sceneCapabilities`（三维里显示样式图层、三维里识别、高斯泼溅）和 `dimension` 决定资源图层、图例、点/框选怎样显示；三维里暂不显示资源图层（用户 2026-11-09 决定）：app 注入的能力（`app/map-runtime-provider.ts`）里 `styleLayers`、`identify` 是 false，`splats` 是 true，没有开关；放开前先重新设计页面
- 契约：三维实现会话的三维内容（`SceneContent`、`sceneStatus`、`roamStatus`）、`MapView` 和 `ToolView`；契约测试是 map-vue 的 `scene-contract.browser.test.tsx`（真实的 MapLibre + Three），改契约时同步改它
- 模型层叠在页面用 `provideMap` 的 `sceneBelow` 声明的分组下面，以上的分组画在模型上面
- 地下的模型要抬高（MapLibre 把相机限制在 0 米以上，ADR 0147 第 4 节）：抬高只存在于渲染适配器内部，拾取、相机、漫游状态对外都是真实椭球高。漫游在 map-core 的 `maplibre/roam/`：路线、步行只用真实坐标，经 `RoamHost` 设相机、拾取，抬高只在 `MapLibreRoam` 的相机换算和渲染器里（[map-three.md](../../docs/modules/map-three.md)"漫游"）
- 缓存放不下时放宽屏幕误差：一放宽就锁在这个姿态，相机离开之前收紧不到放不下的倍数以下，不能写成"低于收回线就收紧"（整级丢掉后又加载回来，来回折腾）；动着的时候离开那个姿态、需求低于上限的 80% 可以收紧，收紧过又放不下，这一路就不再试；新瓦片在算加载完之前按每帧字节数上传；相机在一块瓦片加载完之前走的路达到瓦片直径就不请求这块瓦片（加载时间按动着时请求的瓦片实测，不用固定的秒数：本机和服务器差几倍），相机停下的那一帧起全部放行，这些瓦片要算进需求，有它们时要再画一帧（map-three.md"缓存""上传""动着的时候不请求"）
- 三维的预算按设备分档（ADR 0155）：数值只在 `shared/config/scene-tier-options.ts`；map-three 不读配置、不判断显卡，只按 app 交给它的预算来源（map-core 的 `SceneBudgetSource`）做；档位、降档、崩溃标记在 `shared/map/scene-tier`，由 app 注入的三维引擎（`app/map-runtime-provider.ts`）交给渲染器（`docs/config/scene-tier.md`）
- 性能实测要测生产包，不测 PoC：`pnpm --filter yzt measure:3d`，在显卡机器上跑（map-three.md"性能验收"）
- LCC2 高斯泼溅（ADR 0149）：会话的 `splats`，能力声明 `splats` 为 false 时面板不列出；清单存配准后的 `placement`，运行时不用 proj4、不用数据带的 `offset`；`gaussian-splat-lite` 只由 map-three 动态导入、精确锁版本，它在渲染回调外调 GL，靠每帧两头的 `resetState`，升级时重跑 GL 监听；同一处的倾斜模型（`clippedBySplats`）在泼溅的包围盒里用裁剪平面裁掉、拾取也跳过；每帧都调的拾取（状态栏读数、跟着鼠标的预览）传 `{ hover: true }`，不打泼溅（map-three.md"高斯泼溅"）
- 二三维切换用上下文的 `map.setDimension(kind)`，上下文的 `view` 等只反映当前种类；切换时要做的业务（如 `basemap.selectForDimension`：三维默认影像、二维默认矢量）由页面在同一处调用。地图的运行时由 app 的 `withMapRuntime` 随地图页加载，不在 `main.ts` 里安装（会把 maplibre-gl 带进入口，ADR 0061、0079 第 2 节）
- 覆盖物是二维样式的图层，三维里照常显示，拥有者不为三维另写分组；三维独有的读数（视点高度、朝向）用就绪视图的 `eyeHeight()`、`heading()`
- 三维独有的内容（3D Tiles 瓦片集、高斯泼溅、地下、漫游）由会话的 `scene` 持有，页面用 `map.bindScene(() => SceneContent)` 绑定拥有者的推导函数（一个上下文只绑定一个）；瓦片集的状态从上下文的 `sceneStatus` 读，就绪时带建议的相机，定位用它做相机操作；漫游的进度从 `roamStatus` 读，漫游开始时开始一次相机操作，被别的定位作废就退出。模型清单 `public/3dt/manifest.json` 入库、模型数据不入库（ADR 0081、0083），也不进构建产物；本机放在 `local/3dt/`（ADR 0141），服务器上放在发布目录之外、由 nginx 提供（`docs/deployment.md`）
- 漫游时页面只留漫游面板和小地图，隐藏业务工具栏、功能面板、底图、区划条、视图控件和状态栏：只隐藏，不改各拥有者的状态，退出后原样显示；进入时切回移动，漫游只在换成移动以外的工具时退出（ADR 0084、0095、0097）。漫游时左侧的漫游面板替换三维模型面板，步行和路线在面板里切换，速度共用米/秒。没有单独的钻地：漫游地下的模型时由拥有者推导出地下空间（不显示地面上的模型），视图把这个模型抬高，抬高期间把地图上的二维图层都设成不可见、用 `#1e2226` 清屏（map-three.md"漫游"的"抬高"），退出漫游就回到地面；地下空间的 `surfaceOpacity` 现在没有视图读。漫游高斯泼溅时拥有者给出 `isolatedSplat`、别的模型都设成不显示，视图按抬高的做法接管（抬高量 0）：只画这份、隐藏二维、底色清屏，这份拿全部泼溅预算（ADR 0156 R.5）
- 导航网格在 `map-core/scene/nav`，不依赖渲染引擎和 DOM：`buildNavigation` 在主线程下载叶节点瓦片、在 Worker 里构建；行走碰撞、寻路、平面图用同一份区域（`labels`）；平面图正北朝上（按根节点局部系的方位角旋转）、按区域着色（`planRegions`、`renderFloorMap`，ADR 0085）；LCC2 的漫游（ADR 0156）用碰撞网格建导航网格（`buildScanNavigation`，参数 `SCAN_NAV_OPTIONS`：0.1 米的格子、半径 0.15、身高 1.2、不要求遮盖），区域、楼层的大小按面积比，不按格数
- 步行是会话三维内容的 `roam`（`kind: 'walk'`）：拥有者建好导航网格（按模型缓存）后交给会话，视图选出生点、接管键鼠逐帧行走；行走、点击、脱困、出生点的规则在 map-core 的 `Walker` 和纯函数里，`maplibre/roam/walk-roamer.ts` 只做输入、拾取和相机；回到出生点、脱困这类一次性命令写成计数（ADR 0086）；漫游期间由 `MapLibreRoam` 接管地图的相机和手势，退出后视图按当前工具恢复；已经在模型里时挪相机不用 flyTo，近处直接设、远处用 `Blackout` 闪切（ADR 0103）
- 漫游时的室内地图（小地图、完整地图）在 `features/scene-models`：楼层和着色用 `indoorMapOf` 按导航网格缓存，步行时人的位置来自步行状态的 `player`，路线漫游时按走过的米数从路线上取、路线画在地图上（`route-track.ts`，ADR 0097 第 6 节，路线漫游不能瞬移）；完整地图打开时用步行意图的 `paused` 暂停，双击瞬移用 `teleport` 计数；地图的取景、缩放是纯函数（ADR 0087）
- 第三人称（ADR 0090）：人称是步行意图的 `view`，相机的挂法（弹簧臂、防穿墙、转身、淡出）在 map-core 的 `WalkRig`，人物模型 `public/roam/Cesium_Man.glb`（CC BY 4.0，署名见同目录 `CREDITS.txt`）由拥有者给出地址；入口暂不开放，现状底图页不给 `RoamPanel` 传 `personSwitch`；只有已移除的 Cesium 引擎画过人物，MapLibre 引擎下要用 map-three 的 `AnimatedModel` 补上（`docs/backlog.md`）
