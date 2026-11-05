# 项目文档

本目录存放决策记录、配置说明和学习资料，和代码一起纳入 git。必须遵守的规则在根目录的 `AGENTS.md` 和 `.claude/rules/` 里。

## 目录

```
docs/
├─ README.md                  本文：索引与维护约定
├─ backlog.md                 唯一的待办清单：待联调、后端问题、上线前、待用户决定
├─ code-style.md              代码风格（格式、换行、注释）
├─ commands.md                常用命令：作用、时机、执行过程、注意事项
├─ deployment.md              部署要求（nginx 回退与接口转发）
├─ adr/                       架构决策记录
│  ├─ overview.md             按主题列现行结论，查决策从这里开始
│  ├─ README.md               ADR 索引、门槛与模板
│  └─ NNNN-*.md
├─ config/                    重要配置文件的逐项说明
│  ├─ package-json.md         根目录与 apps/web 的 package.json
│  ├─ tsconfig.md             应用和包的 tsconfig（app、worker、node，包的 lib、test）
│  ├─ oxlintrc.md             .oxlintrc.json（lint 规则与依赖方向）
│  ├─ pnpm-workspace.md       pnpm-workspace.yaml（workspace、catalog、冷却期、安装脚本）
│  ├─ ci-workflow.md          .github/workflows/ci.yml
│  ├─ vite-config.md          apps/web/vite.config.ts（插件、别名、代理）
│  ├─ local-files.md          未入库的本地文件（local/）：目录划分、YZT_LOCAL_DIR、开发服务器的映射
│  ├─ internal-packages.md    packages/* 内部包的配置、依赖声明、测试与新建清单
│  └─ env.md                  apps/web/.env（环境变量、类型与校验）
├─ modules/                   内部模块的用法与设计说明
│  ├─ http.md                 shared/http：HTTP 客户端、ApiError、回调注入
│  ├─ auth.md                 鉴权：会话、角色、页面权限、路由守卫、登录接口与表单
│  ├─ storage.md              shared/storage：偏好的持久化（键值存储、偏好的范围、恢复与写入）
│  ├─ composables.md          通用组合式函数：useDelayedFlag、usePageActive、useShownElementSize
│  ├─ table.md                shared/table：列表的加载状态（骨架屏、遮罩、后台刷新）与 TableSkeleton
│  ├─ query-form.md           shared/query-form：列表页的查询表单
│  ├─ file-transfer.md        公共上传进度、二进制下载、文件名与取消语义
│  ├─ layout.md               布局：顶部导航、用户菜单、宽度适配、页面缓存
│  ├─ system-title.md         系统名称的 SVG 轮廓：用法、自动生成、常见问题
│  ├─ chat-avatar.md          shared/chat-avatar：对话的头像，AI 对话与指标AI计算共用
│  ├─ city-indicators.md      shared/city-indicators：城市指标的目录与取值
│  ├─ ui.md                   packages/ui：两个入口、窄屏断点、分栏布局、面板、区块、标题
│  ├─ perf.md                 shared/perf：加载耗时的标记与实测脚本
│  ├─ utils.md                packages/utils：Worker 通信层、LatestController
│  ├─ icons.md                图标：SvgIcon 用法、添加图标、规范化规则
│  ├─ map-overview.md         地图架构总览：分层、原则、按主题的现行 ADR、阅读顺序
│  ├─ map-core.md             地图内核：会话与 MapLibre 适配器、实测行为、加载策略；附录为旧代码分析
│  ├─ map-vue.md              packages/map-vue：provideMap、样式绑定、MapCanvas、相机操作、定位可视区域、二三维切换
│  ├─ map-cesium.md           packages/map-cesium：CesiumView、相机换算、样式镜像的支持清单、拾取与投影
│  ├─ shared-map.md           shared/map：底图、边界、默认视角、工具栏、测量、区划定位、坐标定位、状态提示
│  ├─ file-management.md      文件管理：迁移边界、上传交互与验证
│  ├─ resource-management.md  资源管理：目录、详情、Excel、自助取数、下载申请
│  ├─ system-management.md    系统管理、数据下载与消息：分层、申请与消息的数据层、待联调
│  ├─ data-query.md           数据查询：四个页面共用的组件、四个页签的拥有者与规则
│  ├─ monitoring-indicators.md 城市国土空间监测指标
│  ├─ monitoring-statistics.md 城市国土空间监测基本统计
│  ├─ indicator-simulation.md 城市国土空间监测指标AI计算
│  ├─ city-dashboard.md       城市体检驾驶舱：范围、依赖评估、分步实施、性能基线
│  └─ ai-chat.md              AI 对话：最小迁移的范围、接口与待办
├─ design/                    设计规范与主题落地
│  ├─ color-and-typography.md 系统配色与字体规范（原文）
│  ├─ theme.md                设计令牌清单、Element Plus 映射与使用规则
│  ├─ page-layout.md          页面布局规范：分栏型与画布型、面板、标题、窄屏抽屉
│  ├─ ui-workflow.md          UI 工作流程：交互原型、真实页面检查、短时浏览器测试与验收
│  ├─ current-map-reference.md 现状底图交互样例：已验收组件、已确认的界面细节与复查路径
│  └─ fonts.md                字体：来源、授权要点、存放位置、字重与性能
└─ archive/                   迁移期的过程记录，只查不改，见 archive/README.md
   ├─ roadmap.md              阶段路线图
   ├─ migration.md            各模块的基线、接口实测、与旧页面的差异
   └─ stages/                 各阶段的总结、学习笔记和全面审查
```

