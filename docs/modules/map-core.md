# 地图内核（map-core）设计草稿

> 状态：阶段四开始前整理的草稿，还没有实施。内容来自阅读旧项目代码（yzt `master-demo` 836f03b）和讨论，文中的数字都引自旧代码的注释，本项目还没有实测。选型确定后写 ADR，本文随实现改成模块说明。

## 总体思路

- 长期存在、持有资源的对象写成类：引擎、图层、交互工具、Worker 池。计算写成纯函数：几何计算、样式表达式生成、地类分类规则，便于单独测试
- 组合优先于继承：最多一层抽象基类（例如统一管理资源释放），不做 `BaseManager → LayerManager → MvtLayerManager` 这样的多层继承
- 依赖通过构造参数传入（libs 的拆包规则），所有对象在一个地方组装（组合根，预计在 map-vue 的 `MapProvider`）。map-core 不依赖 Vue、Element，不读 store 和全局单例；提示、接口请求、鉴权头由使用方传入
- Manager 只依赖引擎接口，不直接依赖 MapLibre 或 Cesium：jsdom 里没有 WebGL，测试时可以传入假的引擎

## 旧代码

范围：二维在 `src/components/CommonMap`，三维在 `src/views/current-map-new/cesium`。

### 值得保留的设计

| 旧代码 | 模式 | 迁移时的处理 |
|---|---|---|
| `IMapEngine` + `MapboxEngine` | 接口 + 适配器 | 旧的"接口"是普通类，每个方法在运行时抛 `notImplemented`；改成 TS 的 `interface` + `implements`，少实现一个方法编译时就报错。保留"逃生口"（取原生地图实例），但只给确实需要的地方用 |
| `createMapEngine` 的注册表 | 工厂 | map-vue 只能用动态 `import()` 引用 map-cesium，工厂要改成异步 |
| `MapService` 聚合十几个 Manager | 外观 | 保留 |
| `selection/` 拆成 QueryService、Manager、Highlight、Presenter、InteractionController | 职责分离 | 旧代码里拆得最好的部分，作为其他模块的样板 |
| `MvtTileWorkerPool` + `mvtTileWorker` + `tileRenderer` | 对象池 + 调度 | 算法保留，补上消息类型，见下文"Worker 与缓存" |
| Worker 的鉴权头由主线程每次请求时算好传入 | — | Worker 里没有 localStorage；每次现算也避免了 token 刷新后 Worker 拿着旧 token。新代码里由使用方传入取鉴权头的函数 |

### 要改进的地方

1. **Manager 之间互相找**：`MapService` 构造各 Manager 时传入 `getFeatureStateTargets: () => this.business?.getDltbHighlightTargets?.() || []`，注释写着"业务图层 Manager 稍后创建，这里惰性取用"。`?.` 掩盖的是创建顺序的依赖。改为：Manager 之间不直接调用，一方发出有类型的事件；或者把共同依赖的数据抽成单独的对象，构造时显式传入
2. **交互互相询问**：多处传入 `isInteractionBlocked: () => this.measure.shouldBlockInteractions()`。测距、测面、绘制、点选、框选抢同一套鼠标事件，靠互相询问来避让。改为状态模式：交互管理器保证同一时间只有一个激活的工具，切换时旧工具 `deactivate()`、新工具 `activate()`
3. **逐个记着解绑**：`this.boundMapClick = e => ...` 等一串"稳定引用便于解绑"，每加一个监听都要记得在 `destroy` 里解绑。改为注册时就登记释放动作（`DisposableStack` 或 `AbortController`），销毁时一次释放
4. **全局事件总线**：`src/libs/bus.js` 的 `mitt()` 实例，事件名是字符串，没有类型。改为每个对象自己的有类型事件，回调参数的类型由事件表推断
5. **职责和分层**：`PopupManager` 1875 行，要拆；`MapService` 直接导入 `ElMessage`、接口和鉴权服务，违反 libs 规则，改由使用方传入

## 设计模式的落点

| 模式 | 用在哪 |
|---|---|
| 适配器 | MapLibre 引擎、Cesium 引擎 |
| 外观 | 对外提供的地图服务 |
| 工厂 / 注册表 | 创建引擎；按图层类型（MVT、GeoJSON、WMTS 等）创建图层实现 |
| 策略 | 地类分类配色、符号化、测距与测面 |
| 状态 | 交互工具（浏览、测距、测面、绘制、点选、框选） |
| 观察者 | 有类型的事件 |
| 对象池 | Worker 池 |
| 命令 | 绘制需要撤销、重做时 |

## 候选库

同一类问题只保留一个库（AGENTS.md"依赖"），引入前再确认版本和许可。

