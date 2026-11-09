# map-cesium：三维视图

`packages/map-cesium`（`@mx/map-cesium`）是二维 MapLibre 适配器的三维对应：一个实现 `MapView` 的 `CesiumView`，镜像会话的样式（栅格底图和 GeoJSON 覆盖物）、同步相机、把画布上的输入交给工具（ADR 0020、0024、0079、0080）。三维阶段的范围与交互见 ADR 0078，分步计划见 [roadmap](../archive/roadmap.md)"三维阶段的范围与取舍"。

## 结构

| 文件 | 内容 | 是否导入 Cesium | 测试 |
|---|---|---|---|
| `camera-math.ts` | 缩放级与距离互换、视场角对齐、正俯视与方位的处理 | 否 | node |
| `camera-fit.ts` | 和二维一样的取景：`fitBoundsCamera`、带留白定位的 `paddedCenter` | 否 | node |
| `url-template.ts` | 数据源的多个瓦片地址合成带 `{s}` 的模板 | 否 | node |
| `scene-style.ts` | `planSceneStyle`：样式 → 影像图层、地球底色、覆盖物图层、不支持的图层 | 否 | node |
| `overlay-update.ts` | `movableInPlace`：图层再次推导时能不能只换坐标（样式、个数不变，线和面不超过 500 个点，ADR 0082）；`sameCoordinates`：形状的坐标没变（ADR 0099） | 否 | node |
| `overlay-plan.ts` | `planOverlays`：覆盖物图层和数据 → 形状（按整级求值样式、简化到半个像素、遮罩外环收成方框、去掉重复点；`symbol` 图层的文字，ADR 0146） | 否 | node |
| `scene-like.ts` | 窄接口 `SceneLike`、`ScenePose`、`TilesetOptions`、`WebGLUnavailableError` | 否 | — |
| `cesium-view.ts` | `CesiumView`：生命周期、相机同步与精确还原、样式镜像、覆盖物数据的下载、工具输入与临时拖动、数据源错误、视点高度、三维内容 | 否（只依赖 `SceneLike`） | jsdom，注入假场景 |
| `cesium-scene.ts` | `CesiumScene`：唯一调用 Cesium 的门面 | 是 | 浏览器，真实 Cesium |
| `scene-tilesets.ts` | `CesiumScene` 用的瓦片集：Blob 地址创建、参数、头灯光照、首批瓦片与失败的事件 | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-underground.ts` | `CesiumScene` 用的钻地：占地矩形、地表透明、土层与背景、退出时飞回地表上方 | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-route.ts` | `CesiumScene` 用的路线漫游：飞到起点、逐帧推进与平滑朝向、暂停时拖动转头、室内视场角、结束时还原（ADR 0083） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-walk.ts` | `CesiumScene` 用的步行：选出生点、飞进站内、键鼠、深度拾取与遮挡、闪切、悬停光标、逐帧按 `WalkRig` 设相机（ADR 0086、0090） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-walk-avatar.ts` | 第三人称的人物（`WalkAvatar`）：用到时才加载、步态、头灯光照、淡入淡出（ADR 0090） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-walk-marker.ts` | 点击移动的落点光环（自定义材质的平面图元） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-blackout.ts` | 路线和步行共用的闪切黑幕：全黑时挪相机；`cut` 近处（不到 2 米）直接挪、远处先黑下来（ADR 0103） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-roam-camera.ts` | 路线和步行共用的接管相机：记下开始前的相机、关掉相机控制（每帧守着）、交还时飞回，换手时交给下一个 | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-steady-camera.ts` | `holdCameraSteady`：相机静止时撤销 Cesium 自己的舍入漂移（见"相机的舍入漂移"） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `runtime.ts` | `setCesiumBaseUrl` | 是 | 由 app 的测试覆盖 |

`CesiumView` 不导入 Cesium，靠构造参数 `createScene` 拿到场景：真实的是 `createCesiumScene`，测试换成假场景。`cesium-view.test.ts` 用 `expectTypeOf<CesiumScene>().toExtend<SceneLike>()` 检查真实的门面满足窄接口，和 MapLibre 适配器的 `MapLike` 一样（ADR 0079 第 3 节）。

只有 `packages/map-cesium` 和 `app` 能导入 `cesium` 和 `@cesium/*`，由 lint 检查（[oxlintrc.md](../config/oxlintrc.md)）。map-vue 只能用动态 `import()` 引用本模块。

## 运行时

- Cesium 运行时要从基础地址加载 `Workers`、`Assets`、`ThirdParty`：`vite.config.ts` 用 `vite-plugin-static-copy` 把它们复制到产物的 `cesium/`，开发服务器和测试同样提供（[vite-config.md](../config/vite-config.md)）
- `setCesiumBaseUrl(url)` 调用有文档、但类型声明里漏掉的 `buildModuleUrl.setBaseUrl`，类型用模块扩充补上；不往 `window` 上写 `CESIUM_BASE_URL`。升级 Cesium 时核对它仍然存在
- app 的三维运行时（`app/map-runtime-3d.ts`）引入 `CesiumWidget` 的样式表并调用它，基础地址是 `${BASE_URL}cesium/`。map-vue 的 `CesiumCanvas` 第一次切到三维时，同时加载这个运行时和本模块（[map-vue.md](map-vue.md)"三维画布"）

## 场景的设置

`CesiumScene` 创建 `CesiumWidget` 时：

- `baseLayer: false`：不请求 Cesium ion 的全球影像，底图全部来自样式镜像；地形是默认的椭球，不请求网络
- `skyBox: false`（星空要额外贴图），保留着色器画的天空大气；`showGroundAtmosphere` 关掉，免得影像蒙上一层颜色
- `requestRenderMode: true`：只在场景变化时渲染；改影像、底色、相机后调用 `requestRender`；瓦片集按显存调整屏幕误差期间也请求渲染（见下文"瓦片集的显存预算"）；相机静止时撤销 Cesium 自己的舍入漂移，否则有些姿态停不下来（见下文"相机的舍入漂移"）
- 版权信息放进一个不在文档里的元素（署名由页面决定，ADR 0053 第 5 节）；`showRenderLoopErrors: false`，渲染出错时由视图进入引擎失败
- `camera.percentageChanged` 设为 0.001，相机每一帧的变化都报告，状态栏和浮层跟得上

