# 驾驶舱公共能力（shared/dashboard）

相关决策：ADR 0163；驾驶舱的独立路由和入口见 ADR 0077、0110，原驾驶舱的范围和基线见 [city-dashboard](city-dashboard.md)
对应目录：`apps/yzt/src/shared/dashboard/`

城市体检驾驶舱（`features/city-dashboard`，`/city-dashboard`）和城市国土空间监测综合分析驾驶舱（`features/land-space-dashboard`，`/land-space-analysis`，开发中）共用的大屏能力。2026-11-16 从 `features/city-dashboard` 移来：features 之间不能互相导入，第二个驾驶舱要用同一套外壳、筛选、图表、地图和导出。

这里只放"大屏怎么显示"：外壳与入场、筛选控件、图表、立体地图、提示、导出图片。指标目录、数据、筛选状态和偏好留在各自的 feature（原驾驶舱是 `useDashboard`），组件通过 props 拿到要显示的东西、通过 emits 交回用户的操作。

## 目录

```
shared/dashboard/
├─ model.ts               City、Comparison、ChartHover、DashboardData、IndicatorMeta、ChartType、CartesianChartType、ChartPreference
├─ cities.ts              DASHBOARD_CITIES：13 个市的编码、名称、标签锚点
├─ calculations.ts        compareIndicator（逐年的城市值和算术平均）、formatValue、isValue、niceStep 等
├─ map-classification.ts  地图分档（createMapClassification）
├─ format.ts              withUnit(name, unit)：`名称（单位）`，单位为空时只写名称
├─ animation/             timeline-clock（只在页面可见时推进的时间线）、decode-images（入场前预解码大图）
├─ assets/                bg.webp、header-skyline.webp、mapbg.webp
├─ shell/                 DashboardShell、DashboardAtmosphere、DashboardFonts.module.scss、useDashboardEntrance
├─ filters/               FilterPanel、FilterSection、YearFilter、CityFilter、IconOptionList、OptionList（filters.module.scss）
├─ charts/                runtime、options、radar-options、axis-scale、palette、detail-labels、warm-up、chart-export、useChartFonts、
│                         DashboardPlot、ChartCard、ChartActions、ChartDetailDialog、TooltipTable（charts.module.scss）
├─ export/                image-export（加标题、保存）、useImageExport（防重复、等字体、取消）
├─ map/                   JiangsuMapScene（Three.js）、fallback（ECharts 二维降级）、DashboardMap、DashboardTimeline、useDashboardMap 等
└─ tooltip/               useDashboardTooltip、TooltipLayer
```

## 边界

- 只依赖 `shared` 里的 `perf`（LoadTrace）、`icons`（SvgIcon）、`testing`（测试）和 `@mx/*`、ECharts、GSAP、Element Plus；不导入任何 feature（`boundaries` 检查）。测试数据可以取 `shared/city-indicators`
- `three` 只在 `map/**` 里用：`.oxlintrc.json` 的 three 例外只放开 `features/city-dashboard/**` 和 `shared/dashboard/map/**`（见 [oxlintrc](../config/oxlintrc.md)）
- 驾驶舱专属的样式只在这里和 feature 里，不改全局 Element 主题；下拉传送到 body 的用组件专属的 popper 类（如 `YearFilter` 的 `yearPopper`）
- 单元内部用相对路径，feature 用 `@/shared/dashboard/...` 导入
- 入场的约束（中途不做几十毫秒的事、逐帧变换的层加 `will-change`、装饰动画只变换 HTML 盒子或外层 `<svg>`）同样适用，见 `.claude/rules/city-dashboard.md` 和 city-dashboard.md 的"入场卡顿"

## 外壳（shell）

```tsx
<DashboardShell title="江苏省城市国土空间监测驾驶舱" traceName="city-dashboard" reducedMotion={props.reducedMotion} onEscape={tooltip.close}>
  {{ default: ({ entrance, density }: DashboardShellScope) => [<左栏 />, <地图 />, <右栏 />] }}
</DashboardShell>
```

