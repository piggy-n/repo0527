# 三维画布与运行时（map-cesium）

状态：2026-10-19，已实现 3D.1 运行时、3D.2 相机/视图/缓存切换，以及 3D.3a 基础样式镜像。业务页切换尚未接入。范围依据 [ADR 0064](../adr/0064-three-dimensional-integration-scope.md)，基础绘制按 [ADR 0065](../adr/0065-basic-geojson-imagery-layers.md)，后续步骤见 [3D.0 计划](../stages/stage-3d-0-plan.md)。

## 职责与用法

| 位置 | 职责 |
|---|---|
| `app/cesium-runtime.ts` | 懒加载 SDK 样式、按 Vite `BASE_URL` 设置静态资源目录 |
| `app/map-framework.ts` | 增加 `3d` 运行时；默认仍是 `2d`，预热变为可选，Cesium 暂无预热动作 |
| `libs/map-cesium/cesium-surface.ts` | 持有 `CesiumWidget`、底图和事件监听；暂停、恢复、失败清理与释放 |
| `libs/map-cesium/cesium-view.ts` | 实现 `MapView`：就绪等待、生命周期、失败、定位、拾取与投影，隔离渲染器 |
| `libs/map-cesium/camera-plan.ts` | 不修改引擎的定位规划：CSS 留白、范围包围球与最大缩放级 |
| `libs/map-cesium/scene-query.ts`、`cesium-input.ts` | 表面拾取、背面投影排除；工具输入、焦点、手势与临时平移 |
| `libs/map-cesium/camera-geometry.ts` | 在目标点的 ENU 坐标系换算共享相机与原生姿态，保存精确姿态 |
| `libs/map-cesium/camera-bridge.ts` | 会话相机同步、用户意图、回声抑制、暂停期间的失效规则 |
| `libs/map-cesium/style-expression.ts`、`style-plan.ts` | 规范库求值、基础支持范围校验与逐层诊断 |
| `libs/map-cesium/style-mirror.ts` | 样式与级别增量同步、暂停追赶、来源错误与资源释放 |
| `libs/map-cesium/imagery-style-port.ts`、`raster-provider.ts`、`geojson-provider.ts` | 统一影像层序、SDK 栅格请求、透明点线面瓦片 |
| `libs/map-vue/use-cesium-canvas.ts` | 挂载后动态导入 map-cesium；`LatestController` 丢弃晚到的加载；暴露状态与重试 |
| `libs/map-vue/CesiumCanvas.tsx` | 静态容器，挂上和卸下统一视图；接收 `assetBaseUrl`、`active`，发出 `state`，暴露 `retry()` |
| `libs/map-vue/SwitchableMapCanvas.tsx`、`view-switch.ts` | 两个有尺寸的容器、懒加载与缓存、最新意图、就绪交接、失败回退与释放 |
| `pages/dev/cesium/DevCesiumPage.tsx` | `/dev/cesium`：本地基础样式、变色显隐与排序，以及二三维切换、定位、暂停恢复、失败重试；生产构建排除 |

路由用 `withMapRuntime` 加载默认二维运行时和页面；app 通过路由 props 传入资源地址和 `prepareRuntime(kind)`，首次切到三维时才配置三维运行时。`map-cesium` 不读取环境变量，也不依赖 Vue。开发页通过 `provideMap` 创建会话，通过 `useCamera()` 显示读数，通过 `runCameraOperation` 定位。上下文只挂当前视图，只有 ready 时公开只读视口；卸载时先卸下再释放。

当前不拆成 workspace 包：map-core 仍在 libs，按现有依赖方向将来一起评估拆分。

## 3D.2a 相机桥接

先完成共享相机与原生姿态的边界，再做完整视图与切换。`CameraPort` 只提供读取、应用、精确快照和恢复，单元测试可注入假相机；它没有通用的原生地图出口。

