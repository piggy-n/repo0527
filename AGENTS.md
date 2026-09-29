# yzt 重构（repo0527）

用 Vue 3 + TSX + TypeScript 重写 `C:\WebProject\yzt`（江苏省统一调查监测现状图，master-demo 分支）。
这是学习型重构：迁移的同时学习 Vue 3、TS、架构设计、面向对象与设计模式、monorepo 和前端工程化。

## 协作方式

- 每一步先说明设计理由、替代方案和涉及的知识点，再动手
- 一次推进一个小步骤，不擅自扩大范围；涉及选型的问题先讨论再决定
- 重要决策写成 ADR（`docs/adr/`）；阶段结束时把新结论同步到本文件
- 登录页等重要页面先按设计规范出设计稿，确认后再开发；主题与组件库层面的改动用预览页截图确认
- 提交信息使用 Conventional Commits 格式（`feat` / `fix` / `refactor` / `docs` / `chore` 等）

## 技术栈

已确定：

- Vue 3 + TSX（`defineComponent`），不使用 `.vue` 单文件组件（ADR 0001）
- TypeScript strict，Vite，Pinia，Vue Router，Element Plus，pnpm workspace
- Element Plus 组件显式具名导入，样式全量引入 `element-plus/dist/index.css`，语言包用 `ElConfigProvider` 设置
- Vue Router 5，手写路由表，history 模式，不启用文件路由（ADR 0007）
- Pinia 4，只用 setup store
- 只用 TypeScript 7 一个版本；不引入依赖 TS JS API 的工具（vue-tsc、typescript-eslint 等），lint 用 oxlint + oxlint-tsgolint（ADR 0003），规则与依赖方向检查见 ADR 0006
- 二维地图用 MapLibre GL JS，大版本在地图阶段确定；禁止引入 `mapbox-gl`（2.0 起为专有许可）（ADR 0002）
- 三维地图用 Cesium，精确锁定版本（ADR 0002）
- 浏览器目标用 Vite 默认值，不兼容旧浏览器，不引入 `@vitejs/plugin-legacy`
- CI 用 GitHub Actions：冻结安装 → 类型检查 → lint → 构建，测试接入后加入（ADR 0005）

待定：测试、服务端状态、Mock、持久化（计划用 IndexedDB + idb-keyval）

## 目录结构

```
apps/web/src/
├─ app/        应用装配：入口、路由、Pinia、全局插件、布局
├─ pages/      路由页面，只负责组合 features
├─ features/   按业务域划分：api.ts、queries.ts、store.ts、components/、composables/
├─ shared/     应用内通用：HTTP 客户端、鉴权、存储、通用 composables 与类型
└─ libs/       将来可拆到 packages/* 的模块，统一用 @yzt/<name> 导入
   ├─ utils/       @yzt/utils       纯 TS 工具，不依赖框架
   ├─ ui/          @yzt/ui          Mx* 通用组件
   ├─ map-core/    @yzt/map-core    地图内核，不依赖 Vue
   ├─ map-cesium/  @yzt/map-cesium  Cesium 三维
   └─ map-vue/     @yzt/map-vue     地图与 Vue 的衔接
```

## 依赖方向

- `pages → features → shared → libs`，`app` 可以依赖所有目录
- features 之间不互相导入，需要复用的内容上移到 shared 或 libs
- libs 内部：`utils ← ui`，`utils ← map-core ← map-cesium`，`map-vue → map-core`；map-vue 只能用动态 `import()` 引用 map-cesium
- `utils`、`map-core`、`map-cesium` 不依赖 vue、element-plus、pinia
- 同一单元（一个 feature、一个 lib 模块、shared、pages、app）内部只用相对路径；跨单元只用别名，引用 libs 只写 `@yzt/<name>`
- 以上规则由 lint 强制检查（根目录 `.oxlintrc.json` 的 `boundaries/dependencies`），分层有变化时同步修改（ADR 0006）

## libs 的拆包规则（ADR 0004）

- 每个模块只有一个入口 `index.ts`，外部只能从 `@yzt/<name>` 导入，不直接引用模块内部文件
- 模块内部只用相对路径，不使用 `@/`
- 不读取 `import.meta.env`、store、router 或全局单例，需要的依赖通过构造参数或函数参数传入
- 模块之间不能循环依赖
- 创建第一个 libs 模块时，加上 `apps/web/tsconfig.libs.json`：只包含 `src/libs`，不加载 `vite/client` 类型，不配置 `@/*`，让读取 env 和使用 `@/` 在类型检查时报错（ADR 0006）

## 编码约定

### 格式

