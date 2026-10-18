# 三维 3D.0：接入范围、样式支持与小样验证

日期：2026-10-17。状态：代码盘点、API 核对和无浏览器的数据小样已完成；[ADR 0064](../adr/0064-three-dimensional-integration-scope.md) 已于 2026-10-18 接受。本文记录 3D.0 的证据，后续运行时进度见 [map-cesium](../modules/map-cesium.md)；画面、交互和性能未验收。

## 1. 基线与这一步的边界

- 新项目基线：`60afe8b`，分支 `codex/3d-integration`
- 旧项目：`C:\WebProject\yzt` 的 `master-demo`，当前为 `6b4799b922efb2ed276cc28122fbe78527234b75`
- 已比较 `836f03b..master-demo` 的 `src/views/current-map-new/cesium/` 和 `src/views/current-map-new/composables/useEngineSwitch.js`，没有差异；三维模块本次迁移基线登记为 `6b4799b`
- 本轮不安装 Cesium、不改应用实现、不启动本地服务。直接读取旧项目已安装的 `cesium 1.145.0` / `@cesium/engine 26.3.0`，只向既有内网瓦片接口发起只读请求
- 旧项目 `package.json` 声明的是 `cesium: ^1.142.0`；上面的 1.145.0 是实际安装版本。本项目接入时按 ADR 0002 精确锁定，不能照搬旧的范围声明

已有：会话持有样式、相机、工具和选择；`MapView` 定义加载、暂停、恢复、失败、释放、定位、拾取、投影、渲染要素查询；map-vue 已处理相机操作、浮层避让、页面缓存。

缺口：`libs/map-cesium` 不存在，`app/map-framework.ts` 只有 `'2d'`，`MapCanvas` 直接创建二维视图；工具模型尚无“目标视图不支持时暂停并保留已确定顶点”的机制。不能把新增一个下拉选项视为三维接入完成。

## 2. 旧项目的真实功能范围

以下确认的是代码调用链，不表示本轮运行过旧页面。表中的文件均位于旧项目的 `src/views/current-map-new/`，同一行省略重复的目录。

| 功能 | 旧代码证据 | 建议安排 |
|---|---|---|
| 首次懒加载、二三维切换、相机同步 | `index.vue` 使用 `composables/useEngineSwitch.js`；组合式函数动态导入 `cesium/CesiumEngine.js` | 3D.1、3D.2 |
| 底图、资源、GeoJSON 镜像 | `cesium/CesiumStyleMirror.js`、`XyzImageryProvider.js`、`MvtRasterLayer.js`、`GeoJsonOverlayLayer.js` | 3D.3 |
| 旧 MVT 解码、栅格化、标注 | `cesium/MvtTileWorkerPool.js`、`mvtTileWorker.js`、`tileRenderer.js`、`MvtLabelLayer.js` | 参考算法；按新样式实际需求迁移 |
| 本地模型、白膜与钻地 | 页面实际挂载 `components/LocalTilesetControls.vue`，调用 `LocalTilesetPreview`、`WhiteModelLayer` 和钻地开关 | 独有能力后续单独排期 |
| 第一/第三人称漫游、步速、出生点、脱困 | 控件调用 `useEngineSwitch` 的漫游方法，后者创建 `FirstPersonRoam` | 独有能力后续单独排期 |
| 室内小地图、完整地图与瞬移 | `FirstPersonRoam` 导入并创建 `indoorMap/IndoorMap`，它组装两种地图视图 | 随漫游评估，不当成未使用代码删掉 |

不沿用旧结构：监听 `styledata` 再整份对比、260 ms 相机回声窗口、改写原生 `setLayoutProperty`、测量时覆盖透明二维画布、依赖 `map.transform`。分别由会话事件、`cause`、视图内部显示策略、统一工具输入和公开相机接口替代（ADR 0020、0024、0039）。

## 3. 当前样式的支持矩阵

