# yzt（repo0527）

用 Vue 3 + TSX + TypeScript 重写 `C:\work\zhjsqdxin`（江苏省统一调查监测现状图，master-demo 分支）。迁移基本完成，现在以迭代开发为主。

本文件只放每个任务都要遵守、lint 又管不到的规则。其余规则按目录放在 `.claude/rules/`，见下面的"规则文件"。

## 协作方式

- 小改动直接做；涉及选型、架构或不容易回退的决定，先说明设计理由和替代方案，讨论后再动手（ADR 0139）
- 一次推进一个小步骤，不擅自扩大范围
- 提交信息使用 Conventional Commits 格式（`feat` / `fix` / `refactor` / `docs` / `chore` 等）
- 难回退、跨模块的决定才写 ADR（`docs/adr/`），取值和界面细节写进配置说明或设计文档；规则变了直接改本文件或对应的规则文件（ADR 0142）
- 后端有些级别、有些资源暂时没有数据（瓦片为空、缺字段、接口报错）时，不为适配这种现状调整既定方案，记进 `docs/backlog.md`

## 规则文件

Claude Code 读写匹配的文件时自动加载 `.claude/rules/` 里对应的文件。其他工具不会加载，改这些位置前先读对应的文件。

| 文件 | 适用范围 | 内容 |
|---|---|---|
| `ui.md` | `*.tsx`、`*.scss`、`docs/design/` | UI 流程与验证、TSX 写法、加载状态与列表、确认框等 Element 组件、设计令牌与样式 |
| `testing.md` | `*.test.*`、`tools/smoke/`、`shared/testing/` | 测试的写法、环境、模拟、改坏验证 |
| `http.md` | `api.ts`、`queries.ts`、`shared/http/`、`session-guard` | 接口函数、查询、写操作的会话核对 |
| `pages.md` | `app/`、`pages/`、`shared/router/`、`shared/auth/`、`shared/perf/` | 路由、权限、导航、开发页、页面缓存、加载耗时、结束会话 |
| `state.md` | `features/*/store.ts`、`shared/storage/` | Pinia、偏好的持久化与开关 |
| `packages.md` | `packages/`、`tsconfig.package*`、`vitest.shared.ts` | 拆包规则、包之间的依赖方向、依赖声明、包的测试 |
| `map.md` | 地图的包、`shared/map/`、用到地图的 feature 和页面、`*.worker.ts` | 会话、样式分组、拥有者、相机操作、工具、地图页、Worker |
| `map-3d.md` | `map-three`、`map-core/scene`、`map-core/maplibre/roam`、`scene-models`、现状底图页 | 三维、二三维切换、漫游、导航网格 |
| `resource-map.md` | `resource-map`、现状底图页、`probe-resource-classes` | 年份、分类、最小显示级别、已确认的界面细节 |
| `indicator-simulation.md` | 指标 AI 计算 | 叫法、引擎、流程图、自定义范围 |
| `city-dashboard.md` | 驾驶舱、`shared/city-indicators` | 范围、入场、保存图片 |
| `deps-config.md` | `package.json`、`pnpm-*`、`.github/`、`.oxlintrc.json`、`.env*`、`vite.config.ts`、`tsconfig*`、`shared/config/` | 依赖维护、环境变量、CI |

## 技术栈

- Vue 3 + TSX（`defineComponent`），不使用 `.vue` 单文件组件（ADR 0001）
- TypeScript strict，Vite，Pinia 4，Vue Router 5，Element Plus，pnpm workspace
- Element Plus 组件显式具名导入，样式全量引入 `element-plus/dist/index.css`，语言包用 `ElConfigProvider` 设置
- 只用 TypeScript 7 一个版本；不引入依赖 TS JS API 的工具（vue-tsc、typescript-eslint 等），lint 用 oxlint + oxlint-tsgolint（ADR 0003），规则与依赖方向检查见 ADR 0006
- 接口：axios + zod 4 + TanStack Vue Query 5；测试：Vitest 5 + jsdom + `@vue/test-utils`，真实引擎或布局用浏览器模式，接口用 MSW 2.x
- 地图：二维 MapLibre GL JS 6，三维 MapLibre + Three.js（ADR 0147）；Cesium 引擎已移除，代码在标签 `cesium-engine-2026-11`（ADR 0153）；距离和面积用 geographiclib-geodesic，其他几何用 turf v7 的单个包
- 偏好存 IndexedDB（idb-keyval），会话存 localStorage
- 资源管理"自助取数"的知识图谱用 ECharts 的 graph 系列，坐标用 d3-force 计算，不引入 G6（ADR 0089）；名称写在节点里、字号按屏幕上的直径自适应，水资源图是总节点连四个大类的放射布局，数据在 `extraction/water-relations.json`（ADR 0126）
- AI 对话回答的 Markdown 用 marked 转换、DOMPurify 净化后显示，只在 `features/ai-chat/markdown.ts` 中使用
- 浏览器目标用 Vite 默认值，不兼容旧浏览器，不引入 `@vitejs/plugin-legacy`

