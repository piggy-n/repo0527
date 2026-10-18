# yzt 重构（repo0527）

用 Vue 3 + TSX + TypeScript 重写 `C:\WebProject\yzt`（江苏省统一调查监测现状图，master-demo 分支）。
这是学习型重构：迁移的同时学习 Vue 3、TS、架构设计、面向对象与设计模式、monorepo 和前端工程化。

## 协作方式

- 每一步先说明设计理由、替代方案和涉及的知识点，再动手
- 一次推进一个小步骤，不擅自扩大范围；涉及选型的问题先讨论再决定
- 重要决策写成 ADR（`docs/adr/`）；阶段结束时把新结论同步到本文件，并更新 `docs/roadmap.md` 的状态与调整
- 登录页等重要页面先按设计规范出设计稿，确认后再开发；主题与组件库层面的改动用主题预览页（`/dev/theme`）截图确认
- 提交信息使用 Conventional Commits 格式（`feat` / `fix` / `refactor` / `docs` / `chore` 等）
- 本项目需要执行相关自动化测试、类型检查与 lint；地图引擎交互必要时用真实浏览器和页面验证，不以构建通过代替测试通过
- 后端有些级别、有些资源暂时没有数据（瓦片为空、缺字段、接口报错）时，不为适配这种现状调整既定方案，记进 `docs/migration.md` 或 roadmap 的待办

## 技术栈

已确定：

- Vue 3 + TSX（`defineComponent`），不使用 `.vue` 单文件组件（ADR 0001）
- TypeScript strict，Vite，Pinia，Vue Router，Element Plus，pnpm workspace
- Element Plus 组件显式具名导入，样式全量引入 `element-plus/dist/index.css`，语言包用 `ElConfigProvider` 设置
- Vue Router 5，手写路由表，history 模式，不启用文件路由（ADR 0007）
- Pinia 4，只用 setup store
- 只用 TypeScript 7 一个版本；不引入依赖 TS JS API 的工具（vue-tsc、typescript-eslint 等），lint 用 oxlint + oxlint-tsgolint（ADR 0003），规则与依赖方向检查见 ADR 0006
- tsconfig 不开启 `incremental`：TS 7.0.2 的增量检查在 `declare global` 文件变化后会给出过期结果（ADR 0009）
- 二维地图用 MapLibre GL JS 6，只用具名导入；`setWorkerUrl`、CSS 这类全局设置由 app 懒加载完成（登录页空闲时预加载，或首次进入地图时）；禁止引入 `mapbox-gl`（2.0 起为专有许可）（ADR 0002、0019、0023、0061）
- 三维地图用 Cesium，精确锁定版本；同时固定内部 engine/widgets，与发行包的 Worker、类型保持一致（ADR 0002、0064）。3D.1 的独立验证入口是 `/dev/cesium`；app 懒加载运行时、设置资源地址，map-vue 动态加载 map-cesium，四类静态资源随构建部署到 `cesium/`（见 docs/modules/map-cesium.md）
- 距离和面积用 geographiclib-geodesic 按椭球面计算，不另写公式（ADR 0035）；其他几何计算按需安装 turf v7 的单个包，不用 `@turf/turf` 全家桶（ADR 0037）
- 地图内核的事件用 nanoevents；资源释放用标准的 `Disposable` / `DisposableStack`，运行时由 `app/main.ts` 全局引入的 core-js 补齐（ADR 0023）
- 浏览器目标用 Vite 默认值，不兼容旧浏览器，不引入 `@vitejs/plugin-legacy`
- 测试用 Vitest 5 + jsdom + `@vue/test-utils`，配置写在 `vite.config.ts` 的 `test` 字段（ADR 0010）；依赖真实引擎或布局的测试用 Vitest 浏览器模式（Playwright 驱动的 Chromium 无界面版，ADR 0040）
- HTTP 用 axios + zod 4，测试中用 MSW 2.x 模拟接口（ADR 0011）
- 接口数据用 TanStack Vue Query 5 管理，全局关闭失败重试和切回窗口时的自动刷新（ADR 0017）
- 登录密码用 sm-crypto-v2 做 SM2 加密，公钥放在 `.env`；token 过期判断用 jwt-decode；会话存 localStorage（ADR 0015）
- CI 用 GitHub Actions：冻结安装 → 类型检查 → lint → 安装浏览器 → 测试 → 公网、内网构建（ADR 0005、0040）；构建自动清理设计稿副本并检查开发页、入口静态依赖和天地图 key，见 docs/config/vite-config.md

- 偏好（资源图层、底图、边界的选择等）用 IndexedDB 持久化，经 `shared/storage` 的键值接口读写，实现用 idb-keyval；会话仍存 localStorage（ADR 0042）

## 目录结构

```
apps/web/src/
├─ app/        应用装配：入口、路由、Pinia、全局插件、布局
├─ pages/      路由页面，只负责组合 features
├─ features/   按业务域划分：api.ts、queries.ts、store.ts、components/、composables/
├─ shared/     应用内通用：HTTP 客户端、鉴权、存储、通用 composables、查询表单、表格加载状态与类型、加载耗时的标记（perf）、项目级的公共地图能力（map）
└─ libs/       将来可拆到 packages/* 的模块，统一用 @yzt/<name> 导入
   ├─ utils/       @yzt/utils       纯 TS 工具，不依赖框架（目前是 Worker 通信层）
   ├─ ui/          @yzt/ui          Mx* 通用组件（布局、面板、区块、标题，ADR 0016）
   ├─ map-core/    @yzt/map-core    地图内核，不依赖 Vue
   ├─ map-cesium/  @yzt/map-cesium  Cesium 三维
   └─ map-vue/     @yzt/map-vue     地图与 Vue 的衔接
```

