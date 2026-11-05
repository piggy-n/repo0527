# 0145. 地图的通用交互拆成 @mx/map-tools

- 状态：已接受
- 日期：2026-11-05
- 修改：ADR 0027 第 1 节（通用交互不再放在 `shared/map`）、ADR 0035 第 3、4 节的位置；落实 ADR 0143 第 7 条待办的一部分

## 背景

`apps/yzt/src/shared/map` 约 8800 行，分四类：通用交互（绘制、逐点编辑、测量、框选手势、鼠标旁的提示）、通用界面（工具栏、面板）、半通用（`location`、`area` 混着江苏的内容）、江苏专属（`region`、`basemap`、`boundary`）。以后放在 `apps/` 下的地图项目要复用通用的部分；放在 `shared/map` 里只能靠自觉不让业务混进去。用户 2026-11-05 确认：现在只拆通用交互约 1850 行，其余等第二个地图项目明确后再说。

## 候选方案

| 问题 | 候选 | 选择与理由 |
|---|---|---|
| 拆多少 | 只拆通用交互；连工具栏、面板一起拆；整个 `shared/map` | 只拆通用交互：工具栏、面板依赖 Element 和 `SvgIcon`，要先知道第二个项目的界面才知道接口该怎么留（ADR 0027 第 6 条）；`location`、`area` 混着江苏的内容，整个拆会把业务带进包 |
| `usePageActive`、`useShownElementSize` 放哪 | `@mx/map-vue`；新建 `@mx/vue-utils`；`@mx/ui`；`@mx/utils` | `@mx/map-vue`：现在 17 个使用它们的文件都在地图页或地图的开发页，`MapCanvas` 本来就按同样的 `KeepAlive` 钩子暂停视图。`@mx/ui` 依赖 Element，map-tools 不能依赖；`@mx/utils` 不依赖 Vue；约 50 行不值得新建一个包。代价是名字不贴切，非地图页要用时要先比较产物 |
| `MeasureOverlay` 的图标 | 插槽；传组件的 prop；包里带一个 SVG | 插槽：和 `@mx/ui` 相同（ADR 0016），页面的 DOM 和原来一样 |
| 按需加载 | `"sideEffects": false`；`manualChunks` 按模块分；入口拆成多个（`@mx/map-tools/measure`） | `sideEffects`：一行配置，分块和搬之前基本相同。`manualChunks` 要手写分组，页面组合一变就过时；多入口违反单入口的规则（ADR 0004） |
| 用江苏数据的测试 | 留在应用；复制一段市界进包 | 留在应用：南通市界求交后简化的用例要用 `shared/map/region` 的 `clipToScope`，包不能依赖它；其余用例跟着代码走 |

## 决定

1. 新建 `packages/map-tools`（`@mx/map-tools`），搬入 `draw/`、`measure/`、`box-select/`、`pointer-hint/`、`query-geometry.ts`、`pan-key.ts` 和它们的测试，业务行为和界面不变
2. 依赖方向 `map-core、map-vue ← map-tools`，由 lint 检查；map-tools 不依赖 element-plus、`@mx/ui`、pinia、vue-router，也不导入应用代码；`shared/map` 留下的模块可以依赖它，反过来不行
3. `usePageActive`、`useShownElementSize` 搬到 `@mx/map-vue`，应用的使用方都改成新位置，不留转发
4. `MeasureOverlay` 的删除图标用 `removeIcon` 插槽，由页面给出
5. `package.json` 写 `"sideEffects": false`；包里的模块不能在导入时产生副作用
6. `@turf/boolean-point-in-polygon` 进 catalog（第二个包用到了），版本不变；不新增第三方依赖

用法见 [map-tools.md](../modules/map-tools.md)。

## 实测结果

产物（内网构建，2026-11-05）：

| 项目 | 搬之前 | 没写 `sideEffects` | 写了 `sideEffects` |
|---|---|---|---|
| 入口 JS | 212,779 B（gzip 71,339） | 212,548 B | 212,775 B（gzip 71,341） |
| 入口 CSS | 1,177 B | 1,177 B | 1,177 B |
| JS 分块 | 95 个，共 9,818,243 B | 91 个，共 9,817,370 B | 95 个，共 9,818,316 B |
| CSS 文件 | 24 个，共 676,360 B | 23 个，共 676,359 B | 24 个，共 676,360 B |

各页面静态加载的分块（从页面的分块沿 `import` 算，含入口；单位 B）：

