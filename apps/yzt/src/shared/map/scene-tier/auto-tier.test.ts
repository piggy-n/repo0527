// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autoTier } from './auto-tier';

// Windows 上 Chrome、Edge 经 ANGLE 报的写法：厂商、驱动里的设备名和设备号、Direct3D11
const angle = (vendor: string, device: string) =>
  `ANGLE (${vendor}, ${device} (0x00001234) Direct3D11 vs_5_0 ps_5_0, D3D11)`;
const nvidia = (device: string) => angle('NVIDIA', `NVIDIA ${device}`);

describe('autoTier', () => {
  it.each([
    ['现场的 Quadro RTX 5000（16 GB）', nvidia('Quadro RTX 5000'), 'workstation'],
    [
      '现场的 Quadro RTX 5000，不带设备号',
      'ANGLE (NVIDIA, NVIDIA Quadro RTX 5000 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'workstation'
    ],
    ['现场的 RTX 4090（24 GB）', nvidia('GeForce RTX 4090'), 'workstation'],
    ['用户测试的 RTX 3060 Laptop GPU（6 GB）', nvidia('GeForce RTX 3060 Laptop GPU'), 'standard']
  ])('现场和测试的机器：%s → %s', (_, renderer, tier) => {
    expect(autoTier(renderer).tier).toBe(tier);
  });

  it.each([
    ['GeForce 台式 RTX 4080（16）', nvidia('GeForce RTX 4080'), 'workstation'],
    ['GeForce 台式 RTX 4070（12）', nvidia('GeForce RTX 4070'), 'high'],
    ['GeForce 台式 RTX 3060（12 和 8 按 8）', nvidia('GeForce RTX 3060'), 'high'],
    ['GeForce 台式 RTX 3050（8 和 6 按 6）', nvidia('GeForce RTX 3050'), 'standard'],
    ['GeForce 台式 RTX 4060 Ti（8 和 16 按 8）', nvidia('GeForce RTX 4060 Ti'), 'high'],
    ['GeForce 台式 GTX 1080 Ti（11）', nvidia('GeForce GTX 1080 Ti'), 'high'],
    ['GeForce 台式 GTX 1650（4）', nvidia('GeForce GTX 1650'), 'standard'],
    ['GeForce 笔记本 RTX 4090 Laptop GPU（16）', nvidia('GeForce RTX 4090 Laptop GPU'), 'workstation'],
    ['GeForce 笔记本 RTX 4080 Laptop GPU（12）', nvidia('GeForce RTX 4080 Laptop GPU'), 'high'],
    ['GeForce 笔记本 RTX 3080 Laptop GPU（8 和 16 按 8）', nvidia('GeForce RTX 3080 Laptop GPU'), 'high'],
    ['图灵笔记本带 Max-Q', nvidia('GeForce RTX 2080 Super with Max-Q Design'), 'high'],
    ['Quadro RTX 5000 带 Max-Q', nvidia('Quadro RTX 5000 with Max-Q Design'), 'workstation'],
    ['Quadro RTX 4000（8）', nvidia('Quadro RTX 4000'), 'high'],
    ['RTX A4000（16）', nvidia('RTX A4000'), 'workstation'],
    ['RTX A4000 Laptop GPU（8）', nvidia('RTX A4000 Laptop GPU'), 'high'],
    ['RTX 2000 Ada Generation Laptop GPU（8）', nvidia('RTX 2000 Ada Generation Laptop GPU'), 'high'],
    ['T1000（4）', nvidia('T1000'), 'standard'],
    ['AMD RX 7900 XTX（24）', angle('AMD', 'AMD Radeon RX 7900 XTX'), 'workstation'],
    ['AMD RX 6700 XT（12）', angle('AMD', 'AMD Radeon RX 6700 XT'), 'high'],
    ['AMD RX 6600M（8）', angle('AMD', 'AMD Radeon RX 6600M'), 'high'],
    ['AMD RX 6600S（4）', angle('AMD', 'AMD Radeon RX 6600S'), 'standard'],
    ['AMD Radeon PRO W7600（8）', angle('AMD', 'AMD Radeon PRO W7600'), 'high'],
    ['AMD 老驱动的 RX 480（4 和 8 按 4）', angle('AMD', 'Radeon (TM) RX 480 Graphics'), 'standard'],
    ['Intel Arc A770（8 和 16 按 8）', angle('Intel', 'Intel(R) Arc(TM) A770 Graphics'), 'high'],
    ['Intel Arc A770M（16）', angle('Intel', 'Intel(R) Arc(TM) A770M Graphics'), 'workstation'],
    ['Intel Arc B580（12）', angle('Intel', 'Intel(R) Arc(TM) B580 Graphics'), 'high'],
    ['Intel Arc A380（6）', angle('Intel', 'Intel(R) Arc(TM) A380 Graphics'), 'standard'],
    ['Intel Arc Pro A60M（8）', angle('Intel', 'Intel(R) Arc(TM) Pro A60M Graphics'), 'high']
  ])('按显存定档：%s → %s', (_, renderer, tier) => {
    expect(autoTier(renderer).tier).toBe(tier);
  });

  it.each([
    ['刚好 8 GB 是高档', nvidia('T1000 8GB'), 'high'],
    ['8 GB 以下是标准档', nvidia('RTX A1000 6GB Laptop GPU'), 'standard'],
    ['12 GB 是高档', nvidia('RTX A2000 12GB'), 'high'],
    ['刚好 16 GB 是工作站档', angle('AMD', 'AMD Radeon PRO W7700'), 'workstation'],
    ['名字里写了 48 GB', angle('AMD', 'AMD Radeon PRO W7800 48GB'), 'workstation']
  ])('档位的分界：%s', (_, renderer, tier) => {
    expect(autoTier(renderer).tier).toBe(tier);
  });

  it.each([
    [
      '软件渲染',
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'software'
    ],
    ['Microsoft Basic Render Driver', angle('Microsoft', 'Microsoft Basic Render Driver'), 'software'],
    ['Intel 集显', angle('Intel', 'Intel(R) UHD Graphics 620'), 'integrated'],
    ['AMD 集显（带空格的写法）', angle('AMD', 'AMD Radeon (TM) Graphics'), 'integrated'],
    // 名字里的 16GB 是共享的内存：先认出集显，不按名字里的显存
    ['Lunar Lake 的 Arc 140V', angle('Intel', 'Intel(R) Arc(TM) 140V GPU (16GB)'), 'integrated'],
    // Firefox 把 Intel 的 HD、UHD、Iris 集显换成 HD Graphics（型号小于 1000 的报 HD Graphics 400），照样认得出
    [
      'Firefox 报的 Intel 集显（UHD 620）',
      'ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar',
      'integrated'
    ],
    [
      'Firefox 报的 Intel 集显（Iris Xe）',
      'ANGLE (Intel, Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0), or similar',
      'integrated'
    ],
    ['Firefox 报的高通集显', 'ANGLE (Qualcomm, Adreno (TM) 650 Direct3D11 vs_5_0 ps_5_0), or similar', 'integrated']
  ])('软件渲染、集显给低档：%s', (_, renderer, basis) => {
    expect(autoTier(renderer, 32)).toMatchObject({ tier: 'low', basis });
  });

  it.each([
    ['读不到', '', 'hidden'],
    ['Firefox 换成的代表型号', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', 'hidden'],
    // Firefox 把 Meteor Lake、Lunar Lake 的集显也报成 A750：A750 在表里是 8 GB，不能按它给高档
    [
      'Firefox 报的 Arc A750',
      'ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0), or similar',
      'hidden'
    ],
    ['Firefox 认不出的', 'Generic Renderer', 'hidden'],
    ['Firefox 防指纹', 'Mozilla', 'hidden'],
    // Firefox 把 AMD 的集显（"Radeon(TM) Graphics" 这类）换成 Radeon HD 3200，不在集显名单里
    ['Firefox 报的 AMD 集显', 'ANGLE (AMD, Radeon HD 3200 Graphics Direct3D11 vs_5_0 ps_5_0), or similar', 'hidden'],
    ['拿不到调试扩展时的 RENDERER', 'WebKit WebGL', 'hidden'],
    ['Safari', 'Apple GPU', 'hidden'],
    ['表里没有', nvidia('GeForce GTX 980'), 'unlisted'],
    ['只写了 RTX 5000，分不出是哪张', nvidia('RTX 5000'), 'unlisted']
  ])('读不到型号、表里没有的给标准档：%s', (_, renderer, basis) => {
    expect(autoTier(renderer)).toMatchObject({ tier: 'standard', basis });
  });

  it('给出依据：型号、显存；内存没压时 memoryCap 是 null', () => {
    expect(autoTier(nvidia('Quadro RTX 5000'))).toStrictEqual({
      tier: 'workstation',
      basis: 'listed',
      device: 'NVIDIA Quadro RTX 5000',
      vram: 16,
      memoryCap: null
    });
  });

  it.each([
    ['没有（Firefox、Safari、http 下）', undefined, 'workstation', null],
    ['32 GB', 32, 'workstation', null],
    ['8 GB：Chrome 147 以前最多报 8，不压', 8, 'workstation', null],
    ['16 GB：最多高档', 16, 'high', 16],
    ['4 GB：最多标准档', 4, 'standard', 4],
    ['2 GB', 2, 'standard', 2]
  ] as const)('内存（navigator.deviceMemory）%s：RTX 4090 → %s', (_, memory, tier, memoryCap) => {
    expect(autoTier(nvidia('GeForce RTX 4090'), memory)).toMatchObject({ tier, memoryCap });
  });

  it('内存只往下压：显存给的档位不高于内存允许的，不改，也不记', () => {
    expect(autoTier(nvidia('GeForce RTX 3060'), 16)).toMatchObject({ tier: 'high', memoryCap: null });
    expect(autoTier(nvidia('GeForce RTX 3060 Laptop GPU'), 4)).toMatchObject({ tier: 'standard', memoryCap: null });
    expect(autoTier(nvidia('GeForce RTX 3060'), 4)).toMatchObject({ tier: 'standard', memoryCap: 4 });
  });
});
