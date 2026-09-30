# 路线图

整个重构分为 8 个阶段。本表在阶段零制定（当时只写在会话中，2026-09-30 补成本文），此后每个阶段结束时更新"状态"和"调整"两部分；原来的"内容"和"主要学习点"保留，便于对照计划与实际。

## 阶段总览

| 阶段 | 内容 | 主要学习点 | 状态 |
|---|---|---|---|
| **0. 约定** | `AGENTS.md` 骨架（分层、依赖方向、命名），确认待定问题 | 架构分层、依赖倒置 | ✅ 完成（ADR 0001、0002、0004） |
| **1. 工程基础** | `apps/web`：Vite 最新版 + `plugin-vue-jsx` + TS strict；tsconfig 分层；实测 TS 7 工具链；lint（只管正确性，格式交给 WebStorm）；Vitest | tsconfig 各项配置的含义、`jsxImportSource: 'vue'`、Vite 插件管线 | ✅ 完成（tag `stage-1`，[总结](stages/stage-1-engineering-foundation.md)） |
| **2. 应用骨架** | 有类型的 HTTP 客户端和错误模型、鉴权、路由守卫（用模块扩充给 `RouteMeta` 加类型）、布局、存储适配器、MSW、Element Plus 主题、CSS Modules | 泛型、可辨识联合、模块扩充、Adapter 和 Strategy 模式 | ✅ 完成（tag `stage-2`，[总结](stages/stage-2-app-skeleton-and-auth.md)） |
| **3. 第一个纵切** | 登录 + 布局 + 一个简单列表页，把 API、query、store、TSX 组件、测试整条链路跑通 | vue-query（TanStack Query），TSX 中 props、emits、slots 的类型写法 | ⏳ 下一步：登录和布局已在阶段二完成。按 3.1 页面布局规范与设计稿 → 3.2 `libs/ui` 的布局、面板、标题组件（预览页截图确认）→ 3.3 列表页的顺序进行 |
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
| 3 | 页面布局规范与 `libs/ui` 的布局、面板、标题组件 | 本文"阶段三：页面布局的已定事项" |
| 3 | 是否引入 TanStack Query 管理接口数据；请求的重试、去重、缓存 | ADR 0011、[modules/http.md](modules/http.md) |
| 3 | 全局表格样式（旧项目资源管理列表的表头、行高、悬停色等） | [design/theme.md](design/theme.md) |
| 3 | 会话结束的统一处理：取消请求、账号之间的数据隔离、清理缓存、错误提示由谁负责，协调逻辑放在 app（多标签页同步已在阶段三开始前完成，届时并入） | [modules/auth.md](modules/auth.md) |
| 3 结束时 | 阶段总结要包括阶段三开始前的修复：图标重名覆盖已有素材、旧会话的 401 清掉新会话、`clear()` 比较后删除、token 载荷校验、登录表单销毁后取消请求、多标签页同步，以及新增的 AGENTS.md 规则（素材见 `git log stage-2..` 的提交说明） | 本文 |
| 3 之后 | 接入 Renovate 自动处理依赖更新 | ADR 0005 |
| 3 之后 | 评估 Playwright 端到端测试；覆盖率与门槛 | ADR 0010 |
| 4 | map-core 放 `libs/` 还是做成 `packages/`（第一个 libs 模块和 `tsconfig.libs.json` 已提前到阶段三的 `libs/ui`） | AGENTS.md、ADR 0004、0006 |
| 4 | MapLibre 的大版本 | ADR 0002 |
| 5 | 地图页的页面缓存（keep-alive） | [modules/layout.md](modules/layout.md) |
| 5 | 画布型页面：地图铺满内容区，操作栏和面板悬浮；悬浮面板沿用面板规范；地图定位时的 padding 要避开悬浮面板，由布局提供被占用的区域，不由页面各自计算 | 本文"阶段三：页面布局的已定事项" |
| 6 | AI 对话：AI 后端登录不再在前端写死账号密码 | ADR 0015 |
| 6 | 修改密码（另一把 SM2 公钥、另一种密文格式）、修改头像、消息铃铛 | [modules/layout.md](modules/layout.md) |
| 6 | 文件管理：上传、下载与进度 | ADR 0011 |
| 需要时 | 持久化（IndexedDB + idb-keyval，存储适配器） | AGENTS.md |
| 7 | 部署（nginx 回退与接口转发）；版本号格式 | [deployment.md](deployment.md)、ADR 0005 |

## 阶段三：页面布局的已定事项

2026-09-30 阶段三开始前讨论确定，是 3.1 的输入。3.1 写出 ADR 0016 和布局规范后，本节改为只保留指向它们的链接。

**目标**：旧项目的主视图大多是左右结构，但各页自己实现，左栏宽度有 200、320、348px 等多种，左侧贴边、右侧才留空，背景色各不相同；类似的标题样式在各视图里约有 82 处各自实现。阶段三先统一规则和组件，后续页面直接使用。

**两类页面**