- 屏幕中心拾取椭球为共享中心，在该点的 ENU 坐标系计算方位和俯角，避免直接读相机所在地的 `heading/pitch` 导致省域倾斜视角漂移。天空、地下或零尺寸画布读不出共享中心时返回 null，保留已有共享相机
- 缩放沿用当前 MapLibre 的 512 CSS 像素口径和米/像素约定，使用真实竖直视场角。横屏时 Cesium 的 `fov` 是水平角，按宽高比换算。这里是视角尺度近似，不是距离或面积计算；跨引擎的真实画面对齐仍待验收
- 应用共享相机时限制纬度到 Mercator 范围、俯角到 0～85°；正俯视用 0.01° 的微倾保留 bearing，读回 0.02° 以内归零。原生三维操作读回的纬度如实保存，三维专有姿态独立保存
- 激活时应用会话，渲染后按姿态变化写回 `view: '3d', cause: 'user'`；由会话同步产生的姿态先记作已应用，迟到的渲染不会变成用户回声。画布输入开始时调用 `beginOperation()` 作废旧定位，不用 `moveStart` 或时间窗口猜原因
- 暂停前收下最后一帧，保存精确位置、方向和上方向；隐藏期间不修改引擎。只有 sync 变化时恢复精确快照；发生过 user/program 后采用最新会话，之后的 sync 不会重新允许旧快照
- 视口尺寸变化保留原生姿态，将新的像素尺度按 sync 写回；释放时先断开相机桥接，不把卸载过程写回会话。以暂停状态创建的画布不先激活，避免零尺寸隐藏画布修改会话

3D.2a 只实现上述相机桥接；定位、拾取和工具接口在下面的 3D.2b 接入。

## 3D.2b 统一视图

- `CesiumView` 与 MapLibre 使用相同的生命周期、只读视口与相机操作。候选视图以 inactive 创建时仍完成首轮预备渲染，进入 paused，期间不写会话、不接收工具输入；不能完全停掉首轮渲染，否则 `whenReady()` 永远不结束
- `flyTo` 的 duration 从公共接口的毫秒转为 Cesium 的秒。飞行每帧及终点都按 program 写回，暂停时直接到规划终点，新的相机操作中止旧飞行；释放时先断开桥接，不把卸载写成移动
- 定位规划只计算姿态，不修改当前引擎。不对称留白通过迭代求共享中心实现，保留 zoom/bearing/pitch；不会留下持久化的相机留白。`fitBounds` 用 SDK 椭球矩形包围球保证范围落在留白区域，旋转归零、保留或指定俯角、遵守 maxZoom。极端俯角与留白无法求解时明确失败，不能悄悄改变俯角
- 精确快照直接恢复公开的 position/direction/up/right 向量；SDK 的 `setView` 在近正俯视时会将方向换成欧拉角并舍入，测试发现这会产生偏移。公开接口依据 [Cesium Camera](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html)
- 拾取优先模型深度，再地形/椭球；命中模型但无法取深度时返回 miss。投影排除相机背后及被椭球遮挡的点；`queryRendered()` 返回空数组，业务识别仍走后端。首期场景只有椭球，模型与真实地形的浏览器验证随对应功能接入
- 输入仅在当前视图 ready 时交给 `ToolModel`；画布获得键盘焦点，输入法选字不触发快捷键。工具占用左键时不交给 SDK；Ctrl/Meta 临时平移抑制整轮工具事件，松键后保持该轮手势，最后一帧结束再还原
- 暂停、失焦和程序定位结束旧手势，禁用原生输入；恢复后等待新的按下或滚轮意图再开放，避免隐藏前的惯性自动继续。没有访问 SDK 私有聚合器；真实拖动、组合键和触控的广泛验收仍在 3D.4

开发页的“定位到南京”“江苏范围”用于验证公共上下文，业务页切换按钮待样式与工具验收后接入。

## 3D.2c 缓存与切换

`SwitchableMapCanvas` 保留独立的二维、三维容器，内层 class 静态不变；候选用 `visibility: hidden` 保留尺寸，`inert` 禁止鼠标与键盘访问。app 负责运行时设置，map-vue 动态导入三维模块。

- `MapViewSwitch` 按种类缓存视图和正在准备的 Promise。候选始终以 inactive 创建，加载时原图继续工作；重复请求同一目标共用准备过程，`LatestController` 决定最后哪次请求可以交接
- 交接依次暂停原图、卸下上下文、恢复候选、检查就绪、挂上候选。候选恢复失败时尝试还原原图，并释放失败候选；回滚中单步出错也不跳过其余恢复与清理
- 二维恢复可能因追赶样式重新加载，不能把旧 `whenReady()` 当作新一轮成功。此时先暂停候选、恢复原图，等新一轮加载完成再交接
- 页面暂停时只准备候选，恢复后才验证激活与交接。切换不开始新相机操作，暂停期间排队的定位仍按既有相机通道执行；交接中的同步回调也可能产生新切换意图，发布结果前再次检查信号
- 切换反馈 `{ current, target, status, error }` 与当前视图失败分开：候选失败可以同时保留一个健康原图。重试失败目标；返回当前图会取消等待中的切换。卸载时释放全部缓存，晚到的模块不得再创建视图
- 二维暂停补发最后指针的 `leave`，清框选草稿、测量预览与提示，不更换工具、不调用 `deactivate`，保留测量已确定的点

