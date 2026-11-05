# ADR 总览

查决策从这里开始：按主题只列现在有效的结论和出处，理由在 ADR 里，用法在模块文档里。完整索引和状态见 [README](README.md)。

地图部分单独一份：[地图架构总览](../modules/map-overview.md)。

## 工程与工具链

| 主题 | 现在的结论 | ADR | 文档 |
|---|---|---|---|
| 组件写法 | Vue 3 + TSX，不用 `.vue` 单文件组件 | 0001 | [code-style](../code-style.md) |
| TypeScript 与 lint | 只用 TS 7，不引入依赖 TS JS API 的工具；oxlint + oxlint-tsgolint；规则只分 `error`、`off`；不开 `incremental` | 0003、0006、0009 | [oxlintrc](../config/oxlintrc.md)、[tsconfig](../config/tsconfig.md) |
| 模块边界 | `pages → features → shared → libs`，lint 检查；libs 单入口，不读 env、store、router | 0004、0006、0018 | [oxlintrc](../config/oxlintrc.md) |
| 内部包 | `packages/*` 的 `exports` 直接指向源码，不单独构建；第一个是 `@yzt/icons` | 0014 | [internal-packages](../config/internal-packages.md)、[icons](../modules/icons.md) |
| 依赖维护 | 一般用 `^`，不遵守语义化版本的精确锁定；发布满 3 天才能安装；大版本一次升一个 | 0005 | [package-json](../config/package-json.md)、[pnpm-workspace](../config/pnpm-workspace.md) |
| CI 与冒烟 | GitHub Actions 全量跑，push 到 main 触发；生产构建上用本地固定接口做冒烟 | 0005、0040、0065 | [ci-workflow](../config/ci-workflow.md) |
| 本地验证 | 按影响范围和风险分四级，只跑相关测试；改坏验证只用于修 bug 和关键逻辑 | 0139 | `AGENTS.md`"验证分级" |
| 测试 | Vitest + jsdom，依赖真实引擎或布局的用浏览器模式；接口用 MSW | 0010、0011、0040 | [vite-config](../config/vite-config.md) |
| 公网与内网 | 两套构建模式，差异只写在 `.env.intranet`，代码只读 `appConfig` | 0032 | [env](../config/env.md) |
| 未入库的文件 | 集中到仓库根目录的 `local/`，worktree 用 `YZT_LOCAL_DIR` 指回主目录 | 0141 | [local-files](../config/local-files.md) |
| 文档 | 规则分 `AGENTS.md` 和 `.claude/rules/`；过程记录归档；待办只有一份；难回退、跨模块的决定才写 ADR | 0142 | [docs/README](../README.md) |

## 应用基础

| 主题 | 现在的结论 | ADR | 文档 |
|---|---|---|---|
| 路由 | Vue Router 5，手写路由表，history 模式 | 0007 | [layout](../modules/layout.md) |
| 导航失败 | 由 app 根部统一提示，用户主动重试或刷新；调用方不重复提示 | 0064 | [layout](../modules/layout.md) |
| 接口请求 | 同源 `/backend` 代理；axios + zod，每个请求传 schema；失败抛 `ApiError`；成功时没有信封的传 `envelope: false` | 0008、0011、0047 | [http](../modules/http.md) |
| 接口数据 | TanStack Vue Query 管理，全局关闭失败重试和切回窗口时的刷新；不放进 Pinia | 0017 | [http](../modules/http.md)、[table](../modules/table.md) |
| 登录与会话 | 会话存 localStorage，SM2 用 sm-crypto-v2，权限声明在路由 meta 上；结束会话统一走 `endSession()` | 0015 | [auth](../modules/auth.md) |
| 异步 | 能收敛的不写成操作；可替换操作用 `LatestController`；服务端写操作不适用；revision、operation、version 的命名 | 0039 | [utils](../modules/utils.md) |
| 偏好 | IndexedDB + idb-keyval，经 `shared/storage`；一个总开关加每项一个分项开关 | 0042、0140 | [storage](../modules/storage.md) |
| 页面缓存 | 路由 meta 加布局里常驻的 `KeepAlive`；`VITE_PAGE_STATE_RESET=true` 时不缓存，`.env` 提交的是 true | 0063、0114、0138 | [layout](../modules/layout.md)、[composables](../modules/composables.md) |
| 加载策略 | 登录页空闲时预加载地图页并预热 Worker 池；字体不推迟 | 0061、0062 | [perf](../modules/perf.md)、[fonts](../design/fonts.md) |

