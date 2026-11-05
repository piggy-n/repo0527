# 地图的通用交互（@mx/map-tools）

`packages/map-tools`：绘制范围、逐点编辑、测量、框选手势、鼠标旁的提示、发给后端的几何、临时拖动的键。和业务、和江苏都无关，以后放在 `apps/` 下的地图项目可以直接用（ADR 0145）。

依赖 `@mx/map-core`、`@mx/map-vue`、Vue、`@vueuse/core` 和两个 turf 单包；不依赖 Element、`@mx/ui`、Pinia、Vue Router，也不导入应用代码，由 lint 检查。工具栏、面板这些界面，以及 `location`、`area`、`region`、`basemap`、`boundary` 留在应用的 [`shared/map`](shared-map.md)：它们可以依赖这个包，反过来不行。

## 使用约定

- 只从入口 `@mx/map-tools` 导入；入口只导出现在有使用方的名字和它们签名里的类型（ADR 0027 第 6 条）
- 工具、拥有者和浮层的写法和别的地图能力一样：页面 `registerTools`、`bindStyle`，浮层通过 props 拿到拥有者（ADR 0027、0031）
- 样式只用 CSS 变量里的令牌，令牌由应用加载 `@mx/theme` 提供，包不导入它的 SCSS；地图样式里的颜色是数据，写在推导里
- 图标由使用方给：`MeasureOverlay` 的删除按钮用 `removeIcon` 插槽，和 `@mx/ui` 的做法相同（ADR 0016）。不给时按钮照常可用，只是没有图标
- `currentPanKey()` 读 `navigator`：这个包是 Vue 层，可以接受，所以它不放进 map-core
- `QUERY_VERTEX_LIMIT`（120 个坐标）按现在后端的 GET 地址长度定的，写在包里；另一个项目的后端限制不同时再做成参数（ADR 0027 第 6 条）。提示文案同样写在包里

## 分块

`package.json` 写了 `"sideEffects": false`，这一条不能删。工具栏只取 `MEASURE_TOOL_IDS` 时，没有它的话 Rolldown 会经入口把所有模块都算成可达，整个包连同 turf 进入工具栏所在的分块，不用它们的 AI 对话页也要多加载约 26 KB。写了以后只有用到的模块进分块，产物和搬动之前基本相同（数字见 ADR 0145）。包里的模块因此都不能在导入时产生副作用：不注册全局的东西，也不写只有副作用的 `import './x.css'`（`*.module.scss` 取了类名，不算）。

## 结构

路径相对 `packages/map-tools/src/`。

| 文件 | 内容 |
|---|---|
| `pointer-hint/pointer-hint.ts` | 鼠标旁的提示在哪一侧：右边、下边放不下时翻到另一侧（纯函数，ADR 0055）；提示的内容 `PointerHintContent`（位置和各行） |
| `pointer-hint/PointerHint.tsx` | 鼠标旁的提示：加粗的数值和操作说明，测量和拾取共用 |
| `box-select/box-gesture.ts` | 拖动框选的手势：阈值、屏蔽派生的单击、取消（纯函数，ADR 0049） |
| `box-select/BoxSelectOverlay.tsx` | 点/框选的浮层：拖动框选时的矩形（设计稿 5D.7 保留原来的外观）和鼠标旁的提示（ADR 0056） |
| `pan-key.ts` | 临时拖动地图的键：Mac 用 ⌘、其他平台用 Ctrl，交给工具声明的修饰键和提示里的写法（ADR 0056） |
| `draw/shape-draw.ts` | 绘制范围的类型、提示文案和 `draw` 分组的推导（纯函数，ADR 0104） |
| `draw/useShapeDraw.ts` | 绘制的拥有者：框选、多边形两个工具，只保留一个画完的范围；框选的矩形和提示交给 `BoxSelectOverlay`（见"绘制范围"） |
| `draw/shape-edit.ts` | 逐点编辑的纯函数：手柄（节点、边的中点）、按到哪一个、移动、插入、删除节点，`shape-edit` 分组的推导（ADR 0122） |
| `draw/useShapeEdit.ts` | 逐点编辑的拥有者：一个工具，按在手柄上时接管拖动，拖完才交出新的范围；选中、删除、提示（见"逐点编辑"） |
| `query-geometry.ts` | 发给后端的几何：整理（简化、舍入、有效性，ADR 0051）、屏幕框四角拾取成多边形、一个像素对应的经纬度距离；2026-10-28 从 `features/resource-map` 移来 |
| `measure/measure-style.ts` | `measure` 分组的推导（纯函数，ADR 0035） |
| `measure/measure-labels.ts` | 测量的标签、单位格式、标签放在哪一边与鼠标旁的提示（纯函数，ADR 0055） |
| `measure/useMeasure.ts` | 测量的拥有者：桥接 map-core 的 `MeasureStore`，提供两个工具和推导函数 |
| `measure/MeasureOverlay.tsx` | 测量的标签、删除按钮和鼠标旁的提示（设计稿 5D.7） |
| `testing/required.ts` | 只供测试：用例依赖的值必须存在。包的测试不能用应用的 `shared/testing` |

