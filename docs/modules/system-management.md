# 系统管理与消息

管理员的资源审核、申请详情、统计报表与下载，以及所有角色的消息弹框。决策见 [ADR 0091](../adr/0091-system-management.md)（系统管理）和 [ADR 0092](../adr/0092-header-message-popover.md)（消息）；旧代码与真实接口的核对见 [migration.md](../migration.md)"系统管理与消息中心：接口实测"。

## 分层

```
shared/data-request/          数据申请的共用清单：资源管理提交申请、系统管理审核申请都用
├─ catalog.ts                 可申请的主题图层（DATA_LAYERS）、数据格式（DATA_FORMATS）
├─ date-time.ts               表单的本地时间格式（formatDateTime）、按北京时间显示（formatBeijingDateTime）
├─ prepare-status.ts          数据准备的状态（申请和统计报表共用）
└─ PrepareStatusText.tsx      数据准备状态的图标和文案
shared/table/usePagedList.ts  后端是 PageHelper 的列表（申请、统计报表共用）
shared/file-transfer/         useRowDownloads（行内下载）、DownloadButton；shared/http 加了 postBlob
shared/side-nav/              菜单型左栏的页面内导航 SideNav
features/data-application/    申请：接口、状态与文案、查询与审核、列表的组合式函数、筛选栏、表格、状态显示
                              （以后用户侧"数据下载"也在这里扩展）
features/statistics-report/   统计报表：接口、查询、列表与下载的组合式函数、筛选栏、表格
features/message-center/      消息：接口、查询与已读、弹框的组合式函数 useMessageCenter、弹框里的 MessagePanel
pages/system-management/      SystemManagementPage（分栏布局、SideNav）与资源审核栏目 AuditSection
app/router、app/layout        两个路由；顶栏在统计报表上也选中"系统管理"；消息按钮与弹框（待实现）
```

区划选项（`REGION_OPTIONS`、`PROVINCE_PATH`）只有资源管理的申请表单用，留在 `features/resource-management/data-request.ts`。

## 申请的数据层（`features/data-application`）

### 接口

| 函数 | 请求 | 说明 |
|---|---|---|
| `fetchApplicationPage` | `POST /api/apply/list` | 正文 `{ applyName, status, taskStatus, pageNum, pageSize }`，空字符串不筛选；PageHelper 分页，只取 `list`、`total`、`pageNum`、`pageSize` |
| `fetchApplication` | `GET /api/apply/{id}` | ID 不存在时接口返回 `data: null`，这里得到 `null`；返回的 ID 不是请求的那条时按返回格式错误处理 |
| `auditApplication` | `POST /api/apply/status/{id}?status=&reason=` | 没有正文；通过时 `reason` 是空字符串。成功的 `data` 没有实测，只判断业务码 |

都是 `silent: true`：列表、详情的失败由表格和弹窗显示，审核的失败由弹窗提示。

### 字段

接口用蛇形字段，没有值的字段整个键都不出现。schema 的 `transform` 一次转成界面用的 `Application`，组件不再碰原始字段：

| 接口 | `Application` | 说明 |
|---|---|---|
| `apply_id` | `id` | |
| `apply_name` | `name` | 统计任务可能没有 |
| `user_name` | `applicant` | 实测待审核的申请没有（后端问题） |
| `receiver_dept_name` | `department` | |
| `layer_code` | `layerCode` | 名称由 `shared/data-request` 的 `DATA_LAYERS` 对照 |
| `xzqmc` | `region` | |
| `create_time`、`start_date`、`end_date` | `appliedAt`、`startTime`、`endTime` | 带时区的 ISO 时间，按北京时间写成 `YYYY-MM-DD HH:mm:ss`（见下文"时间"） |
| `data_formats` | `formats` | 小写逗号串拆成数组；统计任务是 `.zip` |
| `apply_purpose` | `purpose` | |
| `status` | `status` | `pending`、`approved`、`rejected`、`table`（混在申请表里的统计任务） |
| `remark` | `reason` | 不通过的原因；通过的是空字符串 |
| `storage_status` | `prepare` | `processing`、`success`、`timeout`、`failed`；没有时还没开始准备 |

