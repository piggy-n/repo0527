# 阶段四：地图内核

- 完成日期：2026-10-09
- 相关决策：ADR 0018（map-core 放在 libs）、0019（MapLibre 6）、0020（地图会话状态是唯一真相源）、0021（Worker 策略）、0022（样式模型与会话提交）、0023（资源释放、事件与地图运行时）、0024（二三维共用的视图接口）、0025（Worker 通信契约）

阶段四的目标：重新设计地图内核，替换旧项目里"活着的二维地图就是真相源"的结构，为接近无感的二三维切换打基础。先修掉阶段三验收后发现的一批文件管理和会话问题，然后读旧代码、定位置和版本，用八份 ADR 定下二三维关系、样式模型、资源释放、视图接口和 Worker 契约，再按依赖顺序实现地图会话、MapLibre 适配器和 Worker 通信层，并在开发页里用真实的 MapLibre 验证。

整体的阶段划分见 [roadmap.md](../roadmap.md)。本文分两部分：第一部分记录做了什么、每项改动的目的；第二部分按主题整理可以学到的知识、设计理由和替代方案。模块的用法在 [modules/map-core.md](../modules/map-core.md) 和 [modules/utils.md](../modules/utils.md)。

---

# 第一部分：做了什么

## 提交记录

阶段四共 25 个提交（含本文所在的提交），按步骤分组：

| 步骤 | 提交 | 内容 |
|---|---|---|
| 开始前的修复 | `2c311ca`、`d61cc12`、`0c9ea3b`、`4782d54`、`1b16552`、`5fcd7f4`、`e6bcc4c` | 删除流程抽成 `useFileRemoval`、分页总数与页码修正、输入法回车；进入登录页时清理过期会话、退出确认框；测试自动卸载组件；查询表单重新测量；同一时间只能打开一个 `ElMessageBox` |
| 4.0 读旧代码与选型 | `403534d`、`710586d`、`5d62f92` | 地图内核设计草稿与旧代码分析；引入 maplibre-gl 6（ADR 0019），map-core 放在 libs（ADR 0018），记录迁移基线 |
| 4.1、4.2 架构决策 | `bef2d51`、`8f7ba9b` | 二三维关系与 Worker 策略（ADR 0020、0021）；样式模型、资源释放、视图接口与 Worker 契约（ADR 0022～0025） |
| 4.3 地图会话 | `bbe8870`、`94f3664`、`1795d88`、`24115c3` | `diffStyle`、`StyleModel`、`CameraModel`、`MapSession` |
| 4.3 MapLibre 适配器 | `46cd364`、`e09be14`、`e4b032f`、`5198fe7` | `applyStyleCommand`、`MapLibreView`、lint 限制 maplibre-gl 的导入位置、地图运行时与 `/dev/map` 开发页 |
| 开发页与加载策略 | `745f435`、`80f4687` | 开发页面集中到 `pages/dev`；地图资源加载策略的原则 |
| 4.3 Worker 通信层 | `59f5cdb` | `@yzt/utils` 的协议、服务端、客户端、托管 |
| 总结 | `8f3cc22`、本文所在的提交 | map-core.md 改为模块说明；阶段总结，roadmap、migration、AGENTS.md 同步 |

查看某一项的完整改动：`git show <提交号>`。查看整个阶段：`git log --oneline stage-3..stage-4`。

## 阶段四结束时的目录结构

```
apps/web/src/
├─ app/
│  ├─ main.ts               最先引入 core-js 的 Symbol.dispose 与 DisposableStack
│  ├─ map-runtime.ts        地图运行时：setWorkerUrl、maplibre-gl 的 CSS（懒加载）
│  ├─ router/               路由表（withMapRuntime、devRoutes）、路由守卫
│  └─ App.tsx、http.ts、pinia.ts、query-client.ts、session-end.ts、session-sync.ts、layout/、styles/
├─ pages/
│  ├─ login/、file-management/、not-found/、placeholder/
│  └─ dev/                  开发页面：theme（主题预览）、map（地图开发页），只在开发环境
├─ features/
│  ├─ auth/
│  └─ file-management/      新增 useFileRemoval（删除流程）
├─ shared/                  结构不变
└─ libs/
   ├─ ui/                   @yzt/ui
   ├─ map-core/             @yzt/map-core：style、camera、session、view、maplibre
   └─ utils/                @yzt/utils：worker（协议、服务端、客户端、托管、让出）
```

测试：`apps/web` 49 个测试文件、353 个用例（阶段三结束时 196 个），其中 map-core 83 个、utils 46 个；`packages/icons` 35 个用例。

## 改动与目的

### 1. 开始前的修复

阶段三验收后又发现了一批文件管理和会话的问题，做地图之前先修掉：

