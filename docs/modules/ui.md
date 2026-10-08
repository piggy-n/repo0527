# 通用 UI 组件（libs/ui）

对应目录：`apps/web/src/libs/ui/`，导入名 `@yzt/ui`
相关决策：[ADR 0016](../adr/0016-ui-components-in-libs-ui.md)；设计规范：[design/page-layout.md](../design/page-layout.md)

第一个 libs 模块，按"已经是一个包"的规则编写（ADR 0004）：外部只从入口导入，内部只用相对路径，不读取 `import.meta.env`、store、router，不引用应用代码。这些规则由 lint 的 `boundaries` 和 `tsconfig.libs.json` 检查（见 [config/tsconfig.md](../config/tsconfig.md)）。

目前有分栏布局 `MxSplitLayout`、面板 `MxPanel`、区块 `MxSection`、标题 `MxTitle`。组件的展示在主题预览页（`/dev/theme`）的最后四节。

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
   ├─ section/MxSection.tsx 区块：区块标题 + 内容
   ├─ panel/MxPanel.tsx     面板
   └─ split-layout/
      ├─ MxSplitLayout.tsx     分栏布局
      ├─ context.ts            provide / inject 的键与 useSplitLayout
      └─ scroll-positions.ts   记录与写回滚动位置
```

## 两个入口

| 入口 | 用法 | 内容 |
|---|---|---|
| `index.ts` | `import { MxPanel, useSplitLayout } from '@yzt/ui'` | 组件、组合式函数、常量、类型 |
| `_index.scss` | `@use 'ui';` 之后写 `ui.$compact` | Sass 变量 |

Sass 入口是"只从 `index.ts` 导入"的唯一例外：媒体查询里用不了 CSS 变量，断点只能以 Sass 变量的形式提供给样式。应用中写 `@use 'ui'` 能找到它，是因为 `vite.config.ts` 把 `src/libs` 加进了 Sass 的 `loadPaths`（见 [config/vite-config.md](../config/vite-config.md)）。Sass 入口只放变量，不写会输出 CSS 的规则，否则每个 `@use` 它的样式文件都会重复输出一份。

## 窄屏断点

全应用只有一个"窄屏"定义（page-layout.md）：视口宽度小于 1200 时，顶部导航收进"☰ 菜单"，分栏布局的侧栏收进抽屉。

| 形式 | 名称 | 值 | 使用方 |
|---|---|---|---|
| TS 常量 | `COMPACT_BREAKPOINT` | `1200` | — |
| 媒体查询字符串 | `COMPACT_MEDIA_QUERY` | `'(width < 1200px)'` | 分栏布局切换侧栏与抽屉（`useMediaQuery`） |
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

组件不设外边距：它会出现在面板头部这类 flex 容器里，由使用方决定间距。"区块标题 + 内容"的组合用 `MxSection`，间距由它负责。

## MxSection

```tsx
<MxSection title="年份选择">
  <ElDatePicker ... />
</MxSection>
<MxSection title="选择表">
  {{ extra: () => <ElCheckbox>全选</ElCheckbox>, default: () => <TableChecklist /> }}