状态是枚举：出现没见过的值时整页按返回格式错误处理，不像旧代码那样把一组同义词猜成同一个状态。真实接口出现新值时，先核对含义再加进枚举。

`status.ts` 放文案和两个判断：`hasPrepareStep`（审核通过的申请和统计任务才准备数据）、`canDownload`（准备完成）。

### 查询

- `applicationKeys`：`['data-application', 'page', params]`、`['data-application', 'detail', id]`，只在 `queries.ts` 里拼
- `useApplicationPageQuery`：换条件、翻页时保留上一次的数据（`keepPreviousData`），表格据此显示遮罩
- `useApplicationQuery(id)`：没有 ID 时不请求；结果用 `select` 标上 ID（`ApplicationEntry`），key 换了以后 `data` 要到下一轮调度才更新，读的一方按 ID 判断
- `useAuditApplicationMutation`：提交时 `capture()` 会话，发请求前 `assertCurrent`，响应后 `isCurrent` 才让 `['data-application']` 下的缓存失效；不随组件卸载取消

### 测试

`api.test.ts` 把运行环境放在洛杉矶时区（`vi.stubEnv('TZ', 'America/Los_Angeles')`），时间仍是北京时间；检查正文字段名、字段转换、缺失的键、统计任务、未知状态、详情的 `null` 与 ID 核对、审核的 query 与失败。`queries.test.tsx` 检查详情的 ID 标记、审核成功后的刷新、发请求前和响应后的会话核对；"发请求前换会话"的用例里审核接口不挂起，漏了核对时是断言失败而不是超时。

改坏验证（2026-10-27）：时间不转本地、放过未知状态、通过时也带原因、不核对详情的 ID、发请求前不核对会话、响应后不核对会话、成功后只刷新列表，七处都是断言失败，恢复后通过。

### 时间

后端按北京时间记录：消息的 `createTime` 直接是北京时间的字符串，申请的时间是带时区的 ISO。申请的时间用 `formatBeijingDateTime`（`Intl.DateTimeFormat` 的 `timeZone: 'Asia/Shanghai'`）显示，和消息里的时间一致，不随浏览器的时区变化。开发机在美国太平洋时区时实测发现：按浏览器本地时间转换，同一条申请在列表里是 20:29、在消息里是 11:29。表单提交用的 `formatDateTime` 仍按本地时间，和日期选择器一致。

## 资源审核列表

- **`useApplicationList`**：`shared/table` 的 `usePagedList`（见 [table.md](table.md)）加上申请的条件。筛选表单点"查询"才生效，名称去掉首尾空格，回到第 1 页；条件没变时点查询也重新请求；改每页条数回到第 1 页；后端（PageHelper）把越界的页码改成最后一页时页码跟过去，没有数据时回到第 1 页
- **`ApplicationFilterBar`**：数据名称、审核状态、数据准备状态，`QueryForm`（标签 6 个字宽）
- **`ApplicationTable`**：序号、数据名称、申请人、行政区划、申请时间、审核状态、数据准备状态；数据准备状态只有审核通过的申请和统计任务才有，其余单元格留空，由表格的全局样式显示"-"。操作列固定两格：待审核的"审核"、其余"查看"（统计任务没有）；有数据准备这一步的有"下载"，准备完成才能点
- **`AuditSection`**（页面里）：组合上面三个和分页（`pagination-wrap`）；只在资源审核栏目显示时存在，统计报表栏目不请求申请列表

申请和统计报表的列表共用 `usePagedList`；文件管理（Spring 分页）、资源管理（按目录）仍是各自的写法，这次没有改。

## 页面与路由

