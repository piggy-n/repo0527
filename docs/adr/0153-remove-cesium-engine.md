# 0153. 移除 Cesium 引擎，三维只用 MapLibre + Three.js

- 状态：已接受（2026-11-11 用户决定"现在就移除"；第 4 条注入收窄的能力由 0157 取消，三维里照常显示和点选资源图层）
- 日期：2026-11-11
- 修改：
  - 取代 ADR 0147 第 1 节（两种引擎、`VITE_MAP_3D_ENGINE` 选择、注入"三维由哪块画布承担、运行时怎样加载"）、第 3 节"两种引擎都跑契约测试"、第 6 节（Cesium 的维护范围）、第 7 节里 Cesium 的构建和 CI；
  - 取代 ADR 0150 的"`cesium` 仍是可选的取值"、CI 里"默认以外的那一种"和单元测试的 `test.env` 固定 `cesium`；
  - 取代 ADR 0151 第 3 条（三维引擎按部署选择）；ADR 0152 的 `cesium` 下的 LCC2 不再有对象；
  - ADR 0002 的 Cesium、ADR 0079 的 Cesium 运行时和三维画布、ADR 0091 预加载 Cesium 的运行时、ADR 0135 覆盖物的细节上限（只给 Cesium 的覆盖物镜像用），到这里结束；
  - ADR 0147 状态行里 2026-11-09 起关着三维资源图层的开关 `SCENE_OPTIONS.resourceLayers` 删掉，app 直接注入收窄后的能力（第 4 条）；
  - ADR 0078～0086、0090 的范围和交互仍是验收的依据，由 MapLibre 引擎实现（ADR 0147 第 8 节 3C.3），文中 Cesium 的实现细节只是历史；覆盖物的镜像除外：ADR 0080 第 1 节、0082、0099、0103 第 2 节和 0135 只用于 Cesium 的镜像，到这里结束，MapLibre 引擎的三维直接画二维样式的图层。

## 背景

ADR 0147 加入 MapLibre + Three.js 引擎（`@mx/map-three`），和 Cesium 用 `VITE_MAP_3D_ENGINE` 在构建时选择。ADR 0150 把默认值改为 `maplibre`，Cesium 保留为可选，规则是 Cesium 只修缺陷、跟版本，新的三维功能只在 `maplibre` 下做。ADR 0151、0152 定了 Cesium 下的资源图层和 LCC2 都不做，两个 PoC 留在 `poc/*` 分支和标签上。

照这个规则，Cesium 已经拿不到新功能，但它还在 main 上，每次改三维的契约都要顾到它：

- **契约改动做两遍：** `SceneContent`、`MapView`、`ToolView` 的每次改动，Cesium 一侧也要编译通过、声明不支持或者忽略，并且通过同一组契约测试。接下来的 LCC 漫游要改漫游的契约，这笔账会一直累积。
- **CI：** 每次 push 多一次 `cesium` 的内网构建和两个冒烟文件；软件渲染下 Cesium 的浏览器测试最慢，契约测试的时限是按它放宽到 60 秒的。
- **依赖：** Cesium 精确锁版本，三个 `@cesium/*` 子包另在 `overrides` 里钉住，升级时一起改（ADR 0005）。
- **文档：** 模块文档、规则文件里的三维部分都写着两种引擎（`map-cesium.md`、`.claude/rules/map-3d.md` 的大半是 Cesium）。

要删的代码：`packages/map-cesium`（源码 5242 行、测试 3969 行），map-vue 的 `CesiumCanvas` 和三维运行时的注入，app 的引擎选择和 Cesium 的运行时设置，构建时复制的 `cesium/`（约 7 MB），以及只读 Cesium 读数的开发页 `/dev/tileset-probe`。

**风险：** `maplibre` 引擎只在 RTX 3060、15 GB 内存的机器上测过，没有在集成显卡、8 GB 内存的机器上测过（`docs/backlog.md`）。它的渲染进程私有内存比 Cesium 多（ADR 0150：z17 稳定时 1,891 对 872 MB）。移除以后，那类机器上跑不动时，没有按部署退回 Cesium 的开关。用户 2026-11-11 听过这一点后决定现在移除。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| Cesium 引擎 | 继续保留为可选（ADR 0150、0151）；留在 main 上但不再跟版本；从 main 移除 | **移除。** 保留的价值只是"某个部署跑不动 MapLibre 时退回去"，还没有出现过这样的部署；代价是上面每一项都要一直付。冻结版本不能省掉契约的双份维护，还会积下安全更新 |
| 代码放在哪 | 注释标签；长期分支；只靠 main 的历史 | **注释标签**，指向 main 上移除前最后一个改代码的提交（`16789827`；之后到移除前 main 只改了 `docs/backlog.md`）。代码就在 main 的历史里，不需要分支；标签让它不用翻历史就找得到，写明了原因 |
| 能力声明 | 随 Cesium 一起删掉；保留 | **保留** `sceneCapabilities`。三维里的资源图层和点/框选还关着，页面的重新设计决定它们以后怎样工作；`splats` 现在总是 true，照留 |
| 三维资源图层的开关 `SCENE_OPTIONS.resourceLayers` | 留着；删掉 | **删掉**（用户 2026-11-11）。它一直是 false，重新设计页面时也不会用开关；app 直接注入收窄后的能力，行为不变 |
| `/dev/tileset-probe` | 移植到 MapLibre；删掉 | **删掉。** 它读的是 `CesiumScene.inspect()` 的读数（`memoryAdjustedScreenSpaceError`、Cesium 的缓存），移植等于重写；MapLibre 引擎的瓦片集用 `measure:3d` 测，高斯泼溅用 `/dev/splat-watch` |
| `measure:3d` | 删掉；改成只测 MapLibre | **只测 MapLibre。** 和 Cesium 的对比（ADR 0147 3C.4）门槛已过，没有对照了；读数、截图、泼溅的预算对比照常有用 |

