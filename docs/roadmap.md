# 路线图

整个重构分为 8 个阶段。本表在阶段零制定（当时只写在会话中，2026-09-30 补成本文），此后每个阶段结束时更新"状态"和"调整"两部分；原来的"内容"和"主要学习点"保留，便于对照计划与实际。

## 阶段总览

| 阶段 | 内容 | 主要学习点 | 状态 |
|---|---|---|---|
| **0. 约定** | `AGENTS.md` 骨架（分层、依赖方向、命名），确认待定问题 | 架构分层、依赖倒置 | ✅ 完成（ADR 0001、0002、0004） |
| **1. 工程基础** | `apps/web`：Vite 最新版 + `plugin-vue-jsx` + TS strict；tsconfig 分层；实测 TS 7 工具链；lint（只管正确性，格式交给 WebStorm）；Vitest | tsconfig 各项配置的含义、`jsxImportSource: 'vue'`、Vite 插件管线 | ✅ 完成（tag `stage-1`，[总结](stages/stage-1-engineering-foundation.md)） |
| **2. 应用骨架** | 有类型的 HTTP 客户端和错误模型、鉴权、路由守卫（用模块扩充给 `RouteMeta` 加类型）、布局、存储适配器、MSW、Element Plus 主题、CSS Modules | 泛型、可辨识联合、模块扩充、Adapter 和 Strategy 模式 | ✅ 完成（tag `stage-2`，[总结](stages/stage-2-app-skeleton-and-auth.md)） |
| **3. 第一个纵切** | 登录 + 布局 + 一个简单列表页，把 API、query、store、TSX 组件、测试整条链路跑通 | vue-query（TanStack Query），TSX 中 props、emits、slots 的类型写法 | ✅ 完成（tag `stage-3`，[总结](stages/stage-3-layout-and-first-list.md)）：页面布局规范与 `libs/ui`（ADR 0016）、文件管理列表（ADR 0017）、会话结束的统一处理 |
| **4. map-core** | 重新设计引擎抽象、Manager 体系、有类型的事件、有类型的 Worker 消息、资源释放 | 接口与抽象类的区别、Facade、Factory、Observer、`using` / Disposable | 未开始 |
| **5. map-vue + 现状底图** | `MapProvider`、`useMap()`、图层面板 | provide / inject 的类型、响应式边界（`shallowRef`、`markRaw`） | 未开始 |
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

## 后续阶段要带上的事项

各文档中写着"到某阶段再做"的事项，集中列在这里：

| 阶段 | 事项 | 出处 |
|---|---|---|
| 3 之后 | 接入 Renovate 自动处理依赖更新 | ADR 0005 |
| 3 之后 | 评估 Playwright 端到端测试；覆盖率与门槛 | ADR 0010 |
| 4 | map-core 放 `libs/` 还是做成 `packages/`（第一个 libs 模块和 `tsconfig.libs.json` 已提前到阶段三的 `libs/ui`） | AGENTS.md、ADR 0004、0006 |
| 4 | MapLibre 的大版本 | ADR 0002 |
| 5 | 地图页的页面缓存（keep-alive） | [modules/layout.md](modules/layout.md) |
| 5 | 画布型页面：地图铺满内容区，操作栏和面板悬浮；悬浮面板沿用面板规范、统一浅色；地图定位时的 padding 要避开悬浮面板，由布局提供被占用的区域，不由页面各自计算 | [design/page-layout.md](design/page-layout.md) |
| 6 | AI 对话：AI 后端登录不再在前端写死账号密码 | ADR 0015 |
| 6 | 修改密码（另一把 SM2 公钥、另一种密文格式）、修改头像、消息铃铛 | [modules/layout.md](modules/layout.md) |
| 6 | 文件管理：上传（"上传文档"按钮已占位）、下载与进度、预览 | ADR 0011、[migration.md](migration.md) |
| 6 | 其他列表页套用阶段三的通用规则：`QueryForm`、加载状态的三种情况与 `TableSkeleton`、表格空值、操作按钮图标 | [modules/query-form.md](modules/query-form.md)、[modules/table.md](modules/table.md) |
| 需要时 | `QueryForm`：同一行里动态增删条件时按钮行宽度不会更新；日期范围这类 180 放不下的控件要加一种加宽的写法；会话结束时把 feature 的 store 一并重置（目前没有） | [modules/query-form.md](modules/query-form.md)、[modules/auth.md](modules/auth.md) |
| 6 | 上传、下载统一成一套能力（统一的上传 / 下载方法或独立模块，包括进度、文件名、错误处理、预览前的 MIME 补齐），文件管理、数据下载（资源申请）、数据查询的导出共用，不再各自实现。旧项目在迁移范围内至少有 5 处各写各的下载：`libs/http-service.js` 的 blob 处理、`services/resource-application/applyApiService.js`（`downloadApplicationFile`、`downloadStatisticsReportFile`）、`downloadTaskService.js`（带进度）、文件管理 `FileManagementContent.vue`（`requestFileBlob`、`downloadBlob`）、数据查询 `space-monitoring-query/index.vue`（`downloadExportBlob`）；`FormData` 上传 3 处：文件管理上传弹窗、资源管理 Excel 导入、数据查询 | 本文（2026-10-08 提出） |
| 6 | 页面内菜单（系统管理左栏）用 `ElMenu` 加变体还是做 `MxSideMenu`；宽屏时手动把侧栏收成窄条（基本统计页，可复用窄屏的窄条）；单列居中（消息中心）；旧页面左栏 296、348 归到 320 | [design/page-layout.md](design/page-layout.md) |
| 需要时 | 持久化（IndexedDB + idb-keyval，存储适配器） | AGENTS.md |
| 7 | 部署（nginx 回退与接口转发）；版本号格式 | [deployment.md](deployment.md)、ADR 0005 |

## 阶段三：页面布局与第一个列表页

2026-09-30 开始，2026-10-08 完成，详见[阶段总结](stages/stage-3-layout-and-first-list.md)：

- 3.1 页面布局规范与设计稿：[design/page-layout.md](design/page-layout.md)、[ADR 0016](adr/0016-ui-components-in-libs-ui.md)、间距与圆角令牌（[design/color-and-typography.md](design/color-and-typography.md) 第 6.1 节）
- 3.2 `libs/ui` 的分栏布局、面板、区块、标题组件：[modules/ui.md](modules/ui.md)
- 3.3 文件管理列表：TanStack Vue Query（[ADR 0017](adr/0017-server-state-with-tanstack-query.md)），表格和树的全局样式（[design/theme.md](design/theme.md)），验收后加入的查询表单（[modules/query-form.md](modules/query-form.md)）与加载状态（[modules/table.md](modules/table.md)）
- 会话结束的统一处理：[modules/auth.md](modules/auth.md)

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
