# 城市国土空间监测基本统计

按年度提交六种报表（基本统计、汇总统计、基本变化、水路网基本、水路网变化、实体变化）的计算任务，查看一份报表（年份 + 报表类型 + 行政区划等级，变化类报表另有本底年份）的处理进度、全年的总览和每张统计表的状态。决策见 [ADR 0100](../adr/0100-space-monitoring-statistics.md)，其余四种报表和本底年份见 [ADR 0117](../adr/0117-statistics-remaining-reports.md)；旧代码与真实接口的核对见 [migration.md](../migration.md)"城市国土空间监测基本统计：接口实测"，和旧页面的差异见同一文档的"与旧页面的差异"。

## 报表

| 报表（tableType） | 等级 | 本底年份 | 请求参数 | 总览的状态字段 |
|---|---|---|---|---|
| 基本统计 `baseTable` | 省、市、区、县 | — | `baseTableParam` | `base*Status` |
| 汇总统计 `summaryTable` | 省、市 | — | `summaryTableParam` | `summary*Status` |
| 基本变化 `baseChangeTable` | 省、市、区、县 | 变更本底 | `baseChangeTableParam` | `baseChange*Status` |
| 水路网基本 `baseWaterTable` | 省、市、区县 | — | `baseWaterTableParam` | `baseWater*Status`（区县级是 `District`） |
| 水路网变化 `changeWaterTable` | 省、市、区县 | 水路本底 | `changeWaterTableParam` | `changeWater*Status`（区县级是 `District`） |
| 实体变化 `entityChangeTable` | 省、市、区、县 | 变更本底 | `entityChangeTableParam` | `entityChange*Status` |

配置在 `statistics.ts` 的 `TABLES`（`levels`、`mergedDistrict`、`baseYear`），状态字段在 `api.ts` 的 `STATUS_FIELDS`。水路网的区县级按 `district` 请求和取状态，创建时传 `isDistrict: true`、`isCounty: false`，名称叫"区县级"（`levelLabel`）。

## 分层

```
features/monitoring-statistics/
├─ api.ts                       StatisticsApi（总览、报表状态、创建任务）与真实实现 statisticsApi
├─ queries.ts                   总览、报表状态的查询；结果标上年份或条件，间隔由拥有者给出
├─ statistics.ts                报表与等级的配置、状态文字的归类、总览矩阵、创建任务的请求体（纯函数）
├─ report.ts                    报表状态的类型、处理到头的判断、条件按选项换算（纯函数）
├─ tracking.ts                  提交后的跟踪：状态机和进度区的提示（纯函数）
├─ composables/
│  ├─ useStatisticsReport       查看条件、当前报表的状态与轮询、跟踪、监控列表的筛选
│  ├─ useStatisticsOverview     一年的总览矩阵与跟进
│  └─ useStatisticsCalculation  左栏的年度、勾选、提交前检查和提交
└─ components/
   ├─ StatisticsCalculationPanel 统计报表计算（左栏）与确认框
   ├─ ReportConditionsPanel      选择查看报表
   ├─ ReportProgressPanel        当前报表进度
   ├─ StatisticsOverviewPanel    年报表统计计算总览
   └─ ReportMonitorPanel         当前报表监控（状态筛选、去下载、统计表）
pages/space-monitoring-statistics/  页面：分栏布局、拥有者、左栏的收起与把手图（images/）、初次进入的落点、去下载
pages/dev/monitoring-statistics/    组件样例：正式页面换上固定数据的接口（demo-api.ts）
libs/ui/split-layout/               MxSplitLayout 的宽屏收起（collapsible）与 rail、collapse 插槽，见 modules/ui.md
```

## 数据从哪里来

| 内容 | 接口 | 持有者 |
|---|---|---|
| 总览 | `POST /statistics/select-left-task`，`{ year, bdYear }` | 查询缓存，`useStatisticsOverview` 推导矩阵；两个本底年份不同时各查一次，按报表合成（`mergeOverview`） |
| 报表状态、可选项 | `POST /statistics/select-task-status`，`{ year, bdYear?, tableType, level }`（变化类报表才有 `bdYear`） | 查询缓存，`useStatisticsReport` 记下最近的选项 |
| 开始统计 | `POST /statistics/create-table` | 写操作，按 `useSessionGuard` 核对会话 |

创建任务的请求体：`{ year, baseTableParam?: { year, isProvince, isCity, isDistrict, isCounty }, baseChangeTableParam?: { year, bdYear, ... }, ... }`，只放勾选了等级的报表，变化类报表带各自的本底年份（`createTaskPayload`）。报表类型的名称统一按前端的叫法，不用后端 `tableTypeList` 里的 `label`。

## 本底年份

- 两种本底：变更本底（基本变化、实体变化）、水路本底（水路网变化）；默认监测年份的上一年，只能选更早的年份（年份选择器置灰，拥有者收到不合法的年份时抛错），换监测年份时回到上一年
- 查看：`useStatisticsReport` 持有两个本底年份，`criteria.baseYear` 是当前报表用的那一个（不是变化类报表时为 `null`）；换报表时跟着报表的种类取，提交后换成提交时的
- 左栏：`useStatisticsCalculation` 另有两个本底年度，第一次展开时跟着正在查看的；提交时锁定，确认期间再改不影响这次提交
- 总览标题下写变化类报表按哪个本底年份

