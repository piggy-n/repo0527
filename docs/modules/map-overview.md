# 地图架构总览

地图部分的入口：先看这里，再按主题去读 ADR 和各模块的文档。本文只列现在有效的结论和出处，理由在 ADR 里，用法在模块文档里。

## 分层

```
pages              挑选能力、组合成页面；provideMap 创建会话，绑定样式、登记工具
  ↓
features           业务数据驱动的图层（5C 起：资源图层 features/resource-map、点选、图例）
  ↓
shared/map         项目级的公共能力：底图、行政区边界、默认视角、工具栏、基础组、状态栏、区划定位、坐标定位、地图状态提示
  ↓
packages/map-tools     通用交互：绘制、逐点编辑、测量、框选手势、鼠标旁的提示；和业务、江苏都无关（ADR 0145）
  ↓
packages/map-vue       地图与 Vue 的衔接：会话的提供与注入、画布、样式绑定、相机操作、工具登记、定位可视区域
  ↓
packages/map-core      地图会话（样式、相机、当前工具）、视图接口、MapLibre 适配器、测量计算；不依赖 Vue
  ↓
packages/utils         LatestController、safeReporter、Worker 通信层
```

三维是 MapLibre + Three.js（ADR 0147、0153）：`@mx/map-three`（见 [map-three.md](map-three.md)）放在 map-core 之上，只能由 map-vue 动态导入，只有它（和驾驶舱）能导入 `three`；依赖方向由 lint 检查（ADR 0006）。二三维共用 MapLibre 的画布和视图，三维是地球投影，覆盖物在三维里照常显示，资源图层能在三维里显示、现在 app 注入的能力里关着（等页面重新设计），模型层叠在页面声明的分组（`sceneBelow`）下面；custom layer 的外壳在 map-core 的 MapLibre 适配器里，三维内容在 map-three。

3D.1 起的 Cesium 引擎（`packages/map-cesium`）在 ADR 0147 以后保留为可选，ADR 0153 把它从 main 移除，代码在标签 `cesium-engine-2026-11`（[map-cesium.md](map-cesium.md)）。

## 贯穿全局的几条原则

| 原则 | 一句话 | 出处 |
|---|---|---|
| 会话是唯一真相源 | 样式、相机、当前工具、选择状态在 map-core 的会话里，二维、三维的视图只负责同步 | ADR 0020 |
| 拥有者推导分组 | 每项能力是一个拥有者：持有状态、提供操作，用纯函数推导自己的样式分组，整体替换，页面统一提交 | ADR 0022、0027、0028、0031 |
| 只有适配器写引擎 | 只有 MapLibre 适配器能写二维地图，其他代码通过视图接口查询、投影；二三维共用视图接口，不共用引擎接口 | ADR 0024 |
| 失败是数据 | 加载失败是一种明确的结果；失败原因放在 `failure` 里，提示由纯函数推导 | ADR 0026、0030 |
| 资源有主人 | 持有资源的对象实现 `Disposable`，监听和子对象登记进 `DisposableStack`，释放后等待的操作以 `AbortError` 结束 | ADR 0023 |
| 异步只认有效的结果 | 能收敛的不写成操作；可替换操作在同一通道里只认最新；相机定位是一次操作，等待与再确认由 `run` 负责 | ADR 0038、0039 |

## 按主题的 ADR

只列现在有效的；括号里是被后来的 ADR 修正或补充的部分。

