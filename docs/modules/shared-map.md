# 项目级的公共地图能力（shared/map）

> 状态：5A.3 加入地图状态的提示和江苏的范围；5B.1 加入底图（进行中：目录与推导已完成，拥有者、联调面板和页面接入在后续步骤）。行政区边界、工具栏等公共能力在 5B 陆续加入。分层见 ADR 0027：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue（[map-vue.md](map-vue.md)），这里放要读项目配置、用 Element 和 `SvgIcon` 的公共地图能力。

阶段五的界面后置到 5D 专门设计（[roadmap.md](../roadmap.md)"阶段五"）。这里的组件都是联调用的界面：状态和文案由纯函数决定，组件只负责显示，5D 只换组件，纯函数保留。

## 结构

| 文件 | 内容 |
|---|---|
| `map-status.ts` | `describeMapStatus(viewState, failure)`：由视图状态和失败原因推导要显示的内容（纯函数） |
| `MapStatusNotice.tsx` | 加载中与失败的提示（联调用的界面） |
| `jiangsu.ts` | 江苏省的范围 `JIANGSU_BOUNDS` 与创建地图时的相机 `JIANGSU_CAMERA` |
| `basemap/basemap-style.ts` | 底图目录与推导：可选的底图、初始状态、`createBasemapStyles` 给出两个分组的推导函数（纯函数，ADR 0031） |

## 江苏的范围与进入页面时的定位

- 创建地图时用 `JIANGSU_CAMERA`（沿用旧项目的默认视角 119.5, 33.0, z6.8）
- 本次进入页面后，视图第一次进入 `ready` 时不带动画地 `fitBounds(JIANGSU_BOUNDS)` 一次，然后停止侦听：不同屏幕尺寸下都完整显示江苏，并避开登记过的悬浮元素（ADR 0029）；首次创建或加载失败、重试成功后同样补做；之后再次就绪（重建、恢复）不再定位，保留用户调整过的视角。目前写在现状底图页里，第二个地图页需要时再抽成组合式函数
- 5A 时写成"挂载时等一次 `whenReady()`"，首次失败后重试成功不会再定位，5A 之后改为侦听视图状态。页面测试用 `stubs` 把画布换成注入了假地图的同一个组件（改名，避免替身里的画布又被替换）
- 1280 宽的现状底图上实测：相机从 (119.5, 33.0, z6.8) 定位到 (119.1, 32.98, z6.5)；进入后立刻离开，等待被中止，没有报错
- 第一帧可能先按初始相机画出再跳到适配后的视角，临时底图只有纯色背景看不出来，5B.1 接入天地图后再看是否明显

## 底图（ADR 0031）

全部用天地图，按 `appConfig.tianditu` 决定能选哪些：

| 底图 | `basemap` 分组 | `basemap-labels` 分组 |
|---|---|---|
| 矢量底图 | 背景 + 天地图 `vec` | 天地图 `cva` |
| 影像底图 | 背景 + 天地图 `img` | 天地图 `cia` |
| 无底图 | 背景 | 空 |

```ts
const styles = createBasemapStyles(appConfig.tianditu);
styles.basemapGroup(state);  // 背景和所选底图
styles.labelsGroup(state);   // 所选底图配套的注记
```

- 状态（`BasemapState`）只有选中的底图和每种底图的透明度（0～1），可以直接序列化；透明度同时作用于底图和注记，不影响背景
- 背景是 `basemap-background`（`#F3F5F8`），无论选哪种底图都在最底下：无底图时显示它，瓦片加载中和调低透明度时与它混合
- 天地图的数据源设 `minzoom: 1`、`maxzoom: 18`：2026-10-10 实测 `vec`、`cva`、`img`、`cia` 只有 1～18 级有数据，0 级和 19 级也返回 200，内容是占位图；超过 18 级时放大使用 18 级的瓦片
- 没选中的底图，数据源不在样式里；改透明度只产生 `setPaintProperty`。这一点由 style-spec 的 `diff` 对数据源做深比较保证，与数据源是不是同一个对象无关（改坏验证时发现，见"测试"）
- 关闭天地图（`appConfig.tianditu` 为 `null`，内网部署）时只能选"无底图"，进入时就是它；工厂不建任何数据源，无论状态是什么，推导结果里都没有天地图
- 瓦片地址里的 `{z}`、`{x}`、`{y}` 由 MapLibre 替换，地址用模板字符串拼，不经过 `URLSearchParams`（会把花括号转义）

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
| `map-status.test.ts` | 各状态的显示内容、两种引擎失败、样式失败、没有原因、不是 Error 的原因 | Node |
| `MapStatusNotice.test.tsx` | 引擎失败时显示原因和"重试"，点击后重新创建地图，重试过程不抛错 | jsdom |
| `basemap/basemap-style.test.ts` | 可选的底图与初始状态；每种底图的组成、瓦片地址、缩放范围与透明度；ID 的分组前缀与组合后的校验；改透明度只产生 `setPaintProperty`；切换底图时背景不动；关闭天地图时任何选择都没有天地图 | Node |

- 底图的推导逐一改坏 22 处（关闭时仍给出全部选项或仍建数据源、注记图层用错、少一个子域名、缺少缩放范围、占位符被转义、行列写反、不带 key、背景缺失或在底图上面、注记不跟透明度、影像用矢量的透明度、ID 不带前缀或重复等），全部由断言发现
- 起初还有一条"同一种底图的数据源始终是同一个对象"的用例，改坏验证时发现它测的是实现细节：数据源每次都新建时，`diffStyle` 的用例照样通过（style-spec 对数据源做深比较），于是删掉；数据源仍在工厂里一次建好，只是省去重复拼地址
