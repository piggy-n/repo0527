# 项目级的公共地图能力（shared/map）

> 状态：5A.3 加入地图状态的提示和江苏的范围；5B.1 加入底图（目录、推导、拥有者、联调面板，现状底图已接入）；5B.2 加入行政区边界与默认视角（数据、推导、拥有者、联调面板，现状底图已接入）；5B.3 加入工具栏的外壳。工具栏等公共能力在 5B 陆续加入。分层见 ADR 0027：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue（[map-vue.md](map-vue.md)），这里放要读项目配置、用 Element 和 `SvgIcon` 的公共地图能力。

阶段五的界面后置到 5D 专门设计（[roadmap.md](../roadmap.md)"阶段五"）。这里的组件都是联调用的界面：状态和文案由纯函数决定，组件只负责显示，5D 只换组件，纯函数保留。

## 结构

| 文件 | 内容 |
|---|---|
| `map-status.ts` | `describeMapStatus(viewState, failure)`：由视图状态和失败原因推导要显示的内容（纯函数） |
| `MapStatusNotice.tsx` | 加载中与失败的提示（联调用的界面） |
| `jiangsu.ts` | 江苏省的范围 `JIANGSU_BOUNDS`、创建地图时的相机 `JIANGSU_CAMERA`、缩放范围 `JIANGSU_ZOOM_RANGE` |
| `useDefaultView.ts` | 默认视角：第一次就绪时按江苏的范围定位，`goToDefaultView()` 回到默认视角（ADR 0033） |
| `basemap/basemap-style.ts` | 底图目录与推导：可选的底图、初始状态、`createBasemapStyles` 给出两个分组的推导函数（纯函数，ADR 0031） |
| `basemap/useBasemap.ts` | 底图的拥有者：持有选择和透明度，提供操作和两个推导函数 |
| `basemap/BasemapPanel.tsx` | 底图的切换面板（联调用的界面） |
| `boundary/data/` | 省、市、县界的 GeoJSON，由转换脚本生成（见"行政区边界的数据"） |
| `boundary/boundary-style.ts` | 边界的级别、初始状态、`boundaryGroup` 推导（纯函数，ADR 0033） |
| `boundary/useBoundaries.ts` | 边界的拥有者：持有每一级是否显示和共用的透明度 |
| `boundary/BoundaryPanel.tsx` | 边界的面板（联调用的界面） |
| `toolbar/toolbar-items.ts` | 工具栏上的工具和动作：名称、图标集中在一张表里（ADR 0034） |
| `toolbar/MapToolbar.tsx` | 工具栏的外壳（联调用的界面） |
| `measure/measure-style.ts` | `measure` 分组的推导（纯函数，ADR 0035） |
| `measure/measure-labels.ts` | 测量的标签、单位格式与鼠标旁的提示（纯函数） |
| `measure/useMeasure.ts` | 测量的拥有者：桥接 map-core 的 `MeasureStore`，提供两个工具和推导函数 |
| `measure/MeasureOverlay.tsx` | 测量的标签、删除按钮和鼠标旁的提示（联调用的界面） |
| `region/data/jiangsu-regions.json` | 区划目录：13 个市及各自的区县（见"区划目录的数据"） |
| `region/region-catalog.ts` | 区划目录的查询：市的列表、某个市的区县、按代码查找、路径、搜索（纯函数，ADR 0036） |
| `region/region-geometry.ts` | 从市界、县界文件取区划的边界：按代码查找、合并多个要素、外包范围；文件只下载、解析一次 |
| `region/region-style.ts` | `region` 分组的推导：选中区划的高亮（纯函数） |
| `region/useRegionLocate.ts` | 区划定位的拥有者：选择、加载边界、定位、回到全省；面板点击的规则 `nextRegionSelection` |

## 江苏的范围与默认视角（ADR 0033）

```ts
// 页面 setup：只在 provideMap 所在的组件里调用一次，传入页面句柄
const { goToDefaultView } = useDefaultView(map);

// 画布带上缩放范围
<MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} />
```