- `pages/dev/<名称>/`：开发页面（主题预览 `/dev/theme`、地图开发页 `/dev/map`、资源图层实测 `/dev/resources`），和业务页面分开放。组件名 `Dev<名称>Page`，路由名 `dev<名称>`（值为 `dev-<名称>`），路径 `/dev/<名称>`；只注册在 `app/router/routes.ts` 的 `devRoutes` 里，生产构建不包含；业务代码不导入开发页面。`routes.test.ts` 检查路径与路由名是否对应
- `packages/*`：workspace 内部包，`exports` 直接指向 `src/index.ts`，不单独构建（ADR 0014）；目前有 `@yzt/icons`（图标组件与 SVG 规范化工具）。新建包按 `docs/config/internal-packages.md`
- `apps/web/tools/`：Node 直接运行的 TS 工具脚本（如 `pnpm title:generate`、加载耗时的实测 `measure:map-load`），相对导入写 `.ts` 扩展名，只用可剥离的语法（`erasableSyntaxOnly`）
- `apps/web/public/fonts/`：唯一的字体目录，不入库（ADR 0013），见 `docs/design/fonts.md`

## 依赖方向

- `pages → features → shared → libs`，`app` 可以依赖所有目录
- features 之间不互相导入，需要复用的内容上移到 shared 或 libs
- libs 内部：`utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`；map-vue 只能用动态 `import()` 引用 map-cesium
- 二三维切换由 map-vue 的 `SwitchableMapCanvas` 管理缓存与交接，app 注入运行时准备；上下文只挂当前视图。3D.2c 先用于 `/dev/cesium`，业务样式与工具验收后再接业务页（ADR 0064）
- `utils`、`map-core`、`map-cesium` 不依赖 vue、element-plus、pinia；`map-vue` 不依赖 element-plus、pinia、vue-router，项目配置和地图界面放在 `shared/map`（ADR 0027）
- 应用通过 `@yzt/<name>` 使用 `packages/*`，不用相对路径；包只能依赖外部模块和包内部文件，不能导入应用代码；包同样遵守下面"libs 的拆包规则"
- 同一单元（一个 feature、一个 lib 模块、shared、pages、app）内部只用相对路径；跨单元只用别名，引用 libs 只写 `@yzt/<name>`
- 以上规则由 lint 强制检查（根目录 `.oxlintrc.json` 的 `boundaries/dependencies`），分层有变化时同步修改（ADR 0006）

## libs 的拆包规则（ADR 0004）

- 每个模块只有一个入口 `index.ts`，外部只能从 `@yzt/<name>` 导入，不直接引用模块内部文件
- Worker 的受限例外是 `@yzt/map-core/worker`：只导出引擎无关的瓦片数据能力，不引用主入口、DOM 或 MapLibre；`*.worker.ts` 单独用 `tsconfig.worker.json` 的 WebWorker 环境检查，不混入 DOM 类型（ADR 0066）
- 例外：需要给样式共享 Sass 变量（如断点）时，模块根目录可以有 Sass 入口 `_index.scss`，只放变量，不输出 CSS；应用用 `@use '<name>'` 引用（`vite.config.ts` 的 `loadPaths`，ADR 0016）
- 模块内部只用相对路径，不使用 `@/`
- 不读取 `import.meta.env`、store、router 或全局单例，需要的依赖通过构造参数或函数参数传入
- 模块之间不能循环依赖
- map-core 放在 libs（ADR 0018）；包不能依赖 libs，所以 `utils ← map-core ← map-cesium` 要拆包时一起拆，引入 map-cesium 时评估
- `apps/web/tsconfig.libs.json` 只检查 libs 的源码（不含测试）：不加载 `vite/client` 类型，不配置 `@/*`，读取 env 和使用 `@/` 在类型检查时报错（ADR 0006）；libs 需要的环境类型（如 CSS Modules）单独声明，不能加回 `vite/client`

## 编码约定

### 格式

以根目录 `.editorconfig` + WebStorm 格式化为准：UTF-8、2 空格缩进、120 列、单引号、语句末尾加分号、不加尾随逗号、`if` / `else` 必须带大括号。
完整说明见 `docs/code-style.md`。格式规则只交给一个工具负责，lint 不管格式。
JSX 标签：属性少、值简单、不超过 120 列的保持单行（如 `<ElButton type="primary" onClick={goHome}>`）；一旦换行，第一个属性从下一行开始，每个属性独占一行。

### lint（ADR 0006）

- 规则只分 `error` 和 `off` 两级，不用 `warn`；提交前 `pnpm lint` 必须通过
- 在代码里关闭规则要写明原因：`// oxlint-disable-next-line <规则> -- 原因`；不再需要的关闭注释会报错
- 类的私有成员用 TS 的 `private` 或 `#`，不用下划线前缀

### 注释

- 只说明变量、方法和关键步骤的用途或原因，一行为主，最多两句；不复述代码本身
- 复杂逻辑写成 `docs/` 下的独立文档或 Skill，代码里只留一行注释指向它
- 中文注释结尾不加句号
- 导出的函数和类可以写单行 `/** */` 注释，方便 IDE 悬停提示；类型信息交给 TS，不在注释里重复
- 不写文件头的作者、日期注释，不保留注释掉的旧代码，这些由 git 记录
- JSON 文件不写注释（包括 `.oxlintrc.json` 这类允许 JSONC 的文件），配置说明写在 `docs/config/` 对应的文档里

### 依赖

- 通用问题优先用成熟稳定的库，不重复造轮子：比如 `lodash-es`（判断、防抖节流、深拷贝）、`tippy.js`（提示交互）
- `lodash-es` 按需具名导入，例如 `import { debounce } from 'lodash-es'`，保证未用到的函数能被 tree-shaking 掉
- 媒体查询、尺寸监听这类组合式工具用 `@vueuse/core`，同样按需具名导入；版本与 element-plus 内部依赖的版本保持一致，避免打包两份（见 `docs/config/package-json.md`）
- 原生语法已经足够清晰时直接用原生，例如 `?.`、`??`、`Array.isArray`、`Object.entries`
- 引入新依赖前先确认现有依赖里没有同类库，同一类问题只保留一个库

