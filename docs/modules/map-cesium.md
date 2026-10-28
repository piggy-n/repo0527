# map-cesium：三维视图

`libs/map-cesium`（`@yzt/map-cesium`）是二维 MapLibre 适配器的三维对应：一个实现 `MapView` 的 `CesiumView`，镜像会话的样式（栅格底图和 GeoJSON 覆盖物）、同步相机、把画布上的输入交给工具（ADR 0020、0024、0079、0080）。三维阶段的范围与交互见 ADR 0078，分步计划见 [roadmap](../roadmap.md)"三维阶段的范围与取舍"。

## 结构

| 文件 | 内容 | 是否导入 Cesium | 测试 |
|---|---|---|---|
| `camera-math.ts` | 缩放级与距离互换、视场角对齐、正俯视与方位的处理 | 否 | node |
| `camera-fit.ts` | 和二维一样的取景：`fitBoundsCamera`、带留白定位的 `paddedCenter` | 否 | node |
| `url-template.ts` | 数据源的多个瓦片地址合成带 `{s}` 的模板 | 否 | node |
| `scene-style.ts` | `planSceneStyle`：样式 → 影像图层、地球底色、覆盖物图层、不支持的图层 | 否 | node |
| `overlay-update.ts` | `movableInPlace`：图层再次推导时能不能只换坐标（样式、个数不变，线和面不超过 500 个点，ADR 0082） | 否 | node |
| `overlay-plan.ts` | `planOverlays`：覆盖物图层和数据 → 形状（按整级求值样式、简化到半个像素、遮罩外环收成方框、去掉重复点） | 否 | node |
| `scene-like.ts` | 窄接口 `SceneLike`、`ScenePose`、`TilesetOptions`、`WebGLUnavailableError` | 否 | — |
| `cesium-view.ts` | `CesiumView`：生命周期、相机同步与精确还原、样式镜像、覆盖物数据的下载、工具输入与临时拖动、数据源错误、视点高度、三维内容 | 否（只依赖 `SceneLike`） | jsdom，注入假场景 |
| `cesium-scene.ts` | `CesiumScene`：唯一调用 Cesium 的门面 | 是 | 浏览器，真实 Cesium |
| `scene-tilesets.ts` | `CesiumScene` 用的瓦片集：Blob 地址创建、参数、头灯光照、首批瓦片与失败的事件 | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-underground.ts` | `CesiumScene` 用的钻地：占地矩形、地表透明、土层与背景、退出时飞回地表上方 | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-route.ts` | `CesiumScene` 用的路线漫游：飞到起点、逐帧推进与平滑朝向、暂停时拖动转头、室内视场角、结束时还原（ADR 0083） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-walk.ts` | `CesiumScene` 用的第一人称步行：选出生点、飞进站内、键鼠、深度拾取与遮挡、闪切、悬停光标、逐帧设相机（ADR 0086） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-walk-marker.ts` | 点击移动的落点光环（自定义材质的平面图元） | 是 | 随 `CesiumScene` 的浏览器测试 |
| `scene-roam-camera.ts` | 路线和步行共用的接管相机：记下开始前的相机、关掉相机控制（每帧守着）、交还时飞回，换手时交给下一个 | 是 | 随 `CesiumScene` 的浏览器测试 |
| `runtime.ts` | `setCesiumBaseUrl` | 是 | 由 app 的测试覆盖 |

`CesiumView` 不导入 Cesium，靠构造参数 `createScene` 拿到场景：真实的是 `createCesiumScene`，测试换成假场景。`cesium-view.test.ts` 用 `expectTypeOf<CesiumScene>().toExtend<SceneLike>()` 检查真实的门面满足窄接口，和 MapLibre 适配器的 `MapLike` 一样（ADR 0079 第 3 节）。

只有 `libs/map-cesium` 和 `app` 能导入 `cesium` 和 `@cesium/*`，由 lint 检查（[oxlintrc.md](../config/oxlintrc.md)）。map-vue 只能用动态 `import()` 引用本模块。

## 运行时

- Cesium 运行时要从基础地址加载 `Workers`、`Assets`、`ThirdParty`：`vite.config.ts` 用 `vite-plugin-static-copy` 把它们复制到产物的 `cesium/`，开发服务器和测试同样提供（[vite-config.md](../config/vite-config.md)）
- `setCesiumBaseUrl(url)` 调用有文档、但类型声明里漏掉的 `buildModuleUrl.setBaseUrl`，类型用模块扩充补上；不往 `window` 上写 `CESIUM_BASE_URL`。升级 Cesium 时核对它仍然存在
- app 的三维运行时（`app/map-runtime-3d.ts`）引入 `CesiumWidget` 的样式表并调用它，基础地址是 `${BASE_URL}cesium/`。map-vue 的 `CesiumCanvas` 第一次切到三维时，同时加载这个运行时和本模块（[map-vue.md](map-vue.md)"三维画布"）

## 场景的设置

`CesiumScene` 创建 `CesiumWidget` 时：