| 类型 | 适用 | 规则 |
|---|---|---|
| 分栏型 | 列表、管理、配置类页面 | 左右两块四周都留统一间距；面板统一圆角和内边距；页面不设背景，由内容区统一提供 |
| 画布型 | 地图页 | 地图铺满内容区、无圆角；操作栏和面板悬浮在地图上。悬浮面板沿用面板规范，另加阴影（`--shadow-md`），离地图边缘的距离用同一个间距令牌；浅色和深色两种在设计稿中对比（现状底图目前是深色半透明）。在阶段五实现 |

**组件（`libs/ui`，`Mx` 前缀）**

- 分栏布局：只负责左右两块区域的排列和间距；侧栏宽度用固定档位（参考旧项目：菜单型 200、面板型 320），页面不写任意像素
- 面板：统一的圆角和内边距落在这里。结构为头部（标题 + 右侧操作）、内部滚动的内容区、可选的底部；放表格或地图时，内容区可以去掉内边距
- 标题：默认左侧蓝色竖杠，可以换成自定义图标；两个层级对应规范中的面板标题（16px/600）和区块标题（14px/600）；渲染为 `h2` / `h3`；有 `extra` 插槽放右侧操作；文字过长时省略。旧项目基本统计页的 `section-title`（图标、竖杠、附加内容）可以作为起点
- 截图中"选择查看报表"那种浅底加图标的样式，属于面板头部（卡片头部）样式，不是标题的一个层级，在设计稿中区分清楚

**高度与滚动**：分栏布局占满内容区，页面本身不滚动，各面板在内部滚动（`min-height: 0`）；表格要能占满面板的高度，页面不再写 `calc(100% - 32px)`。

**窄屏**：左栏收进抽屉，不直接隐藏。迁移范围内的左栏多是页面内导航（系统管理）或筛选条件（文件管理的目录树、资源管理的资源菜单），直接隐藏等于在窄屏上拿掉功能；做法与顶部导航在窄屏上收进"☰ 菜单"一致。

- 用 `ElDrawer` 从左侧滑出，由主内容区左上角的按钮打开
- 断点与顶部导航的 1200 对齐，全应用只有一个"窄屏"定义；设计稿中按 320px 的侧栏实测复核（1200 宽时主内容区约剩 830px）
- 只做抽屉一种；以后遇到只放辅助信息的左栏，再给布局组件加"直接隐藏"的选项
- 窗口宽度跨过断点时，左栏内容在侧栏和抽屉之间切换，要保留展开的树节点、滚动位置等状态（例如用 `Teleport` 移动而不重新创建，或把状态放在页面中）

**令牌**：设计规范原文没有间距和圆角，先补进 `docs/design/` 和 `tokens.scss` 再使用。旧页面的取值供参考：间隔 16、圆角 8、内边距 12～16。

**ADR 0016：通用 UI 组件放在 `libs/ui`**。要写明的后果：

1. 它是第一个 libs 模块，`tsconfig.libs.json` 从阶段四提前到阶段三（lint 的 `boundaries` 已经配置了 `apps/web/src/libs/*`）
2. 断点从 `app/layout/_breakpoints.scss` 下移到 `libs/ui`，app 反过来引用它（libs 不能引用 app）
3. `libs/ui` 不能引用 `shared/icons` 的 `SvgIcon`，自定义图标通过插槽传入
4. 组件使用 app 在 `app/styles/tokens.scss` 中定义的 CSS 变量，这是组件与应用之间的约定，要写明依赖了哪些变量

**流程**：

1. 3.1：写出 ADR 0016 和布局规范草案；出设计稿并确认。设计稿包括：菜单型和面板型两种分栏页面（含窄屏抽屉的状态）、标题的两个层级、面板头部、画布型的示意（浅色和深色悬浮面板）
2. 3.2：在主题预览页展示组件，截图确认
3. 3.3：做列表页，优先文件管理或资源管理

**旧项目参考**（`C:\WebProject\yzt`，`master-demo` 分支，`src/views/` 下）：

| 文件 | 看什么 |
|---|---|
| `resource-management-new/index.vue`、`resource-center/file-management.vue` | 面板型左右结构（左栏 320px，左侧贴边） |
| `system-management/index.vue`、`resource-application/index.vue` | 菜单型左右结构（左栏 200px） |
| `space-monitoring-statistics/index.vue` | `section-title` 的写法（图标、竖杠、`extra`）；左栏收成窄条 |
| `space-monitoring-statistics/components/StatisticsConditionPanel.vue` | "选择查看报表"的卡片头部 |
| `space-monitoring-indicators/index.vue` | 左栏 348px 的配置面板 |
| `message-center/index.vue` | 单列居中（`min(1088px, 100% - 48px)`），不是左右结构 |
| `current-map-new/index.vue`、`space-monitoring-query/index.vue` | 画布型：地图铺满、浮动操作栏；数据查询页的 `getSpatialQueryFitPadding` 是为避开悬浮面板计算定位 padding |

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