### 语法

- 优先用现代 ES 语法：解构、展开、箭头函数、模板字符串、可选链、空值合并、`async` / `await`
- 可读性优先：解构用于给值起有意义的名字，不为了缩短代码写多层嵌套解构或长串三元表达式
- 只用 `const` / `let` 和 `===`

### TypeScript 与 Vue

- 避免 `any`；外部数据先用 `unknown` 接收，再收窄类型；只用于类型的导入写 `import type`
- 组件用 `defineComponent` + TSX，样式用 `*.module.scss`
- 不挂 `globalProperties`，不用 `getCurrentInstance().proxy`，不往 `window` 上挂对象，不使用 API 自动导入；依赖一律显式 `import` 或通过 provide / inject 获取
- 跨组件通信按 props / emit → provide / inject → Pinia 的顺序选择，不使用无类型的字符串事件总线
- TSX 中插槽函数的参数要手动标注类型：Vue 的 JSX 类型不会按组件的 `SlotsType` 推断插槽参数，也不检查插槽名（ADR 0003）
- TSX 中双向绑定写 `modelValue` + `onUpdate:modelValue`，不用 `v-model`：`v-model` 的值不做类型检查
- 路由表在 `app/router/routes.ts`；路由名常量在 `shared/router/route-names.ts`，跳转写 `{ name: RouteName.xxx }`，不写路径字符串；页面级参数用路由的 `props` 传入，不放在 `meta` 里
- 页面权限写在路由 meta 上：不登录也能访问的页面加 `public: true`，限定角色写 `roles`；不另外维护路径清单。`routes.test.ts` 列出了全部公开页面和限定角色的页面，修改时同步更新（ADR 0015）
- 切走时要保留状态的页面在路由 meta 写 `keepAlive: true`，由 `AppLayout` 里常驻的 `KeepAlive` 缓存，布局卸载（回到登录页）时清空；`routes.test.ts` 列出缓存的页面（ADR 0063）。被缓存的页面里量尺寸用 `shared/composables` 的 `useShownElementSize`，不直接用 `useElementSize`（停用期间量到 0，恢复的第一帧会按 0 排版）；停用时要结束的临时交互用 `usePageActive`
- 顶部导航配置在 `app/layout/menus.ts`，导航项的权限从路由 meta 读取，不在菜单里另写角色；新增业务页时先加路由再加导航项
- 登录会话只通过 `shared/auth` 的 `useSessionStore` 读写，不直接读写 localStorage 中的 token
- 需要持久化的状态由拥有者接收页面提供的偏好范围（`shared/storage`），用共用的流程恢复和写入，不直接调用 idb-keyval 或 localStorage；存下的值读出时用 zod 校验（包括自洽），按拥有者的规则合并，不直接使用（ADR 0042）
- 结束会话（退出、过期、其他标签页退出）统一调用 `app/session-end.ts` 的 `endSession()`（同时清空查询缓存），不要只调用 `session.clear()`；跳转和提示由调用方负责，见 `docs/modules/auth.md`
- 界面与逻辑分离：表单、提交这类交互逻辑写成组合式函数（`features/<域>/composables/useXxx`，通用的放 `shared/composables`），组合式函数不渲染、不跳转、不弹提示，这些由组件和页面决定（见 `docs/modules/auth.md` 的登录三层）
- `computed` 不抛异常：可能失败的计算把失败表示成数据（结果对象），或者放在调用方的 `try/catch` 里直接计算。Vue 3.5 中 `computed` 抛错时，异常在调度器检查依赖时抛出，读取方的 `try/catch` 接不住；之后依赖不变时再读取，返回上一次成功的旧值（ADR 0028 背景第 8 条）
- 组合式函数发起的请求在作用域销毁时（`onScopeDispose`）取消，请求返回后再检查一次是否已取消：晚到的结果不写入会话、store 等共享状态，被取消的请求不显示错误。写法见 `useLoginForm`，原因见 `docs/modules/auth.md` 的登录表单
- 新的操作先作废上一次，再做可能失败的准备（如点选的规划）；准备出错也是这次操作的失败，进入失败和重试，不抛给调用方（写法见 `features/resource-map/composables/useFeaturePick.ts` 的 `execute`）
- 异步按 ADR 0039 分类：能写成状态收敛的不写成操作；可替换操作（同一件事的先后请求，如定位、查询所在区县）在同一通道里后发覆盖先发，用 `@yzt/utils` 的 `LatestController`，不手写递增计数；服务端写操作（删除、保存）不适用，按业务防重复、串行或允许并发，不随组件卸载取消
- 命名：状态快照的序号叫 revision（只增不减，比较新旧）；一次意图用信号表示（operation，只能作废，不比较大小）；version 只用于外部格式（样式规范的 `version: 8`、依赖版本）（ADR 0039）
- 加载状态用 `shared/composables` 的 `useDelayedFlag` 延迟显示，防重复提交的标志仍立即生效
- 加载耗时用 `shared/perf` 的 `LoadTrace` 标记（User Timing，留在产物里、不上报），登录到地图的步骤清单和实测脚本的 `STEPS` 由测试保证一致；改加载方式（预加载、拆分块、换框架）前后用 `measure:map-load` 实测，几种做法用 `--builds` 交替比较，模拟第一次访问用新的浏览器上下文、不禁用缓存（ADR 0061，见 `docs/modules/perf.md`）
- 确认框（`ElMessageBox`）不随组件卸载关闭：组件卸载时关闭自己打开的确认框；用户确认后，先检查组件是否已销毁、会话是否还是打开确认框时的那一个，再执行操作（写法见 `features/file-management/composables/useFileRemoval.ts`）
- 同一时间只能打开一个 `ElMessageBox`：组件卸载时只能用 `ElMessageBox.close()` 关闭，它会关掉所有确认框，有多个时会把别处的一起关掉、对方按"取消"处理；需要多个弹框并存时，改用渲染在组件内的确认框（如基于 `ElDialog`），随组件卸载自然销毁
- 表格行内操作（如删除）的进行中状态按行 ID 记录，不用单个 mutation 的 `variables` / `isPending` 判断是哪一行；操作入口对同一行防重复
- 回车触发提交或查询时排除输入法选字：`event.key === 'Enter' && !event.isComposing`
- `ElColorPicker` 拖动时的 `active-change` 只设临时预览，确认（`change`）才写入；它没有关闭事件，Esc、点外面时把颜色重置回 `modelValue` 并再发一次 `active-change`，所以由拥有者规定"预览等于确认过的值就是没有预览"，`modelValue` 绑确认过的值、不含预览；取色器随组件卸载时什么也不报，编辑器卸载、换了目标时丢弃自己目标的预览（ADR 0044，写法见 `features/resource-map/components/SymbolEditor.tsx`）
- 列表的加载状态按 `docs/modules/table.md` 区分：没有数据时用 `shared/table` 的 `TableSkeleton`，显示着旧数据时用延迟遮罩，后台刷新当前条件的缓存不提示；遮罩不要直接跟着 `isFetching`
- 给组件传 `id` 等未声明的透传属性会报类型错误（组件只接受声明的 props 和 `class`、`style`），需要标记时用 `data-*`
- 拖动排序用 `shared/composables` 的 `useSortableList`，不直接导入 `sortablejs`（测试模拟放下时除外）：放下后由它还原 DOM，顺序交给拥有者，Vue 按数据重新渲染；只能按住手柄拖，手柄同时支持上下方向键（ADR 0054）
- `useVirtualList` 这类把数据放进深层 `ref` 的工具，给出的行是响应式代理；交给按对象身份比较的拥有者（如点选的 `choose`）前按序号取原数组里的对象；同一个虚拟列表先后显示两轮结果时容器不重新挂载、滚动位置保留，新一轮按列表的身份显式回到顶部（写法见 `features/resource-map/components/FeatureDetailPanel.tsx`）