## 相机

### 换算（沿用旧 `CesiumEngine`，ADR 0079 第 4 节）

- 缩放级是 MapLibre 的口径（512 像素瓦片）：每像素米数 = 78271.517 × cos(纬度) / 2^zoom；相机到画布中心地面点的距离 = 每像素米数 × 画布高度 / 2 / tan(竖直视场角 / 2)
- 竖直视场角对齐 MapLibre 6 的默认值 36.87°；Cesium 的 `PerspectiveFrustum.fov` 在宽屏时表示水平视场角，按宽高比换算（`frustumFov`），画布尺寸变化时重新设置
- 写入：目标点是会话相机的中心，`lookAt` 加 `HeadingPitchRange` 放相机，再解除 `lookAt` 的锁定
- 读回：中心是画布中心沿视线打到椭球上的点；方位和俯角在目标点的东北天坐标系里解算，不直接读 `camera.heading`、`camera.pitch`（它们相对相机所在位置的水平面，倾斜时和目标点差一个张角，旧项目实测来回切换会漂 3°）。看向天空时退化成相机正下方
- 俯角正好为 0 时方位编码不进相机的姿态，写入时抬高 0.01°，读回时归零；方位离 360° 小于 1e-6° 时归零
- 浏览器测试检查写入和读回互逆（中心 1e-6°、缩放级 1e-6、方位和俯角 1e-3°）

### 谁在移动相机

| 移动 | 写回会话的 `cause` |
|---|---|
| 视图自己定位：`flyTo`、`fitBounds` | `program` |
| 视图恢复时把会话的相机同步过来 | `sync` |
| 路线漫游的移动，包括暂停时拖动转头（ADR 0083）；步行的移动（ADR 0086） | `program`，不开始新的相机操作 |
| 其余的移动（用户拖动、滚轮） | `user`，第一次变化时开始一次新的相机操作（ADR 0038） |

视图在发起定位前记下这次移动的 `cause`，相机停下（`moveEnd`）后清空；用户在画布上按下鼠标、滚动滚轮时，进行中的定位停下，接下来的移动按用户操作处理。

### 暂停与精确还原（ADR 0020 第 5 条）

- 暂停：进行中的定位直接到终点，按 `program` 写回；记下 Cesium 相机的位置和朝向（`ScenePose`），停止渲染循环
- 暂停期间会话的相机出现 `sync` 以外的变化（二维里用户移动、程序定位过），记下的相机就作废
- 恢复：先按容器调整画布，追上暂停期间的样式变化；能还原就还原记下的相机，并按换算后的值以 `sync` 写回会话；否则按会话的相机定位
- 页面被缓存时（ADR 0063）画布让视图暂停：渲染循环停下，路线漫游、步行都不再推进（每帧按流逝的时间推进，一帧最多按 0.1 秒，回来不跳一大段），步行忘掉按着的键、拖动和悬停；进站飞行中切走，回来以后照样进到站内。3D.5b 在真实页面上逐项验证过，见 [layout.md](layout.md)"页面缓存"

### 定位

- `flyTo` 的 `padding` 只决定这一次把目标放在哪里（ADR 0037）：去掉四边留白后的区域中央相对画布中心的偏移，按方位角转到地图上，再按这一级的比例换成经纬度（`paddedCenter`）
- `fitBounds` 按二维的取景算出相机（Web 墨卡托、512 像素瓦片，范围放进去掉留白的画布、方位归零），再交给三维相机；所以定位后画布中心的地面比例和二维相同。俯角不传时保持当前的

### 相机的舍入漂移

- 现象：相机停下以后，有些姿态每秒还要重画几帧，一直停不下来；Cesium 要相机 0.5 秒没变才触发 `moveEnd`，所以 `cameraidle`、`settle` 也不来。斜视、俯视都有，只有正北朝上的正俯视不会。2026-11-06 在 960 × 640 的画布上实测：63 个倾斜的姿态里 4 个一直停不下来（每秒 3～15 帧），更多的停下后还要再漂一阵。每次重画都要遍历、绘制所有瓦片集，JKQ 这样的大模型很费时
- 原因（Cesium 1.146，读源码并实测）：`camera.changed` 有监听时（`CesiumWidget` 默认数据源的 `EntityCluster` 总在监听），每个 tick 的 `Camera._updateCameraChanged` 都读 `camera.heading` 和 `camera.roll`。这两个 getter 先把相机换到它所在位置的东北天坐标系，算完再换回来（`_setTransform`），每换一次 up、right 差几个最低位（约 1e-16）。`View.checkForCameraUpdates` 用 1e-15 比较相机和上次的副本，漂够了就判定相机变了，重画一帧并重置副本。多数姿态漂几百个 tick 后落到这个换算的不动点上，有些一直漂下去
- 做法（`holdCameraSteady`）：在 `scene.preUpdate` 里（漂移之后、判断相机变没变之前）比较相机和记下的姿态。变换矩阵相同、位置和三个方向都差不到 1e-12（位置按最大分量缩放）时，把记下的姿态写回去；否则记下新的姿态。只用 Cesium 公开的属性和事件，不改它的内部
- 代价：每个 tick 小于 1e-12 的真实移动会被丢掉（地心坐标下约 6 微米、1e-12 弧度），画面上看不出来。惯性的最后一点、逐帧设绝对位置的漫游都不受影响
- 升级 Cesium 时，看"相机停下后场景停下"的浏览器测试；Cesium 改了 getter 或比较方式以后，这一步可能就不需要了

## 样式镜像的支持清单（ADR 0079 第 7 节）

