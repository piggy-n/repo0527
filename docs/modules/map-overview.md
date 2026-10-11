# 地图架构总览

地图部分的入口：先看这里，再按主题去读 ADR 和各模块的文档。本文只列现在有效的结论和出处，理由在 ADR 里，用法在模块文档里。

## 分层

```
pages              挑选能力、组合成页面；provideMap 创建会话，绑定样式、登记工具
  ↓
features           业务数据驱动的图层（5C 起：资源图层 features/resource-map、点选、图例）
  ↓
shared/map         项目级的公共能力：底图、行政区边界、默认视角、工具栏、测量、区划定位、坐标定位、地图状态提示
  ↓
libs/map-vue       地图与 Vue 的衔接：会话的提供与注入、画布、样式绑定、相机操作、工具登记、定位可视区域
  ↓
libs/map-core      地图会话（样式、相机、当前工具）、视图接口、MapLibre 适配器、测量计算；不依赖 Vue
  ↓
libs/utils         LatestController、safeReporter、Worker 通信层
```

三维（`libs/map-cesium`）以后放在 map-core 之上，只能由 map-vue 动态导入。依赖方向由 lint 检查（ADR 0006）。

## 贯穿全局的几条原则

| 原则 | 一句话 | 出处 |
|---|---|---|
| 会话是唯一真相源 | 样式、相机、当前工具（以后还有选择状态）在 map-core 的会话里，二维、三维的视图只负责同步 | ADR 0020 |
| 拥有者推导分组 | 每项能力是一个拥有者：持有状态、提供操作，用纯函数推导自己的样式分组，整体替换，页面统一提交 | ADR 0022、0027、0028、0031 |
| 只有适配器写引擎 | 只有 MapLibre 适配器能写二维地图，其他代码通过视图接口查询、投影；二三维共用视图接口，不共用引擎接口 | ADR 0024 |
| 失败是数据 | 加载失败是一种明确的结果；失败原因放在 `failure` 里，提示由纯函数推导 | ADR 0026、0030 |
| 资源有主人 | 持有资源的对象实现 `Disposable`，监听和子对象登记进 `DisposableStack`，释放后等待的操作以 `AbortError` 结束 | ADR 0023 |
| 异步只认有效的结果 | 能收敛的不写成操作；可替换操作在同一通道里只认最新；相机定位是一次操作，等待与再确认由 `run` 负责 | ADR 0038、0039 |

## 按主题的 ADR

只列现在有效的；括号里是被后来的 ADR 修正或补充的部分。