### 测试

- 测试文件和源文件放在一起，命名 `*.test.ts` / `*.test.tsx`；显式从 `vitest` 导入 `describe`、`it`、`expect`，不开 `globals`
- 浏览器测试命名 `*.browser.test.{ts,tsx}`（ADR 0040）：只写依赖真实引擎或真实布局的行为，能用假对象测的仍写普通测试；只用本地数据，不请求后端和天地图；`whenReady()` 只表示整体加载完成，验证画面要等渲染条件（如 `idle` 之后查到目标要素）；要等的事件在触发操作前登记，可能挂起的等待和超时赛跑，结束后清理监听和定时器；每个用例自己创建容器、会话和视图，结束时释放并移除容器（同一文件的用例共用一个页面）
- 不用 DOM 的测试文件（纯逻辑、libs 的会话与 Worker 通信层、`tools/` 脚本）第一行写 `// @vitest-environment node`：默认的 jsdom 每个文件要多花约 1 秒创建（见 `docs/config/vite-config.md` 的"测试耗时"）
- 工具函数、鉴权、HTTP 错误处理这类纯逻辑要写测试；页面和组件测试关键交互
- pages、features 的测试用 `createMemoryHistory()` 建只含所需路由的最小路由，不导入 `app` 的路由表（测试文件同样受依赖方向约束）；`app` 自己的测试可以用真实路由表，例如检查导航与路由权限是否一致
- 模拟环境变量用 `vi.stubEnv`，用例结束后会自动撤销（`unstubEnvs`）
- 模拟接口用 MSW 的 `setupServer()`，并设置 `onUnhandledRequest: 'error'`；不用 `vi.mock('axios')`；依赖第三方类的代码（如 MapLibre 适配器）依赖自己定义的窄接口，测试注入实现它的假对象，并用 `expectTypeOf` 检查真实的类满足它，不用 `vi.mock` 整个库
- 测试写完后，故意改坏被测代码，确认测试会失败，并确认失败原因是断言而不是代码报错或超时（可能一直挂起的等待要和必然更晚结束的等待赛跑：只经过微任务的用 `setTimeout(0)`，经过消息往返的按轮数推进事件循环，不用固定时长，见 `docs/modules/utils.md` 的测试）；修 bug 时先写能复现问题的测试
- `vite.config.ts` 的 `test.server.deps.inline: ['element-plus']` 不能删：不加的话 Element 表单的校验在测试中永远通过（见 `docs/config/vite-config.md`）
- 不提交 `.only`：lint 的 `vitest/no-focused-tests` 会报错，CI 中 Vitest 也会拒绝运行
- `mount` 挂载的组件在每个用例结束后由 `src/test-setup.ts` 自动卸载（`enableAutoUnmount`），不用逐个 `unmount()`；Element 放在 `body` 下的弹出层不归组件管，挂到 `body` 的测试仍要在 `afterEach` 里清空它

### Pinia

- 只用 setup store：`defineStore('id', () => { ...; return { ... } })`；全部 state 都要 return，否则 devtools 和插件看不到；需要重置时自己写 `reset`
- 命名 `useXxxStore`；业务域的 store 放在 `features/<域>/store.ts`，跨域共用的放在 `shared/`
- 只放跨组件共享的客户端状态；组件内部状态留在组件里，接口数据不放进 store
- 解构 state 和 getter 用 `storeToRefs`，action 可以直接解构
- store 不做路由跳转和 UI 提示（不用 `useRouter`、`ElMessage`），由调用方处理
- 每个 store 文件末尾加 HMR：`if (import.meta.hot) { import.meta.hot.accept(acceptHMRUpdate(useXxxStore, import.meta.hot)); }`；不加的话，修改 store 后页面会继续使用旧的 store 实例
- `app/main.ts` 中 pinia 要先于 router 安装

