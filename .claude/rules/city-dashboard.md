---
paths:
  - "apps/yzt/src/features/city-dashboard/**"
  - "apps/yzt/src/pages/city-dashboard/**"
  - "apps/yzt/src/features/land-space-dashboard/**"
  - "apps/yzt/src/pages/land-space-dashboard/**"
  - "apps/yzt/src/shared/city-indicators/**"
  - "apps/yzt/src/shared/dashboard/**"
---

# 驾驶舱（城市体检、综合分析）

- 城市体检驾驶舱（`/city-dashboard`）和综合分析驾驶舱（`/land-space-analysis`）都适用本文件，共用 `shared/dashboard` 的 Three.js 立体行政区地图（ADR 0163）；三维阶段（ADR 0078）只指现状底图的三维（ADR 0147 起是 MapLibre + Three.js）。先确认交互预览再分步实施，城市体检的固定指标（`shared/city-indicators` 的 `indicatorValue`：32 项来自 2026 年监测成果简报、其余模拟，ADR 0130）与真实业务数据验收分开；入场按局部可见时长编排，不修改 GSAP 全局 ticker；图片保存复用 `shared/file-transfer`，缺少部署字体时沿用后备字体并保留卸载取消。范围、性能条件与基线见 `docs/modules/city-dashboard.md`、`land-space-dashboard.md`
- 驾驶舱大屏（含 `shared/dashboard`）沿用旧版的固定配色，样式直接写色值、不走全局颜色令牌，新样式取已有的色值（`docs/modules/dashboard.md` 的"边界"）
- 入场由 GSAP 在主线程逐帧写样式，主线程或光栅卡一下标题和面板就一起停：入场中途不做几十毫秒的事（中途才显示的大图先解码，图表先预热），被缩放、位移的层入场期间加 `will-change`，循环的装饰动画只变换 HTML 盒子或外层 `<svg>`（SVG 内部元素的变换不能合成，会每帧重绘）；原因和实测见模块文档的"入场卡顿"
