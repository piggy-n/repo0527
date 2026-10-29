# AI 对话

对应代码：`features/ai-chat/`、`pages/ai-chat/AiChatPage.tsx`；路由 `/ai-chat`，全部登录角色
旧项目：`views/ai-chat/index.vue`、`components/AiChat/ChatPanel.vue`、`api/ai/ai-api.js`、`services/ai-map-service.js`、`components/CommonMap/managers/AiResultLayerManager.js`、`styles/ai-chat.css`（基线见 [migration.md](../migration.md)"AI 对话：最小迁移"）

## 范围（2026-10-28 用户确认）

这个模块以后要重构，AI 后端目前也不能联调，所以这次只做**最小必要迁移**：保留原有的核心功能和交互，按现有的设计风格适配，不做大的重构和功能扩展。用户在开始时定了两件事：

- 地图只做底图、省界和回答里的 GeoJSON（画出并定位），MVT 结果和点击弹窗记为待办
- 迁移登录接口和 token 的存放，但前端不写账号；账号来源等后端方案（路线图"AI 后端登录不再在前端写死账号密码"）

| 迁移了 | 说明 |
|---|---|
| 对话 | 流式回答（SSE）；流式请求没被接受时改用同步接口；查询步骤的时间线（失败的步骤附排查用的 JSON）；Markdown 正文；用量（耗时、token、tok/s）；"新对话"打断进行中的回答；回车发送、Shift + 回车换行、输入法选字不发送 |
| 快捷提问 | 旧项目的 20 条，首次随机 4 条，换一批随机 3～5 条；回答中隐藏 |
| 历史对话 | 打开历史时加载；按标题搜索；今天、昨天、更早分组；打开、删除一个、删除全部（确认框） |
| 查询结果 | 标题栏显示用量和分类、Excel 下载；有图表或表格时自动展开，可收起、最大化；图表（柱状、折线、饼图）和表格并排 |
| 地图 | 默认底图、省界；回答里的 GeoJSON 画成红色描边（面加外发光，点是白边圆点），定位到它的范围（最大 14 级） |

## 结构

| 文件 | 职责 |
|---|---|
| `ai-client.ts` | AI 后端的请求：`fetch`、Bearer、`AbortSignal`、超时；错误转成 `ApiError`，非 `silent` 的错误交给 app 注入的 `onError`；SSE 按行读取 |
| `api.ts` | 接口函数与 zod schema；回答的结果在 schema 里转成界面用的 `ChatResult` |
| `sse.ts` | 分块文本切成整行、取出 `data:` 的数据（纯函数） |
| `chat-result.ts`、`tool-steps.ts`、`history.ts`、`examples.ts` | 结果、步骤、历史分组、快捷提问的纯函数 |
| `chart-option.ts`、`chart-runtime.ts` | ECharts 的配置推导和按需注册 |
| `ai-result-layer.ts` | `ai-result` 分组的推导（纯函数）和结果范围 |
| `markdown.ts` | marked 转换 + DOMPurify 净化（白名单沿用旧项目，属性只留 `href`、`title`） |
| `store.ts` | `useAiAuthStore`：AI 后端的 token，`endSession()` 时一起清除 |
| `queries.ts` | 历史列表的查询、删除的变更（`useSessionGuard` 核对会话） |
| `composables/useAiChat.ts` | 对话的拥有者：消息、会话 ID、最近一次的结果；发送、打开历史、新对话在同一个 `LatestController` 通道里后发覆盖先发，作用域销毁时取消 |
| `composables/useAiSessionRemoval.ts` | 删除的流程：按对话防重复，确认框由界面提供（写法同 `useFileRemoval`） |
| `components/` | `ChatPanel`（对话 / 历史两个视图、输入框）、`ChatConversation`、`ChatMessageItem`、`ToolSteps`、`ChatHistory`、`AiResultPanel`、`ResultChart` |