### 配置与环境变量

- 路径别名只在 tsconfig 的 `paths` 中配置，Vite 通过 `resolve.tsconfigPaths` 读取，不另配 `resolve.alias`
- 自定义环境变量只在 `shared/config/app-config.ts` 中读取和校验，其他代码使用 `appConfig`；Vite 内置的 `DEV`、`PROD`、`MODE`、`BASE_URL` 可以直接读取。新增变量要在 `shared/config/import-meta-env.ts` 中声明类型
- `VITE_` 开头的变量会写进构建产物，不能放密钥；只给 `vite.config.ts` 用的变量不加 `VITE_` 前缀
- 接口请求走同源的 `appConfig.apiBaseUrl`（`/backend`），由 Vite 或 nginx 转发到后端（ADR 0008）
- 天地图只通过 `appConfig.tianditu`（`{ key } | null`）使用；为 `null` 时不发任何公网请求，界面上也不出现依赖天地图的选项（ADR 0031）
- 内网与公网的差异只写在 `.env.intranet`（`pnpm build:intranet`、`dev:intranet`），代码只读 `appConfig`，不判断模式名；区分生产与开发用 `PROD` / `DEV`，不用 `MODE`（ADR 0032）

### 接口请求（ADR 0011，用法见 `docs/modules/http.md`）

- 接口函数写在 `features/<域>/api.ts`，统一用 `shared/http/client.ts` 的 `http.get / post / put / delete`，不直接使用 axios
- 每个请求都传 zod schema，返回值类型由 schema 推断（`z.infer`），不另外手写 interface；对象中可能缺失的字段写 `.optional()`（zod 4 中 `z.unknown()` 字段默认必填）
- 失败时抛出 `ApiError`，按 `kind` 区分；接口函数里不弹提示，全局提示由 app 注入，需要自己处理时传 `silent: true`
- 成功时没有 `{ code, msg, data }` 外层的接口（如要素查询）传 `envelope: false`，schema 描述整个返回体；失败时的信封仍按业务码转成 `ApiError`（ADR 0047）
- 支持取消的场景把 `AbortSignal` 传给接口函数
- 查询和变更写在 `features/<域>/queries.ts`，用 TanStack Vue Query 的 `useQuery` / `useMutation`；`queryFn` 把收到的 `signal` 交给接口函数，组件不直接拼 query key；接口数据由查询缓存持有，不放进 Pinia，组件里也不另存一份
- shared/http 不依赖路由、UI 和鉴权，这些由 `app/http.ts` 通过 `configureHttp` 注入
- `useQuery` 的 key 变化后，`data` 要到下一轮调度才换成新 key 的结果；同步读取或在侦听里要知道结果属于哪个 key 时，用 `select` 给结果标上 key 再比较（写法见 `features/resource-map/queries.ts` 的 `useFeatureDetailQuery`）

### 地图（ADR 0020～0063，总览见 `docs/modules/map-overview.md`，设计见 `docs/modules/map-core.md`、`docs/modules/map-vue.md`、`docs/modules/shared-map.md`）