| 问题 | 修复 |
|---|---|
| 删除确认框打开时离开页面，之后仍能点"确定"删除 | 组件卸载时关闭自己打开的确认框；用户确认后先检查组件是否已销毁 |
| 会话结束（退出、换账号）后，残留的确认框仍可确认删除 | 确认后检查会话是否还是打开确认框时的那一个；token 只是过期时照常请求，由 http 按登录过期处理 |
| 同时删除两个文件，前一个文件的"删除中"状态丢失 | 进行中的状态按文件 ID 记录，不用单个 mutation 的 `variables` / `isPending`；入口对同一文件防重复。删除逻辑抽成 `useFileRemoval` |
| 翻页失败后分页器跳回第 1 页；重新进入列表、条件不变再查询时同样 | 总数和页码修正只用请求结束时、当前条件的结果 |
| 旧分页缓存把页码改小：总数先减后增时；请求失败后保留的旧缓存被当成最新结果；从缓存重新进入后立即翻页失败，总数退回 0 | 只有请求成功（`isSuccess` 且不在请求中）时才更新总数并修正页码；其他时候显示的缓存只在本组条件还没有总数时用来初始化 |
| 输入法选字时按回车触发了查询 | `event.key === 'Enter' && !event.isComposing` |
| `QueryForm` 换行后减少条件，放得下一行也不恢复 | 每次临时去掉统一宽度重新量（`withNaturalLabels`），不再沿用保存的值；按钮宽度变化、条件增减时也重新测量 |
| 本地有过期会话时，第一次登录失败 | 登录请求带着过期 token，被"发请求前检查过期"拦下；进入登录页时路由守卫先结束会话（不提示） |
| 退出确认框在会话结束后残留，确认后仍会退出和提示 | 用户菜单卸载时关闭；确认后检查组件和会话 |

另外：

- 测试用 `enableAutoUnmount` 在每个用例结束后卸载组件（`src/test-setup.ts`），晚到的请求不会落到下一个用例
- AGENTS.md 新增四条规则：确认框随组件卸载关闭并在确认后校验；同一时间只能打开一个 `ElMessageBox`；行内操作的进行中状态按行 ID 记录；回车排除输入法选字

### 2. 读旧代码与选型（4.0）

| 改动 | 目的 |
|---|---|
| 读旧项目的二维、三维和二三维切换代码，整理出值得保留的设计和 8 个要改进的问题（[map-core.md](../modules/map-core.md) 附录） | 先弄清旧结构真正的边界：是 MapLibre 的样式文档，不是"引擎" |
| map-core 放在 `libs/map-core`，不拆成包（ADR 0018） | 不满足拆包条件；引入 map-cesium 时再把 utils、map-core、map-cesium 一起评估 |
| MapLibre 用 6.x（ADR 0019） | 5.x 的版本线已经停止；6.x 的事件和样式属性都有具体类型 |
| 记录迁移基线 `836f03b` | 阶段结束时确认，旧仓库 `master-demo` 在这期间没有新提交 |

### 3. 架构决策（4.1、4.2）

| ADR | 解决的问题 | 决定 |
|---|---|---|
| 0020 | 二三维切换要接近无感 | map-core 持有地图会话状态（样式、相机、当前工具、选择），两个框架都是它的读者；视图上的差异由适配器处理；独有功能按能力声明 |
| 0021 | 二维要不要像三维一样自建 Worker | 二维不自建渲染 Worker（MapLibre 已经在 Worker 里解析瓦片）；自建的 Worker 统一用一套有类型的通信层；瓦片数据服务引擎无关 |
| 0022 | 多个拥有者怎么共同维护一份样式 | 拥有者用纯函数推导分组、整体替换；快照对比得出命令；提交加版本号、同一轮合并通知；视图的生命周期 |
| 0023 | 资源释放和事件 | 标准的 `Disposable` / `DisposableStack`，运行时用 core-js 补齐；事件用 nanoevents；地图运行时由 app 懒加载 |
| 0024 | 二三维到底共用什么 | 共用视图接口（生命周期、相机、输入、拾取、投影），不共用引擎接口；相机事件带 `cause`；不提供原生地图的通用出口；三维样式按清单降级 |
| 0025 | Worker 的契约 | 三层取消、故障语义、所有权转移与晚到结果的释放；瓦片缓存的键和数据所有权 |

写 ADR 之前，对 5 条评审建议和 4 个优化点逐条评估过。对已接受 ADR 的修正写进新的 ADR，原文只在状态行注明：0022 修正了 0020 中选择状态的范围（只存要素身份和高亮数据），0024 修正了 0020 对方案 B 的比较和 0021 中"与二维完全一致"的说法，0025 补充了 0021 的第 3、4 条。

### 4. 地图会话（4.3）

| 模块 | 作用 |
|---|---|
| `diffStyle` | 对比两份样式快照得出命令；GeoJSON 数据按引用比较；去掉缩放范围时改写成删除再添加 |
| `StyleModel` | 按声明的顺序组合分组；提交前校验，失败时整次不生效；版本号与合并通知 |
| `CameraModel` | 二三维共用的相机；事件带 `view` 和 `cause`；`intentRevision` 用来判断切回三维时能否还原精确视角 |
| `MapSession` | 组合样式和相机；构造中途失败时已创建的部分自动释放 |