| 主题 | 现在的结论 | ADR | 文档 |
|---|---|---|---|
| 位置与拆包 | map-core 在 `libs`，单入口；utils、map-core、map-cesium 以后一起拆到 `packages/` | 0004、0018 | [map-core.md](map-core.md) |
| 引擎与版本 | MapLibre GL JS 6，具名导入；Cesium 精确锁定；不用 mapbox-gl | 0002（大版本由 0019 确定）、0019 | [map-core.md](map-core.md) |
| 分层与组装 | 五层的职责；能力按拥有者写，页面挑选组合，不做带开关的全能地图组件 | 0027 | 本文、[shared-map.md](shared-map.md) |
| 会话 | 样式、相机、当前工具；二三维共同的唯一真相源 | 0020（选择状态的范围由 0022 修正，方案比较由 0024 修正） | [map-core.md](map-core.md) |
| 样式模型与提交 | 分组推导、整体替换，跨分组的修改一次提交，视图按修订号增量同步 | 0022（`failed` 的含义由 0026 修正） | [map-core.md](map-core.md) |
| map-vue 上下文 | `provideMap`、`useMap`、`bindStyle`；`view` 只在就绪时有值，只有拾取和投影 | 0028（第 5 条由 0039 修正） | [map-vue.md](map-vue.md) |
| 视图接口与二三维 | 共用生命周期、相机、输入、拾取、投影；相机事件带 `view` 和 `cause`；Cesium 镜像会话 | 0024 | [map-core.md](map-core.md) |
| 视图失败 | 样式失败在出现新的提交时自动恢复；引擎失败只能重建视图；状态转换按表执行；带数据源的错误（瓦片出错）不算样式失败，记作视图的数据源错误 | 0026（第 4 条由 0030 修正，第 1、2 条由 0041 修正）、0030、0041 | [map-core.md](map-core.md)"状态转换"、[map-vue.md](map-vue.md) |
| 资源释放与运行时 | `Disposable`、nanoevents；maplibre-gl 的全局设置在首次进入地图时懒加载 | 0023 | [map-core.md](map-core.md) |
| Worker | 二维不自建渲染 Worker；自建的 Worker 统一用通信层；瓦片数据服务的约束 | 0021（第 5 条由 0024 修正，第 3、4 条由 0025 补充）、0025 | [utils.md](utils.md) |
| 定位可视区域 | 贴边的悬浮元素登记自己，定位时现量现算 padding | 0029 | [map-vue.md](map-vue.md) |
| 底图与内网 | 天地图配置是 `{ key } \| null`；内网差异只写在构建模式的环境文件里 | 0031、0032 | [shared-map.md](shared-map.md) |
| 行政区边界与默认视角 | 本地边界数据；本次进入页面第一次就绪时适配一次江苏 | 0033 | [shared-map.md](shared-map.md) |
| 交互工具 | 会话的工具模型，同一时间一个工具；工具只拿到 `ToolView`；工具栏的按钮和动作由页面给出 | 0034 | [map-core.md](map-core.md)、[map-vue.md](map-vue.md)、[shared-map.md](shared-map.md) |
| 测量 | 椭球面计算（geographiclib）；`MeasureStore` 持有结果和两个工具 | 0035 | [map-core.md](map-core.md)、[shared-map.md](shared-map.md) |
| 区划定位、坐标定位 | 本地区划目录与边界；经纬度的识别与格式只用纯函数；位置点可拖动 | 0036、0037 | [shared-map.md](shared-map.md) |
| 资源图层 | feature `resource-map`：接口树 → 目录（纯函数，查询的 `select` 得出）→ 样式登记表 → 拥有者 `useResourceLayers`（按 `code` 的显示状态）→ `resources` 分组（底图之上、注记之下）；图层面板的目录树只负责勾选，叠放顺序在"已勾选"区调整（5C.2）；勾选、透明度、顺序、年份按用户记住（5C.3，ADR 0042）；图例从登记表推导，不做地类统计（5C.4，ADR 0043）；符号的覆盖和拖动取色时的预览由拥有者 `useResourceSymbols` 持有，分组和图例都从默认符号、覆盖和预览推导，在图例里编辑（5C.5，ADR 0044）；未勾选的不放进样式，每个资源一个图层，重的资源有最小显示级别；目录变化时逐个资源校验；瓦片错误从视图的数据源错误推导 | 0041、0044 | [migration.md](../migration.md)"现状底图：资源图层实测" |
| 相机操作与异步 | 用户发起的定位是一次操作，用信号判断是否作废；操作对象的 `run` 负责等待与再确认；可替换操作只认最新（`LatestController`）；revision / operation / version 各有一个意思 | 0038（第 1、3 条由 0039 修正）、0039 | [map-vue.md](map-vue.md)"相机操作"、[utils.md](utils.md) |

## 阅读顺序

第一次读地图部分：

1. ADR 0020 → 0022 → 0024：会话、样式模型、视图接口
2. ADR 0027 → 0028：分层与 Vue 的衔接
3. ADR 0026 → 0030：失败的处理
4. ADR 0034：交互工具
5. ADR 0038 → 0039：相机操作与异步规则
6. 其余按要做的事去读；阶段总结（[stage-4](../stages/stage-4-map-core.md)、[5A](../stages/stage-5a-map-skeleton.md)、[5B](../stages/stage-5b-public-map-capabilities.md)）记录了每次决定前后踩过的坑

## 维护

新增地图相关的 ADR、或者一份 ADR 修正了另一份时，同步本文的"按主题的 ADR"一表。ADR 接受后正文不改，修正关系只在这里和 [ADR 索引](../adr/README.md)里体现。