- map-core 持有地图会话状态（样式模型、相机、当前工具、选择状态），它是二维和三维共同的唯一真相源；Manager 修改会话状态，不直接写引擎
- 样式按分组推导：每个拥有者用纯函数从自己的状态推导出分组并整体替换；跨分组的修改用一次 `setGroups` 提交，批次不跨 `await`；交给会话的 GeoJSON 数据和样式图片不能原地修改，要换新对象（ADR 0022、0045）
- 地图能力按 ADR 0027 分层：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue，项目级的公共能力（底图、行政区、工具栏界面）在 `shared/map`，业务数据驱动的图层在 feature，页面挑选组合；用组合，不做带开关的全能地图组件。一项能力放哪一层看它是否属于某个业务域，不看有几个使用方
- 页面用 `provideMap()` 创建会话，用 `map.bindStyle()` 把拥有者的推导函数（`() => StyleGroup`）绑定到分组，只能在同一个组件的 setup 里绑定；拥有者不提交样式，"不显示"用推导结果返回空分组表达（ADR 0028）
- 引用别的分组数据源的推导，要依赖被引用方的状态，保证两者在同一轮变化、一起提交；拥有者的数据源、图层和样式图片的 ID 以分组名为前缀（ADR 0027、0028、0045）
- `shared/map` 和 feature 的地图能力按"拥有者"写（ADR 0031）：组合式函数持有状态（`shallowRef`，整体替换，值没变时不替换）并提供操作（参数不合法时抛错），推导分组的是纯函数；面板等界面通过 props 拿到拥有者，只显示和调用
- 默认视角 `useDefaultView(map)` 只在 `provideMap` 所在组件的 setup 里调用一次，其他组件通过 props 拿到 `goToDefaultView`（ADR 0033）
- 用户发起的定位是一次相机操作，作废之前没完成的定位：用上下文的 `runCameraOperation(camera => ...)` 执行；要先异步准备数据的，开始时 `const operation = beginCameraOperation()`，准备好、确认自己的请求没过期后 `operation.run(camera => ...)`；页面初始化的定位用 `currentCameraOperation().run(...)`，不开始新的操作。等就绪、跨视图失败等待、等待后的再确认都由 `run` 负责；每个操作只能 `run` 一次；回调拿到的相机控制只在回调期间有效，不要存下来。不要用相机变化判断请求是否过期（ADR 0038、0039）
- 上下文的 `view` 只在视图就绪时有值，只有 `kind`、`pick`、`project`、`queryRendered`；浮层只判断 `view` 是否为 `null`，不另外判断 `viewState`（ADR 0039）
- 和当前工具无关的鼠标位置（如状态栏的经纬度）用上下文的 `pointer`（工具模型的输入事件，一帧最多更新一次），不自己监听画布或原生地图的鼠标事件（ADR 0053 第 5 节）
- 异步操作在每个等待点（`await`）返回后都要重新确认自己仍然有效（信号没有中止、仍是最新的请求），再继续执行：等待会因中止而结束，不等于返回时一定没中止
- 交互工具用 `map.registerTools()` 在页面的 setup 里登记，同一时间只有一个当前工具；工具声明光标和手势，只由适配器应用；工具只拿到 `ToolView`（`kind`、`pick`、`project`、`queryRendered`），不碰原生地图（ADR 0034、0047）
- 关掉拖动平移的工具要临时拖动地图时声明 `panModifier`，值取 `shared/map` 的 `currentPanKey()`（Mac 用 ⌘，其他用 Ctrl），平移和手型光标由适配器负责，工具不自己监听修饰键（ADR 0056）
- 工具栏的按钮由页面挑选（`items`），动作的回调由页面给出（`actions`）；开关面板的动作，由页面通过 `pressed` 告诉工具栏显示为按下，工具栏不保存开关（ADR 0034、0036）
- fill 图层要用 `['geometry-type']` 限定为面：MapLibre 会把线也当成环填充
- line 图层的 `line-dasharray` 不在常量和按要素取值之间切换（MapLibre 6.12 的缺陷会报错）：线型不同的要素按线型拆成多个图层，每层的线型是常量，实线不设（ADR 0046）
- 只随级别变化（常量或按 `zoom` 的 `step`）的 `fill-pattern` 设 `'fill-pattern-transition': { duration: 0 }`：过渡期间 MapLibre 按旧图片取图集位置，换花纹后会画错约 300 毫秒（见 `docs/migration.md` 的"切换填充方式的闪烁"）
- 区划目录和区划边界只用本地数据（`shared/map/region`），目录与市界、县界数据由测试保证逐条一致（ADR 0036）；经纬度的识别、显示和复制只用 `shared/map/location/coordinate-format.ts` 的纯函数（ADR 0037）
- 资源的年份是按 `code` 的显示状态：单个资源用拥有者的 `setYear`，批量用 `setYearForAll`（有这一年的资源不论是否勾选都切过去），不另存"当前年份"；界面条目的身份、名称和符号按 `code`，年份作为单独的字段显示（ADR 0052）
- 区划裁剪按区划边界的几何，不按要素属性里的区划代码过滤（业务数据的代码和区划目录对不上）：区划外用 `region-clip` 分组的遮罩盖住；显示和查询的范围都取 `readyBoundary`；点选、框选的渲染要素先按范围过滤再去重、计数，发给后端的几何只用 `query-geometry.ts` 的 `queryGeometry` 整理（误差不超过 2 像素、有效、最多 120 个坐标），整理不出来时提示范围太复杂（ADR 0051）
- 地图页的区域按 ADR 0053：右侧的面板放进 `shared/map` 的两组 Tab 面板（`usePanelGroup` + `MapPanelGroup`），内容组件不带自己的标题、关闭按钮，不自己登记悬浮元素；有临时交互（拾取、取色预览、弹出层）的内容接收 `active`，隐藏时结束这些交互，关闭时才卸载；窄屏时左右只显示最后操作的一边（`useSideExclusion`）
- 地图页的界面按 5D 的设计稿（ADR 0053～0055）：当前工具、面板开关、视图状态、失败原因等仍是组合式函数、store 或纯函数里的数据，组件只显示和调用，测试放在逻辑上；随尺寸变化的排法写成纯函数（如 `mapPageLayout`、`fitStatusLayout`），组件只交给它量到的尺寸。新的界面块先出静态设计稿（`public/design.local/`，不入库），用户确认后再实现
- 接收外部回调的模块（如 `onError`）在入口用 `@yzt/utils` 的 `safeReporter` 包装：回调自己抛错不能打断内部的状态转换和资源释放
- 地图的加载与失败提示由 `shared/map` 的 `describeMapStatus` 推导，界面只负责显示；引擎失败用上下文的 `retry()` 重建，不在页面里换画布的 `key`（ADR 0030）
- 地图上跟着鼠标的提示用 `shared/map/pointer-hint` 的 `PointerHint`（靠边时翻到另一侧），不在各个浮层里各写一套；挂在地图上某一点的卡片（如位置信息）只放在可视区域里（上下文的 `overlayPadding()`，ADR 0055）
- 贴边、会挡住定位的悬浮元素用 `useMapOverlay(element, edge)` 登记，`fitBounds`、`flyTo` 不传 `padding` 时自动避开；不定位、只要让被挡住的位置露出来时用相机控制的 `reveal`；页面不自己算定位用的 padding 和平移量，也不用布局的尺寸常量（ADR 0029、0037）
- 会话的选择状态只存要素身份（数据源 + 业务主键），属性、几何、候选列表和详情留在 feature 的查询缓存里，高亮分组从选择和查询结果推导（ADR 0022、0047）
- 只有 MapLibre 适配器能写二维地图（lint 只允许 `libs/map-core/maplibre/` 和 `app/` 导入 maplibre-gl），不提供通用的原生地图出口，其他代码只能通过它的只读方法查询、投影；Cesium 镜像会话状态，不实现二维的引擎接口；二三维共用的是生命周期、相机、输入、拾取、投影、渲染要素查询这几个视图接口（ADR 0024、0047；三维的渲染要素查询返回空数组）
- 地图页的路由组件用 `app/map-framework.ts` 的 `withMapRuntime` 包装：同时加载默认框架（`defaultMapFramework()`）的运行时和页面，都到了以后设置运行时、预热 Worker 池再返回页面；登录页空闲时 `app/map-preload.ts` 用同一个加载函数预加载，所以地图页分块的模块不在顶层做重的计算（ADR 0061）；交给 MapLibre 的容器元素只用静态 class，可变的 class 放在外层元素上，否则 Vue 会冲掉 MapLibre 自己加的 class
- 地图页被缓存时（ADR 0063）：`MapCanvas` 在页面停用时暂停视图、激活时恢复，隐藏期间的定位等恢复后再执行；视图恢复时先按容器尺寸调整画布，暂停时进行中的定位动画直接到终点并写回会话；面板内容在页面停用时按隐藏处理（`active` 为 false）
- 相机事件带 `view` 和 `cause`（`user` / `program` / `sync`），不用时间窗口判断回声（ADR 0024）
- 三维相机在目标点的 ENU 坐标系与共享相机换算，隐藏期间不实时跟随；恢复精确视角按隐藏期间的 `cause` 判断（ADR 0024、0064）。3D.2b 通过 `CesiumView` 接入统一上下文，候选视图先完成预备渲染再暂停，定位时长的毫秒在适配器转换为秒；验收边界见 `docs/modules/map-cesium.md`
- 三维基础样式按 ADR 0065 使用统一影像层序：background、raster、内联 GeoJSON 与 MVT 点线面；表达式和过滤用 style-spec，级别取共享相机，不取瓦片级别。不支持的属性逐层诊断并跳过；有数据源的 provider 加载错误进入来源错误，同步样式诊断不使整图失败。绘制与支持范围见 `docs/stages/stage-3d-3a-basic-style.md`、`stage-3d-3b-mvt-worker.md`；花纹、虚线、符号、高亮与世界遮罩留到 3D.3c
- MVT 下载、解码和按字节 LRU 在 map-core，绘制和视图独占的惰性 Worker 池在 map-cesium，通信复用 utils；父瓦片身份固定线程，放大后从矢量重画，字段需求取并集。暂停取消未完成任务并保留缓存，释放视图终止线程，转移的位图用后或晚到时关闭；不增加持久化缓存或拦截二维请求（ADR 0066）
- 二维中，一个不合法的图层会让整个视图进入 `failed`，样式出现新版本时自动恢复（ADR 0026）；来自后端等外部配置的图层，由拥有者在配置变化时先校验自己的分组，不合法的不提交给会话
- 带 `sourceId` 的错误（瓦片、GeoJSON 加载失败）不算样式失败，记在视图的数据源错误里；拥有者从上下文的 `sourceErrors` 按数据源 ID 推导自己的加载失败，不监听原生的 `error` 事件，也不自己清除（ADR 0041）
- 持有资源的对象实现 `Disposable`，监听和子对象都登记进内部的 `DisposableStack`；释放后等待中的操作以 `AbortError` 结束（ADR 0023）
- 视图上的差异（如三维期间不画二维标注）由适配器自己处理，不改会话状态；框架独有的功能按能力声明，独有状态由各自的模块保管，切换框架时保留
- 样式表达式和过滤条件在三维、Worker 里一律用 `@maplibre/maplibre-gl-style-spec` 求值，不手写求值器；它保证求值语义一致，不保证渲染效果一致，三维的支持范围按清单降级（ADR 0024）
- 二维不自建渲染 Worker；主线程热点先实测再移出；自建的 Worker 一律用 `@yzt/utils` 的通信层（有类型的消息、`AbortSignal` 取消、归实例所有并可释放），取消分层与故障语义见 ADR 0025，用法见 `docs/modules/utils.md`；Worker 内的缓存不转移出去，对外只传复制品或一次性产物