这是**实施目标**，不是已实现清单。第一批覆盖实际生成的 `background`、`raster`、`fill`、`line`、`circle`；当前业务没有 `symbol` 图层。位置图钉、测量文字和提示由 Vue 浮层显示，依赖 `project()`，不需要先迁移旧的 MVT 标注系统。

“可差异”只允许明确记录的渲染差异；不得通过改会话状态、编辑器或后端数据掩盖不支持的样式。

| 内容 | 当前来源/行为 | 三维首期目标与验收重点 |
|---|---|---|
| 背景与栅格底图/注记 | `shared/map/basemap`；天地图 `_w`，有效级别 1～18 | 影像层遵守级别、透明度和开关；天地图关闭时不请求。离线小样用本地影像 |
| MVT 数据源 | `resource-layers.ts`；XYZ 模板、最大数据级别 15；`sourceLayerOf` 有两个名称例外 | 复用瓦片集和字段定义；高于 15 级按既定数据上限显示，不为了空瓦片改数据方案 |
| 分类配色与过滤 | `resource-symbols.ts`、`match-expression.ts`、`symbols.ts` | 复用 style-spec 求值；覆盖 `get`、分类匹配、默认值、几何类型过滤和 zoom 表达式，不另写业务配色表 |
| 资源可见性、年份、顺序、透明度 | `useResourceLayers` 推导整个 `resources` 分组 | 切换视图保留同一状态；透明图层的上下关系要正确，不能只验证各层单独能显示 |
| 面填充与描边 | `symbols.ts`：填充、花纹、描边拆层；描边有宽度与内收 `line-offset` | 保留颜色、宽度与层序；瓦片边界不凭空加描边。内收偏移和抗锯齿须用截图对照 |
| SDF 花纹 | `fill-patterns.ts`；`fill-pattern` 按 zoom 的 `step` 切三档，颜色独立 | 保留图案含义和分类取值；验证换档、缩放与跨瓦片接缝。不能把所有花纹改成实色视为支持 |
| 线型与尺寸 | `symbols.ts`：`line-dasharray` 常量拆层，`line-width` 随 zoom 插值，圆角端点 | 实线、虚线、点划线及宽度变化都纳入小样；斜视下的像素外观可以不同，业务线型不能丢 |
| 点符号 | `circle-color/radius/stroke-color/stroke-width`，半径随 zoom 变化 | 颜色、尺寸和描边可辨，验证前后遮挡和缩放；不能将 MapLibre 半径直接当 Cesium 点直径 |
| 行政区边界与定位高亮 | `boundary-style.ts`、`region-style.ts`：GeoJSON，多层描边、虚线、选区填充 | 先支持简单 GeoJSON，再补多层线；边界光晕/模糊可提议简化，须记录差异并确认 |
| 单个和批量选择 | `selection-style.ts`；单个完整几何，批量跨分组引用 MVT、按 `guid` 过滤 | 选择身份不变；批量高亮引用正确年份的数据源，不为高亮复制一套业务状态 |
| 区划裁剪 | `region-clip.ts` 的世界矩形挖洞；查询使用 `readyBoundary` | 三维需要球面适用的遮罩方案。跨经线、大面、洞、岛屿和斜视必须单独验证；不能直接把 ±180° 的二维矩形作为球面面片 |
| 测量与位置浮层 | `measure-style.ts` 的 GeoJSON 与 Vue 浮层，`LocationOverlay` | 复用椭球面计算，切换不重算结果；地球背面或投影无效时隐藏浮层，未确定的鼠标点丢弃 |

实际分组顺序为 `basemap → resources → selection → region-clip → basemap-labels → boundaries → region → measure`。三维不能只按引擎对象的创建顺序假定等价，要验证遮罩只覆盖它应该遮住的内容、注记与测量仍处于约定的上层。

不属于首期承诺：新的 `symbol` 碰撞布局、`fill-extrusion`、任意第三方 MapLibre 样式、空间直线测量与贴地测量。新需求出现后再扩展支持清单。

