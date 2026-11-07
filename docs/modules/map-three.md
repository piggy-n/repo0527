# map-three：MapLibre 引擎的三维

`packages/map-three`（`@mx/map-three`）是 ADR 0147 的第二种三维引擎：MapLibre + Three.js。三维模型用 Three.js 画在 MapLibre 的 custom layer 里，和二维共用一块画布、一个 WebGL 上下文、一个视图。用 `VITE_MAP_3D_ENGINE=maplibre` 选择（[env.md](../config/env.md)），通过 ADR 0147 第 9 节的门槛之前默认仍是 Cesium（[map-cesium.md](map-cesium.md)）。

现在做到 3C.2：一个视图担任二三维，切到三维是地球投影；资源图层和覆盖物在三维里照常显示，模型层和它们的叠放由页面声明；三维里能点/框选、测量、坐标定位；三维模块在二维稳定后预加载，加载失败只让三维失败。地下和漫游是 3C.3，自适应缓存和上传预算是 3C.4。

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
- **加载**：视图第一次切到三维时 `MapLibreScene` 调用 `loadSceneRenderer`（map-vue 的 `MAPLIBRE_ENGINE` 里写 `import('@mx/map-three')`），`three` 和 `3d-tiles-renderer` 这时才下载；二维第一次稳定以后会预加载，切换时通常已经在模块表里。失败见下面"加载失败和重试"。

## 一个视图两种种类（ADR 0147 第 2 节）

- 给了 `loadSceneRenderer` 的 `MapLibreView` 声明 `kinds = ['2d', '3d']`；上下文切换维度时调用它的 `setKind`，不暂停、恢复，画布不变（[map-vue.md](map-vue.md)）。
- **投影和俯角**：三维是 MapLibre 的地球预设 `{ type: 'globe' }`（z11～12 从地球过渡到墨卡托，z12 以上和墨卡托相同），俯角上限 85°；二维是样式根上的投影（没有时墨卡托），俯角上限是页面的 `maxPitch`（没给时 60）。投影是视图上的差异，不进会话的样式：整体重建的新样式带着自己的投影，样式加载完成时按当前种类再设一次。缩放上限仍是页面的（现状底图 18 级），第一人称要更高，在 3C.3 一起定。
- **相机按会话同步**：已经就绪时换种类，先按会话的相机 `jumpTo`（俯角放进新的上限），再改上限和投影，最后把地图收敛过的实际值按 `sync` 写回；先跳再改上限，MapLibre 就不会自己收回俯角、发出不带 `eventData` 的移动（会被当成 `program`）。没有就绪（加载中、暂停）时，激活时按当前种类设好再同步。
- **模型层**：显示三维、视图就绪、地图样式已加载、三维模块已加载时挂在地图上，位置见下面"叠放"；其余时候撤下。撤下不释放 GPU 资源，同 Cesium 暂停时的做法。
- 三维内容在显示二维期间不应用，切回三维再应用；`sceneStatus` 只在三维时报告，二维时为空。
- **读数**：三维时 `eyeHeight()` 是 MapLibre 相机在海平面以上的高度（`getCameraAltitude`，墨卡托、地球都是 MapLibre 自己算的），`heading()` 是方位角规整到 0～360；二维时都是 `null`。地下的抬高（3C.3）要在这里减掉。

## 叠放（3C.2）

MapLibre 里叠放只由图层顺序决定（6.12 源码）：第一个三维层（模型层）以下的图层用深度做不透明优化、被模型挡住；以上的图层不做深度测试，直接画在模型上面。渲染器画完还清了深度。所以只能在图层列表里选一个位置。

- 页面在 `provideMap` 里用 `sceneBelow` 声明模型层叠在哪个分组下面；不写时在最上面。`StyleModel` 算出快照的 `sceneBefore`（这个分组及以上的第一个图层），视图按已应用的快照 `addLayer(layer, before)`，增量命令以后 `moveLayer` 挪回原位：样式命令按下一个图层插入新图层，下面分组新加的图层会落在模型层上面。Cesium 不看这一项，覆盖物照旧按 ADR 0080 镜像。
- 现状底图取 `basemap-labels`：底图、资源图层、选中高亮、区划遮罩被模型挡住；地名注记、行政区边界、区划高亮、测量画在模型上面。遮罩放在模型上面的话，区划内的楼高出来的部分会被区划外的遮罩盖住。和 Cesium 大体一致：Cesium 的贴地线贴在模型表面，点不做深度测试，面只贴地表。
- 测量不计高度（ADR 0080 第 3 节）：在楼顶上点的顶点画在楼顶这个经纬度的地面上，俯视以外有视差，Cesium 也一样。

