# yzt 重构（repo0527）

用 Vue 3 + TSX + TypeScript 重写 `C:\WebProject\yzt`（江苏省统一调查监测现状图，master-demo 分支）。
这是学习型重构：迁移的同时学习 Vue 3、TS、架构设计、面向对象与设计模式、monorepo 和前端工程化。

## 协作方式

- 每一步先说明设计理由、替代方案和涉及的知识点，再动手
- 一次推进一个小步骤，不擅自扩大范围；涉及选型的问题先讨论再决定
- 重要决策写成 ADR（`docs/adr/`）；阶段结束时把新结论同步到本文件，并更新 `docs/roadmap.md` 的状态与调整
- 登录页等重要页面先按设计规范出设计稿，确认后再开发；主题与组件库层面的改动用主题预览页（`/dev/theme`）截图确认
- 提交信息使用 Conventional Commits 格式（`feat` / `fix` / `refactor` / `docs` / `chore` 等）

## 技术栈

已确定：

- Vue 3 + TSX（`defineComponent`），不使用 `.vue` 单文件组件（ADR 0001）
- TypeScript strict，Vite，Pinia，Vue Router，Element Plus，pnpm workspace
- Element Plus 组件显式具名导入，样式全量引入 `element-plus/dist/index.css`，语言包用 `ElConfigProvider` 设置
- Vue Router 5，手写路由表，history 模式，不启用文件路由（ADR 0007）
- Pinia 4，只用 setup store
- 只用 TypeScript 7 一个版本；不引入依赖 TS JS API 的工具（vue-tsc、typescript-eslint 等），lint 用 oxlint + oxlint-tsgolint（ADR 0003），规则与依赖方向检查见 ADR 0006
- tsconfig 不开启 `incremental`：TS 7.0.2 的增量检查在 `declare global` 文件变化后会给出过期结果（ADR 0009）
- 二维地图用 MapLibre GL JS 6，只用具名导入；`setWorkerUrl`、CSS 这类全局设置由 app 在首次进入地图时懒加载完成；禁止引入 `mapbox-gl`（2.0 起为专有许可）（ADR 0002、0019、0023）
- 三维地图用 Cesium，精确锁定版本（ADR 0002）
- 地图内核的事件用 nanoevents；资源释放用标准的 `Disposable` / `DisposableStack`，运行时由 `app/main.ts` 全局引入的 core-js 补齐（ADR 0023）
- 浏览器目标用 Vite 默认值，不兼容旧浏览器，不引入 `@vitejs/plugin-legacy`
- 测试用 Vitest 5 + jsdom + `@vue/test-utils`，配置写在 `vite.config.ts` 的 `test` 字段（ADR 0010）
- HTTP 用 axios + zod 4，测试中用 MSW 2.x 模拟接口（ADR 0011）
- 接口数据用 TanStack Vue Query 5 管理，全局关闭失败重试和切回窗口时的自动刷新（ADR 0017）
- 登录密码用 sm-crypto-v2 做 SM2 加密，公钥放在 `.env`；token 过期判断用 jwt-decode；会话存 localStorage（ADR 0015）
- CI 用 GitHub Actions：冻结安装 → 类型检查 → lint → 测试 → 构建（ADR 0005）

待定：持久化（计划用 IndexedDB + idb-keyval）

## 目录结构

```
apps/web/src/
├─ app/        应用装配：入口、路由、Pinia、全局插件、布局
├─ pages/      路由页面，只负责组合 features
├─ features/   按业务域划分：api.ts、queries.ts、store.ts、components/、composables/
├─ shared/     应用内通用：HTTP 客户端、鉴权、存储、通用 composables、查询表单、表格加载状态与类型
└─ libs/       将来可拆到 packages/* 的模块，统一用 @yzt/<name> 导入
   ├─ utils/       @yzt/utils       纯 TS 工具，不依赖框架
   ├─ ui/          @yzt/ui          Mx* 通用组件（布局、面板、区块、标题，ADR 0016）
   ├─ map-core/    @yzt/map-core    地图内核，不依赖 Vue
   ├─ map-cesium/  @yzt/map-cesium  Cesium 三维
   └─ map-vue/     @yzt/map-vue     地图与 Vue 的衔接
```

- `pages/dev/<名称>/`：开发页面（主题预览 `/dev/theme`、地图开发页 `/dev/map`），和业务页面分开放。组件名 `Dev<名称>Page`，路由名 `dev<名称>`（值为 `dev-<名称>`），路径 `/dev/<名称>`；只注册在 `app/router/routes.ts` 的 `devRoutes` 里，生产构建不包含；业务代码不导入开发页面。`routes.test.ts` 检查路径与路由名是否对应
- `packages/*`：workspace 内部包，`exports` 直接指向 `src/index.ts`，不单独构建（ADR 0014）；目前有 `@yzt/icons`（图标组件与 SVG 规范化工具）。新建包按 `docs/config/internal-packages.md`
- `apps/web/tools/`：Node 直接运行的 TS 工具脚本（如 `pnpm title:generate`），相对导入写 `.ts` 扩展名，只用可剥离的语法（`erasableSyntaxOnly`）
- `apps/web/public/fonts/`：唯一的字体目录，不入库（ADR 0013），见 `docs/design/fonts.md`