| 页面 | 搬之前 | 没写 `sideEffects` | 写了 `sideEffects` |
|---|---|---|---|
| 现状底图 | 2,333,826 | 2,342,365 | 2,333,910 |
| 数据查询 | 2,178,160 | 2,184,818 | 2,178,181 |
| 指标 AI 计算 | 2,156,848 | 2,158,836 | 2,156,869 |
| 空间监测指标 | 2,156,453 | 2,182,269 | 2,156,449 |
| AI 对话 | 2,647,621 | 2,674,139 | 2,647,617 |

- 没写 `sideEffects` 时，工具栏（`toolbar-items.ts`）经入口取 `MEASURE_TOOL_IDS`，整个包连同 turf 进了 `MapViewControls` 分块（48,971 → 66,273 B）：现状底图多加载绘制和逐点编辑，完全不用这个包的 AI 对话、空间监测指标多加载约 26 KB
- 写了之后，绘制（`useShapeDraw` 分块）只有数据查询和指标 AI 计算加载，逐点编辑只在指标 AI 计算的页面分块里，AI 对话和空间监测指标不加载这个包的任何模块，和搬之前相同
- 分块的差别只有一处：框选手势、提示和发给后端的几何所在的分块，名字从 `BoxSelectOverlay` 变成 `query-geometry`（Rolldown 按分块里的模块命名），5,547 → 5,581 B。`vite.config.ts` 不用改，没有叫 `src` 的分块
- 入口没有带上 MapLibre、Cesium（`buildOutputPlugin` 检查通过）

边界（放入违规，确认报出后删除；要模拟"声明过依赖"时用和 pnpm 一样的 junction，Git Bash 的 `ln -s` 是复制，落在 `node_modules` 下会被当成外部模块放行）：

- lint 报出：map-core、map-vue 依赖 map-tools（包名和相对路径）；map-tools 依赖 `@mx/ui`、`@mx/utils`、`@mx/icons`、`@mx/map-cesium`（声明和没声明都报）、element-plus、pinia、vue-router、maplibre-gl、cesium；map-tools 用相对路径导入应用代码；应用用相对路径导入包的内部文件
- 类型检查报出：应用深层导入 `@mx/map-tools/src/pan-key`（TS2307）、map-tools 用 `@/`（TS2307）。这两类 lint 不报，和 ADR 0143 记的分工相同

界面（开发服务器的内网配置，Playwright 发真实的鼠标事件，接口在浏览器里模拟，1440 × 900）：`/dev/map` 测距、提示、删除；`/dev/map-ui` 能打开；`/current-map` 测距、测面、删除、清除、提示靠边翻转、点/框选的矩形和提示；指标 AI 计算的自定义范围里绘制多边形和矩形、拖动节点、拖动中点插入、删除节点。删除按钮里的图标是 12 像素的关闭图标，都没有控制台错误。数据查询的框选由冒烟 `data-query.spec.ts` 覆盖。

全量（本机，`pnpm -r --workspace-concurrency=1 test --maxWorkers=2`）：测试文件从 397 个到 399 个（多了 `MeasureOverlay.test.tsx`，`query-geometry.test.ts` 分成包里和应用里两份），用例 3613 个全部通过；类型检查、lint、公网和内网构建通过；生产冒烟 43 项通过，6 项按构建开关跳过，和 ADR 0143 相同。

| 包 | 文件 | 用例 |
|---|---|---|
| icons | 5 | 35 |
| ui | 7 | 35 |
| utils | 8 | 69 |
| map-core | 26 | 332 |
| map-cesium | 8 | 128 |
| map-vue | 10 | 130 |
| map-tools | 13 | 81 |
| yzt | 322 | 2803 |

## 后果

- 好处：通用交互的边界由 lint 和 `exports` 保证，新的地图项目直接用 `@mx/map-tools`
- 好处：包能单独测（`pnpm --filter @mx/map-tools test`），不用加载应用的配置
- 代价：多一个包的配置（`package.json`、3 份 tsconfig、`vitest.config.ts`），`pnpm test` 多一次 Vitest 启动
- 代价：包外的测试经入口导入时不能用 node 环境（入口连着 TSX 组件，见 [map-tools.md](../modules/map-tools.md) 的"测试"）：`feature-query`、`pick-hint`、`query-geometry`、`useScopeEditor` 的测试改回 jsdom，每个文件多约 1 秒
- 代价：`sideEffects: false` 是隐含的约定：模块在导入时产生副作用会被悄悄去掉，lint 查不出来
- 代价：`query-geometry` 的 120 个坐标和提示文案是按这个项目写的；另一个项目不同时再做成参数
- 待定：工具栏、面板等通用界面，`location`、`area` 里通用的部分，等第二个地图项目明确后再拆（见 `docs/backlog.md`）