本步只在开发页使用浏览工具；不支持工具的能力声明与暂停策略、业务工具与查询接入仍在 3D.4，不据此开放业务三维。

## 3D.3a 基础样式镜像

`CesiumView` 将会话的 `style` 和 `camera` 一起交给 Surface，镜像不读取二维引擎，也不另存资源勾选、年份或符号。完整支持表及画面差异见 [3D.3a 记录](../stages/stage-3d-3a-basic-style.md)。

- background、raster、GeoJSON fill/line/circle 共用影像集合；GeoJSON 绘制成透明瓦片，允许影像、面、影像交错。透明全球底层隔离 SDK 的底层边缘延展；背景覆盖两极，GeoJSON 只支持 Mercator 有效范围
- 栅格支持多 URL、XYZ/TMS、尺寸、级别、范围及署名；请求节流、取消仍由 SDK 管理。局部和跨经线覆盖范围同时传给 provider 与影像层，避免默认范围求交截掉一侧
- GeoJSON 支持内联简单/Multi 几何、几何集合、孔洞、分类属性与身份过滤。完整路径交给画布裁切，不在瓦片边缘补假端点；求值用相机级别，笔宽和半径再换算到当前瓦片像素
- 没变的图层和来源保留实例，重排只移动；换色、换数据重建对应层。GeoJSON 缩放会重新生成影像，使用最新相机级别与像素尺寸；小样先同步绘制，大数据与 Worker 性能在 3D.3b 处理
- 暂停不写引擎，恢复应用最新快照。就绪和稳定事件检查该帧开始绘制时的样式修订；尺寸变化或 postRender 中刚更新样式时等待下一帧，避免把旧画面报告为稳定
- 不支持的图层/属性逐层提示并跳过；同步构造或绘制属性异常只作图层诊断，provider 的实际加载失败进入 `sourceErrors`，其他层继续。修正样式不会误留来源错误，真实下载错误则在来源替换/移除时清理；过期 provider 回调不能污染新层
- Canvas 绘制失败返回 Promise rejection，由 SDK 转为 provider 错误；有数据源的图层再记入 `sourceErrors`，背景只报告诊断。引擎渲染失败才进入整个视图的 failed。单画布加载器同样按视图状态判断整体失败，不能把普通诊断当作加载失败

开发页的“定位到南京”显示本地点线面、孔洞和两层栅格，使用三个按钮验证显隐、换色与排序。页面的样式拥有者通过 `bindStyle` 绑定同一会话；三维隐藏期间修改后再切回，只追赶最新状态。测试数据随开发页打包，不请求后端或天地图。

## 最小场景与资源所有权

使用 `CesiumWidget`，不用带选图器、时间轴等控件的 `Viewer`。构造时显式 `baseLayer: false`；椭球地形、不创建星空与太阳/月球、不启用 SDK 默认在线服务。有会话时全部影像来自会话样式；直接创建 Surface 而不传样式时，才保留 3D.1 的 SDK 本地 `NaturalEarthII` 验证场景（Geographic、反向 Y、0～2 级），不把它作为业务底图。

先关闭默认渲染循环，完成监听与样式设置后再开启。`postRender` 中确认可见瓦片加载完成、该帧使用当前样式后发出就绪；隐藏时关闭渲染循环和相机输入，恢复先调整画布尺寸再请求渲染。会话来源错误单独记录；独立验证场景的本地底图资源错误或引擎渲染错误进入失败，在 SDK 事件调用栈结束后释放画布，再由重试重建。

实例用 `DisposableStack` 反序释放：移除监听、销毁 Widget、移除独占容器。SDK 构造函数内部抛错、尚未返回实例时，只能移除残留容器；不能声称已验证这种情况的所有内部 GPU 资源都被释放。反复失败与 WebGL 上下文释放仍需浏览器验收。

## 部署与版本

