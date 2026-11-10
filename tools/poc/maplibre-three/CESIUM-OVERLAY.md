# Cesium 上叠一块 Three.js 画布画 LCC2

验证 Cesium 引擎下能不能看 LCC2：Cesium 的画布照常画底图和倾斜模型，上面盖一块透明的 Three.js 画布，用 `gaussian-splat-lite` 画高斯泼溅，每帧把 Cesium 的相机同步过去。两块画布是两个 WebGL 上下文，不共用深度缓冲。

**这个分支不合入 main。** 结论、截图和结果目录不进分支。

## 要准备什么

和 `README.md` 相同：仓库、Node 24、pnpm，`local/3dt/XZ_GC_3DT`（倾斜模型）和 LCC2 样例目录。不在默认位置时设置环境变量 `YZT_LOCAL_DIR`（包含 `3dt` 的目录）和 `LCC2_DIR`（LCC2 样例目录）。

在 `tools/poc/maplibre-three` 目录安装两个工程的依赖（LCC2 工程这次多了 Cesium）：

```bash
pnpm install --ignore-workspace --config.strictDepBuilds=false
```

```bash
pnpm -C lcc2 install --ignore-workspace --config.strictDepBuilds=false
```

## 手动看

```bash
pnpm -C lcc2 dev:cesium
```

浏览器打开 `http://localhost:5283/cesium.html`。鼠标和键盘都由 Cesium 接收，Three 的画布不接收输入。左上角的面板是当前的读数。

| 地址参数 | 作用 | 默认 |
|---|---|---|
| `budget` | 泼溅的预算（个数） | `300000`，有显卡时用 `3000000` |
| `markers=1` | 显示对齐标记：Cesium 画品红圆点，Three 画青色方点，方点应当在圆点正中 | 不显示 |
| `occlusion` | 遮挡的处理：`none` 不处理，`depth` 读 Cesium 的深度，`proxy` 在 Three 里再加载一份倾斜模型只写深度 | `none` |
| `depthBias` | `occlusion=depth` 时把遮挡物往后推多少米，两份数据表面重合时减少互相穿插 | `0` |
| `eye=x,y,z,heading,pitch` | 第一人称，站在 LCC2 的局部坐标上，如 `eye=120,80,-31.72,0,0` 是下沉广场 | 俯瞰 |
| `walk=1` | 第一人称时 WASD 走、左键拖动转头，不做碰撞 | 关 |
| `heading`、`pitch`、`range` | 俯瞰的方位、俯角（向下为负）、到广场中心的距离（米） | `0`、`-45`、`420` |
| `basemap=none` | 不要影像底图 | ArcGIS 影像 |
| `tiles=0` | 不加载倾斜模型 | 加载 |
| `continuous=1` | 两边每帧都重画 | Cesium 按需渲染，Three 只在相机变了或泼溅有更新时重画 |
| `sync=lag` | 对照：Three 故意用上一帧的相机画 | 同一帧 |
| `rtc=0` | 对照：Three 的世界直接用地心坐标 | 用局部坐标 |
| `lift`、`dx`、`dy`、`yaw` | 样例的配准（米、度）；默认值只适用于彭城广场这份样例 | `29.58`、`-15.3`、`83.4`、`0` |
| `scale` | 两块画布的分辨率倍数 | `1` |

控制台里的 `ov` 是测试接口，常用的：

```js
await ov.setOcclusion('depth');            // 换遮挡的做法：'none'、'depth'、'proxy'
ov.addCesiumBox(34, -75, -11, 30);         // 在 Cesium 里放一个 30 米的红方块（LCC2 局部坐标）
ov.setPlacement({ lift: 14.58 });          // 泼溅整体下沉 15 米
ov.setSplatVisible(false);                 // 只看 Cesium
ov.setLocalEye(120, 80, -31.72, 0, 0);     // 第一人称
ov.setGroundDepthTest(true);               // 地表挡住它下面的东西（Cesium 默认不挡）
ov.setUnderground(true);                   // 应用里的钻地：地表半透明，相机能到地球表面以下
await ov.measureMarkers();                 // 两块画布上标记的质心差（要 markers=1）
ov.stats();
```

## 在有显卡的机器上复测

关掉其他占显卡的程序，插上电源，在 `tools/poc/maplibre-three` 目录运行：

```bash
pnpm overlay
```

会先构建，再弹出浏览器窗口，不要关，也不要最小化。只有软件渲染的机器上全部项目跑了 31 分钟（30 万个高斯、1280×800），有显卡时应当快得多，没有实测。结果在 `results/overlay-<时间戳>/`：`report.md`、`raw.json`、`screenshots/`。**把整个目录带回来，不要提交。**

| 选项 | 用途 |
|---|---|
| `--only align,perf` | 只跑部分项目：`align`、`lag`、`rtc`、`occlusion`、`underground`、`memory`、`perf` |
| `--budget 6000000` | 俯瞰时泼溅的预算，默认 300 万 |
| `--fp-budget 3000000` | 第一人称时的预算，默认和 `--budget` 相同 |
| `--viewport 1920x1080` | 视口，默认 1600×900 |
| `--basemap none` | 没有网络时用 |
| `--skip-build` | 用上一次的构建产物 |
| `--help` | 全部选项 |

软件渲染时脚本会直接退出（`--allow-software` 只用来确认脚本能跑）。

### 各个项目量什么

