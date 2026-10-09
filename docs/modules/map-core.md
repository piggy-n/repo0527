# 地图内核（map-core）

> 状态：阶段四完成了地图会话（样式模型、相机）和 MapLibre 适配器（二维视图），并在真实的 MapLibre 上验证过。当前工具、选择状态、输入拾取投影、Cesium 镜像、瓦片数据服务等有了使用方再做（见"还没做的"）。设计依据是 ADR 0018～0026；附录保留阶段四开始前对旧项目（yzt `master-demo` 836f03b）的分析，迁移业务图层、点选、测量时对照。

## 总体思路

- 长期存在、持有资源的对象写成类：引擎、图层、交互工具、Worker 池。计算写成纯函数：几何计算、样式表达式生成、地类分类规则，便于单独测试
- 组合优先于继承：最多一层抽象基类（例如统一管理资源释放），不做 `BaseManager → LayerManager → MvtLayerManager` 这样的多层继承。目前一层也没有用到
- 依赖通过构造参数传入（libs 的拆包规则），所有对象在一个地方组装：页面调用 map-vue 的 `provideMap()` 创建会话、绑定样式（ADR 0028，见 [map-vue.md](map-vue.md)）。map-core 不依赖 Vue、Element，不读 store 和全局单例；提示、接口请求、鉴权头由使用方传入
- 核心能力是二三维之间接近无感的切换：用户在一个框架里的操作和状态，切到另一个框架时尽量保留；框架独有的功能保持独有（ADR 0020）
- map-core 持有地图会话状态（样式模型、相机、当前工具、选择状态），它是二三维共同的唯一真相源。Manager 修改会话状态，不直接写引擎；只有 MapLibre 适配器写二维地图，Cesium 镜像会话状态（ADR 0020）。jsdom 里没有 WebGL，Manager 的测试断言会话状态即可

## 结构

| 文件 | 内容 |
|---|---|
| `style/diff-style.ts` | `diffStyle`：对比两份样式快照，得出命令列表 |
| `style/style-model.ts` | `StyleModel`：按分组组合样式，提交加版本号，合并通知 |
| `camera/camera-model.ts` | `CameraModel`：二三维共用的相机状态，事件带 `view` 和 `cause` |
| `session/map-session.ts` | `MapSession`：组合样式与相机，统一释放 |
| `view/map-view.ts` | `MapView`：二三维共用的视图接口（生命周期、程序定位） |
| `maplibre/map-like.ts` | `MapLike`：适配器用到的 MapLibre 方法（窄接口）；连同方法签名用到的类型从入口导出，map-vue 的测试据此实现假地图 |
| `maplibre/apply-style-command.ts` | `applyStyleCommand`：一条命令对应一次地图方法调用 |
| `maplibre/maplibre-view.ts` | `MapLibreView`：二维视图，唯一写 MapLibre 地图的地方 |
| `events.ts` | `Unsubscribe` 类型 |

只有 `maplibre/` 目录能导入 maplibre-gl（lint 限制，见 [config/oxlintrc.md](../config/oxlintrc.md)），其余文件只用 `@maplibre/maplibre-gl-style-spec` 的类型和函数。

## 用法

```ts
type Groups = 'basemap' | 'business' | 'highlight';

// 装配方声明分组顺序（从下到上）；类型参数带 const，不写 as const 也能推断，setGroup('hightlight', …) 会报类型错误
const session = new MapSession({
  groups: ['basemap', 'business', 'highlight'],
  camera: { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 }
});

// 每个拥有者从自己的状态推导出整个分组，整体替换；GeoJSON 数据换新对象，不原地修改
session.style.setGroup('highlight', highlightGroup(selected));
// 跨分组的修改一次提交，批次不跨 await
session.style.setGroups({ business: businessGroup(layers), highlight: EMPTY_GROUP });

// 二维视图：构造即创建地图，把会话的样式和相机同步上去
const view = new MapLibreView({ session, container, onError: report });
view.on('statechange', state => (viewState.value = state));
await view.whenReady();
view.fitBounds(JIANGSU_BOUNDS, { padding: { top: 40, right: 360, bottom: 40, left: 40 } });

// 切到三维时暂停（不写回相机、不应用样式），切回时恢复并追上
view.pause();
view.resume();

// 释放顺序与创建相反：先视图，后会话
view[Symbol.dispose]();
session[Symbol.dispose]();
```

- 地图页的路由组件用 `app/router/routes.ts` 的 `withMapRuntime` 包装，先加载地图运行时（`setWorkerUrl`、CSS），再加载页面
- 会话和视图不放进 Vue 的响应式状态（Vue 的代理会包住 MapLibre 内部对象），只把要显示的值（视图状态、相机）放进 `ref`
- 在 Vue 组件里不直接创建会话和视图，用 map-vue 的 `provideMap()` 和 `<MapCanvas>`（[map-vue.md](map-vue.md)）：释放顺序、只读的上下文、样式的统一提交都由它负责
- 交给 MapLibre 的容器元素只用静态 class，可变的 class 放在外层元素上（原因见"MapLibre 6 的实测行为"）
- 订阅都返回取消函数（`Unsubscribe`），可以直接交给 `stack.defer()`