- `cesium` 精确为 `1.145.0`。其 package.json 对 engine、widgets 使用范围依赖，所以 workspace 同时固定 `@cesium/engine: 26.3.0`、`@cesium/widgets: 16.2.0`，与该发行包的 Worker 和类型声明对齐；升级时三者一起核对
- 按[官方静态资源说明](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/)部署 `Workers`、`ThirdParty`、`Assets`、`Widgets` 四目录。`vite-plugin-static-copy` 3.4 在开发环境提供文件、构建时复制到 `dist/cesium/`；后置检查逐项比较文件名和字节。初次采用 4.1.1 时构建检查发现它保留了 `node_modules` 父路径，改用 3.4 后四目录检查通过
- 运行时目录为 `${BASE_URL}cesium/`，支持当前根路径和以 `/` 开头的部署子路径。随 SDK 发布的静态文件必须与应用一起部署，不能只复制 `dist/assets`
- `buildModuleUrl` 是 Cesium 的具名导出，其 `setBaseUrl` 方法在 1.145.0 实现中存在，但发布类型遗漏。app 仅为这个成员补窄类型并显式调用，不导入 SDK 内部路径、不往 `window` 挂对象；升级必须复核此处
- CSS 由 app 的懒加载运行时导入。默认二维入口不会静态依赖 Cesium，生产产物检查同时约束 MapLibre 与 Cesium

## 本轮验证与后续验收

已执行并通过：

1. `pnpm build`：生产开发页排除、入口依赖检查、389 个静态资源文件内容核对
2. `pnpm build:intranet`：同样的资源核对，加上天地图 key 排除检查
3. 单独用 Vite 库构建编译 `DevCesiumPage.tsx`、`cesium-runtime.ts` 与 `map-runtime.ts`，包含两种运行时和动态 map-cesium 分块；临时输出在 `apps/web/node_modules/.tmp/cesium-build`，不入库。普通生产构建会裁掉开发页，不能用它代替这项构建

3D.2a 当时只执行上述三项构建，未运行测试。3D.2b 开始时，用户明确本项目需要执行测试、必要时验证真实页面：此前积累的测试已开始执行，修复了构建没有检出的类型与 lint 问题。已有 `sm-crypto-v2` 的浏览器外部模块提示和大分块提示仍保留。

3D.2b 验证结果：全项目回归通过（icons 35、web 1628 个用例）；随后补充的公共 retry 用例及扩展后的页面失败重建用例单独通过。类型检查、lint、公网构建、内网构建及开发页独立构建均通过。故意改坏 program 原因、留白中心和 inactive 就绪状态，共触发 5 个断言失败；恢复后 24 个相关用例重新通过。

3D.2c 验证结果：全项目回归通过（icons 35、web 1654，共 1689 个用例），包含 21 条切换拥有者用例与真实开发页切换验证。暂停时的 leave 和交接后信号检查分别做过改坏验证，产生 3 个和 1 个断言失败，恢复后通过；生命周期异常重试和激活期间同目标重入也先复现再修复。类型检查、lint、公网、内网和开发页独立构建均通过。完整并行回归曾暴露 SDK 首次加载占用单用例超时、软件渲染未在 5 秒内完成的问题，已将 SDK 加载移到测试装配，并将页面末次动画的渲染等待上限与加载等待统一为 10 秒，仍按最终相机断言判断成功。

真实 Chromium 已覆盖本地底图加载、拾取投影往返、背面排除、非对称留白、毫秒动画、暂停到终点、inactive 初次加载、范围定位及释放。3D.2c 开发页测试验证默认二维、首次三维失败保留原图、重试、两种画布身份复用、相机往返与暂停期间排队定位、释放后重建。部署子路径、真实拖动惯性和 GPU 内存数量仍需后续专项验收；不得据此宣称业务三维已经完成。

3D.3a 验证结果：全项目回归通过（icons 35、web 1764，共 1799 个用例，本步新增 110 个），类型检查、lint、公网/内网及开发页独立构建均通过。真实 Canvas 像素验证尺寸换算、透明度、孔洞、分类与瓦片接缝；真实 Cesium 验证栅格与面穿插、重排、局部覆盖不延展、来源替换、暂停追赶，以及尺寸变化后等待最新样式帧。默认加载器与开发页覆盖局部诊断不导致整体失败、切换后样式一致。新增测试执行改坏或修复前复现验证，均以预期断言失败捕获错误，恢复后通过；细节见 [3D.3a 记录](../stages/stage-3d-3a-basic-style.md)。全量回归中的软件 WebGL 首次渲染争用通过浏览器文件串行、关键首帧等待 15 秒处理，像素与状态断言保留；普通测试仍并行。
