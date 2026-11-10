---
paths:
  - "packages/map-cesium/**"
  - "packages/map-three/**"
  - "packages/map-core/src/scene/**"
  - "packages/map-core/src/maplibre/roam/**"
  - "apps/yzt/src/features/scene-models/**"
  - "apps/yzt/src/pages/current-map/**"
  - "apps/yzt/src/pages/dev/{map-3d,nav-grid}/**"
  - "apps/yzt/public/{3dt,roam}/**"
---

# 三维（ADR 0078、0079、0147，设计见 `docs/modules/map-cesium.md`）

- 两种三维引擎（ADR 0147）：现有的 Cesium，和正在实施的 MapLibre + Three.js（新包 `@mx/map-three`，二三维共用一块画布和一个视图）。用 `VITE_MAP_3D_ENGINE` 选择，过门槛之前默认 `cesium`。页面和拥有者不判断引擎，一种引擎做不到的按能力声明（上下文的 `sceneCapabilities`：三维里显示样式图层、三维里识别，和 `dimension` 一起决定资源图层、图例、点/框选怎样显示）；三维里暂不显示资源图层（用户 2026-11-09 决定），`maplibre` 的能力声明由 app 按 `shared/config/scene-options.ts` 的开关收窄：只把 `styleLayers`、`identify` 收成和 Cesium 一样，`splats` 仍是 true，放开前先改页面设计；MapLibre 引擎下模型层叠在页面用 `provideMap` 的 `sceneBelow` 声明的分组下面，以上的分组画在模型上面；两种引擎实现同一份契约（`SceneContent`、`MapView`、`ToolView`），跑同一组契约测试；新的三维功能只在 MapLibre 引擎下做。MapLibre 引擎下，地下的模型要抬高，抬高只存在于渲染适配器内部，拾取、相机、漫游状态对外都是真实椭球高。MapLibre 引擎的漫游在 map-core 的 `maplibre/roam/`：从 map-cesium 移植的路线、步行只用真实坐标，经 `RoamHost` 设相机、拾取，抬高只在 `MapLibreRoam` 的相机换算和渲染器里；Cesium 一侧只修缺陷，手感只在 MapLibre 一侧调（[map-three.md](../../docs/modules/map-three.md)"漫游"）。MapLibre 引擎的缓存放不下时放宽屏幕误差：一放宽就锁在这个姿态，相机离开之前收紧不到放不下的倍数以下，不能写成"低于收回线就收紧"（整级丢掉后又加载回来，来回折腾）；动着的时候离开那个姿态、需求低于上限的 80% 可以收紧，收紧过又放不下，这一路就不再试；新瓦片在算加载完之前按每帧字节数上传；相机在一块瓦片加载完之前走的路达到瓦片直径就不请求这块瓦片（加载时间按动着时请求的瓦片实测，不用固定的秒数：本机和服务器差几倍），相机停下的那一帧起全部放行，这些瓦片要算进需求，有它们时要再画一帧（map-three.md"缓存""上传""动着的时候不请求"）。性能验收要测生产包，不测 PoC：`pnpm --filter yzt measure:3d`，在显卡机器上跑（map-three.md"性能验收"）。LCC2 高斯泼溅只在 MapLibre 引擎（ADR 0149）：会话的 `splats`、能力声明 `splats`，Cesium 忽略、面板不列出；清单存配准后的 `placement`，运行时不用 proj4、不用数据带的 `offset`；`gaussian-splat-lite` 只由 map-three 动态导入、精确锁版本，它在渲染回调外调 GL，靠每帧两头的 `resetState`，升级时重跑 GL 监听；同一处的倾斜模型（`clippedBySplats`）在泼溅的包围盒里用裁剪平面裁掉、拾取也跳过；每帧都调的拾取（状态栏读数、跟着鼠标的预览）传 `{ hover: true }`，不打泼溅（map-three.md"高斯泼溅"）。下面各条描述 Cesium 引擎
- 三维地图用 Cesium，精确锁定版本（1.146.0，ADR 0002、0079）；Worker、资源等运行时文件由 `vite-plugin-static-copy` 复制到产物的 `cesium/`，基础地址由 app 的三维运行时设置
- Cesium 同样只在 `packages/map-cesium` 和 `app` 导入（lint 检查，包括 `cesium/Build/...` 和 `@cesium/*`）；`CesiumView` 只依赖窄接口 `SceneLike`，唯一调用 Cesium 的是 `CesiumScene`，测试注入假场景（ADR 0079）
- 二三维切换用上下文的 `map.setDimension(kind)`：页面同时放 `<MapCanvas>` 和 `<CesiumCanvas>`，每种视图一个画布，上下文的 `view` 等只反映当前种类；切换时要做的业务（如 `basemap.selectForDimension`：三维默认影像、二维默认矢量）由页面在同一处调用。三维画布第一次切到三维时才加载，运行时由 app 的 `withMapRuntime` 通过 `MAP_RUNTIME` 注入，不在 `main.ts` 里安装（会把 maplibre-gl 带进入口，ADR 0079 第 2、8 节）
- 三维的 GeoJSON 覆盖物由 map-cesium 按样式自动镜像（line、fill、circle、symbol 的文字，按整级求值、简化到半个像素，ADR 0080），拥有者不为三维另写分组；铺满大范围、只做背景的图层用 `overlayDetailMetadata` 写细节上限，超过后不再加细、不再重建（ADR 0135）；`symbol` 只画文字、不做避让（ADR 0146），`fill-pattern` 等清单外的写法三维不画。三维期间点/框选不识别；三维独有的读数（视点高度、朝向）用就绪视图的 `eyeHeight()`、`heading()`
- 三维独有的内容（3D Tiles 瓦片集、钻地、漫游）由会话的 `scene` 持有，页面用 `map.bindScene(() => SceneContent)` 绑定拥有者的推导函数（一个上下文只绑定一个）；瓦片集的状态从上下文的 `sceneStatus` 读，就绪时带建议的相机，定位用它做相机操作；漫游的进度从 `roamStatus` 读，漫游开始时开始一次相机操作，被别的定位作废就退出。模型清单 `public/3dt/manifest.json` 入库、模型数据不入库（ADR 0081、0083），也不进构建产物；本机放在 `local/3dt/`（ADR 0141），服务器上放在发布目录之外、由 nginx 提供（`docs/deployment.md`）
- 漫游时页面只留漫游面板和小地图，隐藏业务工具栏、功能面板、底图、区划条、视图控件和状态栏：只隐藏，不改各拥有者的状态，退出后原样显示；进入时切回移动，漫游只在换成移动以外的工具时退出（ADR 0084、0095、0097）。漫游时左侧的漫游面板替换三维模型面板，步行和路线在面板里切换，速度共用米/秒。没有单独的钻地：漫游地下的模型时由拥有者推导出地下空间（地表固定半透明、不显示地面上的模型），退出漫游就回到地面
- 导航网格在 `map-core/scene/nav`，不依赖 Cesium、DOM：`buildNavigation` 在主线程下载叶节点瓦片、在 Worker 里构建；行走碰撞、寻路、平面图用同一份区域（`labels`）；平面图正北朝上（按根节点局部系的方位角旋转）、按区域着色（`planRegions`、`renderFloorMap`，ADR 0085）
- 步行是会话三维内容的 `roam`（`kind: 'walk'`）：拥有者建好导航网格（按模型缓存）后交给会话，视图选出生点、接管键鼠逐帧行走；行走、点击、脱困、出生点的规则在 map-core 的 `Walker` 和纯函数里，Cesium 一侧（`scene-walk.ts`）只做输入、深度拾取和相机；回到出生点、脱困这类一次性命令写成计数；漫游期间每帧关掉 Cesium 的相机控制（flyTo 结束后它会被打开）（ADR 0086）；已经在模型里时挪相机不用 flyTo（在地下飞总会先升到地面以上），近处直接设、远处用 `Blackout` 闪切，漫游时覆盖物不按级别重建（ADR 0103）
- 漫游时的室内地图（小地图、完整地图）在 `features/scene-models`：楼层和着色用 `indoorMapOf` 按导航网格缓存，步行时人的位置来自步行状态的 `player`，路线漫游时按走过的米数从路线上取、路线画在地图上（`route-track.ts`，ADR 0097 第 6 节，路线漫游不能瞬移）；完整地图打开时用步行意图的 `paused` 暂停，双击瞬移用 `teleport` 计数；地图的取景、缩放是纯函数（ADR 0087）
- 第三人称（ADR 0090）：人称是步行意图的 `view`，相机的挂法（弹簧臂、防穿墙、转身、淡出）在 map-core 的 `WalkRig`，人物模型 `public/roam/Cesium_Man.glb`（CC BY 4.0，署名见同目录 `CREDITS.txt`）由拥有者给出地址；入口暂不开放，现状底图页不给 `RoamPanel` 传 `personSwitch`