- `/system-management`（`RouteName.systemManagement`）和 `/system-management/statistical-report`（`RouteName.systemManagementReports`）都指向 `SystemManagementPage`，栏目由路由 `props` 传入；两个路由间切换时页面不重建，侧栏的状态保留
- 顶栏的"系统管理"写了 `alsoActiveOn: [systemManagementReports]`，宽屏导航和窄屏菜单在统计报表上也显示为选中
- `SideNav`（`shared/side-nav`）：菜单项是 `RouterLink`，当前页由 `RouterLink` 判断（不看查询参数，打开申请时仍是当前页），加 `aria-current`；要放在 `MxSplitLayout` 的侧栏里，窄屏时在抽屉里点了就关闭抽屉。外观按 page-layout 的"菜单型左栏"
- 删掉了 `message-center` 的占位路由和路由名（ADR 0092）

### 验证（2026-10-27）

- 单元测试：`useApplicationList`（9 项）、`SideNav`（3 项）、`SystemManagementPage`（3 项）、顶栏的选中（`menus.test.ts`、`CompactNav.test.tsx` 各 1 项）、`formatBeijingDateTime`（3 个时区）
- 改坏验证：名称不去空格、不跟后端修正页码、空结果停在第 0 页、统计报表上顶栏不选中、窄屏菜单不按同页路由选中、窄屏点了不关抽屉、报表栏目也请求列表、所有申请都显示准备状态、时间按本地时区，都是断言失败
- 真实页面：用开发服务和管理员会话只读打开 `/system-management`。1440 × 900 下 35 条、首页 20 条，筛选"待审核"得到 1 条；切到统计报表时顶栏和侧栏的当前项正确；390 × 844 下侧栏收成窄条、筛选栏换行、分页排成三行，没有横向滚动。资源管理的分页改用 `pagination-wrap` 后，1440 和 390 宽下的排法和原来一致

## 详情与审核

- **路由状态**：资源审核路由的 `props` 是 app 里的 `auditRouteProps`，把查询参数 `apply` 交给页面（空字符串、写了几次的不认）。点"审核 / 查看"时 push（浏览器的后退能关掉弹窗），关闭时 replace 去掉它；消息跳转、刷新页面、再次打开同一条都是同一件事
- **`useApplicationReview(applyId, send?)`**：打开的申请和审核。`state` 是 `closed`、`loading`、`error`、`missing`、`ready`；查询换 key 后 `data` 要到下一轮才更新，只认标着当前 ID 的结果，换申请时不会先显示上一条。`mode` 由申请当前的状态决定（待审核的是 `audit`，其余 `view`）。换申请时审核意见从头填。`submit()` 只提交待审核的申请，原因去掉首尾空格，提交期间不重复提交；结果是 `success`（带申请 ID）、`error`（带原因）或 `null`（没发出，或页面已销毁、换了会话）。不渲染、不跳转、不提示
- **`useSeedApplication`**：从列表打开时先把这一行记成它的详情（字段相同），弹窗立刻有内容，详情接口照常读取最新的状态；从消息打开时没有这一步，读取超过 300 毫秒才出骨架屏
- **`ApplicationDialog`**：`dialog-panel-header` 加 `MxTitle`，宽 640（窄屏视口减 32）。"申请信息"是 `ElDescriptions`（窄于 640 时一列），标签至少 4 个字宽，值在自己的位置换行，没有值时显示"-"；图层名称、格式名称由 `shared/data-request` 的 `dataLayerLabel`、`dataFormatLabel` 换算。下面是"审核意见"（通过 / 不通过，不通过必须填原因，最多 200 字）或"审核结果"（审核状态、数据准备、不通过原因）。成功后提示"已审核通过"或"已退回申请"；提交期间换成了别的申请时不关那一条
- **关闭**：Element 的弹窗要等淡出结束才发出 `update:modelValue`，所以点关闭、按 Esc 时在 `beforeClose` 里立即通知页面去掉 `apply`；弹窗的开关只跟着路由。提交期间不关

