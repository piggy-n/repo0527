# 主题落地：设计令牌与 Element Plus 映射

对应文件：`apps/web/src/app/styles/`
规范原文：[color-and-typography.md](color-and-typography.md)

规范是**参考**而不是硬性要求（2026-09-29 确认）：色值、字号、阴影优先取自规范；规范和 Element 的交互风格冲突时（例如悬停方向），优先和 Element 保持一致。

## 分层

```
规范令牌   --color-*、--font-*、--line-height-*、--shadow-*    tokens.scss
   ↓ 映射
Element    --el-color-*、--el-text-color-* ……                  element-theme.scss
   ↓
页面与组件  只写 var(--color-*) 等令牌
```

| 文件 | 内容 |
|---|---|
| `tokens.scss` | 规范中的全部令牌，输出到 `:root` |
| `element-theme.scss` | 把令牌映射到 Element 的 CSS 变量 |
| `base.scss` | `body`、滚动条等全局基础样式 |
| `index.scss` | 入口，按上面的顺序加载 |

`main.ts` 中必须先 import `element-plus/dist/index.css`，再 import `./styles/index.scss`。两边都在 `:root` 上定义变量，优先级相同，后加载的生效。

### 为什么用 CSS 变量作为约定

- 页面、`@yzt/ui` 等 libs 组件只写 `var(--color-primary)`，不需要 import app 的 SCSS，不破坏依赖方向
- 主题值只在 `tokens.scss` 定义一次，Element 的变量也引用它，改一处全局生效

色板用 Sass map 维护，是因为 Element 的部分色阶需要在编译时用 `color.mix` 计算，而 CSS 变量在编译时拿不到值。Sass map 在输出 `--color-*` 的同时供 `element-theme.scss` 读取，所以色值仍然只写一次。

## 令牌清单

规范第 7 节列出的 CSS 变量全部保留，名字不变。第 1～6 节表格里有、第 7 节漏掉的，按第 7 节的命名方式补上：

| 规范中的令牌 | CSS 变量 | 来源 |
|---|---|---|
| `primary-bg-lighter` | `--color-primary-bg-lighter` | 第 1 节 |
| 透明度梯度 0.05～0.32 | `--color-primary-alpha-5/10/12/14/28/32` | 第 1 节，数字是百分比 |
| `border-dashed` | `--color-border-dashed` | 第 2 节 |
| `bg-neutral` | 即 `--color-neutral-bg`（第 7 节已有，同一个值） | 第 2 节 |
| `bg-neutral-light` | `--color-neutral-bg-light` | 第 2、3 节 |
| `bg-mask` | `--color-bg-mask` | 第 2 节 |
| Info 不透明浅底 | `--color-info-bg-solid` | 第 3 节 |
| Success 深色文本 / 实心 / 不透明浅底 / 悬停底 | `--color-success-text`、`-solid`、`-bg-solid`、`-bg-hover` | 第 3 节 |
| Danger 深色文本 / 不透明浅底 | `--color-danger-text`、`--color-danger-bg-solid` | 第 3 节 |
| 极小文字 10px | `--font-size-xxs` | 第 5.2 节 |
| 行高 22 / 18 / 16px | `--line-height-base`、`-compact`、`-tag` | 第 5.2 节 |

未收录：第 4 节备注中的 `#4F73FF`，它和 `primary-hover`（`#4F74F0`）只差一位，看起来是旧实现里的笔误，需要时再确认。

## Element Plus 映射

### 颜色色阶

Element 的每种类型（primary、success、warning、danger、error、info）有 7 个变量：基础色、`light-3/5/7/8/9`、`dark-2`。Element 的算法是 `light-N` 混入 N×10% 的白色，`dark-2` 混入 20% 的黑色（见 `element-plus/theme-chalk/src/common/var.scss`）。

规则：**静态的浅底色、描边有规范值就用规范值；悬停、按下等交互态沿用 Element 的公式。**

