// 显卡型号到显存（GB）的表：auto 按它定档（ADR 0166）。同名有几种显存的记最小的；台式和笔记本（Laptop GPU）、
// 带 M、S 后缀的是不同的卡，分开记；没确认的不列，按标准档。来源、没确认的型号、怎样补见 docs/config/scene-tier.md 的"显存表"

/** 一行：驱动里的设备名（去掉开头的厂商）、显存 GB */
type GpuRow = readonly [name: string, gigabytes: number];

// 名字里写了显存的（GTX 1060 6GB、RTX 3050 6GB Laptop GPU、RTX A2000 12GB、T1000 8GB、Radeon PRO W7800 48GB）不用列，
// 按名字里的算（gpuMemory）

const GEFORCE_DESKTOP: readonly GpuRow[] = [
  ['GeForce RTX 5090', 32],
  // 国内版：32 GB 没确认，按 D v2 的 24 记，都是工作站档
  ['GeForce RTX 5090 D', 24],
  ['GeForce RTX 5090 D v2', 24],
  ['GeForce RTX 5080', 16],
  ['GeForce RTX 5070 Ti', 16],
  ['GeForce RTX 5070', 12],
  // 8 GB、16 GB 同名、同设备号
  ['GeForce RTX 5060 Ti', 8],
  ['GeForce RTX 5060', 8],
  ['GeForce RTX 5050', 8],
  ['GeForce RTX 4090', 24],
  ['GeForce RTX 4090 D', 24],
  ['GeForce RTX 4080 SUPER', 16],
  ['GeForce RTX 4080', 16],
  ['GeForce RTX 4070 Ti SUPER', 16],
  ['GeForce RTX 4070 Ti', 12],
  ['GeForce RTX 4070 SUPER', 12],
  ['GeForce RTX 4070', 12],
  // 8 GB、16 GB 同名
  ['GeForce RTX 4060 Ti', 8],
  ['GeForce RTX 4060', 8],
  ['GeForce RTX 3090 Ti', 24],
  ['GeForce RTX 3090', 24],
  ['GeForce RTX 3080 Ti', 12],
  // 10 GB、12 GB 同名
  ['GeForce RTX 3080', 10],
  ['GeForce RTX 3070 Ti', 8],
  ['GeForce RTX 3070', 8],
  ['GeForce RTX 3060 Ti', 8],
  // 12 GB、8 GB 同名
  ['GeForce RTX 3060', 8],
  // 8 GB、6 GB 同名
  ['GeForce RTX 3050', 6],
  ['GeForce RTX 2080 Ti', 11],
  // 图灵的笔记本和台式同名（笔记本写 Super），显存相同或更小，档位不变
  ['GeForce RTX 2080 SUPER', 8],
  ['GeForce RTX 2080', 8],
  ['GeForce RTX 2070 SUPER', 8],
  ['GeForce RTX 2070', 8],
  ['GeForce RTX 2060 SUPER', 8],
  // 6 GB、12 GB 同名
  ['GeForce RTX 2060', 6],
  ['TITAN RTX', 24],
  ['GeForce GTX 1660 Ti', 6],
  ['GeForce GTX 1660 SUPER', 6],
  ['GeForce GTX 1660', 6],
  ['GeForce GTX 1650 SUPER', 4],
  ['GeForce GTX 1650 Ti', 4],
  ['GeForce GTX 1650', 4],
  ['GeForce GTX 1630', 4],
  ['GeForce GTX 1080 Ti', 11],
  ['GeForce GTX 1080', 8],
  ['GeForce GTX 1070 Ti', 8],
  ['GeForce GTX 1070', 8],
  // 笔记本的名字不带显存，3 GB、6 GB
  ['GeForce GTX 1060', 3],
  ['GeForce GTX 1050 Ti', 4],
  ['GeForce GTX 1050', 2],
  ['TITAN X (Pascal)', 12],
  ['TITAN Xp', 12],
  ['TITAN Xp COLLECTORS EDITION', 12],
  ['GeForce MX110', 2],
  ['GeForce MX130', 2],
  ['GeForce MX150', 2]
];