## 数据流（ADR 0022）

```
拥有者（底图、业务图层、边界、遮罩、高亮、测量、绘制……）
  自己的状态 ──纯函数推导──▶ 分组 { sources, layers }（不可变，整体替换）
                                   │ setGroup / setGroups（一次提交，版本号加 1）
                                   ▼
              按装配方声明的顺序拼成完整样式；同一轮事件循环的提交合并通知
                                   │ diffStyle(上一份, 这一份)：GeoJSON 数据按引用比较
                                   ▼
              StyleCommand[] ──▶ MapLibre 适配器（唯一写二维地图的地方，记下已应用的快照）
                             └──▶ Cesium 镜像（以后）

相机、当前工具、选择状态：各自独立，各自发事件，变化时不重算样式
```

- 消费方首次挂载、暂停后恢复、按需追上都是"已应用的快照 → 当前快照"的对比；应用某条命令出错时，用当前快照整体重建
- 视图的生命周期：还没创建时是 `idle`（没有视图对象），之后 `initializing → ready ⇄ paused`，另有 `failed`、`disposed`；保留状态、应用变化、统计查询分开控制
- 选择状态只存要素身份和高亮数据，候选列表和详情在 feature 的查询缓存里
- feature-state（如果使用）是会话里的独立通道；填充图案按图案 ID 现场生成，不进状态

视图接口还要加的部分（拾取结果的表面与高度、投影、输入、测量方式、切换时的工具状态）见 ADR 0024；资源释放和事件的写法见 ADR 0023；Worker 的取消分层、故障语义和瓦片缓存的约束见 ADR 0025，通信层的用法见 [utils.md](utils.md)。

## 各部分的实现说明

### diffStyle

- 对比前把 GeoJSON 的 `data` 换成同一个占位值，交给 style-spec 的 `diff`；`addSource` 和退路 `setStyle` 换回真实数据
- 前后都存在且未重建的 GeoJSON 数据源按引用比较，不同就追加 `setGeoJSONSourceData`（放在末尾，这类数据源在整个过程中一直存在）
- 图层去掉已有的 `minzoom` / `maxzoom` 时，改写成"删除图层、按原位置添加"：`setLayerZoomRange` 把 `undefined` 当作"不修改"，撤销不了已有的范围。只加上或修改范围时仍是 `setLayerZoomRange`（参数里的 `undefined` 表示保持不设）

### StyleModel

- 构造时声明分组顺序，类型参数用 `const`，不写 `as const` 也能推断出分组 ID 的字面量联合
- 样式的根属性 `StyleRoot` 去掉了相机字段（`center`、`zoom` 等归 `CameraModel`，否则 diff 会生成 `setCenter` 和它抢相机）
- 提交前先组合并校验：分组 ID 未声明、数据源或图层 ID 重复、图层引用的数据源不存在都会抛错，整次提交不生效
- 所有分组引用都没变的提交被忽略；内容相同的新对象照样加版本号，但对比后没有命令就不通知
- 同一轮事件循环里的提交合并成一次通知（微任务）；通知前先记下快照，监听器里再次提交时，下一次通知从这里开始对比
- 释放后丢弃待发的通知、清空监听器，再提交或订阅会抛错；读取 `current`、`version` 仍然可以

### CameraModel

- 写入时复制并冻结；数值出现 `NaN`、无穷或纬度超出 ±90 时抛 `RangeError`，状态不变
- 不做范围收敛：俯角上限等由各视图应用时处理，再按 `sync` 写回
- 数值都没变时不通知；同步通知，不合并到微任务：相机本来每帧变一次，事件的 `cause` 要对得上触发它的那次调用
- `intentRevision` 只在 `user`、`program` 的变化时加 1：三维切走时记下它，切回时没变，就按 ADR 0024 第 6 条还原离开时的精确视角。它按变化次数计数（拖动一次会加几十，每帧一次 `move`），只能比较前后是否相等，不能当作操作次数

### MapSession

- 用类而不是 `createMapSession` 工厂函数，和各部分的写法一致：构造不是异步的，也不需要隐藏类型，工厂函数没有额外的好处
- 构造时用 `using stack = new DisposableStack()` 登记各部分，成功后 `stack.move()` 把所有权转给实例：中途抛错（例如相机参数不合法）时，已创建的部分自动释放。释放会话就是释放这个栈，按创建的相反顺序释放各部分
- `StyleModel` 和 `CameraModel` 各有约 10 行相同的释放逻辑（已释放标记、`#assertAlive`、清空监听器）。等出现第三个模型（工具或选择）时，用组合的方式抽一个"事件加释放"的小辅助对象；不用继承，以免占掉唯一的一层基类

### MapLibreView

在 ADR 0022、0024 的范围内实现；失败的处理见 ADR 0026。它实现 `MapView`，依赖的是窄接口 `MapLike`（以及 `applyStyleCommand` 用的 `StyleTarget`），签名比 MapLibre 的泛型方法简单；`expectTypeOf<MapLibreMap>().toExtend<MapLike>()` 保证 MapLibre 的 `Map` 满足它，MapLibre 升级后签名不兼容会在类型检查时报错。