## 目录结构

```
apps/yzt/src/
├─ app/        应用装配：入口、路由、Pinia、全局插件、布局、字体声明
├─ pages/      路由页面，只负责组合 features
├─ features/   按业务域划分：api.ts、queries.ts、store.ts、components/、composables/
└─ shared/     应用内通用：HTTP 客户端、鉴权、存储、通用 composables、查询表单、表格加载状态与类型、加载耗时的标记（perf）、项目级的公共地图能力（map）、城市体检指标的目录与取值（city-indicators）、对话头像（chat-avatar）、只供测试的辅助（testing）

packages/      workspace 内部包，导出 TS 源码，不构建；统一用 @mx/<name> 导入（ADR 0143）
├─ utils/       @mx/utils       纯 TS 工具，不依赖框架（目前是 Worker 通信层）
├─ ui/          @mx/ui          Mx* 通用组件（布局、面板、区块、标题，ADR 0016）
├─ theme/       @mx/theme       设计令牌、Element 主题、全局基础样式，只有 Sass 入口
├─ icons/       @mx/icons       图标组件与 SVG 规范化工具（ADR 0014）
├─ map-core/    @mx/map-core    地图内核，不依赖 Vue
├─ map-three/   @mx/map-three   三维（Three.js，画在 MapLibre 的 custom layer 里）
├─ map-vue/     @mx/map-vue     地图与 Vue 的衔接
└─ map-tools/   @mx/map-tools   地图的通用交互：绘制、逐点编辑、测量、框选手势、鼠标旁的提示（ADR 0145）
```

- `pages/dev/<名称>/`：开发页面，和业务页面分开放，只注册在 `devRoutes`，生产构建不包含，业务代码不导入
- `apps/yzt/tools/`：Node 直接运行的 TS 工具脚本（如 `pnpm title:generate`、加载耗时的实测 `measure:map-load`），相对导入写 `.ts` 扩展名，只用可剥离的语法（`erasableSyntaxOnly`）
- `apps/yzt/public/fonts/`：唯一的字体目录，不入库
- `local/`（仓库根目录，不入库）：模型、原型、探查结果、实测数据和手动测试文件，环境变量 `YZT_LOCAL_DIR` 可以指到别处（worktree 指回主目录）；开发服务器把 `/3dt/*`、`/design.local/*` 映射到这里，地址不变；`public/` 只放要发布的文件，字体是构建输入、留在原处（ADR 0141，见 `docs/config/local-files.md`）

## 依赖方向

- `pages → features → shared → packages`，`app` 可以依赖所有目录；features 之间不互相导入，需要复用的内容上移到 shared 或 packages；包之间的方向见 `.claude/rules/packages.md`
- 同一单元（一个 feature、一个包、shared、pages、app）内部只用相对路径；跨单元只用别名，引用包只写 `@mx/<name>`
- 由 lint 检查（`.oxlintrc.json` 的 `boundaries/dependencies`，说明见 `docs/config/oxlintrc.md`）；分层有变化时同步修改（ADR 0006）

## 编码约定

### 格式

以根目录 `.editorconfig` + WebStorm 格式化为准：UTF-8、2 空格缩进、120 列、单引号、语句末尾加分号、不加尾随逗号、`if` / `else` 必须带大括号。lint 不管格式，完整说明和例子见 `docs/code-style.md`。
JSX 标签：属性少、值简单、不超过 120 列的保持单行（如 `<ElButton type="primary" onClick={goHome}>`）；一旦换行，第一个属性从下一行开始，每个属性独占一行。
不把多条语句或 `if` 的分支压在一行（`if (a) { return; }`、`() => { a(); b(); }` 都要展开）；多行 JSX 用 `return (` 包住，条件渲染的多行 JSX 加括号；小数写出整数位（`0.85`），换行的 `&&`、`||` 放在行尾。

### lint（ADR 0006）

- 规则只分 `error` 和 `off` 两级，不用 `warn`；提交代码前 `pnpm lint` 必须通过
- 在代码里关闭规则要写明原因：`// oxlint-disable-next-line <规则> -- 原因`；不再需要的关闭注释会报错

### 注释

