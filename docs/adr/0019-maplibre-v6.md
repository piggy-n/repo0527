# 0019. 二维地图用 MapLibre GL JS 6

- 状态：已接受
- 日期：2026-10-09
- 补充 ADR 0002：0002 选定了 MapLibre，把大版本留到地图阶段；本文确定大版本，0002 的其他内容不变

## 背景

ADR 0002 写于 2026-09-29，当时默认倾向 v5 的最后一版 5.24.0，并说 v6（2026-07-22 发布）要读完更新日志再评估。阶段四开始时（2026-10-09）的情况：

| | 情况 |
|---|---|
| v5 | 5.24.0（2026-04-23）之后没有再发过任何 5.x 版本，这条版本线已经停止 |
| v6 | 6.0.0（2026-07-22）到 6.13.0（2026-10-06），13 个小版本，其中 4 个带补丁号；6.0.0 之后的更新日志没有标记破坏性的条目 |
| 旧项目 | mapbox-gl 3.23.0 只创建 `webgl2` 上下文，没有 WebGL1 回退 |

AGENTS.md 对大版本的要求是"等出过几个补丁版本再升"，v6 已经满足。本项目是重写，不需要把旧代码从 v5 迁到 v6，所以 v6 的破坏性改动主要影响新代码怎么写。

## 候选方案

1. v5（5.24.0）：发布时间更长；但版本线已经停止，之后注定要再迁一次 v6
2. v6（`^6`）：仍在维护；事件、样式属性都有了具体的类型；只提供 ESM，要求 WebGL2

v6 的破坏性改动与本项目的关系（完整内容见官方的 v5 到 v6 迁移指南）：

| 改动 | 对本项目 |
|---|---|
| 只提供 ESM，不再支持默认导入 | 项目本来就是 ESM，用具名导入 |
| 使用打包工具时要调用一次 `setWorkerUrl` | app 装配时调用 |
| 必须支持 WebGL2，不支持时构造 `Map` 抛出 `GPUInitializationError` | 旧项目已经要求 WebGL2，用户侧没有新增风险 |
| 事件全部改成类；`Evented<EventType>` 带泛型，`on` / `once` / `off` 按事件名推断参数类型；`get/setPaintProperty`、`get/setLayoutProperty` 有具体类型 | 适配器的事件类型可以从 `MapEventType` 推导，不用手写重载 |
| 移除内部的 `map.transform` | 旧的二三维相机同步用了 `map.transform.centerPoint`，做三维时改用公开 API |
| `styleimagemissing` 只通知，按需提供图片改用 `setMissingStyleImageResolver`（可以是异步函数） | 按需生成填充图案时用新写法 |
| `zoomLevelsToOverscale` 默认值改为 4 | 高缩放级别下 `queryRenderedFeatures` 的结果与旧项目略有不同，点选按 v6 的行为写测试 |
| `GeoJSONSource.setData` 去掉第二个参数，返回 `Promise<void>` | 新代码照此写，并处理它失败的情况 |
| 嵌套的 GeoJSON 属性保留为对象 | 不再对属性做 `JSON.parse` |

## 决定

选方案 2，`maplibre-gl` 的版本范围写 `^6`。安装时 6.13.0 还在 3 天的冷却期内，实际装的是 6.12.0（`^6.12.0`）。

用法约定：

- 只用具名导入，例如 `import { Map } from 'maplibre-gl'`
- 全局设置由 app 在创建第一张地图之前完成：`setWorkerUrl`（Vite 写法见下）和 maplibre-gl 的 CSS。Worker 数量默认是 CPU 核数的一半、最多 3 个（旧项目为地类图斑调到最多 4 个），是否调整到接入真实图层时实测再定，同样由 app 调用 `setWorkerCount`

  ```ts
  import { setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import 'maplibre-gl/dist/maplibre-gl.css';

  setWorkerUrl(workerUrl);
  ```

- 用到 GeoJSON 类型时显式声明 `@types/geojson`：它是 maplibre-gl 的依赖，pnpm 不会把它暴露给 `apps/web`
- 用到样式规范的工具（过滤条件、表达式求值）时安装 `@maplibre/maplibre-gl-style-spec`，版本与 maplibre-gl 依赖的保持一致（6.12.0 依赖 26.4.4），避免打包两份。三维自己解码 MVT 时，`@mapbox/vector-tile`、`pbf` 同样对齐 maplibre-gl 的版本（3.0.0、5.1.2；旧项目用的是 1.x 和 3.x）

## 实测结果

2026-10-09 用临时的验证页实测（6.12.0，验证代码未提交）：

| 项目 | 结果 |
|---|---|
| 开发服务器 | Worker 以模块方式加载（`?worker_file&type=module`）；GeoJSON 数据源在 Worker 里切片后正常渲染，`queryRenderedFeatures` 能查到要素 |
| 生产构建 | 验证页主包 1,025.72 KB（gzip 278.08 KB，基本都是 maplibre-gl）；Worker 打成独立文件 510.70 KB，文件里没有 `import`，预览时单独创建不报错 |
| `tsc -b`（TS 7.0.2） | 通过；`sourcedata`、`click` 的回调参数分别推断为 `MapSourceDataEvent`、`MapMouseEvent`；`getSource<GeoJSONSource>()` 可用 |
| `tsconfig.libs.json` | 在 libs 里写 `?worker&url` 导入报 TS2307（ADR 0018） |
| oxlint 类型感知规则 | 能读取 maplibre-gl 的类型。报出三处：要素的 `properties` 是 `any`；`setData` 返回的 Promise 没有处理；`getPaintProperty` 的返回值可能是表达式对象，不能直接转字符串 |
| Vitest（jsdom） | 能导入 maplibre-gl；构造 `Map` 抛出 `GPUInitializationError` |
| 没有验证到 | 生产预览中的画面，以及 `setData` 之后的重新渲染：验证时 Claude 的窗口在后台，`requestAnimationFrame` 不触发，地图画不出新的帧；生产构建改为单独验证 Worker 文件能否加载 |

另外观察到：`queryRenderedFeatures` 按瓦片返回要素，跨瓦片的面会出现多次（验证页里"南京"出现两次），点选时要按要素 ID 去重。

## 后果

- 好处：使用仍在维护的版本线，以后不用再做一次 v5 → v6 迁移；事件和样式属性的类型由库提供，服务于阶段四"有类型的事件"
- 代价：v6 还年轻、发版很快（两个半月 13 个小版本）。靠 `minimumReleaseAge` 和 CI 把关，`pnpm deps:check` 升级小版本时读一下更新日志
- 代价：体积。maplibre-gl 主模块约 1 MB（gzip 约 278 KB），Worker 另有 510 KB，主模块和 Worker 共用的代码在两边各打包一份。地图页必须按路由懒加载（现有路由已经都是动态导入），不能进入口包
- 代价：不支持 WebGL2 的环境无法显示地图。`GPUInitializationError` 要被捕获并提示，由 map-vue 处理
- 要求：要素属性来自瓦片数据，类型是 `any`，按 AGENTS.md"外部数据先用 `unknown` 接收再收窄"处理