- `JIANGSU_BOUNDS` 是省界数据的实际范围向外取整（`[116.35, 30.75, 121.98, 35.15]`），由测试检查它包含省界的全部范围、四边多出的不超过 0.05°。5A 时的 `[116.3, 30.7, 121.9, 35.2]` 东边界切掉了启东一角
- `JIANGSU_ZOOM_RANGE` 是 5～18 级，与旧项目一致：5 级能看到江苏和周边，天地图只有 18 级以内的数据
- 创建地图时用 `JIANGSU_CAMERA`（沿用旧项目的默认视角 119.5, 33.0, z6.8）
- 本次进入页面后，视图第一次进入 `ready` 时不带动画地 `fitBounds(JIANGSU_BOUNDS)` 一次，然后停止侦听：不同屏幕尺寸下都完整显示江苏，并避开登记过的悬浮元素（ADR 0029）；首次创建或加载失败、重试成功后同样补做；之后再次就绪（重建、恢复）不再定位，保留用户调整过的视角
- `goToDefaultView()` 用 500ms 动画按江苏的范围适配，不传 padding（自动避开悬浮元素），旋转和俯角归零；视图没有就绪时什么也不做。和旧项目"飞到固定相机"不同，不同屏幕和布局下都完整显示江苏
- 两处定位都传 `pitch: 0`：浏览器里实测，倾斜 45°、旋转 30° 后用不带俯角的 `fitBounds`，旋转归零了，俯角仍是 45°（MapLibre 算缩放级别时也不考虑俯角，平视和倾斜时都是 z6.39），所以给视图接口的 `fitBounds` 加了 `pitch` 选项（见 [map-core.md](map-core.md)）。加上后两者都归零，中心和缩放级别与平视时相同
- 现状底图页上有一个临时的"默认视角"按钮，5B.3 换成工具栏
- 只在页面的 setup 里调用一次：画布创建视图之后再调用会抛错。工具栏等需要回到默认视角的组件通过 props 拿到 `goToDefaultView`，不要自己调用 `useDefaultView`，否则它会在下一次就绪（如恢复显示）时把用户调整过的视角重置
- 5A 时写成"挂载时等一次 `whenReady()`"，首次失败后重试成功不会再定位，5A 之后改为侦听视图状态。页面测试用 `stubs` 把画布换成注入了假地图的同一个组件（改名，避免替身里的画布又被替换）
- 1280 宽的现状底图上实测：相机从 (119.5, 33.0, z6.8) 定位到 (119.1, 32.98, z6.5)；进入后立刻离开，等待被中止，没有报错
- 不会先按初始相机画一帧再跳：5B.1 接入天地图后，在真实的 MapLibre 上记录每一帧的相机，顺序是创建时的 `jumpTo` → 进入就绪时同步会话相机的 `jumpTo`（z6.8）→ 页面的 `fitBounds` → 第一次渲染，第一次渲染时已经是适配后的视角，三步在同一帧之前完成；瓦片也没有按初始相机多请求。原因是 MapLibre 在动画帧里加载样式，就绪和定位在同一帧的微任务里完成，下一帧才渲染

## 底图（ADR 0031）

全部用天地图，按 `appConfig.tianditu` 决定能选哪些：

| 底图 | `basemap` 分组 | `basemap-labels` 分组 |
|---|---|---|
| 矢量底图 | 背景 + 天地图 `vec` | 天地图 `cva` |
| 影像底图 | 背景 + 天地图 `img` | 天地图 `cia` |
| 无底图 | 背景 | 空 |

```ts
// 页面 setup：拥有者的状态随页面，进入页面时重新开始
const map = provideMap({ groups: ['basemap', 'basemap-labels'], camera: JIANGSU_CAMERA });
const basemap = useBasemap();
map.bindStyle({ basemap: basemap.deriveGroup, 'basemap-labels': basemap.deriveLabelsGroup });

// 面板通过 props 拿到 basemap，只显示和调用
basemap.options;          // 可选的底图（按 appConfig.tianditu）
basemap.selected.value;   // 当前底图
basemap.opacity.value;    // 当前底图的透明度（0～1），无底图时为 null
basemap.select('imagery');
basemap.setOpacity(0.6);
```

- `useBasemap()` 默认读取 `appConfig.tianditu`，测试时传入 `{ tianditu }`；不依赖组件的生命周期，没有要清理的东西。推导用的是 `createBasemapStyles(tianditu)` 的两个纯函数
- 不用 Pinia：状态只在一个页面里共享，不带到其他地图页，同一页面上的两张地图互不影响（ADR 0031）
- 状态是一个 `shallowRef`，变化时整体替换；选择或透明度没变时不替换，推导函数包在 `computed` 里（提交器就是这样做的）时不会重新推导。滑块拖动时会重复给出相同的值
- 不合法的调用直接抛错，状态不变：选择不可用的底图（如关闭天地图时选矢量）、透明度不是 0～1 之间的有限数、无底图时修改透明度。界面只提供可用的操作，这些都是编程错误；错误在操作里抛出，不进入推导和 `computed`
- 暂不记住选择；状态只有 ID 和数字，5C.3 做持久化时再加初始值或存储

