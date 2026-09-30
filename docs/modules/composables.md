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
