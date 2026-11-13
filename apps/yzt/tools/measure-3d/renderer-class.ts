// 按 WebGL 报的渲染器名字分软件渲染、集显：测量工具用它提醒，ADR 0155 第 3 节的 auto 也按这个规则判断（实现时搬进 app 的档位模块，
// 工具改成导入它）。Windows 上 ANGLE 报的是"ANGLE (厂商, 驱动里的设备名 (0x设备号) Direct3D11 vs_5_0 ps_5_0, D3D11)"，
// 设备名的来源和哪些写法还没在真机的浏览器里核对过，见 docs/config/scene-tier.md 的"集显的名字"

/** 软件渲染的标志；硬件名字里不会有这些 */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software adapter|gdi generic|mesa offscreen/i;

// 独立的 Intel 显卡：Arc A 系列（A310～A770、笔记本的 A370M 等）、B5xx 以上（B570、B580）、Arc Pro A 系列、Iris Xe MAX（DG1）。
// 其余 Intel 都是集显：HD、UHD、Iris，Arc(TM) Graphics（Meteor Lake 起）、Arc 140V / 130V（Lunar Lake）、
// B390 / B370 这类集成的 Arc、Intel(R) Graphics
const INTEL_DISCRETE = /arc\(tm\) (a\d{3}m?|b[5-9]\d{2}|pro a\d+)\b|iris\(r\) xe max/i;
// AMD 的集显：不带型号的 Radeon(TM) Graphics、780M 这类三位数加 M、8060S 这类四位数加 S、Vega 8 这类（RX Vega 是独显）、
// 老的 R7 Graphics。独显带 RX 或 Pro：Radeon RX 7600M XT、Radeon Pro 5500M
const AMD_INTEGRATED = /radeon(\(tm\))? (graphics|\d{3}m\b|\d{4}s\b|vega \d+ graphics|r[2-7] graphics)/i;
// 其他集显：高通 Adreno（Windows on ARM）、苹果 M 系列、ARM Mali
const OTHER_INTEGRATED = /adreno|apple m\d|mali/i;

/** 集显：名字里有 Intel 的除了独立的 Arc 都算，AMD 按型号，读不到型号的不算（当独显） */
export function isIntegratedRenderer(renderer: string): boolean {
  if (/intel/i.test(renderer)) {
    return !INTEL_DISCRETE.test(renderer);
  }
  return AMD_INTEGRATED.test(renderer) || OTHER_INTEGRATED.test(renderer);
}