- 状态（`BasemapState`）只有选中的底图和每种底图的透明度（0～1），可以直接序列化；透明度同时作用于底图和注记，不影响背景
- 背景是 `basemap-background`（`#F3F5F8`），无论选哪种底图都在最底下：无底图时显示它，瓦片加载中和调低透明度时与它混合
- 天地图的数据源设 `minzoom: 1`、`maxzoom: 18`：2026-10-10 实测 `vec`、`cva`、`img`、`cia` 只有 1～18 级有数据，0 级和 19 级也返回 200，内容是占位图；超过 18 级时放大使用 18 级的瓦片
- 没选中的底图，数据源不在样式里；改透明度只产生 `setPaintProperty`。这一点由 style-spec 的 `diff` 对数据源做深比较保证，与数据源是不是同一个对象无关（改坏验证时发现，见"测试"）
- 关闭天地图（`appConfig.tianditu` 为 `null`，内网部署）时只能选"无底图"，进入时就是它；工厂不建任何数据源，无论状态是什么，推导结果里都没有天地图
- 瓦片地址里的 `{z}`、`{x}`、`{y}` 由 MapLibre 替换，地址用模板字符串拼，不经过 `URLSearchParams`（会把花括号转义）

### 联调面板

```tsx
<BasemapPanel class={styles.basemapPanel} basemap={basemap} />
```

- Element 的单选按钮组列出 `basemap.options`；滑块按百分比显示当前底图的透明度，拖动过程中实时生效，换算成 0～1 交给 `setOpacity`；无底图时没有滑块
- 单选按钮组给出的值类型很宽（`string | number | boolean | undefined`），按 `basemap.options` 查出底图 ID，不做类型断言
- 位置由页面的 class 决定（现状底图放在右上角）；角落里的小控件，不用 `useMapOverlay` 登记（ADR 0029）
- `Basemap` 接口里的函数都写成函数类型的属性（`readonly deriveGroup: () => StyleGroup`），不写方法签名：它们是闭包，页面直接取出来交给 `bindStyle`，写成方法签名时 lint 的 `unbound-method` 会报错

### 浏览器验证（2026-10-10）

在 `/current-map` 用真实的 MapLibre 验证：

| 场景 | 结果 |
|---|---|
| 公网配置进入页面 | 矢量底图和注记显示；只请求 `vec`、`cva`，8 个子域名都用到 |
| 切到影像底图 | 样式里只剩 `basemap-imagery`、`basemap-labels-imagery`，只请求 `img`、`cia`；没有错误 |
| 拖动透明度到 40% | 影像和注记的 `raster-opacity` 都变成 0.4，没有新的瓦片请求 |
| 切到矢量再切回影像 | 矢量是 100%，影像仍是 40%，各自记住 |
| 无底图 | 样式里只有 `basemap-background`，没有数据源，滑块隐藏 |
| 放大到 z19.6 | 只请求 18 级瓦片，显示的是放大的 18 级瓦片，不是占位图 |
| 内网配置（`dev:intranet`）进入页面 | 面板只有"无底图"；地图画出背景色（在渲染的那一帧读像素是 243、245、248）；整个页面没有任何外部域名的请求 |
| 375 宽 | 面板宽 220，在屏幕内，没有横向滚动 |

- 缩小时地图最小只到 z0.71（画布尺寸的限制），瓦片按 2 级请求；栅格瓦片按 256 像素换算，瓦片级别总比地图缩放级大 1，所以不会请求 0 级，`minzoom: 1` 只是写明天地图的范围
- 读 WebGL 画布的像素要在渲染的那一帧里读：MapLibre 没有开 `preserveDrawingBuffer`，帧画完后缓冲区被清空，事后用 `drawImage` 读到的是全透明

## 行政区边界（ADR 0033）

```ts
// 页面 setup：边界在注记上面（旧项目把边界移到最顶，见 ADR 0033 第 4 条）
const map = provideMap({ groups: ['basemap', 'basemap-labels', 'boundaries'], camera: JIANGSU_CAMERA });
const boundaries = useBoundaries();
map.bindStyle({ boundaries: boundaries.deriveGroup });

boundaries.options;           // 省界、市界、县界
boundaries.visible.value;     // { province: true, city: false, county: false }
boundaries.opacity.value;     // 三级共用的透明度（0～1）
boundaries.setVisible('city', true);
boundaries.setOpacity(0.6);
```

- 每个打开的级别一个 GeoJSON 数据源和一条线图层，ID 是 `boundaries-province` 等；从下到上是县、市、省
- 数据源直接写 `?url` 导入的地址（`{ type: 'geojson', data: url }`），由 MapLibre 在 Worker 里下载和解析；地址带内容哈希，可以长期缓存
- 关闭的级别不在样式里，打开时才下载；关掉再打开要重新解析（下载命中缓存）。打开、关闭一级只增删这一级的数据源和图层，改透明度只产生 `setPaintProperty`
- 线的样式照搬旧项目：颜色都是 `#597EF7`；省界宽 1.8～3.2、不透明度 0.94，市界 1.1～2.3、0.78，县界 0.6～1.25（从 8 级起变化）、0.62、虚线。状态里的透明度乘在各级的不透明度上
- `useBoundaries()` 的写法与 `useBasemap()` 相同：状态是一个 `shallowRef`，值没变时不替换；透明度不是 0～1 之间的有限数时抛错。三级都关闭时仍可以改透明度
- 进入页面时只显示省界；指标页（阶段六）要四项全开时再加初始值的参数
- 联调面板 `BoundaryPanel`：三个复选框和一条透明度滑块，没有打开任何级别时没有滑块；复选框组给出勾选的全部值，按级别逐一 `setVisible`，值没变的级别不替换状态。现状底图页把"默认视角"按钮、底图面板、边界面板在右上角排成一列