| 类型 | 基础色 | 用规范值的档位 | 说明 |
|---|---|---|---|
| primary | `primary` | `light-7` → `primary-border-hover`；`light-9` → `primary-bg` | 见下文"按用途对应" |
| success | `success` | `light-9` → `success-bg-solid` | |
| warning | `warning` | `light-9` → `warning-bg` | |
| danger、error | `danger` | `light-9` → `danger-bg-solid` | Element 把表单校验、`ElMessage.error` 归到 error，与 danger 同色 |
| info | `neutral` | `light-9` → `neutral-bg-light` | 见下文"info 的语义" |

另外输出 `--el-color-<type>-rgb`（例如 `89, 126, 247`），Element 部分组件用它拼 `rgba()`。

`light-9` 的规范值和公式值很接近（primary 的公式值是 `#EEF2FE`，规范是 `#EEF3FF`），直接替换不会破坏色阶。

### 按用途对应：light-3、light-7、dark-2

在 Element 2.14.6 的 `dist/index.css` 中逐条统计了这几个变量的用法（2026-09-29，已验证）：

| 变量 | 用处 | 映射 |
|---|---|---|
| `light-3` | 主按钮悬停的背景与边框、文字按钮和链接的悬停文字、深色标签悬停、分割面板拖动中的高亮 | 公式值 `#8BA5F9` |
| `dark-2` | 主按钮、文字按钮、虚线按钮的按下态 | 公式值 `#4765C6` |
| `light-7` | 默认按钮悬停边框、选中的可选标签悬停底色、选中的复选按钮左边线 | `primary-border-hover`（`#9FB3FF`） |

这几个变量实际上是 Element 的"悬停色""按下色"和"悬停描边"，只是名字按色阶来起。

**悬停和按下沿用 Element**：规范写的是悬停、按下都加深为 `primary-hover`。第一版按规范把 `light-3`、`dark-2` 都映射成了 `primary-hover`，预览后决定（2026-09-29）改回 Element 的"悬停变浅、按下加深"，和 Element 其他类型、其他组件的交互风格统一。`--color-primary-hover` 令牌仍然保留，用于规范中的"蓝色状态文字"等场景。旧项目资源管理页当时局部覆盖的 `light-3` 是 `#7D99F9`，也是变浅的。

**`light-7` 改用规范值**：它是默认按钮的悬停描边。本项目的常态描边 `--el-border-color` 已经是浅蓝色的 `primary-border`（`#C9D4FB`），而 `light-7` 的公式值 `#CDD8FD` 和它几乎一样，悬停时边框就看不出变化。改用 `primary-border-hover` 后，和输入框的悬停描边一致。这里最初是按色值接近映射到 `primary-border` 的，统计用法后才发现问题：映射要看变量在哪里被使用，不能只看色值是否接近。

代价：`light-7` 比 `light-5`（`#ACBFFB`）还深，色阶不再单调。升级 Element 时要重新统计这几个变量的用法。

### info 的语义

规范的 Info 是蓝色，表示进行中；Element 的 `info` 是灰色，`ElTag type="info"`、`ElMessage.info`、`ElAlert type="info"` 都用它。决定（2026-09-29）：Element 的 info 对应规范的 **Neutral**（`#8A94A6`），保留 Element 原有的灰色语义。需要蓝色的"进行中"时直接用 primary，它和规范的 Info 同源。

### 文本、边框、背景

| Element 变量 | 令牌 | 理由 |
|---|---|---|
| `--el-text-color-primary` | `text-strong` | Element 用于对话框标题、标签页等标题类文字 |
| `--el-text-color-regular` | `text-primary` | Element 的表格、输入框、下拉项正文用 regular，对应规范的"正文" |
| `--el-text-color-secondary` | `text-secondary` | |
| `--el-text-color-placeholder` | `text-placeholder` | |
| `--el-text-color-disabled` | `text-disabled` | |
| `--el-border-color` | `primary-border` | 规范：输入框、未选中的分段按钮用 `primary-border` |
| `--el-border-color-hover` | `primary-border-hover` | 输入框悬停描边 |
| `--el-border-color-light` | `border` | 卡片、列表项描边 |
| `--el-border-color-lighter` | `border-light` | 表格行分隔线 |
| `--el-bg-color`、`--el-bg-color-overlay` | `bg-container` | |
| `--el-bg-color-page` | `bg-page` | |