## 能力声明和三维里的识别（3C.2）

- `MAPLIBRE_ENGINE.capabilities` 是 `{ styleLayers: true, identify: true }`，Cesium 都是 false；上下文给出 `sceneCapabilities`（[map-vue.md](map-vue.md)"三维引擎的注入"）。
- 现状底图：三维且 `!styleLayers` 时图例只有"三维模式暂不显示资源图层"的说明、不显示"全部恢复默认"；三维且 `!identify` 时点/框选不识别、提示"三维模式暂不支持点/框选"（ADR 0080 第 5 节，Cesium 不变）。
- 能识别时沿用 ADR 0048、0049 给三维定的规则，不改识别的代码：能后端识别的资源查后端，其余用渲染要素（`identifyStep` 的"后端拾取不到时退回渲染要素"）。MapLibre 的三维有渲染要素，二维 14 级以上只用渲染要素的规则在三维不用：俯仰大时远处是低级别的瓦片，以画面中心的级别为准不可靠。

## 加载失败和重试（3C.2）

- 视图对外的 `state`、`failure` 按当前种类给出：地图本身就绪时，二维就是 `ready`；三维在三维模块加载中是 `initializing`，加载失败是 `failed`，原因是 `{ kind: 'module', error }`。地图自己没就绪、暂停时照旧。
- 三维模块加载失败只让三维失败：切回二维照常可用，三维内容不应用、`sceneStatus` 为空；再切回三维不自动重新加载（同 Cesium 的三维画布）。
- 上下文的 `retry()` 遇到 `module` 时调用视图的 `retry()`，只重新加载三维模块，不重建 MapLibre 地图；`engine` 照旧由画布重建视图。提示由 `describeMapStatus` 给出"三维无法显示"和"切回二维照常可用"，可以重试。
- 下载模块、创建渲染器任一步出错都算这次加载失败；释放以后到的结果不再使用。

## 预加载（3C.2）

同 ADR 0091 的做法：`MapCanvas` 在二维第一次画面稳定以后，把 `MAPLIBRE_ENGINE.loadRenderer` 交给 app 注入的 `MAP_RUNTIME_PRELOAD`，浏览器空闲时下载 map-three 和 three（约 120 KB + 585 KB，压缩前），省流量模式跳过。等待期间切到三维、画布卸载时作废。

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

- **拾取**：先拾取模型：按最近一帧每个瓦片集的裁剪矩阵打射线，取最近的命中（各局部系的距离都是米、起点相同，可以直接比较）。射线由裁剪矩阵的逆直接算出近处、远处两点，不用拆出的相机位置：地球投影的过渡段是两个投影的插值，拆出的位置不是真正的投影中心，测得往返偏 1.4 像素；命中点从局部系换回地心坐标再换成经纬度和椭球高。视图在三维时先拾取模型（`surface: 'model'`，带 `height`），打不到再看射线打不打得到地面：俯角大时地平线以上是天空，地球投影时球外也是，这时是 `miss`（MapLibre 的 `unproject` 仍会给出一个地面上的点，框选的角、状态栏的经纬度会算错）；打得到时用 `unproject`（`surface: 'map'`）。
- **投影**：不在地面上的点（给了非 0 的 `height`）按最近一帧的投影算：锚点放在这个点的经纬度上，局部系的 (0, height, 0) 乘裁剪矩阵；在相机背后、地球背面时为 null，还没画过时也为 null。地面上的点用 MapLibre 的 `project`，两者相差不到 0.1 像素（PoC）；在地球背面时为 null。
- 拾取—投影往返的误差在测试里小于 1 像素：墨卡托 z17、地球 z10.5、过渡段 z11.6 都测了。
- 打不打得到地面、点在不在地球背面、相机高度用 MapLibre 相机的变换（`map._camera.transform`）：6.12 没有公开的方法，前两项在类型里标了 `@internal`。只在 `MapLike` 的 `CameraTransformLike` 里声明、经 `cameraTransform()` 一处读取，换投影时整个换掉、每次现取；升级 MapLibre 时由契约测试发现变化。

## GL 上下文丢失

MapLibre 丢失上下文时销毁样式和自定义层，恢复后重新加载样式，但不会自动加回自定义层（6.12 源码里有警告）。