### 浏览器验证（2026-10-10）

| 场景 | 结果 |
|---|---|
| 进入页面 | 样式里是底图背景、矢量底图、注记、省界，省界压在注记上面；市界、县界的数据源不在样式里，没有下载 |
| 勾选市界、县界 | 开发服务器上从勾选到数据加载完成：市界 488ms（未压缩的 1.4 MB）、县界 43ms；叠放从下到上是县、市、省；没有错误 |
| 取消市界再勾选 | 数据源先被移除，再勾选时 121ms 加载完成（下载命中缓存，只重新解析） |
| 透明度拖到 50% | 县、市、省的不透明度分别是 0.31、0.39、0.47 |
| 县界与市界对不齐 | 用数据算：县界顶点到最近的市界线段，离市界 2 公里以内的 3809 个顶点里，偏差的中位数约 150 米，90% 在 730 米以内；按 12 级每像素约 16 米算是 10～45 像素，10 级以上能看出来 |
| 倾斜后点"默认视角" | 加 `pitch: 0` 之前俯角保持 45°，加上之后俯角、旋转都归零，中心 119.165°、z6.39 |
| 内网配置 | 省界照常显示在背景色上，没有任何外部请求 |
| 生产构建 | 三份数据是带哈希的独立文件（`assets/jiangsu-city-<hash>.json` 等），没有打进 JS；页面分块 59 KB |

- 开发服务器上，`?url` 导入本身是一个只导出地址的小模块（约 500 字节），真正的数据由 MapLibre 在 Worker 里下载，主线程的 `performance` 记录和浏览器面板的网络记录里都看不到；验证时直接看地图上数据源的状态（`getSource(id).loaded()`、`querySourceFeatures`）

## 行政区边界的数据（ADR 0033）

`boundary/data/` 下的三份边界由 `apps/web/tools/boundaries` 的脚本从旧项目转换而来：

| 文件 | 来源（yzt 836f03b `public/static/geojson/`） | 要素 | 原始大小 → 转换后 |
|---|---|---|---|
| `jiangsu-province.json` | `江苏省界.json` | 1 | 798 KB → 464 KB |
| `jiangsu-city.json` | `江苏省市界.json` | 14（连云港分成两块） | 2479 KB → 1441 KB |
| `jiangsu-county.json` | `江苏省县界.json` | 95 | 199 KB → 199 KB |

- 转换：坐标保留 6 位小数（约 0.1 米，原始数据有 14～15 位），属性只留 `name` 和 `code`（省取 `adcode`、市取 `code`、县取 `gb`），去掉 `crs`（县界标的是 CGCS2000，与 WGS 84 相差不到 1 米）。原始文件的结构不符合时报错，不生成残缺的数据
- 县界大幅简化过（每个县约 89 个点），放大后和市界、省界对不齐；没有更精细的数据，原样迁移
- 重新生成：先把旧仓库 `master-demo` 上的三个文件导出到一个临时目录（`git show master-demo:public/static/geojson/江苏省界.json > <目录>/江苏省界.json`，另两个同理），再在仓库根目录运行 `pnpm --filter @yzt/web boundaries:generate <目录>`

## 工具栏（ADR 0034）

```tsx
// 页面：挑选按钮，动作的回调由页面给出；放在 provideMap 所在组件的子孙里
<MapToolbar items={['default-view', 'browse']} actions={{ 'default-view': goToDefaultView }} />
```

- `toolbar-items.ts` 把工具和动作分成两张表，名称、图标集中在这里，图标先用 Element 的（移动 `Rank`、测距 `Share`、测面 `Crop`、默认视角 `HomeFilled`、清除 `Delete`），5D 换成设计的素材。工具的 ID 就是登记到会话里的工具 ID，测距、测面用 `MEASURE_TOOL_IDS`；5C.6 加点选
- 工具按钮读 `useMap().activeTool`，激活的按钮高亮；点击没激活的工具时 `activateTool`，点击激活的工具时 `releaseTool`（临时任务退回上一个常驻模式）。"移动"是常驻模式，再点一次什么也不做
- 动作按钮调用页面通过 `actions` 传入的回调，没有回调时不可用
- 现状底图页把它和底图面板、边界面板一起放在右上角；它是角落里的小控件，不登记为悬浮元素。放不下时换行、靠右对齐：页面的控件列左右都留边距，工具栏在这个宽度里换行；控件列本身不拦截鼠标，空白处仍是地图

## 测量（ADR 0035）

