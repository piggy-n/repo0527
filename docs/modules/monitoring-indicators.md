# 城市国土空间监测指标

按年份和监测范围计算城市体检评估、综合分析两类指标，查看计算进度，再选一个算完的指标看计算结果和成果图层。决策见 [ADR 0098](../adr/0098-space-monitoring-indicators.md)；旧代码与真实接口的核对见 [migration.md](../migration.md)"城市国土空间监测指标：接口实测"，和旧页面的差异见同一文档的"与旧页面的差异"。

## 分层

```
features/monitoring-indicators/
├─ api.ts                     IndicatorApi（指标树、处理前验证、开始计算、进度、成果）与真实实现 indicatorApi
├─ queries.ts                 指标树、成果的查询；结果标上请求的条件或 ID
├─ indicator-tree.ts          指标树的类型、去重、搜索（纯函数）
├─ calculation.ts             计算任务的类型、状态文字、进度行（纯函数）
├─ result-layers.ts           成果子图层的默认色和顺序，成果分组的推导（纯函数）
├─ composables/
│  ├─ useIndicatorConditions  年份、监测范围
│  ├─ useIndicatorTree        一棵指标树的页签、加载、选择
│  ├─ useIndicatorCalculation 一次计算：验证、确认、提交、查进度
│  └─ useIndicatorResult      选中指标的成果、子图层显隐与改色、定位
└─ components/
   ├─ IndicatorPanel          左侧面板：页签、计算设置、两棵树、重置与开始计算
   ├─ IndicatorTree           分类页签、搜索、全选、指标的状态或结果
   ├─ CalculationProgressPanel 数据处理进度（地图底部）
   └─ IndicatorResultPanel    指标成果（地图右上）：计算结果、行政区、子图层与取色
pages/space-monitoring-indicators/  页面：地图、拥有者、样式绑定、面板的位置和窄屏取舍
pages/dev/monitoring-indicators/    组件样例：正式页面换上固定数据的接口（demo-api.ts）
```

页面之外不依赖这个 feature；底图、行政区、视图控件、底图卡片都用 `shared/map` 的现有能力，没有改动它们。

## 数据从哪里来

| 内容 | 接口 | 持有者 |
|---|---|---|
| 计算树 | `GET /api/analysis/tree/list`（全部指标，带计算状态和结果） | 查询缓存，`useIndicatorTree` 只记选中的编码 |
| 展示树 | `GET /api/analysis/tree/out`（只有算完的，带成果的记录 ID） | 同上 |
| 是否已有结果 | `POST /api/analysis/verify` | `useIndicatorCalculation` 用来决定确认框的文字 |
| 开始计算 | `POST /api/analysis/calculate` | 写操作，按 `useSessionGuard` 核对会话 |
| 进度 | `GET /api/analysis/progress` | `useIndicatorCalculation` 的任务 |
| 成果 | `GET /api/analysis/indicate?id=` | 查询缓存，结果标上 ID |
| 成果图层 | `GET /api/analysis/mvt/{id}/{gdbName}/{z}/{x}/{y}.pbf` | MapLibre；地址由 `resultTileBase` 拼成绝对地址 |

开始计算、验证、查进度共用 `{ year, regionCode, analysisCode }`，`analysisCode` 是按勾选先后用逗号连接的指标编码，查进度时要和开始计算时一致。

## 选择

- 计算树多选，切换"城市体检评估 / 综合分析指标"后原来的勾选还在，一起提交；全选只选当前页签里可选的
- 展示树每个页签各选一个，面板只看当前页签的；换年份或监测范围后清空。页面在切换"指标计算 / 指标展示"时也清空展示树，回到展示页签要重新选（同旧页面）
- 树刷新后，当前页签里已经不在、变成禁用的指标取消选择，其余换成新的记录（状态、结果会变）

## 计算任务

`task` 的阶段：`creating`（正在提交）→ `starting`（已提交，等 3 秒）→ `running`（每 5 秒查一次）→ `finished`；提交失败是 `failed`，进度连续失败 3 次是 `stalled`。`busy` 在验证、确认和前三个阶段为真，期间不能再开始。

- 没有选年份、范围或指标，或计算进行中时，"开始计算"不可用，悬停说明原因
- 进度返回 `null` 时保留上一次的接着查；`ratio` 到 100 就停
- `stalled` 时进度面板提示一次，标题栏出现"重新获取进度"，调用 `retryProgress` 马上再查
- 重置回到默认条件，清掉两棵树的选择和任务；已经提交的计算不会撤回
- 窄屏（小于 1200）时进度面板和指标面板只显示最后操作的一边：开始计算时指标面板收成竖条，展开指标面板时进度隐藏

## 成果图层

`indicatorResultGroup(display, tileBase)` 是纯函数：没有成果时是空分组；有成果时每个子图层一个数据源、ID 以 `indicator-result-` 开头，从下到上是区划范围、面、线、点。`useIndicatorResult.deriveGroup` 把显隐和颜色（包括正在拖动的预览）交给它，页面把它绑定到 `RESULT_GROUP`。

- 默认色沿用旧页面：区划范围 `#EDF4BE`；线和面先按名称里的关键字（路网、已覆盖、未覆盖、覆盖范围）取色，再按序号取色板；多个点图层按出现顺序取点的色板
- 一个点图层画旗子（`indicator-result-flag`，第一次用到时画），不能改色；面板里画同样的旗子
- 改色先比较颜色值（取色器给 `rgb()`，默认色是 `#RRGGBB`）：确认的颜色等于默认色时算恢复默认

## 组件样例

`/dev/monitoring-indicators` 渲染正式的 `SpaceMonitoringIndicatorsPage`，传入 `createDemoApi()` 的接口和总是有效的会话核对，外面包一层独立的查询缓存。顶栏可以切换接口延迟（0、500、2000 毫秒）和指标树失败、指标树为空、进度查询失败、成果加载失败；第 i 个提交的指标在开始后 6 + 5i 秒算完，名字带"避难"的失败并写回计算树。样例的成果没有瓦片数据，地图上只有定位。

## 测试

- 纯函数和接口解析按实测的返回写用例（`api.test.ts` 用 MSW）
- 三个拥有者用假的 `IndicatorApi`：计算任务用假定时器推进；成果用假的相机操作和边界加载器
- 组件测试只看显示和调用：面板的开始计算与确认框、卸载时关闭确认框、重置、搜索与全选；成果面板和进度面板用假的拥有者