**样式同步**：

- 创建地图时直接传入当前快照作为 `style`
- 地图上的样式记为三种结果之一（ADR 0026）：加载中（某个快照正在整体加载）、已加载（即已应用的快照）、加载失败（某个版本，同时记下它的快照）
- 收到通知时，`toVersion` 不大于已加载的版本就忽略；`fromVersion` 等于已加载的版本就直接应用命令；否则对比"已加载 → 当前"
- `applyStyleCommand` 支持数据源和图层的 9 种命令；其余 18 种（样式根属性、相机类、没有公开方法的、`setStyle`）返回"不支持"，交给整体重建。`setGeoJSONSourceData` 的异步失败交给回调
- 遇到不支持的命令、应用时抛错、或应用期间同步收到 `error` 事件（MapLibre 的很多方法校验失败时不抛错，只发事件），命令应用完后用当前快照 `setStyle(…, { diff: false })` 整体重建，等 `style.load` 后再继续。不支持的命令触发重建但不算错误；抛错和 `error` 事件交给 `onError`
- "已加载"只在一次通知的命令全部成功（期间没有 `error` 事件）、或整体加载完成时更新；发起整体重建时不更新
- 加载中收到 `error` 就判定加载失败：整份样式通不过校验时，MapLibre 只发 `error`，不会再有 `style.load`。如果 `style.load` 之后仍然到达，以它为准：把失败时记下的快照记为已加载，再照常激活或追上最新版本，之后继续增量同步
- 加载失败时，会话里已经有更新的版本（加载期间提交的，那时的通知因为还在加载而没有处理）：不进入 `failed`，直接用最新的快照再加载一次，`whenReady()` 继续等待。重新加载放到微任务里：MapLibre 对每条校验错误各发一次 `error`，要等它发完再调用 `setStyle`，否则后面几条会被当成新版本的失败，也避免在它分发事件的过程中重入
- 加载失败的版本不再重试；会话出现更新的版本时重新整体加载（暂停意图时也一样）。每个版本最多整体加载一次，所以不会无限重建；一个不合法的图层会让整个视图进入 `failed`，取舍见 ADR 0026 第 5 条
- "可以应用样式"的信号用 `style.load`，不用 `load`：`load` 要等第一帧渲染（依赖 `requestAnimationFrame`，窗口在后台时等不到），样式方法只需要样式已加载；整体重建后同样触发 `style.load`，共用一个处理函数
- 其他时候收到的 `error` 事件（如瓦片 404）只上报（`onError`，默认打印到控制台）

**相机**：

- 创建时用会话相机；`ready` 时在 `move` 事件里写回会话：有 `originalEvent` 就是 `user`，否则取 `eventData.cause`，都没有按 `program`
- 首次进入 ready 和恢复显示走同一段流程：追上样式（追不上就中止，见"生命周期"）→ `jumpTo(会话相机, { cause: 'sync' })` → 读地图的实际值按 `sync` 写回会话 → 最后才进入 ready。这样初始化期间会话相机的变化会跟过来；地图收敛过的值（创建时就收敛了，那时还没订阅 `move`；或俯角超过上限）也会写回，而且不算意图；收到 `ready` 的监听者读到的已经是地图的实际值。以 `active: false` 创建、加载完进入 `paused` 时不同步，留到恢复显示
- `flyTo`、`fitBounds` 带 `{ cause: 'program' }`
- 暂停期间不写回、不跟随；不订阅会话的相机变化（相机由当前显示的视图驱动）
- `flyTo`、`fitBounds` 只在 `ready` 时可用，否则抛错：定位应由当前显示的视图发起，调用方先等 `whenReady()`
- 从不保留 padding（`fitBounds` 不设 `absolutePadding`），所以 `getCenter()` 就是画布几何中心，会话相机里没有 padding

**生命周期**：

