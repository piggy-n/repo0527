# map-three：MapLibre 引擎的三维

`packages/map-three`（`@mx/map-three`）是 ADR 0147 的第二种三维引擎：MapLibre + Three.js。三维模型用 Three.js 画在 MapLibre 的 custom layer 里，和二维共用一块画布、一个 WebGL 上下文、一个视图。用 `VITE_MAP_3D_ENGINE=maplibre` 选择（[env.md](../config/env.md)），通过 ADR 0147 第 9 节的门槛之前默认仍是 Cesium（[map-cesium.md](map-cesium.md)）。

现在做到 3C.1：三维模型面板能加载、定位、换白模效果；资源图层在三维里的显示、投影切换、加载失败的视图级处理是 3C.2，地下和漫游是 3C.3，自适应缓存和上传预算是 3C.4。

## 结构

```
map-vue  MAPLIBRE_ENGINE ──动态 import()──▶  @mx/map-three  createSceneRenderer
   │                                              │（只有它导入 three、3d-tiles-renderer）
   ▼                                              ▼
map-core/maplibre  MapLibreView ── MapLibreScene ── SceneLayer（custom layer 的外壳）
                         │              │                 │ 每帧：GL 上下文、矩阵、投影过渡值
                         │              └ SceneTilesetSync ▼
                         │                          SceneRenderer（窄接口，map-three 实现）
                         └ 种类：2d / 3d（setKind）
```

- **外壳在适配器里**：只有 `map-core/src/maplibre/` 能导入 maplibre-gl（ADR 0024），所以 `CustomLayerInterface` 由 `SceneLayer` 实现，它把 `onAdd`、`onRemove`、`prerender`、`render` 转成 `SceneRenderer` 的调用；渲染器不碰 MapLibre。
- **窄接口**：`SceneRenderer`、`SceneSurface`、`SceneFrame` 在 `map-core/src/maplibre/scene-renderer.ts`，和 `CesiumView` 依赖的 `SceneLike` 是同一种做法（ADR 0079 第 3 节）。锚点矩阵由外壳用 `MercatorCoordinate` 算好交给渲染器，MapLibre 的地球半径这类常量只留在适配器里。
- **瓦片集的同步两种引擎共用**：会话的瓦片集怎样增删改、同组换白模效果时等新的首批瓦片、状态汇总，在 map-core 的 `SceneTilesetSync`；Cesium 一侧（`CesiumView`）和这里都用它，引擎只实现 `TilesetHost` 这三个方法。让包围球进入画布的相机（`tilesetCamera`）也共用。
- **加载**：`MapLibreScene` 在第一次要加瓦片集时调用 `loadSceneRenderer`（map-vue 的 `MAPLIBRE_ENGINE` 里写 `import('@mx/map-three')`），`three` 和 `3d-tiles-renderer` 这时才下载。加载失败记成各瓦片集的 `failed`，面板原有的重试（换重试次数）重新加载；3C.2 改成视图级的"只有三维种类失败"。

## 一个视图两种种类（ADR 0147 第 2 节）

- 给了 `loadSceneRenderer` 的 `MapLibreView` 声明 `kinds = ['2d', '3d']`；上下文切换维度时调用它的 `setKind`，不暂停、恢复，画布和相机都不变（[map-vue.md](map-vue.md)）。
- 显示三维、视图就绪、地图样式已加载时，模型层挂在地图上，叠在最上面（样式命令加了新图层后挪回最上面；和覆盖物的叠放 3C.2 再定）；其余时候撤下。撤下不释放 GPU 资源，同 Cesium 暂停时的做法。
- 三维内容在显示二维期间不应用，切回三维再应用；`sceneStatus` 只在三维时报告，二维时为空。
- 3C.1 里三维仍是墨卡托投影，俯角上限沿用二维；投影切成地球、俯仰限制、`eyeHeight`、`heading` 在 3C.2。

## 渲染

- 只用一个 `WebGLRenderer`，和 MapLibre 共用上下文：`autoClear` 关掉，像素比固定为 1，每帧按画布的实际像素设视口（画布尺寸变了不用重建）。
- 每帧画之前 `resetState`、清深度，画之后再清一次深度；地图的 `render` 事件里再 `resetState`，层有空的 `prerender`，回调外调用过 GL 也不影响 MapLibre（PoC 的坑 9）。
- **坐标**：每个瓦片集一个局部系（x 东、y 上、z 南，米），锚在包围球的球心；东、北一米对应的经纬度按 WGS84 椭球的两个曲率半径算，竖直方向和 MapLibre 的高度比例一致。远处的模型也有足够的精度。
- **投影过渡**：墨卡托、地球各用一个矩阵，过渡段在裁剪空间按 MapLibre 着色器的 `mix(flat, globe, t)` 插值，z<12 也画；地球背面（锚点在裁剪面后面）整个不画。
- **相机**：从裁剪矩阵拆出 Three 的相机（同 maplibre-gl-three 的 MapCameraSync），瓦片的视锥裁剪、屏幕误差、拾取都用它。
- **瓦片**：每个瓦片集一个 `TilesRenderer`，整理后的索引用 Blob 地址交给它（内容地址都是绝对地址）；屏幕误差 16，和 Cesium 相同。所有瓦片集共用一个 LRU 缓存，数值同 Cesium：1 GB，最多再溢出 512 MB（2026-11-06 Cesium 调大以后跟着调）。Cesium 的预算是每个瓦片集各一份，这里是所有瓦片集的总量，同时显示几个大模型时更紧。满了以后拒绝加载（`stats.refused`），放宽屏幕误差的自适应缓存是 3C.4。
- **首批瓦片到位**：瓦片集显示后，某一帧更新完已经没有排队、下载、解析中的瓦片（`loadProgress` 为 1），算首批到位；不在视野里时第一帧就到，同 Cesium 的 `initialTilesLoaded`。