### 5. MapLibre 适配器（4.3）

分四步完成：

| 步骤 | 内容 |
|---|---|
| `applyStyleCommand` | 一条命令对应一次地图方法调用；支持 9 种，其余返回"不支持"，交给整体重建 |
| `MapLibreView` | 实现二三维共用的 `MapView`：生命周期、样式同步、暂停恢复、出错重建、相机写回、程序定位；依赖窄接口 `MapLike` |
| lint | `no-restricted-imports` 只允许 `libs/map-core/maplibre/` 和 `app/` 导入 maplibre-gl |
| 地图运行时与开发页 | `setupMapRuntime` 懒加载 `setWorkerUrl` 和 CSS，路由用 `withMapRuntime` 包装；`/dev/map` 在真实的 MapLibre 上验证 |

开发页上发现并修复了两个问题，单元测试的假地图都发现不了：传给 MapLibre 的选项带值为 `undefined` 的键时会覆盖默认值（`fitBounds` 算出 NaN）；Vue 的 class 绑定会冲掉 MapLibre 加在容器上的 class。

### 6. 开发页面规范与加载策略

- 开发页面集中到 `pages/dev/<名称>/`：组件 `Dev<名称>Page`，路由名 `dev<名称>`，路径 `/dev/<名称>`，只注册在 `devRoutes`，生产构建不包含；`routes.test.ts` 检查路径与路由名是否对应
- 地图资源的加载策略先定原则：不绑定默认的二维或三维模式，由 app 的解析函数决定；运行时按框架组织并注入；登录页空闲时预加载预测的默认框架。阶段五实测后再写 ADR（[map-core.md](../modules/map-core.md)"地图资源的加载策略"）

### 7. Worker 通信层（4.3）

`@yzt/utils` 的第一部分，所有自建的 Worker 都用它：

| 部分 | 作用 |
|---|---|
| 协议 | 普通的 interface 描述方法、请求和响应；消息是判别联合；错误显式序列化 |
| `serveWorker` | Worker 里的一侧：任务队列与并发上限，排队时取消、执行中中止 `signal`、`checkpoint` 分段让出 |
| `WorkerClient` | 主线程的一侧：按 ID 配对请求，晚到的结果交给 `discard` 释放，端点出错时整体失效 |
| `WorkerHost` | 第一次请求时创建 Worker，崩溃后重建，连续崩溃超过上限后拒绝 |

## 遗留事项

| 事项 | 说明 |
|---|---|
| Manager 没有具体实现 | 原计划的"Manager 体系"只定了设计（Manager 修改会话，拥有者推导分组）；工具、选择两个模型和各个拥有者都还没有使用方，跟着阶段五、六的业务图层、点选、测量一起做（见 roadmap"已完成阶段的调整"） |
| 释放逻辑的重复 | `StyleModel` 和 `CameraModel` 各有约 10 行相同的释放逻辑；出现第三个模型时用组合抽一个小辅助对象 |
| 真实 Worker 在 Vite 下的打包与加载 | 通信层只在 `MessageChannel` 上测过；第一个使用方出现时在 `/dev` 开发页验证，并配置 Worker 入口的 tsconfig |
| 视图进入 `failed` 时的提示 | 阶段五（map-vue） |
| 测试耗时 | `apps/web` 的测试这次约 51 秒（阶段三结束时约 26 秒），新增的用例不足以解释翻倍，阶段五先查原因（同时评估阶段三记下的 `fsModuleCache`） |
| 开启 Dependabot 安全告警 | 阶段三遗留，仍需在 GitHub 仓库设置中手动确认 |

---

# 第二部分：可以学到什么

## 一、面向对象与设计模式

### 1. 接口与抽象类：这一阶段一个基类都没用

阶段计划的学习点是"接口与抽象类的区别"。实际写下来，用到的全是接口：

- **`MapView` 是 interface**：二维的 `MapLibreView` 实现它，以后的三维视图也实现它。旧项目的 `IMapEngine` 是一个普通类，每个方法在运行时抛 `notImplemented`，少实现一个方法要等调用时才发现；TS 的 `implements` 在编译时就报错，而且没有运行时开销
- **抽象类的价值在于共享实现**。这一阶段唯一的共享实现是 `StyleModel` 和 `CameraModel` 里约 10 行的释放逻辑，选择先容忍重复，等第三个模型出现再用组合抽出来。不用继承的理由：TS 只能单继承，基类一旦被"释放逻辑"占掉，以后想共享别的就没位置了；基类的修改会影响所有子类；组合的对象可以单独测试
- **窄接口 `MapLike`**：适配器只依赖自己用到的十几个方法，而不是 MapLibre 的整个 `Map` 类。这是依赖倒置和接口隔离：测试时实现一个假地图就行，不需要 `vi.mock('maplibre-gl')`；`expectTypeOf<MapLibreMap>().toExtend<MapLike>()` 保证真实的 `Map` 满足它，MapLibre 升级后签名不兼容会在类型检查时报出来