## 依赖方向

- `pages → features → shared → libs`，`app` 可以依赖所有目录
- features 之间不互相导入，需要复用的内容上移到 shared 或 libs
- libs 内部：`utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`；map-vue 只能用动态 `import()` 引用 map-cesium
- `utils`、`map-core`、`map-cesium` 不依赖 vue、element-plus、pinia
- 应用通过 `@yzt/<name>` 使用 `packages/*`，不用相对路径；包只能依赖外部模块和包内部文件，不能导入应用代码；包同样遵守下面"libs 的拆包规则"
- 同一单元（一个 feature、一个 lib 模块、shared、pages、app）内部只用相对路径；跨单元只用别名，引用 libs 只写 `@yzt/<name>`
- 以上规则由 lint 强制检查（根目录 `.oxlintrc.json` 的 `boundaries/dependencies`），分层有变化时同步修改（ADR 0006）

## libs 的拆包规则（ADR 0004）

- 每个模块只有一个入口 `index.ts`，外部只能从 `@yzt/<name>` 导入，不直接引用模块内部文件
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
- 顶部导航配置在 `app/layout/menus.ts`，导航项的权限从路由 meta 读取，不在菜单里另写角色；新增业务页时先加路由再加导航项
- 登录会话只通过 `shared/auth` 的 `useSessionStore` 读写，不直接读写 localStorage 中的 token
- 结束会话（退出、过期、其他标签页退出）统一调用 `app/session-end.ts` 的 `endSession()`（同时清空查询缓存），不要只调用 `session.clear()`；跳转和提示由调用方负责，见 `docs/modules/auth.md`
- 界面与逻辑分离：表单、提交这类交互逻辑写成组合式函数（`features/<域>/composables/useXxx`，通用的放 `shared/composables`），组合式函数不渲染、不跳转、不弹提示，这些由组件和页面决定（见 `docs/modules/auth.md` 的登录三层）
- 组合式函数发起的请求在作用域销毁时（`onScopeDispose`）取消，请求返回后再检查一次是否已取消：晚到的结果不写入会话、store 等共享状态，被取消的请求不显示错误。写法见 `useLoginForm`，原因见 `docs/modules/auth.md` 的登录表单
- 加载状态用 `shared/composables` 的 `useDelayedFlag` 延迟显示，防重复提交的标志仍立即生效
- 确认框（`ElMessageBox`）不随组件卸载关闭：组件卸载时关闭自己打开的确认框；用户确认后，先检查组件是否已销毁、会话是否还是打开确认框时的那一个，再执行操作（写法见 `features/file-management/composables/useFileRemoval.ts`）
- 同一时间只能打开一个 `ElMessageBox`：组件卸载时只能用 `ElMessageBox.close()` 关闭，它会关掉所有确认框，有多个时会把别处的一起关掉、对方按"取消"处理；需要多个弹框并存时，改用渲染在组件内的确认框（如基于 `ElDialog`），随组件卸载自然销毁
- 表格行内操作（如删除）的进行中状态按行 ID 记录，不用单个 mutation 的 `variables` / `isPending` 判断是哪一行；操作入口对同一行防重复
- 回车触发提交或查询时排除输入法选字：`event.key === 'Enter' && !event.isComposing`
- 列表的加载状态按 `docs/modules/table.md` 区分：没有数据时用 `shared/table` 的 `TableSkeleton`，显示着旧数据时用延迟遮罩，后台刷新当前条件的缓存不提示；遮罩不要直接跟着 `isFetching`
- 给组件传 `id` 等未声明的透传属性会报类型错误（组件只接受声明的 props 和 `class`、`style`），需要标记时用 `data-*`

### 测试

- 测试文件和源文件放在一起，命名 `*.test.ts` / `*.test.tsx`；显式从 `vitest` 导入 `describe`、`it`、`expect`，不开 `globals`
- 工具函数、鉴权、HTTP 错误处理这类纯逻辑要写测试；页面和组件测试关键交互
- pages、features 的测试用 `createMemoryHistory()` 建只含所需路由的最小路由，不导入 `app` 的路由表（测试文件同样受依赖方向约束）；`app` 自己的测试可以用真实路由表，例如检查导航与路由权限是否一致
- 模拟环境变量用 `vi.stubEnv`，用例结束后会自动撤销（`unstubEnvs`）
- 模拟接口用 MSW 的 `setupServer()`，并设置 `onUnhandledRequest: 'error'`；不用 `vi.mock('axios')`
- 测试写完后，故意改坏被测代码，确认测试会失败，并确认失败原因是断言而不是代码报错；修 bug 时先写能复现问题的测试
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