## 框选的手势与矩形（ADR 0049）

框选由点选工具负责（业务在 `features/resource-map` 的点选拥有者里），和业务无关的手势和矩形放在这里：

```ts
let gesture = NO_BOX_GESTURE;
gesture = pressBox(point);              // 左键按下：开始新的手势，解除上一次的单击屏蔽
gesture = moveBox(gesture, point);      // 离起点不小于 3 像素时进入框选，之后更新当前点
const { gesture: next, box } = releaseBox(gesture, point);  // 框选中松手给出框，并屏蔽这次的单击
gesture = cancelBox(gesture);           // Esc、地图移动、失焦、离开画布
acceptsClick(gesture);                  // 收到单击时先问：是不是一次正常的单击
drawingBox(gesture);                    // 拥有者据此推导 boxDraft，交给浮层
```

- 阈值是 3 像素：所装 MapLibre 只比较按下点和松手点，距离不小于 `clickTolerance`（默认 3）时不发单击；用同一个阈值，单击和框选不会都不触发
- 一次手势进入了框选或被取消，就屏蔽它派生的单击，到下一次按下才重置：拖出很远再回到起点附近松手时 MapLibre 仍会发出单击，不屏蔽就会覆盖刚完成的框选
- 松手点离起点够远时，即使没收到移动也按框选处理；拖回起点附近、框不到 3 像素时没有框
- 状态是整体替换的普通对象，拥有者放在 `shallowRef` 里；浮层只显示 `drawingBox` 给出的框，按左上角和宽高摆放，不拦截地图的鼠标操作；外观是 1 像素主色虚线、12% 的主色填充（5D.7 保留）

### 跟随提示与临时拖动（ADR 0056）

```tsx
const panKey = currentPanKey();          // { modifier: 'ctrl', label: 'Ctrl' }；Mac 上是 { modifier: 'meta', label: '⌘' }
const tool: MapTool = { ..., panModifier: panKey.modifier };   // 按住这个键拖动地图，由适配器平移
<BoxSelectOverlay pick={pick} />
```

- 平台按 `navigator.userAgent` 判断（`panKeyFor` 是纯函数）：Macintosh、iPhone、iPad 用 ⌘，因为 Mac 上 Ctrl + 单击会被系统当成右键；iPadOS 的 Safari 也写成 Macintosh，外接键盘时同样用 ⌘
- 提示的内容和显示条件由点选的拥有者给出（`features/resource-map` 的 `useFeaturePick`，ADR 0056 第 4 节），浮层只显示：`hint` 为 `null` 时不渲染，否则用 `PointerHint` 放在指针旁，靠边时翻到另一侧
- 浮层只要求 `BoxSelectOverlayState` 的两个只读 ref（`boxDraft`、`hint`），不导入业务类型。页面传稳定的拥有者，由浮层在自己的渲染里读 `.value`，鼠标每帧变化不带动页面根组件重渲染
- 框带 `data-box`，提示带 `data-pointer-hint`，测试据此区分