- `DashboardShell`：根 `<main>`（字体作用域、`--ui-scale`、`data-dashboard-phase`、`aria-busy`、`data-suspended`、`data-reduced`）、背景氛围、标题栏、三栏的 `.content`，挂载时预解码三张背景
  - props：`title`（h1）、`traceName`、`reducedMotion`
  - emits：`escape`（在大屏里按 Esc，调用方用来关提示）
  - 默认插槽的参数 `{ entrance, density }`（TSX 里手动标注 `DashboardShellScope`）：`entrance` 是入场状态，`density` 是按 1920×1080 算的界面缩放（0.9～1.8），传给图表
  - 窄屏（≤1180px）右栏所在行的高度是 `var(--dashboard-charts-row, 760px)`，≤720px 是 `var(--dashboard-charts-row, 440px)`；页面要更高的右栏时在外壳的 `class` 或 `style` 上覆盖这个变量
- `useDashboardEntrance(shell, reduce, { traceName })`：入场编排，外壳内部调用。返回 `phase`（`map-entering` → `panels-entering` → `ready`）、`reduced`、`valuesVisible`（地图数值从 0 过渡到真实值的时机）、`revealedCharts`（已入场的卡片数，之前的卡片不画图）、`mapSettled()`（地图就绪或降级时调用，只开始一次）
- `traceName` 是 LoadTrace 的名称（`<名称>:start`、`<名称>:map`、`<名称>:ready`），实测工具按它找：原驾驶舱是 `city-dashboard`（`tools/measure-city-dashboard` 依赖它），新驾驶舱是 `land-space-dashboard`

### 入场选择器约定

入场时间线按下面的属性找元素，组件改结构时保留它们：

| 属性 | 谁写 | 入场 |
|---|---|---|
| `data-enter="title"`、`"title-text"` | 外壳的标题栏和 h1 | 从上方展开，标题下的光线 `--title-rule` 从 0 到 1 |
| `data-enter="map-title"` | 地图标题、地图上的状态提示（`notice`） | 下移、横向展开 |
| `data-enter="left"` | `FilterPanel` | 从左侧滑入 |
| `data-filter-group` | `FilterSection` | 逐块错开淡入 |
| `data-card-list` | 右栏卡片列表的容器（由页面写） | 只有它里面、首屏可见的 `data-enter="chart"` 参与入场 |
| `data-enter="chart"` | `ChartCard` | 逐张从右侧滑入，滑到约三分之一时 `revealedCharts` 加一 |
| `data-enter="legend"`、`"timeline"` | 地图图例、时间轴 | 上移、放大淡入 |
| `data-scene="surface" / "wash" / "honeycomb" / "grid" / "haze" / "particles" / "mist" / "orbit" / "frame"` | 背景氛围和地图装饰 | 淡入、缩放、外框描边 |

`map-entering` 阶段这些元素（除 `honeycomb`）都隐藏；`ready` 后时间线还原它们的内联样式。

## 筛选（filters）

| 组件 | props | emits | 说明 |
|---|---|---|---|
| `FilterPanel` | `active` | | `<aside aria-label="大屏筛选条件" data-enter="left">`，入场完成前 `inert` |
| `FilterSection` | `title`、`fill` | | 带彩色标记的标题；`fill` 占满剩余高度、内容在区块里滚动；插槽 `extra` 放在标题右侧 |
| `YearFilter` | `options`、`selected`、`clearable`（默认 true）、`title`（默认"年份选择"） | `change(years)` | 整个区块；Element 多选 |
| `CityFilter` | `cities`、`selected`、`title`（默认"行政区划"） | `toggle(code)`、`set(codes)` | 整个区块；标题右侧"全选 / 清空" |
| `IconOptionList` | `options: { id, name, icon }[]`、`selected` | `select(id)` | 带图标的单选，选中项右侧显示 `dashboard-chevron` |
| `OptionList` | `options: { id, label }[]`、`selected`、`label`（读屏名称）、`resetKey` | `select(id)` | 文字单选；`resetKey` 变化后滚回顶部 |

