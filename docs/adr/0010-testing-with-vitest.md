# 0010. 测试使用 Vitest 与 jsdom

- 状态：已接受
- 日期：2026-09-29

## 背景

ADR 0005 规定 CI 依次运行冻结安装、类型检查、lint、测试、构建，测试步骤等框架确定后加入。阶段二开始写鉴权、HTTP 这类纯逻辑代码之前，需要先有测试框架。

约束：

- 只用 TypeScript 7，不能引入依赖 TS JS API 的工具（ADR 0003）
- 组件用 TSX，需要 `@vitejs/plugin-vue-jsx` 编译；代码中使用路径别名、CSS Modules、`import.meta.env`
- AGENTS.md 禁止 API 自动导入

## 候选方案

运行器：

1. Vitest：直接复用 `vite.config.ts` 的插件、别名和 `.env`
2. Jest：TS 转译通常依赖 ts-jest（需要 TS JS API）或另配一套 Babel，Vite 中已有的配置都要重复一遍
3. Node 自带的 `node:test`：处理不了 TSX 和 CSS Modules

DOM 环境：

1. jsdom：规范实现较完整，Vue 与 Element Plus 生态最常用
2. happy-dom：依赖少，更轻量，规范实现不如 jsdom 完整
3. Vitest 浏览器模式：用 Playwright 启动真实浏览器，最真实，但 CI 需要下载浏览器

## 实测结果

Vitest 5.0.2，用一个包含 Element Plus 的 TSX 组件写了 5 个探针用例：按钮点击与自定义事件、输入框更新、`ElConfigProvider` 中文语言包、`ElSelect` 下拉、`ElMessageBox` 函数式调用。

| | happy-dom 20.14 | jsdom 30.1 |
|---|---|---|
| 结果 | 5 个全部通过，无警告 | 5 个全部通过，无警告 |
| 墙钟耗时（3 次） | 3.4～4.4 秒 | 约 3.9 秒 |
| 直接依赖 | 7 个 | 约 20 个 |

其他结论：

- Vitest 复用 `vite.config.ts` 后，TSX、路径别名、`.env` 都无需额外配置；测试文件能通过 `tsc -b` 与 oxlint
- `it.only` 在本地会让其他用例被悄悄跳过；Vitest 在 `CI` 环境变量存在时拒绝运行带 `.only` 的测试；开启 oxlint 的 vitest 插件后，`no-focused-tests` 能在本地拦住
- 不开 `unstubEnvs` 时，一个用例中 `vi.stubEnv` 修改的变量会泄漏到后续用例

## 决定

- 运行器用 Vitest 5，配置写在 `vite.config.ts` 的 `test` 字段
- DOM 环境用 jsdom：速度与 happy-dom 相当，规范实现更完整
- 不开启 `globals`，测试文件显式从 `vitest` 导入 API
- 测试文件和源文件放在一起，命名为 `*.test.ts` / `*.test.tsx`
- 开启 `unstubEnvs`，每个用例结束后撤销 `vi.stubEnv`
- oxlint 开启 vitest 插件
- CI 在 lint 与构建之间运行 `pnpm test`

暂不引入：覆盖率（有真实业务逻辑后再加，并设门槛）；浏览器模式（地图组件需要 WebGL 时再评估）；E2E（阶段三以后，届时评估 Playwright）。

## 后果

- 好处：开发、构建、测试共用一份 Vite 配置，不会出现"测试能过、运行不行"的配置差异
- 好处：测试跟着源文件走，libs 模块将来拆成独立包时一起搬走
- 代价：jsdom 没有布局和 WebGL，涉及尺寸计算、Canvas、地图渲染的组件无法在这里真实测试
- 代价：Vitest 5 刚发布不久（5.0.0 于 2026-09-03 发布），可能遇到早期问题