| 二维 | 三维 | 步骤 |
|---|---|---|
| `background` 图层 | 地球的底色，取常量的 `background-color`；没有时用 `#dfe7f2` | 3D.1 |
| `raster` 数据源（直接给出 `tiles`、xyz）和 `raster` 图层 | `UrlTemplateImageryProvider` 的影像图层，按样式里的顺序叠放；`raster-opacity` 常量、`visibility`、数据源的 `tileSize`、`minzoom`、`maxzoom` | 3D.1 |
| `geojson` 与 `line`、`fill`、`circle` | 贴地的线、面，屏幕上固定大小的点；清单见 ADR 0080 第 1 节 | 3D.2 |
| `vector`（MVT） | 不支持（本阶段，ADR 0078 第 1 节） | — |
| 其他类型、清单外的属性和写法（TileJSON 地址、`{quadkey}` 等占位符、图层的级别范围、表达式） | 不支持 | — |

- 每次样式变化时整份推导（`planSceneStyle`），场景按图层 ID 增删改：瓦片来源（地址、子域名、瓦片尺寸、级别范围）变了才换图层，透明度、显隐直接改
- 天地图 `t0`～`t7` 的 8 个地址合成 `https://t{s}.tianditu.gov.cn/...`，子域名按原来的顺序
- 不支持的图层通过 `onUnsupported` 报告，每个图层每个视图一次；库里不读环境变量，页面在开发环境下打印
- 影像瓦片的加载错误按二维的数据源 ID 记在 `sourceErrors`，每个数据源记第一条，数据源移除时忘掉（ADR 0041）

## 覆盖物（ADR 0080）

- 分两步：`planOverlays` 从覆盖物图层、数据和整数级别推导出和 Cesium 无关的形状；`CesiumScene.setOverlays` 按形状增删改 Entity（贴地的线 `clampToGround`、按地表分类贴地的面、不被地球遮挡的点），贴地的线和面按样式里的顺序设 `zIndex`
- 过滤条件用 style-spec 的 `featureFilter`，样式属性用 `normalizePropertyExpression` 按要素求值；只求三维用到的属性，写错的属性取默认值，不影响其他属性
- 级别按 `Math.round(zoom)` 取整，换了一级才重新推导；漫游时不按级别重新推导（ADR 0103）：相机在地下，画布中心的视线从椭球内部穿出，级别随视线上下在 3～26 之间跳，每跳一级重建一次省界的贴地线，Worker 会分配内存失败（`Array buffer allocation failed`）；图层、数据、级别和位置都没变时给出上次的结果对象，场景按对象判断哪些图层不用重画
- 线和面按这一级的半个像素简化（`simplifyTolerance`）：省界 2 万个点的贴地线要几秒才建好，简化后 6 级约 1 千个点
- 图层的 `metadata` 用 `overlayDetailMetadata(level)`（`@mx/map-core`）写了细节上限时，按 `min(当前级别, 上限)` 求值样式和简化，超过上限后还是同一个结果、不重建；级别范围仍按实际级别判断。只给铺满大范围、只做背景的图层用，现在只有静态底图（11 级，ADR 0135）
- 软件渲染下，有贴地的大面时第一批帧很慢，主线程卡在同步的 `readPixels` 上（退出漫游后实测 20 秒左右），开发机和 CI 上都要算进等待时间；真实显卡上没有实测（ADR 0135）
- 外环横跨整个世界的面（区划遮罩）收成方框（`shrinkWorldRing`），相邻的重复点去掉（`cleanPath`）：这两种情况都会让 Cesium 停止渲染
- 样式不变、形状个数相同、线和面合计不超过 500 个点时只改坐标：第一次改时把坐标换成每帧读取的属性，测量画线时不重建。每帧读取的贴地线和面每帧都在主线程上重建几何，边界跨级重新简化时如果也走这条路，13 级左右一帧要几百毫秒，所以点多的照常重建（ADR 0082）
- 只换坐标时坐标没变的形状不动；换了坐标的线和面停下 0.5 秒后改回静态的实体（旧的留到新的画好）。每帧读取的实体 Cesium 每帧重建、要求再画一帧，不改回的话场景一直重画，`requestRenderMode` 停不下来（ADR 0099）
- 要重建的图层，旧的实体留到新加的全部画好再移除，不会空白：看 `clock.canAnimate`（`CesiumWidget` 每帧写入这一帧 `dataSourceDisplay.update` 的结果）。不能看 `dataSourceDisplay.ready`：它第一次就绪后一直为 `true`（ADR 0082）
- 数据源的 `data` 是地址时由 `CesiumView` 下载，按地址缓存；下载或内容不是 GeoJSON 时按数据源 ID 记错误，地址不再被引用时忘掉，再次引用时重新下载；视图释放时取消下载。下载函数由构造参数 `loadJson` 换掉（瓦片集的索引也用它），测试不发网络请求
- 文字（ADR 0146）：`symbol` 图层有 `text-field` 时推导出 `LabelShape`，只有图标的仍然报告为不支持。`CesiumScene` 画成 Entity 的 `label`：字体取画布容器继承的 `font-family`（包不知道应用的字体令牌），描边宽度是 `text-halo-width` 的两倍，垂直居中；深度测试用默认值，相机倾斜时不被地球切掉（浏览器测试检查），漫游时会被模型挡住。不做避让。跨级再推导时文字和样式没变就不重建，透明度变了走重建
- 画面稳定（`settle`）要等影像瓦片和覆盖物都画好

## 拾取与投影

- `pick`：先 `scene.pick`，打到 3D Tiles 时用 `pickPosition` 取深度位置，表面是 `model`，带高度；再沿视线和椭球求交，本阶段没有地形，表面是 `ellipsoid`；都没打到时是 `miss`（ADR 0024 第 2 条）。`scene.pick` 要多画一遍拾取缓冲再读像素，状态栏每次相机变化都拾取一次，所以只在有显示着的瓦片集时才做（ADR 0082）
- `project`：点在地球背面（`EllipsoidalOccluder`）或相机背后时返回 `null`，否则 `SceneTransforms.worldToWindowCoordinates`
- `queryRendered` 返回空数组（ADR 0047 第 4 节）

## 输入与工具