## 绘制范围（ADR 0104）

```tsx
// 页面 setup：创建拥有者（数据查询由 useSpatialForm 创建），登记两个工具，绑定 draw 分组
const draw = useShapeDraw(map, { onStart: () => result.clear(), onComplete: shape => submit(shape) });
map.registerTools(draw.tools);
map.bindStyle({ draw: draw.deriveGroup });

<BoxSelectOverlay pick={draw} />                       // 框选时的矩形和鼠标旁的提示
<button onClick={() => draw.toggle('rectangle')}>框选</button>   // 再点一次退出
```

- 两个工具都是临时任务，画完或 Esc 退回移动；`toggle` 再点一次退出，`stop` 退出，退出时丢掉没画完的、保留画完的；`clear` 清掉画完的
- 框选用点/框选的手势：离开起点 3 像素才算开始（这时调用 `onStart`、清掉上一个范围），关掉拖动平移和 Shift 框选放大，按住 `currentPanKey()` 临时拖动；地图移动、窗口失焦、视图不再就绪时取消这次手势
- 多边形同测面：左键单击加节点（双击里的第二次单击不加），双击完成，不足三个节点时双击只取消这一次；可以拖动地图，只关双击放大；画的过程中是虚线和节点
- 画完的范围（`DrawnShape`）带完成时一个像素对应的经纬度距离，交给 `queryGeometry` 当简化的容差；自相交等整理不出来的由使用方提示
- 只在二维处理输入；提示在工具在用、视图就绪、指针在画布上时有值，文案沿用旧数据查询页

## 逐点编辑（ADR 0122）

```tsx
// 页面 setup：范围由拥有者持有，编辑工具只读它、拖完交出新的
const edit = useShapeEdit(map, { geometry: () => draft.value, onChange: next => replaceDraft(next) });
map.registerTools(edit.tools);
map.bindStyle({ 'shape-edit': edit.deriveGroup });

<PointerHint point={edit.hint.value.point} lines={edit.hint.value.lines} canvas={size} />  // 有提示时
<button onClick={edit.toggle}>编辑节点</button>
```

- 临时任务，Esc 依次取消拖动、取消选中、退出；不改光标，不关拖动平移（只关双击放大）
- 按在节点或边的中点上（8 像素以内，范围内有节点时只选节点）时由工具接管这次拖动（`capturesPress`），别处照常平移；移动不到 3 像素算单击，只选中节点
- 拖动中只预览（虚线），松开后把新的范围交给 `onChange`，并选中这个节点；拖动边的中点在这条边上插入节点
- 单击选中节点后按 Delete（或 Backspace）删除，也可以由面板调用 `removeSelected()`；环只剩 3 个节点时不删（返回 `'minimum'`）
- 不检查自相交：交出去的范围由拥有者整理（自定义范围交给 `shared/map/area` 的 `prepareArea`）

## 测量（ADR 0035）

```tsx
// 页面 setup：创建拥有者，登记两个工具，绑定 measure 分组（叠放在最上面）
const measure = useMeasure();
map.registerTools(measure.tools);
map.bindStyle({ measure: measure.deriveGroup });

// 渲染：浮层和画布放在同一个定位参照里；工具栏的按钮 ID 与工具 ID 相同，"清除"由页面给出回调
<MapCanvas />
<MeasureOverlay measure={measure}>{{ removeIcon: () => <SvgIcon name="close" size={12} /> }}</MeasureOverlay>
<MapToolbar items={['browse', 'measure-distance', 'measure-area', 'clear']} actions={{ clear: measure.clear }} />
```

