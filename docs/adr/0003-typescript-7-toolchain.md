# 0003. TypeScript 7 与工具链

- 状态：已接受（tsconfig 约定中关于 `incremental` 的一条已被 0009 取代）
- 日期：2026-09-29

## 背景

仓库使用 TypeScript 7.0.2（Go 原生实现）。它的 `package.json` 中，`exports["."]` 只指向 `lib/version.cjs`，不再提供传统的编译器 JS API，官方计划在 7.1 提供一套新的 API。
依赖 `require('typescript')` 的工具因此无法直接使用，已知的有 vue-tsc（ADR 0001 已不需要它）和 typescript-eslint。
Vite 编译 TS/TSX 时不依赖 `typescript` 包，不受影响。
官方给出的过渡办法是与 TS 6 并存：`typescript` 包名指向 `@typescript/typescript6`（命令 `tsc6`），TS 7 以别名 `@typescript/native` 安装（命令仍是 `tsc`）。

## 候选方案

1. 只用 TS 7，只选不依赖 TS JS API 的工具
2. `tsc` 用 TS 7；按官方并存办法再装一份 TS 6，供需要 JS API 的工具使用
3. 整体退回 TS 6

## 实测结果

在 `apps/web`（Vite 8.3、Vue 3.5、`@vitejs/plugin-vue-jsx` 5.1）中用 TS 7.0.2 实测，并用 TS 6.0.3 对照：

- `tsc -b` 检查 TSX：props 类型、必填 props、字面量联合、emit 参数、泛型组件、函数组件、原生元素属性、CSS Modules、`paths`、`verbatimModuleSyntax`，预期错误全部报出，两个版本的诊断完全一致；Element Plus 组件的 props 同样能检查
- 插槽参数不会按组件的 `SlotsType` 推断，写错插槽名也不报错。原因是 Vue 的 `JSX` 命名空间没有声明 `ElementChildrenAttribute`，与 TS 版本无关
- typescript-eslint 8.71.0 在 TS 7 下加载时直接报错退出，连不需要类型信息的规则也无法运行；改用并存方案后类型感知规则正常，示例耗时约 9 秒
- oxlint 配合 oxlint-tsgolint（内置 Go 版 TS）开启 `--type-aware` 后查出相同的问题，耗时不到 1 秒，不需要 TS 6

## 决定

选方案 1：

- 类型检查只用 TS 7，`typescript` 精确锁定版本，不安装 TS 6
- lint 使用 oxlint，类型感知规则由 oxlint-tsgolint 提供，具体规则另写 ADR
- 引入新工具前先确认它不依赖 TS JS API；依赖它的工具等 TS 7.1 的新 API 被广泛支持后再评估
- 以后确实需要依赖 JS API 的工具时，按官方并存办法加装 TS 6（即转为方案 2），另写 ADR 取代本决定

tsconfig 约定：

- 应用采用 solution 风格：`tsconfig.json` 只写 references，`tsconfig.app.json` 检查 `src`，`tsconfig.node.json` 检查 `vite.config.ts`，用 `tsc -b` 一次检查全部
- TS 7 修改了多项默认值（例如 `types` 默认为 `[]`、`strict` 默认开启），并移除了 `baseUrl`；配置中显式写出 `target`、`lib`、`types`、`strict`，`paths` 不依赖 `baseUrl`
- `tsc -b` 配合 `noEmit` 时要开启 `incremental`，否则每次都会因找不到输出文件而全量检查（TS 6 同样如此）
- Vite 通过 `resolve.tsconfigPaths` 直接读取 tsconfig 的 `paths`，不另外配置别名；ADR 0004 提到的"tsconfig `paths` 和 Vite 别名要保持同步"因此不再需要

## 后果

- 好处：只有一个 TS 版本，命令行类型检查、CI 和 lint 的类型信息都来自同一个编译器
- 好处：类型检查和类型感知 lint 都很快，适合在 CI 和提交前频繁运行
- 代价：oxlint 的类型感知规则比 typescript-eslint 少，也更年轻，缺少的规则只能等上游补齐
- 代价：不能使用依赖 TS JS API 的工具，例如 vue-tsc、typescript-eslint，以及部分依赖分析和文档生成工具
- 代价：插槽参数要手动标注类型（Vue 的限制，任何 TS 版本都存在）
- 风险：TS 7 包里没有传统的 tsserver，编辑器需要使用 TS 7 的语言服务；如果编辑器体验无法接受，这是转为方案 2 的主要理由