// 安培起名字带 Laptop GPU，和同号的台式不是一张卡
const GEFORCE_LAPTOP: readonly GpuRow[] = [
  ['GeForce RTX 5090 Laptop GPU', 24],
  ['GeForce RTX 5080 Laptop GPU', 16],
  ['GeForce RTX 5070 Ti Laptop GPU', 12],
  // 12 GB、8 GB 同名
  ['GeForce RTX 5070 Laptop GPU', 8],
  ['GeForce RTX 5060 Laptop GPU', 8],
  ['GeForce RTX 5050 Laptop GPU', 8],
  ['GeForce RTX 4090 Laptop GPU', 16],
  ['GeForce RTX 4080 Laptop GPU', 12],
  ['GeForce RTX 4070 Laptop GPU', 8],
  ['GeForce RTX 4060 Laptop GPU', 8],
  ['GeForce RTX 4050 Laptop GPU', 6],
  ['GeForce RTX 3080 Ti Laptop GPU', 16],
  // 8 GB、16 GB 同名、同设备号
  ['GeForce RTX 3080 Laptop GPU', 8],
  ['GeForce RTX 3070 Ti Laptop GPU', 8],
  ['GeForce RTX 3070 Laptop GPU', 8],
  ['GeForce RTX 3060 Laptop GPU', 6],
  ['GeForce RTX 3050 Ti Laptop GPU', 4],
  // 4 GB、6 GB 同名
  ['GeForce RTX 3050 Laptop GPU', 4],
  // 只有笔记本，名字不带 Laptop GPU
  ['GeForce RTX 2050', 4]
];

// 专业卡：图灵以前的 Quadro 笔记本和台式同名（可能带 with Max-Q Design），RTX A 起笔记本带 Laptop GPU
const NVIDIA_PROFESSIONAL: readonly GpuRow[] = [
  ['Quadro GV100', 32],
  ['Quadro GP100', 16],
  ['Quadro P6000', 24],
  // P5000、P4000、P3000 不列：笔记本同名，显存没确认
  ['Quadro P5200', 16],
  ['Quadro P4200', 8],
  ['Quadro P3200', 6],
  ['Quadro P2200', 5],
  // 台式 5 GB，笔记本 4 GB
  ['Quadro P2000', 4],
  ['Quadro P1000', 4],
  ['Quadro P620', 2],
  ['Quadro P600', 2],
  ['Quadro P520', 2],
  ['Quadro P500', 2],
  ['Quadro P400', 2],
  ['Quadro T2000', 4],
  ['Quadro T1000', 4],
  ['Quadro RTX 8000', 48],
  ['Quadro RTX 6000', 24],
  ['Quadro RTX 5000', 16],
  ['Quadro RTX 4000', 8],
  ['Quadro RTX 3000', 6],
  ['T1000', 4],
  ['T600', 4],
  ['T400', 2],
  ['T1200 Laptop GPU', 4],
  ['T600 Laptop GPU', 4],
  ['T550 Laptop GPU', 4],
  // 2 GB、4 GB 同名
  ['T500', 2],
  ['RTX A6000', 48],
  ['RTX A5500', 24],
  ['RTX A5000', 24],
  ['RTX A4500', 20],
  ['RTX A4000', 16],
  ['RTX A2000', 6],
  ['RTX A1000', 8],
  ['RTX A400', 4],
  ['RTX A5500 Laptop GPU', 16],
  ['RTX A5000 Laptop GPU', 16],
  ['RTX A4500 Laptop GPU', 16],
  ['RTX A4000 Laptop GPU', 8],
  ['RTX A3000 Laptop GPU', 6],
  ['RTX A2000 Laptop GPU', 4],
  ['RTX A1000 Laptop GPU', 4],
  ['RTX A500 Laptop GPU', 4],
  ['RTX 6000 Ada Generation', 48],
  ['RTX 5000 Ada Generation', 32],
  ['RTX 4500 Ada Generation', 24],
  ['RTX 4000 Ada Generation', 20],
  ['RTX 4000 SFF Ada Generation', 20],
  ['RTX 2000 Ada Generation', 16],
  ['RTX 5000 Ada Generation Laptop GPU', 16],
  ['RTX 4000 Ada Generation Laptop GPU', 12],
  ['RTX 3500 Ada Generation Laptop GPU', 12],
  ['RTX 3000 Ada Generation Laptop GPU', 8],
  ['RTX 2000 Ada Generation Laptop GPU', 8],
  ['RTX 1000 Ada Generation Laptop GPU', 6],
  ['RTX 500 Ada Generation Laptop GPU', 4],
  ['RTX PRO 6000 Blackwell Workstation Edition', 96],
  ['RTX PRO 6000 Blackwell Max-Q Workstation Edition', 96],
  ['RTX PRO 5500 Blackwell Workstation Edition', 84],
  // 48 GB；72 GB 的名字里写着
  ['RTX PRO 5000 Blackwell', 48],
  ['RTX PRO 4500 Blackwell', 32],
  ['RTX PRO 4000 Blackwell', 24],
  ['RTX PRO 4000 Blackwell SFF Edition', 24],
  ['RTX PRO 2000 Blackwell', 16],
  ['RTX PRO 5000 Blackwell Generation Laptop GPU', 24],
  ['RTX PRO 4000 Blackwell Generation Laptop GPU', 16],
  ['RTX PRO 3000 Blackwell Generation Laptop GPU', 12],
  ['RTX PRO 2000 Blackwell Generation Laptop GPU', 8],
  ['RTX PRO 1000 Blackwell Generation Laptop GPU', 8],
  ['RTX PRO 500 Blackwell Generation Laptop GPU', 6]
];