- 测量的状态和两个工具在 map-core 的 `MeasureStore`（见 `map-core.md`），`useMeasure` 只把它的 `change`、`pointer` 桥接成两个 `shallowRef`，作用域销毁时释放。工具 ID 是 `MEASURE_TOOL_IDS`（`measure-distance`、`measure-area`），工具栏用同样的 ID
- `state` 进样式推导，`pointer` 只给提示定位：没在画时移动鼠标，`state` 不变，绑定的推导不重新运行，不提交样式
- `measure` 分组从下到上：完成的面填充（不透明度 0.2）、画的过程中的面填充（0.12）、完成的线（实线）、画的过程中的线（虚线）、节点。要素用 `status` 属性（`completed`、`drawing`、`vertex`）区分，由图层的 `filter` 分给对应的图层；颜色和线宽沿用旧项目，写在推导里（地图样式里的颜色是数据，不走 CSS 令牌）
- 填充图层的 `filter` 还要求 `['geometry-type']` 是 `Polygon`：MapLibre 的 fill 图层会把 LineString 也当成环填充，只按状态过滤时，测距的折线下面会出现一块填充（浏览器验证时发现）
- 画的过程中：预览点接在线或面的末尾，不画节点；测面不到 3 个点时先画成线
- 标签由 `measureLabels(state)` 推导：测距在中间节点显示累计距离、末点显示"总长"，测面在形心正中显示"总面积"（`centered`）；结果标签的"总长""总面积"是 `caption`，带 `measurementId`，界面在它旁边放删除按钮。画的过程中的测距也显示已确定的中间节点，与旧项目相同
- 单位格式（ADR 0055）：距离不到 1 km 用米、取整，满 1 km 用 km、两位小数；面积不到 1 km² 用 m²、取整加千分位，满 1 km² 用 km²、两位小数；按取整后的数值判断分界
- 节点旁的标签放在哪一边由 `labelSide(x, 画布宽)` 决定：离画布右边不到 160 像素时放到左边，只看节点的位置、不量标签；还不知道画布宽度（为 0）时放右边
- 形心按经纬度平面近似，以第一个顶点为原点计算，避免经纬度的绝对值很大时相减损失精度；面积为 0 时取顶点的平均。凹多边形的形心可能落在外面，与旧项目相同
- 提示由 `measureHint(kind, draft)` 给出：没在画（或画的是另一种）时"单击开始测距"；画的过程中 `value` 是含鼠标所在点的"总长""总面积"（测距不到 2 个点、测面不到 3 个点时为 `null`），`text` 是"单击添加节点，双击结束，Esc 取消"。显示用 `PointerHint`（见"鼠标旁的提示"）
- `MeasureOverlay` 读 `useMap()` 的当前工具和投影的修订号：标签随测量结果变化，位置随相机和画布尺寸（`projectionRevision`）用 `project` 重新投影，视图没就绪时不显示（上下文的 `view` 只在就绪时有值，画布重建期间标签先隐藏）；提示只在当前工具是测量工具、鼠标在画布上时显示（`measureKindOf` 由工具 ID 得到类型）
- 浮层不拦截地图的鼠标操作，只有删除按钮可以点；浮层和画布是兄弟元素，点删除按钮不会被地图当成一次单击。标签带 `data-side`（`right`、`left`、`centered`），页面测试据此检查摆放

### 鼠标旁的提示（ADR 0055）

```tsx
<PointerHint point={pointer} canvas={{ width, height }} value="总长 880 m" lines={['单击添加节点，双击结束，Esc 取消']} />
```

