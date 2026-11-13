// 按 WebGL 报的渲染器名字分软件渲染、集显：测量工具用它提醒，ADR 0155 第 3 节的 auto 也按这个规则判断（实现时搬进 app 的档位模块，
// 工具改成导入它）。Windows 上 ANGLE 报的是"ANGLE (厂商, 驱动里的设备名 (0x设备号) Direct3D11 vs_5_0 ps_5_0, D3D11)"，
// 名单和名字的来源（哪些见过、哪些是推测）见 docs/config/scene-tier.md 的"集显的名字"

/** 软件渲染的标志；硬件名字里不会有这些 */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software adapter|gdi generic|mesa offscreen/i;

// 集显的名单：认不出的当独显（标准档）。判成标准不比原来差，判成低会让 Arc Pro 这类专业卡吃亏，新的集显要补进来。
// Intel：HD、UHD，Iris、Iris Xe / Plus / Pro（Iris Xe MAX 是独显，不在里面），不带型号的 Arc(TM) Graphics、Arc(TM) Pro Graphics，
// Arc 140V / 130V / 140T / 130T，Arc B390 / B370 这类集成的 Arc，不带系列名的 Intel(R) Graphics
const INTEL_INTEGRATED =
  /\bu?hd graphics|iris\(r\) ((xe|plus|pro) )?graphics|iris\(tm\) (pro )?graphics|arc\(tm\) (pro )?graphics|arc\(tm\) 1\d0[vt]\b|arc\(tm\) b3\d0\b|intel\(r\) graphics/i;
// AMD：不带型号的 Radeon(TM) Graphics，780M 这类三位数加 M，8060S 这类四位数加 S，Vega 8 Graphics、RX Vega 11 Graphics
// （Ryzen 2400G、3400G 等的集显；独立的 RX Vega 56、64 后面不带 Graphics），老的 R7 Graphics
const AMD_INTEGRATED = /radeon(\(tm\))? (graphics|\d{3}m\b|\d{4}s\b|(rx )?vega \d+ graphics|r[2-7] graphics)/i;
// 其他：高通 Adreno（Windows on ARM）、苹果 M 系列、ARM Mali
const OTHER_INTEGRATED = /adreno|apple m\d|mali/i;

/** 集显：在名单里的才算 */
export function isIntegratedRenderer(renderer: string): boolean {
  return INTEL_INTEGRATED.test(renderer) || AMD_INTEGRATED.test(renderer) || OTHER_INTEGRATED.test(renderer);
}
