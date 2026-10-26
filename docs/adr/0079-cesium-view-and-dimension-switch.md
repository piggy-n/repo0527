# 0079. Cesium 运行时、三维视图与二三维切换

- 状态：已接受
- 日期：2026-10-26
- 修正 ADR 0002 中 Cesium 的版本（1.145.0 改为 1.146.0）；落实 ADR 0020、0024 留给三维的部分和 ADR 0061 第 1 节的运行时注入

## 背景

ADR 0078 定了三维阶段的范围和交互，本 ADR 定 3D.1 的技术方案。已有的决定：

- 会话是二三维共同的唯一真相源，Cesium 镜像会话状态，不实现二维的引擎接口（ADR 0020）
- 二三维共用生命周期、相机、输入、拾取、投影、渲染要素查询这几个视图接口；相机事件带 `view` 和 `cause`；精确的三维视角在"切走期间二维只有同步"时还原（ADR 0020 第 5 条、ADR 0024）
- 三维的样式表达式用 `@maplibre/maplibre-gl-style-spec` 求值；实现镜像前先写出支持清单，不支持的按清单降级（ADR 0024 第 10 节）
- 地图运行时由 app 懒加载；运行时注入 map-vue 等到第二个框架（ADR 0023、0061）
- map-vue 只能用动态 `import()` 引用 map-cesium，依赖方向已在 lint 里配好（ADR 0006）

调研到的事实（2026-10-26）：

- Cesium 1.146.0 于 2026-10-01 发布，由 `@cesium/engine` 26.4.0、`@cesium/widgets` 16.3.0 和新拆出的 `@cesium/core` 0.1.0 组成。1.145.0 写的依赖是 `@cesium/engine ^26.3.0`，现在安装会解析到 26.4.0，包里预编译的 Worker 和主线程的引擎差一个版本
- Cesium 运行时要从基础地址加载 `Workers`、`Assets`、`ThirdParty`（合计约 7 MB，按需请求）。基础地址可以用全局变量 `CESIUM_BASE_URL`，也可以用有文档的 `buildModuleUrl.setBaseUrl`，后者没有出现在类型声明里
- `CesiumWidget` 默认请求 Cesium ion 的全球影像，传 `baseLayer: false` 后不请求；地形默认是椭球，不请求网络
- MapLibre 6 的竖直视场角默认 36.87°，和旧项目对齐 Mapbox 时用的值相同；Cesium 默认 60°（宽屏时是水平视场角）
- 旧 `CesiumEngine` 的相机换算：缩放级按 512 像素瓦片换算成每像素米数，再按视场角换成相机到目标点的距离；方位和俯角在目标点的东北天坐标系里解算，正俯视时俯角抬高 0.01° 保住方位。注释记录了直接读 `camera.pitch` 来回切换会漂 3° 的实测

## 决定

### 1. 依赖

- `cesium` 精确锁定 1.146.0：同一次发布的引擎、Worker 和 `@cesium/core` 一致。新包都没有安装脚本，`allowBuilds` 不用改
- 只用具名导入；只有 `libs/map-cesium` 和 `app` 能导入 `cesium`，由 lint 的 `no-restricted-imports` 检查，和 maplibre-gl 一样（ADR 0024 第 9 节）
- 静态资源用 `vite-plugin-static-copy`（4.1.1，支持 Vite 8）把 `cesium/Build/Cesium` 的 `Workers`、`Assets`、`ThirdParty` 复制到产物的 `cesium/`，开发服务器同样提供。这是 Cesium 官方 Vite 示例的做法，不自己写复制插件

### 2. 三维运行时

- app 的地图框架扩展为 `'2d' | '3d'`；三维的运行时引入 `CesiumWidget` 的样式表，并调用 map-cesium 的 `setCesiumBaseUrl` 设置基础地址（它用 `buildModuleUrl.setBaseUrl`，类型由 map-cesium 用模块扩充补上，Cesium 的细节留在 map-cesium 里）。不往 `window` 上写 `CESIUM_BASE_URL`
- 运行时由 app 注入 map-vue：map-vue 提供注入键 `MAP_RUNTIME`，app 的 `withMapRuntime` 给地图页包一层组件，`provide` "加载某个框架的运行时"的函数；三维画布第一次需要时调用它。页面不知道运行时的存在
- 不在 `main.ts` 里用插件全局提供：插件要从 `@yzt/map-vue` 导入，map-vue 的上下文连带 maplibre-gl，会被构建检查拦下（入口包里不能有 maplibre-gl，ADR 0023）。包装的那一层和地图页一起动态加载，只有地图页用得到
- 默认框架仍是二维，登录页不预加载 Cesium；第一次切到三维时同时加载运行时和 map-cesium 的分块。是否预加载在 3D.5 用 `measure:map-load` 实测后决定（ADR 0061 第 6 节）

### 3. map-cesium 的分层

| 模块 | 职责 | 测试 |
|---|---|---|
| 纯函数（相机的数值换算、样式到影像图层的规划、子域名模板） | 不导入 Cesium | 普通测试（node） |
| `CesiumScene` | 唯一调用 Cesium 的门面：创建 `CesiumWidget`、影像图层、相机的读写和动画、拾取、投影、画布上的指针事件、手势与光标、渲染与尺寸 | 浏览器测试，用真实的 Cesium |
| `CesiumView` | 实现 `MapView`：订阅会话、生命周期、相机的同步与精确还原、工具输入、数据源错误 | 普通测试，注入实现窄接口 `SceneLike` 的假场景；用 `expectTypeOf` 检查 `CesiumScene` 满足它 |