| 主题 | 现在的结论 | ADR | 文档 |
|---|---|---|---|
| 位置与拆包 | map-core、map-three、map-vue、map-tools、utils 是内部包（`packages/*`），单入口；通用交互已拆成 map-tools，`shared/map` 留下的等第二个地图项目的需求清楚了再拆 | 0004、0143、0145 | [internal-packages](../config/internal-packages.md)、[map-tools](map-tools.md) |
| 引擎与版本 | MapLibre GL JS 6，具名导入；不用 mapbox-gl；三维只用 MapLibre + Three.js，不用 `maplibre-gl-three`；Cesium 引擎已移除，代码在标签 `cesium-engine-2026-11` | 0002（大版本由 0019 确定）、0019、0147、0153 | [map-core.md](map-core.md)、[map-three.md](map-three.md) |
| 分层与组装 | 五层的职责；能力按拥有者写，页面挑选组合，不做带开关的全能地图组件 | 0027 | 本文、[shared-map.md](shared-map.md) |
| 会话 | 样式、相机、当前工具、选择状态（只存要素身份）、三维内容（瓦片集、钻地，页面用 `bindScene` 绑定）；二三维共同的唯一真相源 | 0020（选择状态的范围由 0022 修正，方案比较由 0024 修正）、0047、0081 | [map-core.md](map-core.md) |
| 样式模型与提交 | 分组推导、整体替换，跨分组的修改一次提交，视图按修订号增量同步；分组可以带样式图片，图片是快照的一部分 | 0022（`failed` 的含义由 0026 修正）、0045 | [map-core.md](map-core.md) |
| map-vue 上下文 | `provideMap`、`useMap`、`bindStyle`；`view` 只在就绪时有值，只有拾取和投影 | 0028（第 5 条由 0039 修正） | [map-vue.md](map-vue.md) |
| 视图接口与二三维 | 共用生命周期、相机、输入、拾取、投影、渲染要素查询（三维返回空数组）；相机事件带 `view` 和 `cause`；一个视图可以随维度换种类（ADR 0147） | 0024、0047 | [map-core.md](map-core.md) |
| 视图失败 | 样式失败在出现新的提交时自动恢复；引擎失败只能重建视图；状态转换按表执行；带数据源的错误（瓦片出错）不算样式失败，记作视图的数据源错误 | 0026（第 4 条由 0030 修正，第 1、2 条由 0041 修正）、0030、0041 | [map-core.md](map-core.md)"状态转换"、[map-vue.md](map-vue.md) |
| 资源释放与运行时 | `Disposable`、nanoevents；maplibre-gl 的全局设置在登录页空闲时预加载或首次进入地图时懒加载，同时预热 Worker 池 | 0023、0061 | [map-core.md](map-core.md) |
| Worker | 二维不自建渲染 Worker；自建的 Worker 统一用通信层；瓦片数据服务的约束 | 0021（第 5 条由 0024 修正，第 3、4 条由 0025 补充）、0025 | [utils.md](utils.md) |
| 定位可视区域 | 贴边的悬浮元素登记自己，定位时现量现算 padding | 0029 | [map-vue.md](map-vue.md) |
| 底图与内网 | 天地图配置是 `{ key } \| null`；内网差异只写在构建模式的环境文件里 | 0031、0032 | [shared-map.md](shared-map.md) |
| 行政区边界与默认视角 | 本地边界数据；本次进入页面第一次就绪时适配一次江苏 | 0033 | [shared-map.md](shared-map.md) |
| 交互工具 | 会话的工具模型，同一时间一个工具；工具只拿到 `ToolView`；工具栏的按钮和动作由页面给出；交给工具之前发出只读的输入事件，上下文由它得出鼠标位置 `pointer`（5D.3） | 0034、0047、0053 | [map-core.md](map-core.md)、[map-vue.md](map-vue.md)、[shared-map.md](shared-map.md) |
| 地图页的布局 | 资源面板在左；业务组在右上、基础组在右下；右侧两组 Tab 面板（功能：区划定位、坐标定位、资源详情；显示：图例、底图），每组同一时间显示一个内容，隐藏和关闭分开；状态栏在资源面板右边（比例尺、经纬度、不为 0 的角度，不写署名，适配器关掉了 MapLibre 的版权控件）；窄屏时左右只显示一边；目录树的顺序就是叠放顺序（2026-10-30，ADR 0118）；手机宽度（地图区域窄于 768）时面板变窄、图例卡和底图卡叠到工具栏一列（5D.8） | 0053（修正 0034 第 5 节、0043 第 5 节、0052 第 2 节） | [design/page-layout.md](../design/page-layout.md)"画布型"、[shared-map.md](shared-map.md) |
| 地图上的浮层 | 测量的单位和标签、鼠标旁的提示（`PointerHint`）、位置信息只放在可视区域里、当前区划条；点中的位置被面板挡住时用相机控制的 `reveal` 平移（5D.6） | 0055（修正 0035 第 4 节、0037 第 5 节） | [shared-map.md](shared-map.md)、[map-vue.md](map-vue.md) |
| 测量 | 椭球面计算（geographiclib）；`MeasureStore` 持有结果和两个工具 | 0035 | [map-core.md](map-core.md)、[shared-map.md](shared-map.md) |
| 区划定位、坐标定位 | 本地区划目录与边界；经纬度的识别与格式只用纯函数；位置点可拖动 | 0036、0037 | [shared-map.md](shared-map.md) |
| 资源图层 | feature `resource-map`：接口树 → 目录（纯函数，查询的 `select` 得出）→ 样式登记表 → 拥有者 `useResourceLayers`（按 `code` 的显示状态）→ `resources` 分组（底图之上、注记之下）；图层面板的目录树负责浏览、勾选和调整顺序，"已勾选"区按叠放顺序列出；两处调的是同一份顺序（资源图层的 `order`，按目录树连续），地图跟着变（5C.2、5D.2，ADR 0053、0054、0118）；勾选、透明度、顺序、年份按用户记住（5C.3，ADR 0042）；图例从登记表推导，不做地类统计（5C.4，ADR 0043）；符号的覆盖和拖动取色时的预览由拥有者 `useResourceSymbols` 持有，分组和图例都从默认符号、覆盖和预览推导；按属性配色的资源可以换成统一样式，分类样式各取值的符号用 `match` 组合在一个图层里，在图例里编辑（5C.5，ADR 0044）；图例的预览按参考级别的实际像素画出线宽、线型、点的大小和面的描边（5D.5）；未勾选的不放进样式，每个资源一个数据源、默认一个图层，面用到花纹或复杂描边时按需拆出纹理图层、描边图层，花纹是随分组提交的 SDF 图片（5C.5c，ADR 0045）；线和面的描边用到多种线型时按线型拆层，每层的线型是常量，按要素的线型过滤（ADR 0046），重的资源有最小显示级别（部署的 `resource-min-zooms.json` 随目录查询一起读，进入目录的 `Resource.minzoom`，ADR 0132、0137）；目录变化时逐个资源校验；瓦片错误从视图的数据源错误推导 | 0041、0044、0045、0046、0047、0132、0137 | [docs/archive/migration.md](../archive/migration.md)"现状底图：资源图层实测" |
| 点选与框选 | 选择状态只存要素身份（数据源 + `guid`）；二维 14 级以上只用渲染要素，14 级以下和三维由登记的数据集查后端；框选离起点 3 像素起算并屏蔽派生的单击，松手时按渲染要素加权估数，超过 5000 提示缩小范围；批量高亮在瓦片上按 `guid` 过滤 | 0047（第 1、2 节由 0048 修正，框选由 0049 确定）、0048、0049（第 2 节的估数由 0050 修正）、0050 | [docs/archive/migration.md](../archive/migration.md)"点选的实测""框选的实测" |
| 区划裁剪 | 按区划边界几何：区划外用遮罩盖住（按环的嵌套深度构造）；点选、框选按几何限定范围，发给后端的几何误差不超过 2 像素、有效、最多 120 个坐标 | 0051 | [shared-map.md](shared-map.md)"区划裁剪" |
| 资源的年份 | 年份是按 `code` 的显示状态；单个资源各自选，另有批量设置（作用于所有有这一年的资源）；不存"当前年份" | 0052 | [docs/archive/migration.md](../archive/migration.md)"年份的验收" |
| 真实引擎的测试 | 依赖真实 MapLibre 或真实布局的少量用例用 Vitest 浏览器模式，只用本地数据 | 0040 | [vite-config.md](../config/vite-config.md) |
| 相机操作与异步 | 用户发起的定位是一次操作，用信号判断是否作废；操作对象的 `run` 负责等待与再确认；可替换操作只认最新（`LatestController`）；revision / operation / version 各有一个意思 | 0038（第 1、3 条由 0039 修正）、0039 | [map-vue.md](map-vue.md)"相机操作"、[utils.md](utils.md) |
| 点/框选的交互 | 十字光标、跟随提示；关掉拖动平移的工具声明 `panModifier`，按住 Ctrl / ⌘ 临时拖动地图；工具要接管按在手柄上的拖动时声明 `capturesPress` | 0056、0122 | [shared-map.md](shared-map.md)、[map-core.md](map-core.md) |
| 现状底图的界面 | 功能标签与独立详情同列排布、底图 Popover、紧凑图例与编辑视图、面板标题、指北针、状态栏在左下角、上移下移按钮、"已选择图层"；以设计文档"已确认的界面细节"为准 | 0057～0060、0066～0074、0094～0096、0102、0116 | [current-map-reference.md](../design/current-map-reference.md) |
| 控制栏与边界入口 | 不支持三维的地图不显示 2D/3D；底图入口是 `BasemapCard`；除现状底图外的地图页在控制栏放行政区边界入口 | 0111、0128 | [shared-map.md](shared-map.md) |
| 资源的分类与显示级别 | 取值、名称、颜色写在字典，`style-registry.ts` 按 `code` 登记；图例和地图只用实际有的类别；最小显示级别按单张瓦片 6 MB 实测，放进可替换的部署文件；第一次请求很慢的资源定 8 级 | 0123、0124、0132、0136、0137 | [archive/migration.md](../archive/migration.md)"现状底图：资源分类的探查" |
| 内网静态底图 | 用本地市界直接绘制面、线和地名，不用图片；地名在页面上开关（二三维都画），各市分色是代码开关，默认都关 | 0133、0134、0146 | [shared-map.md](shared-map.md) |
| 加载与页面缓存 | 登录页空闲时预加载地图页并预热 Worker 池；字体不推迟；`KeepAlive` 加路由 meta，停用期间暂停视图；`.env` 的开关决定离开页面后是否重置 | 0061～0063、0114、0138 | [map-core.md](map-core.md)、[perf.md](perf.md)、[layout.md](layout.md) |
| 三维的运行时与切换 | 范围与交互已定；`setDimension` 切换，`MapCanvas` 的一个视图同时担任二三维（`kinds`、`setKind`），第一次切到三维时加载 map-three，加载失败只让三维失败，`retry` 只重新加载它；二维稳定后空闲时预加载 map-three。app 注入引擎的描述，页面不判断；引擎的能力（`sceneCapabilities`）决定三维里的资源图层、图例、点/框选，由 app 收窄后注入（三维里不显示资源图层、不识别，高斯泼溅照常；等页面重新设计，没有开关）。Cesium 引擎由 0153 移除；Cesium 下的资源图层（方案 B）做过 PoC，不迁移，代码在分支 `poc/cesium-mvt-raster` 和标签 `poc-plan-b-2026-11` | 0078、0091、0147、0151、0153 | [map-three.md](map-three.md)、[map-vue.md](map-vue.md) |
| 三维覆盖物 | 覆盖物是二维样式的图层，三维里照常显示（ADR 0147 第 2 节）；ADR 0080、0082、0099、0103、0135 的 GeoJSON 镜像、点数上限和细节上限是 Cesium 引擎的做法，随 0153 移除 | 0080、0147、0153 | [map-three.md](map-three.md) |
| 三维模型与漫游 | 静态清单描述 3D Tiles，会话的 `scene` 持有；加载前整理索引，外部索引的根节点换到引用它的位置，没有内容的节点不改小误差；路线和步行是 `roam`，合并成一个漫游入口，没有单独的钻地；导航网格是纯 TS，在 Worker 里构建；室内地图、第三人称（入口暂不开放）。LCC2 高斯泼溅只在 `maplibre` 下用 gaussian-splat-lite 显示和拾取，清单存配准后的摆放，数据平铺在 `3dt/` 下经同源转发；同一处的倾斜模型在 LCC2 的范围里裁掉；Cesium 下叠一块 Three.js 画布显示 LCC2（方案 3）做过 PoC，不做，代码在分支 `poc/cesium-three-lcc2` 和标签 `poc-plan-3-2026-11` | 0081、0083～0087、0090、0097、0102、0103、0148、0149、0152 | [map-three.md](map-three.md)、[map-core.md](map-core.md) |

## 阅读顺序

第一次读地图部分：

1. ADR 0020 → 0022 → 0024：会话、样式模型、视图接口
2. ADR 0027 → 0028：分层与 Vue 的衔接
3. ADR 0026 → 0030：失败的处理
4. ADR 0034：交互工具
5. ADR 0038 → 0039：相机操作与异步规则
6. 其余按要做的事去读；阶段总结（[stage-4](../archive/stages/stage-4-map-core.md)、[5A](../archive/stages/stage-5a-map-skeleton.md)、[5B](../archive/stages/stage-5b-public-map-capabilities.md)、[5C](../archive/stages/stage-5c-current-map-business.md)）记录了每次决定前后踩过的坑

## 维护

新增地图相关的 ADR、或者一份 ADR 修正了另一份时，同步本文的"按主题的 ADR"一表。ADR 接受后正文不改，修正关系只在这里和 [ADR 索引](../adr/README.md)里体现。