### 2. 设计模式落在哪里

| 模式 | 落点 | 要点 |
|---|---|---|
| 适配器 | `MapLibreView` | 把"会话状态"翻译成 MapLibre 的调用；唯一写二维地图的地方 |
| 外观 | `MapSession` | 对外只暴露 `style` 和 `camera`，内部的释放顺序、构造失败的清理都藏在里面；对页面的外观以后在 map-vue |
| 工厂 | `createMap`、`createWorker` 由使用方传入 | 工厂是一个函数参数，不是工厂类：测试换成假对象，生产用默认值；utils 不写死 Worker 的地址 |
| 观察者 | nanoevents | `on` 返回取消函数，可以直接登记进释放栈；emitter 是私有的，外部不能替对象发事件 |
| 命令 | `StyleCommand` 列表 | 样式变化表示成数据，可以对比、可以重放到另一个消费方；不支持的命令有统一的退路（整体重建） |
| 状态 | 视图的生命周期；`WorkerClient` 的 open / crashed / disposed | 每个方法先看当前状态，非法调用直接抛错，而不是到处判空 |

同样是观察者，`StyleModel` 把同一轮事件循环里的提交合并到微任务里通知，`CameraModel` 却同步通知。原因不同：样式的拥有者可能连续提交好几个分组，合并后只对比一次；相机本来每帧只变一次，而且事件里的 `cause` 必须对得上触发它的那次调用，延迟通知就对不上了。

### 3. 唯一真相源与单向数据流

```
拥有者的状态 ──纯函数──▶ 分组 ──提交──▶ 会话 ──对比──▶ 命令 ──▶ 二维视图 / 以后的三维镜像
```

这和 Vue 的"状态 → 渲染"是同一个思路：拥有者不直接写地图，只描述"我想要的样子"，由对比算出要做的改动。好处是：

- 暂停后恢复、首次挂载、出错重建都是同一件事：从"已应用的快照"对比到"当前快照"
- 第二个消费方（三维）不需要知道过去发生过哪些调用，只要读当前状态
- 分组不可变，变化时整体替换，对比时可以先按引用跳过没变的部分；GeoJSON 数据也按引用比较，所以交给会话的数据不能原地修改

旧项目的三维监听二维的 `styledata`，每次取整份样式对比，二维加载瓦片时 5 秒内触发 300 多次，只能用防抖压住。新结构里会话只在提交时通知，而且合并到一次。

### 4. 类还是工厂函数

`MapSession` 原计划写成 `createMapSession()` 工厂函数，实现时改成类，和各部分的写法保持一致。工厂函数真正有优势的场合是：构造需要异步（构造函数不能 `await`）、想隐藏具体类型只暴露接口、或者要根据参数返回不同的实现。这三条这里都不成立。

## 二、资源释放

### 1. `Disposable` 与 `using`

持有资源的对象实现 `[Symbol.dispose]()`，`using x = …` 在代码块结束时自动调用它，抛错时也会调用。项目里有三层支持：

| 层 | 做法 |
|---|---|
| 语法 | `using` 由 Vite（Oxc）降级成 try / finally |
| 类型 | tsconfig 的 `lib` 加上 `esnext.disposable` |
| 运行时 | 目标浏览器还没有 `Symbol.dispose` 和 `DisposableStack`，`app/main.ts` 最先引入 core-js 的两个模块 |

"最先引入"是必须的：类定义里写 `[Symbol.dispose]()` 是计算属性名，类定义执行时就要读 `Symbol.dispose`，晚于任何一个这样的类加载都会出错。

### 2. `DisposableStack.move()`：构造中途失败时的清理

```ts
constructor(options) {
  using stack = new DisposableStack();
  this.style = stack.use(new StyleModel(options));
  this.camera = stack.use(new CameraModel(options.camera)); // 这里抛错时，style 会被自动释放
  this.#stack = stack.move(); // 构造成功：所有权转给实例，块结束时 stack 已经是空的
}
```

释放按后进先出的顺序进行。旧项目有一次崩溃正是顺序问题：路由切换时子组件先 `map.remove()`，父页面后销毁绘制管理器，此时 `map.style` 已是 undefined。用栈登记，后创建的先释放，从结构上避免了这类问题。

### 3. 释放后，等待的人要得到答复

旧项目的 `MapboxEngine.destroy` 用 `splice(0)` 丢掉了 `whenReady` 的 resolver，等待中的 Promise 永远不结束，调用方分不清"还在加载"和"已销毁"。新代码在释放时让等待者以 `AbortError` 结束，和项目里取消请求的做法一致。

随之而来的问题：没人等待的 Promise 被拒绝，会报"未处理的拒绝"。`whenReady()` 内部先给 Promise 挂一个空的 `catch`，再把原 Promise 交出去：没人等时不报错，等待的人照样收到错误。

### 4. 释放后能做什么

`StyleModel` 释放后，提交和订阅会抛错，但读取 `current`、`version` 仍然可以。写入是"还在用它"的信号，说明调用方的生命周期管理有问题，应该尽早暴露；读取不会造成副作用，允许它可以让释放顺序更宽松。