- 构造即创建地图（`initializing`）；创建时抛错（如不支持 WebGL2 的 `GPUInitializationError`）不往外抛，进入 `failed`，由 `whenReady` 和 `statechange` 表达
- `failed` 有两种（ADR 0026 第 4 条）：引擎失败（创建地图或 `setStyle` 本身抛错）不能恢复，之后的样式变化、`error`、`style.load` 都不再改变状态，只能释放后重新创建视图；样式加载失败在出现新版本时自动重新加载，`failed → initializing → ready`（暂停意图时为 `paused`）
- `whenReady()` 表示当前这一轮整体加载的结果。创建地图、整体重建、从 `failed` 重新加载各开始一轮，上一轮已经有结果就换一个新的 Promise；本轮的结局都落在同一个 Promise 上：加载完成后进入 `ready`（运行中重建则是完成并追上之后；暂停期间完成加载时进入 `paused`，和以 `active: false` 创建时一样）就成功，失败就以原因结束，释放就以 `AbortError` 结束。激活中止、失败后改用新版本重试都不结束本轮，同一个 Promise 继续等待。这样恢复显示时触发了重建，等 `whenReady()` 结束后再定位不会遇到 `paused`；重建随后失败，拿到的 Promise 也会失败。从 `failed` 重新加载时，先换 Promise 再发出 `statechange`，监听者拿到的就是这一轮的
- 初始化期间调用 `pause()`，加载完成后进入 `paused`；状态变化发出 `statechange`
- 首次激活或恢复显示时，如果追赶样式触发了整体重建，立即中止激活：首次激活停在 `initializing`，恢复显示停在 `paused`，不同步相机，`whenReady()` 不结束。重建完成（`style.load`）后再激活；重建失败则进入 `failed`，不会先进入 `ready` 再失败
- MapLibre 的事件回调都包一层 `try/catch`，错误交给 `onError`，不让异常打断 MapLibre 自己的事件分发
- `whenReady()` 的 Promise 内部先挂一个空的 `catch`：没人等待时被拒绝不会报"未处理的拒绝"，等待的人照样收到错误
- 释放时取消订阅、`map.remove()`，等待中的 `whenReady` 以 `AbortError` 结束
- 传给 MapLibre 的选项先用 `withoutUndefined` 去掉值为 `undefined` 的键（原因见下文）

**这一步没做的**：输入、拾取、投影、查询留到交互工具那一步；三维期间的按需追上留到做三维时。

### app 的地图运行时与开发页

- `app/map-runtime.ts` 的 `setupMapRuntime()` 负责 `setWorkerUrl` 和 maplibre-gl 的 CSS，可以重复调用；路由用 `withMapRuntime(loadPage)` 包装地图页，先动态导入运行时再加载页面
- 登录页不请求 maplibre-gl；生产产物里没有 maplibre-gl 和开发页，入口包不变
- 开发页 `/dev/map`（`pages/dev/map`，只在开发环境）用本地 GeoJSON 验证过：颜色切换、加上和去掉 `minzoom`（去掉时走"删除再添加"，图层仍在描边下面）、高亮的增删和移动（`setGeoJSONSourceData`）、拖动（`user`）、`flyTo` 与 `fitBounds`（`program`）、暂停后模拟三维改相机再恢复（俯角 70° 收到 60° 按 `sync` 写回，意图版本不变）。5A.2c 起开发页改用 map-vue（见 [map-vue.md](map-vue.md)"开发页验证"），页面拿不到视图的暂停、恢复和直接写相机，暂停与模拟三维的场景暂时去掉，由 `MapLibreView` 的单元测试覆盖，三维阶段加入框架切换后再回到开发页
- `fitBounds` 带 padding 后，会话相机记的是画布几何中心：右侧留 360px 时偏东 1.35°，与按像素换算的 1.34° 吻合

## MapLibre 6 的实测行为

2026-10-09 核实，前六条来自源码和文档，后两条是在浏览器里验证时发现的，单元测试的假地图都发现不了：

- 容器尺寸用 `ResizeObserver` 监听（防抖 50ms），隐藏后再显示会自动调整，文档里"窗口尺寸变化"的说法过时
- `fitBounds` 的 padding 只用于计算，要保留得设 `absolutePadding`
- 很多样式方法遇到问题时不抛错，而是同步触发 `error` 事件（对不存在的图层操作、添加校验不通过的图层、图层重名），所以适配器把应用命令期间收到的 `error` 也当作失败（ADR 0026）
- 整份样式（创建地图、`setStyle(…, { diff: false })`）通不过校验时，只触发 `error`，不触发 `style.load`；校验通过之后的加载过程中抛出的异常会被 MapLibre 吞掉，既没有 `error` 也没有 `style.load`（ADR 0026"后果"）
- `setLayerZoomRange` 把 `undefined` 当作"不修改"：图层去掉已有的 `minzoom` / `maxzoom` 时，这个方法撤销不了
- `setTransition`、`setLayerProperty` 没有公开方法
- **传给 MapLibre 的选项不能带值为 `undefined` 的键**：MapLibre 用类似 `Object.assign` 的方式合并默认选项，`fitBounds` 收到 `maxZoom: undefined` 时默认值被覆盖，算出 `Invalid LngLat (NaN, NaN)`。适配器用 `withoutUndefined` 过滤后再传；测试改用 `toStrictEqual`（`toEqual` 把"值为 undefined 的键"和"没有这个键"视为相同，所以原来没测出来）
- **交给 MapLibre 的容器元素只能用静态 class**：MapLibre 会给容器加 `maplibregl-map` 等 class，它自己的 CSS 依赖它们；容器上的 class 绑定一变化，Vue 就会重设 `class` 属性把它们冲掉。阶段五写 map-vue 时同样遵守

## 测试

| 层 | 内容 | 测试方式 |
|---|---|---|
| 会话 | `diffStyle`、`StyleModel`、`CameraModel`、`MapSession` | 纯 TS，jsdom |
| `applyStyleCommand` | 一条命令对应一次地图方法调用 | 假对象，jsdom |
| `MapLibreView` | 生命周期、版本跟踪、暂停恢复、出错重建、相机读写 | 注入 `createMap` 换成假地图，jsdom |
| 真实 MapLibre | 渲染、Worker、事件、尺寸监听、中心点 | 开发页 `/dev/map`，浏览器 |