| 项目 | 内容 |
|---|---|
| `align` | 同一个地心坐标在两块画布上各画一个标记，同一帧里读两块画布比质心：静止四个视角、转动、拉近、压低视角、改窗口大小和设备像素比；按需渲染时静止和动一下各重画几次 |
| `lag` | 对照：Three 用上一帧的相机画，偏差有多大 |
| `rtc` | 对照：Three 的世界用地心坐标时近处的画面稳不稳 |
| `occlusion` | Cesium 里的方块、下沉到模型地面以下的泼溅、沉到地球表面以下的泼溅（这一项打开了 `depthTestAgainstTerrain`），三种做法各截图并数像素 |
| `underground` | 第一人称站在下沉广场里；再把数据放回原始高度、打开应用的钻地，相机落到椭球面以下 |
| `memory` | 两个上下文各自申请的显存，分阶段：只有 Cesium、加一块空的 Three 画布、加载泼溅、两种缓解办法 |
| `perf` | 每帧的成本，分阶段：只有 Cesium、叠上泼溅、两种缓解办法；静止和转动，分开记两个上下文的 JS 和 GPU 耗时 |

### 脚本判断不了、要人看的

用 `pnpm -C lcc2 dev:cesium` 打开页面，`budget=3000000`：

1. **拖动、缩放时两块画布有没有相对滑动：** 加 `markers=1`，快速拖动，方点应当始终在圆点正中。再加 `sync=lag` 对比，知道滑动是什么样子。
2. **转动时泼溅的排序有没有闪：** 排序在后台完成，转得快时会有一两帧用旧的顺序。
3. **`occlusion=depth` 的手感：** 这时相机一动 Cesium 就要画两遍，看拖动是否明显变卡；边缘有没有一圈漏出来的泼溅。
4. **第一人称：** `eye=120,80,-31.72,0,0&walk=1`，走动和转头是否跟手；泼溅没盖住的地方（天空、缝隙）露出的是 Cesium 的画面，看是否突兀。
5. **改窗口大小、把窗口拖到另一块缩放比例不同的屏幕上：** 两块画布是否一直对齐。

## 做法

- **坐标：** Three 的世界是局部坐标，原点在样例的 `offset` 处（x 东、y 上、z 南）。Cesium 的相机矩阵在 JS 的双精度里先换到这个局部系，再交给 Three，显卡上的数值只有几百米。
- **帧的对齐：** 页面自己写渲染循环（`useDefaultRenderLoop: false`）。每帧先让 Cesium 把相机定下来（`initializeFrame`，惯性、飞行、控制器都在这里），Cesium 画完后在同一个任务里同步相机、画 Three，两块画布在同一次合成里更新。Cesium 仍然是按需渲染；Three 只在相机变了、画布尺寸变了，或者泼溅库通过 `onDirty`、`onChange` 要求重画时才画，但 `streaming.update()` 每帧都调。
- **尺寸：** Three 画布的绘图缓冲尺寸每帧照抄 Cesium 画布的 `width`、`height`，CSS 尺寸都是容器的 100%。窗口大小、设备像素比、`resolutionScale` 变了都跟着变。
- **配准：** 样例的 `offset` 不准，修正量放在这个输入自己的 `transform` 上（`addSource`、`setSourceSettings`），不放在 `streaming.group` 的矩阵上。
- **遮挡的两种缓解：**
  - `depth`：Cesium 多画一遍，用一个后处理把每个像素到相机的距离压成 24 位颜色画到自己的画布上；Three 立刻用 `texImage2D` 把这块画布读成纹理，先用一个全屏的面把它写进深度缓冲，泼溅再做深度测试。之后 Cesium 再画正常的一遍。全部用公开接口。
  - `proxy`：Three 里用 `3d-tiles-renderer` 再加载一份倾斜模型，材质只写深度。只管得了这份模型，Cesium 里的其他东西和地球表面不在里面。

## 接着做时要知道的

1. 相机不动时改 `streaming.group.matrix`，泼溅库不会重新取它，画面停在旧位置；每帧都重画、相机一直在动时看不出来。改摆放用 `setSourceSettings(id, { transform })`。
2. Cesium 默认不拿地表挡模型（`depthTestAgainstTerrain` 是 false），这时读到的深度里也没有地表；应用只在钻地时打开它。
3. 站在 LCC2 里面时，倾斜模型的表面像盖子一样罩在外面，`occlusion=depth` 会把泼溅全部挡掉。进到里面看要先把这个范围内的倾斜模型隐藏。
4. Cesium 的后处理不要开关 `enabled`（每次都会释放、重建资源），用 uniform 切换输出，后处理一直开着。
5. Cesium 画完距离以后，要用 `renderer.initTexture(texture)` 当场把画布传进 Three 的纹理；等 Three 自己到用的时候再传，画布已经被颜色盖掉了。
6. 读两块画布的像素要在画完的同一个任务里，而且两边都要在这一帧画过（按需渲染时不一定）。
7. Cesium 的视锥多于一个时，后处理里读到的深度只有最近的一段（`ov.stats().cesiumFrustums`）；半透明的东西不写深度。
8. 两个上下文的 `powerPreference` 要一致，否则双显卡的机器上可能落在不同的显卡上，画布到纹理的复制会退回 CPU。

## 文件

| 位置 | 内容 |
|---|---|
| `lcc2/cesium.html`、`lcc2/src/cesium-page.ts` | 页面：Cesium、Three 的画布、渲染循环、测试接口 |
| `lcc2/src/overlay-depth.ts` | 读 Cesium 深度的两半：Cesium 的后处理和 Three 的全屏深度面 |
| `lcc2/src/overlay-probe.ts` | 每个上下文的 GPU 计时、等 GPU 画完再开始下一帧、按颜色找标记的质心 |
| `lcc2/src/overlay-glmem.ts` | 记一个上下文申请了多少显存（`?glmem=1`） |
| `lcc2/src/placement.ts` | LCC2 局部坐标到地心坐标的换算，和 MapLibre 的页面共用 |
| `tools/overlay.mjs`、`tools/lib/overlay-report.mjs` | 复测脚本和报告 |
