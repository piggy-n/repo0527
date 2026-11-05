---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.scss"
  - "packages/*/src/**/*.tsx"
  - "packages/*/src/**/*.scss"
  - "docs/design/**"
---

# 界面

## 流程与验证

- 新页面、较大的布局变化或新的交互形式先按设计规范提供可在浏览器操作的 HTML 原型或真实组件预览，确认后再开发；截图只作状态记录，不能代替交互设计稿。主题与组件库层面的改动在 `/dev/theme` 实际操作并截图确认
- UI 修改按 `docs/design/ui-workflow.md`：先对照规范、已验收组件与真实页面，修改后主动检查、修复，再交给用户验收；交付说明实际验证的尺寸、状态和未验证项，不能以构建通过代替 UI 验证
- 后续页面迁移参考 `/dev/theme` 和 `/dev/map-ui` 的真实组件样例，使用范围及复查路径见 `docs/design/current-map-reference.md`；样例不挂载地图引擎、不读取业务接口或持久化偏好，地图渲染与查询仍在业务页面验收
- 浅灰底主标题按 ADR 0076 复用 `MxPanel headerTone="muted"`，Element 弹窗用 `dialog-panel-header` + `MxTitle`；尺寸、留白和适用范围见 `docs/design/page-layout.md` 的"浅灰底面板标题栏"
- UI 验证允许必要的短时浏览器测试，优先复用用户已启动的服务；无合适服务或需要测试隔离时，允许自动退出并清理的临时测试 / 预览服务。不启动长期 `dev`、`start`、监听或后台常驻服务，不停止用户服务；生产冒烟仍遵守独立内网产物预览的约定。此项补充此前“只运行 build、不启动服务”的 UI 验证限制

## TSX

- TSX 中插槽函数的参数要手动标注类型：Vue 的 JSX 类型不会按组件的 `SlotsType` 推断插槽参数，也不检查插槽名（ADR 0003）
- TSX 中双向绑定写 `modelValue` + `onUpdate:modelValue`，不用 `v-model`：`v-model` 的值不做类型检查
- TSX 里同一个父元素下有几个按条件出现、可能同时变化的兄弟元素时，每个都给 `key`：TSX 没有模板编译器加的标记，Vue 把没有 key 的同类元素按顺序配对，里面的 `KeepAlive` 和有状态的组件会被重建（写法见 `pages/current-map/CurrentMapPage.tsx` 的浮层）
- 给组件传 `id` 等未声明的透传属性会报类型错误（组件只接受声明的 props 和 `class`、`style`），需要标记时用 `data-*`

## 加载状态与列表

- 加载状态用 `shared/composables` 的 `useDelayedFlag` 延迟显示，防重复提交的标志仍立即生效
- 列表的加载状态按 `docs/modules/table.md` 区分：没有数据时用 `shared/table` 的 `TableSkeleton`，显示着旧数据时用延迟遮罩，后台刷新当前条件的缓存不提示；遮罩不要直接跟着 `isFetching`；加载失败、没有数据可显示时用 `TableLoadError`（居中的说明和重试）
- 表格行内操作（如删除）的进行中状态按行 ID 记录，不用单个 mutation 的 `variables` / `isPending` 判断是哪一行；操作入口对同一行防重复
- 回车触发提交或查询时排除输入法选字：`event.key === 'Enter' && !event.isComposing`

## 确认框、取色器、拖动、虚拟列表

- 确认框（`ElMessageBox`）不随组件卸载关闭：组件卸载时关闭自己打开的确认框；用户确认后，先检查组件是否已销毁、会话是否还是打开确认框时的那一个，再执行操作（写法见 `features/file-management/composables/useFileRemoval.ts`）
- 同一时间只能打开一个 `ElMessageBox`：组件卸载时只能用 `ElMessageBox.close()` 关闭，它会关掉所有确认框，有多个时会把别处的一起关掉、对方按"取消"处理；需要多个弹框并存时，改用渲染在组件内的确认框（如基于 `ElDialog`），随组件卸载自然销毁
- `ElColorPicker` 拖动时的 `active-change` 只设临时预览，确认（`change`）才写入；它没有关闭事件，Esc、点外面时把颜色重置回 `modelValue` 并再发一次 `active-change`，所以由拥有者规定"预览等于确认过的值就是没有预览"，`modelValue` 绑确认过的值、不含预览；取色器随组件卸载时什么也不报，编辑器卸载、换了目标时丢弃自己目标的预览（ADR 0044，写法见 `features/resource-map/components/SymbolEditor.tsx`）
- 拖动排序用 `shared/composables` 的 `useSortableList`，不直接导入 `sortablejs`（测试模拟放下时除外）：放下后由它还原 DOM，顺序交给拥有者，Vue 按数据重新渲染；只能按住手柄拖，手柄同时支持上下方向键（ADR 0054）
- `useVirtualList` 这类把数据放进深层 `ref` 的工具，给出的行是响应式代理；交给按对象身份比较的拥有者（如点选的 `choose`）前按序号取原数组里的对象；同一个虚拟列表先后显示两轮结果时容器不重新挂载、滚动位置保留，新一轮按列表的身份显式回到顶部（写法见 `features/resource-map/components/FeatureDetailPanel.tsx`）