```tsx
// 页面 setup：创建拥有者，登记两个工具，绑定 measure 分组（叠放在最上面）
const measure = useMeasure();
map.registerTools(measure.tools);
map.bindStyle({ measure: measure.deriveGroup });

// 渲染：浮层和画布放在同一个定位参照里；工具栏的按钮 ID 与工具 ID 相同，"清除"由页面给出回调
<MapCanvas />
<MeasureOverlay measure={measure} />
<MapToolbar items={['browse', 'measure-distance', 'measure-area', 'clear']} actions={{ clear: measure.clear }} />
```

- 测量的状态和两个工具在 map-core 的 `MeasureStore`（见 `map-core.md`），`useMeasure` 只把它的 `change`、`pointer` 桥接成两个 `shallowRef`，作用域销毁时释放。工具 ID 是 `MEASURE_TOOL_IDS`（`measure-distance`、`measure-area`），工具栏用同样的 ID
- `state` 进样式推导，`pointer` 只给提示定位：没在画时移动鼠标，`state` 不变，绑定的推导不重新运行，不提交样式
- `measure` 分组从下到上：完成的面填充（不透明度 0.2）、画的过程中的面填充（0.12）、完成的线（实线）、画的过程中的线（虚线）、节点。要素用 `status` 属性（`completed`、`drawing`、`vertex`）区分，由图层的 `filter` 分给对应的图层；颜色和线宽沿用旧项目，写在推导里（地图样式里的颜色是数据，不走 CSS 令牌）
- 填充图层的 `filter` 还要求 `['geometry-type']` 是 `Polygon`：MapLibre 的 fill 图层会把 LineString 也当成环填充，只按状态过滤时，测距的折线下面会出现一块填充（浏览器验证时发现）
- 画的过程中：预览点接在线或面的末尾，不画节点；测面不到 3 个点时先画成线
- 标签由 `measureLabels(state)` 推导：测距在中间节点显示累计距离、末点显示"总长"，测面在形心显示"总面积"；结果标签带 `measurementId`，界面在它旁边放删除按钮。画的过程中的测距也显示已确定的中间节点，与旧项目相同
- 单位格式沿用旧项目：距离固定用 km、两位小数；面积满 1 km² 用 km²，否则用 m²，两位小数
- 形心按经纬度平面近似，以第一个顶点为原点计算，避免经纬度的绝对值很大时相减损失精度；面积为 0 时取顶点的平均。凹多边形的形心可能落在外面，与旧项目相同
- 提示由 `measureHint(kind, drawing)` 给出，沿用旧项目的文案："单击开始测距"、"单击添加节点，双击结束测距"（测面同理）
- `MeasureOverlay` 读 `useMap()` 的当前工具和相机：标签随测量结果变化，位置随相机用 `project` 重新投影，视图没就绪时不显示（`project` 只能在就绪时调用，画布重建期间标签先隐藏）；提示只在当前工具是测量工具、鼠标在画布上时显示（`measureKindOf` 由工具 ID 得到类型）
- 浮层不拦截地图的鼠标操作，只有删除按钮可以点；浮层和画布是兄弟元素，点删除按钮不会被地图当成一次单击。标签放在点的右侧，测面的总面积从形心向右排，靠近画布右边时会被裁掉，5D 再设计

### 预览线的性能（ADR 0035 第 6 条）

鼠标每移动一次，预览点变化一次，经过推导、组合、整份样式的对比再提交。在 `/dev/map` 打开"加上 200 个图层"（接近资源图层的数量）后用脚本在画布上派发 200 次 `mousemove`，从派发到提交完成（等微任务清空，不含渲染）：

| 场景 | 中位 | p90 |
|---|---|---|
| 移动工具（只有事件本身） | 0.1 ms | 0.2 ms |
| 测距，没在画（只更新鼠标位置） | 0.3 ms | 0.4 ms |
| 测距，正在画，7 个分组 | 0.4 ms | 0.6 ms |
| 测距，正在画，再加 200 个图层 | 0.5 ms | 0.7 ms |

远低于一帧的 16.7 ms，不按动画帧合并。提交时不做整份样式的校验（见 [map-core.md](map-core.md) 的"评估过但没做"），所以代价只随图层数缓慢增长。

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

## 区划定位（ADR 0036）

```ts
// 页面 setup：在 useDefaultView 之后创建，回到全省时用它回到默认视角；region 分组叠在边界之上、测量之下
const { goToDefaultView } = useDefaultView(map);
const region = useRegionLocate(map, { goToDefaultView });
map.bindStyle({ region: region.deriveGroup });

region.select('320213');   // 梁溪区：加载边界、高亮，视图就绪后定位
region.select(null);       // 回到全省：清掉高亮，回到默认视角
```

