# 通用组合式函数（shared/composables）

对应目录：`apps/web/src/shared/composables/`

多个功能都会用到、和业务无关的组合式函数。只属于某个业务域的放在 `features/<域>/composables/`。

## useDelayedFlag

延迟显示的开关，用于加载状态。

```ts
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';

const { submitting } = useLoginForm();
const showLoading = useDelayedFlag(submitting);            // 默认 delay 300、minDuration 400

<ElButton loading={showLoading.value}>登录</ElButton>
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `source` | — | 任何 `watch` 能接受的来源：ref、computed、getter |
| `delay` | 300 | 源变为 `true` 后持续超过这么久（毫秒）才显示 |
| `minDuration` | 400 | 一旦显示，至少保持这么久（毫秒），从第一次显示算起 |

返回只读的 ref。

### 为什么需要它

加载状态如果和请求同步切换，请求很快完成时（例如内网里 100ms 就返回的登录），按钮会在一瞬间变成加载样式再变回来，看起来是闪了一下、抖了一下。常见的做法是：

- 很快完成的操作不显示加载状态：用户感觉不到等待，也就不需要提示
- 显示了就至少保持一段时间：避免请求在 310ms 完成时，加载状态只出现 10ms

它只影响"显示"。防重复提交等逻辑仍然使用原来的状态（例如 `submitting`），开始提交时立即生效，不受延迟影响。

### 行为

| 情况 | 结果 |
|---|---|
| 源在 300ms 内变回 `false` | 一直不显示 |
| 源持续超过 300ms | 第 300ms 开始显示 |
| 显示后不到 400ms 源就结束 | 保持到显示满 400ms 再隐藏 |
| 显示已超过 400ms 后源结束 | 立即隐藏 |
| 保持期内源再次变为 `true` | 继续显示，不闪烁；最短时间仍从第一次显示算起 |
| 组件卸载（作用域销毁） | 清除定时器 |

### 测试

组合式函数不依赖组件时，可以在 `effectScope` 中直接运行：`scope.run(() => useDelayedFlag(source))`，`scope.stop()` 相当于组件卸载。时间用 `vi.useFakeTimers()` 控制。

已验证：7 个用例；逐个改坏 5 处（不延迟显示、不保持最短时间、再次开始时重新计时、卸载时不清定时器，以及登录表单直接用 `submitting` 控制加载样式），每处都有用例失败。"再次开始时重新计时"最初没有被发现，补充了"最短时间从第一次显示算起"的用例。

## useSortableList

列表的拖动排序（[ADR 0054](../adr/0054-sortable-drag-reorder.md)）。项目里只有这个文件导入 `sortablejs`。

```tsx
import { useSortableList } from '@/shared/composables/useSortableList';

const list = ref<HTMLElement>();
useSortableList(list, {
  handle: '[data-drag-handle="checked"]',   // 只有按住手柄才能拖
  draggable: '>[data-sortable-item]',       // 位置只按直接子元素里能拖的算
  disabled: () => searching.value,          // 可以随时变化
  onMove: (from, to) => owner.move(from, to)
});

<ul ref={list}>{items.map(item => <li key={item.id} data-sortable-item>…</li>)}</ul>
```

| 参数 | 说明 |
|---|---|
| `element` | 列表元素的 ref；元素换了就重建实例，作用域销毁时销毁 |
| `handle` | 拖动手柄的选择器 |
| `draggable` | 能拖动的子元素的选择器；嵌套列表要写成直接子元素（`>`），手柄也要按层级区分，否则外层的实例会接住内层的拖动 |
| `disabled` | 返回是否停用 |
| `onMove(from, to)` | 放下后的旧序号和新序号（只数能拖的子元素）；位置不变时不调用 |

### 和 Vue 配合

SortableJS 拖动时自己移动 DOM，Vue 不知道。放下后组合式函数先把元素放回原位，再调用 `onMove`：顺序只在拥有者里，Vue 按新的顺序重新渲染，DOM 和虚拟 DOM 保持一致。调用方不要在 `onMove` 里再动 DOM。

键盘排序不经过它：手柄上按上下方向键，由组件直接调用拥有者同样的操作（写法见 `features/resource-map/components/CheckedLayerList.tsx`）。

### 测试

jsdom 里没有真实的拖放，测试从 `SortableJS.get(element)` 取到实例，直接调用它的 `onEnd`，再检查 DOM 是否还原、`onMove` 收到的序号。实例在 `flush: 'post'` 的侦听里创建，挂载后要先 `await nextTick()`。真实的拖动在浏览器里验证（5D.2：目录树、"已勾选"各拖一次，行数和顺序正确、没有重复的行）。

已验证：4 个用例；逐个改坏（不还原 DOM、位置不变也调用、停用不随条件变化、卸载时不销毁），每处都有用例失败。
