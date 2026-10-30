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
| [0052](0052-resource-years.md) | 资源的年份：每个资源各自选，另有批量设置 | 已接受（第 2 节批量设置的位置由 0053 修正，回显由 0116 修改） |
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
| [0068](0068-basemap-and-boundary-popovers.md) | 底图与行政区独立 Popover | 已接受（修正 0066、0067） |
| [0069](0069-map-options-popover-interaction.md) | 底图与行政区 Popover 的显示和关闭规则 | 已接受（修正 0068） |
| [0070](0070-map-functional-tabs-and-detail-stack.md) | 行政区功能标签、独立详情与右侧面板排布 | 已接受（修正 0053、0066、0068、0069） |
| [0071](0071-map-panel-title-and-wrapped-tabs.md) | 地图工具的标准标题与两列标签 | 已接受（修正 0053、0066、0070） |
| [0072](0072-map-tab-size-and-selection.md) | 地图功能标签的字号与选中状态 | 已接受（修正 0071） |
| [0073](0073-map-single-panel-title.md) | 单功能面板直接显示功能标题 | 已接受（修正 0071） |
| [0074](0074-legend-browse-and-edit-views.md) | 图例浏览与编辑视图分离 | 已接受（修正 0043、0066） |
| [0075](0075-file-transfer-and-preview.md) | 公共文件传输与文件管理预览 | 已接受 |
| [0076](0076-muted-panel-header.md) | 按需复用浅灰底面板标题栏 | 已接受 |
| [0077](0077-city-dashboard-isolated-rendering.md) | 城市体检驾驶舱独立渲染与资源所有权 | 已接受 |
| [0078](0078-3d-scope-and-interaction.md) | 三维阶段的范围与交互 | 已接受 |
| [0079](0079-cesium-view-and-dimension-switch.md) | Cesium 运行时、三维视图与二三维切换 | 已接受（修正 0002 的 Cesium 版本） |
| [0080](0080-3d-overlays-measure-and-status.md) | 三维的覆盖物、测量、临时拖动与状态栏 | 已接受（三维期间暂停 0048、0049 中三维的识别；第 1 节的只改坐标、等画好由 0082 修正） |
| [0081](0081-3d-models-scene-content-and-underground.md) | 三维模型：3DT 清单、会话的三维内容与钻地 | 已接受（第 6 节钻地时隐藏白膜由 0084 改为隐藏地面上的模型） |
| [0082](0082-3d-overlay-live-limit-and-rebuild-wait.md) | 三维覆盖物：只换坐标的点数上限、重建时等新实体画好 | 已接受（修正 0080 第 1 节） |
| [0083](0083-3d-route-roam.md) | 三维路线漫游：清单里的路线、会话的漫游意图 | 已接受（选工具退出漫游由 0084 改为移动以外的工具；漫游状态按种类区分、路线和步行换手由 0086 补充） |
| [0084](0084-underground-space-entries-and-ground-models.md) | 地下空间时隐藏不适用的入口；钻地时隐藏地面上的模型；徐州倾斜摄影 | 已接受（修改 0081 第 6 节的钻地时隐藏白膜） |
| [0085](0085-navigation-grid.md) | 导航网格：map-core 里的纯 TS 实现、Worker 构建、按区域着色的平面图 | 已接受（解决 0018 的 Worker 类型检查；步行时由谁构建、是否缓存由 0086 定） |
| [0086](0086-first-person-walk.md) | 第一人称步行：会话里的步行意图、map-core 的步行者、场景接管键鼠 | 已接受（补充 0083、0085；步行意图的暂停、瞬移和人的位置由 0087 补充，人称和人物模型由 0090 补充） |
| [0087](0087-indoor-map.md) | 步行时的室内地图：右上角的小地图、完整地图与双击瞬移 | 已接受（补充 0086） |
| [0089](0089-self-service-graph-with-echarts.md) | 自助取数的关系图用 ECharts，布局沿用旧页面的 D3 力导 | 已接受 |
| [0090](0090-third-person-walk.md) | 第三人称步行：弹簧臂相机、人物模型与暂不开放的入口 | 已接受（补充 0086；入口暂不开放，同 0078） |
| [0091](0091-preload-3d-runtime.md) | 切到三维的预加载：二维画面稳定后空闲时加载三维运行时；三维期间保留二维 | 已接受（解决 0079 留到 3D.5 的两件事） |
| [0092](0092-system-management.md) | 系统管理：页面内菜单、两个路由与打开的申请 | 已接受 |
| [0093](0093-header-message-popover.md) | 消息：顶栏按钮下方的弹框 | 已接受 |
| [0094](0094-current-map-direct-adjustments.md) | 现状底图的直接调整：复合图例默认展开、目录全部展开、批量年份加 2020 与 2021、「已选择图层」、步行默认 4 m/s | 已接受（修改 0052、0066、0081、0086 的几处；第 3 节的提示由 0116 去掉） |
| [0095](0095-status-bar-bottom-left.md) | 状态栏移到左下角；地下空间时隐藏状态栏和视图控件 | 已接受（修改 0053 第 5 节、0084） |
| [0096](0096-layer-move-buttons.md) | 资源图层面板的上移、下移按钮；目录树的拖动手柄移到复选框前面 | 已接受（补充 0053 第 6 节、0054） |
| [0097](0097-roam-panel.md) | 漫游改版：合并的"漫游"入口、替换模型面板的漫游面板、统一的速度，去掉单独的钻地 | 已接受（修改 0081 第 6 节、0083 第 4 节、0084、0086 第 5 节、0087） |
| [0098](0098-space-monitoring-indicators.md) | 城市国土空间监测指标：拥有者分工、计算的轮询与成果图层 | 已接受 |
| [0099](0099-3d-overlay-settle-live-shapes.md) | 三维覆盖物只换坐标：坐标没变的不动，停下后改回静态 | 已接受（修改 0082 第 1 节） |
| [0100](0100-space-monitoring-statistics.md) | 城市国土空间监测基本统计：拥有者分工、轮询与提交跟踪、宽屏收起侧栏 | 已接受（MxSplitLayout 新增宽屏收起，补充 0016；报表清单与查看条件由 0117 修改） |
| [0101](0101-split-layout-custom-handles.md) | 分栏布局由页面给出收起把手和窄条：基本统计页的把手设计图 | 已接受（补充 0100 第 6 节） |
| [0102](0102-page-style-refinements.md) | 各页面样式与细节的一轮调整：三维单选定位、漫游面板、勾选文字、消息卡片、AI 头像等 | 已接受（修改 0081 第 4 节、0092、0093 第 3 节、0096、0097 第 1 节、0101 第 4 节） |
| [0103](0103-roam-switch-and-security-route.md) | 漫游切换不飞、进站路线先过安检、漫游时覆盖物不按级别重建、脱困按钮与 AI 头像底色 | 已接受（修改 0080 第 1 节、0083 第 3 节、0086 第 3 节、0102 第 1、7 节） |
| [0104](0104-data-query-migration.md) | 数据查询：四个页面共用一个组件、高级查询并入页签、通用的绘制工具 | 已接受（结束 0035 留的绘制问题） |
| [0105](0105-indicator-simulation.md) | 指标智能推演：三阶段页面、确定性模拟与推演引擎 | 已接受（参数、模拟公式、确认点与减少动画已被 0106 取代；推演阶段的排布与地图演出已被 0107 取代；结果展示的排布已被 0108 取代） |
| [0106](0106-indicator-simulation-excel-params.md) | 指标智能推演：按 Excel 计算规则的参数与 AI 推演指令 | 已接受（指令的位置已被 0107 取代；输入框的刷新与初始文字已被 0109 修改） |
| [0107](0107-indicator-simulation-flow-and-dialogue.md) | 指标智能推演：以流程图为核心的 AI 推演阶段与推演中的对话 | 已接受（结果展示的排布已被 0108 取代；完成卡片的位置已被 0109 取代） |
| [0108](0108-indicator-simulation-results-in-run-layout.md) | 指标智能推演：结果展示并入推演阶段的布局 | 已接受（"重新编排"的叫法与回复前的小圆球已被 0109 修改） |
| [0109](0109-indicator-simulation-rename-and-ai-avatar.md) | 指标智能推演改名为城市国土空间监测指标AI计算：文案、AI 输入框、机器人头像与按钮主次 | 已接受（修改 0106 第 6 条、0107 的完成卡片、0108 第 2、7 条） |
| [0110](0110-city-dashboard-menu-entry.md) | 驾驶舱的菜单入口：查询统计 → 专项统计，新标签页打开 | 已接受（修改 0077） |
| [0111](0111-map-controls-without-3d-and-basemap-card.md) | 不支持三维的地图不显示 2D/3D；底图入口抽成 BasemapCard，AI 对话、指标 AI 计算补上 | 已接受（修改 0053 第 3 节） |
| [0112](0112-data-query-legacy-buttons-and-wide-results.md) | 数据查询的按钮参考旧页面，结果从左侧开始 | 已接受（修改 0104 第 2、3 节） |
| [0113](0113-statistics-tasks-shown-as-approved.md) | 资源审核里的统计任务按审核通过显示，名称后标"统计任务"；准备状态 error 换成处理失败 | 已接受（修改 0092 第 3、6 节） |
| [0114](0114-configurable-page-state-reset.md) | 离开页面后是否重置：环境变量 VITE_PAGE_STATE_RESET，默认保留 | 已接受（修改 0063、0042 的部分做法） |
| [0115](0115-water-relation-graph-in-lanes.md) | 自助取数的水资源关系图按数据成果分泳道，其他资源沿用旧版知识图谱 | 已接受（修改 0089） |
| [0116](0116-batch-year-echo.md) | 现状底图的批量设置年份：回显最后一次设置的年份，没有数据的年份不再提示 | 已接受（修改 0052 第 2 节、0094 第 3 节） |
| [0117](0117-statistics-remaining-reports.md) | 城市国土空间监测基本统计：开放其余四种报表，变化类报表按本底年份查看和统计 | 已接受（修改 0100 第 5、7 节） |

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
