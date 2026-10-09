# 路线图

整个重构分为 8 个阶段。本表在阶段零制定（当时只写在会话中，2026-09-30 补成本文），此后每个阶段结束时更新"状态"和"调整"两部分；原来的"内容"和"主要学习点"保留，便于对照计划与实际。

阶段五开始时（2026-10-09）把阶段五拆成 5A～5D 四个子阶段，并在阶段五、六之间加入单独的三维阶段。三维阶段不编号：ADR 和各文档里的"阶段六""阶段七"保持原来的含义。

## 阶段总览

| 阶段 | 内容 | 主要学习点 | 状态 |
|---|---|---|---|
| **0. 约定** | `AGENTS.md` 骨架（分层、依赖方向、命名），确认待定问题 | 架构分层、依赖倒置 | ✅ 完成（ADR 0001、0002、0004） |
| **1. 工程基础** | `apps/web`：Vite 最新版 + `plugin-vue-jsx` + TS strict；tsconfig 分层；实测 TS 7 工具链；lint（只管正确性，格式交给 WebStorm）；Vitest | tsconfig 各项配置的含义、`jsxImportSource: 'vue'`、Vite 插件管线 | ✅ 完成（tag `stage-1`，[总结](stages/stage-1-engineering-foundation.md)） |
| **2. 应用骨架** | 有类型的 HTTP 客户端和错误模型、鉴权、路由守卫（用模块扩充给 `RouteMeta` 加类型）、布局、存储适配器、MSW、Element Plus 主题、CSS Modules | 泛型、可辨识联合、模块扩充、Adapter 和 Strategy 模式 | ✅ 完成（tag `stage-2`，[总结](stages/stage-2-app-skeleton-and-auth.md)） |
| **3. 第一个纵切** | 登录 + 布局 + 一个简单列表页，把 API、query、store、TSX 组件、测试整条链路跑通 | vue-query（TanStack Query），TSX 中 props、emits、slots 的类型写法 | ✅ 完成（tag `stage-3`，[总结](stages/stage-3-layout-and-first-list.md)）：页面布局规范与 `libs/ui`（ADR 0016）、文件管理列表（ADR 0017）、会话结束的统一处理 |
| **4. map-core** | 重新设计引擎抽象、Manager 体系、有类型的事件、有类型的 Worker 消息、资源释放 | 接口与抽象类的区别、Facade、Factory、Observer、`using` / Disposable | ✅ 完成（tag `stage-4`，[总结](stages/stage-4-map-core.md)）：地图会话与 MapLibre 适配器（ADR 0018～0024）、Worker 通信层（ADR 0025） |
| **5. map-vue + 现状底图** | `MapProvider`、`useMap()`、图层面板 | provide / inject 的类型、响应式边界（`shallowRef`、`markRaw`） | 进行中：拆成 5A～5D，见下文"阶段五" |
| **三维** | map-cesium：Cesium 运行时、样式镜像与三维样式的支持清单、相机同步、三维拾取与测量、瓦片数据服务与 Worker 池；三维独有功能（漫游、钻地、室内地图、本地 3D Tiles）的迁移范围到时再定 | 接近无感的二三维切换、对象池与 Worker 调度 | 未开始（阶段五开始时加入） |
| **6. 复杂业务** | 空间监测三件套、AI 流式对话、文件管理，以及其余业务模块 | 拆分巨型组件、流式读取与 SSE、取消请求 | 未开始 |
| **7. 收尾** | Playwright、产物分析、部署 | — | 未开始 |

**为什么第 3 步先做简单页面，再做地图？** 地图内核会用到 HTTP、鉴权（瓦片请求要带 token）和错误处理。这些基础设施先在简单页面上验证，比直接放进最复杂的代码里验证风险小得多。学习顺序也更平缓：先掌握 TS 和 TSX 的基础，再进入以面向对象为主的地图部分。