## 光照

- `sun`：环境光加一个固定方向的平行光（局部系里东南方向、高度角 50°）。Cesium 按当前时刻的太阳，三维里看不出时刻，这里不跟；明暗要在显卡机器上和 Cesium 对比后再调。
- `headlight`：从 `map-cesium` 的 `scene-tilesets` 移植。不受场景光照影响，正对视线的面亮、斜掠的面暗（`0.5 + 0.5 × facing`，再乘 1.15），法线用视点坐标的屏幕空间导数求。每个原材质换成一个 `MeshBasicMaterial` 变体，变体按原材质缓存，模型卸载时释放；换回 `sun` 时用回原材质。
- 材质一律双面，和 Cesium 一侧关掉背面剔除一致。步行时按距离压暗远处（`uFog`）在 3C.3。

## 拾取与投影

- **拾取**：按最近一帧每个瓦片集的裁剪矩阵打射线，取最近的命中（各局部系的距离都是米、起点相同，可以直接比较）。射线由裁剪矩阵的逆直接算出近处、远处两点，不用拆出的相机位置：地球投影的过渡段是两个投影的插值，拆出的位置不是真正的投影中心，测得往返偏 1.4 像素；命中点从局部系换回地心坐标再换成经纬度和椭球高。视图在三维时先拾取模型（`surface: 'model'`，带 `height`），打不到再用 MapLibre 的 `unproject`（`surface: 'map'`）。
- **投影**：不在地面上的点（给了非 0 的 `height`）按最近一帧的投影算：锚点放在这个点的经纬度上，局部系的 (0, height, 0) 乘裁剪矩阵；在相机背后、地球背面时为 null，还没画过时也为 null。地面上的点用 MapLibre 的 `project`，两者相差不到 0.1 像素（PoC）。
- 拾取—投影往返的误差在测试里小于 1 像素：墨卡托 z17、地球 z10.5、过渡段 z11.6 都测了。

## GL 上下文丢失

MapLibre 丢失上下文时销毁样式和自定义层，恢复后重新加载样式，但不会自动加回自定义层（6.12 源码里有警告）。

- 丢失时（地图的 `webglcontextlost`）渲染器丢掉 `WebGLRenderer`：它跟踪的 GPU 资源随之作废，瓦片集、模型这些内容保留。
- 恢复后样式重新加载（`style.load`），视图把模型层重新加上，`onAdd` 时建新的 `WebGLRenderer`，画的时候重新上传几何体和纹理；瓦片从缓存取，缓存里没有的重新下载。
- 瓦片集的状态一直是 `ready`，不重新报告。

## glTF 和骨骼动画

`AnimatedModel` 加载一个 glTF（`GLTFLoader`）并播放它的全部动画（`AnimationMixer`，按真实时间推进），局部系锚在放置点；有动画时每帧请求重画。现在只有测试用到（渲染器的 `addModel`），3C.3 的第三人称人物用它，那时再进 `SceneRenderer` 接口。

## 测试

- `map-core`：`SceneTilesetSync`、`MapLibreScene`（假地图、假渲染器）、`MapLibreView` 的种类切换，普通测试。
- `map-three`：`three-scene-renderer.browser.test.ts`，真实的 MapLibre 和 Three，模型在内存里生成（`GLTFExporter`），只用 `https://fixture.test/` 的假地址（拦下 `fetch`）：拾取—投影往返、就绪时建议的相机、glTF 骨骼动画让画面变化、GL 上下文丢失和恢复。
- `map-vue`：`scene-contract.browser.test.tsx`，两种引擎的契约测试（ADR 0147 第 3 节），同一组用例分别跑真实的 Cesium 和 MapLibre + Three；夹具是 `src/testing/scene-fixtures` 的文本瓦片集。3C.1 覆盖三维内容的增删、状态、失败和重试，以及 GL 上下文的丢失和恢复（只有 `maplibre`）。
- 夹具的瓦片集都是"根节点分组、下面一个带内容的叶节点"：只有一个叶节点时 `prepareTileset` 把整个瓦片集的误差整理成 0，Cesium 不会加载（见 `docs/backlog.md`）。
- 这台开发机只有软件 WebGL：画面、性能在真实显卡上的表现没有验证，性能验收按 ADR 0147 第 8 节在 3C.4 用生产包测。

## 还没做的

- 3C.2：投影切成地球、俯仰限制、`eyeHeight` / `heading`、资源图层和覆盖物在三维里的显示与叠放、三维期间的点选、视图级的加载失败和重试、逐帧空白检测、预加载 map-three、`maplibre` 下三维的冒烟用例。
- 3C.3：地下（模型抬高，ADR 0147 第 4 节）、步行、路线漫游、室内地图、`uFog`。`maplibre` 下漫游的入口还在，但现在不起作用。
- 3C.4：自适应缓存、上传预算，测量页改为测这个包。