- 放在盖着画布的浮层里，`point` 是鼠标在画布上的坐标，`canvas` 是浮层（和画布一样大）的尺寸
- 第一行可以是加粗的 `value`；`lines` 是操作说明：有 `value` 时都是次要的灰字，没有时第一行是主要的操作、其余是灰字
- 默认在鼠标右下方 16 像素；`pointerHintSides` 按量出的提示尺寸判断，右边、下边放不下（离画布边不到 8）时翻到左边、上边，贴近 8 像素；还不知道尺寸时不翻。元素仍放在鼠标的位置，偏移由 class 的 `transform` 决定
- `z-index: 1`，盖在面板和卡片上面：鼠标移到面板上时画布收不到移动、拥有者的指针位置变成 `null`，提示随之消失，不会挡住面板

### 预览线的性能（ADR 0035 第 6 条）

鼠标每移动一次，预览点变化一次，经过推导、组合、整份样式的对比再提交。在 `/dev/map` 打开"加上 200 个图层"（接近资源图层的数量）后用脚本在画布上派发 200 次 `mousemove`，从派发到提交完成（等微任务清空，不含渲染）：

| 场景 | 中位 | p90 |
|---|---|---|
| 移动工具（只有事件本身） | 0.1 ms | 0.2 ms |
| 测距，没在画（只更新鼠标位置） | 0.3 ms | 0.4 ms |
| 测距，正在画，7 个分组 | 0.4 ms | 0.6 ms |
| 测距，正在画，再加 200 个图层 | 0.5 ms | 0.7 ms |

远低于一帧的 16.7 ms，不按动画帧合并。提交时不做整份样式的校验（见 [map-core.md](map-core.md) 的"评估过但没做"），所以代价只随图层数缓慢增长。

### 历史测量很多时（5B 验收后补测）

在 `/dev/map` 用脚本单击画出 N 条 5 个点的测距，再测正在画时移动预览点的耗时（同上，从派发到下一个任务，含 Vue 渲染和样式提交），以及 `flyTo` 动画的帧间隔：

| 测量条数（浮层元素） | 移动预览点：中位 / p90 | `flyTo` 的帧 |
|---|---|---|
| 0 | 0.4 ms / 0.8 ms | 16.7 ms，没有掉帧 |
| 20（80） | 1.2 ms / 2.2 ms | — |
| 50（201） | 2.4 ms / 4.2 ms | — |
| 100（400） | 4.6 ms / 8.1 ms | 16.7 ms，最长 17.1 ms，没有掉帧 |

在 Node 里单独测纯计算：100 条 × 5 点时推导分组 0.06 ms、标签 0.34 ms、组合与对比 0.07 ms；100 条 × 20 点（1000 个标签）时合计约 1.8 ms，主要花在标签的累计距离上。所以移动预览点的耗时主要是 Vue 重新渲染所有标签：预览点一变，`measureLabels` 整体重算、所有标签重新投影和渲染，随条数线性增长。

结论：不做缓存。常见的十几条测量约 1 ms，100 条时仍在一帧以内，相机动画不受影响。以后真实使用中测量很多、出现卡顿时再做：把已完成测量的标签和位置单独缓存（只依赖 `measurements` 和投影的修订号），放进单独的子组件，画的过程中只重算正在画的那一条。

### 浏览器验证（2026-10-10）

| 场景 | 结果 |
|---|---|
| 开发页：同样两个像素点先坐标拾取、再测距 | 拾取得到 (117.135480, 32.792312)、(121.019734, 33.959988)，测距显示"总长 383.92 km"；用另一种实现（Vincenty 公式）按拾取的坐标算出 383 915.9 m，一致 |
| 现状底图页测距：单击两点，双击结束 | 线、节点、中间点的累计距离、末点"总长 … km"和 ×；鼠标旁的提示随状态变化；双击没有放大地图 |
| 测面：画的过程中、结束后 | 画的过程中是虚线和浅填充，预览点不画节点；结束后实线描边、填充，形心处"总面积 … km²" |
| Esc | 正在画时取消这一条，留在测面；再按一次回到"移动"，已完成的测量保留，提示消失 |
| ×、"清除" | × 只删除这一条；"清除"删除全部，仍留在当前的测量工具 |
| 光标 | 测量时画布是十字，退出后回到 grab |
| 375 宽 | 工具栏换成两行，靠右对齐，五个按钮都在屏幕内；桌面宽度下仍是一行，控件列左边的空白处点到的是地图 |