**同步旧仓库的做法**：每迁移一个模块，在 [migration.md](migration.md) 记下对应的 yzt commit 作为基线，以后用 `git diff <基线>..master-demo -- <路径>` 查看旧项目在这个模块上的新改动。（原计划记在 AGENTS.md，阶段二改为单独的 `migration.md`；比较对象用 `master-demo` 而不是 `HEAD`，因为旧仓库可能停在其他分支上。）

## 已完成阶段的调整

与原计划不同的地方：

| 阶段 | 调整 | 原因 |
|---|---|---|
| 1 | lint 用 oxlint + oxlint-tsgolint，不用 ESLint | ESLint 的 typescript-eslint 在 TS 7 下无法加载（ADR 0003） |
| 1 → 2 | Vitest 挪到阶段二（2.5） | 阶段一没有需要测试的逻辑；写鉴权、HTTP 之前再引入（ADR 0010） |
| 2 | 骨架、数据层、鉴权合为一个阶段 | 阶段结束时能完整走通登录流程，阶段三直接做业务 |
| 3 → 2 | 登录页、布局提前到阶段二完成 | 走通"登录 → 进入首页 → 导航切换 → 退出"需要它们 |
| 2 | 新增：字体与系统名称 SVG 轮廓、第一个 workspace 包 `@yzt/icons` | 设计规范与 UI 素材到位（ADR 0012～0014） |
| 2 | 未做：存储适配器 | 会话需要同步读取，直接用 localStorage；IndexedDB 等到有需要持久化的大块数据时再做 |
| 6 | 不迁移知识图谱（资源中心）；加入文件管理 | 迁移范围确认（见 AGENTS.md"迁移规则"） |
| 3 | 先定页面布局规范、做 `libs/ui` 组件（3.1、3.2），再做列表页（3.3） | 列表页要用布局组件；先统一规范，避免每个页面各写一套 |
| 4 → 3 | `tsconfig.libs.json` 和第一个 libs 模块提前到阶段三（`libs/ui`） | 布局组件是第一个可以拆出去的通用代码（ADR 0016） |
| 3 | 新增 `MxSection`；引入 `@vueuse/core`，版本与 element-plus 内部依赖的一致（15）；抽屉内边距成为"页面不覆盖 `--el-*` 变量"的唯一例外 | 区块间距统一；媒体查询和尺寸监听不重复造轮子，也不打包两份；侧栏面板放进抽屉要贴边 |
| 6 → 3 | 文件管理的列表部分（列表、筛选、分页、删除）提前到阶段三，上传、下载、预览仍在阶段六 | 选作第一个列表页：左右结构，能验证布局组件 |
| 3 | 没有用到 Pinia store：接口数据在查询缓存，界面状态在组合式函数 `useFileList` | 原计划要跑通"API、query、store"链路；列表页没有跨组件共享的客户端状态 |
| 3 | 3.3 验收后新增通用模块和全局样式：`shared/query-form`（查询表单）、`shared/table`（骨架屏）、表格空值与树的全局样式、操作按钮的图标规范、窄屏侧栏收成窄条 | 验收时的反馈都做成通用规则，后续列表页直接套用 |
| 3 | 发请求前检查 token 是否过期（阶段二认为不需要） | 实测 `/file/page` 不校验 token，过期后停在页面上仍能请求成功 |
| 4 | "Manager 体系"只定了设计（Manager 修改会话状态，拥有者用纯函数推导分组），没有写具体的 Manager；会话里的当前工具、选择状态两个模型也推迟 | 还没有使用方；跟着阶段五、六的业务图层、点选、测量一起做 |
| 4 | Worker 只做了通信层和 `WorkerHost`；Worker 池、缓存与瓦片数据服务推迟 | 等第一个真实使用方出现，用真实瓦片验证后再定（ADR 0025） |
| 4 | 新增：app 的地图运行时懒加载与 `/dev/map` 开发页 | 内核要在真实的 MapLibre 上验证；开发页发现了两个单元测试发现不了的问题 |
| 4 | 新增：开发页面集中到 `pages/dev` 的命名规范；地图资源加载策略的原则（不绑定默认的二维或三维模式） | 讨论中提出；加载策略到阶段五实测后写 ADR |
| 5 | 拆成 5A～5D 四个子阶段，每个子阶段单独验收、打 tag、写总结 | 内容约为阶段四的三倍 |
| 5 | 先建设公共地图能力（底图、行政区边界、工具栏、测量、定位），现状底图和以后的地图页按需组装；当前工具、输入拾取投影、测量、点选从"做的时候"提前到本阶段 | 旧项目的底图、边界、定位、绘制在多个地图页各写一份（见下文"阶段五"） |
| 5 → 三维 | 二三维切换移到单独的三维阶段 | 工作量与阶段四相当，并且依赖瓦片数据服务与 Worker 池 |