## 4. 原生 MVT 与 Worker 栅格化的对照

| 项目 | Cesium 原生 MVT | 既定 Worker 栅格化 |
|---|---|---|
| 数据读取 | 已有公开 `MVTDataProvider`，直接读 XYZ MVT | 需要实现数据服务、解码与调度；已有统一 Worker 通信层 |
| 样式 | `Cesium3DTileStyle`，不是 MapLibre style-spec；现有表达式需要适配 | 继续用 style-spec 求值，再实现绘制子集 |
| 当前公开属性 | 点的色/显隐/尺寸/描边，线的色/显隐/宽度，面的色/显隐 | 花纹、虚线、多次绘制与合成由自己的绘制器负责，仍需验证正确性 |
| 选择 | SDK 可拾取原生要素，但不等于项目现有查询接口已经支持 | 栅格图片本身不能给出要素；首期沿用后端识别 |
| 图层顺序与裁剪 | 原生几何、深度关系与 MapLibre 层序需另做映射 | 影像合成更接近既有顺序，但与 GeoJSON 和遮罩的关系仍需验证 |
| 初始化与规模 | 1.145 初始化时建立整个范围内的瓦片层次；接口标为 experimental | 需要按需调度与内存预算；不能未经实测照搬旧 Worker 数量和缓存上限 |
| 本轮结论 | 数据接通有证据；不能作为现有样式的直接替代 | 建议保留为主线；尚无新的渲染或性能验证 |

证据来自实际包的 `Source/Cesium.js` / `Source/Cesium.d.ts` 导出，以及 engine 的 `MVTDataProvider.js`、`UrlTemplate3DTilesDataProvider.js`、`VectorGltf3DTileContent.js`。后者的 `applyStyle` 分别读取点、线、面的上述属性，没有花纹、虚线、面描边的对应入口。这不等于 Cesium 不能定制这些效果，而是不能将现有样式直接交给该 API。