以根目录 `.editorconfig` + WebStorm 格式化为准：UTF-8、2 空格缩进、120 列、单引号、语句末尾加分号、不加尾随逗号、`if` / `else` 必须带大括号。
完整说明见 `docs/code-style.md`。格式规则只交给一个工具负责，lint 不管格式。

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
- 给组件传 `id` 等未声明的透传属性会报类型错误（组件只接受声明的 props 和 `class`、`style`），需要标记时用 `data-*`

### Pinia

- 只用 setup store：`defineStore('id', () => { ...; return { ... } })`；全部 state 都要 return，否则 devtools 和插件看不到；需要重置时自己写 `reset`
- 命名 `useXxxStore`；业务域的 store 放在 `features/<域>/store.ts`，跨域共用的放在 `shared/`
- 只放跨组件共享的客户端状态；组件内部状态留在组件里，接口数据不放进 store
- 解构 state 和 getter 用 `storeToRefs`，action 可以直接解构
- store 不做路由跳转和 UI 提示（不用 `useRouter`、`ElMessage`），由调用方处理
- 每个 store 文件末尾加 HMR：`if (import.meta.hot) { import.meta.hot.accept(acceptHMRUpdate(useXxxStore, import.meta.hot)); }`；不加的话，修改 store 后页面会继续使用旧的 store 实例
- `app/main.ts` 中 pinia 要先于 router 安装
- 路径别名只在 tsconfig 的 `paths` 中配置，Vite 通过 `resolve.tsconfigPaths` 读取，不另配 `resolve.alias`
- 自定义环境变量只在 `shared/config/app-config.ts` 中读取和校验，其他代码使用 `appConfig`；Vite 内置的 `DEV`、`PROD`、`MODE`、`BASE_URL` 可以直接读取。新增变量要在 `shared/config/import-meta-env.ts` 中声明类型
- `VITE_` 开头的变量会写进构建产物，不能放密钥；只给 `vite.config.ts` 用的变量不加 `VITE_` 前缀
- 接口请求走同源的 `appConfig.apiBaseUrl`（`/backend`），由 Vite 或 nginx 转发到后端（ADR 0008）

### 样式与设计规范

- 设计参考 `docs/design/color-and-typography.md`，落地方式见 `docs/design/theme.md`；规范和 Element Plus 的交互风格冲突时，优先和 Element 保持一致
- 颜色、字号、字重、行高、阴影一律使用令牌（`var(--color-*)` 等 CSS 变量），不写死色值和字号；规范里没有的值先补进规范和 `app/styles/tokens.scss`
- 字号只用双数
- Element Plus 的外观只在 `app/styles/element-theme.scss` 统一调整，页面和组件不单独覆盖 `--el-*` 变量

## 迁移规则

- 只迁移旧项目中实际在用的模块。不迁移：资源中心（含知识图谱；但代码放在 `views/resource-center/` 下的文件管理要迁移）、资源共享、统计分析、旧版 resource-management、`views/sys` 与动态菜单路由、`/home` 测试页、mockjs、backend-switcher
- 先读懂旧模块的行为，再按新架构重写，不逐行照搬；类结构和算法有价值的，保留设计并补上类型
- 开始迁移一个模块时，在 `docs/migration.md` 记下 yzt 的基线 commit，之后用 `git diff <基线>..HEAD -- <路径>` 同步旧仓库的新改动

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
- `docs/code-style.md`：完整代码风格
- `docs/adr/`：架构决策记录，编号递增，接受后不再修改；决策有变化时新写一份，并注明取代了哪一份
- `docs/config/`：重要配置文件的逐项说明；修改配置文件时同步更新
- `docs/design/`：设计规范原文与主题落地说明；修改令牌或 Element 映射时同步更新
- `docs/commands.md`：常用命令说明；新增或修改脚本时同步更新
- `docs/stages/`：各阶段总结与学习笔记，每个阶段结束时新增一篇
- `docs/migration.md`：各模块的迁移基线与进度

## 常用命令

- `pnpm --filter @yzt/web dev`：启动开发服务器
- `pnpm typecheck`：所有包的类型检查（`tsc -b`）
- `pnpm lint`：lint 检查（含类型感知规则与依赖方向）；`pnpm lint:fix` 自动修复可安全修复的问题
- `pnpm build`：所有包的生产构建
- CI（`.github/workflows/ci.yml`）依次运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm build`
- `pnpm deps:check`：检查过期的依赖和 GitHub Actions
- `pnpm deps:update:within-range`：在版本范围内更新依赖和 Actions
- `pnpm deps:update:allow-major`：交互式选择要升级大版本的依赖和 Actions
- 测试命令在接入后补充
