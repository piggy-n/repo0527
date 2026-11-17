# 0163. 驾驶舱的公共能力上移到 `shared/dashboard`，three 的 lint 例外移到 `shared/dashboard/map`

- 状态：已接受（2026-11-16 用户在"新建模块 + 公共部分移到 shared"等方案里选定）
- 日期：2026-11-16
- 补充：ADR 0077（驾驶舱在 feature 内拆分的计算、场景、组件，两个驾驶舱共用的部分移到 shared）、ADR 0006（three 的导入位置从 `features/city-dashboard` 换成 `shared/dashboard/map`）

## 背景

- 用户要新增"城市国土空间监测综合分析驾驶舱"（`/land-space-analysis`）：布局、视觉、入场、交互沿用城市体检驾驶舱（`/city-dashboard`），差别是指标体系（一级、二级、三级）、数据（2025 年一年）、右栏固定三张图（二级默认雷达）、地图标签不写数值、多了指北针和比例尺。
- 城市体检驾驶舱的外壳、入场编排、筛选、图表、Three.js 立体地图、导出全部在 `features/city-dashboard` 里（ADR 0077）。features 之间不能互相导入（ADR 0006 的 `boundaries`），新驾驶舱用不到它们。
- `three` 的导入只对 `packages/map-three` 和 `features/city-dashboard` 放开，`shared` 里导入会报错。
- 原驾驶舱已经验收（2026-10-22），用户要求它的外观、入场、交互、导出和测试结果都不变。

## 候选方案

| 方案 | 做法 | 结论 |
|---|---|---|
| 新建 feature，公共部分上移 `shared/dashboard` | 新驾驶舱是 `features/land-space-dashboard`；外壳、筛选控件、图表、地图、提示、导出、动画和素材移到 `shared/dashboard`，拆成可组合的单元；两个 feature 各自持有数据、状态和组合 | **选择**（用户选定）：符合依赖方向，两个驾驶舱的差异留在各自的 feature，原驾驶舱只换导入和组合方式 |
| 放进 `city-dashboard` 当第二个视图 | 在原 feature 里加一个视图、一套数据和状态，共用同一个目录里的组件 | 不选：一个 feature 两个业务域，状态和组件要靠开关区分新旧两种行为（标题、年份、雷达、地图数值、三张固定卡片），原驾驶舱的每次修改都可能牵动新驾驶舱；路由、菜单、测试也混在一起 |
| 复制一份 | 新 feature 复制原驾驶舱的全部代码后再改 | 不选：三维地图、入场、导出这些难写难测的部分有两份，修一个缺陷要改两处，入场卡顿这类调优（city-dashboard.md"入场卡顿"）会走样；`three` 的例外也要再放开一个 feature |

## 决定

1. `shared/dashboard` 放两个驾驶舱共用的大屏能力：`model`、`cities`、`calculations`、`map-classification`、`format`、`animation/`、`assets/`、`shell/`、`filters/`、`charts/`、`export/`、`map/`、`tooltip/`。指标目录、数据、筛选状态和偏好留在各自的 feature。用法见 [dashboard](../modules/dashboard.md)。
2. 拆成组合单元，不做带开关的全能大屏组件：外壳 `DashboardShell`（插槽给出入场状态和缩放）、筛选的 `FilterPanel` 等六个控件、图表的 `ChartCard`、`ChartActions`、`ChartDetailDialog`、`DashboardPlot`。地图仍是一个 `DashboardMap`，新驾驶舱要的差异做成窄的选项：`showValues`、`notice`、`overlay` 插槽；雷达是新的配置函数 `createRadarOption` 和 `DashboardPlot` 的 `hoverMode`。只属于原驾驶舱的翻卡导航、选中卡片的边框、可点击的卡片标题、预热留在 `features/city-dashboard`。
3. `.oxlintrc.json` 里驾驶舱的 three 例外从 `apps/yzt/src/features/city-dashboard/**` 换成 `apps/yzt/src/shared/dashboard/map/**`：地图移走后原驾驶舱的 feature 不再导入 three，例外只留地图目录。两个驾驶舱的 feature、`shared` 的其他目录（包括 `shared/dashboard` 的其他子目录）都禁止导入 three，报错文案是"只能在 packages/map-three 和 shared/dashboard/map 中导入（ADR 0147、0163）"。
4. 搬移用 `git mv` 保留历史。入场的加载耗时标记名由外壳的 `traceName` 给出，原驾驶舱仍是 `city-dashboard`（实测工具依赖它）。
5. 原驾驶舱"行为不变"的检查：拆分前后用同一段临时测试把 96 个指标的卡片、详情图表配置和地图图例写成 JSON 逐字节比较；原驾驶舱的单元测试和浏览器测试（入场、图表列表、地图、预热）断言不改、全部通过。

## 后果

- 原驾驶舱从 `shared/dashboard` 组合，DOM、类名效果、`data-*`、读屏文字、入场和导出不变；标题统一用 `withUnit`，原驾驶舱的单位都不为空，显示不变。
- 改 `shared/dashboard` 会同时影响两个驾驶舱：按 ADR 0139 至少算级别 2，两个驾驶舱的测试都要跑。入场选择器（`data-enter`、`data-filter-group`、`data-card-list`、`data-scene`）是外壳和各单元之间的约定，写在模块文档里。
- 应用代码里只有 `shared/dashboard/map`（和 `app/` 的装配）能用 `three`，驾驶舱的 feature 要用立体地图时经过 `DashboardMap`；以后别的目录要用 three 时另行决定。
- 驾驶舱的规则（`.claude/rules/city-dashboard.md`）也适用于 `shared/dashboard`。