- `baseLayer: false`：不请求 Cesium ion 的全球影像，底图全部来自样式镜像；地形是默认的椭球，不请求网络
- `skyBox: false`（星空要额外贴图），保留着色器画的天空大气；`showGroundAtmosphere` 关掉，免得影像蒙上一层颜色
- `requestRenderMode: true`：只在场景变化时渲染；改影像、底色、相机后调用 `requestRender`
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

### 定位

- `flyTo` 的 `padding` 只决定这一次把目标放在哪里（ADR 0037）：去掉四边留白后的区域中央相对画布中心的偏移，按方位角转到地图上，再按这一级的比例换成经纬度（`paddedCenter`）
- `fitBounds` 按二维的取景算出相机（Web 墨卡托、512 像素瓦片，范围放进去掉留白的画布、方位归零），再交给三维相机；所以定位后画布中心的地面比例和二维相同。俯角不传时保持当前的

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
- 级别按 `Math.round(zoom)` 取整，换了一级才重新推导；图层、数据、级别和位置都没变时给出上次的结果对象，场景按对象判断哪些图层不用重画
- 线和面按这一级的半个像素简化（`simplifyTolerance`）：省界 2 万个点的贴地线要几秒才建好，简化后 6 级约 1 千个点
- 外环横跨整个世界的面（区划遮罩）收成方框（`shrinkWorldRing`），相邻的重复点去掉（`cleanPath`）：这两种情况都会让 Cesium 停止渲染
- 样式不变、形状个数相同、线和面合计不超过 500 个点时只改坐标：第一次改时把坐标换成每帧读取的属性，测量画线时不重建。每帧读取的贴地线和面每帧都在主线程上重建几何，边界跨级重新简化时如果也走这条路，13 级左右一帧要几百毫秒，所以点多的照常重建（ADR 0082）
- 要重建的图层，旧的实体留到新加的全部画好再移除，不会空白：看 `clock.canAnimate`（`CesiumWidget` 每帧写入这一帧 `dataSourceDisplay.update` 的结果）。不能看 `dataSourceDisplay.ready`：它第一次就绪后一直为 `true`（ADR 0082）
- 数据源的 `data` 是地址时由 `CesiumView` 下载，按地址缓存；下载或内容不是 GeoJSON 时按数据源 ID 记错误，地址不再被引用时忘掉，再次引用时重新下载；视图释放时取消下载。下载函数由构造参数 `loadJson` 换掉（瓦片集的索引也用它），测试不发网络请求
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
- 场景的做法沿用旧代码：瓦片集参数（`maximumScreenSpaceError: 16`、加大缓存、移动时不请求等）、头灯的 `CustomShader`；钻地时关掉碰撞、近裁剪面 0.1、地表在占地范围内按距离透明、相机在地下时换背景，退出时相机在地下的先飞回离地 120 米再恢复

## 路线漫游（ADR 0083）

会话三维内容的 `roam` 是拥有者的意图（哪条路线、播放还是暂停、倍速、第几遍），`CesiumView` 按它驱动场景，场景逐帧推进：

- 换了 `id` 开始新的路线（`startRoute`：飞到起点停住），`run` 变了回到起点，`playing`、`rate` 变了改播放；撤掉时结束并飞回开始前的位置
- 进度：场景每帧发 `routeprogress`，视图每变 0.5 米报告一次 `roamStatus`（`{ id, run, distance, total, finished }`），开始、回到起点、到终点（`routeend`）时立即报告
- 路线的几何在 map-core 的 `RoutePath`：按起点的切平面换成米、累计三维长度、朝向看前方 4 米（俯仰最多 ±30°）；眼高 1.6 米，1× 是 1.6 m/s
- 场景（`scene-route.ts`）：关掉 Cesium 的拖动和缩放，竖直视场角换成 60°；每帧按真实流逝的时间推进（一帧最多按 0.1 秒），朝向按时间常数 0.4 秒平滑；暂停时左键拖动原地转头，继续后约 0.6 秒转回；场景是按需渲染，播放、转回时每帧请求下一帧
- 页面开始别的定位时路线立即停下、不飞回；暂停期间撤掉的漫游在恢复相机以后结束，相机能还原时才飞回
- Cesium 的 `flyTo` 结束、取消时会在回调之后把相机控制重新打开（`CameraFlightPath` 的 `wrapCallback`，2026-10-27 实测），所以漫游期间每帧关掉；路线每帧都把相机设回路线上，在这之前也看不出来

## 第一人称步行（ADR 0086）

会话三维内容的 `roam` 是 `kind: 'walk'` 时，`CesiumView` 让场景开始步行；行走的规则在 map-core 的 `Walker`，场景只做输入、拾取和相机：

