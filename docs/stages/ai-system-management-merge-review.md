# 系统管理、消息中心、数据查询合入前的整理与整改

- 日期：2026-10-27
- 范围：`origin/codex/migrate-ai-system-management` 的 3 个提交（系统管理与 AI 对话预览、顶栏消息中心、数据查询），分支起点 `5b4feaf`，落后 main 十几个提交
- 基准：[阶段五之后的代码审查与整改](post-5e-code-review.md)、[main 分支的第二次全面审查与整改](main-full-review.md) 的整改标准和 AGENTS.md
- 结论：**分层、依赖方向和异步语义基本符合要求，差距在写法和几处过度防御**。发现 1 个会让内网用户无法查询的问题、1 个同一账号重新登录后清空查询页的问题，写法问题集中在数据查询和消息中心；已全部修复并补测试。生产冒烟里新增的两份业务用例、两个开发原型页和消息中心的会话处理留给你决定（第四部分）

## 一、整合方式

从当时最新的 main（`6325980`，导航网格）新建 `claude/migrate-ai-system-management`，把三个提交按顺序 cherry-pick 过来，每个提交单独解决冲突并通过类型检查，再单独提交整改。合入前 main 又提交了第一人称步行（`58bb550`），整个分支再 rebase 一次，只有 ADR 索引表冲突（两边各加一行，都保留）；下面的提交号是 rebase 之后的。没有选 merge：会多出合并提交，分支不能快进；也没有压成一个提交，三个模块的边界要留在历史里。

| 原提交 | 新提交 | 内容 |
|---|---|---|
| `067fcb5` | `4a1b58e` | 系统管理、`/dev/ai-chat` 交互预览、下载任务与进度区上移到 `shared/file-transfer` |
| `6f220d1` | `b40dbcc` | 顶栏消息中心 |
| `7ecfa19` | `03715ce` | 数据查询四个入口、`PolygonDrawTool`、几何读取移到 `shared/map` |

作者保留为原提交的作者，提交说明改成仓库的写法（`feat(<域>): 中文`），正文注明原提交号。

### 冲突

| 文件 | 处理 |
|---|---|
| `AGENTS.md` | 两边的迁移规则都保留；驾驶舱一条用 main 的写法（"三维阶段（ADR 0078）"）。分支加的三条后来在整改里压成规则（第三部分第 10 条） |
| `shared/file-transfer/DownloadPanel.tsx` | 分支把 `FileDownloadPanel` 挪到了这里，main 的第二次整改改的是旧位置。保留新位置，把 main 的 `statusClass` 写法搬过来 |
| `useFileTransfers.test.tsx` | 用 main 整改后的 `mount(defineComponent(() => ...))` 写法，组件换成 `DownloadPanel` |
| `shared/router/route-names.ts`、`libs/map-core/index.ts` | 两边都保留；`PolygonDrawTool` 的导出放在 `tool-model` 前面，按路径排序 |
| `docs/adr/README.md` | 两边都保留，分支的两份 ADR 改号（下一节） |

试合并时 git 自动合并、没有报冲突的文件也逐个核对过：`useFileDownloads` 的逻辑上移到 `useDownloads` 后，main 在旧位置没有改动；`fetchFile` 同时有 main 的 `baseMimeType` 和分支的 POST 支持。

### ADR 改号

分支的 0078（消息中心）、0079（数据查询）和 main 三维阶段的 0078、0079 撞号。当时 main 用到 0085（导航网格），`claude/migrate-resource-capabilities` 的自助取数也写成了 0085，按你的选择给它留 0086，本分支改为 **0087（消息中心）、0088（数据查询）**。之后 0086 被第一人称步行用掉，自助取数要改成 0089。

改号放在引入它们的那个提交里做，不另补一个改号提交：否则中间的提交里会同时有两份 0078，README 的表格也是错的。消息中心的提交顺带把 0087 加进 README 的表格（原来两行都在数据查询的提交里才加）。引用处一并修改：AGENTS.md、`page-layout.md`、`layout.md`、`map-core.md`、`shared-map.md`、`roadmap.md` 和两篇迁移记录；main 里引用三维 ADR 0078、0079 的地方不动。

## 二、写法指标

统计分支新增的代码行（`git diff main`），按 [main 第二次审查](main-full-review.md) 的写法分类，"冒烟"指 `tools/smoke`，"开发页"指 `pages/dev`。

