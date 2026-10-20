# 架构决策记录（ADR）

一个重要决策写一份 ADR，记录当时的背景、考虑过的方案和最终选择的理由。

- 文件名：`NNNN-简短标题.md`，编号递增，不复用
- 状态：提议中 → 已接受；以后被新决策替代时改为「已被 NNNN 取代」
- 接受后正文不再修改，只允许更新状态行

## 索引

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](0001-tsx-instead-of-sfc.md) | 组件使用 TSX，不使用 SFC | 已接受 |
| [0002](0002-map-libraries.md) | 二维地图用 MapLibre，Cesium 精确锁版本 | 已接受（大版本由 0019 确定） |
| [0003](0003-typescript-7-toolchain.md) | TypeScript 7 与工具链 | 已接受（`incremental` 一条已被 0009 取代） |
| [0004](0004-module-boundaries.md) | 模块边界与拆包预留 | 已接受 |
| [0005](0005-dependency-maintenance-and-ci.md) | 依赖维护与持续集成 | 已接受 |
| [0006](0006-lint-rules-and-boundaries.md) | lint 规则与依赖方向检查 | 已接受 |
| [0007](0007-vue-router-5-and-history-mode.md) | 路由使用 Vue Router 5 与 history 模式 | 已接受 |
| [0008](0008-same-origin-api-proxy.md) | 接口走同源的 /backend 代理 | 已接受 |
| [0009](0009-disable-incremental-typecheck.md) | 关闭 tsc 的增量检查 | 已接受 |
| [0010](0010-testing-with-vitest.md) | 测试使用 Vitest 与 jsdom | 已接受（真实浏览器测试由 0040 补充） |
| [0011](0011-http-client-axios-zod-msw.md) | HTTP 客户端：axios + zod，测试用 MSW 模拟接口 | 已接受（没有信封的接口由 0047 补充） |
| [0012](0012-fonts-self-hosted-and-svg-title.md) | 字体：普惠体 3.0 自托管且不入库，系统名称用 SVG 轮廓 | 已接受（存放位置已被 0013 取代；加载时机由 0062 补充） |
| [0013](0013-fonts-in-public-dir.md) | 字体文件统一放在 apps/web/public/fonts/ | 已接受 |
| [0014](0014-icons-as-internal-package.md) | 图标做成第一个 workspace 包 @yzt/icons（内部包） | 已接受 |
| [0015](0015-login-session-and-permissions.md) | 登录与会话：会话存 localStorage，SM2 用 sm-crypto-v2，权限声明在路由上 | 已接受 |
| [0016](0016-ui-components-in-libs-ui.md) | 通用 UI 组件放在 libs/ui | 已接受 |
| [0017](0017-server-state-with-tanstack-query.md) | 接口数据用 TanStack Vue Query 管理 | 已接受 |
| [0018](0018-map-core-in-libs.md) | map-core 放在 libs/map-core | 已接受 |
| [0019](0019-maplibre-v6.md) | 二维地图用 MapLibre GL JS 6 | 已接受 |
| [0020](0020-map-session-state-as-source-of-truth.md) | 二三维关系：地图会话状态是唯一的真相源 | 已接受（选择状态的范围由 0022 修正，方案 B 的比较由 0024 修正） |
| [0021](0021-worker-strategy.md) | Worker 策略：二维不自建渲染 Worker，统一通信层与瓦片数据服务 | 已接受（第 5 条的表述由 0024 修正，第 3、4 条由 0025 补充，第 2 条的图例统计由 0043 定为不做） |
| [0022](0022-style-model-and-session-commits.md) | 样式模型与会话提交：分组推导、快照对比 | 已接受（第 4 条与第 5 条中 `failed` 的含义由 0026 修正；分组加上样式图片由 0045 补充；第 6 条的选择状态由 0047 补充） |
| [0023](0023-disposal-events-and-map-runtime.md) | 资源释放、事件与地图运行时装配 | 已接受（运行时的加载时机与预加载由 0061 补充） |
| [0024](0024-shared-view-interfaces.md) | 二三维共用的视图接口 | 已接受（渲染要素的只读查询由 0047 补充） |
| [0025](0025-worker-contract-and-tile-data-service.md) | Worker 通信契约与瓦片数据服务的约束 | 已接受 |
| [0026](0026-view-sync-failures.md) | 视图同步的失败处理：错误事件、加载失败与恢复 | 已接受（第 4 条的"不另加 API"由 0030 修正；第 1、2 条只适用于不带数据源的错误，由 0041 修正） |
| [0027](0027-map-capability-layers.md) | 地图能力的分层与页面组装 | 已接受 |
| [0028](0028-map-vue-context.md) | map-vue：会话与视图分开的地图上下文 | 已接受（第 5 条中 `view` 的含义、`whenReady` 的用途由 0039 修正） |
| [0029](0029-map-overlay-padding.md) | 定位可视区域：悬浮元素登记、定位时现量现算 | 已接受（地图页登记哪些元素由 0053 补充） |
| [0030](0030-view-failure-as-data.md) | 视图失败的原因作为数据 | 已接受 |
| [0031](0031-basemap-tianditu-and-owner.md) | 底图：天地图的配置与底图的拥有者 | 已接受 |
| [0032](0032-intranet-build-mode.md) | 公网与内网两套构建命令：Vite 构建模式 | 已接受 |
| [0033](0033-boundaries-and-default-view.md) | 行政区边界与默认视角 | 已接受（第 3 节每一级的线和样式由 0057 修正） |
| [0034](0034-interaction-tools.md) | 交互工具：视图输入、工具模型与工具栏 | 已接受（点选工具由 0047 补充；第 5 节工具栏的位置与登记由 0053 修正；第 2、3 节临时拖动的修饰键与光标由 0056 补充） |
| [0035](0035-measurement.md) | 测量：椭球面计算、测量的状态与标签 | 已接受（第 4 节的单位格式和提示由 0055 修正） |
| [0036](0036-region-locate.md) | 区划定位：本地区划目录、边界的加载与定位 | 已接受（选中区划的显示由 0055 补充） |
| [0037](0037-coordinate-locate-and-location-point.md) | 坐标定位与位置点 | 已接受（第 5 节位置信息的摆放由 0055 修正） |
| [0038](0038-camera-operations.md) | 相机操作：用操作的信号判断等待中的定位是否作废 | 已接受（第 1 条的 `intentRevision`、第 3 条的上下文入口由 0039 修正） |
| [0039](0039-async-supersede-rules.md) | 异步操作的作废规则、相机操作对象与状态命名 | 已接受 |
| [0040](0040-vitest-browser-mode.md) | 真实浏览器测试：Vitest 浏览器模式 | 已接受（生产构建的最小完整流程由 0065 提前加入） |
| [0041](0041-resource-layers.md) | 资源图层：目录、样式登记表、显示状态与数据源错误 | 已接受（一个面资源可以有多个图层由 0045 补充；目录的展示顺序由 0053 补充） |
| [0042](0042-preference-persistence.md) | 偏好的持久化：IndexedDB + idb-keyval 的键值存储 | 已接受 |
| [0043](0043-read-only-legend.md) | 只读图例：从样式登记表推导，不做地类统计 | 已接受（背景中旧地类图例的说法由 0044 更正；图例由 0044 变为可以编辑；第 5 节图例的位置由 0053 修正） |
| [0044](0044-symbol-overrides.md) | 符号覆盖：模型、推导与保存 | 已接受（面的描边宽度、线型与纹理由 0045 补充；线型的推导由 0046 补充） |
| [0045](0045-fill-patterns-and-style-images.md) | 面的描边与纹理：按需拆层、SDF 纹理与样式图片 | 已接受（第 1 节分类取值的纹理默认色、第 2 节的图层上限由 0046 修改） |
| [0046](0046-class-pattern-color-and-dash-layers.md) | 分类取值的纹理默认色与按线型拆层 | 已接受 |
| [0047](0047-feature-pick-and-detail.md) | 点选与详情：渲染要素识别、guid 主键与完整几何高亮 | 已接受（第 1 节后端识别的登记、第 2 节二维 14 级以上的识别由 0048 修改；第 4 节选择可以有多个要素、第 5 节批量高亮、第 9 节框选由 0049 补充；第 6 节点选的光标由 0056 修正） |
| [0048](0048-pick-identify-corrections.md) | 点选识别的修正：后端识别按数据集登记，二维 14 级以上以渲染要素为准 | 已接受 |
| [0049](0049-box-select.md) | 框选：与点选一致的识别、即时估数的上限与瓦片上的批量高亮 | 已接受（第 2 节的即时估数由 0050 修改；第 1 节不能拖动平移由 0056 修正） |
| [0050](0050-box-estimate-weighted-count.md) | 框选估数的修正：查后端的资源按渲染要素加权计数 | 已接受 |
| [0051](0051-region-clip.md) | 区划裁剪：按边界几何遮罩显示，点选、框选按几何限定范围 | 已接受（求交库不按需加载由 0061 补充） |
| [0052](0052-resource-years.md) | 资源的年份：每个资源各自选，另有批量设置 | 已接受（第 2 节批量设置的位置由 0053 修正） |
| [0053](0053-map-page-layout-and-toolbar.md) | 地图页的布局与工具栏 | 已接受（第 7 节卡片在面板打开时的外观由 0057 修正；第 3 节基础组的指北针由 0058 补充，第 8 节矮屏的高度阈值由 0058 修正；第 6 节"已勾选"的提示由 0059 修正；第 1 节资源面板的高度、第 6 节的分割线由 0060 修正） |
| [0054](0054-sortable-drag-reorder.md) | 拖动排序用 SortableJS | 已接受 |
| [0055](0055-map-overlays.md) | 地图上的浮层：测量的单位与提示、位置信息的摆放、当前区划 | 已接受 |
| [0056](0056-pick-tool-interaction.md) | 点/框选的交互：十字光标、跟随提示、按住 Ctrl / ⌘ 临时拖动地图 | 已接受 |
| [0057](0057-map-cards-and-boundary-lines.md) | 右下角的卡片与行政区边界的线型 | 已接受 |
| [0058](0058-compass-button.md) | 基础组的指北针 | 已接受 |
| [0059](0059-checked-layer-status-icons.md) | "已勾选"的状态图标 | 已接受 |
| [0060](0060-resource-panel-height-and-splitter.md) | 资源图层面板的高度与分割线 | 已接受 |
| [0061](0061-map-resource-loading.md) | 地图资源的加载策略：登录页空闲时预加载地图页，预热 Worker 池 | 已接受 |
| [0062](0062-font-loading-not-deferred.md) | 普惠体照常按用到时加载，不为地图推迟 | 已接受 |
| [0063](0063-map-page-keep-alive.md) | 地图页的页面缓存：KeepAlive 加路由 meta，停用期间暂停视图 | 已接受 |
| [0064](0064-navigation-failure-recovery.md) | 页面导航失败：应用根部提示，用户主动重试或刷新 | 已接受 |
| [0065](0065-production-smoke-tests.md) | 生产构建的浏览器冒烟：登录、地图缓存与分块失败恢复 | 已接受 |
| [0066](0066-current-map-ui-refinement.md) | 现状底图的资源操作、紧凑图例与独立底图浮窗 | 已接受（修正 0053、0057、0060，补充 0043、0044） |
| [0067](0067-map-popup-spacing-and-alignment.md) | 地图浮窗间距、透明度入口与图例对齐 | 已接受（修正 0066） |

## 模板

```markdown
# NNNN. 标题

- 状态：提议中
- 日期：YYYY-MM-DD

## 背景

## 候选方案

## 决定

## 后果
```