- 状态是 `{ selected, boundary }`：`selected` 为 `null` 是全省；`boundary` 是 `none`（全省）、`loading`、`ready`（带边界）或 `failed`（带原因，`retry()` 重新加载）。只有 `ready` 时有高亮，加载中不显示上一个区划的高亮
- 每次选择一个 `AbortController`：换选、回到全省、作用域销毁时中止，晚到的结果（成功或失败）都不写入。边界到位后用 `whenReady(signal)` 等视图就绪再定位：`fitBounds(范围, { duration: 1100, maxZoom: 14.5, pitch: 0 })`，四边留白由登记的悬浮元素决定（ADR 0029）。等待失败（视图被替换、失败或选择已过期）时不定位，高亮照常
- 再选当前的区划什么也不做；不认识的代码抛错。从市或区县回到全省时调用页面传入的 `goToDefaultView`，本来就是全省时不调用
- 面板上的点击由 `nextRegionSelection(selected, clicked)` 换成 `select` 的参数：点别的区划选它，再点已选中的市回到全省，再点已选中的区县回到所在的市（同旧项目）
- 没有注入加载器时用整个应用共享的一个，市界、县界在应用里只下载、解析一次
- `region` 分组是红色光晕（宽 8、模糊 5、不透明度 0.8）在下、实线（宽 2、不透明度 0.9）在上，沿用旧项目

区划目录与边界的加载：

```ts
const loader = createRegionBoundaryLoader();     // 默认用 fetch；测试注入读取函数
const { geometry, bounds } = await loader.load(findRegion('320213'));  // 县界里的要素，Polygon 或 MultiPolygon
```

- 区划目录是江苏的 13 个市、95 个区县，没有"全省"这一项：没有选择就是全省。`Region` 有代码（6 位）、名称、级别（`city` / `district`）和所在的市
- 搜索：路径（如"南京市 / 玄武区"）包含关键字的区划，按目录顺序（每个市后面跟着它的区县），最多 20 条，去掉首尾空白。旧项目把完全相同的排在前面，是因为"江苏省"一项包含所有关键字；目录里没有这一项，完全相同的本来就排在最前，所以只保留"包含"
- 边界从 5B.2 的市界、县界文件里取，和边界图层是同一个地址（命中 HTTP 缓存）。边界数据的代码换成 6 位再查找：市界的代码是 12 位、取前 6 位，县界去掉 `156` 前缀。同一代码有多个要素时合并（连云港的市界是两块），只有一个多边形时是 `Polygon`
- 每个文件只下载、解析一次，同时发起的加载共用一次；失败不缓存，下次重新下载。下载由各次加载共用，不随某一次选择取消，过期的结果由拥有者丢弃
- 读取的 JSON 用 zod 检查结构（代码、几何类型），坐标只确认是数组：坐标由转换脚本生成并检查过，逐个检查 1.4 MB 的市界在 Node 里约 40 ms（`JSON.parse` 约 13 ms）
- 外包范围从外环算出，没有为它引入 turf

### 区划目录的数据

`region/data/jiangsu-regions.json` 由旧项目（yzt `master-demo` 836f03b）的 `src/components/CommonMap/boundary/regionLabelPoints.ts` 转换而来，只保留代码、名称和所在的市，顺序沿用原表。

- 没有用旧面板的 `src/views/space-monitoring-query/region.js`：其中 8 个区县的代码是旧的或错位的（无锡的锡山、惠山、滨湖、梁溪、新吴，南通的崇川、海门、如东、海安，淮安的涟水），比如梁溪区写成 320205（锡山区的代码）。旧项目找边界时先按代码匹配，所以选梁溪区高亮的是锡山区
- 测试检查目录与边界数据逐条对应（代码、名称都相同，两边都不多不少）。区划调整时同时更新边界数据和目录，测试会指出对不上的地方

## 地图状态的提示（ADR 0030）

```tsx
// 放在地图区域里，父元素要能作为定位参照（position: relative）
<div class={styles.mapArea}>
  <MapCanvas />
  <MapStatusNotice />
</div>
```

| 视图状态 | 显示 | 说明 |
|---|---|---|
| `initializing` | 加载中 | 用 `useDelayedFlag` 延迟出现，很快加载完就不显示；不拦截地图上的操作 |
| `failed`，引擎失败，不支持 WebGL2 | "地图无法显示"，说明浏览器和硬件加速的要求，"重试" | 原因由适配器用 `instanceof GPUInitializationError` 判断 |
| `failed`，引擎失败，其他原因 | "地图无法显示"，可以重试，技术细节用小字 | 处于 `failed` 却没有原因时也按这一种处理 |
| `failed`，样式失败 | 上方的警告条："地图样式加载失败"，说明改动图层后会自动重新加载，技术细节用小字 | 不提供重试：样式出现新版本时自动恢复 |
| 其他（`idle`、`ready`、`paused`、`disposed`） | 不显示 | — |