- 不用 `vi.mock('maplibre-gl')`：适配器依赖的是 `MapLike`，测试注入实现它的假地图 `FakeMap`。假地图的相机方法立即到位并同步触发 `move`、合并 `eventData`，俯角上限 60 用来模拟 MapLibre 的收敛（创建时同样收敛）
- 假地图的 `on` 要和 `MapLike` 一样写出三个重载（回调参数在 `strictFunctionTypes` 下按逆变检查），实现签名的回调参数用 `never`
- "释放时取消会话订阅"在行为上测不出来（释放后的状态检查挡住了晚到的通知），用 `vi.spyOn(StyleModel.prototype, 'on')` 换掉返回的取消函数来确认
- 等待 Promise 结束的断言和一个立即完成的 Promise 赛跑，避免实现出错时测试以超时失败
- `MapLibreView` 逐一改坏 18 处均被发现；ADR 0026 的修复又改坏 17 处、相机同步改坏 7 处，全部由断言发现。其中"引擎失败后仍处理 `error`"起初没被发现：样式变化入口的检查已经挡住了重新加载，唯一可见的影响是 `whenReady()` 的原因被后来的错误替换，补上了这个断言。之后修复样式恢复的 3 个边界（失败时已有新版本、报错后仍加载完成、激活中追赶失败）又改坏 10 处，"已加载后收到 `error` 也当作加载失败"起初没被发现（原用例只检查了没有重建），补上了"仍是 `ready`、之后照常增量同步"的断言。`whenReady()` 改为按一轮整体加载结束之后又改坏 9 处，全部发现
- 假地图的 `rejectOn` 模拟"只发 `error` 不抛错"，`failOn` 模拟抛错；整体加载的结果由测试手动触发 `style.load` 或 `error`
- 开发页 `/dev/map` 的"提交不合法的图层"和"重新创建视图"在真实的 MapLibre 上验证了两条路径：运行中 `addLayer` 被拒绝 → 整体重建 → 整份样式校验失败 → `failed` → 去掉后自动恢复；用不合法的快照重新创建视图 → 首次加载失败 → 去掉后自动恢复；提交不合法的图层后、重建的那一帧到来之前提交修正 → 旧快照校验失败时直接改用最新快照加载，页面上始终没有出现 `failed`

评估过但没做：开发环境下提交样式时用 `validateStyleMin` 校验。152 个图层校验一次约 14.8 ms，高频更新（测量的橡皮筋每秒 60 次）下即使只在开发环境也会明显拖慢；它的报错位置（如 `layers[150].paint.line-width`）与 MapLibre 6 的 `error` 事件一致，后者已经通过 `onError` 上报。

## 地图资源的加载策略（2026-10-09 讨论确定原则，阶段五实测后写 ADR）

现状：没有预加载。进入地图路由时 `withMapRuntime` 动态导入 maplibre-gl（约 1 MB，gzip 约 278 KB）和 CSS，创建地图时再下载 Worker 脚本（510 KB）；Cesium（旧项目打包后约 4 MB，另有静态资源）还没迁移，按依赖规则只能由 map-vue 动态导入。登录成功后 `await router.replace(角色首页)` 要等页面分块下载并执行完才跳转，所以点完登录会卡一下（参考项目 zhiHuiJiangSu_web 的提交 75402ca 遇到同样的问题，在登录页空闲时 `import()` 主界面来预热）。

原则：

1. **不绑定默认模式**：客户可能要求默认进入三维，或者按配置动态决定。app 里用一个解析函数回答"进入地图时先用哪个框架"，依据可以是部署配置、后端或用户级配置、上次使用的框架；加载和预加载都以它为准。默认框架要登录后才知道时，登录页按"上次使用的框架"或部署默认值预测，猜错只多一次下载
2. **运行时按框架组织**：二维的 `setupMapRuntime`、以后三维的 Cesium 运行时（含 `CESIUM_BASE_URL`）各是一个加载函数，由 app 注入给 map-vue（libs 不能导入 app）。进入地图时只阻塞加载默认框架，另一个按访问路径在后台加载。路由上写死 MapLibre 的 `withMapRuntime` 到阶段五可能被这种注入方式取代
3. **默认三维时二维仍要加载但不阻塞**：ADR 0020 第 7 条，三维期间二维暂时仍充当查询后端，二维视图以 `active: false` 创建；三维点选改用瓦片数据服务后，二维可以推迟到第一次需要时再创建
4. **预加载**：登录页空闲时预加载预测出的默认框架的运行时和地图页代码。`requestIdleCallback` 加超时，Safari 不支持它（MDN 数据：只在预览版里，需要开启开关），用 `setTimeout` 兜底；`navigator.connection` 的 `saveData` 为真或网络为 2G 时跳过（只有 Chromium 内核支持，其他浏览器按正常网络处理）。另一个框架按访问路径加载：鼠标悬停到切换按钮时开始加载，或地图页空闲后、用户用过这个框架时再加载
5. **二维的 Worker 池**：MapLibre 6 的 `prewarm()` 可以提前启动 Worker 池（随之下载 Worker 脚本），但会一直保留到 `clearPrewarmedResources()`，实测收益后再决定
6. **默认三维时的静态资源**：Cesium 的 Worker、Assets 等在运行时从 `CESIUM_BASE_URL` 加载，预加载 JS 模块不会顺带下载它们，做三维时再看是否单独预取
7. **缓存比预加载更重要**：产物文件名带 hash，部署时给 `/assets/*` 设置长期缓存（`immutable`），`index.html` 不缓存，并开启压缩；预加载真正起作用的是第一次访问和每次部署后的第一次访问（阶段七）
8. **用数据决定**：阶段五给"点击登录 → 地图第一次加载完成"打性能标记，在禁用缓存、限速的条件下对比有无预加载，再写 ADR