</MxSection>
```

| 属性 / 插槽 | 说明 |
|---|---|
| `title` | 必填，区块标题，用 `MxTitle`（区块层级，`h3`）渲染 |
| `icon`、`extra` | 原样交给区块标题 |
| `default` | 内容，放在标题下方的一个 `div` 里 |

- 区块标题与内容之间 `--space-md`（12），用 flex 的 `gap` 实现。内容外面包一层 `div`，否则默认插槽里的多个元素会各自成为 flex 项，彼此之间也被拉开 12
- 相邻区块之间 `--space-lg`（16），用 `.root + .root` 的上外边距实现，只在两个 `MxSection` 紧挨着时生效；区块放在其他元素后面时不额外加外边距，组件不干涉外部的排版
- 根元素是 `section`，与 `MxPanel` 的 `section` 嵌套时形成"面板 h2 → 区块 h3"的标题层级
- 已在预览页实测：面板中连续三个区块，标题与内容之间都是 12，区块之间都是 16，最后一个区块到面板底边 16（面板内容区的内边距）

为什么不让 `MxTitle` 自带下外边距：标题也会放在面板头部这类 flex 容器里，带外边距就得在这些地方再抵消掉；把间距放在 `MxSection` 这一层，标题和内容的关系由它负责，标题本身保持干净。

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
| `description` | 紧跟在标题后面的灰色说明（12px、`text-secondary`），例如分类的上级路径；空间不够时先省略它，标题保持完整（收缩系数远大于标题），悬停显示全文。`MxTitle` 也有同名属性 |
| `flush` | 去掉内容区的内边距：表格贴边、放地图、内容自带内边距时使用 |
| `iconTile` | 卡片头部：`icon` 放在 24 的浅底方块里，图标 16。只用于同一页有多张并列卡片、需要用图标区分的场合 |
| `asideToggle` | 放在分栏布局的主区时，窄屏下在头部最左侧显示打开侧栏的按钮（图标 + 侧栏名称，后接竖线）。一般给主区的第一个面板加 |
| `icon` | 标题左侧的图标，替换竖杠；有 `title` 时才显示 |
| `actions` | 头部右侧的操作 |
| `default` | 内容区 |
| `footer` | 底部，内容靠右（如分页）；不传就不渲染 |

- 有 `title`、`actions`，或需要显示打开 / 关闭侧栏的按钮时，才渲染头部；没有头部时，内容区上方同样留 `--space-lg`
- 面板是纵向 flex 容器，自身 `flex: 1`：放在纵向 flex 容器（分栏布局的两栏）里时占满剩余高度，不需要写 `calc(100% - 32px)`；在普通块级容器里按内容撑开
- 主区放多个面板时，它们默认平分高度；某个面板要按内容高度显示时，页面给它加一个 `flex: none` 的 class（面板接受 `class`、`style`，加在根元素上）
- 内容区也是纵向 flex 容器，内部滚动。放表格时，给表格加 `flex: 1; min-height: 0` 并设置 `height="100%"`，表格占满剩余高度、在内部滚动，分页固定在底部（已在预览页验证：高 360 的容器中，面板 334、内容区 238、表格 222，内容区本身不滚动）
- 根元素是 `section`，标题是其中的 `h2`
- 在分栏布局的侧栏里、且是侧栏内容的最外层面板时，窄屏下（内容在抽屉里）自动去掉圆角和阴影，并在头部右侧加关闭按钮；没有标题时也会渲染头部来放关闭按钮。嵌套在里面的面板不受影响

## MxSplitLayout

```tsx
<MxSplitLayout asideLabel="文件目录">
  {{
    aside: () => (
      <MxPanel title="文件目录">
        <DirectoryTree />
      </MxPanel>
    ),
    default: () => (
      <MxPanel title={directory.value} asideToggle>
        {{ actions: ..., default: ..., footer: ... }}
      </MxPanel>
    )
  }}