| 用途 | 候选 | 说明 |
|---|---|---|
| 几何计算 | turf v7 | 按需安装单个包（如 `@turf/bbox`），不用 `@turf/turf` 全家桶，旧代码两种写法混用。GeoJSON 类型来自 `@types/geojson` |
| 坐标转换 | proj4 | CGCS2000 经纬度（EPSG:4490）在 Web 地图上可以近似当作 WGS84 使用；后端给 3 度带高斯投影坐标时用它转换 |
| 样式类型 | maplibre-gl 自带 | `LayerSpecification`、`SourceSpecification` 等由 maplibre-gl 导出，不自己定义 |
| 绘制编辑 | terra-draw | 旧项目自己写了 925 行的 `GeometryDrawManager`；terra-draw 通过适配器支持多种地图引擎，先评估能否替代 |
| Worker 通信 | 手写 / comlink | 路线图的学习点是"有类型的 Worker 消息"，先用可辨识联合手写消息协议，comlink 作为对照 |
| 空间索引 | rbush 或 flatbush | 前端要对大量要素做框选、命中检测时再用；MapLibre 的 `queryRenderedFeatures` 够用就不引入 |
| 分级设色 | simple-statistics + d3-scale-chromatic（或 chroma-js） | 自然断点等统计分级；d3 只安装用到的子包 |
| WKT 转换 | `@terraformer/wkt` | 后端返回 WKT 时再引入 |
| 矢量瓦片解码 | `@mapbox/vector-tile` + `pbf` | 三维自己解码 MVT 时使用（旧项目在用）；它们是 BSD 许可，ADR 0002 禁止的只是 `mapbox-gl` |

面积的口径：turf 的面积是球面近似，三调的图斑面积是椭球面积，两者不同。测面工具用来估算可以；展示图斑面积时直接用后端字段（如 `TBMJ`），不在前端重新计算。

## Worker 与缓存

二维由 MapLibre 自己在 Worker 里解析瓦片，并在内存里缓存（`maxTileCacheSize`），不需要另做。下面说的是三维：旧项目在 Worker 里把 MVT 解码、绘制成图片，作为影像交给 Cesium。

### 旧代码已有的缓存

| 层次 | 做法 | 省掉什么 |
|---|---|---|
| 解码结果 | 每个图层按"z/x/y"缓存解码后的几何（TypedArray），按字节估算占用，超出预算从最早放入的开始淘汰 | 超采样时一张原生父瓦片会被画进最多 256 张子瓦片，有缓存只解码一次 |
| 属性裁剪 | 解码时只保留样式和标注用到的字段；新样式要用的字段超出范围时丢掉缓存重新解码 | 内存：旧注释实测同一张瓦片保留全部 6 个字段要 10MB，只留 2 个字段 1.7MB |
| 并发去重 | 同一张瓦片正在下载时，后来的请求共用同一个 Promise | 重复下载 |
| 样式计算 | 按属性、缩放级、几何类型缓存样式结果；填充图案按图片缓存 | 每个要素重复计算样式 |
| Worker 归属 | 同一张父瓦片固定交给同一个 Worker（第一次出现时交给最闲的） | 各 Worker 重复解码、重复缓存 |
| 延迟终止 | 最后一个图层注销 30 秒后才终止 Worker | 二三维来回切换时缓存丢失 |

预算：总共 256MB，按 Worker 数平分，Worker 内再按图层分摊（旧注释：按张数限制等于没有上限，多缩放几次就会内存溢出）。失败的瓦片不进缓存，否则一次网络抖动会让那块地方一直空着。

### 还能加什么

| 做法 | 省掉什么 | 收益 | 前提与代价 | 建议 |
|---|---|---|---|---|
| 命中时刷新顺序（真正的 LRU） | 来回缩放时被挤掉的瓦片的重新下载和解码 | 取决于访问模式，用旧代码已有的 `stats` 消息看命中率 | 很小：旧代码命中时不调整顺序，实际是先进先出，注释里的"近似 LRU"不准确 | 迁移时顺手改 |
| 持久化原始瓦片（Cache Storage，Worker 里可用） | 刷新页面、下次打开时的下载 | 只省下载，不省解码和绘制（旧注释里大头是解码和绘制，一次 z12 跳转绘制 5.5 秒）；按带宽估算，9MB 的瓦片在百兆内网约 0.7 秒，千兆约 0.07 秒 | 浏览器 HTTP 缓存可能已经在做（旧代码 `fetch` 用默认缓存模式，取决于后端的响应头）；要处理数据更新后的失效（需要后端提供数据版本）、瓦片按权限过滤时按用户区分、会话结束时清理 | 先查后端瓦片的响应头和数据更新频率，测出网络是瓶颈再做 |
| 持久化解码结果（IndexedDB） | 下载和解码 | 不确定：解码后的数据比 pbf 大得多，读出来也要时间 | 同上，加上存储空间 | 先实测，再决定 |
| 缓存绘制结果（ImageBitmap） | 绘制 | 低：Cesium 自己有影像缓存 | 多占内存和显存 | 不做 |

持久化缓存和 AGENTS.md 里待定的持久化方案（IndexedDB + idb-keyval）一起决定：瓦片这种请求与响应成对的数据更适合 Cache Storage，其他业务数据再考虑 IndexedDB。

## 待定问题

- map-core 放在 `libs/` 还是做成 `packages/` 包（roadmap"后续阶段要带上的事项"）
- MapLibre 的大版本（ADR 0002）
- `using` / `DisposableStack`：Vite（Oxc）能否转译、目标浏览器是否支持，要实测，可能需要 polyfill
- 迁移时在 [migration.md](../migration.md) 记下基线 commit