## 查看条件

- 默认上一年、基本统计、省级；返回的选项里没有当前的报表或等级时换成第一个可选的（刚提交还在跟踪的组合不换）
- 第一行"监测年份"，变化类报表在同一行后面多一个"本底年份"（放不下时换行）；"报表类型"是下拉（六个名称较长）；"行政区划"是单选按钮。汇总统计只有省、市级，水路网报表是省、市、区县级
- 查看条件按内容的高度，进度区占左列剩下的；换报表时面板高度不变
- 初次进入时，总览和当前报表都到了以后，如果当前组合没有结果（成功、失败、处理中都算有），落到总览里第一个有结果的组合；用户先动过条件就不再落
- 换条件、新的一轮提交都把状态筛选恢复成全部，统计表回到顶部

## 轮询

| 对象 | 间隔 | 停止 |
|---|---|---|
| 当前报表 | 没处理完、或当前组合还在跟踪时 5 秒 | 处理到头（整体状态完成或失败、百分比到 100、成功加失败到总数、什么都没有）；连续失败 3 次（按 5、10 秒退避） |
| 总览 | 有处理中的组合、或这一年还有跟踪中的组合时 30 秒 | 没有了；连续失败 3 次（按 30、60 秒退避） |

标签页隐藏时不按间隔查。当前报表开始或结束处理时，页面顺便刷新总览；进度区的"刷新"同时刷新两者。最近一次查询失败时，即使显示着上一次的结果也在进度区提示，并给"重新查询"。

## 提交

1. 逐个勾选的组合查一次状态：有表或没处理完是已有任务（重新统计），没有任务是新统计；查不到的、本页正在跟踪的按"未确认"
2. 确认框：没有已有任务时一句话；有时逐条列出（最多 8 条），有处理中的另外提醒会打断进度
3. 确认后左栏收起，切到第一项开始跟踪，再发出创建请求
4. 被拒绝（业务码、4xx）：报错，进度区显示原因和"重新查询"；没有明确结果（网络错误、超时、5xx）：提醒不要重复提交，继续跟踪

跟踪的阶段（`tracking.ts`）：提交中 → 已提交等待（新统计最多 90 秒，重新统计 15 秒）→ 处理中 → 查到本次的结果就结束；新统计查到结果就算，重新统计要先见过处理中；等到截止还没有就超时，提示后可以重新查询。

## 左栏的把手

宽屏收起、展开时的把手是旧页面的设计图（ADR 0101），由页面通过 `MxSplitLayout` 的 `rail`、`collapse` 插槽给出；窄屏仍是默认的窄条和抽屉。

| 文件 | 来源 | 显示 |
|---|---|---|
| `images/panel-handle-collapsed.webp` | 用户 2026-10-28 给的 `1.svg`（同旧 `public/images/TongJi/panel-handle-collapsed.png`），2 倍尺寸 160 × 554，18 KB | 收起时的竖条 80 × 277，竖直居中；"统计报表计算"竖排压在上部浅色区域（16、半粗、主色） |
| `images/panel-handle-expanded.webp` | 用户给的 `2.svg`（同旧 `panel-handle-expanded.png`），2 倍尺寸 262 × 98，6.4 KB | 展开时的横条 131 × 49，贴在左栏右上角，比面板上边高 8 |

转换方法：Playwright 的 Chromium 按 2 倍尺寸栅格化 SVG，`canvas.toDataURL('image/webp', 0.9)` 编码，保留透明通道。原 SVG 每个约 420 KB（1200 像素宽的 PNG 加一个箭头），不入库。

## 组件样例

`/dev/monitoring-statistics` 渲染正式页面，传入 `createDemoApi()`、独立的查询缓存、总是有效的会话核对和可以切换的角色。2025 年六种报表都可选：基本统计同实测（省、市、县统计完且有失败，区级在处理，汇总统计市级没有任务），本底 2024 年的基本变化省、市级，水路网基本的省级、区县级，水路网变化的区县级已统计完（换别的本底年份就没有任务）；2026 年只有可选项，其他年份没有；提交后 3 秒开始、25 秒统计完。顶栏可以切换接口延迟、开始统计的结果（成功、被拒绝、无响应）、总览失败、状态查询失败、管理员和普通用户。

## 测试

- 纯函数和接口解析按实测的返回写（`api.test.ts` 用 MSW）
- 三个拥有者用假的 `StatisticsApi`；报表和总览的轮询用假定时器推进，包括连续失败停下、跟踪超时
- 组件用假的拥有者（`components/test-owners.ts`）；页面用真实的拥有者和最小的路由，检查初次进入的落点、把手是设计图、提交后收起左栏、去下载
- `MxSplitLayout` 的宽屏收起和 `rail`、`collapse` 插槽在 `libs/ui` 的测试里