</MxSplitLayout>
```

| 属性 / 插槽 | 说明 |
|---|---|
| `asideType` | `'panel'`（默认）：侧栏 320，放目录树、筛选条件；`'menu'`：侧栏 200，放页面内菜单。页面不写任意宽度 |
| `asideLabel` | 必填，侧栏的名称。显示在窄屏的打开按钮上，也是抽屉的无障碍名称、关闭按钮的 `aria-label`（"关闭文件目录"） |
| `aside` | 侧栏内容，一般是一个 `MxPanel` |
| `default` | 主区内容，纵向排列，面板之间 `--space-lg` |

布局占满父元素（`height: 100%`），四周和两栏之间都是 `--space-lg`；页面本身不滚动，面板在内部滚动。前提是父元素有确定的高度：`AppLayout` 的内容区是占满剩余高度的 flex 子项，满足这个条件，业务页面直接把布局放在页面根部即可（3.3 做第一个真实页面时验证）。

### 窄屏

视口窄于 1200（`COMPACT_MEDIA_QUERY`）时：

- 侧栏隐藏，侧栏内容移进 `ElDrawer`，从左侧滑出，宽度与侧栏档位相同，按 Element 的默认行为盖住整个窗口；点遮罩、按 Esc 关闭
- 主区里加了 `asideToggle` 的面板显示打开按钮；侧栏的面板在抽屉里显示关闭按钮
- 回到宽屏时，如果抽屉开着就关闭，内容移回侧栏

### 读取布局状态：useSplitLayout

```ts
const { compact, asideOpen, asideLabel, openAside, closeAside } = useSplitLayout();
```

布局里的任何组件都可以调用，例如目录树在窄屏下选中一项后关闭抽屉（是否关闭由页面决定：导航类关闭，筛选类保持打开）：

```ts
const { compact, closeAside } = useSplitLayout();
const select = (node: Directory) => {
  emit('select', node);
  if (compact.value) {
    closeAside();
  }
};
```

在布局外调用会抛出错误。`compact`、`asideOpen` 是只读的 `ComputedRef`，改变状态只能通过 `openAside`、`closeAside`。`MxPanel` 不用这个函数，而是直接 `inject` 并给出默认值 `null`，所以在布局外也能使用。

### 侧栏内容只移动、不重建

侧栏内容外面套了一层 `Teleport`：宽屏时 `disabled`，内容原地渲染在侧栏里；窄屏且抽屉渲染过之后，内容被移到抽屉里的目标元素中。Teleport 切换目标时只移动 DOM，不销毁组件实例，所以树的展开节点、表单的输入、组件内部的状态都会保留。抽屉第一次打开前不渲染内容区，这时内容先留在隐藏的侧栏里，打开后再移过去。

动手前做过实验（3.2c），结果：

| 检查项 | 结果 |
|---|---|
| 来回移动后组件是否重新挂载 | 没有，挂载次数一直是 1；计数、树的展开节点都保留 |
| 抽屉第一次打开时内容是否跟得上 | 点"打开"后的下一个宏任务里，内容已经在抽屉里 |
| 滚动位置 | 丢失。单独用原生 DOM 验证：节点被移动到别的父元素下，`scrollTop` 归零；`display: none` 期间读到 0，但重新显示后恢复原值 |

### 滚动位置的保存与恢复

因为移动 DOM 会把滚动位置清零，布局自己负责保存和恢复，页面不用管：

- **记**：内容即将被隐藏或移动之前（`watch` 的 `flush: 'pre'`，此时 DOM 还没更新），记下侧栏内容里所有滚动过的元素的位置。必须在隐藏之前记，隐藏后读到的都是 0
- **写回**：内容在新位置显示出来时。用 `useResizeObserver` 监听侧栏内容：元素从 `display: none`（尺寸 0×0）变为显示，或移到尺寸不同的容器里，ResizeObserver 会在布局之后、绘制之前回调，这时写回，看不到跳动。另外在本组件更新后（`flush: 'post'`）再检查一次，覆盖移到尺寸相同的容器、ResizeObserver 不触发的情况

为什么不只在本组件更新后写回：最初就是这样写的，浏览器实测"宽屏滚动后切到窄屏、第一次打开抽屉"时滚动位置仍是 0。加日志发现，本组件更新后内容已经移进抽屉，但抽屉自己的显示比这次更新晚，此时内容还没显示，写不回去；改在 `ElDrawer` 的 `open` 事件里写回也不行，它比 Teleport 移动内容还早。与其猜各种事件的先后顺序，不如直接监听"内容显示出来"这件事本身。

已在浏览器中实测（主题预览页的分栏布局示例）：

| 操作 | 期望 | 实测 |
|---|---|---|
| 宽屏滚到 120，切到窄屏，第一次打开抽屉 | 120 | 120 |
| 抽屉里滚到 260，关闭再打开（内容没有移动） | 260 | 260 |
| 抽屉开着滚到 300，切到宽屏（移回侧栏） | 300，抽屉关闭 | 300，抽屉关闭 |
| 抽屉渲染过后切到窄屏（内容立即移进隐藏的抽屉），再打开 | 300 | 300 |

jsdom 没有布局（`getClientRects()` 总是空的、没有 ResizeObserver），所以这部分只有记录与写回两个函数有单元测试，时机靠上面的浏览器实测保证。

### 抽屉的内边距

Element 抽屉的内容区默认有 20px 内边距，侧栏的面板要占满抽屉，所以布局在自己的抽屉上设置了 `--el-drawer-padding-primary: 0`（`MxSplitLayout.module.scss` 的 `.drawer`）。这是 AGENTS.md"Element 的外观只在 `element-theme.scss` 中调整"的例外：它只作用于布局内部使用的这一个抽屉，是布局结构的一部分，不改变 Element 在其他地方的外观；放在 app 的 `element-theme.scss` 里，`libs/ui` 就要依赖 app 定义的全局 class。

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
| `MxSection` | `--space-md`、`--space-lg`（另外通过 `MxTitle` 用到它的变量） |
| `MxPanel` | `--color-bg-container`、`--color-primary-bg`、`--color-divider`、`--shadow-sm`、`--radius-md`、`--radius-sm`、`--space-lg`、`--space-sm` |
| `MxSplitLayout` | `--space-lg`；另外把 Element 抽屉的 `--el-drawer-padding-primary` 设为 0（见上文"抽屉的内边距"） |

新增或修改组件样式时同步更新本表。变量名写错不会报错（CSS 变量没有类型检查），要在预览页里确认。
