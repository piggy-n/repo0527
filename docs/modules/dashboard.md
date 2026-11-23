# 驾驶舱公共能力（shared/dashboard）

相关决策：ADR 0163；驾驶舱的独立路由和入口见 ADR 0077、0110，原驾驶舱的范围和基线见 [city-dashboard](city-dashboard.md)
对应目录：`apps/yzt/src/shared/dashboard/`

城市体检驾驶舱（`features/city-dashboard`，`/city-dashboard`）和城市国土空间监测综合分析驾驶舱（`features/land-space-dashboard`，`/land-space-analysis`，见 [land-space-dashboard](land-space-dashboard.md)）共用的大屏能力。2026-11-16 从 `features/city-dashboard` 移来：features 之间不能互相导入，第二个驾驶舱要用同一套外壳、筛选、图表、地图和导出。

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
│                         useChartDetail、useChartDownload、
│                         DashboardPlot、ChartCard、ChartActions、ChartDetailDialog、TooltipTable（charts.module.scss）
├─ export/                image-export（标题栏、加标题、保存）、useImageExport（防重复、等字体、取消）
├─ map/                   JiangsuMapScene（Three.js）、fallback（ECharts 二维降级）、DashboardMap、DashboardTimeline、useDashboardMap、
│                         DashboardCompass、DashboardScaleBar、scale-bar、map-view（指北针和比例尺）、
│                         map-export（导出图片的标签、图例和排版）、export-parts、overlay-export（叠加元素画进导出图片）等
└─ tooltip/               useDashboardTooltip、TooltipLayer
```

## 边界

- 依赖 `shared` 里的 `perf`（LoadTrace）、`icons`（SvgIcon，导出图片里的指北针用 `loadIconImage`）、`map/region`（市界几何 `sharedRegionBoundaryLoader`、区划目录 `JIANGSU_CITIES`）、`file-transfer`（保存图片），测试另用 `testing`、`city-indicators`（测试数据）；包和库有 `@mx/ui`、`@mx/utils`、Vue、`@vueuse/core`、ECharts、GSAP、Element Plus，地图另有 three、d3-geo、d3-polygon、`@turf/simplify`、`geographiclib-geodesic`（比例尺的距离，按需动态加载）。不导入任何 feature（`boundaries` 检查）
- `three` 只在 `map/**` 里用：`.oxlintrc.json` 的 three 例外除了 `packages/map-three` 和 `app/`，只放开 `shared/dashboard/map/**`，两个驾驶舱的 feature 和 `shared/dashboard` 的其他目录都不能导入（见 [oxlintrc](../config/oxlintrc.md)）
- 驾驶舱专属的样式只在这里和 feature 里，不改全局 Element 主题；下拉传送到 body 的用组件专属的 popper 类（如 `YearFilter` 的 `yearPopper`）
- 配色：驾驶舱大屏沿用旧版的固定配色（深蓝 `#0e4894`、主蓝 `#438efb` 等），样式里直接写色值、不走全局的颜色令牌，和字体一样是驾驶舱局部的例外（见 [fonts](../design/fonts.md)"驾驶舱局部标题字体"）；新加的样式取驾驶舱已有的色值，不另起一套
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
| `data-card-list` | 右栏卡片列表的容器（由页面写，样式用 `charts.module.scss` 的 `.cardList`） | 只有它里面、首屏可见（`offsetTop` 小于列表高度）的 `data-enter="chart"` 参与入场 |
| `data-enter="chart"` | `ChartCard` | 逐张从右侧滑入，滑到约三分之一时 `revealedCharts` 加一 |
| `data-enter="legend"`、`"timeline"` | 地图图例、时间轴 | 上移、放大淡入 |
| `data-scene="surface" / "wash" / "honeycomb" / "grid" / "haze" / "particles" / "mist" / "orbit" / "frame"` | 背景氛围和地图装饰 | 淡入、缩放、外框描边 |

`map-entering` 阶段这些元素（除 `honeycomb`）都隐藏；`ready` 后时间线还原它们的内联样式。

## 筛选（filters）

| 组件 | props | emits | 说明 |
|---|---|---|---|
| `FilterPanel` | `active`、`compact` | | `<aside aria-label="大屏筛选条件" data-enter="left">`，入场完成前 `inert`；`compact` 在矮屏（宽于 1180px、高不超过 900px）上收紧区块间距、标题、年份框、城市按钮和选项的行高，最后一块的最小高度降到 108px，选项多的页面（综合分析驾驶舱）用，不传时和原来一样 |
| `FilterSection` | `title`、`fill` | | 带彩色标记的标题；`fill` 占满剩余高度、内容在区块里滚动；插槽 `extra` 放在标题右侧 |
| `YearFilter` | `options`、`selected`、`clearable`（默认 true）、`title`（默认"年份选择"） | `change(years)` | 整个区块；Element 多选。`clearable=false` 时没有清空按钮，只剩一个选中的年份时停用它的选项：标签没有关闭按钮，下拉里点不掉，退格也删不掉 |
| `CityFilter` | `cities`、`selected`、`title`（默认"行政区划"） | `toggle(code)`、`set(codes)` | 整个区块；标题右侧"全选 / 清空" |
| `IconOptionList` | `options: { id, name, icon }[]`、`selected` | `select(id)` | 带图标的单选，选中项右侧显示 `dashboard-chevron` |
| `OptionList` | `options: { id, label }[]`、`selected`、`label`（读屏名称）、`resetKey` | `select(id)` | 文字单选；`resetKey` 变化后滚回顶部 |

## 图表（charts）

### 配置

- `createChartOption(input)`：柱状、折线（按城市为横轴、每个年份一个系列，多于三年的柱状按城市堆叠）。`input.color(year)` 给年份系列的颜色，同一指标的卡片、详情、提示要传同一种取色
- `createRadarOption(input)`：以所选城市为轴（从正上方顺时针，名字去掉"市"），每个年份一个半透明的面，均值是一圈虚线（`AVERAGE_COLOR`，名字"{年}均值"）；轴的上界用 `createValueAxisScale` 对全部值和均值算出，和柱图的纵轴一致。提示框按项触发，列出每个城市的值；格式化函数返回元素，城市名和数值写进文本节点，不拼 HTML。城市少于 3 个时画不成雷达，由调用方显示空态。卡片里图例竖排在左上角、雷达居中（半径 66%）：卡片的绘图区不到 140 像素高时，上方居中的图例会碰到最上面的城市名；详情里图例和柱图一样在上方居中
- `chartLegend`、`CHART_FONT_FAMILY`：三种图共用的图例和字体
- `palette.ts`：三组各 6 色、均值色 `AVERAGE_COLOR`；`paletteColor(year, group, latestYear)` 取第 group 组（取模）里 year 的颜色，latestYear 取第一色、往前每年下一色，6 年一循环。原驾驶舱的 `yearColor(year, id)` 是按卡片序号分组的包装
- `runtime.ts` 只注册柱、折线、雷达和网格、图例、雷达坐标、提示框组件

### 组件

- `DashboardPlot`：一个 ECharts 实例，不在视野里、页面隐藏或 `active` 为 false 时释放；`hoverMode="axis"`（默认）按横轴的城市发出 `hover(code)`，左右键逐个城市查看；`"none"`（雷达）不发悬停、左右键不处理，用引擎自己的提示框
- 右栏和卡片列表的布局用 `charts.module.scss` 的 `.column`（外壳网格的 `charts` 区、竖排）和 `.cardList`（占满剩余高度、竖排、间距 12px × `--ui-scale`、定位容器）：`.card` 的高度按这两个间距把列表三等分，入场按卡片的 `offsetTop` 判断首屏，两个驾驶舱都用这两个类，滚动、吸附这类只属于自己的样式另加
- `ChartCard`：卡片外壳 `<article data-chart-id data-enter="chart">`。props：`id`、`title`（默认标题的文字和悬停提示）、`average`（`{ year, text } | null`，null 时写"未选择比较年份"）、`emptyText`（有值时图表区显示空态）、`current`（写 `aria-current`）；插槽：`heading`（默认是不可点击的 h3）、`actions`、`toolbar`（标题行下面，如分项切换栏）、默认插槽（图表）；`class` 透传。自定义 `heading` 时 `title` prop 不再用到：插槽里的标题元素自己写 `title` 属性，并加 `charts.module.scss` 的 `title` 类（`.heading .title` 给出标题的字体、省略号），如原驾驶舱可点击的标题按钮
- `ChartActions`：均值线、图表类型、放大、下载。`types` 只有两种时是一个切换按钮（图标是切换后的类型），三种时是互斥的一组按钮（`aria-pressed`，雷达图标 `dashboard-radar`）；`preference` 传用户的偏好，均值线按钮的读屏文字和点击都按它；`averageDrawable`（默认 true）为 false 时（如堆叠）按钮不显示按下，一般同时用 `averageDisabled` 停用；有 `expandLabel` 才显示放大；emits `preference({ showAverage } | { type })`、`expand`、`download`
- `ChartDetailDialog`：放大详情的 `ElDialog`（`dialog-panel-header` + `MxTitle`"指标图表详情"）。props：`visible`、`title`、`description`（读屏）、`focusText`、`option`（取配置的函数，返回 null 时显示 `emptyText`；弹窗内容渲染时才调用，所以详情配置、图例和尺寸的变化只让弹窗内容重绘，关着的弹窗也不计算）、`cities`、`hoverMode`；插槽 `actions`、`tooltip`（悬停城市时的提示表格，没内容时不留外框）；emits `close`、`hover`、`legend`、`size`（图表区的尺寸，用来排详情里的标签）
- `TooltipTable`：某个城市逐年的值和均值，文本节点显示，不拼 HTML

标题都用 `withUnit(name, unit)`：原驾驶舱的单位都不为空，显示不变；新驾驶舱的指数没有单位，不出现空括号。

### 详情和下载的状态

两个驾驶舱共用，调用方只算图表配置、拼标题：

```tsx
const detail = useChartDetail<Indicator>({
  legend: indicator => model.preference(indicator).legend,
  cities: () => model.cities.value,
  reset: () => model.state.value,
  closeOn: () => model.state.value.categoryId
});
const downloads = useChartDownload();
// 详情配置：detail.target、detail.cityCode（聚焦）、detail.legend、detail.size
<ChartDetailDialog visible={detail.visible.value} focusText={detail.focusText.value} onClose={detail.close}
  onHover={detail.setHover} onLegend={detail.setLegend} onSize={detail.setSize} ... />
downloads.download({ indicator, years, detail: false, option, size: cardPlotSize(list.value, indicator.id) });
```

- `useChartDetail<T>(options)`：放大详情的状态。`T` 是打开的目标，原驾驶舱是指标（`Indicator`），新驾驶舱是卡位（`LandSpaceCardId`：一级 `domain`、二级 `sub`、三级 `indicator`），由调用方按它算详情配置（柱、折线用 `createChartOption`，雷达用 `createRadarOption` 并给弹窗 `hoverMode="none"`）
  - `open(target, cityCode?)`：打开并聚焦城市（地图点城市时传，卡片的放大按钮不传）；把 `options.legend(target)` 复制一份作为详情的图例，之后 `setLegend` 只改这一份，卡片的图例不变，再次打开或换目标时重新复制
  - `close()`：关闭并清掉悬停的城市；目标留着，弹窗淡出时内容不变
  - 状态（只读）：`visible`、`target`、`cityCode`、`focusedCity`、`focusText`（"{城市} · 当前查看城市"，不在 `options.cities()` 里时是"{城市} · 未纳入当前城市筛选"）、`hoveredCity`（详情里悬停的城市，给提示表格）、`legend`、`size`（图表区的尺寸，弹窗量到之前是 `DEFAULT_DETAIL_SIZE` 780×440）；`setHover`、`setLegend`、`setSize` 接弹窗的 `hover`、`legend`、`size`
  - `options.reset` 变化时清掉悬停的城市（筛选状态），`options.closeOn` 变化时关闭（原驾驶舱切换指标类型）；都可以不传
- `useChartDownload()`：图表下载，内部用 `useImageExport`
  - `download({ indicator, years, detail, option, size })`：等字体，用 `renderChartImage` 按点击时的配置另画一张（像素比 2），`imageWithTitle` 加标题 `withUnit(名称, 单位)`，保存为「{years 用 - 连接}-{名称}」，`detail` 为 true 时末尾加「-详情」；`option` 为空时什么也不做。原驾驶舱的 years 是比较年份（如 `2025-2026-…`），新驾驶舱固定 `[2025]`
  - `size`：卡片用 `cardPlotSize(list, id)`（列表里 `data-chart-id` 为 id 的卡片中 `[role="img"]` 绘图区的尺寸，找不到时 420×240），详情用 `detail.size`
  - `pending(id, detail)`：这张图正在下载，下载按钮据此停用；同一指标的卡片和详情分别计，进行中再点无效
  - `error`：失败的原因（显示在 `role="alert"` 里），下次下载时清空；卸载后进行中的下载不再保存，也不报错

## 地图（map）

```tsx
<DashboardMap indicator={...} title={...} values={...} classification={...} years={...} activeYear={...}
  showValues={false} notice="原报告未列指数值" onYear={...} onHover={...} onDetail={...} onSettled={...}>
  {{
    default: renderTooltip,
    topRight: (view: MapView | null) => [<DashboardCompass rotation={view?.northDegrees ?? 0} />],
    bottomRight: ({ view, maxWidth }: MapCornerScope) =>
      view ? [<DashboardScaleBar metersPerPixel={view.metersPerPixel} maxWidth={maxWidth} />] : []
  }}
</DashboardMap>
```

- props：`indicator`、`title`（调用方拼好，如"2026年江苏省…分布图（%）"或"请选择年份"）、`values`（市编码 → 值）、`classification`、`years`（时间轴，从旧到新）、`activeYear`、`showValues`（默认 true）、`notice`、`forceFallback`、`reducedMotion`、`active`、`valuesVisible`
- emits：`hover(code)`、`detail(code)`、`settled`（就绪或失败，交给 `entrance.mapSettled`）、`year(year)`（时间轴）
- `showValues=false`：三维标签只有名称（`aria-label`"{城市}，查看详情"），避让按一行名称的高度算（`layoutMapLabels` 的第四个参数），二维降级的标签只写名称，导出图片只画名称、画在标签中心（`drawMapLabels(snapshot, indicator, false)`），过渡中不逐帧更新显示的数值。标签的避让在场景发布位置时算，`showValues` 按页面固定，中途切换要等下一次相机或尺寸变化才重排
- `notice`：标题下方居中的状态提示（`role="status"`，跟标题一起入场）
- 图例：`classification` 没有档位（没有一个城市有值）时不显示图例框
- 导出文件名 `江苏省-{年}-{指标名}`，图片见下面的"导出图片"
- 三维失败或 WebGL 丢失时用同一份市界降为 ECharts 二维（"地图采用简化显示"）

### 导出图片

标题栏右侧的下载按钮把地图存成 PNG（`map-export.ts` 的 `mapImage`，像素是 CSS 尺寸的 2 倍），版式 2026-11-23 用户选定：

- 上面是标题栏（标题按宽度换行，同图表的导出），有右上角的叠加元素（指北针）时放在标题栏右侧、垂直居中，48 × 48，标题两侧都让出它的宽度、仍在整幅宽度上居中
- 中间是地图像素和城市标签（`drawMapLabels`），宽度就是地图的宽度
- 下面是底栏，不压地图：图例在左（与页面上的图例同样的框、色块和文字，取 `--ui-scale` 为 1 时的尺寸），右下角的叠加元素（比例尺）在右、底边对齐，至多 220 像素宽，放不下时不画；底栏高度是两者里高的那个加上下各 12 像素。没有图例也没有右下角元素时没有底栏，和原来的导出相同（如原驾驶舱没有数据时）
- 时间轴、提示、"地图采用简化显示"、`notice` 和页面上的装饰底纹不进图片

角上的叠加元素自己负责画进图片：`MapCorner` 用 `provideExportParts` 收集放在里面的元素，元素在 setup 里调 `useExportPart(capture)` 登记、卸载时撤销（`export-parts.ts`），所以页面上放了什么，图片里就有什么，调用方不用另外传开关。`capture` 在点下载时同步调用、取当时的 props，返回 `ExportPart`（可以是 Promise，如指北针要解码图标）；字体就绪后按留给它的宽高 `layout`，放不下时返回 null。`DashboardCompass` 和 `DashboardScaleBar` 的画法在 `overlay-export.ts`：指北针把 `dashboard-compass-color` 解码成图片（`shared/icons` 的 `loadIconImage`），按点下载时的 `rotation` 转，带页面上同样的圆形投影；比例尺用 `scaleBar()` 和画布实测的文字宽度按底栏里的宽度重新选长度（可能和页面上的长度不同，比例相同），刻度、单位、色带的样式同页面。

截图时场景会按当前相机和尺寸重画一次（`capture()` 先 `resize()` 再 `render()`），朝向和比例可能在这一刻才变，而角上的内容要等 Vue 下一次更新才拿到新的 `view`：所以截图后先 `await nextTick()` 让角上的内容重绘，再调各个 `capture`，图片里的指北针、比例尺和地图像素是同一刻的（`map-overlay.browser.test.tsx` 里地图变矮后紧接着下载的用例，去掉这一步时取到的是变矮前的比例）。

### 指北针和比例尺（角上的叠加插槽）

两个具名插槽，各对应地图上的一个位置；`view` 是 `MapView`：`northDegrees`（"北"相对屏幕上方的顺时针角度）、`metersPerPixel`（画布中心附近一个 CSS 像素代表的米数），还没算出来或算不出来时是 null：

| 插槽 | 参数 | 位置 |
|---|---|---|
| `topRight` | `view` | 右上角、和地图标题同一行：52 × 52（乘 `--ui-scale`，≤720px 时 36 × 36，和窄屏的标题行等高）的方块，和标题行垂直居中，可以比标题行高、上下各伸出一半：单行标题时 1920×1080 下基本等高（52 对 51.5px），721～1180px 宽时约高 6px，2560×1440 约高 7px，3840×2160 约高 17px；标题右侧让出这个方块，"地图采用简化显示"移到标题行下面 |
| `bottomRight` | `{ view, maxWidth }` | 右下角、时间轴右侧的空位：宽度按时间轴的宽度用 CSS 算（至多 220px × `--ui-scale`），`maxWidth` 是 ResizeObserver 量到的这个宽度；高度为 0、内容从底边向上伸出，量宽度时不会因为放进比例尺再触发一轮。≤720px 时时间轴占满宽度，这里放到图例上方右侧（按量到的图例高度） |

- 两个位置都写 `data-enter="legend"`，跟图例、时间轴一起入场；入场的变换写在位置的盒子上，指北针的旋转只写在里面的 `<svg>` 上，互不覆盖。不用这两个插槽时地图外壳的 DOM、类名和样式与原来相同
- 插槽内容放在一个单独的小组件里渲染：拖动、入场时朝向逐帧变化，只重绘角上的内容，不重绘整个地图外壳
- `DashboardCompass`：`rotation`（度，传 `northDegrees`），多色图标 `dashboard-compass-color`（针心在 viewBox 中心，转 `<svg>` 就是绕针心转），`role="img"`、`aria-label`"指北针"，填满所在的方块
- `DashboardScaleBar`：`metersPerPixel`、`maxWidth`。`scale-bar.ts` 的 `scaleBar()` 从 1、2、4、5、8、10、20、40、50、80、100、120、160、200、400 千米里选整体宽度不超过 `maxWidth` 的最长总长度 L（整体宽度算上两端伸出去的刻度文字和单位，文字宽按字号估：数字 0.6 个字宽、汉字 1 个），1 千米都放不下时同样的数改用米；分四段，深蓝、白交替，刻度 0、L/4、L/2、3L/4、L，相邻文字放不下时只写 0、L/2、L，再放不下只写两端；末尾写"千米"或"米"。字号 `max(12px, 14px × --ui-scale)`，量单位的宽度时读一次实际字号。1920×1080 下约是"0 20 40 60 80 千米"，1366×768、1280×720 下约是"0 20 40 千米"
- 只有用了这两个插槽中的一个，`useDashboardMap` 才算朝向和比例（`trackView`，每次加载地图时读一次），换算模块 `map-view.ts`（带着 `geographiclib-geodesic`）也只在这时和市界一起动态加载，原驾驶舱的分块里没有它；加载失败时 `view` 一直是 null，地图照常显示：
  - 三维：场景的 `SceneCallbacks.onView` 在相机、尺寸或地图厚度变化时（与标签同一次渲染，扫光、悬停不发）给出 `SceneView`：`north` 是地图中心顶面一点和它往北（形状坐标 +y）一点投影到屏幕后的顺时针角；`sample` 是画布中心水平线上相距 100 CSS 像素的两点用射线打到顶面、换回 `mapGroup` 的形状坐标。不传 `onView` 时场景不做这些计算
  - 换算（`map-view.ts`）：`DashboardRegions.unproject(x, y)` 把形状坐标反算回经纬度（`prepareRegions` 的墨卡托投影、缩放和中心），`geographiclib-geodesic`（直接导入，不经 `@mx/map-core` 的入口）量两点的椭球面距离，除以 100 得到每像素米数。静止视角（yaw 0、pitch 0.76）正北朝上，指北针不转；拖动改变 yaw 后跟着转
  - 二维降级：`northDegrees` 为 0；比例用 ECharts 的 `convertToPixel` 量中心纬度上相距 0.5° 的两点在图上的距离，创建和缩放后各量一次
- 三维的比例是画布中心附近的，透视下近处（下方）比远处大；指北针的角度也取地图中心

## 提示（tooltip）

`useDashboardTooltip({ reset, visibility })` 只管提示的目标（来源、指标 ID、城市编码）和延迟关闭，`reset` 变化、页面隐藏、窗口缩放、外层滚动时关闭；指标和城市由调用方按目标解析。`TooltipLayer` 是外层（`data-dashboard-tooltip`，贴在地图标题下方右侧）加 `TooltipTable`，emits `keepOpen`、`leave`，作为 `DashboardMap` 的默认插槽。

## 两个驾驶舱的组合

| | 城市体检驾驶舱 | 城市国土空间监测综合分析驾驶舱 |
|---|---|---|
| 外壳 | `DashboardShell`，标题"江苏省城市国土空间监测驾驶舱"，`traceName="city-dashboard"` | 标题"江苏省城市国土空间监测综合分析"，`traceName="land-space-dashboard"`；窄屏右栏行高 `--dashboard-charts-row: 880px` |
| 左栏 | `YearFilter`、`CityFilter`、指标类型 `IconOptionList`、具体指标 `OptionList(fill)` | `YearFilter`（只有 2025，`clearable=false`）、`CityFilter`、一级指标 `IconOptionList`（六个一级图标）、二级指标 `OptionList(fill)` |
| 地图 | 当前指标、写数值 | 当前二级指标、`showValues=false`、无指数值时 `notice`，`topRight` 放指北针、`bottomRight` 放比例尺 |
| 右栏 | 当前指标类型的全部卡片，翻卡导航、`.selected`、可点击标题、预热 | 固定三张 `ChartCard`（一级、二级、三级），等分高度、矮屏按最小高度滚动；二级默认雷达（`hoverMode="none"`）；三级标题是 `ElDropdown`、`toolbar` 放分项栏；预热一级和二级的图 |
| 详情和下载 | `useChartDetail<Indicator>`（切换指标类型时关闭）、`useChartDownload`，文件名「{比较年份}-{指标名}[-详情]」 | `useChartDetail<LandSpaceCardId>` 以卡位为目标，地图点城市打开二级卡的详情并聚焦该城市；文件名「2025-{指标名}[-详情]」，三级有分项时指标名是「三级名 · 分项名」 |
| 提示 | `TooltipLayer` | 同；提示目标的 `indicatorId` 是卡位，地图悬停对应二级卡 |

原驾驶舱的 `DashboardView` 组合外壳和三栏，`DashboardFilters`、`DashboardCharts` 组合筛选单元和图表单元；翻卡导航（`useCardNavigation`）、`.selected`、卡片吸附只在原驾驶舱。综合分析驾驶舱的 `LandSpaceView` 组合外壳、筛选单元和地图，`LandSpaceCharts` 组合三张卡，见 [land-space-dashboard](land-space-dashboard.md)。

## 测试

- 纯逻辑：`calculations`、`map-classification`、`format`、`charts/radar-options`（提示框要建元素，用 jsdom；卡片和详情的图例位置）、`detail-labels`、`palette`、`charts/useChartDetail`、`charts/useChartDownload`（jsdom，出图和保存换成假函数）、`map/map-export`（标签、导出图片的排版和图例）、`map/overlay-export`（导出图片里的比例尺）、`map/config`、`map/geometry`（市界、标签避让、形状坐标反算）、`map/scale-bar`、`map/map-view` 等
- 组件（jsdom）：`ChartActions`、`ChartCard`、`ChartDetailDialog`、`DashboardPlot` 的键盘与悬停方式、`filters`、`DashboardShell`、`DashboardTimeline`、`DashboardCompass`（旋转只写在 svg 上）、`useDashboardTooltip`
- 浏览器：`map/map.browser.test.tsx`（真实三维和二维降级，含不显示数值）、`map/map-overlay.browser.test.tsx`（静止视角正北、指北针的角度跟着拖动变、二维降级正北、每像素米数的范围、不用角上插槽时不取样，1920×1080、1366×768、1280×720 和 ≤720 的地图尺寸下指北针、比例尺与标题、时间轴、图例不重叠，入场停下后指北针不转，下载的图片底栏有每档图例的色块和比例尺、标题栏右侧有指北针，比例按截图那一刻的地图尺寸算）、`charts/radar-options.browser.test.tsx`（雷达在真实引擎里）、`charts/warm-up.browser.test.ts`；原驾驶舱的 `DashboardEntrance`、`DashboardCharts` 和综合分析驾驶舱的 `LandSpaceView` 浏览器测试覆盖外壳和筛选、图表、地图的组合
- 原驾驶舱的回归：拆分前后用同一段临时测试把 96 个指标的卡片和详情配置、地图图例写成 JSON，逐字节比较（生成写法在 `local/land-space/baseline-generator.test.ts.txt`，不入库）