// AMD 的规格页写的是最大显存，有更小的板子的按小的记；RX 6800、6800M、6800S 是三张卡
const AMD_RADEON: readonly GpuRow[] = [
  ['Radeon RX 9070 XT', 16],
  ['Radeon RX 9070', 16],
  ['Radeon RX 9070 GRE', 12],
  // 8 GB、16 GB；驱动里的名字是不是相同没确认
  ['Radeon RX 9060 XT', 8],
  ['Radeon RX 9060', 8],
  ['Radeon RX 9050', 4],
  ['Radeon RX 7900 XTX', 24],
  ['Radeon RX 7900 XT', 20],
  ['Radeon RX 7900 GRE', 16],
  ['Radeon RX 7800 XT', 16],
  ['Radeon RX 7700 XT', 12],
  ['Radeon RX 7700', 16],
  ['Radeon RX 7600 XT', 16],
  ['Radeon RX 7600', 8],
  ['Radeon RX 7400', 8],
  ['Radeon RX 7900M', 16],
  ['Radeon RX 7800M', 12],
  ['Radeon RX 7700S', 8],
  ['Radeon RX 7600M XT', 8],
  ['Radeon RX 7600M', 8],
  ['Radeon RX 7600S', 8],
  ['Radeon RX 6950 XT', 16],
  ['Radeon RX 6900 XT', 16],
  ['Radeon RX 6800 XT', 16],
  ['Radeon RX 6800', 16],
  ['Radeon RX 6750 XT', 12],
  ['Radeon RX 6700 XT', 12],
  ['Radeon RX 6700', 10],
  ['Radeon RX 6650 XT', 8],
  ['Radeon RX 6600 XT', 8],
  ['Radeon RX 6600', 8],
  ['Radeon RX 6500 XT', 4],
  ['Radeon RX 6400', 4],
  ['Radeon RX 6850M XT', 12],
  ['Radeon RX 6800M', 12],
  ['Radeon RX 6800S', 8],
  ['Radeon RX 6700M', 10],
  ['Radeon RX 6700S', 8],
  ['Radeon RX 6650M XT', 8],
  ['Radeon RX 6650M', 8],
  ['Radeon RX 6600M', 8],
  ['Radeon RX 6600S', 4],
  ['Radeon RX 6550M', 4],
  ['Radeon RX 6550S', 4],
  ['Radeon RX 6500M', 4],
  ['Radeon RX 6450M', 4],
  ['Radeon RX 6300M', 2],
  ['Radeon 6600M and 6700M Series', 8],
  ['Radeon RX 5700 XT', 8],
  ['Radeon RX 5700', 8],
  ['Radeon RX 5600 XT', 6],
  ['Radeon RX 5600', 6],
  ['Radeon RX 5500 XT', 4],
  ['Radeon RX 5500', 4],
  ['Radeon RX 5300', 3],
  ['Radeon RX 5700M', 8],
  ['Radeon RX 5600M', 6],
  ['Radeon RX 5500M', 4],
  ['Radeon RX 5300M', 3],
  ['Radeon VII', 16],
  // 老驱动对 Vega 56、64 只报 Radeon RX Vega；集显的 RX Vega 11 Graphics 在这之前就分出去了
  ['Radeon RX Vega', 8],
  ['Radeon RX 590', 8],
  // 4 GB、8 GB 的板子都有；2048SP 是流处理器数，不是显存
  ['Radeon RX 580', 4],
  ['Radeon RX 580 2048SP', 4],
  ['Radeon RX 570', 4],
  ['Radeon RX 480', 4],
  ['Radeon RX 470', 4],
  ['Radeon AI PRO R9700', 32],
  ['Radeon AI PRO R9700S', 32],
  ['Radeon AI PRO R9600D', 32],
  ['Radeon PRO W7900', 48],
  ['Radeon PRO W7900 Dual Slot', 48],
  ['Radeon PRO W7800', 32],
  ['Radeon PRO W7700', 16],
  ['Radeon PRO W7600', 8],
  ['Radeon PRO W7500', 8],
  ['Radeon PRO W7400', 8],
  ['Radeon PRO W7500M', 8],
  ['Radeon PRO W6800', 32],
  ['Radeon PRO W6600', 8],
  ['Radeon PRO W6400', 4],
  ['Radeon PRO W6600M', 8],
  ['Radeon PRO W6500M', 4],
  ['Radeon PRO W6300M', 2],
  ['Radeon Pro W5700', 8],
  ['Radeon Pro W5500', 8],
  ['Radeon PRO W5500M', 4],
  ['Radeon Pro VII', 16],
  ['Radeon Pro WX 9100', 16],
  ['Radeon Pro WX 8200', 8],
  ['Radeon Pro WX 7100', 8],
  ['Radeon Pro WX 5100', 8],
  ['Radeon Pro WX 4100', 4],
  ['Radeon Pro WX 3200', 4],
  ['Radeon Pro WX 3100', 4],
  ['Radeon Pro WX 2100', 2],
  ['Radeon Vega Frontier Edition', 16],
  ['Radeon Pro SSG', 16]
];

