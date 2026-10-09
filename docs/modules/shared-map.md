# 项目级的公共地图能力（shared/map）

> 状态：5A.3 加入地图状态的提示。底图、行政区边界、工具栏等公共能力在 5B 加入。分层见 ADR 0027：与框架无关的逻辑在 map-core，Vue 衔接在 map-vue（[map-vue.md](map-vue.md)），这里放要读项目配置、用 Element 和 `SvgIcon` 的公共地图能力。

阶段五的界面后置到 5D 专门设计（[roadmap.md](../roadmap.md)"阶段五"）。这里的组件都是联调用的界面：状态和文案由纯函数决定，组件只负责显示，5D 只换组件，纯函数保留。

## 结构

| 文件 | 内容 |
|---|---|
| `map-status.ts` | `describeMapStatus(viewState, failure)`：由视图状态和失败原因推导要显示的内容（纯函数） |
| `MapStatusNotice.tsx` | 加载中与失败的提示（联调用的界面） |

## 地图状态的提示（ADR 0030）

```tsx
// 放在地图区域里，父元素要能作为定位参照（position: relative）
<div class={styles.mapArea}>
  <MapCanvas />
  <MapStatusNotice />
</div>
```

| 视图状态 | 显示 | 说明 |
|---|---|---|
| `initializing` | 加载中 | 用 `useDelayedFlag` 延迟出现，很快加载完就不显示；不拦截地图上的操作 |
| `failed`，引擎失败，不支持 WebGL2 | "地图无法显示"，说明浏览器和硬件加速的要求，"重试" | 原因由适配器用 `instanceof GPUInitializationError` 判断 |
| `failed`，引擎失败，其他原因 | "地图无法显示"，可以重试，技术细节用小字 | 处于 `failed` 却没有原因时也按这一种处理 |
| `failed`，样式失败 | 上方的警告条："地图样式加载失败"，说明改动图层后会自动重新加载，技术细节用小字 | 不提供重试：样式出现新版本时自动恢复 |
| 其他（`idle`、`ready`、`paused`、`disposed`） | 不显示 | — |

- "重试"调用 `useMap().retry()`，由画布组件在同一个容器里重新创建视图，页面不用管理画布的 `key`
- 文案集中在 `describeMapStatus`，测试也在它上面；组件只测"点重试会重新创建地图"这一个关键交互
- 技术细节是 MapLibre 的原始信息（如 `layers[3].paint.line-width: number expected, string found`），给开发和运维看，普通用户看前面的说明即可

## 测试

| 文件 | 内容 | 环境 |
|---|---|---|
| `map-status.test.ts` | 各状态的显示内容、两种引擎失败、样式失败、没有原因、不是 Error 的原因 | Node |
| `MapStatusNotice.test.tsx` | 引擎失败时显示原因和"重试"，点击后重新创建地图，重试过程不抛错 | jsdom |