## 界面

| 主题 | 现在的结论 | ADR | 文档 |
|---|---|---|---|
| 字体与系统名称 | 普惠体 3.0 自托管、不入库，只放 `public/fonts/`；系统名称用 SVG 轮廓 | 0012、0013、0062 | [fonts](../design/fonts.md)、[system-title](../modules/system-title.md) |
| 布局组件 | `libs/ui` 的 `Mx*`；浅灰底标题栏复用 `MxPanel headerTone="muted"`；分栏布局可以宽屏收起，把手由页面给出 | 0016、0076、0100、0101 | [ui](../modules/ui.md)、[page-layout](../design/page-layout.md) |
| 拖动排序 | `useSortableList` 包 SortableJS，顺序交给拥有者，只能按住手柄拖 | 0054 | [composables](../modules/composables.md) |
| 文件传输 | `shared/file-transfer` 负责上传进度、二进制下载、文件名和取消；预览按格式加载 | 0075 | [file-transfer](../modules/file-transfer.md)、[file-management](../modules/file-management.md) |
| 对话头像 | `shared/chat-avatar` 的 `ChatAvatar`，AI 对话和指标 AI 计算共用 | 0109 | [chat-avatar](../modules/chat-avatar.md) |

## 业务页面

| 主题 | 现在的结论 | ADR | 文档 |
|---|---|---|---|
| 资源管理"自助取数" | ECharts graph + d3-force；名称写在节点里、字号自适应，水资源图回到放射布局（0115 的泳道已退役） | 0089、0126 | [resource-management](../modules/resource-management.md) |
| 系统管理 | 页面内菜单 `SideNav`、两个路由、打开的申请是查询参数；统计任务按审核通过显示并标"统计任务" | 0092、0113 | [system-management](../modules/system-management.md) |
| 消息 | 顶栏按钮下方的弹框，页面可见时每 60 秒刷新未读数；普通用户的业务按钮按 0127 | 0093、0127 | [system-management](../modules/system-management.md) |
| 数据下载 | 普通用户的申请列表与统计报表，和系统管理共用 feature | 0127 | [system-management](../modules/system-management.md) |
| 监测指标 | 条件、指标树、计算、成果四类拥有者；计算的轮询；边界入口在控制栏 | 0098、0128 | [monitoring-indicators](../modules/monitoring-indicators.md) |
| 基本统计 | 报表、总览、计算三个拥有者；轮询用查询库的 `refetchInterval`；开放六种报表，变化类按本底年份查看 | 0100、0117 | [monitoring-statistics](../modules/monitoring-statistics.md) |
| 数据查询 | 四个页面一个组件；高级查询暂时隐藏；地图控制和底图卡在右上角，结果横跨整页；通用绘制工具在 `shared/map/draw` | 0104、0112、0119 | [data-query](../modules/data-query.md) |
| 指标 AI 计算 | 确定性数据、规则解析不接大模型；流程图为核心、结果并入同一布局；按计算规则的参数，没有目标值；自定义范围与先对话后补充；步行时长可调 | 0105～0109、0120、0121、0125、0129、0131 | [indicator-simulation](../modules/indicator-simulation.md) |
| 城市指标 | 32 项来自 2026 年监测成果简报，其余模拟；统一从 `indicatorValue` 取 | 0130 | [city-indicators](../modules/city-indicators.md) |
| 驾驶舱 | 独立路由、自身的 Three.js 渲染；"查询统计 → 专项统计"进入，新标签页打开 | 0077、0110 | [city-dashboard](../modules/city-dashboard.md) |

## 维护

新写一份 ADR，或者一份 ADR 修正了另一份时，同步这里或地图总览对应的一行。