## 三、TypeScript

### 1. `const` 类型参数

```ts
class StyleModel<const G extends string> { constructor(options: { groups: readonly G[] }) }
new StyleModel({ groups: ['basemap', 'highlight'] }); // G 推断为 'basemap' | 'highlight'
```

不写 `const` 时 `G` 会被推断成 `string`，`setGroup('hightlight', …)` 这种拼写错误就查不出来；写了之后，调用方也不需要在数组后面加 `as const`。

### 2. 用映射类型描述协议

```ts
interface TileProtocol {
  decode: { request: { url: string }; response: DecodedTile };
}
request<M extends keyof P>(method: M, payload: P[M]['request']): Promise<P[M]['response']>;
```

方法名是类型参数，参数和返回值由它索引出来，写错方法名或参数都会报错。服务端的处理函数表用映射类型 `{ [M in keyof P]: (payload: P[M]['request'], context) => … }` 描述。

实现内部要按字符串查找处理函数时，需要把处理函数表断言成"字符串到函数"的记录：函数参数按逆变检查，`(payload: string) => …` 不能赋给 `(payload: unknown) => …`。这是少数确实需要断言的地方，代码里写了注释说明原因。

### 3. 判别联合与类型守卫

Worker 消息用 `kind` 字段区分（`request`、`cancel`、`result`、`failure`）。`postMessage` 收到的数据是 `unknown`，先用类型守卫 `isServerMessage` 收窄，再按 `kind` 分支处理；lint 的 `switch-exhaustiveness-check` 要求列出每一种情况，以后加了新的消息类型，漏处理的地方会报错。

### 4. 重载与参数逆变

`MapLike.on` 写了三个重载（`style.load`、`error`、`move`），回调的参数类型各不相同。测试里的假地图要实现它，实现签名的回调参数只能写 `never`：在 `strictFunctionTypes` 下，回调参数按逆变检查，`never` 是唯一能兼容所有重载的写法。

### 5. 类型也要测试

- `expectTypeOf(client.request('echo', 'hi')).resolves.toEqualTypeOf<string>()` 检查推断结果
- `// @ts-expect-error` 写在应该报错的调用上：如果类型变宽、这里不再报错，指令本身就会报"未使用"，测试随之失败
- 窄接口用 `expectTypeOf<MapLibreMap>().toExtend<MapLike>()` 检查真实实现是否满足

### 6. 具名元组

`ViewBounds = readonly [west: number, south: number, east: number, north: number]`：类型完全等同于四个数字的元组，但编辑器的提示里能看到每个位置的含义，经纬度的顺序不容易写反。

## 四、MapLibre 6

### 1. 实测出来的行为

| 行为 | 影响 |
|---|---|
| 选项里值为 `undefined` 的键会覆盖默认值 | `fitBounds` 收到 `maxZoom: undefined` 算出 NaN；适配器先过滤再传 |
| `setLayerZoomRange` 把 `undefined` 当作"不修改" | 去掉已有的缩放范围时，`diffStyle` 改写成删除再添加 |
| `fitBounds` 的 padding 只用于计算 | 会话相机里没有 padding，中心就是画布几何中心 |
| 很多样式方法出错时不抛异常，而是触发 `error` 事件 | "抛错就重建"只兜住一部分；其余由 `error` 事件上报 |
| `load` 要等第一帧渲染，`style.load` 只等样式加载 | 用 `style.load` 作为"可以应用样式"的信号；窗口在后台时 `load` 等不到 |
| 容器尺寸用 `ResizeObserver` 监听 | 隐藏后再显示会自动调整，不用手动 `resize()` |
| 容器上的 class 由 MapLibre 维护 | Vue 的 class 绑定变化时会重设整个 `class` 属性，容器只能用静态 class |

前两条和最后一条都是在开发页上发现的。`toEqual` 把"值为 undefined 的键"和"没有这个键"视为相同，所以单元测试原来没测出第一条，改用 `toStrictEqual` 后补上了。

### 2. 只提供 ESM，Worker 地址由 app 设置

MapLibre 6 只提供 ESM，使用打包工具时要调用一次 `setWorkerUrl`。Vite 的写法 `import workerUrl from '…/maplibre-gl-worker.mjs?worker&url'` 依赖 `vite/client` 的类型，而 `tsconfig.libs.json` 不加载它（libs 不能依赖 Vite），所以这类全局设置都放在 `app/map-runtime.ts`，由路由的 `withMapRuntime` 在进入地图页之前懒加载。登录页不会请求 maplibre-gl。

### 3. 用 `cause` 区分相机变化的来源