## 后续阶段要带上的事项

各文档中写着"到某阶段再做"的事项，集中列在这里：

| 阶段 | 事项 | 出处 |
|---|---|---|
| 3 之后 | 接入 Renovate 自动处理依赖更新 | ADR 0005 |
| 3 之后 | 评估 Playwright 端到端测试；覆盖率与门槛 | ADR 0010 |
| 5A.0 | 测试耗时：`apps/web` 约 51 秒（阶段三结束时约 26 秒），先查原因，同时评估 `fsModuleCache` | [stages/stage-4-map-core.md](stages/stage-4-map-core.md) |
| 5A.3 | 画布型页面：地图铺满内容区，操作栏和面板悬浮；悬浮面板沿用面板规范、统一浅色；地图定位时的 padding 要避开悬浮面板，由布局提供被占用的区域，不由页面各自计算 | [design/page-layout.md](design/page-layout.md) |
| 5A.3 | 视图进入 `failed`（如 `GPUInitializationError`）时的提示；现状底图的路由用 `withMapRuntime` 包装；交给 MapLibre 的容器元素只用静态 class | ADR 0019、map-core.md |
| 5A 结束时 | 5A 的总结要包括阶段五开始前的边界修复（ADR 0026）：样式加载失败进入 `failed` 并在新版本时自动恢复、应用命令期间的 `error` 事件触发整体重建、首次进入 ready 与恢复显示统一同步相机、Worker 一侧的 `messageerror` 按崩溃处理；以及随后的 3 个样式恢复边界：加载失败时已有新版本就直接重新加载、报错后仍加载完成时恢复快照并继续同步、激活中追赶失败时中止激活；`whenReady()` 按一轮整体加载结束（恢复显示触发重建时不再提前成功） | 本文 |
| 5B.3、5C.6 | 会话的当前工具（5B.3）与选择状态（5C.6）两个模型；视图接口的输入、拾取、投影（5B.3）和查询（5C.4 或 5C.6，先用到的那一步）；第三个模型出现时，用组合把重复的释放逻辑抽成小辅助对象 | [modules/map-core.md](modules/map-core.md)"还没做的" |
| 5B.4 | 椭球面测量用哪个库（候选 geographiclib-geodesic） | ADR 0024 |
| 5C.1 | 图层配置由后端驱动时，业务图层的拥有者在配置变化时校验自己的分组，不合法的配置不进入会话（否则一个坏图层会让整个二维视图进入 `failed`）；只在配置变化时校验，不在每次提交时校验 | ADR 0026 |
| 5C.1 | Worker 数量是否调到旧项目的 4 个，接入地类图斑时实测（`setupMapRuntime` 里调用 `setWorkerCount`）；未勾选的资源图层要不要留在样式里，用真实数据实测 | ADR 0019、本文 |
| 5C.3 | 持久化：IndexedDB + idb-keyval 的存储适配器，第一个使用方预计是图层排序；键按用户区分、会话结束时是否清理、首屏等待读取 | AGENTS.md、本文 |
| 5C.4 | 用真实数据实测 MapLibre 6 下图例统计（当前出现的地类）的主线程耗时，再选后端聚合、Worker 解码属性或按需统计 | ADR 0021 |
| 5C.5 | 图例等初始化数据是否随项目打包后写入 IndexedDB，结合真实数据量决定 | 本文 |
| 5C.6 | 高亮用 feature-state 还是按要素 ID 过滤的图层，实测后决定 | ADR 0022 |
| 5C.8 | 年份与资源的交互：同一资源有多个年份（如地类图斑 2022、2023），组装页面时统一设计 | 本文 |
| 5D | 地图页的页面缓存（keep-alive） | [modules/layout.md](modules/layout.md) |
| 5D | 地图资源的加载策略：不绑定默认模式，由 app 的解析函数给出进入地图时的默认框架（二维或三维）；运行时按框架组织并注入给 map-vue；登录页空闲时预加载预测的默认框架；实测"点击登录 → 地图第一次加载完成"后写 ADR | [modules/map-core.md](modules/map-core.md)"地图资源的加载策略" |
| 三维 | 评估 utils、map-core、map-cesium 一起拆到 `packages/`；自己写的 Worker 的类型检查配置 | ADR 0018、0021 |
| 第一个 Worker 真实使用方出现时 | Worker 池的调度、缓存淘汰、内存预算用真实瓦片验证；真实 Worker 在 Vite 下的打包与加载在 `/dev` 开发页验证；此前向后端确认瓦片是否因用户或权限而不同 | ADR 0025 |
| 三维 | Cesium 运行时作为第二个框架加载函数接入；悬停切换按钮时开始加载；默认三维时是否预取 Cesium 的静态资源；实现镜像前写出三维样式的支持清单与降级规则；拾取按模型、地形、椭球报告命中表面；相机同步不再用 `map.transform`（v6 已移除），改用公开 API；MVT 解码的 `@mapbox/vector-tile`、`pbf` 对齐 maplibre-gl 依赖的版本；三维点选改用瓦片数据服务，不再先对齐二维；评估三维期间二维是否还要存活；瓦片数据服务与 MapLibre 之间避免重复下载的做法 | ADR 0019、0020、0021、0024 |
| 6 | AI 对话：AI 后端登录不再在前端写死账号密码 | ADR 0015 |
| 6 | 修改密码（另一把 SM2 公钥、另一种密文格式）、修改头像、消息铃铛 | [modules/layout.md](modules/layout.md) |
| 6 | 文件管理：上传（"上传文档"按钮已占位）、下载与进度、预览 | ADR 0011、[migration.md](migration.md) |
| 6 | 其他列表页套用阶段三的通用规则：`QueryForm`、加载状态的三种情况与 `TableSkeleton`、表格空值、操作按钮图标 | [modules/query-form.md](modules/query-form.md)、[modules/table.md](modules/table.md) |
| 需要时 | `QueryForm`：日期范围这类 180 放不下的控件要加一种加宽的写法；会话结束时把 feature 的 store 一并重置（目前没有） | [modules/query-form.md](modules/query-form.md)、[modules/auth.md](modules/auth.md) |
| 6 | 上传、下载统一成一套能力（统一的上传 / 下载方法或独立模块，包括进度、文件名、错误处理、预览前的 MIME 补齐），文件管理、数据下载（资源申请）、数据查询的导出共用，不再各自实现。旧项目在迁移范围内至少有 5 处各写各的下载：`libs/http-service.js` 的 blob 处理、`services/resource-application/applyApiService.js`（`downloadApplicationFile`、`downloadStatisticsReportFile`）、`downloadTaskService.js`（带进度）、文件管理 `FileManagementContent.vue`（`requestFileBlob`、`downloadBlob`）、数据查询 `space-monitoring-query/index.vue`（`downloadExportBlob`）；`FormData` 上传 3 处：文件管理上传弹窗、资源管理 Excel 导入、数据查询 | 本文（2026-10-08 提出） |
| 6 | 页面内菜单（系统管理左栏）用 `ElMenu` 加变体还是做 `MxSideMenu`；宽屏时手动把侧栏收成窄条（基本统计页，可复用窄屏的窄条）；单列居中（消息中心）；旧页面左栏 296、348 归到 320 | [design/page-layout.md](design/page-layout.md) |
| 7 | 部署（nginx 回退与接口转发，带 hash 的产物长期缓存、`index.html` 不缓存、开启压缩）；版本号格式 | [deployment.md](deployment.md)、ADR 0005 |

