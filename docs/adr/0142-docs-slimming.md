# 0142. 文档分层：规则按目录加载，过程记录归档

- 状态：已接受
- 日期：2026-11-04
- 修改：`docs/README.md` 的维护约定；"ADR 接受后正文不再修改"加一个例外：文件移动时只改路径

## 背景

迁移基本完成，后面以迭代开发为主。文档还是迁移期的写法（用户 2026-11-04 确定精简）：

- `AGENTS.md` 33,298 字、349 行，每次对话全量加载，其中地图一节约占 30%；官方建议单个文件 200 行以内
- `docs/` 有 213 个文件，`roadmap.md`、`migration.md` 各约 1000 行，大多是过程记录，还有效的待办散在几十处
- 最近 100 次提交里有 62 次改了文档，很多是"阶段结束写总结""把结果写进 roadmap"这类同步要求
- ADR 有 141 份，代码里约 1100 处按编号引用，不能合并或重新编号

实测 Claude Code 的加载行为（2026-11-04，桌面应用的一个 worktree 会话，临时文件测完删除）：

| 操作 | 结果 |
|---|---|
| Read 匹配 `paths` 的文件（规则是会话中途新建的） | 加载，来自 worktree 自己的 `.claude/rules/` |
| Write 新文件，之前没有 Read 过 | 加载 |
| Bash `head` 读匹配的文件 | 加载 |
| Grep 搜匹配的文件 | 不加载 |
| Read 不匹配的文件 | 不加载 |
| 规则文件是 CRLF 换行（这台机器上 git 检出的样子） | 加载 |
| `paths` 里的花括号（`*.{ts,tsx}`、`{a,b}/**`）、点开头的文件（`.env*`） | 能匹配 |
| 子目录 `CLAUDE.md`，Read 这个目录下的文件 | 加载 |
| 子目录 `AGENTS.md`，Read 这个目录下的文件 | 不加载（官方文档说会） |

只看了官方文档、没有实测：`/compact` 之后规则不重新注入，下次读到匹配的文件时再加载；`.claude/worktrees/` 里的子 agent 不读这个 worktree 的根 `CLAUDE.md` 和 `.claude/rules/`；Explore、Plan 子 agent 不读 `CLAUDE.md`。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 怎么按目录拆规则 | 子目录 `CLAUDE.md`；子目录 `AGENTS.md`；`.claude/rules/*.md` 的 `paths` | `paths`：地图规则涉及七个以上目录，测试和接口规则按文件名匹配，子目录文件做不到；子目录 `AGENTS.md` 实测不加载 |
| 其他工具怎么办 | 规则放在 `docs/`，由规则文件导入；规则文件加索引表 | 索引表：多一层导入没有实际收益，规则文件本身就是普通的 Markdown；`AGENTS.md` 的表写明改哪里读哪个 |
| 根目录的 `CLAUDE.md` | 删掉，用原生读取 `AGENTS.md`；保留 `@AGENTS.md` | 保留：原生读取依赖版本，一行导入已经够用 |
| ADR 怎么精简 | 合并、重新编号；冻结加总览 | 冻结加总览：约 1100 处引用按编号，改号的代价远大于收益 |
| `roadmap`、`migration` | 原地裁剪；整篇归档，另写待办；接口实测拆成一份继续维护的文档 | 整篇归档：原文不动最安全，代码注释改路径就够了；拆接口实测要动近 1000 行，新的实测写进模块文档 |
| 模块文档里的待办 | 全搬进 backlog；留在原处，backlog 一行链接过去 | 留在原处：搬走后模块文档缺上下文；backlog 只是入口 |
| 归档后 ADR 里的链接 | 不动，链接失效；只改路径 | 只改路径：35 个文件涉及 roadmap、migration、stages，其中 21 个有路径要改；已用脚本核对去掉路径前缀后内容不变 |

## 决定

