# 0127. 数据下载：普通用户的申请列表与统计报表

- 状态：已接受
- 日期：2026-11-02

## 背景

旧项目普通用户的"数据下载"（`views/resource-application`）和管理员的系统管理共用 `ApplicationListSection`（817 行），按 `role` 区分。[ADR 0092](0092-system-management.md) 迁移管理员一侧时定下：用户侧以后在 `features/data-application` 上扩展，列名和操作由使用方按用途传入，不在组件里判断角色。

两边的差别很小：

| | 管理员（系统管理） | 普通用户（数据下载） |
|---|---|---|
| 左侧菜单 | 资源审核、统计报表 | 数据列表、统计报表 |
| 名称的叫法 | 数据名称 | 资源名称（同旧页面） |
| 申请人 | 显示 | 不显示（都是自己的申请） |
| 打开申请 | 待审核的"审核"，其余"查看" | 全部"查看"，只读 |

旧页面还有两处和角色有关的行为：普通用户的审批提醒按钮写"查看详情"（管理员是"立即处理"）；有新消息时刷新列表（`messageService` 每 5 秒取全量，消息 ID 有变化就刷新）。

用户 2026-11-02 在 `/dev/system-management` 的普通用户视角里确认了界面。

## 候选方案

1. **复用方式**
   - 组件加一个 `audience` 开关：调用方简单，但分支又回到组件里，就是旧的 `ApplicationListSection`
   - 普通用户另写一套表格和弹窗：两边各改各的，以后容易走样
   - 组件按用途接收属性，筛选、表格、弹窗、分页组合成一个面板，两个页面只传差别（选用）
2. **只读详情**
   - `useApplicationReview` 加 `readOnly` 开关：只改两行，但只查看的页面也要创建审核的请求，开关还会传进每个判断
   - 拆出读取申请的部分，另写一个同形的拥有者 `useApplicationView`（选用）
3. **用户等数据准备时页面怎么更新**
   - 不更新，手动点查询：最简单，但和旧页面相比是倒退
   - 有"正在处理"的行时定时查询：最直接，但每页每分钟多发请求，统计报表另要一份判断
   - 未读数变多时刷新（选用）：不多发请求，最多晚 60 秒；同一轮里一条变已读、一条新到时看不出来，等下一次变化

## 决定

1. **页面和路由**：`pages/resource-application`，结构同系统管理（`MxSplitLayout asideType="menu"` 加 `SideNav`）。`/resource-application` 是数据列表，`/resource-application/statistical-report` 是统计报表，沿用旧地址，同一个页面组件，栏目由路由 `props` 传入，只有普通用户能访问。打开的申请是数据列表的查询参数 `apply`（ADR 0092 第 3 条）。顶栏的"数据下载"在两个路由上都显示为选中
2. **共用的面板放进 feature**：`features/data-application` 的 `ApplicationListPanel`（筛选、表格、弹窗、分页、下载），差别由 `title`、`owner`、`nameLabel`、`showApplicant`、`openLabel` 传入；`features/statistics-report` 的 `ReportListPanel` 由 `pages/system-management` 的 `ReportsSection` 移过来。页面只负责把打开和关闭换成路由
3. **只读详情是 `useApplicationView`**：和 `useApplicationReview` 共用读取申请的部分，形状相同（弹窗不用改），模式总是 `view`，提交什么都不做，也不创建审核的请求。待审核的申请在弹窗里写"审核进度"（还没有结果）；不显示申请人时"申请处室"独占一行，开始、结束时间仍然成对
4. **新消息刷新列表**：`features/message-center` 的 `useOnNewMessage(onNew)` 在未读数变多时回调，页面让申请和报表的查询失效，正在显示的列表和打开的详情马上重新读取。它用 `enabled: false` 的观察者只读顶栏那个未读查询的结果，自己不请求、不定时；`refetchInterval` 是每个观察者一个定时器，多一个定时的观察者轮询就翻倍。这次只接在数据下载上，管理员的列表没有变化
5. **角色对应的页面放在 `shared/auth/roles`**：`roleApplicationRoute`、`roleReportRoute`（写法同 `roleHome`，新增角色时漏配会报类型错误），消息跳转和基本统计的"去下载"共用
6. **取代 ADR 0093 第 5、6 节和 ADR 0100 第 8 节里"等数据下载迁移"的做法**：普通用户的业务按钮和"去下载"不再禁用，去掉 `unavailableReason`、`downloadBlocked` 和"数据下载页面迁移后可用"。`messageLocation(target, role)` 按角色换成路由；审批提醒的按钮文案按能否审核区分（`MessagePanel` 的 `canAudit`，由 app 按角色给出），不能审核时写"查看申请"
7. **删掉占位页**：这是最后一个占位的业务页，`PlaceholderPage` 和路由表里的 `placeholder` 不再有使用方

## 后果

- 两个页面的差别都在调用处，加一种差别只加一个属性；组件里仍然没有角色判断
- 用户等数据准备时不用手动刷新，但最多晚 60 秒，标签页隐藏时不更新，切回后等下一次轮询
- 管理员的列表和旧页面相比仍不随新消息刷新，要加时在系统管理页调用同一个 `useOnNewMessage`
- 还没有用普通用户账号请求过真实接口：旧页面对两种角色发同样的请求，"只看到本人的申请"靠后端保证，记在 [docs/archive/migration.md](../archive/migration.md)