// 独立的 Arc；不带型号的 Arc(TM) Graphics、140V 这类集成的在这之前就分出去了
const INTEL_ARC: readonly GpuRow[] = [
  // 8 GB、16 GB 同名
  ['Arc(TM) A770 Graphics', 8],
  ['Arc(TM) A750 Graphics', 8],
  ['Arc(TM) A580 Graphics', 8],
  ['Arc(TM) A380 Graphics', 6],
  ['Arc(TM) A310 Graphics', 4],
  ['Arc(TM) A770M Graphics', 16],
  ['Arc(TM) A730M Graphics', 12],
  ['Arc(TM) A570M Graphics', 8],
  ['Arc(TM) A550M Graphics', 8],
  // 4～8 GB
  ['Arc(TM) A530M Graphics', 4],
  ['Arc(TM) A370M Graphics', 4],
  ['Arc(TM) A350M Graphics', 4],
  ['Arc(TM) B580 Graphics', 12],
  ['Arc(TM) B570 Graphics', 10],
  ['Arc(TM) Pro B70 Graphics', 32],
  ['Arc(TM) Pro B65 Graphics', 32],
  ['Arc(TM) Pro B60 Graphics', 24],
  ['Arc(TM) Pro B50 Graphics', 16],
  ['Arc(TM) Pro A60 Graphics', 12],
  ['Arc(TM) Pro A50 Graphics', 6],
  ['Arc(TM) Pro A40 Graphics', 6],
  ['Arc(TM) Pro A60M Graphics', 8],
  ['Arc(TM) Pro A30M Graphics', 4]
];

