# 0016. 通用 UI 组件放在 libs/ui

- 状态：已接受
- 日期：2026-09-30

## 背景

阶段三要做页面布局的通用组件：分栏布局、面板、标题（规范见 [design/page-layout.md](../design/page-layout.md)）。旧项目没有这类组件，每个页面各自写左右结构、面板和标题，同样的"竖杠 + 标题"约有 82 处。

这些组件没有业务含义，以后会被几乎所有业务页面使用，需要决定放在哪里。AGENTS.md 的目录结构中已经预留了 `libs/ui`（`@yzt/ui`，Mx* 通用组件），lint 的 `boundaries` 也已配置了 `apps/web/src/libs/*`，但还没有任何 libs 模块。

## 候选方案

1. `shared/components`：应用内通用代码。最省事，可以直接用 `SvgIcon`、`appConfig`；但没有任何边界约束，组件很容易慢慢依赖上应用的东西
2. `libs/ui`：按"已经是一个包"的规则写（ADR 0004）。只能从 `@yzt/ui` 的入口导入，不能引用应用代码，lint 和 `tsconfig.libs.json` 强制检查
3. `packages/ui`：像 `@yzt/icons` 一样做成 workspace 内部包（ADR 0014）。物理隔离，但要维护单独的 `package.json` 和依赖；目前只有一个应用使用，不满足 ADR 0004 的拆包条件

## 决定

选方案 2，组件放在 `apps/web/src/libs/ui`，统一用 `@yzt/ui` 导入，组件名用 `Mx` 前缀。

`libs/ui` 可以依赖 vue、element-plus、`@element-plus/icons-vue`（lint 只禁止 `utils`、`map-core`、`map-cesium` 依赖它们），可以依赖 `@yzt/utils`，不能依赖应用代码和 `packages/*`。

## 后果

1. **`libs/ui` 是第一个 libs 模块。** `tsconfig.libs.json` 从原计划的阶段四提前到阶段三：只包含 `src/libs`，不加载 `vite/client` 类型，不配置 `@/*`，libs 里读取 `import.meta.env` 或使用 `@/` 导入会在类型检查时报错（ADR 0006）
2. **窄屏断点下移到 `libs/ui`。** 分栏布局要在窄屏时把左栏收进抽屉，必须知道断点；libs 不能引用 app，所以断点由 `libs/ui` 定义，app 的顶部栏反过来引用它，全应用只有一个"窄屏"定义。只有窄屏这一档（1200）下移；顶部栏另外两档（1680、1440）只与顶部栏的内容有关，留在 `app/layout`。布局组件要在 TS 中切换侧栏和抽屉，顶部栏用 Sass 媒体查询，所以断点要同时以 TS 常量和 Sass 变量两种形式提供。Sass 变量不能从 `index.ts` 导出，这是"只从入口导入"（ADR 0004）的唯一例外，具体引用方式在 3.2 确定并写进 `docs/modules/ui.md`
3. **`libs/ui` 不能引用 `shared/icons` 的 `SvgIcon`。** 标题、卡片头部的自定义图标通过插槽传入；组件自身需要的图标（如窄屏的打开按钮）用 `@element-plus/icons-vue`
4. **组件样式依赖 app 定义的 CSS 变量。** 组件使用 `app/styles/tokens.scss` 输出的 `--color-*`、`--font-*`、`--shadow-*`、`--space-*`、`--radius-*`，不 import app 的 SCSS。这是组件与应用之间的约定：换一个应用使用 `@yzt/ui`，要先提供这些变量。组件依赖的变量清单写在 `docs/modules/ui.md`，新增依赖时同步更新

- 好处：布局规则落在一处，页面只组合组件，不再各写间距、圆角和标题样式
- 好处：边界由工具检查，组件不会悄悄依赖路由、store 或环境变量；以后真要拆成 `packages/ui`，是机械操作
- 代价：自定义图标要由页面传入，比直接写 `<SvgIcon name="...">` 多一层
- 代价：CSS 变量的约定没有类型检查，变量名写错不会报错，只能靠预览页和评审发现