- 丢失时（地图的 `webglcontextlost`）渲染器丢掉 `WebGLRenderer`：它跟踪的 GPU 资源随之作废，瓦片集、模型这些内容保留。
- 恢复后样式重新加载（`style.load`），视图把模型层重新加上，`onAdd` 时建新的 `WebGLRenderer`，画的时候重新上传几何体和纹理；瓦片从缓存取，缓存里没有的重新下载。
- 瓦片集的状态一直是 `ready`，不重新报告。

## glTF 和骨骼动画

`AnimatedModel` 加载一个 glTF（`GLTFLoader`）并播放它的全部动画（`AnimationMixer`，按真实时间推进），局部系锚在放置点；有动画时每帧请求重画。现在只有测试用到（渲染器的 `addModel`），3C.3 的第三人称人物用它，那时再进 `SceneRenderer` 接口。

## 测试

- `map-core`：`SceneTilesetSync`、`MapLibreScene`（假地图、假渲染器：模块的加载和失败、模型层的位置）、`MapLibreView` 的种类切换（投影、俯角上限和相机的顺序，按种类的状态、重试、读数、天空和地球背面）、`StyleModel` 的 `sceneBefore`，普通测试。
- `map-three`：`three-scene-renderer.browser.test.ts`，真实的 MapLibreView、MapLibre 和 Three，模型在内存里生成（`GLTFExporter`），只用 `https://fixture.test/` 的假地址（拦下 `fetch`）：拾取—投影往返、就绪时建议的相机、glTF 骨骼动画让画面变化、GL 上下文丢失和恢复，以及**逐帧检测**：
  - 每一帧在画布中心和四周 100 像素处读像素（绘制缓冲是保留的），全是清屏色（全透明）算空白帧；模型层挂着时，地图每画完一帧（`render` 事件里渲染器的 `endFrame`）再读画布中心，不是模型的红色算没画出模型
  - 二三维切换（z16 俯仰 60、z9 俯仰 30）、缩放穿过 z12（逐级 0.25 跳 13.5 → 10 → 13.5，再飞过去飞回来）：都没有空白帧，三维的每一帧都画出模型。改坏渲染器、让它像 `maplibre-gl-three` 一样在过渡段不画时，缩放的用例报 27 帧没画出模型
- `map-vue`：`scene-contract.browser.test.tsx`，两种引擎的契约测试（ADR 0147 第 3 节），同一组用例分别跑真实的 Cesium 和 MapLibre + Three；夹具是 `src/testing/scene-fixtures` 的文本瓦片集。覆盖三维内容的增删、状态、失败和重试；相机读写和定位（会话的相机、投影到画布中心、朝向、两种引擎的视点高度在同一范围）；拾取—投影往返；维度切换（种类、相机、`maplibre` 下是同一块画布）；能力声明和三维里的渲染要素一致。只有 `maplibre` 的：叠放（注记画在模型上面、模型挡住资源）、三维模块加载失败和重试、GL 上下文的丢失和恢复。漫游的契约在 3C.3。
- 冒烟：`apps/yzt/tools/smoke/scene-maplibre.spec.ts`，只在 `VITE_MAP_3D_ENGINE=maplibre` 的内网产物上运行（`scene.spec.ts` 反过来只在 `cesium` 上）：二维稳定后预加载了 map-three 的分块，切到三维还是同一块画布、没有 Cesium，静态底图在三维里画出来，测距、坐标定位的图钉和卡片可用，生成的屋子能加载、定位，回到二维；整个过程不请求 `cesium/` 和 map-cesium 的分块。CI 在 `maplibre` 的内网构建之后单独跑这个文件（[ci-workflow.md](../config/ci-workflow.md)）
- 夹具的瓦片集都是"根节点分组、下面一个带内容的叶节点"：只有一个叶节点时 `prepareTileset` 把整个瓦片集的误差整理成 0，Cesium 不会加载（见 `docs/backlog.md`）。
- 这台开发机只有软件 WebGL：画面、性能、逐帧检测在真实显卡上的表现没有验证，性能验收按 ADR 0147 第 8 节在 3C.4 用生产包测。

## 还没做的

- 3C.3：地下（模型抬高，ADR 0147 第 4 节）、步行、路线漫游、室内地图、`uFog`、第一人称要的缩放上限。`maplibre` 下漫游的入口还在，但现在不起作用；那时在能力声明里加 `roam`，按它显示入口。
- 3C.4：自适应缓存、上传预算，测量页改为测这个包。