| 写法 | 整改前 | 整改后 |
|---|---|---|
| 非空断言（生产代码 / 测试 / 开发页 / 冒烟） | 15 / 4 / 8 / 6 | 0 / 0 / 0 / 6 |
| `watch(() => x, value => {` 两个参数挤在一行，或 `}, { flush })` 跟在回调后 | 11 / 0 / 1 / 0 | 0 / 0 / 1 / 0 |
| 多层三元 | 5 / 0 / 1 / 0 | 0 / 0 / 1 / 0 |
| 多行列表里几项挤在一行（对象、数组、返回值、导入） | 33 / 5 / 16 / 4 | 0 / 0 / 12 / 4 |
| 超过 120 列 | 4 / 1 / 1 / 1 | 0 / 0 / 0 / 1 |
| 地图样式里散落的颜色字面量 | 7 处，同一个色值写三遍 | 4 个命名常量 |

- 剩下的开发页写法都在 `/dev/data-query` 和 `/dev/system-management` 的设计稿部分，冒烟的都在两份新用例里，分别是第四部分第 2、1 条
- 多行开始标签的 `>` 贴着文字（`>查询</ElButton>`）生产代码 7 处、三个以上属性的按钮把文字写在同一行约 10 处，也都展开了；开发原型里同类写法 3 处留着
- 导入顺序 14 个文件（`@vueuse` 排在 `@yzt` 后面、`DownloadPanel` 插在 features 中间等），按 main 的顺序重排：外部包、`@/`、相对路径，路径按字母序、忽略连字符；样式文件放最后

## 三、发现的问题与处理

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | 中 | 普通 HTTP 的内网上数据查询提交不了 | 快照身份改为递增序号，补测试 |
| 2 | 低 | 同一账号在其他标签页重新登录，查询页的条件和结果被清空 | 去掉换 token 时重置的侦听，补测试 |
| 3 | 一致性 | 数据查询的读取额外核对会话，和其他读取写法不同 | 按 main 的读取写法，ADR 0088 第 3 条同步 |
| 4 | 一致性 | 审核的 mutation 返回"会话是否还在"，组合式函数又核对一次 | 和文件管理一样在 `onSuccess` 核对 |
| 5 | 规范 | 非空断言 | 显式判断或 `required` |
| 6 | 规范 | 申请详情、准备状态的空值显示"—"，和表格全局的"-"不一致 | 统一为"-"，补测试 |
| 7 | 规范 | 地图配色散落、导出格式用 `string[]` 加运行时过滤 | 命名常量；`ExportFormat` 类型 |
| 8 | 规范 | 第二部分的写法 | 全部展开 |
| 9 | 小 | 消息类型下拉的 `ElOption` 缺 `key` | 补上 |
| 10 | 文档 | AGENTS.md 三条迁移规则写的是进度，带分支名和日期；`menu-panel` 变体没进主题文档 | 压成规则；补文档 |

### 1. 内网上数据查询提交不了（中，已复现）

- **位置**：`features/data-query/composables/useDataQuery.ts` 的 `search()`
- **原因**：快照身份用 `crypto.randomUUID()` 生成。它只在安全上下文（HTTPS 或 localhost）里有，内网部署是普通 HTTP，调用时抛 `TypeError`；`search()` 把异常当成条件错误，界面显示"crypto.randomUUID is not a function"，所有查询方式都提交不了。main 的文件管理踩过同一个坑（[file-management.md](../modules/file-management.md)），生产冒烟跑在 localhost 上，所以没发现
- **修法**：快照身份只用作查询缓存的 key，不比较先后，改为模块内递增的序号。放在模块里而不是组合式函数里，几个查询页同时存在时 key 也不会撞
- **测试**：`vi.stubGlobal('crypto', { getRandomValues })` 模拟非安全上下文，提交后能拿到结果。改坏验证：改回 `randomUUID` 后断言失败（`search()` 返回 false）

### 2、3. 换 token 时清空查询页；读取上的会话核对（低 / 一致性）

数据查询在三个地方处理会话：组合式函数侦听 token，一变就 `reset()`；两个读取的 `enabled` 判断有没有 token；`queryFn` 发请求前、响应后各 `assertCurrent` 一次，query key 里还带着账号。