- 画布上的 `mousedown`、`mousemove`、`mouseup`、`click`、`dblclick`、`mouseleave` 按二维的格式交给会话的工具模型，只在视图就绪时转交；画布获得焦点时的按键同样转交
- 工具的 `dragPan: false` 关掉左键拖动（`enableRotate`、`enableTranslate`）；光标照工具的声明；临时任务把焦点移到画布上，Esc 才能直接退出
- 按住修饰键临时拖动（ADR 0056 第 2 节、ADR 0080 第 4 节）：和二维共用 map-core 的 `ModifierPan`，规则完全相同。Cesium 的相机控制用指针事件，所以截下同一次按下的 `pointerdown` 和 `mousedown`；平移由 `CesiumScene.panBetween` 绕地心转动相机，按下时抓住的地面点始终在指针下面（转一次再按新的点修正一次，误差不到半个像素）；Cesium 自己的修饰键手势不认 ⌘，Ctrl + 拖动还是倾斜，所以不借用

## 视点高度（ADR 0080 第 6 节）

`CesiumView.eyeHeight()` 是相机在椭球面以上的高度（米），是 `MapView` 的可选能力，二维没有。map-vue 的就绪视图入口 `eyeHeight()` 转给它，状态栏在三维里用它代替比例尺（[shared-map.md](shared-map.md)"状态栏"）。

## 三维内容（ADR 0081）

会话的 `scene`（`SceneContentModel`，见 [map-core.md](map-core.md)）是三维独有的内容：瓦片集和钻地。`CesiumView` 镜像它，和样式一样暂停期间只记下"有变化"，恢复时再应用。

- 按瓦片集 ID 比较：新的加载，不要的移除；地址或 `attempt` 变了先移除再重新加载；其余只改显示和光照（`updateTileset`）
- 加载：`prepareTileset`（map-core，ADR 0085 从这里移过去）整理索引（下载用 `loadJson`）→ `SceneLike.addTileset` 建好并加进场景，返回建议的相机（包围球整个进入画布，俯角 55°）。中止的不报告；索引、建瓦片集、瓦片下载失败都记成 `failed`
- 状态：`sceneStatus`（按 ID 的 `loading`、`ready` 带相机、`failed` 带错误），变化时发 `scenestatuschange`；`ready` 不等第一个瓦片可见，不在画面里的模型也能定位
- 同组（白膜的各种效果）：要显示的那个首批瓦片到位（`tilesetinitial`）前，上一次显示的留着，到了再撤下
- 钻地：`setUnderground` 交给场景，场景按瓦片集的包围球算占地矩形；瓦片集晚于钻地的要求建好时补上
- 场景的做法沿用旧代码：瓦片集参数（`maximumScreenSpaceError` 默认 8，2026-11-09 用户定的、之前沿用旧项目的 16，清单可以按模型改；移动时不请求等；显存预算改过，见下一节）、头灯的 `CustomShader`；钻地时关掉碰撞、近裁剪面 0.1、地表在占地范围内按距离透明、相机在地下时换背景，退出时相机在地下的先飞回离地 120 米再恢复

## 瓦片集的显存预算

每个瓦片集的 `cacheBytes` 1 GB、`maximumCacheOverflowBytes` 1 GB（`scene-tilesets.ts` 的 `TILESET_OPTIONS`）。ADR 0081 沿用旧项目的 384 MB 加 256 MB，比 Cesium 的默认值（各 512 MB）还小，倾斜摄影 JKQ 因此整体模糊、JKQ2 加载后又被删掉、一直循环（2026-11-06 改成 1 GB 加 512 MB）；显卡机器实测 JKQ2 远看时块根就超过 1.5 GB，2026-11-08 用户决定溢出改成 1 GB（见下面"根节点以下"）。