## 阶段三：页面布局与第一个列表页

2026-09-30 开始，2026-10-08 完成，详见[阶段总结](stages/stage-3-layout-and-first-list.md)：

- 3.1 页面布局规范与设计稿：[design/page-layout.md](design/page-layout.md)、[ADR 0016](adr/0016-ui-components-in-libs-ui.md)、间距与圆角令牌（[design/color-and-typography.md](design/color-and-typography.md) 第 6.1 节）
- 3.2 `libs/ui` 的分栏布局、面板、区块、标题组件：[modules/ui.md](modules/ui.md)
- 3.3 文件管理列表：TanStack Vue Query（[ADR 0017](adr/0017-server-state-with-tanstack-query.md)），表格和树的全局样式（[design/theme.md](design/theme.md)），验收后加入的查询表单（[modules/query-form.md](modules/query-form.md)）与加载状态（[modules/table.md](modules/table.md)）
- 会话结束的统一处理：[modules/auth.md](modules/auth.md)

## 阶段四：地图内核

2026-10-09 开始，2026-10-09 完成，详见[阶段总结](stages/stage-4-map-core.md)：

- 开始前的修复：文件管理的删除流程、分页总数与页码、输入法回车、`QueryForm` 重新测量；进入登录页时清理过期会话、退出确认框；测试自动卸载组件
- 4.0 读旧代码（分析补进 [modules/map-core.md](modules/map-core.md)），确定 map-core 的位置（[ADR 0018](adr/0018-map-core-in-libs.md)）和 MapLibre 的大版本（[ADR 0019](adr/0019-maplibre-v6.md)），记下迁移基线
- 4.1 二三维关系：地图会话状态是唯一的真相源，接近无感的切换是核心能力（[ADR 0020](adr/0020-map-session-state-as-source-of-truth.md)）；Worker 策略：二维不自建渲染 Worker，统一通信层与瓦片数据服务（[ADR 0021](adr/0021-worker-strategy.md)）
- 4.2 接口设计：样式模型与会话提交（[ADR 0022](adr/0022-style-model-and-session-commits.md)）、资源释放与事件（[ADR 0023](adr/0023-disposal-events-and-map-runtime.md)）、二三维共用的视图接口（[ADR 0024](adr/0024-shared-view-interfaces.md)）、Worker 通信契约与瓦片数据服务（[ADR 0025](adr/0025-worker-contract-and-tile-data-service.md)）；评审中对 0020、0021 的修正写进了新的 ADR
- 4.3 实现，按顺序：`diffStyle` → `StyleModel` → `CameraModel` → `MapSession`（原计划的 `createMapSession` 改为类）→ MapLibre 适配器（`applyStyleCommand`、`MapLibreView`、lint 限制 maplibre-gl 的导入位置、app 地图运行时与 `/dev/map` 开发页），每一步带测试，用法见 [modules/map-core.md](modules/map-core.md)；`@yzt/utils` 的 Worker 通信层（协议、三层取消、故障语义、`WorkerHost`，见 [modules/utils.md](modules/utils.md)）
- 开发页面集中到 `pages/dev`；地图资源加载策略的原则（map-core.md"地图资源的加载策略"）