注意命名错位：规范的 `text-primary` 是正文，对应的是 Element 的 `regular`，不是 Element 的 `primary`。映射按用途对应，不按名字对应。

### 字体、字号、阴影

| Element 变量 | 令牌 | 理由 |
|---|---|---|
| `--el-font-family` | `font-family-base` | |
| `--el-font-size-medium` / `-base` | `font-size-lg` / `font-size-base` | 值与默认相同，引用令牌是为了保持单一来源 |
| `--el-font-size-small` | `font-size-xs`（12px） | Element 默认 13px，字号只用双数 |
| `--el-font-size-extra-small` | `font-size-xs` | |
| `--el-box-shadow-light` | `shadow-md` | Element 用于下拉、弹出框等浮层 |
| `--el-box-shadow-lighter` | `shadow-sm` | |

`--el-font-size-large`（18px）、`--el-font-size-extra-large`（20px）是双数，保持默认；`--el-box-shadow`、`--el-box-shadow-dark`（对话框、抽屉）规范没有对应项，保持默认。

### 组件级变量

Element 把组件自己的变量定义在组件选择器上（例如 `.el-table { --el-table-header-text-color: ... }`），在 `:root` 上覆盖不会生效，要写在同一个选择器上。两边优先级相同，我们的样式后加载，所以生效。

| 组件 | Element 变量 | 令牌 | 理由 |
|---|---|---|---|
| `ElTable` | `--el-table-header-text-color` | `text-title`（`#1F2937`） | Element 默认用 secondary 灰色；旧项目资源管理列表的表头是 `#1F2937`（2026-09-29 确认） |

## 使用规则

- 颜色、字号、字重、行高、阴影一律使用令牌，不在页面和组件里写死色值或字号
- 字号只用双数
- Element 的外观只在 `element-theme.scss` 中统一调整，页面不单独覆盖 `--el-*` 变量；某个组件需要全局微调时，也写在 `element-theme.scss` 里
- 规范里没有的颜色，先和设计确认、补进规范和 `tokens.scss`，再使用

CSS 目前没有 lint 检查，以上规则靠评审保证。需要强制检查时可以引入 stylelint（不依赖 TS 的 JS API，与现有工具链不冲突）。

## 暂未处理

| 事项 | 说明 |
|---|---|
| 字体 | 已接入，见 [fonts.md](fonts.md)。规范第 7 节的 `--font-family-title` 已删除，系统名称改用 SVG 轮廓 |
| `--el-border-color` 的非表单用途 | 它除了输入框、选择器、按钮、复选框、单选框，还用于分隔线（`ElDivider`）、菜单边框、开关关闭态、卡片式标签页、上传组件，这些现在都会显示为 `primary-border`。规范的分隔线是 `divider` 色虚线，这些组件第一次使用时在 `element-theme.scss` 中单独处理 |
| Element 写死的 13px | `ElCollapse` 的标题与内容、`ElInputNumber` 的加减按钮，第一次使用时处理 |
| 表格的其他样式 | 旧项目资源管理列表（`views/resource-management-new/components/LayerTable.vue`）还改了：表头背景 `#EEF1F8`、16px 半粗、行高 52px；正文 `#4B5563`、首列 `#1F2937`、行高 56px；行悬停底色 `#F2F6FF`；边框 `#E8EBF2`。做第一个列表页时，决定哪些作为全局表格样式 |
| 其他组件级微调 | 对应组件第一次在页面中使用时处理 |
| 暗色模式 | 规范未定义，不处理 |

## 修改时的检查清单

- 规范有变化：先更新 [color-and-typography.md](color-and-typography.md)，再改 `tokens.scss` 和本文
- 新增令牌：沿用第 7 节的命名方式，并在本文"令牌清单"中登记
- 升级 Element Plus：重新统计 `light-3`、`light-7`、`dark-2` 的用法，确认 CSS 变量名没有变化，并检查新增的写死奇数字号
- 修改后打开主题预览页（开发服务器的 `/dev/theme`，只在开发环境注册），逐项检查色板、按钮、表单、标签、表格