### 接口请求（ADR 0011，用法见 `docs/modules/http.md`）

- 接口函数写在 `features/<域>/api.ts`，统一用 `shared/http/client.ts` 的 `http.get / post / put / delete`，不直接使用 axios
- 每个请求都传 zod schema，返回值类型由 schema 推断（`z.infer`），不另外手写 interface；对象中可能缺失的字段写 `.optional()`（zod 4 中 `z.unknown()` 字段默认必填）
- 失败时抛出 `ApiError`，按 `kind` 区分；接口函数里不弹提示，全局提示由 app 注入，需要自己处理时传 `silent: true`
- 支持取消的场景把 `AbortSignal` 传给接口函数
- 查询和变更写在 `features/<域>/queries.ts`，用 TanStack Vue Query 的 `useQuery` / `useMutation`；`queryFn` 把收到的 `signal` 交给接口函数，组件不直接拼 query key；接口数据由查询缓存持有，不放进 Pinia，组件里也不另存一份
- shared/http 不依赖路由、UI 和鉴权，这些由 `app/http.ts` 通过 `configureHttp` 注入

### 地图（ADR 0020～0025，设计见 `docs/modules/map-core.md`）

- map-core 持有地图会话状态（样式模型、相机、当前工具、选择状态），它是二维和三维共同的唯一真相源；Manager 修改会话状态，不直接写引擎
- 样式按分组推导：每个拥有者用纯函数从自己的状态推导出分组并整体替换；跨分组的修改用一次 `setGroups` 提交，批次不跨 `await`；交给会话的 GeoJSON 数据不能原地修改，要换新对象（ADR 0022）
- 会话只保存地图需要的选择信息（要素身份、高亮数据），候选列表和详情留在 feature 的查询缓存里（ADR 0022）
- 只有 MapLibre 适配器能写二维地图（lint 只允许 `libs/map-core/maplibre/` 和 `app/` 导入 maplibre-gl），不提供通用的原生地图出口，其他代码只能通过它的只读方法查询、投影；Cesium 镜像会话状态，不实现二维的引擎接口；二三维共用的是生命周期、相机、输入、拾取、投影这几个视图接口（ADR 0024）
- 地图页的路由组件用 `app/router/routes.ts` 的 `withMapRuntime` 包装，先加载地图运行时（`setWorkerUrl`、CSS）再加载页面；交给 MapLibre 的容器元素只用静态 class，可变的 class 放在外层元素上，否则 Vue 会冲掉 MapLibre 自己加的 class
- 相机事件带 `view` 和 `cause`（`user` / `program` / `sync`），不用时间窗口判断回声（ADR 0024）
- 持有资源的对象实现 `Disposable`，监听和子对象都登记进内部的 `DisposableStack`；释放后等待中的操作以 `AbortError` 结束（ADR 0023）
- 视图上的差异（如三维期间不画二维标注）由适配器自己处理，不改会话状态；框架独有的功能按能力声明，独有状态由各自的模块保管，切换框架时保留
- 样式表达式和过滤条件在三维、Worker 里一律用 `@maplibre/maplibre-gl-style-spec` 求值，不手写求值器；它保证求值语义一致，不保证渲染效果一致，三维的支持范围按清单降级（ADR 0024）
- 二维不自建渲染 Worker；主线程热点先实测再移出；自建的 Worker 一律用 `@yzt/utils` 的通信层（有类型的消息、`AbortSignal` 取消、归实例所有并可释放），取消分层与故障语义见 ADR 0025；Worker 内的缓存不转移出去，对外只传复制品或一次性产物

### 样式与设计规范

- 字体文件按授权不能提交到仓库（ADR 0012）；正文字体普惠体 3.0 只有 400、600 两个字重，改 `font-weight` 即可
- 业务图标用 `shared/icons/SvgIcon`（`name` 有类型检查），不直接写 `<img>` 或内联 SVG；新图标放进 `apps/web/src/assets/icons/`，由 `@yzt/icons` 自动规范化（改名、颜色改为 currentColor），多色图标文件名以 `-color` 结尾，见 `docs/modules/icons.md`；Element 组件的图标属性仍用 `@element-plus/icons-vue`
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
- `pnpm build`：所有包的生产构建
- `pnpm test`：所有包的测试（`vitest run`）；`pnpm --filter @yzt/web test:watch` 监听模式
- CI（`.github/workflows/ci.yml`）依次运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`
- `pnpm deps:check`：检查过期的依赖和 GitHub Actions
- `pnpm deps:update:within-range`：在版本范围内更新依赖和 Actions
- `pnpm deps:update:allow-major`：交互式选择要升级大版本的依赖和 Actions