- 意图：换了 `id` 开始新的（`startWalk`），速度变了 `setWalkSpeed`，`respawn`、`unstuck` 的计数变了做一次；撤掉时结束并飞回开始前的位置，光标换回工具的。先报告 `entering`，场景找不到出生点时在 `startWalk` 里就报告 `failed`；飞到出生点后 `walking`；提示（`walknotice`）每来一条计数加 1
- 路线和步行之间换手：开始新的一种时，场景从上一种那里接过开始前记下的相机，结束时回到最初的位置
- 出生点、行走、点击、脱困的规则见 [map-core.md](map-core.md)"第一人称步行"；场景给 `chooseSpawn` 的是相机位置、椭球面以上的高度、画布中心打到椭球的点和朝向，都换到瓦片集的局部系
- 相机：每帧按 `Walker` 的位置、视点高度和朝向设相机，方向和上方向按局部系的轴换到地心坐标；没变就不设。视场角 60°，滚轮在 20°～75° 之间调；进场飞 2 秒
- 输入：键盘在窗口上（输入框、修饰键除外；切走窗口、页面停用时忘掉按着的键）；鼠标在容器上按捕获阶段拦下，不传到画布。左键点击（按住 300 毫秒内挪动不超过 30 像素，否则 5 像素），右键拖动转向，中键上下拖动和滚轮改视场角
- 点击处的地面用 `scene.pickPosition`；遮挡判断把点投影到屏幕上读那个像素的深度，不在画面里算挡着；悬停光标每 80 毫秒最多判断一次，在节流里的到期再判断
- 闪切：容器里一层黑幕，160 毫秒变黑、挪过去、260 毫秒亮回来；落点光环正常做深度测试，半透明不写深度
- 步行期间头灯着色器的远处压暗打开
- 室内地图（ADR 0087）：每帧设完相机后，人的位置、朝向、水平视场角或落点变了就发 `walkplayer`，视图写进步行状态的 `player`；`paused` 时忘掉按着的键、拖动和悬停，不再响应键鼠（点击移动的路径照常走完）；`teleport` 的计数变了就闪切到它的位置
- 就绪视图的 `heading()` 是相机的 `heading`（相对相机所在位置的水平面），状态栏的朝向用它

## 测试

- 纯函数在 node 下测；`CesiumView` 用假场景测生命周期、三种 `cause`、新的相机操作、精确还原的条件、暂停期间的样式、不支持图层只报告一次、数据源错误、工具输入、手势和焦点、释放
- `cesium-scene.browser.test.ts` 用真实的 Cesium（Playwright 驱动的 Chromium，软件 WebGL）：相机互逆、拾取、投影、尺寸、影像图层的增删改和错误报告；覆盖物读画布像素检查（遮罩、线、点的颜色和叠放，整个世界的遮罩不让渲染停下，只改坐标，重建期间每一帧都看得到线）；临时拖动后抓住的点在指针下；视点高度；在相机变化的回调里重建换过坐标的线，之后每一帧都看得到线。只用本机的地址，不请求天地图；读像素的场景用 `preserveDrawingBuffer` 创建
- `CesiumView` 的覆盖物：按整级重新推导、没变的图层是同一个对象、地址数据只下载一次、失败记错误并在不再引用后重新下载、释放时取消、暂停期间到的数据恢复后再画；临时拖动截下按下、松开和单击不交给工具、光标是手型
- 三维内容：`CesiumView` 用假场景测按 ID 增删、地址和重试次数变了重新加载、状态报告、暂停期间不应用、同组的替换、钻地交给场景、释放时中止加载；浏览器测试在测试里生成一个方块的 glTF 瓦片集，测加进场景并画出来、建议的相机、首批瓦片的报告、瓦片失败和中止、相机在地下时退出钻地
- 路线漫游：`CesiumView` 用假场景测开始、进度节流与到终点、重新开始与改播放、撤掉时飞回、漫游时相机按 program 写回且不开始新操作、别的定位接管时不飞回、暂停期间撤掉的在恢复时按能否还原决定、视图重建时接上；浏览器测试测飞到起点后视点在地板上方一个眼高并朝着路线、播放时沿路线走、到终点报告、结束后飞回、暂停时滚轮不移动相机
- 步行：`CesiumView` 用假场景测开始与报告、找不到出生点、速度和两个计数、撤掉时飞回并换回光标、路线和步行之间换一次漫游、别的定位接管后不再算数；浏览器测试用一个 12 米见方的盒子当屋子（真实的 Worker 建导航网格），测飞到出生点后视点高度和朝向、按住 W 往前走、碰到墙停下、结束后飞回、从路线换手过来的步行结束时回到开始路线前的位置；报告人的位置和水平视场角、暂停时按键不走、瞬移闪切到指定位置（ADR 0087）
- 改坏验证（2026-10-26）：去掉"只有 sync 才能还原"的判断，"二维被用户移动过"的用例断言失败；方位不归零时浏览器测试断言失败。3D.2：不收世界外环、只改坐标时不换几何、替换时立即移除旧实体、转动方向反了，浏览器测试都以断言失败；级别不取整、不简化、下载完不重画，单元测试断言失败。2026-10-27（ADR 0082）：去掉点数上限，单元测试断言失败；改回按 `dataSourceDisplay.ready` 移除被替换的，浏览器测试有 2 帧看不到线

## 还没做的

- 小地图、第三人称（3D.4d）；有模型以后是否加 `spatial` 测量
- 软件 WebGL 下区划遮罩上偶尔有一像素宽的细缝，在有显卡的机器、真实影像下再确认（ADR 0080 后果）
- Cesium 是否预加载、三维期间二维是否继续保留（3D.5）