## 测试

包的测试不依赖应用，`pnpm --filter @mx/map-tools test` 单独运行，都在 jsdom 或 Node 里，没有浏览器项目。整页的流程（测量的完整交互、绘制、逐点编辑）由应用的页面测试和冒烟覆盖。

| 文件 | 内容 | 环境 |
|---|---|---|
| `measure/measure-style.test.ts` | 没有测量时是空分组；完成的测距、测面的几何与节点；画的过程中接上预览点、点不够时退化；图层顺序、ID 前缀与组合后的校验；按 MapLibre 的语义求值 `filter`（带几何类型），检查线不被填充、每种要素由哪些图层画出；移动预览点只产生 `setGeoJSONSourceData` | Node |
| `measure/measure-labels.test.ts` | 距离与面积的格式和 1 km、1 km² 的分界（按取整后的数值）；标签放在哪一边；形心（矩形、三角形、面积为 0）；测距的中间节点与总长、测面居中的总面积；画的过程中的标签；提示：没在画、画的是另一种、含鼠标所在点的数值、点不够时没有 | Node |
| `pointer-hint/pointer-hint.test.ts` | 默认在右下方；右边、下边放不下的边界；还不知道画布尺寸时不翻 | Node |
| `measure/useMeasure.test.ts` | 两个工具的 ID 与类型；由工具 ID 得到测量类型；状态跟随输入、推导、删除和清除；鼠标位置单独跟随，没在画时移动鼠标不重新推导；作用域销毁时释放；不在作用域里时抛错 | Node |
| `measure/MeasureOverlay.test.tsx` | 删除按钮里放使用方给的图标、点击删除这一条；不给图标时按钮照常可用 | jsdom |
| `box-select/BoxSelectOverlay.test.tsx`、`box-select/box-gesture.test.ts`、`draw/*.test.ts`、`pan-key.test.ts`、`query-geometry.test.ts` | 手势、绘制、逐点编辑、临时拖动的键、发给后端的几何 | jsdom、Node |

南通市界求交后简化的那一条用例要用江苏的市界和区划求交，留在应用的 `shared/map/query-geometry.test.ts`。

包外的测试经入口导入这个包时用默认的 jsdom，不能写 `// @vitest-environment node`：入口连着 TSX 组件，node 环境走 SSR 转换，plugin-vue-jsx 注入的 helper 模块在 Vitest 里解析不了，整个文件报错。包里的纯逻辑测试直接导入相对路径，可以用 node 环境。

- 测量的推导逐一改坏 13 处、标签 22 处、拥有者 10 处。标签里只有"叉积符号反了"测不出来，它是等价改动：面积和加权和同时变号，比值不变（顺时针、逆时针画的形心相同）。图层的 `filter` 拼错时地图上只是什么都不画，为此用 style-spec 的 `featureFilter` 求值检查；起初只按 `status` 求值，没带几何类型，浏览器里才发现折线下面被填充，改成按每个要素的真实几何类型求值，先复现再修；"测面工具其实是测距"起初没被发现，补了用测面工具加点后检查草稿的类型。其余全部由断言发现
- 测量的浮层逐一改坏 8 处、页面的接线 6 处、工具栏的表 1 处，填充改为只给面之后的 `filter` 7 处。浮层里"提示不看当前工具"起初没被发现（只用测距时测不出），补了换成测面后的提示；画布重建的用例起初没先确认画出了标签，"不登记测量工具"时它比较的是两个空结果，补了前提断言；"投影为 null 时也显示"测不出来，二维的 `project` 不会返回 null，这个判断是给三维（点在地球背面）准备的。其余全部由断言发现