/** 表里的全部行，按厂商和系列分组（测试检查没有重名） */
export const GPU_MEMORY_ROWS: readonly GpuRow[] = [
  ...GEFORCE_DESKTOP,
  ...GEFORCE_LAPTOP,
  ...NVIDIA_PROFESSIONAL,
  ...AMD_RADEON,
  ...INTEL_ARC
];

/** 比较用的型号：去掉 (TM)、(R)、开头的厂商、Max-Q 的后缀、末尾的 Graphics、Series，大小写和空白统一 */
export function normalizeModel(name: string): string {
  return name
    .replace(/\((tm|r)\)/gi, ' ')
    .replace(/(\d)ti\b/gi, '$1 Ti')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(nvidia|amd|intel) /i, '')
    .replace(/ with max-q design$/i, '')
    .replace(/ (graphics|series)$/i, '')
    .toLowerCase();
}

const TABLE: ReadonlyMap<string, number> = new Map(
  GPU_MEMORY_ROWS.map(([name, gigabytes]) => [normalizeModel(name), gigabytes])
);

// 浏览器不给真实型号：Firefox 换成代表型号（结尾是 ", or similar"）或 "Generic Renderer"，防指纹时是 "Mozilla"；
// 拿不到调试扩展时读到的 RENDERER 是 "WebKit WebGL"（Chromium、Safari），Safari 的真实名字也只给 "Apple GPU"
const SANITIZED = /, or similar$|^generic renderer$|^mozilla$|^webkit webgl$|^apple gpu$/i;

/**
 * 渲染器名字里的显卡：驱动里的设备名，去掉 ANGLE 的外壳、设备号和后端；浏览器不给真实型号时是 null。
 * Windows 上是 "ANGLE (厂商, 设备名 (0x设备号) Direct3D11 vs_5_0 ps_5_0, D3D11)"，ANGLE 去掉了每一段里的逗号，设备号可能没有
 */
export function rendererModel(renderer: string): string | null {
  const text = renderer.trim();
  if (text === '' || SANITIZED.test(text)) {
    return null;
  }
  const angle = /^ANGLE \([^,]*, ([^,]*)/.exec(text);
  const device = (angle?.[1] ?? text)
    .replace(/^ANGLE Metal Renderer: /, '')
    .replace(/^Vulkan [\d.]+ \((.*)\)$/, '$1')
    .replace(/ Direct3D.*$/, '')
    .replace(/ \(0x[0-9a-f]+\)/gi, '')
    .replace(/\/PCIe\/SSE2$/i, '')
    .trim();
  return device === '' ? null : device;
}

/** 显存（GB）：名字里写了的按名字，否则按型号整个名字查表（不按前缀）；表里没有时是 undefined */
export function gpuMemory(model: string): number | undefined {
  const named = /\b(\d+) ?GB\b/i.exec(model);
  return named ? Number(named[1]) : TABLE.get(normalizeModel(model));
}