## 从哪里开始

- 做新任务：根目录 `AGENTS.md`，看 [backlog.md](backlog.md) 有没有相关的待办
- 查决策：[adr/overview.md](adr/overview.md)；地图部分先读 [modules/map-overview.md](modules/map-overview.md)，再按主题去读 ADR
- 查配置项：[config/](config/) 下对应的文档；查命令：[commands.md](commands.md)
- 做界面：先读 [design/](design/) 下的规范和主题说明，并按 [UI 工作流程](design/ui-workflow.md) 完成交互原型和实际页面验证
- 联调接口：[archive/migration.md](archive/migration.md) 的接口实测和模块文档
- 想系统了解项目是怎么建起来的：[archive/README.md](archive/README.md) 的阅读顺序

## 各类文档的分工

| 文档 | 回答的问题 | 什么时候写 |
|---|---|---|
| `AGENTS.md` | 每个任务都要遵守什么 | 通用规则产生或变化时 |
| `.claude/rules/` | 改某类文件时要遵守什么 | 只和部分代码有关的规则产生或变化时 |
| `backlog.md` | 还有什么没做、在等什么 | 发现待办时加一行，解决时删一行 |
| `adr/` | 为什么这样决定 | 难回退、跨模块的决定；接受后不再修改 |
| `config/` | 这个配置项是什么意思、改它要注意什么 | 配置文件新增或修改时 |
| `design/` | 界面应该长什么样、页面怎么排布、令牌怎么对应到 Element | 规范、令牌、布局规则或 Element 映射变化时 |
| `modules/` | 这个模块怎么用、为什么这样设计 | 模块的用法或设计变化时 |
| `commands.md` | 这条命令做什么、什么时候用 | 新增或修改脚本时 |
| `code-style.md` | 代码写成什么样 | 风格规则变化时 |
| `archive/` | 当时做了什么、接口当时返回什么 | 不再写 |

## 维护约定

- 规则只写一处：每个任务都要遵守的写 `AGENTS.md`，只和部分代码有关的写 `.claude/rules/`；新增规则文件或改了 `paths` 时，同步 `AGENTS.md` 的索引表
- lint 能查的规则不写进 `AGENTS.md`，说明放在 `config/oxlintrc.md`
- JSON 配置文件不写注释（包括 `.oxlintrc.json` 这类允许 JSONC 的文件），解释写在 `config/` 下对应的文档里。YAML 文件可以保留简短注释，完整说明同样放在 `config/`
- 修改配置文件时，同步更新 `config/` 下的说明，尤其是每篇末尾的"修改时的检查清单"
- 新增或修改 `package.json` 里的脚本时，同步更新 `commands.md`
- 文档里写的行为尽量先实测再写，并注明"已验证"；没有验证的内容要明确说明
- 决策发生变化时写新的 ADR，而不是修改已接受的 ADR；`config/` 中引用旧决策的地方同步更新，[adr/overview.md](adr/overview.md) 或地图总览对应的一行也要改
- 过程不进文档：阶段总结、每一步的验证结果不再写，验证结果写在交付说明里；接口实测写进对应的模块文档