页面按分栏型排布：左侧 320 是对话面板（窄屏收进抽屉），右侧上方是地图面板（`MxPanel flush`），下方是结果面板；结果最大化时地图只留 120 高的一条，并隐藏地图控制栏。地图页的运行时由路由的 `withMapRuntime` 加载，页面不缓存（`keepAlive` 未开）。

## 接口（都未联调）

AI 后端是第二个服务：开发时请求同源的 `/ai-backend`，由 Vite 转发到 `AI_PROXY_TARGET`（`.env` 里沿用旧项目的 `http://localhost:8090`），部署时由 nginx 转发（见 [deployment.md](../deployment.md)）。

| 接口 | 结构的依据 | 临时处理 |
|---|---|---|
| `POST /api/auth/login` `{ username, password }` → `{ token }` | 旧项目登录页读 `token` 或 `data.token`，取前者 | 没有调用方（账号来源待定）；失败不弹全局提示 |
| `POST /api/chat/stream`（SSE） | `done` 事件按 `views/ai-chat/data.json`（后端实际返回）；`tool_start`、`tool_end`、`token`、`error` 按旧代码优先读取的字段（`name`、`input`、`output`、`success`、`content`、`token_count`、`elapsed_ms`、`message`）；未知类型跳过 | 失败原因显示在回答里，不弹全局提示 |
| `POST /api/chat` | 与 `done` 事件相同，没有信封 | 同上；回答可能要几分钟，不限时 |
| `GET /api/sessions?limit=50` | 旧代码读 `session_id`、`title`、`message_count`、`last_time`，耗时字段旧代码试了 7 个名字，取 `duration_ms` | **失败不弹全局提示**，历史视图里显示"加载失败 + 重试"，查询的失败状态照常保留 |
| `GET /api/sessions/{id}/messages` | 旧代码读 `role`、`content`、`timestamp`、`steps`、`duration_ms`、`token_count`、`tps` | 用户操作触发，失败照常提示 |
| `DELETE /api/sessions/{id}`、`DELETE /api/sessions` | 返回体不读 | 失败照常提示 |
| `/api/exports/download/...` | `excel_url` 是 AI 后端的路径，补上 `/ai-backend` | 普通链接，不带 token |

联调前所有 AI 请求都不带 token（没有登录），会按 401 失败：AI 的 401 只提示"AI 服务未登录或登录已过期"，不结束系统的登录会话。

## 待办（TODO）

联调时恢复或核对：

- [ ] 实际请求一次各接口，按返回核对 schema，删掉不存在的可选字段、补上缺的；有信封时改成按信封解析
- [ ] SSE 事件的字段：`token` 是否用 `content`、`tool_end` 的输出和成败字段、有没有 `[DONE]` 以外的结束方式；一个事件是否可能跨多行 `data:`（现在一行就是一个事件，沿用旧项目）
- [ ] 历史列表恢复全局提示：去掉 `fetchAiSessions` 的 `silent: true`（`api.ts` 里注释写着"暂时无法联调"）
- [ ] 登录：和后端确定账号来源（后端用系统的 token 换 AI 的 token，或 AI 后端直接认系统的 token），确定后在进入 AI 对话时调用 `loginAi` 并 `setToken`；`loginAi` 的 `silent: true` 同时去掉；401 后是否清除 token、重新登录一并决定
- [ ] AI 后端的部署地址：nginx 的 `/ai-backend/` 转发、内网是否部署 AI 后端
- [ ] Excel 下载是否需要鉴权：需要时改用 `shared/file-transfer`
- [ ] 会话 ID 仍由前端生成 8 位十六进制（沿用旧项目），确认后端是否接受、会不会重复

这次没有迁移的功能：

