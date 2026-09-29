# 0006. lint 规则与依赖方向检查

- 状态：已接受
- 日期：2026-09-29

## 背景

ADR 0003 选定只用 TS 7，lint 工具因此定为 oxlint，类型感知规则由 oxlint-tsgolint 提供。本 ADR 决定规则怎么选，以及 ADR 0004 的依赖方向怎么检查。
旧项目的 ESLint 靠关掉规则才能通过。用 oxlint 1.85 按分类统计旧项目 `src`（289 个文件）：correctness 43、perf 42、suspicious 716、pedantic 1561、restriction 4668、style 19290。后三类包含大量互相矛盾的偏好（例如禁止可选链、禁止三元表达式），不能整类开启。
oxlint 原生的 `no-restricted-imports` 只匹配导入字符串，判断不出 `../layer/store` 这类相对路径是否越过了 feature 边界；oxlint 也没有 `import/no-restricted-paths` 和 `no-restricted-syntax`。

## 候选方案

规则基线：

1. 只开 correctness，其余逐条挑选
2. correctness、suspicious、perf 整类开启，其余逐条挑选
3. 在 2 的基础上再整类开启 pedantic

依赖方向：

1. 只用原生规则（`no-restricted-imports` + `import/no-cycle`），相对路径越界靠约定和代码评审
2. 通过 oxlint 的 `jsPlugins` 运行 eslint-plugin-boundaries，按解析后的真实路径检查
3. 用 `jsPlugins` 自己写一条规则

## 实测结果

用一个模拟 `apps/web/src` 分层、包含 18 处违规的夹具实测：

- 依赖方向方案 2（boundaries 7.2）查出 16 处，包括相对路径越界、跨模块相对导入、libs 依赖 vue、禁用的包，没有误报，耗时约 1 秒
- 剩下 2 处由 TS 负责：`@yzt/*` 的 `paths` 只映射到 `index.ts`，深层导入 `@yzt/map-core/internal` 直接报"找不到模块"；libs 专用的 tsconfig 不加载 `vite/client` 类型、不配置 `@/*`，读取 `import.meta.env` 和使用 `@/` 导入都会报错
- `no-restricted-properties` 检查不到 `import.meta.env`
- boundaries 的 `dependencies` 规则默认不检查外部包和同一元素内部的导入，要开启 `checkAllOrigins`、`checkInternals`
- 匹配相对路径要写成 `.{,.}/**`；micromatch 会规范化 `./**`，匹配不到 `./store`
- tsgolint 能顺着 solution 风格 tsconfig 的 references 找到 `tsconfig.app.json`；Vue 插件的规则对 TSX 中的 `defineComponent` 生效
- `typescript/no-unsafe-type-assertion` 会把 `String as PropType<...>`、`Object as SlotsType<...>` 报为不安全断言
- 类型感知的 `no-unsafe-*` 能查出 `response.json()` 返回的 `any` 被直接使用，Element Plus 组件的用法没有误报

## 决定

规则基线选方案 2：

- correctness、suspicious、perf 整类开启，只关闭 `typescript/no-unsafe-type-assertion`（误报 Vue 的 props 与插槽写法）
- suspicious 中的 `no-underscore-dangle` 保留：类的私有成员用 TS 的 `private` 或 `#`，不用下划线前缀
- pedantic、style、restriction 不整类开启，只逐条开启与 AGENTS.md 约定对应的规则：`eqeqeq`、`no-var`、`prefer-const`、`typescript/no-explicit-any`、`no-console`（允许 `warn`、`error`）、`import/no-cycle`、`import/no-duplicates`，以及用 `no-restricted-imports` 禁止 `lodash` 整包和 `lodash-es` 的默认导入
- 另外开启类型感知规则：`no-unsafe-argument`、`no-unsafe-assignment`、`no-unsafe-call`、`no-unsafe-member-access`、`no-unsafe-return`、`no-misused-promises`、`only-throw-error`、`prefer-promise-reject-errors`、`switch-exhaustiveness-check`、`no-deprecated`
- 规则只分 `error` 和 `off` 两级，不用 `warn`；开启 `denyWarnings` 兜底，`reportUnusedDisableDirectives` 设为 `error`
- 在代码中关闭规则时必须写明原因
- 不开启格式类规则（例如 `curly`），格式只由 WebStorm 负责

依赖方向选方案 2：

- `boundaries/dependencies` 默认禁止，开启 `checkAllOrigins`、`checkInternals`，按 ADR 0004 的分层逐条放行
- 同一单元（一个 feature、一个 lib 模块、shared、pages、app）内部只用相对路径；跨单元只用别名，引用 libs 只能写 `@yzt/<name>`
- `utils`、`map-core`、`map-cesium` 禁止依赖 vue、vue-router、pinia、element-plus；全局禁止 `mapbox-gl`（ADR 0002）
- `import/no-cycle` 检查循环依赖
- TS 兜底：`@yzt/*` 的 `paths` 只映射到各模块的 `index.ts`；创建第一个 libs 模块时加上 `tsconfig.libs.json`，不加载 `vite/client` 类型，不配置 `@/*`

配置与版本：

- 配置写在根目录的 `.oxlintrc.json`，从仓库根目录运行 `oxlint`，路径按 `apps/web/src/...` 书写
- `jsPlugins` 处于 alpha 阶段、不承诺语义化版本，因此 oxlint 精确锁定版本；oxlint-tsgolint 内置 TS 7，和 `typescript` 一样精确锁定
- eslint-plugin-boundaries、eslint-import-resolver-typescript 使用 `^`
- `unrs-resolver` 的安装脚本不放行，它已有各平台的预编译包

## 后果

- 好处：依赖方向由工具强制检查，改用相对路径也绕不过去
- 好处：一套配置同时负责代码质量、类型感知和架构边界，整体在秒级完成
- 代价：依赖 alpha 阶段的 `jsPlugins`，升级 oxlint 时要先确认 boundaries 仍然正常工作
- 代价：pnpm 会把 eslint 作为 boundaries 的 peer 依赖自动装上，实际用不到
- 代价：tsconfig 的 `paths`、boundaries 的元素定义和 ADR 0004 的分层，三处要保持一致
- 代价：CI 不检查格式，没经过 WebStorm 格式化的代码（例如 AI 生成的代码）要在提交前手动格式化