## 阶段五：map-vue 与现状底图

2026-10-09 开始。

方向（开始时讨论确定）：

- **公共地图能力先行，页面按需组装**：旧项目的底图、行政区边界、定位、绘制在现状底图、数据查询、指标、AI 对话等页面各写一份；`CommonMap` 靠一组开关（`showToolbar`、`enableManagedLayers` 等）做"公共地图"，开关越来越多，代码分成两套路径。新做法是每项能力做成独立的一块，页面挑选组合，不做全能的地图组件。现状底图是第一个使用方，接口只做它需要的部分；阶段六迁移数据查询页时，它的空间绘制作为第二个使用方检验
- **现在定结构，细节到对应功能时实测再定**：分层与依赖方向、会话与视图分开、资源身份（code）与年份分开、资源树不回退本地配置，在 5A 定；未勾选的图层留不留在样式里、Worker 数量、测地线计算库、高亮方式、地类统计方案、页面缓存、IndexedDB 存什么、年份交互、加载策略，做到对应步骤时结合真实接口、数据量和运行效果再定
- **现状底图整页重构**：去掉旧项目的过度兜底；资源树请求失败时显示失败和重试，不回退本地快照（`assets/tree-data.ts`）；三区三线暂不迁移

| 子阶段 | 步骤 | 结束时 |
|---|---|---|
| 5A 地图骨架 | 5A.0 测试耗时、接口实测、迁移基线；5A.1 ADR（地图能力的分层、map-vue 的上下文）；5A.2 map-vue（会话的 provide / inject、地图画布组件、分组提交），`/dev/map` 改用；5A.3 画布型布局（先出设计稿）、`failed` 提示、现状底图页骨架 | 现状底图的空页面能显示地图 |
| 5B 公共地图能力 | 5B.1 底图（目录、拥有者、切换面板）；5B.2 行政区边界、默认视角；5B.3 交互基础（二维的输入、拾取、投影，当前工具模型，工具栏外壳）；5B.4 测距、测面、清除；5B.5 区划定位、坐标定位 | 任何地图页都能装上底图、边界和工具栏 |
| 5C 现状底图业务 | 5C.1 资源图层（接口、规范化、样式登记表、显示状态、拥有者与校验）；5C.2 图层面板；5C.3 持久化（存储适配器）；5C.4 只读图例与地类统计；5C.5 符号编辑；5C.6 点选与详情面板；5C.7 区划裁剪；5C.8 年份与资源的交互 | 除三维外与旧页面功能对齐 |
| 5D 收尾 | 页面缓存；加载策略的性能标记、实测与 ADR | — |