- 会话结束（退出、过期、其他标签页退出）时 `endSession()` 清空查询缓存，进行中的读取随之取消，页面也跟着回到登录页卸载；换成另一个账号时整页重新加载（`app/session-sync.ts`）。所以这几层判断都碰不到真正"换账号"的情况
- 唯一会触发它们的是**同一账号在其他标签页重新登录**：只换了 token，身份不变。这时侦听把用户填好的条件和结果清空；如果正好有读取在进行，响应后 `assertCurrent` 失败，结果区显示"查询失败"
- 改为和 main 其他读取（文件、资源图层、要素详情）一样：查询的选项不依赖会话，没有快照时用 `skipToken`（顺带消掉 `request!` 这类非空断言），key 由 `dataQueryKeys` 统一拼。几何详情 `useQueryDetail` 同样处理
- 测试："同一账号重新登录只换 token，条件和结果保留"（整改前断言失败）。原来的"请求中换会话会取消读取"改为按 `endSession` 的顺序先清缓存再清会话；三种取消都改成直接检查交给接口函数的 `AbortSignal`：`client.clear()` 是静默取消，被移除的查询状态停在 `fetching`，原来看 `fetchStatus` 的写法在这里不成立。改坏验证：读取不传 `signal` 后三个用例都断言失败
- ADR 0088 第 3 条原来写"响应后核对会话"，改为"和其他读取一样不另外核对会话"，头部注明改动。这份 ADR 还没进过 main，所以直接修改；如果你希望严格按"已接受的 ADR 不修改"，可以改成另写一份（第四部分第 4 条）

系统管理的审核弹窗、消息中心也侦听 token，但只清理进行中的操作状态，和 main 的 `useResourceStatus` 一样，保留。

### 4. 审核的会话核对写了两遍（一致性）

`useAuditMutation` 的 `mutationFn` 返回 `guard.isCurrent(token)`，`onSuccess` 按这个返回值决定刷不刷缓存，组合式函数拿到返回值后又判断一次 `isCurrent`。改为和文件管理的删除、上传一样：`mutationFn` 只在发请求前 `assertCurrent`，`onSuccess` 自己核对；组合式函数核对一次，决定要不要报告成功。参数类型抽成 `AuditSubmission`。

### 5. 非空断言

- 生产代码：`queries.ts`、`useQueryDetail.ts` 改用 `skipToken`；`conditions.ts` 先取出 `options`；`QueryConditions.tsx` 的渲染函数改为接收图层参数，调用处判断有没有图层，条件找不到字段时不渲染；`useMessageCenter.ts` 在没有登录用户时直接返回
- 测试：`required`（`shared/testing/required`）
- 开发页：`/dev/data-query` 的 8 处改为显式判断或 `?.`

### 6. 空值显示

AGENTS.md 规定表格的空值由全局样式显示"-"。系统管理的"数据准备状态"列由 `taskLabel` 在没有状态时返回"—"（另一个字符），申请详情的各字段也写"—"。改为 `taskLabel` 返回空字符串，表格交给全局样式；详情用 `EMPTY_VALUE = '-'`，和资源管理的详情一致。数据查询的结果详情原来空值是空白，同样改为"-"。新增 `presentation.test.ts`，改坏验证：改回"—"后断言失败。

### 7. 地图配色与导出格式

- 查询结果的蓝色 `#577CFF` 在 `map-style.ts`、`useQueryDrawing.ts`、`DataQueryPage.tsx` 各写一遍，选中的橙色写在页面里。MapLibre 的样式取不到 CSS 变量，按 `shared/map` 的做法在 `map-style.ts` 里命名（`RESULT_COLOR`、`SELECTION_COLOR` 等），另外两处引用
- 导出格式原来是 `string[]`，`exportResults` 再用白名单过滤一遍。改为 `ExportFormat` 联合类型和 `EXPORT_FORMATS` 常量，勾选框的值在组件里按常量收窄，组合式函数不再过滤；导出接口地址的两层三元改成按范围查表

### 10. 文档

- AGENTS.md 的三条迁移规则写的是进度（"在 `codex/migrate-ai-system-management` 推进（2026-10-23）""已接入""待联调"），合入后分支名就没有意义了。按第一次审查第 10 条，压成必须遵守的规则，进度和待联调项留在各自的迁移记录里
- 分支给 `ElMenu` 加了 `menu-panel` 变体，但 [theme.md](../design/theme.md) 的变体表没有它，[page-layout.md](../design/page-layout.md) 还写着"实现方式在迁移系统管理时再定"。补进变体表，删掉"以后再定"里的这一项
- 三篇迁移记录引用的是旧提交号，在开头注明新提交号，正文保留当时的记录