## 还没做的

有了使用方再做，各项的时机也登记在 [roadmap.md](../roadmap.md) 的"后续阶段要带上的事项"：

| 内容 | 时机 |
|---|---|
| map-vue 的运行时注入、加载策略的实测（`provideMap`、`<MapCanvas>`、`useMap()` 已在 5A.2 完成，见 [map-vue.md](map-vue.md)） | 5D |
| 业务图层、底图、边界等拥有者（Manager），从自己的状态推导分组 | 阶段五、六，迁移现状底图和业务图层时 |
| 当前工具与选择状态两个模型；视图接口的输入、拾取、投影、查询 | 做点选、测量、绘制时 |
| 高亮用 feature-state 还是按要素 ID 过滤的图层 | 做高亮时实测 |
| Cesium 镜像与相机同步、三维样式的支持清单 | 做三维时（`libs/map-cesium`） |
| 瓦片数据服务（基于 `@yzt/utils` 的 Worker 通信层） | 第一个 Worker 真实使用方出现时 |

## 待定问题

- 图例统计的主线程耗时：阶段五用真实数据实测 MapLibre 6，再在后端聚合、Worker 解码属性、按需统计三者中选（ADR 0021）
- 高亮用 feature-state 还是按要素 ID 过滤的图层：做高亮时实测（ADR 0022）
- 三维样式的支持清单：实现镜像之前写出（ADR 0024）
- 椭球面测量用哪个库：做测量时确认（ADR 0024）
- 瓦片是否因用户或权限而不同：2026-10-09 实测瓦片不校验 token，带不带 token 内容相同（[migration.md](../migration.md)"现状底图：接口实测"）；以后会不会按权限过滤仍要向后端确认，再决定缓存键是否包含权限范围（ADR 0025）

已确定：map-core 放在 `libs/map-core`（ADR 0018）；MapLibre 用 6.x（ADR 0019）；地图会话状态是唯一真相源（ADR 0020）；Worker 策略（ADR 0021）；样式模型与会话提交（ADR 0022）；资源释放、事件与运行时装配（ADR 0023）；视图接口（ADR 0024）；Worker 通信契约与瓦片数据服务（ADR 0025）；迁移基线 `836f03b` 已记入 [migration.md](../migration.md)。

---

# 附录：旧代码分析

阶段四开始前整理，内容来自阅读旧项目代码（yzt `master-demo` 836f03b）和讨论，文中的数字都引自旧代码的注释，本项目还没有实测。范围：二维在 `src/components/CommonMap`，三维在 `src/views/current-map-new/cesium`。

## 值得保留的设计

| 旧代码 | 模式 | 迁移时的处理 |
|---|---|---|
| `IMapEngine` + `MapboxEngine` | 接口 + 适配器 | 旧的"接口"是普通类，每个方法在运行时抛 `notImplemented`；改成 TS 的 `interface` + `implements`，少实现一个方法编译时就报错。不再提供取原生地图实例的通用出口，适配器按需提供只读方法（ADR 0024；问题见下文"引擎抽象被绕过"） |
| `createMapEngine` 的注册表 | 工厂 | 不再需要：Cesium 是会话状态的读者，不实现二维的引擎接口（ADR 0020）。map-vue 仍然只用动态 `import()` 加载 map-cesium |
| `MapService` 聚合十几个 Manager | 外观 | 保留 |
| `selection/` 拆成 QueryService、Manager、Highlight、Presenter、InteractionController | 职责分离 | 旧代码里拆得最好的部分，作为其他模块的样板 |
| `MvtTileWorkerPool` + `mvtTileWorker` + `tileRenderer` | 对象池 + 调度 | 算法移到引擎无关的瓦片数据服务（map-core），通信改用 `@yzt/utils` 的有类型通信层，池归实例所有（ADR 0021），见下文"Worker 与缓存" |
| Worker 的鉴权头由主线程每次请求时算好传入 | — | Worker 里没有 localStorage；每次现算也避免了 token 刷新后 Worker 拿着旧 token。新代码里由使用方传入取鉴权头的函数 |

## 要改进的地方