### 验证（2026-10-27）

- 单元测试：`useApplicationReview`（8 项）、页面（打开时先用列表的数据、不通过必须填原因、提交后关闭并刷新列表、只查看、不存在）、`auditRouteProps`、`dataLayerLabel` / `dataFormatLabel`
- 浏览器测试 `ApplicationDialog.browser.test.tsx`（真实 Chromium 布局）：1280 宽时 640 宽、两列的值各自对齐、长名称在值的位置换行；390 宽时 358 宽、每行一项、没有横向滚动。截图在被忽略的 `apps/web/design.local/system-management/`（测试里没有用到项目字体和主题色，只看结构）
- 改坏验证 12 处（空的 apply 也认、不核对结果的 ID、换申请不清意见、原因不去空格、销毁或换会话后仍报告成功、都按审核模式、非待审核也提交、不通过不要求原因、成功后不关、点关闭不去掉 apply、打开时不先用列表数据、统计任务也能查看），都是断言失败。"打开时不先用列表数据"第一次没测出来：详情接口在同一轮里就返回了，改成让详情接口挂起后才能区分
- 没有验证：真实页面里的弹窗（这次用户的开发服务占着 5273，登录会话在那个地址下，没有把登录凭据转到别的地址），真实的审核提交（不对真实后端做写操作）

## 下载与统计报表

- **下载**：`shared/file-transfer` 的 `useRowDownloads` 和 `DownloadButton`（见 [file-transfer.md](file-transfer.md)）。申请用 `fetchApplicationFile`（`POST /api/apply/download/{id}`，`http.postBlob`），报表用 `fetchReportFile`（`GET /statistics/download?id=`）；没有响应头的文件名时用名称加 `.zip`（旧页面的写法）。列表和弹窗共用同一份下载状态，在哪里点都显示进度；结果由页面提示（"已交给浏览器下载"或失败原因）
- **数据准备的状态**放在 `shared/data-request`（`prepare-status.ts`、`PrepareStatusText`）：申请的 `storage_status` 和报表的 `status` 是同一套取值，旧页面用同一个函数换算
- **统计报表**（`features/statistics-report`）：`POST /statistics/page`（正文 `name`、`pageNum`、`pageSize`）、`useReportList`（`usePagedList`，名称去掉首尾空格）、`ReportFilterBar`（报表名称）、`ReportTable`（序号、年份、报表名称、开始时间、完成时间、状态、下载）。**没有真实样本**：2026-10-27 只读核对时一条记录都没有，字段按旧页面读的写（`id`、`name`、`year`、`startTime`、`finishTime`、`status`），年份统一成字符串、时间原样显示；状态是字符串，认得数据准备的四个值，其他的原样显示；`status` 是 `success` 才能下载
- **`ReportsSection`**（页面里）：只在统计报表栏目显示时存在

### 验证（2026-10-27）

- 单元测试：`http.postBlob`、`fetchFile` 的 `method`、`useRowDownloads`（进度、防重复、失败、页面销毁和换会话中止）、`DownloadButton`、统计报表的接口、页面（申请的下载按钮哪些能点、列表和弹窗里下载、统计报表的表格和下载）
- 浏览器测试 `ApplicationTable.browser.test.tsx`：操作列两格里"查看"和"下载 100%"都放得下；把操作列改窄到 100 时断言失败
- 改坏验证 12 处：postBlob 用 GET、忽略 method、不防重复、换会话不中止、销毁不中止、中止后仍保存、总量未知也显示百分比、没准备好也能下载、报表没完成也能下载、弹窗里的下载不响应、年份不转字符串、申请下载用 GET，都是断言失败。"postBlob 用 GET"第一次是没有模拟的请求报错、"不防重复"第一次是超时，改成接住所有方法、和下一轮的等待赛跑后才是断言失败
- 没有验证：真实的下载（没有准备完成的申请，统计报表没有记录），下载响应的文件名和类型