- Cesium 的规则（`Cesium3DTileset` 的 `memoryAdjustedScreenSpaceError`）：显存超过两者之和、而且还有瓦片在处理时，每个 tick 把屏幕误差乘 1.02，并停止处理新瓦片；低于 `cacheBytes` 时每个 tick 除以 1.02，直到回到设定值；在两者之间时不变。不需要的瓦片只卸载到 `cacheBytes` 为止
- 取值：缓存加溢出要放得下视野里最粗一级的全部块，否则 Cesium 涨过根节点的误差后一个瓦片都不画（见"根节点以下"）；缓存要放得下视野里需要的瓦片，否则屏幕误差升上去以后降不回来（显存停在两者之间），画面一直偏糊。本机的 5 个样块：块根约 1 MB，第 1 层约 20 MB，第 2 层约 150 MB，全部细节约 730 MB；贴图是没有 mipmap 的 JPEG，最大 2048 像素。显卡机器实测（2026-11-08）块根平均 7 MB，JKQ2 在 z15 视野里 219 个块根就 1.63 GB，z16 俯视 1.74 GB，近处 1.0～1.4 GB，JKQ 最高 1.66 GB，所以缓存 1 GB、溢出 1 GB。超过上限时 Cesium 照样放大屏幕误差，画面变粗但稳定
- 预算按瓦片集各算各的，同时显示 JKQ 和 JKQ2 最多约 4 GB；RTX 3060（6 GB）实测没问题，核显、小显存的机器有丢失 WebGL 上下文的风险，还没有在这类机器上验证。没有做成环境变量：`VITE_` 变量同样要重新构建，和改这里的常量一样。`claude/map-three-3c1-f9517d` 分支里 `three-scene-renderer.ts` 的缓存常量要同步（它是一个共享的 LRU，不是每个瓦片集一份）
- 按需渲染的配合：Cesium 每个 tick 都调整屏幕误差，卸载瓦片却只在渲染的帧里做。相机不动、两次渲染之间，它会一直涨，下次渲染时整体变粗；根节点没有内容的瓦片集（JKQ2）涨过根节点的屏幕误差后整棵树都不画，瓦片被卸载、屏幕误差回落、重新加载，如此循环。`SceneTilesets` 在每个 tick 的 `postUpdate`（Cesium 调整之后）比较各瓦片集的 `memoryAdjustedScreenSpaceError`，变了就请求渲染，效果和连续渲染相同；稳定以后不再请求
- 根节点没有内容的瓦片集没有更粗的一级兜底：视野里所有块的根加起来超过上限时，仍会整树消失、循环加载（Cesium 连续渲染时也一样）。新加这类模型时按"块数 × 块根的显存"核对预算
- 地板（2026-11-06）：Cesium 的回落条件是显存低于 `cacheBytes`。俯视平地时各块离相机一样远，一级要么全要、要么全不要；放不下的那一级被整级丢掉以后显存远低于缓存，Cesium 立刻每个 tick 除以 1.02 降回设定值，重新加载，再整级丢掉，循环不止（本机模拟：误差设 0.5 或 4、z16 俯视 JKQ2，25 秒里 200～360 个瓦片反复加载，每 2 秒清晰一次、模糊一次）。所以 `SceneTilesets` 在调整后的误差第一次回落时，把瓦片集的 `maximumScreenSpaceError` 定在这个姿态下涨到的峰值（地板），Cesium 不再往下降；之后还超预算照样往上涨，地板跟着峰值走。相机停下（`moveEnd`）时离定地板的位置超过当时椭球高的 25%，或者朝向转过 10°，就放开地板、从设定值重来；`updateTileset` 换了设定值也重来。模拟里同一场景定地板后 0 次重新加载，停在能放下的最细一级（根加一部分第 1 层）。地板是对 Cesium 自带机制的补充，设定值没改。峰值只算这个姿态下看到的上涨（2026-11-08）：显卡报告里设 12、8 时 z17 俯视全程 17，是上一个倾斜姿态涨到的误差带了过来，缓存一卸载 Cesium 开始回落就被钉在那个旧峰值上，比默认的 16 还粗；现在相机离开开始涨的位置（当时椭球高的 25%）或者转过 10° 就从设定值重来，每个 tick 看一次、不等 `moveEnd`（换姿态后不到半秒 Cesium 就开始回落，等它来不及）
- 根节点以下（2026-11-08）：放大的误差涨过根节点自己的屏幕误差时，Cesium 一个瓦片都不画（`selectTiles` 在根节点上就返回）。显卡机器实测 JKQ2 在 z15 俯视时视野里 219 个块根就要 1.63 GB（平均 7 MB 一个，比本机拿到的 5 个样块重几倍），超过 1.5 GB 的上限，Cesium 涨到 2300 以上整个模型消失，地板又把它钉在那里。所以 `SceneTilesets` 把放大后的误差压在根节点屏幕误差（`root._screenSpaceError`，Cesium 每次遍历按到包围盒的距离算好；包围球算的偏大，不能用）的九成以下：已经加载的块继续画，显存超预算就超着，还没加载的不再加载；压住以后 Cesium 每个 tick 还会再涨 2% 又被压回，画的东西没变，不为这个请求渲染（第一版每个 tick 画一帧，45 秒 1107 帧）。显卡机器复测（2026-11-08，1 GB + 1 GB）：z15 俯视视野里 364 个块根、倾斜 461 个，按 8 MB 一个要 2.9～3.7 GB，2 GB 放下 260 个，剩下的不加载，远处少 26%～44% 的块，但模型不再消失、不循环；z16 俯视 1.74 GB 放得下，z17、z18 都在 1.0～1.24 GB。根本的解决是给 JKQ2 生成和 JKQ 一样的顶层（CesiumLab 的选项，JKQ 远看只要 100～150 MB），或者块根换小贴图；预算再加到 4 GB 才放得下全部块根，RTX 3060（6 GB）也勉强
- `TilesetOptions.maximumScreenSpaceError`（可选，默认 8，`DEFAULT_SCREEN_SPACE_ERROR`）：每个瓦片集可以给不同的设定值，来自清单里模型的 `maximumScreenSpaceError`（`features/scene-models` 读进目录，经会话的 `TilesetLayer` 传到场景；诊断页也用它比较取值），现有清单都没写。默认值原来是 ADR 0081 沿用旧项目的 16；2026-11-08 先给经开区（JKQ）单独设 8，2026-11-09 用户看过复测后决定统一用 8，清单只写放不下的例外（写 16）。为什么是 8：俯视时几何误差折成屏幕像素正好是几何误差除以当前级别的米/像素，无锡纬度下 `top/` 单元（14.6）在 16 下显示到 z16.2、块根（CesiumLab 最粗的一级，误差多在 4.4～7.3）显示到 z17.2，所以 16.5 级以上整段看到的都是块根，几何误差 10～14 px，糊的是几何不是贴图；设 8 时块根只显示到 z16.2、之后换第 1 层（约 5 px）；12 对这一段没用（块根显示到 z16.8）。代价是每细一级瓦片数乘 4：俯视 z16.5 估计 1.4 GB 左右放得下，倾斜时很可能超 2 GB、被 Cesium 抬回 12～17（1.5 GB 预算下设 8 的报告里倾斜姿态都停在 13～17），改善主要在俯视和近处。显卡复测（2026-11-09，RTX 3060，桌面 `JKQ/` 的报告）：16 下 10 个姿态都不超预算、俯视的每个姿态结束时都是整级（z16～17 块根、z18 2.5 米一级）；8 下 z15 俯视 737 MB 整级，z16 以上每个姿态显存都到 2.0～2.2 GB、误差被抬到 8.5～14.8，俯视结束时都是一半细一半粗（最粗一级想细分、Cesium 没给它细分），8 秒里加载几百次；设 4 手动 3 分钟加载 12630 次、长任务 741 次。每个瓦片不论哪一级都约 7.7 MB（z16.5 俯视 131 个块根 1.0 GB，z18 俯视 131 个 2.5 米的瓦片也是 1.0 GB），2.5 米一级铺满 z17 俯视约 4 GB、z16.5 约 8 GB，预算再加也放不下，要整级清楚只能让数据侧缩小贴图或开纹理压缩。用户看过后仍选 8 并改成默认值（近处的细节比整级一致重要）；预算不加：Cesium 记的账不包括驱动的开销、二维地图和浏览器自己占的显存，4 GB 显卡和核显上会先掉帧再丢 WebGL 上下文，两个模型同时勾选时预算还要翻倍（[backlog](../backlog.md)）
- 用户在最新 main 上实测（2026-11-06，RTX 3060）仍然看到 JKQ 先清晰后模糊、JKQ2 加载后被删掉一直循环。本机按 Cesium 1.146 的源码逐 tick 模拟（基础遍历、缓存的 LRU、`processTiles` 的提前中断和误差调整、每服务器 18 个请求的调度、按需渲染），用 JKQ2 的真实索引（532 个块）和 5 个实测块：用户截图的三个视角（视点高 614 米俯角 27°、186 米和 116 米俯角 58°）在误差 16 下要 0.5～1.4 GB，都在 1.5 GB 以内，误差根本不调整；旧预算 640 MB 下误差升到 23～28 后稳定，也不循环；只有修复前（不请求渲染）加极快的网络才复现误差飞涨、整树消失。所以设定值 16 下的循环不是预算机制造成的；用户的截图是把误差临时调成 0.5 时截的，模拟里 0.5 在俯视时正是上面的整级循环。要用 `/dev/tileset-probe` 在显卡机器上录下实际读数再定位（见"诊断读数"）