### 样式与设计规范

- 字体文件按授权不能提交到仓库（ADR 0012）；正文字体普惠体 3.0 只有 400、600 两个字重，改 `font-weight` 即可
- 业务图标用 `shared/icons/SvgIcon`（`name` 有类型检查），不直接写 `<img>` 或内联 SVG（按数据画的图形不是图标，如图例的符号预览，可以直接用 SVG）；新图标放进 `apps/web/src/assets/icons/`，由 `@yzt/icons` 自动规范化（改名、颜色改为 currentColor），多色图标文件名以 `-color` 结尾，见 `docs/modules/icons.md`；Element 组件的图标属性仍用 `@element-plus/icons-vue`
- 系统名称用 `shared/system-title` 的 `SystemTitle` 组件（SVG 轮廓，大小和颜色跟随 `font-size`、`color`），不要把优设标题黑作为网页字体加载；修改名称见 `docs/modules/system-title.md`

- 设计参考 `docs/design/color-and-typography.md`，落地方式见 `docs/design/theme.md`；规范和 Element Plus 的交互风格冲突时，优先和 Element 保持一致
- 颜色、字号、字重、行高、阴影、圆角一律使用令牌（`var(--color-*)`、`var(--radius-*)` 等 CSS 变量），不写死色值和字号（圆形、胶囊形写 `50%` / `999px`）；规范里没有的值先补进规范和 `app/styles/tokens.scss`
- 间距在布局一级（页面边距、面板之间、面板内边距、区块之间）使用 `--space-*` 令牌；组件内部的细小间距可以写数值，不为它们增加令牌
- 字号只用双数
- 页面排布按 `docs/design/page-layout.md`：分栏型页面由 `libs/ui` 的布局、面板、区块、标题组件组成（ADR 0016）；页面不设背景，侧栏宽度只用固定档位，高度靠布局占满、面板内部滚动，不写 `calc(100% - 32px)` 这类计算
- 列表页的筛选栏用 `shared/query-form` 的 `QueryForm`（控件等宽；条件不换行时标签按文字宽度，换行时标签统一宽度并两端对齐；按钮放不下就另起一行），不用 `<label>` 包住控件；工具栏和筛选栏的按钮按 `page-layout.md` "操作按钮"的对照表配图标，表格行内的文字按钮不加图标
- 不给 `ElTree` 设置 `indent`：树的层级引导线按 Element 默认缩进 18 定位（见 `theme.md` 的"树的全局样式"）
- 表格的空值由全局样式显示 `-`（见 `theme.md` 的"表格的全局样式"），列上不再用 `formatter` 或插槽处理空值
- `libs/ui` 的组件只通过 CSS 变量使用令牌，不 import app 的 SCSS；不能引用 `SvgIcon`，自定义图标由使用方通过插槽传入
- Element Plus 的外观只在 `app/styles/element-theme.scss` 统一调整，页面和组件不单独覆盖 `--el-*` 变量；需要另一种外观时在其中定义变体 class（如 `input-filled`、`button-xl`），页面只引用 class，见 `docs/design/theme.md`；唯一的例外是 `libs/ui` 分栏布局内部抽屉的内边距（见 `docs/modules/ui.md`）