二三维相机同步有一个经典问题：三维改了相机，同步给二维；二维的 `move` 事件又写回会话，再同步给三维……旧项目用 260 ms 的时间窗口判断"这次变化是不是我刚才引起的"，这只是猜测：窗口内的用户操作会被当成回声，同步慢于窗口时又会被当成新的变化。新做法是让每次变化带上来源：MapLibre 的 `jumpTo`、`flyTo` 可以带 `eventData`，它会原样出现在随后的 `move` 事件里。适配器同步时带 `{ cause: 'sync' }`，用户拖动时事件有 `originalEvent`，于是每次写回都知道来源，不需要猜。

## 五、Worker 与并发

### 1. 结构化克隆与所有权转移

`postMessage` 用结构化克隆复制数据。函数、DOM 节点不能克隆，会抛 `DataCloneError`：参数无法克隆时主线程同步捕获，只结束这一个请求；结果无法克隆时 Worker 里捕获，改为回复失败。`ArrayBuffer`、`ImageBitmap` 可以转移所有权，转移后发送方手里的缓冲区长度变成 0（测试里就是这样断言的）。

### 2. 取消的三层，以及一个消除不了的窗口

| 层 | 做法 |
|---|---|
| 调用方 | `signal` 一中止，Promise 立即结束，同时发出取消消息 |
| 排队中的任务 | 还没开始就直接移除 |
| 执行中的任务 | 中止处理函数收到的 `signal`，可以直接传给 `fetch` |
| 计算 | `checkpoint()` 让出一次事件循环，再检查是否已中止 |

取消消息在路上时，任务可能已经开始，这个窗口无法消除，只能由"执行中"这一层兜住。任务完成后结果仍可能送达，但请求已经不在等待列表里了；结果消息带着方法名，客户端据此调用 `discard`（例如 `ImageBitmap.close()`）释放，不需要另外记录哪些请求被取消过。

### 3. 为什么要 `checkpoint`

Worker 是单线程的：同步执行的长循环不结束，取消消息就一直排在消息队列里得不到处理。`checkpoint()` 让出一次事件循环，取消消息才有机会被处理。让出的方式选 `MessageChannel`：`setTimeout(0)` 嵌套几层后至少 4ms，`scheduler.yield` 的浏览器支持还不全。

### 4. 错误跨线程

Safari 不支持错误对象的结构化克隆，所以错误显式序列化成 `{ name, message, stack }`，主线程重建为 `WorkerTaskError`，`name` 保留原错误名（`RangeError`、`AbortError` 仍然能按名字判断），Worker 里的调用栈放在 `workerStack`。

### 5. 崩溃与重建

端点触发 `error` 或 `messageerror` 时，所有等待中的请求以 `WorkerCrashedError` 结束，客户端失效。`WorkerHost` 终止崩溃的 Worker，下次请求时新建；连续崩溃超过上限后不再尝试，以 `WorkerUnavailableError` 拒绝；成功一次就重新计数。创建 Worker 本身失败（例如浏览器不支持）不算崩溃：那是环境问题，不是 Worker 代码的问题，重试也没用，但也不该把重建的次数用掉。

### 6. 目标浏览器之外的 API

`AbortSignal.any()` 能把多个 signal 合成一个，但要 Chrome 116、Safari 17.4，不在 Vite 默认的目标浏览器里，所以通信层不用它：每个请求只监听调用方传入的 signal，释放和崩溃时由客户端自己结束等待中的请求。用新 API 之前先查兼容性数据，这一阶段的 Safari 错误克隆、`requestIdleCallback` 也是这样查出来的。

## 六、测试

### 1. 没有 WebGL 时怎么测地图

jsdom 里没有 WebGL，MapLibre 跑不起来。测试分三层：会话部分是纯 TS，直接测；适配器注入实现 `MapLike` 的假地图，测生命周期、版本跟踪、重建、相机写回；渲染、Worker、真实事件在开发页 `/dev/map` 里用浏览器验证。第三层不是可有可无的：本阶段两个真实的 bug 都只在这一层出现。

### 2. 测试里的"Worker"

客户端和服务端分别接在同一个 `MessageChannel` 的两端，结构化克隆、所有权转移、`DataCloneError` 都是真实发生的。两个 jsdom 的坑：

- 不能往真实的 `MessagePort` 派发事件（端口来自 Node，`Event` 来自 jsdom），模拟崩溃用一个包装了端口的 `TestEndpoint`
- `DOMException` 在 jsdom 里不是 `Error` 的实例（浏览器里是），判断错误时要同时认 `instanceof DOMException`，否则 `TimeoutError`、`DataCloneError` 的名字会丢

### 3. 时序

- 测试和"Worker"在同一个线程里，取消消息要等下一个宏任务才送达；测"排队时被取消"要先等它到达，否则测到的其实是"执行中被取消"
- 实现出错时可能一直挂起的等待，都包进 `settled()`（和一个短定时器赛跑），测试因断言失败而不是超时；适配器的测试同样让等待和一个立即完成的 Promise 赛跑

### 4. 改坏测试的收获