## 诊断读数

`CesiumScene.inspect()` 给开发页一份只读快照（`scene-inspection.ts`），业务代码不用：

- 场景：渲染循环的 tick 数（`postUpdate`）和真正画出的帧数（`postRender`）、渲染出错的次数（WebGL 上下文丢失时每个 tick 一次）、相机变化和停下的次数、画布的绘制缓冲尺寸、`devicePixelRatio`、浏览器报告的显卡（`WEBGL_debug_renderer_info`，同一块画布再取一次上下文拿到的就是 Cesium 建好的那个）
- 每个瓦片集：`cacheBytes`、`maximumCacheOverflowBytes`、`maximumScreenSpaceError`（定了地板时就是地板）、`screenSpaceErrorFloor`、`memoryAdjustedScreenSpaceError`、`totalMemoryUsageInBytes`、`tilesLoaded`、`statistics` 里的选中、遍历、待请求、处理中、就绪、累计加载的计数（`statistics` 和 `memoryAdjustedScreenSpaceError` 一样标成 @private，按类型断言读），以及加进场景以来瓦片加载完成（`tileLoad`）、卸载（`tileUnload`）、失败（`tileFailed`）的累计次数
- 清晰度（`selection`，上一帧画出的瓦片，`tileVisible` 收集、`preRender` 换帧）：每个瓦片的贴图像素数开方除以包围球的投影直径（像素）得到纹素密度，小于 1 贴图比屏幕粗；几何误差除以到包围球的距离、乘上画布高 / (2 tan(竖直视场角 / 2)) 得到屏幕像素数；都按投影面积加权，再给出密度小于 1 的面积占比和最粗一级的几何误差。相机在包围球里的瓦片不算，单个瓦片的面积不超过画布（2026-11-09：JKQ 的报告里密度、几何误差全是 0，是少数瓦片的包围球大到把别的瓦片的权重压成 0，彭城广场正常；改口径前后彭城广场的读数一样，JKQ 要重跑才知道，原因要看它的索引）。肉眼的"先清晰后模糊"看它：细一级换成粗一级、显存不够放宽精度都会让密度下降，而瓦片数可能反而变多（JKQ 的 `top/` 单元换成块根：512 像素贴图换成 256 像素，数量从 1 变 16），只看选中数看不出来
- `createCesiumScene` 返回具体的 `CesiumScene`（`satisfies CreateScene`），开发页才拿得到 `inspect`；`CesiumView` 仍只依赖 `SceneLike`
- 开发页 `/dev/tileset-probe`（`pages/dev/tileset-probe/`）：从清单选一个模型加进真实的场景，按 15、16、16.5、17、18 级（16.5 在倾斜摄影的块根和第 1 层交界附近）、俯视和倾斜各一组的固定相机序列停留，每 250 毫秒记一次读数，连同控制台警告、长任务、上下文丢失一起导出 JSON 和 Markdown 报告；也可以手动操作相机录一段。报告里每个姿态的"清晰→模糊"按纹素密度算（比姿态里的高点低两成以上算一次），"选中数骤降"是旧口径，只在整级被丢掉时才有；屏幕误差可以在页面上改，换模型时先填上清单里这个模型的值（没给是默认的 8），和业务页面一致。2026-11-08 用户在 RTX 3060 上跑了 JKQ、JKQ2 各 6 个设定值的报告，结论见"瓦片集的显存预算"。模型只在服务器上时用 `YZT_3DT_PROXY` 让开发服务器代理 `/3dt/`（[config/local-files.md](../config/local-files.md)）

## 路线漫游（ADR 0083）

会话三维内容的 `roam` 是拥有者的意图（哪条路线、播放还是暂停、速度、第几遍），`CesiumView` 按它驱动场景，场景逐帧推进：

- 换了 `id` 开始新的路线（`startRoute`：从室外飞到起点停住；已经在模型里（从步行换过来、换路线）时不飞，用黑幕闪切过去：Cesium 的 `flyTo` 在起点终点都在地下时总会先升到地面以上再落下，原地不动也一样，ADR 0103），`run` 变了回到起点，`playing`、`speed` 变了改播放；撤掉时结束并飞回开始前的位置
- 进度：场景每帧发 `routeprogress`，视图每变 0.5 米报告一次 `roamStatus`（`{ id, run, distance, total, finished }`），开始、回到起点、到终点（`routeend`）时立即报告
- 路线的几何在 map-core 的 `RoutePath`：按起点的切平面换成米、累计三维长度、朝向看前方 4 米（俯仰最多 ±30°）；眼高 1.6 米；速度是米/秒（2026-10-28 起和步行共用，档位由拥有者定，ADR 0097；原来是 1.6 m/s 乘倍速）
- 场景（`scene-route.ts`）：关掉 Cesium 的拖动和缩放，竖直视场角换成 60°；每帧按真实流逝的时间推进（一帧最多按 0.1 秒），朝向按时间常数 0.4 秒平滑；暂停时左键拖动原地转头，继续后约 0.6 秒转回；场景是按需渲染，播放、转回时每帧请求下一帧
- 页面开始别的定位时路线立即停下、不飞回；暂停期间撤掉的漫游在恢复相机以后结束，相机能还原时才飞回
- Cesium 的 `flyTo` 结束、取消时会在回调之后把相机控制重新打开（`CameraFlightPath` 的 `wrapCallback`，2026-10-27 实测），所以漫游期间每帧关掉；路线每帧都把相机设回路线上，在这之前也看不出来