## 迁移规则

- 只迁移旧项目中实际在用的模块。不迁移：资源中心（含知识图谱；但代码放在 `views/resource-center/` 下的文件管理要迁移）、资源共享、统计分析、旧版 resource-management、`views/sys` 与动态菜单路由、`/home` 测试页、mockjs、backend-switcher
- 先读懂旧模块的行为，再按新架构重写，不逐行照搬；类结构和算法有价值的，保留设计并补上类型
- 按真实接口返回（先实际请求一次看结构）和 TypeScript 类型写逻辑，不照搬旧代码为各种假设情况写的兜底判断：zod schema 已经保证的字段不再判空，不写 `|| ''`、`Array.isArray(...) ? ... : []` 这类兜底；确实可能缺失的字段在 schema 里写 `.optional()`，由类型提示调用方处理
- 开始迁移一个模块时，在 `docs/migration.md` 记下 yzt 的基线 commit，之后用 `git diff <基线>..master-demo -- <路径>` 同步旧仓库的新改动（旧仓库可能停在其他分支上，不写 `HEAD`）

## 依赖维护（ADR 0005）

- 一般依赖用 `^`；不遵守语义化版本的包精确锁定：Cesium、TypeScript、oxlint（`jsPlugins` 处于 alpha 阶段）、oxlint-tsgolint（内置 TS）
- 0.x 版本的包，小版本升级按大版本对待
- 新版本发布满 3 天（`minimumReleaseAge: 4320`）才能安装，防止装到刚发布的恶意版本；紧急安全补丁用 `minimumReleaseAgeExclude` 临时豁免该版本，冷却期过后删除豁免
- Node 与 pnpm 的版本在根 `package.json` 的 `devEngines` 中声明，CI 从这里读取；`@types/node` 跟随 Node 的大版本，不随 latest 升级
- workflow 中的 Actions 用 commit SHA 固定并注释版本号，随 `pnpm deps:check` 一起检查更新
- 小版本和补丁：CI 通过后合并
- 大版本：先读 Breaking Changes 和迁移指南再决定；等出过几个补丁版本再升；一次只升一个包，单独提交，并在提交说明里写明迁移内容
- 每月手动检查一次（`pnpm deps:check`），接入 Renovate 后改为每周自动处理；安全告警随时处理
- `pnpm-lock.yaml` 必须提交
- 依赖的安装脚本默认不执行，是否放行在 `pnpm-workspace.yaml` 的 `allowBuilds` 中逐个决定

## 文档

- 必须遵守的规则写在本文件里，保持简短；决策理由、配置说明和学习资料放在 `docs/`，和代码一起提交
- `docs/README.md`：文档索引、阅读顺序与维护约定
- `docs/roadmap.md`：阶段路线图，每个阶段的内容、学习点、状态，以及各文档中"到某阶段再做"的事项
- `docs/code-style.md`：完整代码风格
- `docs/adr/`：架构决策记录，编号递增，接受后不再修改；决策有变化时新写一份，并注明取代了哪一份
- `docs/config/`：重要配置文件的逐项说明；修改配置文件时同步更新
- `docs/design/`：设计规范原文、主题落地说明与页面布局规范；修改令牌、Element 映射或布局规则时同步更新
- `docs/modules/`：shared、libs、packages 以及 app 中布局等模块的用法与设计说明；新增或修改这些模块时同步更新
- `docs/commands.md`：常用命令说明；新增或修改脚本时同步更新
- `docs/stages/`：各阶段总结与学习笔记，每个阶段结束时新增一篇
- `docs/migration.md`：各模块的迁移基线与进度

## 常用命令

- `pnpm --filter @yzt/web dev`：启动开发服务器
- `pnpm typecheck`：所有包的类型检查（`tsc -b`）
- `pnpm lint`：lint 检查（含类型感知规则与依赖方向）；`pnpm lint:fix` 自动修复可安全修复的问题
- `pnpm build`：所有包的生产构建；`pnpm build:intranet` 是内网部署的构建（不请求天地图）
- `pnpm --filter @yzt/web dev:intranet`：用内网配置启动开发服务器
- `pnpm test`：所有包的测试（`vitest run`，`apps/web` 里有 `unit`、`browser` 两个项目）；`pnpm --filter @yzt/web test:watch` 监听模式；`test:unit`、`test:browser` 只跑其中一个；第一次跑浏览器测试前运行 `pnpm --filter @yzt/web test:browser:install`
- CI（`.github/workflows/ci.yml`）依次运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、安装 Chromium 无界面版、`pnpm test`、`pnpm build`、`pnpm build:intranet`
- `pnpm --filter @yzt/web measure:map-load`：实测"点击登录 → 地图第一次加载完成"（先构建；账号密码从环境变量 `YZT_MEASURE_LOGIN_NAME`、`YZT_MEASURE_PASSWORD` 读，由用户在自己的终端运行）
- `pnpm deps:check`：检查过期的依赖和 GitHub Actions
- `pnpm deps:update:within-range`：在版本范围内更新依赖和 Actions
- `pnpm deps:update:allow-major`：交互式选择要升级大版本的依赖和 Actions