## 决定

1. **三维只有 MapLibre + Three.js。** `MapCanvas` 的视图同时担任二维和三维（ADR 0147 第 2 节），第一次切到三维时加载 `@mx/map-three`。删掉：
   - `packages/map-cesium`、`cesium` 依赖和 `@cesium/*` 的 `overrides`；
   - map-vue 的 `CesiumCanvas`、`CESIUM_ENGINE`、`MAP_RUNTIME`（三维运行时的注入）；`SceneEngine` 只剩能力声明和加载渲染器的函数；
   - `VITE_MAP_3D_ENGINE`、`appConfig.map3dEngine`、`app/map-runtime-3d.ts`；`app/map-framework.ts` 只有一个运行时；
   - 构建复制的 `cesium/`，CI 的 `cesium` 构建和冒烟，Cesium 的冒烟 `scene.spec.ts`（MapLibre 的 `scene-maplibre.spec.ts` 改名为 `scene.spec.ts`）；
   - 切到三维的耗时里 `runtime` 这一步（只有 Cesium 记它）；
   - 只有 Cesium 用的 map-vue `FailedView` 和 map-core 的覆盖物细节上限（`overlayDetailMetadata`、`overlayDetailLimit`，ADR 0135）。
2. **契约不变。** `SceneContent`、`MapView`、`ToolView` 和 map-vue 的上下文（`setDimension`、`sceneCapabilities` 等）不改，契约测试只跑 MapLibre，用例都留着；只有 Cesium 跑的"不能显示泼溅时忽略"删掉。ADR 0147 第 4、5 节（抬高、方案 C 的实现要求）照旧。
3. **代码在标签上：** `cesium-engine-2026-11`（注释标签，main 的 `16789827`），已推送。没有另建分支。PoC 的标签 `poc-plan-b-2026-11`（ADR 0151）、`poc-plan-3-2026-11`（ADR 0152）照旧。
4. **三维资源图层的开关删掉。** `shared/config/scene-options.ts` 删掉，`app/map-runtime-provider.ts` 直接注入 `{ styleLayers: false, identify: false, splats: true }`：三维里不显示资源图层、点/框选不识别，高斯泼溅照常，和删之前一样。能力声明的机制留着（候选方案的"能力声明"一行）。
5. **什么时候再考虑：** 出现 MapLibre 引擎在目标机器上跑不动、又换不了机器的部署（先按 backlog 在集成显卡、8 GB 内存的机器上测）。那时先查能不能在 MapLibre 一侧降配（缓存、屏幕误差、泼溅的预算、关掉三维），不行再从标签恢复：要把移除以后 main 上的契约改动（如 LCC 漫游）补进 Cesium 一侧，重新接上运行时的注入、`.env` 的选择和 CI，另写 ADR。

## 后果

- **好处：** 三维的契约改动只做一套；CI 每次少一次构建和两个冒烟文件；不再跟 Cesium 的精确版本和子包；模块文档和规则只写一种引擎；lockfile 少 26 个包，产物不会再带 `cesium/`。
- **代价（用户接受）：**
  - `maplibre` 引擎没有在集成显卡、8 GB 内存的机器上测过，没有按部署退回的开关（见背景的"风险"）；
  - 从标签恢复的难度随 main 的改动增长；
  - 只有 Cesium 做了的第三人称人物模型（ADR 0090，入口没开放）跟着删掉，MapLibre 引擎下以后用 `AnimatedModel` 做（`docs/backlog.md`）。
- **没有简化的**（契约保持不变，以后要简化另做）：map-vue 的上下文仍支持每种视图一块画布，现在只有 `MapCanvas` 一块；拾取结果的 `PickSurface` 里的 `ellipsoid`、`terrain` 已经没有视图给出；`SceneCapabilities.splats` 总是 true；会话地下空间的 `surfaceOpacity`（拥有者设 0.25、会话校验）没有视图再读，MapLibre 引擎抬高期间把二维图层全部隐藏（ADR 0147 第 4 节）。
- **保留能力声明的代价很小：** 一个三项的接口、app 里一处注入，读它的是资源图层的拥有者（`hiddenInScene`）、点/框选和图例，以及三维模型目录按 `splats` 过滤（现在总是放行）。删掉它要把"三维里不显示资源图层"改写到这几处，重新设计时多半又要加回来。
- **已同步：** ADR 0002、0078、0079、0080、0081、0082、0091、0099、0103、0135、0147、0150、0151、0152 的状态行，[README](README.md) 的索引，[地图架构总览](../modules/map-overview.md)，`AGENTS.md` 的技术栈和目录结构，`.claude/rules/` 里的三维和地图规则，模块文档、配置说明、`docs/commands.md`、`docs/deployment.md`、`docs/backlog.md`；[map-cesium.md](../modules/map-cesium.md) 只留指向标签的说明。