## 消息（`features/message-center`）

### 接口

| 函数 | 请求 | 说明 |
|---|---|---|
| `fetchMessages(unread)` | `POST /api/message/list` | 正文 `{}`，只要未读时 `{ isRead: 'false' }`；一次返回全部，不分页。`silent`：失败由弹框显示，角标不提示 |
| `markMessageRead(id)` | `POST /api/message/read/{id}` | 没有正文；成功的 `data` 没有实测，只判断业务码。失败由全局提示显示原因 |
| `markAllMessagesRead()` | `POST /api/message/read/all` | 没有正文，由后端决定改哪些（见下文"全部已读"） |

schema 的 `transform` 转成 `Message`：`msgId` → `id`，`createTime` → `createdAt`（北京时间的字符串，原样保留），字符串的 `isRead` → 布尔的 `read`，`taskId` → `applyId`（就是申请的 `apply_id`，报表通知是 `null`）；`category`、`title`、`content` 不变。发送人、处室、优先级这些界面不用的字段不声明。`category` 和 `isRead` 是枚举，出现没见过的值时整个列表按返回格式错误处理。

### 查询与已读（`queries.ts`）

- **`useMessagesQuery(enabled)`**：全部消息，只在弹框打开时请求，每次打开都重新取一次，先显示缓存。返回时用其中的未读更新未读的缓存，角标和弹框里的未读数一致
- **`useUnreadCountQuery()`**：接口没有计数，取未读列表的长度（`select`）。`refetchInterval` 60 秒；标签页隐藏时 Vue Query 不取（`refetchIntervalInBackground` 默认关），全局又关了切回时的刷新，所以切回后等下一次间隔
- **已读成功后**先改两个缓存（红点和角标马上变），再让两个查询失效、按服务端的结果刷新。不等刷新完成：结果已经显示，全量列表较大。弹框关着时全量查询不在用，只标为过期，下次打开再取
- 写操作按 `useSessionGuard` 核对会话：发请求前换了会话就以取消结束，响应时已换会话不改缓存

**全部已读和 ADR 0092 的出入**：ADR 写的是"只改提交时看到的未读，之后到达的新消息保持未读"，但接口没有参数，后端把当前账号的消息全部改成已读（旧页面也是这样调用）。前端只能做到本地先改提交时看到的那些，刷新后按服务端的结果显示：提交前后到达的新消息，刷新后也是已读。要严格做到需要后端接收 ID，记在"待联调"。

### 弹框的状态（`useMessageCenter`）

参数是弹框是否打开。返回：

- `unreadCount`：角标和标题栏共用，还没取到时是 0
- 筛选：`readFilter`（全部 / 未读）、`category`（全部类型或一种），`setReadFilter`、`setCategory` 换条件后从头显示
- 分批：`visible`（一次 20 条）、`filteredCount`、`hasMore`、`loadMore`（由列表在 `hasMore` 时调用）
- 加载：`initialLoading`（还没有数据、第一次请求中）、`loadFailed`（没有数据且失败；显示着缓存时刷新失败照常显示缓存）、`retry`
- 已读：`markRead(message)`，已读的、正在标记的、全部已读进行中时直接返回 false，按消息 ID 记录进行中（`isReading`）；`markAllRead()` 只提交弹框里看到的未读，单条已读进行中时不提交，`canReadAll`、`readingAll` 给按钮用。成功才返回 true；弹框已销毁或换了会话时不报告成功

和其他组合式函数一样不渲染、不提示、不跳转。

### 弹框里的组件（`MessagePanel`）

