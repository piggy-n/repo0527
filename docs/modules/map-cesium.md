# 三维画布与运行时（map-cesium）

状态：2026-10-18，3D.1 的最小接入和 3D.2a 的会话相机桥接已实现，构建通过。当前仍是开发画布，尚未实现完整 `MapView`、会话样式镜像或业务页的二三维切换。范围依据 [ADR 0064](../adr/0064-three-dimensional-integration-scope.md)，后续步骤见 [3D.0 计划](../stages/stage-3d-0-plan.md)。

## 职责与用法

| 位置 | 职责 |
|---|---|
| `app/cesium-runtime.ts` | 懒加载 SDK 样式、按 Vite `BASE_URL` 设置静态资源目录 |
| `app/map-framework.ts` | 增加 `3d` 运行时；默认仍是 `2d`，预热变为可选，Cesium 暂无预热动作 |
| `libs/map-cesium/cesium-surface.ts` | 持有 `CesiumWidget`、底图和事件监听；暂停、恢复、失败清理与释放 |
| `libs/map-cesium/camera-geometry.ts` | 在目标点的 ENU 坐标系换算共享相机与原生姿态，保存精确姿态 |
| `libs/map-cesium/camera-bridge.ts` | 会话相机同步、用户意图、回声抑制、暂停期间的失效规则 |
| `libs/map-vue/use-cesium-canvas.ts` | 挂载后动态导入 map-cesium；`LatestController` 丢弃晚到的加载；暴露状态与重试 |
| `libs/map-vue/CesiumCanvas.tsx` | 静态容器，从 `provideMap` 的上下文取得相机；接收 `assetBaseUrl`、`active`，发出 `state`，暴露 `retry()` |
| `pages/dev/cesium/DevCesiumPage.tsx` | `/dev/cesium`：创建、释放、暂停、恢复、重建与失败模拟；生产构建排除 |

路由用 `withMapRuntime` 加载三维运行时和页面，完成设置后才挂载画布；资源地址由 app 通过路由 props 传入。`map-cesium` 不读取环境变量，也不依赖 Vue。开发页通过 `provideMap` 创建会话，画布只读写同一个 `CameraModel`，页面通过 `useCamera()` 显示读数，没有第二份相机状态。完整视图接口留到 3D.2b，目前上下文的 `view` 仍为空，尚不能通过 `runCameraOperation` 在此画布定位。

当前不拆成 workspace 包：map-core 仍在 libs，按现有依赖方向将来一起评估拆分。

## 3D.2a 相机桥接

先完成共享相机与原生姿态的边界，再做完整视图与切换。`CameraPort` 只提供读取、应用、精确快照和恢复，单元测试可注入假相机；它没有通用的原生地图出口。

- 屏幕中心拾取椭球为共享中心，在该点的 ENU 坐标系计算方位和俯角，避免直接读相机所在地的 `heading/pitch` 导致省域倾斜视角漂移。天空、地下或零尺寸画布读不出共享中心时返回 null，保留已有共享相机
- 缩放沿用当前 MapLibre 的 512 CSS 像素口径和米/像素约定，使用真实竖直视场角。横屏时 Cesium 的 `fov` 是水平角，按宽高比换算。这里是视角尺度近似，不是距离或面积计算；跨引擎的真实画面对齐仍待验收
- 应用共享相机时限制纬度到 Mercator 范围、俯角到 0～85°；正俯视用 0.01° 的微倾保留 bearing，读回 0.02° 以内归零。原生三维操作读回的纬度如实保存，三维专有姿态独立保存
- 激活时应用会话，渲染后按姿态变化写回 `view: '3d', cause: 'user'`；由会话同步产生的姿态先记作已应用，迟到的渲染不会变成用户回声。画布输入开始时调用 `beginOperation()` 作废旧定位，不用 `moveStart` 或时间窗口猜原因
- 暂停前收下最后一帧，保存精确位置、方向和上方向；隐藏期间不修改引擎。只有 sync 变化时恢复精确快照；发生过 user/program 后采用最新会话，之后的 sync 不会重新允许旧快照
- 视口尺寸变化保留原生姿态，将新的像素尺度按 sync 写回；释放时先断开相机桥接，不把卸载过程写回会话。以暂停状态创建的画布不先激活，避免零尺寸隐藏画布修改会话

本步没有定位动画、`fitBounds`、拾取/投影接口或工具输入适配，也没有让三维冒充完整 `MapView`；3D.2b 补齐这些契约，再接切换拥有者。动画的毫秒/秒换算、面板不对称留白、暂停时动画收尾及惯性输入清理需要在对应步骤实现和验收。

## 最小场景与资源所有权

使用 `CesiumWidget`，不用带选图器、时间轴等控件的 `Viewer`。构造时显式 `baseLayer: false`，随后加入本地 `UrlTemplateImageryProvider`；椭球地形、不创建星空与太阳/月球、不启用在线影像或地形服务。底图是 SDK 自带的 `NaturalEarthII`，按其发布 XML 使用 Geographic 分块、反向 Y、0～2 级。这是加载验证数据，不能当作业务底图精度。

先关闭默认渲染循环，完成监听与底图设置后再开启。`postRender` 中可见瓦片加载完成后发出就绪；隐藏时关闭渲染循环和相机输入，恢复先调整画布尺寸再请求渲染。资源错误或渲染错误会进入失败状态，在 SDK 事件调用栈结束后释放画布，再由重试重建。

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
3. 单独用 Vite 库构建编译 `DevCesiumPage.tsx` 与 `cesium-runtime.ts` 两个入口，包含动态 map-cesium 分块；临时输出在 `apps/web/node_modules/.tmp/cesium-build`，不入库。普通生产构建会裁掉开发页，不能用它代替这项构建

3D.2a 完成后再次执行上述三项构建，均通过。按本轮要求只做构建，未启动本地服务；未运行测试、改坏验证、lint、类型检查或性能探针。3D.1 已补异步生命周期回归；3D.2a 新增桥接规则测试，以及使用真实 Cesium Camera 数学运算的 Node 用例（横竖屏、缩放往返、ENU 朝向、天空、范围收敛和精确快照），这些测试均尚未执行。已有 `sm-crypto-v2` 的浏览器外部模块提示和大分块提示仍保留。

后续浏览器验收：本地底图真实显示；网络请求均为本地资源；根路径和部署子路径的 Worker、图片、CSS 路径；缺失资源后重试；相机读数、倾斜与方位的往返误差、惯性操作后暂停恢复；反复创建、暂停、释放与 WebGL 上下文数量；缓存页面停用期间无渲染。上述结果尚未验证。