1. **Manager 之间互相找**：`MapService` 构造各 Manager 时传入 `getFeatureStateTargets: () => this.business?.getDltbHighlightTargets?.() || []`，注释写着"业务图层 Manager 稍后创建，这里惰性取用"。`?.` 掩盖的是创建顺序的依赖。改为：Manager 之间不直接调用，一方发出有类型的事件；或者把共同依赖的数据抽成单独的对象，构造时显式传入
2. **交互互相询问**：多处传入 `isInteractionBlocked: () => this.measure.shouldBlockInteractions()`。测距、测面、绘制、点选、框选抢同一套鼠标事件，靠互相询问来避让。改为状态模式：交互管理器保证同一时间只有一个激活的工具，切换时旧工具 `deactivate()`、新工具 `activate()`
3. **逐个记着解绑**：`this.boundMapClick = e => ...` 等一串"稳定引用便于解绑"，每加一个监听都要记得在 `destroy` 里解绑。改为注册时就登记释放动作（`DisposableStack` 或 `AbortController`），销毁时一次释放
4. **全局事件总线**：`src/libs/bus.js` 的 `mitt()` 实例，事件名是字符串，没有类型。改为每个对象自己的有类型事件，回调参数的类型由事件表推断
5. **职责和分层**：`PopupManager` 1875 行，要拆；`MapService` 直接导入 `ElMessage`、接口和鉴权服务，违反 libs 规则，改由使用方传入
6. **引擎抽象被绕过**：`IMapEngine` 照着 Mapbox 的 API 一比一转发（`addLayer(spec)`、`setFilter(expr)`）；`MapboxEngine` 比接口多出 16 个方法（`setPaintProperty`、`setFeatureState`、`addImage`、`project` 等），业务照样调用；引擎之外有 12 处 `getNativeMap()`，测距测面、绘制、区划边界、点选交互都直接拿原生地图；`window.map` 是全局变量
7. **通信渠道太多**：构造时传入的回调、mitt 全局总线、`landuseStyleManager` / `layerSymbolStyleManager` 两个全局单例自带的 `on/off`、`window` 自定义事件 `LAYER_ORDER_CHANGE_EVENT`、`getProps()` 按需读取 Vue 的 props。另有 4 个开关（`enableManagedLayers`、`enableUnifiedFeatureSelection`、`enableAiResults`、`showToolbar`）分出新旧两套点选路径。页面调用地图能力要经过 `CommonMap → MapContainer → MapService` 三层 `defineExpose` 转发 20 多个方法
8. **资源释放靠人记**：
   - `MapService.destroy()` 手写十几个对象的销毁顺序；`init()` 由 `onMounted` 调用但不等待，每个 `await` 之后都要检查 `destroyed`
   - 归属不清导致过崩溃：`GeometryDrawManager` 的注释记录，路由切换时子组件先 `map.remove()`，父页面后销毁绘制管理器，此时 `map.style` 已是 undefined，当时补了一个判断绕过。按后进先出释放（`DisposableStack`）能从结构上避免
   - `MapboxEngine.destroy` 用 `splice(0)` 丢掉 `whenReady` 的 resolver，等待中的 Promise 永远不结束，调用方分不清"还在加载"和"已销毁"。新代码在销毁时让等待者以 `AbortError` 结束，与项目里取消请求的做法一致
   - Worker 池的状态是模块变量，不属于任何实例；消息靠 `type` 字符串区分，没有类型

## 二维与三维的关系

旧注释写着"接入 Cesium 只需新增一个实现 `IMapEngine` 的引擎"，但实际的 `CesiumEngine` 没有实现它，而是另一套接口（`mount`、`setActive`、`getCameraState` / `setCameraState`、拾取）。二三维的协作方式（`useEngineSwitch.js` 的说明是"二维是唯一真相源，三维是它的一面镜子"）：

- 二维地图一直存活；切到三维时只淡出它的画布
- `CesiumStyleMirror` 监听 `styledata`，把二维样式整体照搬到 Cesium：栅格图层变成影像层，矢量图层在前端栅格化，GeoJSON 变成实体。图层勾选、透明度、排序、图例调色、区划裁剪因此不用在三维里再写一遍
- 相机用统一换算后的 `CameraState` 双向同步，带回声抑制
- 三维里点选、框选得到的经纬度交回二维的选择流程，详情面板、候选列表等共用一套
- 三维期间还替换了 `map.setLayoutProperty`，拦截标注图层的显隐（猴子补丁）

所以旧系统真正的抽象边界是 **MapLibre 的样式文档**，不是"引擎"。

新结构（ADR 0020）保留"功能只写一次"，但真相源从活着的二维地图换成 map-core 持有的地图会话状态，两个框架都是它的读者。旧做法在新结构里的位置：

| 旧做法 | 新结构 |
|---|---|
| 三维监听 `styledata`，取整份样式对比 | 会话状态发出细粒度的事件，三维直接订阅 |
| 替换 `map.setLayoutProperty` 压住二维标注 | 二维适配器的视图覆盖，会话状态不变 |
| 测量时把透明的二维画布叠在三维上 | 工具接收统一的指针事件，由当前框架提供 |
| 三维点选先对齐二维相机再查询 | 查询接口，两个框架各有实现；三维先沿用旧做法，以后改用瓦片数据服务（ADR 0021） |
| 手写的表达式求值器 | `@maplibre/maplibre-gl-style-spec` |