- "重试"调用 `useMap().retry()`，由画布组件在同一个容器里重新创建视图，页面不用管理画布的 `key`
- 文案集中在 `describeMapStatus`，测试也在它上面；组件只测"点重试会重新创建地图"这一个关键交互
- 技术细节是 MapLibre 的原始信息（如 `layers[3].paint.line-width: number expected, string found`），给开发和运维看，普通用户看前面的说明即可

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `useDefaultView.test.ts` | 第一次就绪时定位一次、之后不再定位；失败重试后补做；回到默认视角的参数；没就绪时什么也不做；作用域销毁后不定位；视图已存在或不在作用域里时抛错 | Node |
| `jiangsu.test.ts` | 江苏的范围包含省界数据，四边多出的不超过 0.05° | Node |
| `pages/current-map/CurrentMapPage.test.tsx` | 页面绑定的分组与叠放（底图、注记、省界，测量叠在最上面）；把缩放范围交给画布；第一次就绪时定位、画布重建后不再定位；"默认视角"按钮；失败重试后补做；测量的完整交互：提示跟随鼠标和状态、末点的总长、标签随相机移动、× 和"清除"、换成测面，画布重建时标签先隐藏、就绪后重新显示（用假地图，鼠标事件经过真实的适配器） | jsdom |
| `map-status.test.ts` | 各状态的显示内容、两种引擎失败、样式失败、没有原因、不是 Error 的原因 | Node |
| `MapStatusNotice.test.tsx` | 引擎失败时显示原因和"重试"，点击后重新创建地图，重试过程不抛错 | jsdom |
| `basemap/BasemapPanel.test.tsx` | 选择底图后改变状态、无底图时没有滑块；滑块按百分比显示、拖动时交给拥有者 0～1 的值；关闭天地图时只有"无底图" | jsdom |
| `basemap/useBasemap.test.ts` | 默认读取配置；两种配置下的初始状态；切换后推导出所选底图和注记；透明度作用于当前底图、每种底图各自记住；相同的值不触发重新推导；不合法的调用抛错且状态不变 | Node |
| `boundary/boundary-style.test.ts` | 级别与初始状态；数据源是三份文件的地址；三级的叠放、线宽、虚线；透明度乘在基础值上；关闭的级别不在样式里；ID 前缀与校验；改透明度只产生 `setPaintProperty`；开关一级只增删这一级 | Node |
| `toolbar/MapToolbar.test.tsx` | 按列表显示按钮；工具按钮跟随当前工具、点击时激活；点击已激活的工具时退出；动作按钮调用回调、没有回调时不可用 | jsdom |
| `measure/measure-style.test.ts` | 没有测量时是空分组；完成的测距、测面的几何与节点；画的过程中接上预览点、点不够时退化；图层顺序、ID 前缀与组合后的校验；按 MapLibre 的语义求值 `filter`（带几何类型），检查线不被填充、每种要素由哪些图层画出；移动预览点只产生 `setGeoJSONSourceData` | Node |
| `measure/measure-labels.test.ts` | 距离与面积的格式和 1 km² 的分界；形心（矩形、三角形、面积为 0）；测距的中间节点与总长、测面的总面积；画的过程中的标签；提示文案 | Node |
| `measure/useMeasure.test.ts` | 两个工具的 ID 与类型；由工具 ID 得到测量类型；状态跟随输入、推导、删除和清除；鼠标位置单独跟随，没在画时移动鼠标不重新推导；作用域销毁时释放；不在作用域里时抛错 | Node |
| `boundary/BoundaryPanel.test.tsx` | 勾选、取消某一级后改变状态，都不勾选时没有滑块；滑块按百分比显示、拖动时交给拥有者 0～1 的值 | jsdom |
| `boundary/useBoundaries.test.ts` | 初始状态；开关某一级、透明度；值没变时不重新推导；不合法的透明度抛错；每次调用各有一份状态 | Node |
| `region/region-catalog.test.ts` | 目录与市界、县界数据逐条对应；市、区县的数量与所在的市；旧项目写错代码的区县；查找、路径、简称；搜索的规则、顺序与条数 | Node |
| `region/region-geometry.test.ts` | 代码换成 6 位；外包范围；市从市界、区县从县界取，Polygon 与 MultiPolygon；连云港合并；每个文件只读一次；失败不缓存；没有这个区划、结构不对时报错；默认的 fetch 与下载失败 | Node |
| `region/region-style.test.ts` | 没有边界时是空分组；数据源与两个图层；ID 前缀与组合后的校验；每次推导的数据都是新对象 | Node |
| `region/useRegionLocate.test.ts` | 开始时是全省；加载中、到位后的状态与高亮，等视图就绪后定位一次；换选、回到全省后晚到的成功和失败都不写入；回到默认视角；选同一个、不认识的代码；失败与重试；等待就绪与等待失败；作用域销毁；共享的加载器；面板点击的规则（用假的上下文和手动放行的加载器） | Node |
| `apps/web/tools/boundaries/boundaries.test.ts` | 边界数据的转换：文件对应关系、坐标取整与去掉高程、只留名称和代码、去掉 `crs`、原始结构不符合或没有要素时报错 | Node |
| `basemap/basemap-style.test.ts` | 可选的底图与初始状态；每种底图的组成、瓦片地址、缩放范围与透明度；ID 的分组前缀与组合后的校验；改透明度只产生 `setPaintProperty`；切换底图时背景不动；关闭天地图时任何选择都没有天地图 | Node |