- 每个子阶段单独验收、打 tag（`stage-5a`～`stage-5d`），并在 `stages/` 下写一篇总结
- 5C.1 风险最大（约两百个图层、真实数据量），不依赖 5B，需要提前暴露性能问题时可以挪到 5B.3 之前
- 区划定位（飞到区划、高亮边界）是公共能力，放在 5B.5；区划裁剪会影响资源图层，放在 5C.7

## 业务模块

除了阶段 3 的列表页和阶段 5 的现状底图，其余业务模块都在阶段 6。当前的路由（文件管理已完成列表部分，其余为占位页）：

| 模块 | 路由 | 角色 | 旧项目目录 |
|---|---|---|---|
| 现状底图 | `current-map` | 全部 | `views/current-map-new` |
| 数据查询（国土变更、城市国土空间监测、森林草原湿地荒漠、水资源） | `*-query` | 全部 | `views/space-monitoring-query`（四个页面共用，按 `queryModule` 区分） |
| 城市国土空间监测基本统计 | `space-monitoring-basic-statistics` | 全部 | `views/space-monitoring-statistics` |
| 城市国土空间监测指标 | `space-monitoring-indicators` | 全部 | `views/space-monitoring-indicators` |
| 文件管理 | `file-management` | 全部 | `views/resource-center/file-management.vue` |
| AI 对话 | `ai-chat` | 全部 | `views/ai-chat` |
| 消息中心 | `message-center` | 全部 | `views/message-center` |
| 资源管理 | `resource-management` | 管理员 | `views/resource-management-new` |
| 系统管理 | `system-management` | 管理员 | `views/system-management` |
| 数据下载（资源申请） | `resource-application` | 普通用户 | `views/resource-application` |

"空间监测三件套"指数据查询、基本统计、指标这三个页面组件。旧目录按旧项目的路由表对应（2026-09-30 核对），开始迁移某个模块时再读代码确认实际用到的文件，并在 [migration.md](migration.md) 记下基线。
