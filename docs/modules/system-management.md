# 系统管理与消息

管理员的资源审核、申请详情、统计报表与下载，以及所有角色的消息弹框。决策见 [ADR 0091](../adr/0091-system-management.md)（系统管理）和 [ADR 0092](../adr/0092-header-message-popover.md)（消息）；旧代码与真实接口的核对见 [migration.md](../migration.md)"系统管理与消息中心：接口实测"。

## 分层

```
shared/data-request/          数据申请的共用清单：资源管理提交申请、系统管理审核申请都用
├─ catalog.ts                 可申请的主题图层（DATA_LAYERS）、数据格式（DATA_FORMATS）
└─ date-time.ts               接口和日期选择器的时间格式（formatDateTime）
features/data-application/    申请：接口、状态与文案、查询与审核（以后用户侧"数据下载"也在这里扩展）
features/statistics-report/   统计报表：分页与下载（待实现）
features/message-center/      消息：接口、查询、已读与弹框里的组件（待实现）
pages/system-management/      分栏布局、页面内菜单（shared 的 SideNav），组合上面两个 feature（待实现）
app/layout                    顶栏的消息按钮与弹框，把消息的业务目标换成路由（待实现）
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
| `create_time`、`start_date`、`end_date` | `appliedAt`、`startTime`、`endTime` | 带时区的 ISO 时间，转成本地的 `YYYY-MM-DD HH:mm:ss` |
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

`api.test.ts` 固定时区为北京时间（`vi.stubEnv('TZ', 'Asia/Shanghai')`），检查正文字段名、字段转换、缺失的键、统计任务、未知状态、详情的 `null` 与 ID 核对、审核的 query 与失败。`queries.test.tsx` 检查详情的 ID 标记、审核成功后的刷新、发请求前和响应后的会话核对；"发请求前换会话"的用例里审核接口不挂起，漏了核对时是断言失败而不是超时。

改坏验证（2026-10-27）：时间不转本地、放过未知状态、通过时也带原因、不核对详情的 ID、发请求前不核对会话、响应后不核对会话、成功后只刷新列表，七处都是断言失败，恢复后通过。

## 待联调

- 审核的成功返回、准备完成后的下载、驳回原因：没有真实样本，不对真实后端做写操作
- 统计任务请后端在审核列表里排除；待审核的申请没有申请人
