---
paths:
  - "apps/yzt/src/features/city-dashboard/**"
  - "apps/yzt/src/pages/city-dashboard/**"
  - "apps/yzt/src/shared/city-indicators/**"
---

# 城市体检驾驶舱

- 城市体检驾驶舱纳入阶段六，含自身的 Three.js 立体行政区地图；三维阶段（ADR 0078）只指现状底图的三维（ADR 0147 起是 MapLibre + Three.js）。先确认交互预览再分步实施，固定指标（`shared/city-indicators` 的 `indicatorValue`：32 项来自 2026 年监测成果简报、其余模拟，ADR 0130）与真实业务数据验收分开；入场按局部可见时长编排，不修改 GSAP 全局 ticker；图片保存复用 `shared/file-transfer`，缺少部署字体时沿用后备字体并保留卸载取消。范围、性能条件与基线见 `docs/modules/city-dashboard.md`
- 入场由 GSAP 在主线程逐帧写样式，主线程或光栅卡一下标题和面板就一起停：入场中途不做几十毫秒的事（中途才显示的大图先解码，图表先预热），被缩放、位移的层入场期间加 `will-change`，循环的装饰动画只变换 HTML 盒子或外层 `<svg>`（SVG 内部元素的变换不能合成，会每帧重绘）；原因和实测见模块文档的"入场卡顿"