- 底图的推导逐一改坏 22 处（关闭时仍给出全部选项或仍建数据源、注记图层用错、少一个子域名、缺少缩放范围、占位符被转义、行列写反、不带 key、背景缺失或在底图上面、注记不跟透明度、影像用矢量的透明度、ID 不带前缀或重复等），全部由断言发现
- 默认视角逐一改坏 10 处、江苏的范围 2 处、页面 2 处，只有"调用时先立即定位一次"测不出来：调用时视图一定还不存在（否则抛错），立即定位什么也不做，行为没有变化。这一处起初暴露了一个隐患——在地图就绪之后调用会在下一次就绪时重置用户的视角——所以加了"视图已存在时抛错"，把只能在页面里调用一次写进代码
- 工具栏逐一改坏 5 处（不跟随当前工具、点击不激活、动作不调用回调、没有回调也可用、不按列表显示），全部发现
- 边界面板逐一改坏 6 处、页面 3 处（按钮不回默认视角、不绑定边界、边界放在注记下面），全部由断言发现；"不绑定边界"起初没被发现，页面测试补了"创建地图时的样式里有哪些图层、按什么顺序"
- 视图接口加 `pitch` 后改坏 2 处（适配器丢掉 `pitch`、默认视角不传），全部发现
- 边界的推导逐一改坏 12 处、拥有者 10 处（初始状态、面板顺序、叠放顺序、透明度不乘基础值或被忽略、县界没有虚线、地址用错、关闭的级别留在样式里、ID 不带前缀、线宽和颜色、相同的值也替换状态、透明度的校验与边界、状态在模块里共享等），全部由断言发现
- 面板逐一改坏 5 处（选择时不调用拥有者、透明度不换算、滑块显示 0～1、无底图时仍显示滑块、选项写死），全部发现；"透明度不换算"起初是 `setOpacity` 抛出的 `RangeError` 直接冒出来，把触发拖动的那一步包进 `not.toThrow()` 后由断言发现
- 拥有者逐一改坏 18 处，起初有 1 处没被发现、1 处的失败原因不是断言："推导不随传入的配置"（关闭天地图的用例选的是无底图，推导结果与配置无关），补了"瓦片地址里是传入的 key"；"透明度的边界写成开区间"时 `setOpacity(0)` 直接抛错，改用 `not.toThrow()` 断言。补上后全部由断言发现
- 起初还有一条"同一种底图的数据源始终是同一个对象"的用例，改坏验证时发现它测的是实现细节：数据源每次都新建时，`diffStyle` 的用例照样通过（style-spec 对数据源做深比较），于是删掉；数据源仍在工厂里一次建好，只是省去重复拼地址
- 测量的推导逐一改坏 13 处、标签 22 处、拥有者 10 处。标签里只有"叉积符号反了"测不出来，它是等价改动：面积和加权和同时变号，比值不变（顺时针、逆时针画的形心相同）。图层的 `filter` 拼错时地图上只是什么都不画，为此用 style-spec 的 `featureFilter` 求值检查；起初只按 `status` 求值，没带几何类型，浏览器里才发现折线下面被填充，改成按每个要素的真实几何类型求值，先复现再修；"测面工具其实是测距"起初没被发现，补了用测面工具加点后检查草稿的类型。其余全部由断言发现
- 测量的浮层逐一改坏 8 处、页面的接线 6 处、工具栏的表 1 处，填充改为只给面之后的 `filter` 7 处。浮层里"提示不看当前工具"起初没被发现（只用测距时测不出），补了换成测面后的提示；画布重建的用例起初没先确认画出了标签，"不登记测量工具"时它比较的是两个空结果，补了前提断言；"投影为 null 时也显示"测不出来，二维的 `project` 不会返回 null，这个判断是给三维（点在地球背面）准备的。其余全部由断言发现
- 区划目录逐一改坏 10 处、边界的加载 13 处。起初有 2 处没被发现："区县排在所有市后面"（搜索的用例只匹配到一个市，补了"州"的结果顺序）、"简称去掉所有的市"（江苏没有名称中间带"市"的区划，补了"市中区"）；"区县也从市界取"起初是代码自己抛错，改成用 `resolves` 断言后由断言发现
- 区划定位的拥有者逐一改坏 20 处、高亮的推导 8 处。起初"加载失败时不看是否中止"没被发现（只测了晚到的成功），补了换选、回到全省后晚到的失败；另有 3 处是改坏的写法本身有误（行尾符不匹配、语法错误、实际没改变行为），重写后全部由断言发现