公开资料：[1.145 的 MVTDataProvider 源码](https://github.com/CesiumGS/cesium/blob/1.145/packages/engine/Source/Scene/MVTDataProvider.js)、[运行时瓦片树源码](https://github.com/CesiumGS/cesium/blob/1.145/packages/engine/Source/Scene/UrlTemplate3DTilesDataProvider.js)、[官方 MVT 教程](https://cesium.com/learn/cesiumjs-learn/load-mapbox-vector-tiles-in-cesiumjs/)。评估针对精确版本，不把网站后续更新当成该版本已具备的能力。

### 4.1 真实瓦片的小样结果

取南京附近 `[118.8, 32.05]` 所在的 `14/13598/6650`，直接 GET 既有内网 `/api/tiles/<瓦片集>/14/13598/6650.pbf`，不带登录凭据；各请求返回 200。只处理在内存里的数据，没有把业务瓦片或属性值保存到仓库。

使用旧项目已安装 engine 的 `decodeMVT` 和 `buildVectorGltfFromMVT`，后者设置 `featureIdProperty: 'guid'`。这些是**实验里直接调用的内部函数，不能作为新应用的依赖接口**。

| 瓦片集 | 原始字节 | 几何/要素数 | 有 `guid` 的要素 | 转换后 GLB 字节 |
|---|---:|---|---:|---:|
| `bgdc_dltb_2022` | 70,995 | Polygon / 301 | 301 | 357,904 |
| `csxhjctb_hydl_2025` | 1,468 | LineString / 6 | 6 | 9,664 |
| `csxhjctb_gyssp_2025` | 8,568 | Point / 60 | 60 | 19,036 |

输入 SHA-256，便于后端数据变化后识别是不是同一批样本：

- 面：`840078740027173d6f6c92458081d779891298642415567d1c1c6ef68c4d19c0`
- 线：`955c70ec457458fd052c147347a197bb7f52b937a093eff695295b4c0b7cb309`
- 点：`98741df3705fe3c6c43f9ddf1125347e6f48ca15d7d9ed028cec9e560930bcfd`

复现关键步骤（临时 Node 脚本，按本机旧仓库位置调整导入路径；不需要服务）：

```js
import decodeMVT from 'file:///C:/WebProject/yzt/node_modules/@cesium/engine/Source/Scene/decodeMVT.js';
import buildVectorGltfFromMVT from 'file:///C:/WebProject/yzt/node_modules/@cesium/engine/Source/Scene/buildVectorGltfFromMVT.js';

// tileUrl 指向上面的一张真实瓦片；不把环境地址和业务数据写进应用源码
const response = await fetch(tileUrl, { signal: AbortSignal.timeout(15000) });
const buffer = await response.arrayBuffer();
const decoded = decodeMVT(buffer);
const glb = buildVectorGltfFromMVT(
  decoded,
  { tileX: 13598, tileY: 6650, tileZ: 14 },
  { featureIdProperty: 'guid' }
);
```

这只验证了数据解析与几何转换。未创建 `Viewer`、未调用公开 provider 的完整加载流程、未验证 WebGL 画面/拾取/样式，未测浏览器帧率或内存，也未与新的 Worker 绘制器对比。GLB 字节数不是显存占用。点样本带 `guid` 不代表它的后端分页接口已支持识别，不能据此修改能力表。

### 4.2 瓦片层次数量估算

用本地省界 `boundary/data/jiangsu-province.json` 的外包范围 `[116.356344, 30.760149, 121.970943, 35.141739]`，调用 Cesium 的 `WebMercatorTilingScheme.positionToTileXY`，逐级统计矩形覆盖的瓦片数，不实际创建树：

| 范围与级别 | 单个 provider 预计节点数（含一个根） |
|---|---:|
| 省界外包矩形，0～15 | 326,385 |
| 同一矩形，8～15 | 326,365 |

只提高最小级别几乎不能减少最深层的节点。这是根据 1.145 建树逻辑和本地范围作的规模估算，不是内存实测，也不是全项目所有资源的总量。若评估原生 MVT，需逐资源确定真实 extent 和级别，不能把默认全球范围直接带进应用。

## 5. 接口与业务契约的收口

- **活动视图**：map-vue 负责切换与缓存，map-core 的会话不依赖 Vue。当前 `attachView` 只允许一个活动画布的约束可保留，缓存的视图由切换拥有者管理；具体接口在 3D.2 用两个真实视图验证后确定
- **切换与失败**：准备目标时仍可使用原视图；目标完成后确认请求仍有效、同步最新会话，再交接输入。加载失败保留原视图。页面隐藏期间不激活目标，不把晚到结果写回活动视图
- **相机**：共用中心/zoom/方位/俯角；三维独有的精确相机另存。以隐藏期间的 `user/program/sync` 判断是否能恢复，使用公开 API，不依赖 MapLibre 内部 transform
- **工具**：切换与页面隐藏结束框选草稿和鼠标提示；测量已确定顶点保留。先支持椭球面拾取与 geodesic 测量，模型/地形加入时再报告对应表面和高度；高度为椭球高，不冒称国家高程
- **点选**：按当前 `IDENTIFIABLE`，只有 `bgdc_dltb`、`bgdc_dltb_czc`、`bgdc_czcdyd`、`csxhjctb_hydl`、`csxhjctb_lvll` 登记了后端范围识别；历史年份待办保持原状。不能承诺所有能显示的三维资源都能查询
- **框选**：三维 `queryRendered()` 为 `[]`，现有渲染要素加权估数没有可用输入，不能把 0 当成实际数量或可靠上限。首期沿用后端第一页与总数、限制查询几何；3D.4 必须验证大范围请求和部分角点拾取失败的行为，要改变估数策略另写 ADR
- **区域范围**：查询继续用真实几何和 `queryGeometry`。三维屏幕框到地表的边缘在斜视时不是简单的经纬度直线，不能未经误差检查就宣称四角连线等于屏幕范围；这是 3D.4 的专项验收/必要时新 ADR
- **默认框架与部署**：首期建议默认二维，但加载和预加载仍经 `defaultMapFramework()`；运行时的配置由 app 注入。按[官方资源部署说明](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/)处理 Workers、ThirdParty、Assets、Widgets，不能把仅有 JS 分块当成部署完成
- **资源释放**：暂停停止输入、渲染和非必要工作；数据任务取消后释放晚到产物，页面卸载释放两种视图。SDK 自有 Worker 与项目自建 Worker 池是两类资源，不能混用管理规则

现行结论以 ADR 0047～0050、0061、0063 为准。早期 ADR 0020 的隐藏二维查询方案、旧文档“没有预加载”的现状描述不再作为实现依据；旧 ADR 正文保留，模块文档注明历史背景。

## 6. 后续小步骤与验收

| 步骤 | 交付 | 完成条件 | 主要知识点 |
|---|---|---|---|
| 3D.0 | 本文、ADR 0064 提议、迁移基线和路线图 | 盘点与数据小样有证据；范围和路线确认后关闭设计项 | 证据分级、支持矩阵、ADR |
| 3D.1 | 运行时、静态资源、最小 Cesium 画布与本地底图 | 挂载/释放/失败重试，公网和内网构建；不增加默认二维入口的 Cesium 静态依赖 | 懒加载、部署路径、资源所有权 |
| 3D.2 | 实现 `MapView` 并接入二三维切换 | 来回切换、准备期间取消、失败保留旧视图、KeepAlive 恢复、相机与浮层避让；视图共用契约检查 | 适配器、状态转换、可替换异步操作 |
| 3D.3a | 简单样式镜像 | 栅格底图和 GeoJSON 点线面，同一会话下正确显隐、排序、变色 | 增量同步、样式求值与渲染分离 |
| 3D.3b | MVT 数据服务与第一张地类瓦片的绘制 | 真实任务驱动 Worker 调度、下载去重、取消和字节预算；再逐项补齐支持矩阵 | Worker 通信、缓存、可转移数据 |
| 3D.3c | 花纹、虚线、高亮和区域遮罩 | 多层半透明、跨瓦片接缝、zoom 换档、同 guid 与切年份、区划外隐藏；需记录画面对照 | 绘制合成、球面几何与身份 |
| 3D.4 | 公共工具、查询、状态栏和验收 | 先按设计稿确认新增界面；验证工具状态、查询范围与限制、反复切换资源释放，并复测加载性能 | 跨视图业务复用、性能测量 |

3D.1 的首个小提交只做运行时和最小画布，不同时实现上表所有内容。地形、3D Tiles、白膜、漫游等独有能力在首期验收后分别讨论。

浏览器验收小样应包括：纯色面/带洞面、所有花纹和线型、不同 zoom 的点线尺寸、两层半透明资源交换顺序、跨瓦片同一 guid、选区含岛和洞、窗口变窄与遮挡、画到一半切换、重复切换和释放。自动化只用本地或合成数据；真实后端仅用于独立实测，不把业务瓦片加入测试夹具。

## 7. 本轮结果与范围确认

已完成旧分支核对、API/类型/实现检查、三类真实瓦片的数据转换，以及省域瓦片层次估算。本轮 `pnpm build` 通过，产物检查通过；只修改文档，没有新增应用依赖或实现。没有运行测试、性能探针或本地服务，也没有浏览器画面验收。上一轮 `60afe8b` 的新增回归用例和性能复测继续留在阶段五验收报告。

2026-10-18 用户接受 ADR 0064：**先现状底图，MVT 保留 Worker 栅格化主线，首期默认二维，模块暂留 libs**。其中状态和查询规则沿用已接受的 ADR；三维独有功能的具体顺序、球面遮罩的实现和 Worker 的性能参数仍留到对应步骤讨论。