| 模块 | 结果 | 收获 |
|---|---|---|
| `MapLibreView` | 改坏 18 处，全部发现 | "释放时取消会话订阅"在行为上测不出来（释放后的状态检查挡住了晚到的通知），改用 `vi.spyOn` 换掉返回的取消函数来确认 |
| Worker 通信层 | 改坏 25 处，24 处由断言发现 | 漏掉的一处是"释放后不移除服务端的消息监听"：消息处理函数开头的检查已经挡住了消息，移除监听只是让对象能被回收。这是纵深防御，记在文档里，不为它写别扭的测试 |
| Worker 通信层 | 5 处起初以超时失败 | 都改成用 `settled()` 等待，现在约 40ms 内以断言失败 |

### 5. 用例之间的隔离

阶段开始前加了 `enableAutoUnmount`：每个用例结束后卸载组件，查询、定时器、`ResizeObserver` 随之停止，进行中的查询被取消，晚到的请求不会落到下一个用例。Element 挂到 `body` 下的弹出层不归组件管，仍要在 `afterEach` 里清空。

## 七、开始前的修复中学到的

### 1. 确认框的生命周期不归组件管

`ElMessageBox` 是挂在 `body` 下的全局弹框，组件卸载时不会跟着关闭。用户在确认框打开时离开页面，再点"确定"，删除照样执行。所以要做两件事：卸载时关闭自己打开的确认框；用户确认后，先检查组件是否已销毁、会话是否还是打开确认框时的那一个。

`ElMessageBox.close()` 会关掉所有确认框，被关掉的按"取消"处理。所以同一时间只能有一个；需要多个并存时，改用渲染在组件内的确认框（如基于 `ElDialog`），随组件卸载自然销毁。

### 2. 行内操作的状态按行记录

同一个 `useMutation` 先后删除两个文件，`variables` 只反映最后一次调用，`isPending` 也不区分是哪一次。表格里"哪一行在删除中"要按行 ID 自己记录，入口对同一行防重复。

### 3. 修正分页只用"成功且已结束"的结果

请求失败后，Vue Query 会保留上一次成功的数据，请求也已经结束。如果把"请求结束"当作"拿到了最新数据"，旧缓存里的总数就会把页码改小。正确的条件是请求成功（`isSuccess`）且不在请求中；其他时候显示的缓存只用来初始化还没有总数的条件。

### 4. 先改再量，在同一段同步代码里完成

`QueryForm` 判断"能不能放一行"时，要量标签按文字宽度时的总宽，而当前的标签可能是统一宽度。做法是临时去掉统一宽度、量完马上恢复，全部在一段同步代码里完成：浏览器只在任务之间绘制，中间状态不会出现在屏幕上（读取尺寸会强制同步布局，但不会触发绘制）。

### 5. 本地的过期会话会拦住登录

"发请求前检查 token 是否过期"上线后，本地有过期会话时，登录请求本身也带着过期的 token，被拦下了，第一次登录失败。修复是进入登录页时由路由守卫先结束会话，不提示。新加的拦截规则要回头检查它会不会拦住不该拦的请求。

## 八、工作方法

### 1. 先读旧代码，再谈设计

阶段开始时没有直接写接口，而是先读旧项目的二维、三维和切换代码，写成分析草稿，再讨论位置和版本。读完才发现旧系统真正的抽象边界是 MapLibre 的样式文档，`IMapEngine` 早就被绕过了（引擎之外有 12 处 `getNativeMap()`）。如果照着旧的引擎接口设计，会把同样的问题再做一遍。

### 2. 写 ADR 之前先评审

六份架构 ADR 在动笔之前，先对 5 条评审建议（提交语义与版本、共享的小接口、三维样式的支持范围、Worker 的取消与崩溃、瓦片缓存的归属）和 4 个优化点逐条评估，同意、修改或说明不采纳的理由。ADR 接受后不再修改，后来发现的修正写进新的 ADR，原文只在状态行注明被哪一份修正，读的人能顺着找到。

### 3. 按依赖顺序一小步一提交

`diffStyle → StyleModel → CameraModel → MapSession → applyStyleCommand → MapLibreView → lint → 开发页 → Worker 通信层`，每一步带测试、单独提交。适配器又拆成四步，每一步先讨论范围（例如"输入、拾取、投影留到交互工具那一步"），避免一次做太多。

### 4. 在真实环境里验证，并用数字说话

- 开发页发现了两个单元测试发现不了的 bug
- `fitBounds` 带 padding 后，量出会话相机的中心偏东 1.35°，和按像素换算的 1.34° 吻合，确认 padding 没有留在相机上
- 开发环境校验样式（`validateStyleMin`）152 个图层一次约 14.8 ms，测量工具每秒提交 60 次时会明显拖慢，所以不做
- 加载策略只定原则，"点击登录 → 地图第一次加载完成"的耗时到阶段五实测后再写 ADR

### 5. 把用户的原则写下来

讨论中提出的原则都写进了文档：接近无感的二三维切换是核心能力（ADR 0020）；框架独有的功能保持独有；加载策略不绑定默认模式（map-core.md）；开发页面的目录和命名规范（AGENTS.md）。原则写下来以后，后面的设计都可以拿它来检验。