## 第一人称步行（ADR 0086）

会话三维内容的 `roam` 是 `kind: 'walk'` 时，`CesiumView` 让场景开始步行；行走的规则在 map-core 的 `Walker`，场景只做输入、拾取和相机：

- 意图：换了 `id` 开始新的（`startWalk`），速度变了 `setWalkSpeed`，`respawn`、`unstuck` 的计数变了做一次；撤掉时结束并飞回开始前的位置，光标换回工具的。先报告 `entering`，场景找不到出生点时在 `startWalk` 里就报告 `failed`；飞到出生点后 `walking`；提示（`walknotice`）每来一条计数加 1
- 路线和步行之间换手：开始新的一种时，场景从上一种那里接过开始前记下的相机，结束时回到最初的位置；换手时不飞（ADR 0103），从路线换成步行时 `chooseSpawn` 选脚下的位置，直接落下，出生点远时闪切
- 出生点、行走、点击、脱困的规则见 [map-core.md](map-core.md)"第一人称步行"；场景给 `chooseSpawn` 的是相机位置、椭球面以上的高度、画布中心打到椭球的点和朝向，都换到瓦片集的局部系
- 相机：每帧按 `Walker` 的位置、视点高度和朝向设相机，方向和上方向按局部系的轴换到地心坐标；没变就不设。视场角 60°，滚轮在 20°～75° 之间调；进场飞 2 秒
- 输入：键盘在窗口上（能打字的输入框、下拉和可编辑区域里，按着修饰键时除外；焦点在单选、复选、按钮上照常行走，ADR 0090；切走窗口、页面停用时忘掉按着的键）；鼠标在容器上按捕获阶段拦下，不传到画布。左键点击（按住 300 毫秒内挪动不超过 30 像素，否则 5 像素），右键拖动转向，中键上下拖动和滚轮改视场角
- 点击处的地面用 `scene.pickPosition`；遮挡判断把点投影到屏幕上读那个像素的深度，不在画面里算挡着；悬停光标每 80 毫秒最多判断一次，在节流里的到期再判断
- 闪切：容器里一层黑幕（`Blackout`，和路线共用），160 毫秒变黑、挪过去、260 毫秒亮回来；落点光环正常做深度测试，半透明不写深度
- 步行期间头灯着色器的远处压暗打开
- 室内地图（ADR 0087）：每帧设完相机后，人的位置、朝向、水平视场角或落点变了就发 `walkplayer`，视图写进步行状态的 `player`；`paused` 时忘掉按着的键、拖动和悬停，不再响应键鼠（点击移动的路径照常走完）；`teleport` 的计数变了就闪切到它的位置
- 就绪视图的 `heading()` 是相机的 `heading`（相对相机所在位置的水平面），状态栏的朝向用它

## 第三人称（ADR 0090）

规则在 map-core 的 `WalkRig`、`WalkCycle`、`seeThroughAvatar`（见 [map-core.md](map-core.md)"第三人称"），场景只做相机、输入和人物模型。入口暂不开放：现状底图页的操作条不显示人称切换。

- 意图的 `view` 变了，`CesiumView` 调 `setWalkView` 并把步行状态的 `view` 换掉；开始时 `view`、`avatar` 随 `startWalk` 交给场景
- 相机按 `WalkRig.eye`；进站时臂为 0（飞到眼睛处），落地后再拉出去。滚轮、中键拖动第一人称改视场角，第三人称调远近；切到第三人称时视场角回到 60°
- 点击、悬停和遮挡判断用的深度拾取点，在人物看得见时先 `seeThroughAvatar`；遮挡判断的距离在局部系里比
- `WalkAvatar`：每次步行一个，`alpha` 第一次超过 0.02 时 `Model.fromGltfAsync` 加载，失败报告一次 `avatar-failed`；模型矩阵是局部系里脚下的位置、绕 z 轴转 (π/2 − 朝向)、缩放到 1.72 米高；颜色的 alpha 跟着 `avatarAlpha`；和瓦片集共用 `createHeadlightShader` 的写法（各自一个实例）。步态的相位交给 `animationTime`，`animateWhilePaused` 让场景时钟不走也播；停下时移除动画、各关节设成原始矩阵的副本（设 `undefined` 只复位、不重算蒙皮），重新走起来前设回 `undefined`。Cesium 的类型声明里 `ModelNode.matrix` 不接受 `undefined`、`getNode` 不会返回 `undefined`，和文档、实际不符，代码里有注释
- 人物模型 `apps/yzt/public/roam/Cesium_Man.glb` 入库：Cesium Man，© 2017 Cesium，CC BY 4.0（Khronos glTF-Sample-Assets 的 `Models/CesiumMan`），模型上的 Cesium 标志是商标；同目录 `CREDITS.txt` 随产物部署

## 测试

