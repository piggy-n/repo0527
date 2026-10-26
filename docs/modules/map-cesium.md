# map-cesium：三维视图

`libs/map-cesium`（`@yzt/map-cesium`）是二维 MapLibre 适配器的三维对应：一个实现 `MapView` 的 `CesiumView`，镜像会话的样式、同步相机、把画布上的输入交给工具（ADR 0020、0024、0079）。三维阶段的范围与交互见 ADR 0078，分步计划见 [roadmap](../roadmap.md)"三维阶段的范围与取舍"。

## 结构

| 文件 | 内容 | 是否导入 Cesium | 测试 |
|---|---|---|---|
| `camera-math.ts` | 缩放级与距离互换、视场角对齐、正俯视与方位的处理 | 否 | node |
| `camera-fit.ts` | 和二维一样的取景：`fitBoundsCamera`、带留白定位的 `paddedCenter` | 否 | node |
| `url-template.ts` | 数据源的多个瓦片地址合成带 `{s}` 的模板 | 否 | node |
| `scene-style.ts` | `planSceneStyle`：样式 → 影像图层、地球底色、不支持的图层 | 否 | node |
| `scene-like.ts` | 窄接口 `SceneLike`、`ScenePose`、`WebGLUnavailableError` | 否 | — |
| `cesium-view.ts` | `CesiumView`：生命周期、相机同步与精确还原、样式镜像、工具输入、数据源错误 | 否（只依赖 `SceneLike`） | jsdom，注入假场景 |
| `cesium-scene.ts` | `CesiumScene`：唯一调用 Cesium 的门面 | 是 | 浏览器，真实 Cesium |
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
| `geojson` 与 `line`、`fill`、`circle` | 贴地的线、面、点，表达式用 style-spec 求值 | 3D.2 |
| `vector`（MVT） | 不支持（本阶段，ADR 0078 第 1 节） | — |
| 其他类型、清单外的属性和写法（TileJSON 地址、`{quadkey}` 等占位符、图层的级别范围、表达式） | 不支持 | — |

- 每次样式变化时整份推导（`planSceneStyle`），场景按图层 ID 增删改：瓦片来源（地址、子域名、瓦片尺寸、级别范围）变了才换图层，透明度、显隐直接改
- 天地图 `t0`～`t7` 的 8 个地址合成 `https://t{s}.tianditu.gov.cn/...`，子域名按原来的顺序
- 不支持的图层通过 `onUnsupported` 报告，每个图层每个视图一次；库里不读环境变量，页面在开发环境下打印
- 影像瓦片的加载错误按二维的数据源 ID 记在 `sourceErrors`，每个数据源记第一条，数据源移除时忘掉（ADR 0041）

## 拾取与投影

- `pick`：先 `scene.pick`，打到 3D Tiles 时用 `pickPosition` 取深度位置，表面是 `model`，带高度；再沿视线和椭球求交，本阶段没有地形，表面是 `ellipsoid`；都没打到时是 `miss`（ADR 0024 第 2 条）
- `project`：点在地球背面（`EllipsoidalOccluder`）或相机背后时返回 `null`，否则 `SceneTransforms.worldToWindowCoordinates`
- `queryRendered` 返回空数组（ADR 0047 第 4 节）

## 输入与工具

- 画布上的 `mousedown`、`mousemove`、`mouseup`、`click`、`dblclick`、`mouseleave` 按二维的格式交给会话的工具模型，只在视图就绪时转交；画布获得焦点时的按键同样转交
- 工具的 `dragPan: false` 关掉左键拖动（`enableRotate`、`enableTranslate`）；光标照工具的声明；临时任务把焦点移到画布上，Esc 才能直接退出
- 修饰键临时平移（ADR 0056）在 3D.2 实现

## 测试

- 纯函数在 node 下测；`CesiumView` 用假场景测生命周期、三种 `cause`、新的相机操作、精确还原的条件、暂停期间的样式、不支持图层只报告一次、数据源错误、工具输入、手势和焦点、释放
- `cesium-scene.browser.test.ts` 用真实的 Cesium（Playwright 驱动的 Chromium，软件 WebGL）：相机互逆、拾取、投影、尺寸、影像图层的增删改和错误报告；只用本机的地址，不请求天地图
- 改坏验证（2026-10-26）：去掉"只有 sync 才能还原"的判断，"二维被用户移动过"的用例断言失败；方位不归零时浏览器测试断言失败

## 还没做的

- GeoJSON 覆盖物的镜像、三维测量、修饰键平移、三维状态栏（3D.2）
- 3D Tiles 模型、钻地（3D.3），漫游（3D.4）
- Cesium 是否预加载、三维期间二维是否继续保留（3D.5）
