# 0014. 图标做成第一个 workspace 包 @yzt/icons（内部包）

- 状态：已接受
- 日期：2026-09-29
- 补充：ADR 0004 规定可拆分模块先放在 `apps/web/src/libs/`，出现第二个使用方时再移到 `packages/`。本决定对图标例外，直接建在 `packages/`；其余 libs 模块仍按 0004 执行

## 背景

阶段二要统一 SVG 图标：规范化用户提供的 SVG（去固定颜色、统一命名），并提供统一的调用方式。图标组件和规范化工具与业务无关，可以在其他项目复用；项目本身也要学习 monorepo 的包管理。

## 候选方案

1. `packages/icons` 独立的 workspace 包：应用通过 `workspace:*` 依赖它
2. 按 ADR 0004 放在 `apps/web/src/libs/ui`，等有第二个使用方再移动

包的形式：

1. 内部包（internal package）：`exports` 直接指向 TS 源码，不单独构建，由使用方的 Vite 编译
2. 构建型包：包自己用 Vite 库模式或 tsc 产出 JS 和 `.d.ts`，使用方消费构建结果

## 决定

- 选 `packages/icons`，包名 `@yzt/icons`，采用内部包形式
- 包内包含与业务无关的部分：图标组件工厂 `createIconComponent`（本步骤）和 SVG 规范化工具（后续）；应用自己的图标文件留在 `apps/web`
- 包遵守 ADR 0004 对 libs 的约束：唯一入口、不读 `import.meta.env` 和全局状态、依赖通过参数传入。所以组件做成工厂函数，图标数据由应用传入
- 包按运行环境拆分 tsconfig（`tsconfig.lib.json` 与 `tsconfig.node.json`），有自己的 `typecheck`、`test` 脚本，由根目录的 `pnpm -r` 覆盖
- `vue` 作为 peer 依赖，由使用方提供，避免出现两份 Vue
- lint 增加 `package` 元素：应用只能通过 `@yzt/*` 引用包，包只能依赖外部模块和包内部文件

## 实测结果

- apps/web 的 tsconfig 中 `@yzt/*` 映射到 `./src/libs/*/index.ts`。`@yzt/icons` 在映射找不到文件后，TS 回退到 `node_modules` 解析，得到 `packages/icons/src/index.ts`
- 开发服务器能编译包里的 TSX 和 CSS Modules
- lint：没有 `package` 元素定义时，`@yzt/icons` 被当作外部依赖，包内导入应用代码不报错；加上定义和策略后，"包导入应用""应用用相对路径绕过包入口"都会报错，正常的 `@yzt/icons` 导入通过
- 组件的 `name` 属性类型来自注册表的键；把类型放宽成 `string` 后，测试里的 `@ts-expect-error` 会变成未使用而报错，说明类型测试有效

## 后果

- 好处：包的边界由 `package.json` 的 `exports` 和 lint 双重保证，只能通过入口使用
- 好处：内部包不需要构建步骤，改包里的代码，应用立刻生效，调试时直接看源码
- 代价：内部包只能被同样会编译 TSX 的项目使用；将来如果要发布到 npm 或给非 Vite 项目用，需要改成构建型包
- 代价：每个包都要维护自己的 tsconfig、测试配置和依赖列表，新建包的步骤见 `docs/config/internal-packages.md`