- [ ] MVT 结果：`mvt_params`、`mvt_params_list`、`mvt_group`、`change_mvt_params`（data.json 里有，旧项目画成红色描边并按 `/api/layers/{表}/bbox` 定位）。瓦片要带 AI 的 Bearer，现在地图的 `transformRequest` 由 app 统一提供，需要先给 map-vue / shared/map 加按数据源附加请求头的能力
- [ ] 地图上点击结果要素的弹窗（旧项目列出前 12 个属性，变化图斑只列前后地类、面积、坐落）
- [ ] 历史的搜索：旧项目还按打开过的对话内容搜索（前端缓存），现在只按标题
- [ ] 底图切换、偏好记忆：旧的 AI 地图没有工具栏，这次只放了层级、缩放、指北针、默认视角；二维 / 三维按钮显示为"三维暂未开放"（共用控件不传 `dimension` 时的行为）

重构时再定：

- [ ] AI 后端的请求统一进 `shared/http`（多个后端：各自的基础地址、鉴权、信封和 401 的处理），去掉 `ai-client.ts` 里的单独实现；流式请求是否也进 `shared/http`
- [ ] 对话状态是否随页面缓存（现在离开页面就丢，历史里能重新打开）
- [ ] 中途失败、取消后，后端是否已经记下这次提问（现在只在请求没被接受时改用同步接口，避免同一个问题记两次）
- [ ] 结果区的图表、表格与地图联动

## 验收（2026-10-28）

- 测试：`features/ai-chat` 12 个文件 73 项，`app/session-end` 补 1 项；全部单元测试 260 个文件通过；改坏发送条件（回车、输入法、Shift）、历史的静默、401 的分类、卸载取消、新对话打断、改用同步接口的条件、空值显示后，相关测试都以断言失败
- 检查：类型检查、lint（依赖方向除外，见下）、公网与内网构建（产物检查通过；AI 对话页分块 gzip 约 43 KB，含 marked、DOMPurify）；现有模块的回归：生产冒烟 28 项、浏览器模式测试 24 个文件 111 项全部通过（都不含 AI 对话页）
- 页面：在 worktree 的临时开发服务器上，用本地模拟接口（AI 后端分"不可用 / 可用"两种状态）检查了 1600 × 900 和 1100 × 760：
  - AI 不可用时：进入页面没有提示；历史显示加载失败与重试、"删除全部"不可用；提问后回答里显示失败原因；流式失败后改用同步接口
  - AI 可用时：步骤与正文逐步出现，回答后结果区自动展开（图表、表格、Excel、用量）；收起、展开、最大化、还原；GeoJSON 画在地图上并定位；历史的分组、搜索、打开、删除（确认框和成功提示）
  - 窄屏：对话收进左侧窄条，点开是抽屉
- 验收中修正：图表区的标题被拉高（`MxTitle` 在竖排里 `flex: 1`），图表只剩 124 高；斜放的分类名压到滑动条（改用 ECharts 6 的 `outerBoundsMode: 'same'` 并限宽省略）；最大化时地图控制栏被裁掉
- 未验证：天地图底图（本机请求天地图返回 418，与本次改动无关，其他地图页同样）；真实 AI 后端的任何接口；lint 的依赖方向检查（本机缺 Visual C++ 运行库，已人工核对导入方向，CI 会检查）；AI 对话页没有加浏览器测试和生产冒烟用例
- 合入（2026-10-28）：用户验收通过，由 `66b06a7` 合入 main（基线 `c17eb06` 之后 main 有 18 个提交）。唯一的冲突是 `README.md`：main 已删除并忽略它，保留删除，AI 代理的说明在 [config/env.md](../config/env.md)。合并后类型检查、lint（依赖方向除外）、单元与浏览器模式 306 个文件 2553 项、图标包 35 项、公网与内网构建（产物检查通过）、生产冒烟 31 项通过；第一次跑全部测试时 `cesium-scene.browser.test.ts` 的"路线漫游中直接开始步行"遇到一次着色器编译失败（软件渲染，日志为空），和本模块无关，重跑没有出现
