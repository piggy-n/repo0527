# 0168. 二维、三维的鼠标操作方式按部署选：MapLibre 自带的或 Cesium 式

- 状态：已接受（2026-11-17 用户要求评估"二维、三维的鼠标操作方式，MapLibre 式和 Cesium 式排列组合"，选了推荐的二维 MapLibre、三维 Cesium 式，开关放在 `.env`）
- 日期：2026-11-17
- 补充：ADR 0034（交互工具和手势）、0056（按住修饰键临时拖动）、0147 第 2 节（同一个 MapLibre 视图担任二三维）

## 背景

- 二维、三维是同一个 MapLibre 视图（ADR 0147），鼠标都是 MapLibre 自带的：左键拖平移，右键拖（或 Ctrl + 左键拖）旋转和倾斜，滚轮朝鼠标缩放，双击放大，Shift + 拖拉框放大。
- 旧系统（zhjsqdxin）二维是 mapbox-gl，和现在一样；三维是 Cesium，用的是 Cesium 默认的操作，只开关过、没改过按键。ADR 0153 删掉的 Cesium 引擎也是这样。所以用户的三维习惯是 Cesium 的：右键拖是缩放，不是旋转。
- 两种操作最大的差别在右键：MapLibre 右键拖旋转和倾斜，Cesium 右键拖缩放；Cesium 的旋转和倾斜在中键拖、Ctrl + 左键拖。
- MapLibre 6.12 不能改按键和手势的对应（`dragRotate` 只能整体开关，右键和 Ctrl + 左键写死在它的处理里），Cesium 式要自己处理。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 组合 | 二维、三维都是 MapLibre（现在）；二维 MapLibre、三维 Cesium 式；都是 Cesium 式；二维 Cesium 式、三维 MapLibre | 二维 MapLibre、三维 Cesium 式（用户按推荐）：就是旧系统的手感，只改三维，驾驶舱、查询等二维页面不受影响。代价是同一张图切换二三维时右键的含义会变，旧系统本来也这样。代码按维度一个参数，别的组合改配置就有 |
| 开关放在哪 | `.env`，按部署；代码里的常量（`shared/config/*-options.ts`）；用户自己选（界面 + 偏好） | `.env`（用户按推荐）：二维、三维各一个变量，界面上没有开关，不按账号记 |
| 怎样做到 Cesium 式 | 换掉 MapLibre 的整套手势；关掉 MapLibre 的旋转手势，右键、中键自己处理 | 只关旋转手势：左键平移、滚轮、双击、Shift 拉框、触摸都照用 MapLibre 的，自己处理的只有右键拖、中键拖和 Ctrl + 左键拖 |

## 决定

### 1. 操作方式

- `maplibre`：MapLibre 自带的，同现在。
- `cesium`：
  - 左键拖平移、滚轮朝鼠标缩放、双击放大、Shift + 拖拉框放大，同 MapLibre。
  - 右键拖缩放：往下拖放大、往上拖缩小（同 Cesium），每 100 像素一级，按下的位置在缩放时不动。
  - 中键拖、Ctrl + 左键拖：旋转和倾斜，绕视野中心；速率和方向同 MapLibre 的右键拖（横向每像素 0.8°，往上拖抬起视角、每像素 0.5°）。当前工具把 Ctrl 用作临时拖动（框选、画矩形，ADR 0056）时，Ctrl + 左键仍是临时拖动，旋转用中键。
  - 地图上没有浏览器的右键菜单（MapLibre 的旋转手势开着时也没有）。
  - 不做 Cesium 的 Shift + 左键原地转视角，也没有惯性。
- 做不到和 Cesium 一样的：MapLibre 的中心总在地面上，相机不能低于 0 米，俯角有上限（三维 85°），所以抬头看天、钻到地下、绕着模型上的某个点转都和 Cesium 不同。左键拖动抓住的是地面，模型相对底图滑动（见 `docs/backlog.md`），这次不改。

### 2. 开关

- `.env` 的 `VITE_MAP_MOUSE_2D`、`VITE_MAP_MOUSE_3D`，取 `maplibre` 或 `cesium`，提交的是二维 `maplibre`、三维 `cesium`；只在 `app-config.ts` 读、校验，写错时启动就报错。
- app 在地图页外面那一层（`app/map-runtime-provider.ts`）`provide(MAP_MOUSE_SCHEMES, appConfig.mapMouse)`，经 `withMapRuntime` 的地图页都按它；没有 provide 时（驾驶舱等不经这一层的、测试）二三维都是 MapLibre 自带的。

### 3. 实现

- map-core 的 `view/cesium-drag.ts`：`CesiumDrag` 不认识引擎，和 `ModifierPan` 一样在画布容器的捕获阶段截下右键、中键、Ctrl + 左键的按下（引擎和工具都收不到），按文档上的移动交给视图缩放、旋转。
- MapLibre 适配器按当前种类：用 `cesium` 的种类关掉 `dragRotate`（右键拖、Ctrl + 左键拖），换回 `maplibre` 时只打开自己关掉的；在进入 ready、切换工具、切换种类、漫游结束时应用。缩放用 `easeTo` 的 `around`（按下的位置），旋转用 `easeTo` 改方位角和俯角，都是 `duration: 0`、来源 `user`。
- 漫游接管时不截（漫游自己处理键鼠）；漫游只恢复自己关掉的手势，结束后 `dragRotate` 仍然关着。视图暂停、三维模块没加载好时不截。

## 后果

- 三维里右键拖从旋转变成缩放；旋转和倾斜改用中键或 Ctrl + 左键。二维不变。
- 换组合只改 `.env` 重新构建，不改代码；内网有差异时写在 `.env.intranet`。
- 只按鼠标区分，触摸照旧用 MapLibre 的双指手势。
- 以后要让用户自己选，再加界面和偏好，适配器已经按参数工作。