## 图表（charts）

### 配置

- `createChartOption(input)`：柱状、折线（按城市为横轴、每个年份一个系列，多于三年的柱状按城市堆叠）。`input.color(year)` 给年份系列的颜色，同一指标的卡片、详情、提示要传同一种取色
- `createRadarOption(input)`：以所选城市为轴（从正上方顺时针，名字去掉"市"），每个年份一个半透明的面，均值是一圈虚线（`AVERAGE_COLOR`，名字"{年}均值"）；轴的上界用 `createValueAxisScale` 对全部值和均值算出，和柱图的纵轴一致。提示框按项触发，列出每个城市的值（只拼城市名和数字）。城市少于 `RADAR_MIN_CITIES`（3）个时调用方显示空态，不画
- `chartLegend`、`CHART_FONT_FAMILY`：三种图共用的图例和字体
- `palette.ts`：三组各 6 色（`PALETTES`）、均值色；`paletteColor(year, group, latestYear)` 取第 group 组里 year 的颜色，latestYear 取第一色、往前每年下一色。原驾驶舱的 `yearColor(year, id)` 是按卡片序号分组的包装
- `runtime.ts` 只注册柱、折线、雷达和网格、图例、雷达坐标、提示框组件

### 组件

- `DashboardPlot`：一个 ECharts 实例，不在视野里、页面隐藏或 `active` 为 false 时释放；`hoverMode="axis"`（默认）按横轴的城市发出 `hover(code)`，左右键逐个城市查看；`"none"`（雷达）不发悬停、左右键不处理，用引擎自己的提示框
- `ChartCard`：卡片外壳 `<article data-chart-id data-enter="chart">`。props：`id`、`title`（悬停显示）、`average`（`{ year, text } | null`，null 时写"未选择比较年份"）、`emptyText`（有值时图表区显示空态）、`current`（写 `aria-current`）；插槽：`heading`（默认是不可点击的 h3）、`actions`、`toolbar`（标题行下面，如分项切换栏）、默认插槽（图表）；`class` 透传
- `ChartActions`：均值线、图表类型、放大、下载。`types` 只有两种时是一个切换按钮（图标是切换后的类型），三种时是互斥的一组按钮（`aria-pressed`，雷达图标 `dashboard-radar`）；`preference.showAverage` 传显示中的状态（画不出均值线时传 false 并禁用）；有 `expandLabel` 才显示放大；emits `preference({ showAverage } | { type })`、`expand`、`download`
- `ChartDetailDialog`：放大详情的 `ElDialog`（`dialog-panel-header` + `MxTitle`"指标图表详情"）。props：`visible`、`title`、`description`（读屏）、`focusText`、`option`（null 时显示 `emptyText`）、`cities`、`hoverMode`；插槽 `actions`、`tooltip`（悬停城市时的提示表格，没内容时不留外框）；emits `close`、`hover`、`legend`、`size`（图表区的尺寸，用来排详情里的标签）
- `TooltipTable`：某个城市逐年的值和均值，文本节点显示，不拼 HTML

标题都用 `withUnit(name, unit)`：原驾驶舱的单位都不为空，显示不变；新驾驶舱的指数没有单位，不出现空括号。

## 地图（map）

```tsx
<DashboardMap indicator={...} title={...} values={...} classification={...} years={...} activeYear={...}
  showValues={false} notice="原报告未列指数值" onYear={...} onHover={...} onDetail={...} onSettled={...}>
  {{ default: renderTooltip, overlay: (view: MapView | null) => <指北针和比例尺 /> }}
</DashboardMap>
```