- 纯函数在 node 下测；`CesiumView` 用假场景测生命周期、三种 `cause`、新的相机操作、精确还原的条件、暂停期间的样式、不支持图层只报告一次、数据源错误、工具输入、手势和焦点、释放
- `cesium-scene.browser.test.ts` 用真实的 Cesium（Playwright 驱动的 Chromium，软件 WebGL）：相机互逆、拾取、投影、尺寸、影像图层的增删改和错误报告；覆盖物读画布像素检查（遮罩、线、点的颜色和叠放，整个世界的遮罩不让渲染停下，只改坐标，重建期间每一帧都看得到线，坐标没变的不动、只换坐标的线停下后改回静态、场景不再重画（包住 WebGL 上下文数绘制调用））；临时拖动后抓住的点在指针下；视点高度；在相机变化的回调里重建换过坐标的线，之后每一帧都看得到线。只用本机的地址，不请求天地图；读像素的场景用 `preserveDrawingBuffer` 创建
- `CesiumView` 的覆盖物：按整级重新推导、没变的图层是同一个对象、地址数据只下载一次、失败记错误并在不再引用后重新下载、释放时取消、暂停期间到的数据恢复后再画；临时拖动截下按下、松开和单击不交给工具、光标是手型
- 三维内容：`CesiumView` 用假场景测按 ID 增删、地址和重试次数变了重新加载、状态报告、暂停期间不应用、同组的替换、钻地交给场景、释放时中止加载；浏览器测试在测试里生成一个方块的 glTF 瓦片集，测加进场景并画出来、建议的相机、首批瓦片的报告、瓦片失败和中止、相机在地下时退出钻地；`inspect()` 报告预算、显存、加载和失败的次数，移除后为空。`scene-tilesets.browser.test.ts`：预算压到几 MB，块高低不同时误差涨上去后稳定、每帧都有瓦片；块一样高（俯视平地）时定地板后不再反复加载卸载、最多回落一次
- 显存预算：`scene-tilesets.browser.test.ts` 生成和 JKQ2 同样结构的瓦片集（根节点没有内容，16 个块各分 4 个约 172 KB 的叶节点，块的高度不同，需要的显存随屏幕误差一级一级变化），预算压到 1 MB 加 2 MB，俯视、相机不动：测屏幕误差不越过根节点、每一帧都有瓦片、稳定后不再变、停 200 个 tick 后再画一帧仍有瓦片。用正北朝上的正俯视：测试用的是裸的 `CesiumWidget`，没有撤销相机的舍入漂移（见"相机的舍入漂移"），斜着看时没动也会隔几个 tick 重画一帧，掩盖问题。改坏验证（2026-11-06）：去掉 `SceneTilesets` 里的请求渲染，屏幕误差涨到约 2.7 × 10¹⁸（根节点约 171），断言失败
- 相机停下：`cesium-scene.browser.test.ts` 依次定位到 5 个实测会一直漂的姿态，每个都要等到 `cameraidle` 和 `settle`，之后 90 帧里没有绘制调用。哪些姿态会漂取决于浮点运算的细节，换了 Cesium 版本可能要重新挑。改坏验证（2026-11-06）：去掉 `holdCameraSteady`，3 个姿态等不到 `cameraidle`，90 帧里重画 5～11 帧，断言失败
- 路线漫游：`CesiumView` 用假场景测开始、进度节流与到终点、重新开始与改播放、撤掉时飞回、漫游时相机按 program 写回且不开始新操作、别的定位接管时不飞回、暂停期间撤掉的在恢复时按能否还原决定、视图重建时接上；浏览器测试测飞到起点后视点在地板上方一个眼高并朝着路线、播放时沿路线走、到终点报告、结束后飞回、暂停时滚轮不移动相机、换一条路线时闪切且相机不升高（ADR 0103）；`CesiumView` 补漫游时覆盖物不随级别重新推导
- 步行：`CesiumView` 用假场景测开始与报告、找不到出生点、速度和两个计数、撤掉时飞回并换回光标、路线和步行之间换一次漫游、别的定位接管后不再算数；浏览器测试用一个 12 米见方的盒子当屋子（真实的 Worker 建导航网格），测飞到出生点后视点高度和朝向、按住 W 往前走、碰到墙停下、结束后飞回、从路线换手过来的步行结束时回到开始路线前的位置、路线换成步行在原地开始而步行换成路线闪切且相机不升到屋子外（ADR 0103）；报告人的位置和水平视场角、暂停时按键不走、瞬移闪切到指定位置（ADR 0087）；焦点在单选按钮上照样行走、在文字输入框里不走；第三人称（ADR 0090）用一根绿色柱子当人物，测相机拉到人后上方 4 米、画出人物、点在人身上穿过去走到前方的地面、滚轮拉近到 1.5 米、切回第一人称回到眼睛，人物模型加载失败报告一次提示、相机照样挂在臂上；人称变了才调 `setWalkView`、步行状态跟着换（假场景）
- 改坏验证（2026-10-26）：去掉"只有 sync 才能还原"的判断，"二维被用户移动过"的用例断言失败；方位不归零时浏览器测试断言失败。3D.2：不收世界外环、只改坐标时不换几何、替换时立即移除旧实体、转动方向反了，浏览器测试都以断言失败；级别不取整、不简化、下载完不重画，单元测试断言失败。2026-10-27（ADR 0082）：去掉点数上限，单元测试断言失败；改回按 `dataSourceDisplay.ready` 移除被替换的，浏览器测试有 2 帧看不到线

## 还没做的

- 第三人称的入口（ADR 0090，暂不开放）；有模型以后是否加 `spatial` 测量
- 软件 WebGL 下区划遮罩上偶尔有一像素宽的细缝，在有显卡的机器、真实影像下再确认（ADR 0080 后果）
- 有显卡的机器上复测第一次切到三维；部署时给 `cesium/` 配缓存（ADR 0091 第 4 节）
- 有显卡的机器上用 `/dev/tileset-probe` 录 JKQ、JKQ2 的报告（2026-11-06 用户实测最新 main 仍然先清晰后模糊、加载后删掉循环，本机模拟排除了预算机制，见"瓦片集的显存预算"）：看 `memoryAdjustedScreenSpaceError` 是否一直是 16、加载和卸载的增量、渲染出错和上下文丢失、显卡名是不是独立显卡、循环时相机是否真的不动
- 有显卡的机器上，斜视 JKQ 停下后用性能面板确认不再隔几帧重画一次（之前见过 100～260 毫秒的 rAF 处理，舍入漂移是可能的来源之一）