1. `AGENTS.md` 只放每个任务都要遵守、lint 又管不到的规则。只和部分代码有关的规则放进 `.claude/rules/*.md`，用 `paths` 按需加载，`AGENTS.md` 有一张索引表。`CLAUDE.md` 仍是一行 `@AGENTS.md`
2. lint 已经检查的规则不再写进 `AGENTS.md`，说明在 `docs/config/oxlintrc.md`
3. 旧 ADR 不合并、不重新编号。查决策从 [ADR 总览](overview.md) 和[地图架构总览](../modules/map-overview.md)开始，只列现行结论
4. 提高新 ADR 的门槛：只记难回退、跨模块的决定。取值调整写进配置说明，界面细节写进设计文档
5. `roadmap.md`、`migration.md`、`stages/` 移到 `docs/archive/`，只查不改。还有效的待办、未联调事项和已知问题提取到 [`docs/backlog.md`](../backlog.md)，它是唯一的待办入口
6. 去掉迭代期不再需要的要求：阶段结束写总结、阶段结束更新 roadmap、开始迁移时记基线。`docs/modules/` 从"修改就同步"放宽为"用法或设计变化时更新"。配置说明和 `commands.md` 的同步要求保留，因为 JSON 不能写注释
7. 迁移规则里仍然有效的两条（先读懂再重写、不照搬旧代码的兜底判断）留在 `AGENTS.md` 的"写法的来源"

## 旧章节的去向

| 旧 `AGENTS.md` 的章节 | 新位置 |
|---|---|
| 协作方式 | `AGENTS.md`；UI 的五条到 `ui.md` |
| 技术栈 | `AGENTS.md` 留清单；各库的细节到 `pages.md`、`state.md`、`testing.md`、`http.md`、`map.md`、`map-3d.md`、`deps-config.md` |
| 目录结构 | `AGENTS.md`；开发页命名到 `pages.md`，内部包到 `libs.md`，字体目录到 `ui.md` |
| 依赖方向 | `AGENTS.md` 留三行；libs 内部的方向到 `libs.md`，由 lint 检查 |
| libs 的拆包规则 | `libs.md` |
| 格式、注释、依赖、语法 | `AGENTS.md`；`const` / `===` 由 lint 检查 |
| lint | `AGENTS.md`；私有成员的下划线由 lint 检查（`no-underscore-dangle`） |
| TypeScript 与 Vue | 通用的留 `AGENTS.md`；路由、权限、缓存、会话到 `pages.md`，偏好到 `state.md`，TSX、Element、列表到 `ui.md`，加载耗时到 `pages.md` |
| 测试 | `testing.md`；`AGENTS.md` 留一段 |
| 验证分级 | `AGENTS.md`，原样 |
| Pinia | `state.md` |
| 配置与环境变量 | `deps-config.md`；`AGENTS.md` 留一条；接口地址到 `http.md`，天地图到 `map.md` |
| 接口请求 | `http.md` |
| 地图 | `map.md`；三维到 `map-3d.md`；年份、分类、最小显示级别、已确认的界面到 `resource-map.md`；等待点的再确认到 `AGENTS.md` |
| 样式与设计规范 | `ui.md` |
| 迁移规则 | 驾驶舱到 `city-dashboard.md`，指标计算到 `indicator-simulation.md`，不迁移的范围到 `backlog.md`，写法两条留 `AGENTS.md`，记基线一条取消 |
| 依赖维护 | `deps-config.md` |
| 文档 | `AGENTS.md`，改写 |
| 常用命令 | `AGENTS.md` 留最常用的；实测、探查、依赖更新在 `commands.md`；CI 的步骤在 `deps-config.md` 和 `ci-workflow.md` |

规则文件都在 `.claude/rules/`。移动时规则原文不改写：旧文件除去空行和标题还有 269 行，其中 230 行原样出现在新位置，其余 39 行是有意改写或取消，改写的已用脚本核对里面的标识符和 ADR 编号都能在新位置找到。

## 后果

- 每次对话一定加载的规则从 33,298 字降到约 9,300 字；改列表页约 17,400 字（加 `ui.md`、`http.md`、`pages.md`），改资源图层的 feature 约 24,100 字（加 `ui.md`、`http.md`、`map.md`、`resource-map.md`），连现状底图页一起改约 28,800 字（再加 `pages.md`、`map-3d.md`），只改文档约 9,300 字
- Grep 不触发加载：只搜索不读文件时看不到规则，但 Edit 前必须 Read，改已有文件时规则一定已经加载
- `/compact` 之后到下次读文件之前，以及 worktree 里的子 agent，看不到 `paths` 规则；把改代码的任务交给子 agent 时，要在说明里写明规则文件
- 其他工具不会自动加载规则文件，只能靠 `AGENTS.md` 的索引表
- `paths` 写的是路径，目录改名时不会报错、规则会悄悄不再加载。拆包时要一起改，改完确认每个 `paths` 仍然匹配到文件
- 代码注释里的"实测"多指向 `docs/archive/migration.md`：归档后这份文档不再更新，新的实测写进模块文档
- 没有"阶段总结"之后，知识点和设计理由只留在 ADR 和模块文档里