- props：`indicator`、`title`（调用方拼好，如"2026年江苏省…分布图（%）"或"请选择年份"）、`values`（市编码 → 值）、`classification`、`years`（时间轴，从旧到新）、`activeYear`、`showValues`（默认 true）、`notice`、`forceFallback`、`reducedMotion`、`active`、`valuesVisible`
- emits：`hover(code)`、`detail(code)`、`settled`（就绪或失败，交给 `entrance.mapSettled`）、`year(year)`（时间轴）
- `showValues=false`：三维标签只有名称（`aria-label`"{城市}，查看详情"），二维降级的标签只写名称（`fallbackLabel`），导出图片只画名称、画在标签中心（`drawMapLabels(snapshot, indicator, false)`），过渡中不逐帧更新显示的数值
- `notice`：标题下方居中的状态提示（`role="status"`，跟标题一起入场）
- 插槽 `overlay(view)`：指北针、比例尺这类叠加元素，`view` 是 `MapView`（`northDegrees`、`metersPerPixel`）；场景还没算这两项，目前一直传 null
- 导出文件名 `江苏省-{年}-{指标名}`，导出图片不含图例、时间轴和叠加元素
- 三维失败或 WebGL 丢失时用同一份市界降为 ECharts 二维（"地图采用简化显示"）

## 提示（tooltip）

`useDashboardTooltip({ reset, visibility })` 只管提示的目标（来源、指标 ID、城市编码）和延迟关闭，`reset` 变化、页面隐藏、窗口缩放、外层滚动时关闭；指标和城市由调用方按目标解析。`TooltipLayer` 是外层（`data-dashboard-tooltip`，贴在地图标题下方右侧）加 `TooltipTable`，emits `keepOpen`、`leave`，作为 `DashboardMap` 的默认插槽。

## 两个驾驶舱的组合

| | 城市体检驾驶舱 | 城市国土空间监测综合分析（按规格，开发中） |
|---|---|---|
| 外壳 | `DashboardShell`，标题"江苏省城市国土空间监测驾驶舱"，`traceName="city-dashboard"` | 标题"江苏省城市国土空间监测综合分析"，`traceName="land-space-dashboard"` |
| 左栏 | `YearFilter`、`CityFilter`、指标类型 `IconOptionList`、具体指标 `OptionList(fill)` | 年份只有 2025（不能清空）、`CityFilter`、一级指标 `IconOptionList`、二级指标 `OptionList(fill)` |
| 地图 | 当前指标、写数值 | 当前二级指标、`showValues=false`、无指数值时 `notice`，`overlay` 放指北针和比例尺 |
| 右栏 | 当前指标类型的全部卡片，翻卡导航、`.selected`、可点击标题、预热 | 固定三张 `ChartCard`（一级、二级、三级），二级默认雷达（`hoverMode="none"`），三级标题是下拉框、`toolbar` 放分项栏 |
| 提示 | `TooltipLayer` | 同 |

原驾驶舱的 `DashboardView` 组合外壳和三栏，`DashboardFilters`、`DashboardCharts` 组合筛选单元和图表单元；翻卡导航（`useCardNavigation`）、`.selected`、卡片吸附只在原驾驶舱。

## 测试

- 纯逻辑：`calculations`、`map-classification`、`format`、`charts/radar-options`、`detail-labels`、`palette`（经原驾驶舱的 `colors.test`）、`map/map-export`、`map/config` 等
- 组件（jsdom）：`ChartActions`、`ChartCard`、`ChartDetailDialog`、`DashboardPlot` 的键盘与悬停方式、`filters`、`DashboardShell`、`DashboardTimeline`、`useDashboardTooltip`
- 浏览器：`map/map.browser.test.tsx`（真实三维和二维降级，含不显示数值）、`charts/radar-options.browser.test.tsx`（雷达在真实引擎里）、`charts/warm-up.browser.test.ts`；原驾驶舱的 `DashboardEntrance`、`DashboardCharts` 浏览器测试覆盖外壳和筛选、图表的组合
- 原驾驶舱的回归：拆分前后用同一段临时测试把 96 个指标的卡片和详情配置、地图图例写成 JSON，逐字节比较（生成写法在 `local/land-space/baseline-generator.test.ts.txt`，不入库）