- 只说明变量、方法和关键步骤的用途或原因，一行为主，最多两句；不复述代码本身
- 复杂逻辑写成 `docs/` 下的独立文档或 Skill，代码里只留一行注释指向它
- 中文注释结尾不加句号
- 导出的函数和类可以写单行 `/** */` 注释，方便 IDE 悬停提示；类型信息交给 TS，不在注释里重复
- 不写文件头的作者、日期注释，不保留注释掉的旧代码，这些由 git 记录
- JSON 文件不写注释（包括 `.oxlintrc.json` 这类允许 JSONC 的文件），配置说明写在 `docs/config/` 对应的文档里

### 依赖与语法

- 通用问题优先用成熟稳定的库，不重复造轮子：比如 `lodash-es`（判断、防抖节流、深拷贝）、`tippy.js`（提示交互）
- `lodash-es` 按需具名导入，例如 `import { debounce } from 'lodash-es'`，保证未用到的函数能被 tree-shaking 掉
- 媒体查询、尺寸监听这类组合式工具用 `@vueuse/core`，同样按需具名导入；版本与 element-plus 内部依赖的版本保持一致，避免打包两份（见 `docs/config/package-json.md`）
- 原生语法已经足够清晰时直接用原生，例如 `?.`、`??`、`Array.isArray`、`Object.entries`
- 引入新依赖前先确认现有依赖里没有同类库，同一类问题只保留一个库
- 优先用现代 ES 语法：解构、展开、箭头函数、模板字符串、可选链、空值合并、`async` / `await`
- 可读性优先：解构用于给值起有意义的名字，不为了缩短代码写多层嵌套解构或长串三元表达式

### TypeScript 与 Vue

- 避免 `any`；外部数据先用 `unknown` 接收，再收窄类型；只用于类型的导入写 `import type`
- 不用非空断言（`value!`）：可能为空的值显式判断后提前返回或抛错；测试里缺少依赖的元素、作用域返回值时用 `shared/testing/required` 的 `required(value, '说明')` 抛出说明缺什么的错误，不在之后的属性访问上报错（见 `docs/archive/stages/main-full-review.md`）
- 组件用 `defineComponent` + TSX，样式用 `*.module.scss`
- 不挂 `globalProperties`，不用 `getCurrentInstance().proxy`，不往 `window` 上挂对象，不使用 API 自动导入；依赖一律显式 `import` 或通过 provide / inject 获取
- 跨组件通信按 props / emit → provide / inject → Pinia 的顺序选择，不使用无类型的字符串事件总线
- 界面与逻辑分离：表单、提交这类交互逻辑写成组合式函数（`features/<域>/composables/useXxx`，通用的放 `shared/composables`），组合式函数不渲染、不跳转、不弹提示，这些由组件和页面决定（见 `docs/modules/auth.md` 的登录三层）
- `computed` 不抛异常：可能失败的计算把失败表示成数据（结果对象），或者放在调用方的 `try/catch` 里直接计算。Vue 3.5 中 `computed` 抛错时，异常在调度器检查依赖时抛出，读取方的 `try/catch` 接不住；之后依赖不变时再读取，返回上一次成功的旧值（ADR 0028 背景第 8 条）
- 组合式函数发起的请求在作用域销毁时（`onScopeDispose`）取消，请求返回后再检查一次是否已取消：晚到的结果不写入会话、store 等共享状态，被取消的请求不显示错误。写法见 `useLoginForm`，原因见 `docs/modules/auth.md` 的登录表单
- 新的操作先作废上一次，再做可能失败的准备（如点选的规划）；准备出错也是这次操作的失败，进入失败和重试，不抛给调用方（写法见 `features/resource-map/composables/useFeaturePick.ts` 的 `execute`）
- 异步按 ADR 0039 分类：能写成状态收敛的不写成操作；可替换操作（同一件事的先后请求，如定位、查询所在区县）在同一通道里后发覆盖先发，用 `@mx/utils` 的 `LatestController`，不手写递增计数；服务端写操作（删除、保存）不适用，按业务防重复、串行或允许并发，不随组件卸载取消
- 异步操作在每个等待点（`await`）返回后都要重新确认自己仍然有效（信号没有中止、仍是最新的请求），再继续执行：等待会因中止而结束，不等于返回时一定没中止
- 命名：状态快照的序号叫 revision（只增不减，比较新旧）；一次意图用信号表示（operation，只能作废，不比较大小）；version 只用于外部格式（样式规范的 `version: 8`、依赖版本）（ADR 0039）
- 跳转写 `{ name: RouteName.xxx }`，不写路径字符串；结束会话统一调用 `app/session-end.ts` 的 `endSession()`；需要持久化的状态只走 `shared/storage`，不直接调用 idb-keyval 或 localStorage。细则见 `pages.md`、`state.md`
- 自定义环境变量只在 `shared/config/app-config.ts` 中读取和校验，其他代码使用 `appConfig`；内网与公网的差异只写在 `.env.intranet`，代码不判断模式名；`VITE_` 开头的变量会写进构建产物，不能放密钥。细则见 `deps-config.md`

