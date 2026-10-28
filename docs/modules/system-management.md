# 系统管理与消息

管理员的资源审核、申请详情、统计报表与下载，以及所有角色的消息弹框。决策见 [ADR 0091](../adr/0091-system-management.md)（系统管理）和 [ADR 0092](../adr/0092-header-message-popover.md)（消息）；旧代码与真实接口的核对见 [migration.md](../migration.md)"系统管理与消息中心：接口实测"。

## 分层

```
shared/data-request/          数据申请的共用清单：资源管理提交申请、系统管理审核申请都用
├─ catalog.ts                 可申请的主题图层（DATA_LAYERS）、数据格式（DATA_FORMATS）
└─ date-time.ts               表单的本地时间格式（formatDateTime）、按北京时间显示（formatBeijingDateTime）
shared/side-nav/              菜单型左栏的页面内导航 SideNav
features/data-application/    申请：接口、状态与文案、查询与审核、列表的组合式函数、筛选栏、表格、状态显示
                              （以后用户侧"数据下载"也在这里扩展）
features/statistics-report/   统计报表：分页与下载（待实现）
features/message-center/      消息：接口、查询、已读与弹框里的组件（待实现）
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

- **`useApplicationList`**：筛选表单点"查询"才生效，名称去掉首尾空格，回到第 1 页；条件没变时点查询也重新请求；改每页条数回到第 1 页。和文件管理的 `useFileList` 同一套做法（每组条件记下总数、两种加载状态）；页码修正同资源管理的 `useResourceList`：后端（PageHelper）把越界的页码改成最后一页时页码跟过去，并用 `rememberPage` 把结果记到修正后的页上；没有数据时 `pages` 是 0，回到第 1 页
- **`ApplicationFilterBar`**：数据名称、审核状态、数据准备状态，`QueryForm`（标签 6 个字宽）
- **`ApplicationTable`**：序号、数据名称、申请人、行政区划、申请时间、审核状态、数据准备状态；数据准备状态只有审核通过的申请和统计任务才有，其余单元格留空，由表格的全局样式显示"-"。操作列在下一步随详情与审核加入
- **`AuditSection`**（页面里）：组合上面三个和分页（`pagination-wrap`）；只在资源审核栏目显示时存在，统计报表栏目不请求申请列表

文件管理、资源管理和这里的列表组合式函数现在是同一套分页逻辑写了三遍，差别只在参数和页码的修正规则；以后可以抽成公共的分页列表，这次不动另两个模块。

## 页面与路由

- `/system-management`（`RouteName.systemManagement`）和 `/system-management/statistical-report`（`RouteName.systemManagementReports`）都指向 `SystemManagementPage`，栏目由路由 `props` 传入；两个路由间切换时页面不重建，侧栏的状态保留
- 顶栏的"系统管理"写了 `alsoActiveOn: [systemManagementReports]`，宽屏导航和窄屏菜单在统计报表上也显示为选中
- `SideNav`（`shared/side-nav`）：菜单项是 `RouterLink`，当前页由 `RouterLink` 判断（不看查询参数，打开申请时仍是当前页），加 `aria-current`；要放在 `MxSplitLayout` 的侧栏里，窄屏时在抽屉里点了就关闭抽屉。外观按 page-layout 的"菜单型左栏"
- 删掉了 `message-center` 的占位路由和路由名（ADR 0092）
- 统计报表栏目目前是"迁移中"的占位，下一步接入

### 验证（2026-10-27）

- 单元测试：`useApplicationList`（9 项）、`SideNav`（3 项）、`SystemManagementPage`（3 项）、顶栏的选中（`menus.test.ts`、`CompactNav.test.tsx` 各 1 项）、`formatBeijingDateTime`（3 个时区）
- 改坏验证：名称不去空格、不跟后端修正页码、空结果停在第 0 页、统计报表上顶栏不选中、窄屏菜单不按同页路由选中、窄屏点了不关抽屉、报表栏目也请求列表、所有申请都显示准备状态、时间按本地时区，都是断言失败
- 真实页面：用开发服务和管理员会话只读打开 `/system-management`。1440 × 900 下 35 条、首页 20 条，筛选"待审核"得到 1 条；切到统计报表时顶栏和侧栏的当前项正确；390 × 844 下侧栏收成窄条、筛选栏换行、分页排成三行，没有横向滚动。资源管理的分页改用 `pagination-wrap` 后，1440 和 390 宽下的排法和原来一致

## 待联调

- 审核的成功返回、准备完成后的下载、驳回原因：没有真实样本，不对真实后端做写操作
- 统计任务请后端在审核列表里排除；待审核的申请没有申请人