和 MapLibre 适配器的做法一致（ADR 0024、AGENTS.md"测试"）：Cesium 的 API 面很大，窄接口放在 `CesiumScene` 的边界上，而不是给 Cesium 的每个类写假对象。

### 4. 相机

- 换算保留旧 `CesiumEngine` 的算法并补上类型：缩放级与距离的互换按 512 像素瓦片；Cesium 的竖直视场角对齐 MapLibre 的 36.87°（宽屏时换成对应的水平视场角）；中心是画布中心对着的地面点；方位、俯角在目标点的东北天坐标系里解算；正俯视时俯角抬高 0.01°，读回时归零
- 当前显示的视图写会话：用户拖动、缩放开始时开始一次相机操作（ADR 0038），移动中按 `user` 写入；`flyTo`、`fitBounds` 引起的移动按 `program` 写入；切换回来时把会话的相机同步过去，按 `sync` 写入
- 精确还原（ADR 0020 第 5 条）：离开三维时记下 Cesium 相机的位置和朝向；暂停期间会话的相机只有 `sync` 的变化时，回来后还原这个精确的相机，否则按会话的相机重新换算
- `fitBounds` 的留白：三维没有统一的 padding，按画布尺寸把留白折算成范围的放大比例后定位

### 5. 拾取与投影

- 先拾取模型（3D Tiles 等）：命中时用深度取位置，表面是 `model`，带高度；再沿视线和地球求交，本阶段没有地形，表面是 `ellipsoid`；都没打到时是 `miss`，不退回到别的表面（ADR 0024 第 2 条）
- 投影用 `SceneTransforms.worldToWindowCoordinates`，点在地球背面或相机背后时返回 `null`（ADR 0024 第 7 条）
- 渲染要素查询返回空数组（ADR 0047 第 4 节）

### 6. 输入与工具

- 画布上的指针事件按二维的格式（屏幕坐标、按键、修饰键、连击次数）交给会话的工具模型；只在视图就绪时转交
- 工具声明的手势映射到 Cesium 的相机控制：`dragPan` 对应左键拖动（地球上是旋转），`doubleClickZoom` 本来就没有，`boxZoom` 三维不支持；光标照工具的声明设置到画布上
- 修饰键临时平移（ADR 0056）在 3D.2 随测量一起实现

### 7. 样式镜像的支持清单

| 二维的数据源 / 图层 | 三维 | 步骤 |
|---|---|---|
| `background` 图层 | 地球的底色（`background-color` 取常量） | 3D.1 |
| `raster` 数据源（`tiles`，Web 墨卡托）与 `raster` 图层：`raster-opacity`、`visibility`、数据源的 `minzoom` / `maxzoom` / `tileSize` | 影像图层，按样式里图层的顺序叠放；多个子域名的地址合成带 `{s}` 的模板 | 3D.1 |
| `geojson` 数据源与 `line`、`fill`（限定为面）、`circle` 图层 | 贴地的线、面和点；表达式和过滤条件用 style-spec 求值 | 3D.2 |
| `vector`（MVT）数据源及其图层 | 不支持，本阶段跳过（ADR 0078 第 1 节） | — |
| 其他类型（`symbol`、`fill-extrusion`、`heatmap`、`hillshade`、`raster-dem` 等）和清单外的属性 | 不支持，跳过或取默认值 | — |

不支持的图层由视图通过 `onUnsupported` 回调报告，每个图层每个视图一次；页面在开发环境下打印提示（库里不读取环境变量）。

### 8. map-vue 的多视图与切换

- 上下文增加当前视图的种类 `dimension`（`ViewKind`）和 `setDimension`；每个画布组件把自己的视图按种类挂上，同一种类只能有一个
- 对外的 `view`、`viewState`、`failure`、`sourceErrors`、指针都只反映当前种类的视图；不是当前种类的视图暂停。页面被缓存而停用时（ADR 0063），所有视图都暂停
- 相机操作等"当前视图就绪"：切换种类和替换视图一样，等待中的操作在新的当前视图就绪后执行（ADR 0039 第 3 条）
- 三维画布 `CesiumCanvas` 和二维的 `MapCanvas` 并列放在页面里。第一次切到三维时才加载运行时和 map-cesium 并创建视图；加载期间三维的状态是 `idle`，页面照常显示加载提示；加载失败时挂上一个处于引擎失败状态的视图，`retry()` 重新加载
- 不是当前种类的画布隐藏（不占位），恢复时视图先按容器调整画布
- 三维期间二维视图暂停但保留（ADR 0020 第 7 条），切回时不用重建；代价是同时占着两个 WebGL 上下文，3D.5 再评估

## 后果

- 好处：三维视图和二维视图实现同一个接口，页面上的定位、默认视角、区划定位、坐标定位不用为三维另写
- 好处：Cesium 只在 map-cesium 和 app 里出现；纯函数和视图的状态机能在 node 下测试，真实引擎的行为在浏览器测试里验证
- 代价：第一次切到三维要下载 Cesium（主包分块较大，另有按需的 Worker 和资源），切换会等这次下载；产物多出约 7 MB 的静态资源
- 代价：`buildModuleUrl.setBaseUrl` 不在类型声明里，靠模块扩充补上；升级 Cesium 时要核对它仍然存在
- 待定：覆盖物镜像的细节（3D.2）、3DT 与漫游（3D.3、3D.4）、Cesium 是否预加载、三维期间二维是否继续保留（3D.5）
