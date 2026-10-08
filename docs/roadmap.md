# 路线图

整个重构分为 8 个阶段。本表在阶段零制定（当时只写在会话中，2026-09-30 补成本文），此后每个阶段结束时更新"状态"和"调整"两部分；原来的"内容"和"主要学习点"保留，便于对照计划与实际。

## 阶段总览

| 阶段 | 内容 | 主要学习点 | 状态 |
|---|---|---|---|
| **0. 约定** | `AGENTS.md` 骨架（分层、依赖方向、命名），确认待定问题 | 架构分层、依赖倒置 | ✅ 完成（ADR 0001、0002、0004） |
| **1. 工程基础** | `apps/web`：Vite 最新版 + `plugin-vue-jsx` + TS strict；tsconfig 分层；实测 TS 7 工具链；lint（只管正确性，格式交给 WebStorm）；Vitest | tsconfig 各项配置的含义、`jsxImportSource: 'vue'`、Vite 插件管线 | ✅ 完成（tag `stage-1`，[总结](stages/stage-1-engineering-foundation.md)） |
| **2. 应用骨架** | 有类型的 HTTP 客户端和错误模型、鉴权、路由守卫（用模块扩充给 `RouteMeta` 加类型）、布局、存储适配器、MSW、Element Plus 主题、CSS Modules | 泛型、可辨识联合、模块扩充、Adapter 和 Strategy 模式 | ✅ 完成（tag `stage-2`，[总结](stages/stage-2-app-skeleton-and-auth.md)） |
| **3. 第一个纵切** | 登录 + 布局 + 一个简单列表页，把 API、query、store、TSX 组件、测试整条链路跑通 | vue-query（TanStack Query），TSX 中 props、emits、slots 的类型写法 | ⏳ 进行中：登录和布局已在阶段二完成。3.1 页面布局规范与设计稿已完成（[design/page-layout.md](design/page-layout.md)、ADR 0016）；3.2 `libs/ui` 进行中：3.2a 基础（`tsconfig.libs.json`、断点下移）、3.2b 标题、区块与面板已完成，接下来 3.2c 分栏布局、3.2d 文档（预览页截图确认），然后 3.3 列表页 |
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

## 后续阶段要带上的事项

各文档中写着"到某阶段再做"的事项，集中列在这里：

| 阶段 | 事项 | 出处 |
|---|---|---|
| 3 | 选定第一个列表页：优先文件管理或资源管理（左右结构，能验证布局组件）；数据下载、消息中心为备选 | 本文 |
| 3 | `libs/ui` 的分栏布局、面板、标题组件：窄屏用 ElDrawer + Teleport（先做实验验证状态与滚动位置），面板通过 inject 感知布局显示打开 / 关闭按钮，`useMediaQuery` 用 `@vueuse/core` | [design/page-layout.md](design/page-layout.md)、ADR 0016、[modules/ui.md](modules/ui.md) |
| 3 | 是否引入 TanStack Query 管理接口数据；请求的重试、去重、缓存 | ADR 0011、[modules/http.md](modules/http.md) |
| 3 | 全局表格样式（旧项目资源管理列表的表头、行高、悬停色等） | [design/theme.md](design/theme.md) |
| 3 | 会话结束的统一处理：取消请求、账号之间的数据隔离、清理缓存、错误提示由谁负责，协调逻辑放在 app（多标签页同步已在阶段三开始前完成，届时并入） | [modules/auth.md](modules/auth.md) |
| 3 结束时 | 阶段总结要包括阶段三开始前的修复：图标重名覆盖已有素材、旧会话的 401 清掉新会话、`clear()` 比较后删除、token 载荷校验、登录表单销毁后取消请求、多标签页同步，以及新增的 AGENTS.md 规则（素材见 `git log stage-2..` 的提交说明） | 本文 |
| 3 之后 | 接入 Renovate 自动处理依赖更新 | ADR 0005 |
| 3 之后 | 评估 Playwright 端到端测试；覆盖率与门槛 | ADR 0010 |
| 4 | map-core 放 `libs/` 还是做成 `packages/`（第一个 libs 模块和 `tsconfig.libs.json` 已提前到阶段三的 `libs/ui`） | AGENTS.md、ADR 0004、0006 |
| 4 | MapLibre 的大版本 | ADR 0002 |
| 5 | 地图页的页面缓存（keep-alive） | [modules/layout.md](modules/layout.md) |
| 5 | 画布型页面：地图铺满内容区，操作栏和面板悬浮；悬浮面板沿用面板规范、统一浅色；地图定位时的 padding 要避开悬浮面板，由布局提供被占用的区域，不由页面各自计算 | [design/page-layout.md](design/page-layout.md) |
| 6 | AI 对话：AI 后端登录不再在前端写死账号密码 | ADR 0015 |
| 6 | 修改密码（另一把 SM2 公钥、另一种密文格式）、修改头像、消息铃铛 | [modules/layout.md](modules/layout.md) |
| 6 | 文件管理：上传、下载与进度 | ADR 0011 |
| 6 | 页面内菜单（系统管理左栏）用 `ElMenu` 加变体还是做 `MxSideMenu`；侧栏收成窄条（基本统计页）；单列居中（消息中心）；旧页面左栏 296、348 归到 320 | [design/page-layout.md](design/page-layout.md) |
| 需要时 | 持久化（IndexedDB + idb-keyval，存储适配器） | AGENTS.md |
| 7 | 部署（nginx 回退与接口转发）；版本号格式 | [deployment.md](deployment.md)、ADR 0005 |

## 阶段三：页面布局

2026-09-30 阶段三开始前讨论确定目标与范围，3.1 出设计稿确认后写成：

- [design/page-layout.md](design/page-layout.md)：页面类型、分栏布局、面板、标题、卡片头部、窄屏抽屉、画布型的规则，设计稿确认的取舍，以及旧项目的参考文件
- [ADR 0016](adr/0016-ui-components-in-libs-ui.md)：通用 UI 组件放在 `libs/ui`，以及由此带来的 `tsconfig.libs.json` 提前、断点下移、图标经插槽传入、依赖 CSS 变量四项后果
- 间距与圆角令牌：[design/color-and-typography.md](design/color-and-typography.md) 第 6.1 节，登记在 [design/theme.md](design/theme.md)

流程：3.1 规范与设计稿（已完成）→ 3.2 在主题预览页展示 `libs/ui` 组件，截图确认 → 3.3 做列表页，优先文件管理或资源管理。

## 业务模块

除了阶段 3 的列表页和阶段 5 的现状底图，其余业务模块都在阶段 6。当前的路由（均为占位页）：

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