## 设计模式的落点

| 模式 | 用在哪 | 现状 |
|---|---|---|
| 适配器 | MapLibre 适配器：唯一写二维地图的地方 | 已实现（`MapLibreView`） |
| 外观 | 对外提供的地图服务 | `MapSession` 组合样式与相机；对页面的外观在 map-vue |
| 观察者 | 地图会话状态的有类型事件：二维适配器、Cesium 镜像、map-vue 都是订阅者 | 已实现（nanoevents） |
| 命令 | 样式变化表示成命令列表，由适配器逐条应用；绘制需要撤销、重做时 | 样式命令已实现（`StyleCommand`） |
| 工厂 / 注册表 | 按图层类型（MVT、GeoJSON、WMTS 等）创建图层实现；不需要引擎工厂 | 迁移业务图层时 |
| 策略 | 地类分类配色、符号化、测距与测面 | 迁移业务图层、测量时 |
| 状态 | 交互工具（浏览、测距、测面、绘制、点选、框选）；视图的生命周期 | 视图的生命周期已实现，交互工具以后 |
| 对象池 | Worker 池，归实例所有、可释放（ADR 0021） | 通信层已实现，池以后 |

## 候选库

同一类问题只保留一个库（AGENTS.md"依赖"），引入前再确认版本和许可。

| 用途 | 候选 | 说明 |
|---|---|---|
| 几何计算 | turf v7 | 按需安装单个包（如 `@turf/bbox`），不用 `@turf/turf` 全家桶，旧代码两种写法混用。GeoJSON 类型来自 `@types/geojson`。测量距离和面积不用 turf 的球面算法（ADR 0024） |
| 椭球面测量 | geographiclib-geodesic | 候选（ADR 0024）：测量方式 `geodesic` 按椭球面计算，做测量时再确认 |
| 样式对比与表达式求值 | `@maplibre/maplibre-gl-style-spec` | 已定（ADR 0019、0022）：版本与 maplibre-gl 依赖的保持一致（6.12.0 对应 26.4.4） |
| 事件 | nanoevents | 已定（ADR 0023）：`on` 返回取消订阅的函数，登记进释放栈 |
| 资源释放的运行时 | core-js（`es/symbol/dispose`、`es/disposable-stack`） | 已定（ADR 0023）：在 `app/main.ts` 全局引入，gzip 约 7.6 KB |
| 坐标转换 | proj4 | CGCS2000 经纬度（EPSG:4490）在 Web 地图上可以近似当作 WGS84 使用；后端给 3 度带高斯投影坐标时用它转换 |
| 样式类型 | maplibre-gl 自带 | `LayerSpecification`、`SourceSpecification` 等由 maplibre-gl 导出，不自己定义 |
| 绘制编辑 | terra-draw | 旧项目自己写了 925 行的 `GeometryDrawManager`；terra-draw 通过适配器支持多种地图引擎，先评估能否替代 |
| Worker 通信 | 手写，放在 `@yzt/utils` | 已实现（ADR 0021、0025，[utils.md](utils.md)）：路线图的学习点是"有类型的 Worker 消息"，不引入 comlink |
| 空间索引 | rbush 或 flatbush | 前端要对大量要素做框选、命中检测时再用；MapLibre 的 `queryRenderedFeatures` 够用就不引入 |
| 分级设色 | simple-statistics + d3-scale-chromatic（或 chroma-js） | 自然断点等统计分级；d3 只安装用到的子包 |
| WKT 转换 | `@terraformer/wkt` | 后端返回 WKT 时再引入 |
| 矢量瓦片解码 | `@mapbox/vector-tile` + `pbf` | 三维自己解码 MVT 时使用（旧项目在用 1.x、3.x）；它们是 BSD 许可，ADR 0002 禁止的只是 `mapbox-gl`。版本对齐 maplibre-gl 6.12.0 依赖的 3.0.0、5.1.2，避免打包两份（ADR 0019） |

面积的口径：turf 的面积是球面近似，三调的图斑面积是椭球面积，两者不同。测面工具用来估算可以；展示图斑面积时直接用后端字段（如 `TBMJ`），不在前端重新计算。

## Worker 与缓存

二维由 MapLibre 自己在 Worker 里解析瓦片，并在内存里缓存（`maxTileCacheSize`），不自建渲染 Worker（ADR 0021）。下面说的是三维：旧项目在 Worker 里把 MVT 解码、绘制成图片，作为影像交给 Cesium。Worker 通信层已经在 `@yzt/utils` 实现（[utils.md](utils.md)），瓦片数据服务将基于它。这些缓存算法将移到引擎无关的瓦片数据服务，供三维栅格化和标注、二维图例统计（实测后决定）、以后的三维点选共同使用（ADR 0021）。缓存键、字段并集、共用下载的计数和数据所有权见 ADR 0025；下面的算法是起点，等第一个真实使用方出现后用真实瓦片验证再定。

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