## 四、需要你决定的事项

1. **生产冒烟里的两份新业务用例**：`data-query.spec.ts`（138 行）、`message-center.spec.ts`（175 行）。和两次审查第四部分第 1 条是同一个问题——ADR 0065 只让 `tools/smoke` 做最小流程，业务用例要不要放在这里还没决定。按之前的约定，决定前不整理写法，这两份里还有 6 处非空断言、1 行超长
2. **两个开发原型页**：`/dev/data-query`（约 1100 行，AGENTS.md 原来写"保留为历史原型"）和 `/dev/system-management` 的设计稿部分（`DevSystemManagementPage.tsx` 370 行）是手写的第二份界面，和正式组件重复。第一次审查第 6 条把 `/dev/file-management` 改成了驱动正式组件。可以删掉（交互已确认，正式页面就是参照），或者改成驱动正式组件；`/dev/system-management` 的"组件预览"和 `/dev/message-center` 已经是驱动正式组件的写法。这次只修了其中的非空断言
3. **消息中心的会话处理**：顶栏按 token 重建消息组件（`key={session.token}`）、组合式函数侦听 token 重置弹框、读取核对会话并给结果标上账号，三层做的是同一件事。这是 ADR 0087 第 6 条的设计，测试齐全，这次没动。可以简化成只保留重建（没有会话时不渲染）和写操作的核对
4. **ADR 0088 第 3 条**：直接修改了，还是另写一份新 ADR
5. **ADR 编号**：`claude/migrate-resource-capabilities` 的自助取数现在写成 0085，0085～0088 都已占用，合入前要改成 0089

以下保持不改：`menu-panel` 的图标 `font-size: 18px`（规范给的图标尺寸，不是文字字号）；`useDownloads` 侦听 token 中止下载（从 main 的 `useFileDownloads` 原样上移）。

## 五、验证

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过；rebase 到 `58bb550` 后用 `git rebase --exec` 对 8 个提交逐个检查，都是 0 个错误 |
| `pnpm lint` | 除依赖方向外通过。本机缺 Visual C++ 运行库，`eslint-plugin-boundaries` 报 `Cannot find native binding`（[main 第二次审查](main-full-review.md)第 13 条）；临时去掉这个插件跑其余规则，用一个故意写错的文件确认配置生效。依赖方向用脚本检查改动的 89 个文件、612 条导入：没有跨 feature、反向依赖、同单元用别名或引用 libs 内部文件 |
| `pnpm test` | 通过：rebase 后 Web 242 个文件、2189 个用例（含真实 Chromium 的浏览器测试和 main 新加的步行测试），图标包 35 个。rebase 前为 241 个文件、2147 个用例，整改前为 240 个文件、2143 个用例；整改新增 `presentation.test.ts` 和数据查询的两个用例 |
| `pnpm build`、`pnpm build:intranet` | rebase 前后都通过，产物检查通过；只有原有的 `crypto` 外置和大分块提示 |
| `pnpm --filter @yzt/web test:smoke` | rebase 前后都是 31 项通过，其中数据查询 2 项、消息中心 4 项 |
| 改坏验证 | 快照身份改回 `randomUUID`、读取不传 `signal`、准备状态改回"—"：新用例都是断言失败，恢复后通过；"同一账号重新登录"的用例在整改前的代码上断言失败 |

几次运行中的偶发失败，都和这次改动无关：

- 完整测试有两轮各有 3～4 个用例失败（Cesium 渲染等待、图标检查、文件管理页、现状底图页），都是刚过 5 秒或渲染等待超时，耗时 295 秒（正常约 180 秒），当时机器上还有其他会话在跑测试。失败的文件单独重跑全部通过，机器空闲后完整跑一遍全部通过
- 生产冒烟第一次有 1 项失败：资源管理表格的行高 50.22，断言要求不超过 50。这个 worktree 没有 `public/fonts`（字体按授权不入库），退回系统字体后行高变了。从主工作区复制字体（同样不入库）重新做内网构建后，31 项全部通过

没有验证的：

- 界面只在生产冒烟的固定数据下检查过，没有逐像素对比。这次的界面变化只有空值字符（"—"、空白改为"-"），其余是写法调整，渲染结果不变
- 真实后端的读写仍按三篇迁移记录里的待联调项；内网 HTTP 下的查询修复只在测试里模拟了非安全上下文，没有在真实内网部署上试
