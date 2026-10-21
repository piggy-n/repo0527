# 项目文档

本目录存放决策记录、配置说明和学习资料，和代码一起纳入 git。必须遵守的规则同步写在根目录的 `AGENTS.md` 里。

## 目录

```
docs/
├─ README.md                  本文：索引与维护约定
├─ code-style.md              代码风格（格式、换行、注释）
├─ commands.md                常用命令：作用、时机、执行过程、注意事项
├─ deployment.md              部署要求（nginx 回退与接口转发）
├─ roadmap.md                 阶段路线图：内容、学习点、状态与后续事项
├─ migration.md               各模块的迁移基线与进度
├─ adr/                       架构决策记录
│  ├─ README.md               ADR 索引与模板
│  └─ NNNN-*.md
├─ config/                    重要配置文件的逐项说明
│  ├─ package-json.md         根目录与 apps/web 的 package.json
│  ├─ tsconfig.md             apps/web 的 tsconfig（app、libs、node）
│  ├─ oxlintrc.md             .oxlintrc.json（lint 规则与依赖方向）
│  ├─ pnpm-workspace.md       pnpm-workspace.yaml（workspace、冷却期、安装脚本）
│  ├─ ci-workflow.md          .github/workflows/ci.yml
│  ├─ vite-config.md          apps/web/vite.config.ts（插件、别名、代理）
│  ├─ internal-packages.md    packages/* 内部包的配置约定与新建清单
│  └─ env.md                  apps/web/.env（环境变量、类型与校验）
├─ modules/                   内部模块的用法与设计说明
│  ├─ http.md                 shared/http：HTTP 客户端、ApiError、回调注入
│  ├─ file-transfer.md        公共上传进度、二进制下载、文件名与取消语义
│  ├─ file-management.md      文件管理迁移边界、上传交互原型与验证记录
│  ├─ auth.md                 鉴权：会话、角色、页面权限、路由守卫、登录接口与表单
│  ├─ storage.md              shared/storage：偏好的持久化（键值存储、偏好的范围、恢复与写入）
│  ├─ composables.md          通用组合式函数：useDelayedFlag（延迟显示的加载状态）、usePageActive、useShownElementSize（页面缓存）
│  ├─ table.md                shared/table：列表的加载状态（骨架屏、遮罩、后台刷新）与 TableSkeleton
│  ├─ query-form.md           shared/query-form：列表页的查询表单（按是否换行切换标签宽度与按钮位置）
│  ├─ layout.md               布局：顶部导航、用户菜单、宽度适配
│  ├─ system-title.md         系统名称的 SVG 轮廓：用法、自动生成、常见问题
│  ├─ ui.md                   libs/ui：两个入口、窄屏断点、分栏布局、面板、区块、标题
│  ├─ map-overview.md         地图架构总览：分层、贯穿全局的原则、按主题的现行 ADR 与修正关系、阅读顺序
│  ├─ map-core.md             地图内核：用法、会话与 MapLibre 适配器的实现、实测行为、加载策略；附录为旧代码分析
│  ├─ map-vue.md              libs/map-vue：地图与 Vue 的衔接（provideMap、样式绑定、MapCanvas、useMap、相机操作、定位可视区域）
│  ├─ shared-map.md           shared/map：项目级的公共地图能力（底图、边界、默认视角、工具栏、测量、区划定位、坐标定位、状态提示）
│  ├─ perf.md                 shared/perf：加载耗时的标记（LoadTrace、登录到地图）与实测脚本
│  ├─ utils.md                libs/utils：Worker 通信层（协议、取消、故障、托管）、LatestController
│  └─ icons.md                图标：SvgIcon 用法、添加图标、规范化规则、自动化与检查
├─ design/                    设计规范与主题落地
│  ├─ color-and-typography.md 系统配色与字体规范（原文）
│  ├─ theme.md                设计令牌清单、Element Plus 映射与使用规则
│  ├─ page-layout.md          页面布局规范：分栏型与画布型、面板、标题、窄屏抽屉
│  ├─ ui-workflow.md          UI 工作流程：交互原型、真实页面检查、短时浏览器测试与验收
│  ├─ current-map-reference.md 现状底图交互样例：已验收组件、年份规则与复查路径
│  └─ fonts.md                字体：来源、授权要点、存放位置、字重与性能
└─ stages/                    各阶段的总结与学习笔记
   ├─ stage-1-engineering-foundation.md  阶段一：工程基础
   ├─ stage-2-app-skeleton-and-auth.md   阶段二：应用骨架、数据层与鉴权
   ├─ stage-3-layout-and-first-list.md   阶段三：页面布局与第一个列表页
   ├─ stage-4-map-core.md                阶段四：地图内核
   ├─ stage-5a-map-skeleton.md           阶段五 5A：地图骨架
   ├─ stage-5b-public-map-capabilities.md 阶段五 5B：公共地图能力
   ├─ stage-5c-current-map-business.md   阶段五 5C：现状底图业务
   ├─ stage-5d-map-ui.md                 阶段五 5D：地图页界面的专门设计
   ├─ stage-5e-wrap-up.md                阶段五 5E：收尾（加载策略与页面缓存），附阶段五回顾
   └─ stage-5-acceptance-review.md       阶段五验收报告：自动检查、发现的问题、可以优化的地方
```

