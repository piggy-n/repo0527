# 查询表单（shared/query-form）

对应目录：`apps/web/src/shared/query-form/`；样式在 `apps/web/src/app/styles/element-theme.scss` 的 `form-query` 变体。

列表页表格上方的查询条件。按是否换行分三种情况：条件和按钮都放得下一行时排成一行；条件放得下、按钮放不下时按钮另起一行；条件放不下时换行，标签统一宽度并两端对齐。视觉规则见 [design/page-layout.md](../design/page-layout.md) 的"筛选栏"。

## 用法

```tsx
import { QueryForm } from '@/shared/query-form/QueryForm';

<QueryForm labelChars={6}>
  {{
    default: () => [
      <ElFormItem label="文档名称">
        <ElInput … />
      </ElFormItem>,
      <ElFormItem label="业务类型标签">
        <ElSelect … />
      </ElFormItem>
    ],
    actions: () => [
      <ElButton type="primary" icon={Search} onClick={search}>查询</ElButton>,
      <ElButton icon={RefreshLeft} onClick={reset}>重置</ElButton>
    ],
    extra: () => <ElButton type="primary" icon={Upload}>上传文档</ElButton>
  }}
</QueryForm>
```

| 属性 / 插槽 | 说明 |
|---|---|
| `labelChars` | 必填，最长标签的字数。条件换行时，所有标签都取 `labelChars` em 加右侧内边距 12 的宽度 |
| `default` | 查询条件，每一项是一个 `ElFormItem`；控件一律宽 180 |
| `actions` | 查询、重置按钮：排成一行时紧跟在最后一个条件后面；另起一行时靠左 |
| `extra` | 可选，页面级操作（如上传）：排成一行时在最右端；另起一行时在按钮行的右端，右边与最右边的输入框对齐 |

- 不接收 `model`、`rules`：查询条件不做校验，各控件自己绑定值（见 `features/file-management/components/FileFilterBar.tsx`）
- 传给 `QueryForm` 的 `class`、`style` 加在 `ElForm` 上（例如页面设置与表格之间的间距）

## 实现

表单内部分成条件区（`form-query__fields`，从左到右排列、放不下就换行）和按钮行（`form-query__actions`，里面是 `form-query__buttons` 和 `form-query__extra`）。三种情况对应两个状态：

| 状态 | 条件 | 类名 | 标签 | 按钮行 |
|---|---|---|---|---|
| `inline` | 条件加按钮的宽度 ≤ 表单宽度 | `form-query--inline` | 按文字宽度 | 与条件区左右排列，占满剩下的宽度，extra 用 `margin-left: auto` 靠到最右端 |
| 都不是 | 条件放得下、按钮放不下 | 无 | 按文字宽度 | 在条件区下方，宽度到最后一个条件的右边缘 |
| `aligned` | 条件的宽度 > 表单宽度 | `form-query--aligned` | `labelWidth` 设为 `calc(<labelChars>em + 12px)`，样式里改成块级并 `text-align-last: justify` | 在条件区下方，宽度到最右边那个条件的右边缘 |

- **判断依据**：标签按文字宽度时各条件的总宽（加上条件之间的间距）。统一宽度后条件会变宽，用它来判断就会一直当成放不下，所以只在标签按文字宽度时量，统一宽度后沿用量到的值。按钮和 extra 的宽度不随状态变化，每次直接量
- **何时重新判断**：`ResizeObserver` 同时观察表单和每一个条件。表单宽度变化会触发；标签切换宽度、字体加载完成会让条件变宽变窄，而表单的宽高可能不变，所以还要观察条件
- **extra 右对齐到最右边的输入框**：最右边的输入框在哪取决于每行能放几个条件，CSS 拿不到，所以量出最右边那个条件的右边缘，设为按钮行的宽度；按钮行不影响条件的排列
- **两端对齐**：Element 的标签默认是 `inline-flex`，`text-align` 对它不起作用，所以统一宽度时改成块级。中文字形宽度都是 1em，按字数算出的宽度与最长标签正好相等，换字体也不变
- 只剩一列时，按钮行宽度不够放下所有按钮，就按内容排开（`min-width: max-content`），extra 与重置之间至少留 12

不采用的做法：

| 做法 | 问题 |
|---|---|
| Grid 让按钮行横跨所有列（`grid-column: 1 / -1`） | 宽屏时没放条件的空列也算在内，extra 会到最右端，而不是最右边输入框的右边 |
| CSS 容器查询判断是否换行 | 临界宽度取决于每个页面的条件个数和标签文字，只能手动量好写死；Element 用内联样式设置标签宽度，CSS 也切换不了 |
| 标签切换宽度后用 `watch` 在 DOM 更新后补量一次 | 只能处理标签切换；字体加载完成同样会改变条件宽度，观察条件本身能一并处理 |
| 用 `letter-spacing` 或 flex 撑开标签文字 | 要按字数计算间距，或把每个字拆成单独的元素 |
| 由 `QueryForm` 自动找出最长标签 | 要读插槽里各 `ElFormItem` 的属性，条件渲染、片段等情况下不可靠；由页面直接告诉字数更简单 |

已知的局限：字体在标签统一宽度期间才加载完成时，沿用的"按文字宽度时的总宽"是按回退字体量的，可能差几个像素；切回按文字宽度后会重新量。

## 测试

jsdom 没有布局，也没有 `ResizeObserver`。`QueryForm.test.tsx` 用替身按被观察的元素记下回调（表单、各条件、Element 自己的元素各有一个），给表单设定 `clientWidth`、给条件区和按钮设定 `getBoundingClientRect`（条件的位置随是否统一标签宽度变化），再手动触发表单或条件的回调。VueUse 在组件挂载后的那一轮更新里才开始观察，触发前要先 `flushPromises()`。
