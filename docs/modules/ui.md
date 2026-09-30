# 通用 UI 组件（libs/ui）

对应目录：`apps/web/src/libs/ui/`，导入名 `@yzt/ui`
相关决策：[ADR 0016](../adr/0016-ui-components-in-libs-ui.md)；设计规范：[design/page-layout.md](../design/page-layout.md)

第一个 libs 模块，按"已经是一个包"的规则编写（ADR 0004）：外部只从入口导入，内部只用相对路径，不读取 `import.meta.env`、store、router，不引用应用代码。这些规则由 lint 的 `boundaries` 和 `tsconfig.libs.json` 检查（见 [config/tsconfig.md](../config/tsconfig.md)）。

分栏布局、面板、标题组件在 3.2 中陆续加入，届时补充本文。

## 目录

```
libs/ui/
├─ index.ts              TS 入口
├─ _index.scss           Sass 入口：只放变量，不输出 CSS
├─ breakpoints.ts        窄屏断点
└─ breakpoints.test.ts   检查 TS 与 Sass 中的断点一致
```

## 两个入口

| 入口 | 用法 | 内容 |
|---|---|---|
| `index.ts` | `import { COMPACT_MEDIA_QUERY } from '@yzt/ui'` | 组件、常量、类型 |
| `_index.scss` | `@use 'ui';` 之后写 `ui.$compact` | Sass 变量 |

Sass 入口是"只从 `index.ts` 导入"的唯一例外：媒体查询里用不了 CSS 变量，断点只能以 Sass 变量的形式提供给样式。应用中写 `@use 'ui'` 能找到它，是因为 `vite.config.ts` 把 `src/libs` 加进了 Sass 的 `loadPaths`（见 [config/vite-config.md](../config/vite-config.md)）。Sass 入口只放变量，不写会输出 CSS 的规则，否则每个 `@use` 它的样式文件都会重复输出一份。

## 窄屏断点

全应用只有一个"窄屏"定义（page-layout.md）：视口宽度小于 1200 时，顶部导航收进"☰ 菜单"，分栏布局的侧栏收进抽屉。

| 形式 | 名称 | 值 | 使用方 |
|---|---|---|---|
| TS 常量 | `COMPACT_BREAKPOINT` | `1200` | — |
| 媒体查询字符串 | `COMPACT_MEDIA_QUERY` | `'(width < 1200px)'` | 分栏布局切换侧栏与抽屉（3.2c） |
| Sass 变量 | `ui.$compact` | `1200px` | 顶部导航的窄屏菜单（`app/layout/components/HeaderNav.module.scss`） |

- 为什么需要两种形式：顶部栏靠 CSS 媒体查询切换；分栏布局要在 TS 中决定侧栏内容放在哪里，要用 `matchMedia`
- 两处定义由 `breakpoints.test.ts` 检查一致：改了其中一处而没改另一处，测试会失败（已验证：把 Sass 改成 1280px，断言报 `expected 1280 to be 1200`）
- 媒体查询统一用区间写法 `(width < 1200px)`，不用 `(max-width: 1199px)`。浏览器缩放时视口宽度可能是小数，例如 1199.5px：`max-width: 1199px` 不匹配，`width < 1200px` 匹配。TS 和 Sass 用同一种写法，两边才会在同一宽度切换
- 顶部栏另外两档（1680、1440）只和顶部栏的内容有关，留在 `app/layout/_breakpoints.scss`（见 [modules/layout.md](layout.md)）

## 组件依赖的 CSS 变量

组件的样式使用应用在 `app/styles/tokens.scss` 中定义的 CSS 变量，不 import 应用的 SCSS（ADR 0016）。清单随组件加入补充。