### 写法的来源

- 先读懂旧模块的行为，再按新架构重写，不逐行照搬；类结构和算法有价值的，保留设计并补上类型
- 按真实接口返回（先实际请求一次看结构）和 TypeScript 类型写逻辑，不照搬旧代码为各种假设情况写的兜底判断：zod schema 已经保证的字段不再判空，不写 `|| ''`、`Array.isArray(...) ? ... : []` 这类兜底；确实可能缺失的字段在 schema 里写 `.optional()`，由类型提示调用方处理

### 测试

测试文件和源文件放在一起，显式从 `vitest` 导入。工具函数、鉴权、HTTP 错误处理这类纯逻辑要写测试，页面和组件测试关键交互；修 bug 时先写能复现问题的测试。细则见 `testing.md`。

### 验证分级（ADR 0139）

改完按影响范围和风险选一级，拿不准就升一级。CI 每次 push 到 main 都跑全量，本地不重复。交付时说明跑了哪一级、哪些命令、哪些没验证

| 级别 | 改动 | 运行 |
|---|---|---|
| 0 | 只改文档、注释 | 不运行 |
| 1 | 局部改动：单个 feature、页面、组件，使用方很少的 shared 模块 | `pnpm typecheck`、`pnpm lint`、`pnpm test:changed` |
| 2 | 影响面大：packages、shared 的公共能力或接口（`test:changed` 选中几十个文件）、全局样式、路由、页面的加载或缓存 | 级别 1，加 `pnpm build:intranet` 和相关的冒烟用例（`pnpm --filter yzt test:smoke <文件名>`） |
| 3 | 依赖、Vite、tsconfig、lint、CI、构建插件、`.env`，鉴权、会话、HTTP 的核心；发布前 | 和 CI 相同的全量（`docs/commands.md` 的"质量检查"） |

- `test:changed` 只沿 import 关系选测试：`.module.scss` 和被 import 的 JSON 选得到；全局样式（`packages/theme`、`app/styles`）一个也选不到，`.env`、运行时才请求的文件同样查不到，不能因为它没选中测试就算通过
- `pnpm test:changed` 逐个包执行：改包里的代码时，包自己的测试和依赖它的包、web 的测试都能选中
- 改了任何一个 `package.json`、`vite.config.*`、`vitest.config.*` 时，Vitest 自动跑全部测试
- UI 改动按 `docs/design/ui-workflow.md` 另外验证，这里的检查不能代替

## 文档

决策理由、配置说明和学习资料放在 `docs/`，和代码一起提交。

- `docs/README.md`：文档索引与维护约定
- `docs/backlog.md`：唯一的待办清单，解决一项删一行
- `docs/adr/overview.md`：按主题列现行结论，查决策从这里开始；`docs/adr/`：决策记录，编号递增，接受后不再修改，决策有变化时新写一份并注明取代了哪一份
- `docs/modules/`：shared、packages 以及 app 中布局等模块的用法与设计；用法或设计变化时更新
- `docs/config/`：重要配置文件的逐项说明；修改配置文件时同步更新
- `docs/design/`：设计规范、主题落地与页面布局；修改令牌、Element 映射或布局规则时同步更新
- `docs/commands.md`：常用命令；新增或修改脚本时同步更新
- `docs/code-style.md`：完整代码风格
- `docs/archive/`：路线图、迁移记录（含接口实测）和阶段总结，只查不改

## 常用命令

- `pnpm --filter yzt dev`：启动开发服务器；`dev:intranet` 用内网配置
- `pnpm typecheck`、`pnpm lint`（`lint:fix` 自动修复）、`pnpm test:changed`（只跑相关测试）
- `pnpm test`：所有包的测试，逐个包串行；`pnpm --filter @mx/<name> test` 只跑一个包；`pnpm --filter yzt test:unit`、`test:browser` 只跑一个项目；第一次跑浏览器测试前运行 `test:browser:install`
- `pnpm build`、`pnpm build:intranet`（内网，不请求天地图）；`pnpm --filter yzt test:smoke <文件名>`：生产冒烟
- 其余命令（实测、探查、依赖更新）见 `docs/commands.md`；要账号或 token 的脚本由用户在自己的终端运行
