# 项目级的公共地图能力（shared/map）

> 状态：5A.3 加入地图状态的提示和江苏的范围；5B.1 加入底图（目录、推导、拥有者、联调面板，现状底图已接入）；5B.2 加入行政区边界与默认视角（进行中：数据、推导、拥有者与默认视角已完成，边界的联调面板和页面接入在下一步）。工具栏等公共能力在 5B 陆续加入。分层见 ADR 0027：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue（[map-vue.md](map-vue.md)），这里放要读项目配置、用 Element 和 `SvgIcon` 的公共地图能力。

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
- `goToDefaultView()` 用 500ms 动画按江苏的范围适配，不传 padding（自动避开悬浮元素），旋转归零；视图没有就绪时什么也不做。和旧项目"飞到固定相机"不同，不同屏幕和布局下都完整显示江苏
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
| `pages/current-map/CurrentMapPage.test.tsx` | 页面把缩放范围交给画布；第一次就绪时定位、画布重建后不再定位；失败重试后补做（用假地图） | jsdom |
| `map-status.test.ts` | 各状态的显示内容、两种引擎失败、样式失败、没有原因、不是 Error 的原因 | Node |
| `MapStatusNotice.test.tsx` | 引擎失败时显示原因和"重试"，点击后重新创建地图，重试过程不抛错 | jsdom |
| `basemap/BasemapPanel.test.tsx` | 选择底图后改变状态、无底图时没有滑块；滑块按百分比显示、拖动时交给拥有者 0～1 的值；关闭天地图时只有"无底图" | jsdom |
| `basemap/useBasemap.test.ts` | 默认读取配置；两种配置下的初始状态；切换后推导出所选底图和注记；透明度作用于当前底图、每种底图各自记住；相同的值不触发重新推导；不合法的调用抛错且状态不变 | Node |
| `boundary/boundary-style.test.ts` | 级别与初始状态；数据源是三份文件的地址；三级的叠放、线宽、虚线；透明度乘在基础值上；关闭的级别不在样式里；ID 前缀与校验；改透明度只产生 `setPaintProperty`；开关一级只增删这一级 | Node |
| `boundary/useBoundaries.test.ts` | 初始状态；开关某一级、透明度；值没变时不重新推导；不合法的透明度抛错；每次调用各有一份状态 | Node |
| `apps/web/tools/boundaries/boundaries.test.ts` | 边界数据的转换：文件对应关系、坐标取整与去掉高程、只留名称和代码、去掉 `crs`、原始结构不符合或没有要素时报错 | Node |
| `basemap/basemap-style.test.ts` | 可选的底图与初始状态；每种底图的组成、瓦片地址、缩放范围与透明度；ID 的分组前缀与组合后的校验；改透明度只产生 `setPaintProperty`；切换底图时背景不动；关闭天地图时任何选择都没有天地图 | Node |

- 底图的推导逐一改坏 22 处（关闭时仍给出全部选项或仍建数据源、注记图层用错、少一个子域名、缺少缩放范围、占位符被转义、行列写反、不带 key、背景缺失或在底图上面、注记不跟透明度、影像用矢量的透明度、ID 不带前缀或重复等），全部由断言发现
- 默认视角逐一改坏 10 处、江苏的范围 2 处、页面 2 处，只有"调用时先立即定位一次"测不出来：调用时视图一定还不存在（否则抛错），立即定位什么也不做，行为没有变化。这一处起初暴露了一个隐患——在地图就绪之后调用会在下一次就绪时重置用户的视角——所以加了"视图已存在时抛错"，把只能在页面里调用一次写进代码
- 边界的推导逐一改坏 12 处、拥有者 10 处（初始状态、面板顺序、叠放顺序、透明度不乘基础值或被忽略、县界没有虚线、地址用错、关闭的级别留在样式里、ID 不带前缀、线宽和颜色、相同的值也替换状态、透明度的校验与边界、状态在模块里共享等），全部由断言发现
- 面板逐一改坏 5 处（选择时不调用拥有者、透明度不换算、滑块显示 0～1、无底图时仍显示滑块、选项写死），全部发现；"透明度不换算"起初是 `setOpacity` 抛出的 `RangeError` 直接冒出来，把触发拖动的那一步包进 `not.toThrow()` 后由断言发现
- 拥有者逐一改坏 18 处，起初有 1 处没被发现、1 处的失败原因不是断言："推导不随传入的配置"（关闭天地图的用例选的是无底图，推导结果与配置无关），补了"瓦片地址里是传入的 key"；"透明度的边界写成开区间"时 `setOpacity(0)` 直接抛错，改用 `not.toThrow()` 断言。补上后全部由断言发现
- 起初还有一条"同一种底图的数据源始终是同一个对象"的用例，改坏验证时发现它测的是实现细节：数据源每次都新建时，`diffStyle` 的用例照样通过（style-spec 对数据源做深比较），于是删掉；数据源仍在工厂里一次建好，只是省去重复拼地址
