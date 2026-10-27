# 0082. 三维覆盖物：只换坐标的点数上限、重建时等新实体画好

- 状态：已接受
- 日期：2026-10-27
- 修正 ADR 0080 第 1 节的"只改坐标"和"旧的留到新的画好"；补充 ADR 0079 第 5 节的拾取

## 背景

2026-10-27 用户反馈：三维放大到约 13 级以上，拖动、缩放明显卡顿，控制台约每秒出现一次 `[Violation] 'requestAnimationFrame' handler took <N> ms`（当时勾选着资源，以为和资源有关）。

本机没有独立显卡（Chromium 用的是微软基本渲染驱动），用 Playwright 在真实页面复现：切到三维、放大到 14 级后拖动两次、滚轮两次，录 CPU 采样和长动画帧（Long Animation Frame）：

| | 用时 | 长帧 | CPU | 主要耗时 |
|---|---|---|---|---|
| 勾选资源 | 41.5 秒 | 70 帧，共 44.6 秒 | 42 秒 | 贴地线的几何生成（`generateGeometryAttributes`、`pack`、`combineGeometries`、`GroundPolylineGeometry.createGeometry` 等），都在每帧的 `render` 回调里 |
| 不勾选资源 | 41.6 秒 | 69 帧 | 42 秒 | 同上 |

和资源无关。原因是 ADR 0080 第 1 节的"样式不变、形状个数相同就只改坐标"：

- 只改坐标的实体把坐标换成每帧读取的 `CallbackProperty`，Cesium 把它当成动态几何，每一帧都在主线程上同步重建（`DynamicGeometryUpdater`，`asynchronous: false`）
- 这条路本来是给测量画线的（几十个点），但边界每跨一级按新的容差重新简化，样式和个数不变、坐标变了，也走了这条路；之后省界、市界每帧重建一次
- 级别低时简化得多、点少，看不出来；到 13 级左右几乎不简化，上万个点，一帧几百毫秒

修好以后在真实页面验证跨级缩放时又发现：南京的区划高亮在重建时空白了约 2 帧。原因是 `DataSourceDisplay.ready` 第一次就绪后一直为 `true`（Cesium 源码："once the DataSourceDisplay is ready it should stay ready"），ADR 0080 用它判断"新的画好了"，其实只在第一次加载时有效。3D.2 的浏览器测试只改了线宽：新旧在 Cesium 的同一个静态批次里，批次自己会把旧图元留到新的建好，所以没有暴露；旧的是动态实体、或者换了颜色换到别的批次时，旧的一撤就空白。

剩下的一处主线程开销是拾取：状态栏的经纬度每次相机变化都拾取一次鼠标下的点，`CesiumScene.pick` 一律先 `scene.pick` 看是不是模型，多画一遍拾取缓冲再 `readPixels`；没有模型时注定落空。

## 决定

### 1. 只换坐标的点数上限

- 图层再次推导时，形状个数、样式都没变，且换之后线和面的点数合计不超过 500，才只换坐标（改成每帧读取）；否则按重建处理
- 点不计：点的位置本来就每帧更新，不重建几何
- 只看换之后的点数：每帧要重建的是换之后的几何
- 判断写成纯函数 `movableInPlace`（`overlay-update.ts`，不导入 Cesium），在 node 下测试

### 2. 重建时等新加的实体画好

- 改看 `clock.canAnimate`：`CesiumWidget` 默认（`allowDataSourcesToSuspendAnimation`）每帧把 `dataSourceDisplay.update` 的结果写进去，有实体的几何还在建就是 `false`，不会一次就绪后一直为 `true`。两者都是公开的属性；`dataSourceDisplay.getBoundingSphere` 能逐个实体查询，但它和 `BoundingSphereState` 是 Cesium 的私有接口，类型声明里没有
- 为 `true` 时才移除被替换的实体；"画面稳定"（`settle`）同样看它，不再看 `dataSourceDisplay.ready`
- 检查仍在 `postRender` 里：一帧里先 `initializeFrame`（相机变化在这里触发，跨级重新推导就发生在这时），再 `clock.tick`（`dataSourceDisplay.update`），最后渲染；所以 `postRender` 读到的结果已经算上了相机变化时新加的实体

### 3. 没有显示着的模型时不拾取模型

- `CesiumScene.pick` 只在有显示着的瓦片集时才 `scene.pick`，否则直接取椭球面上的点

## 结果

同样的操作（软件渲染）：

| | 用时 | 长帧 | CPU |
|---|---|---|---|
| 修改前 | 41.5 秒 | 70 帧 | 42 秒 |
| 加上点数上限 | 5.3 秒 | 31 帧 | 5.7 秒 |
| 再加上按需拾取 | 4.2 秒 | 15 帧 | 4.6 秒 |

剩下的是软件渲染本身（`readPixels` 主要来自 Cesium 相机控制器拖动、缩放时读深度，`(program)`、`bufferData`），JS 里没有明显的热点。

## 后果

- 好处：跨级缩放后拖动、缩放不再每帧重建边界；重建时不空白
- 代价：边界每跨一级在 Worker 里重建一次（异步，旧的留到新的画好）；测量线超过 500 个点时每次移动都重建（实际用不到这么多点）
- 待定：有显卡的机器上由用户复查流畅度；500 这个上限按以后的实测调整

## 验收

- 纯函数（node）：小图层只换坐标、样式或个数变了重建、点数超过上限重建、点不计
- `CesiumScene`（浏览器）：先只换坐标（变成动态实体），再在相机变化的回调里重建，之后 90 帧每帧都看得到线
- 改坏验证：去掉点数上限，单元测试断言失败；改回按 `dataSourceDisplay.ready` 移除，浏览器测试有 2 帧看不到线、断言失败。检查放在 `clock.onTick` 还是 `postRender` 结果相同（相机变化早于 `update`），所以留在原来的 `postRender`
- 页面：真实页面录制前后对比（上表）；定位南京后跨 8→6→8 级，每次跨级后连拍，区划高亮和边界都在