- 外层是 `MxPanel headerTone="muted" flush`（ADR 0076）：标题"消息"，说明"N 条未读"，操作区"全部已读"；筛选放在 `subheader`，只有列表滚动。最高取 CSS 变量 `--message-panel-max-height`，由 app 的弹框按顶栏位置算出
- 一条消息：未读红点；类型标签（审批提醒 `warning`、资源消息 `primary`、统计报表 `info`）；标题（过长省略）；时间（`messageTime`：今天写"今天 时:分"，今年写"月-日 时:分"，更早写日期；"今天"按北京时间判断，悬停看完整时间）；完整正文（连续的字母数字也能换行）；业务按钮
- 点一行或在行上按回车标为已读。业务按钮标为已读并发出 `open(target)`，由 app 关弹框、跳转；点击会冒泡到整行，同一条按 ID 只提交一次，所以不阻止冒泡
- 业务按钮的文案和目标由 `display.ts` 的 `messageLink` 给出（ADR 0092 第 6 条）；`unavailableReason(target)` 返回原因时按钮禁用、旁边显示原因，由 app 按角色给出
- 滚到距底部 120 以内接着显示（`useInfiniteScroll`）；换筛选回到列表顶部
- 第一次请求的骨架屏延迟显示（`useDelayedFlag`）；失败时"加载失败 / 重试"；空的分"暂无消息"和"没有未读消息"；末尾是"继续滚动显示更多"或"共 N 条"

顶栏的按钮、`ElPopover` 外壳、按角色把目标换成路由在 `app/layout`（下一步）。

### 验证（2026-10-28）

- 单元测试：接口（字段转换、两种正文、没见过的类型和已读值、ID 编码进路径、失败原因）；查询（只在打开时取全量且每次打开都取、全量更新未读数、60 秒刷新且隐藏时不取、已读先改缓存再刷新、失败不改、两种换会话、全部已读本地只先改提交的）；`messageLink`、`messageTime`（北京时间的"今天"和跨年）；`useMessageCenter`（筛选与分批、加载失败与重试、防重复、互斥、换会话和销毁后不报告成功）；`MessagePanel`（未读数与每条的内容、点一行和回车、业务按钮与不可用的原因、全部已读、只看未读、重试）
- 浏览器测试 `MessagePanel.browser.test.tsx`：最高 480 时只有列表滚动，滚到底显示第二批，标题栏和筛选不动；消息少时按内容定高；343 宽时筛选在一行、长标题省略、时间完整、长正文换行、没有横向滚动。用缓存里放好的数据和真实的组合式函数，不发请求；截图只看了结构（测试里没有颜色令牌）
- 改坏验证 30 处，都是断言失败。第一次没测出来或是超时的几处：全部已读改用整个缓存的 ID（测试里提交的恰好是全部未读，改成只提交一部分）、换"未读"不回到开头（未读不到一批，加多了数据）、应当立即返回的调用被挂起的请求拖到超时（改成和下一轮宏任务赛跑）、长正文不换行（原来的长串夹着汉字，本来就能断行）
- 改了测不出来、确认是多余的写法，删掉了：业务按钮阻止冒泡、行上的回车只认行本身（同一条按 ID 只提交一次）；列表的 `flex: 1`、`min-height: 0`（滚动容器在纵向 flex 里本来就能压缩）；时间的 `flex: none`（标题的基准宽度是 0，先被压缩）；`loadMore` 到底后的判断；已读开始时的销毁判断
- 没有验证：真实接口的已读和全部已读（写操作）；弹框放进真实顶栏后的样子（下一步）

## 待联调

- 审核的成功返回、准备完成后的下载（文件名、类型、大小）、驳回原因：没有真实样本，不对真实后端做写操作
- 统计报表的字段、类型和状态取值：分页接口目前没有记录
- 统计任务请后端在审核列表里排除；待审核的申请没有申请人
- 消息已读、全部已读的成功返回；全部已读请后端接收提交时看到的消息 ID，之后到达的新消息保持未读（ADR 0092）
- 消息列表请后端加分页和未读数接口：现在每 60 秒传一次未读的整个列表，打开弹框传一次全部（当时约 225 KB）