## 样式与设计规范

- 字体文件按授权不能提交到仓库（ADR 0012）；正文字体普惠体 3.0 只有 400、600 两个字重，改 `font-weight` 即可
- `apps/web/public/fonts/`：唯一的字体目录，不入库（ADR 0013），见 `docs/design/fonts.md`
- 业务图标用 `shared/icons/SvgIcon`（`name` 有类型检查），不直接写 `<img>` 或内联 SVG（按数据画的图形不是图标，如图例的符号预览，可以直接用 SVG）；新图标放进 `apps/web/src/assets/icons/`，由 `@yzt/icons` 自动规范化（改名、颜色改为 currentColor），多色图标文件名以 `-color` 结尾，见 `docs/modules/icons.md`；Element 组件的图标属性仍用 `@element-plus/icons-vue`
- AI 助手与用户的头像（机器人位图、"我"）用 `shared/chat-avatar` 的 `ChatAvatar`，不在页面里另放图片或画渐变圆球（ADR 0109，见 `docs/modules/chat-avatar.md`）
- 系统名称用 `shared/system-title` 的 `SystemTitle` 组件（SVG 轮廓，大小和颜色跟随 `font-size`、`color`），不要把优设标题黑作为网页字体加载；修改名称见 `docs/modules/system-title.md`
- 设计参考 `docs/design/color-and-typography.md`，落地方式见 `docs/design/theme.md`；规范和 Element Plus 的交互风格冲突时，优先和 Element 保持一致
- 颜色、字号、字重、行高、阴影、圆角一律使用令牌（`var(--color-*)`、`var(--radius-*)` 等 CSS 变量），不写死色值和字号（圆形、胶囊形写 `50%` / `999px`）；规范里没有的值先补进规范和 `packages/theme/src/tokens.scss`
- 间距在布局一级（页面边距、面板之间、面板内边距、区块之间）使用 `--space-*` 令牌；组件内部的细小间距可以写数值，不为它们增加令牌
- 字号只用双数
- 页面排布按 `docs/design/page-layout.md`：分栏型页面由 `packages/ui` 的布局、面板、区块、标题组件组成（ADR 0016）；页面不设背景，侧栏宽度只用固定档位，高度靠布局占满、面板内部滚动，不写 `calc(100% - 32px)` 这类计算
- 列表页的筛选栏用 `shared/query-form` 的 `QueryForm`（控件等宽；条件不换行时标签按文字宽度，换行时标签统一宽度并两端对齐；按钮放不下就另起一行），不用 `<label>` 包住控件；工具栏和筛选栏的按钮按 `page-layout.md` "操作按钮"的对照表配图标，表格行内的文字按钮不加图标
- 不给 `ElTree` 设置 `indent`：树的层级引导线按 Element 默认缩进 18 定位（见 `theme.md` 的"树的全局样式"）
- 表格的空值由全局样式显示 `-`（见 `theme.md` 的"表格的全局样式"），列上不再用 `formatter` 或插槽处理空值
- `packages/ui` 的组件只通过 CSS 变量使用令牌，不 import `@yzt/theme` 的 SCSS；不能引用 `SvgIcon`，自定义图标由使用方通过插槽传入
- Element Plus 的外观只在 `packages/theme/src/element-theme.scss` 统一调整，页面和组件不单独覆盖 `--el-*` 变量；需要另一种外观时在其中定义变体 class（如 `input-filled`、`button-xl`），页面只引用 class，见 `docs/design/theme.md`；唯一的例外是 `packages/ui` 分栏布局内部抽屉的内边距（见 `docs/modules/ui.md`）
