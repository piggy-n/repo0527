# 通用 UI 组件（libs/ui）

对应目录：`apps/web/src/libs/ui/`，导入名 `@yzt/ui`
相关决策：[ADR 0016](../adr/0016-ui-components-in-libs-ui.md)；设计规范：[design/page-layout.md](../design/page-layout.md)

第一个 libs 模块，按"已经是一个包"的规则编写（ADR 0004）：外部只从入口导入，内部只用相对路径，不读取 `import.meta.env`、store、router，不引用应用代码。这些规则由 lint 的 `boundaries` 和 `tsconfig.libs.json` 检查（见 [config/tsconfig.md](../config/tsconfig.md)）。

目前有标题 `MxTitle` 和面板 `MxPanel`；分栏布局 `MxSplitLayout` 在 3.2c 加入。组件的展示在主题预览页（`/dev/theme`）的最后两节。

## 目录

```
libs/
├─ css-modules.d.ts         libs 专用的 CSS Modules 类型声明（见下文"类型检查"）
└─ ui/
   ├─ index.ts              TS 入口
   ├─ _index.scss           Sass 入口：只放变量，不输出 CSS
   ├─ breakpoints.ts        窄屏断点
   ├─ breakpoints.test.ts   检查 TS 与 Sass 中的断点一致
   ├─ title/MxTitle.tsx     标题
   └─ panel/MxPanel.tsx     面板
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

## MxTitle

```tsx
<MxTitle level="panel">文件目录</MxTitle>
<MxTitle>{{ default: () => '选择表', extra: () => <ElCheckbox>全选</ElCheckbox> }}</MxTitle>
<MxTitle>{{ default: () => '处理进度', icon: () => <SvgIcon name="..." /> }}</MxTitle>
```

| 属性 / 插槽 | 说明 |
|---|---|
| `level` | `'panel'`：面板标题，16/600，渲染为 `h2`；`'section'`（默认）：区块标题，14/600，渲染为 `h3`。单独使用时基本是区块标题，面板标题一般由 `MxPanel` 渲染 |
| `default` | 标题文字，过长时省略 |
| `icon` | 替换左侧的竖杠。大小跟随标题层级的字号（面板 20、区块 16），颜色为主色；`SvgIcon`、`ElIcon` 默认都是 `1em`，不用传 `size` |
| `extra` | 放在右侧，不参与省略 |

结构：外层 `div` 里依次是竖杠或图标、标题元素、`extra`。`extra` 不放在 `h2` / `h3` 里，读屏软件读标题时不会带上"全选""刷新"这类操作；竖杠和图标是装饰，设置了 `aria-hidden`。

组件不设外边距：它会出现在面板头部这类 flex 容器里，由使用方决定间距。规范中的区块间距（区块之间 `--space-lg`，区块标题与内容之间 `--space-md`）目前由页面自己写。

## MxPanel

```tsx
<MxPanel title="资源审核">
  {{
    actions: () => <ElButton type="primary">上传文件</ElButton>,
    default: () => <ElTable class={styles.table} height="100%" data={rows} />,
    footer: () => <ElPagination total={total} />
  }}
</MxPanel>
```

| 属性 / 插槽 | 说明 |
|---|---|
| `title` | 面板标题，用 `MxTitle level="panel"` 渲染 |
| `flush` | 去掉内容区的内边距：表格贴边、放地图、内容自带内边距时使用 |
| `iconTile` | 卡片头部：`icon` 放在 24 的浅底方块里，图标 16。只用于同一页有多张并列卡片、需要用图标区分的场合 |
| `icon` | 标题左侧的图标，替换竖杠 |
| `actions` | 头部右侧的操作 |
| `default` | 内容区 |
| `footer` | 底部，内容靠右（如分页）；不传就不渲染 |

- 有 `title` 或 `actions` 才渲染头部；没有头部时，内容区上方同样留 `--space-lg`
- 面板是纵向 flex 容器，自身 `flex: 1`：放在纵向 flex 容器（分栏布局的两栏）里时占满剩余高度，不需要写 `calc(100% - 32px)`；在普通块级容器里按内容撑开
- 内容区也是纵向 flex 容器，内部滚动。放表格时，给表格加 `flex: 1; min-height: 0` 并设置 `height="100%"`，表格占满剩余高度、在内部滚动，分页固定在底部（已在预览页验证：高 360 的容器中，面板 334、内容区 238、表格 222，内容区本身不滚动）
- 根元素是 `section`，标题是其中的 `h2`

## 插槽的写法

TSX 中给组件传多个插槽时，子元素写成对象：`{{ default: () => ..., actions: () => ... }}`；只有默认插槽时直接写子元素。

组件用 `slots: Object as SlotsType<{ ... }>` 声明插槽，组件内部的 `slots.icon` 等有类型。但使用方写错插槽名或插槽参数时不会报错（Vue 的 JSX 类型限制，ADR 0003），插槽名以本文为准。

## 类型检查

`tsconfig.libs.json` 不加载 `vite/client`，而 `*.module.scss` 的类型本来由它提供，所以 `libs/css-modules.d.ts` 单独声明（与 `@yzt/icons` 包的做法相同）。`tsconfig.app.json` 的 `include` 是整个 `src`，会同时看到 `vite/client` 和这份文件里的同名声明，所以 app 配置用 `exclude` 排除了这份文件，只让 libs 配置使用。不排除时也不会报错，但那是因为 `skipLibCheck` 跳过了所有 `.d.ts` 的检查，不应依赖它。

## 组件依赖的 CSS 变量

组件的样式使用应用在 `app/styles/tokens.scss` 中定义的 CSS 变量，不 import 应用的 SCSS（ADR 0016）。换一个应用使用 `@yzt/ui`，要先提供这些变量：

| 组件 | 变量 |
|---|---|
| `MxTitle` | `--color-primary`、`--color-text-strong`、`--color-text-title`、`--color-text-primary`、`--font-size-lg`、`--font-size-base`、`--font-weight-semibold`、`--space-sm` |
| `MxPanel` | `--color-bg-container`、`--color-primary-bg`、`--shadow-sm`、`--radius-md`、`--radius-sm`、`--space-lg`、`--space-sm` |

新增或修改组件样式时同步更新本表。变量名写错不会报错（CSS 变量没有类型检查），要在预览页里确认。