## 九、替代方案汇总

| 领域 | 本项目选择 | 常见替代 | 没选的主要原因 |
|---|---|---|---|
| map-core 的位置 | `libs/map-core` | 现在就拆到 `packages/` | 不满足拆包条件；"不依赖 Vue"已经由 lint 和 tsconfig 强制（ADR 0018） |
| 二维地图 | MapLibre 6 | MapLibre 5；mapbox-gl | 5 的版本线已停止，注定还要再迁一次；mapbox-gl 2.0 起为专有许可（ADR 0019） |
| 二三维关系 | 会话状态是唯一真相源，两个框架都是读者 | 活着的二维地图是真相源；自定义引擎无关的图层模型 | 二维必须一直存活、靠监听 `styledata` 和猴子补丁；要重新发明样式规范（ADR 0020、0024） |
| 样式怎么变化 | 分组推导 + 快照对比 | 拥有者直接调用 `addLayer` 等方法 | 第二个消费方无法重放，暂停恢复要自己记录做过的调用（ADR 0022） |
| 二维的 Worker | 不自建 | 像三维一样自建渲染 Worker | MapLibre 已经在 Worker 里解析瓦片，主线程热点要先实测（ADR 0021） |
| 共用的抽象 | 视图接口 | 引擎接口（照着 MapLibre 的 API 转发） | 旧项目的引擎接口被绕过；Cesium 本来就没实现它（ADR 0024） |
| 事件 | nanoevents | mitt；`EventTarget`；自己写 | mitt 的 `on` 不返回取消函数；`EventTarget` 的事件名是字符串；通用问题优先用成熟的库（ADR 0023） |
| 资源释放 | `Disposable` + `DisposableStack` | 每个类各写 `destroy()`；`AbortController` | 标准接口、后进先出、`using` 自动释放；`AbortController` 适合取消，不适合表达所有权 |
| 共享的释放逻辑 | 暂时重复，以后用组合 | 抽象基类 | 单继承的位置只有一个；第三个模型出现前看不清该抽什么 |
| 测试适配器 | 窄接口 + 假地图 | `vi.mock('maplibre-gl')` | mock 绑定模块的内部结构，类型检查也跟着丢了 |
| `MapSession` | 类 | 工厂函数 | 构造不是异步的，也不需要隐藏类型 |
| Worker 通信 | 手写，放在 `@yzt/utils` | comlink | 路线图的学习点；取消和故障语义要自己定（ADR 0021、0025） |
| 让出事件循环 | `MessageChannel` | `setTimeout(0)`；`scheduler.yield` | 嵌套后至少 4ms；浏览器支持不全 |
| 开发环境的样式校验 | 不做 | `validateStyleMin` | 一次约 14.8 ms，高频提交时拖慢；MapLibre 6 的 `error` 事件已经报出同样的位置 |
| 地图资源的加载 | 不绑定默认模式，阶段五实测后定 | 写死"先加载二维" | 客户可能要求默认三维，或按配置动态决定 |

## 十、自测问题

1. 旧项目的 `IMapEngine` 和新的 `MapView` 都叫"接口"，本质区别是什么？为什么这一阶段一个抽象基类都没用？
2. `MapLibreView` 为什么依赖 `MapLike` 而不是 MapLibre 的 `Map`？怎么保证真实的 `Map` 满足它？
3. 同样是观察者，`StyleModel` 为什么合并到微任务里通知，`CameraModel` 却同步通知？
4. 暂停后恢复、首次挂载、出错重建，为什么可以是同一段逻辑？
5. 交给会话的 GeoJSON 数据为什么不能原地修改？
6. `MapSession` 的构造函数里，`using stack` 和 `stack.move()` 各起什么作用？构造到一半抛错时会发生什么？
7. core-js 的两个模块为什么必须在 `app/main.ts` 最先引入？
8. 释放视图时，等待中的 `whenReady()` 为什么要以 `AbortError` 结束？为什么还要先挂一个空的 `catch`？
9. `class StyleModel<const G extends string>` 里的 `const` 起什么作用？去掉会怎样？
10. 二三维相机同步时，怎么区分"用户拖动"和"同步引起的变化"？为什么不用时间窗口？
11. `fitBounds` 收到 `maxZoom: undefined` 为什么会算出 NaN？原来的单元测试为什么没测出来？
12. Worker 的取消分哪几层？取消消息还在路上时任务已经开始，结果送达后怎么处理？
13. Worker 里的长循环为什么要 `await checkpoint()`？为什么用 `MessageChannel` 让出？
14. 错误为什么要显式序列化，而不是直接 `postMessage` 一个 `Error`？
15. `WorkerHost` 为什么不把"创建 Worker 失败"算作一次崩溃？
16. 改坏"释放后移除服务端的消息监听"测试仍然通过，说明了什么？
17. 用户在删除确认框打开时离开页面，再点"确定"，现在会发生什么？为什么同一时间只能打开一个 `ElMessageBox`？
18. 请求失败后为什么不能用当前显示的数据修正页码？