## 建议的阅读顺序

第一次接触这个项目：

1. 根目录 `AGENTS.md`：项目目标、技术栈、目录结构、必须遵守的规则
2. [roadmap.md](roadmap.md)：整个重构分几个阶段、现在进行到哪里
3. [adr/README.md](adr/README.md)，然后按编号读 ADR：理解每个关键选择的理由
4. [stages/](stages/) 下的阶段总结，按顺序读：每个阶段做了什么、学到什么
   - [阶段一：工程基础](stages/stage-1-engineering-foundation.md)
   - [阶段二：应用骨架、数据层与鉴权](stages/stage-2-app-skeleton-and-auth.md)
   - [阶段三：页面布局与第一个列表页](stages/stage-3-layout-and-first-list.md)
   - [阶段四：地图内核](stages/stage-4-map-core.md)
   - [阶段五 5A：地图骨架](stages/stage-5a-map-skeleton.md)
   - [阶段五 5B：公共地图能力](stages/stage-5b-public-map-capabilities.md)
   - [阶段五 5C：现状底图业务](stages/stage-5c-current-map-business.md)
   - [阶段五 5D：地图页界面的专门设计](stages/stage-5d-map-ui.md)
   - [阶段五 5E：加载策略、页面缓存与阶段五回顾](stages/stage-5e-wrap-up.md)
   - [阶段五验收与后续修复](stages/stage-5-acceptance-review.md)
5. [commands.md](commands.md)：日常要用的命令

地图部分先读 [modules/map-overview.md](modules/map-overview.md)，再按主题去读 ADR。想弄清某个配置项时，直接查 [config/](config/) 下对应的文档。做界面之前，先读 [design/](design/) 下的规范和主题说明，并按 [UI 工作流程](design/ui-workflow.md) 完成交互原型和实际页面验证。

## 各类文档的分工

| 文档 | 回答的问题 | 什么时候写 |
|---|---|---|
| `AGENTS.md` | 必须遵守什么 | 规则产生或变化时 |
| `adr/` | 为什么这样决定 | 做出重要决策时；接受后不再修改 |
| `config/` | 这个配置项是什么意思、改它要注意什么 | 配置文件新增或修改时 |
| `design/` | 界面应该长什么样、页面怎么排布、令牌怎么对应到 Element | 规范、令牌、布局规则或 Element 映射变化时 |
| `modules/` | 这个模块怎么用、为什么这样设计 | 新增或修改 shared、libs 中的模块时 |
| `commands.md` | 这条命令做什么、什么时候用 | 新增或修改脚本时 |
| `stages/` | 这个阶段做了什么、能学到什么 | 每个阶段结束时 |
| `code-style.md` | 代码写成什么样 | 风格规则变化时 |

## 维护约定

- JSON 配置文件不写注释（包括 `.oxlintrc.json` 这类允许 JSONC 的文件），解释写在 `config/` 下对应的文档里。YAML 文件可以保留简短注释，完整说明同样放在 `config/`
- 修改配置文件时，同步更新 `config/` 下的说明，尤其是每篇末尾的"修改时的检查清单"
- 新增或修改 `package.json` 里的脚本时，同步更新 `commands.md`
- 每个阶段结束时，在 `stages/` 下新增一篇总结，格式参考阶段一：第一部分记录做了什么和目的，第二部分整理知识点、设计理由和替代方案；阶段五拆成 5A～5E，每个子阶段各写一篇
- 文档里写的行为尽量先实测再写，并注明"已验证"；没有验证的内容要明确说明
- 决策发生变化时写新的 ADR，而不是修改已接受的 ADR；`config/` 和 `stages/` 中引用旧决策的地方同步更新
