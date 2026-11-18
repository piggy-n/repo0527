// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GPU_MEMORY_ROWS, gpuMemory, normalizeModel, rendererModel } from './gpu-memory';

describe('rendererModel', () => {
  it.each([
    [
      'Windows 的 D3D11，带设备号',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002487) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'NVIDIA GeForce RTX 3060'
    ],
    [
      '不带设备号',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'NVIDIA GeForce RTX 3060 Laptop GPU'
    ],
    [
      'D3D9',
      'ANGLE (Intel, Intel(R) HD Graphics Direct3D9Ex vs_3_0 ps_3_0, igdumd64.dll)',
      'Intel(R) HD Graphics'
    ],
    [
      '名字里带括号',
      'ANGLE (NVIDIA, NVIDIA TITAN X (Pascal) (0x00001B00) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'NVIDIA TITAN X (Pascal)'
    ],
    [
      'Vulkan',
      'ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA GeForce RTX 4090 (0x00002684)), NVIDIA-555.85.0.0)',
      'NVIDIA GeForce RTX 4090'
    ],
    [
      'Linux 的 OpenGL',
      'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.54.03)',
      'NVIDIA GeForce RTX 3060'
    ],
    [
      'macOS 的 Metal',
      'ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500M, Unspecified Version)',
      'AMD Radeon Pro 5500M'
    ],
    ['不经 ANGLE', 'NVIDIA GeForce RTX 3060/PCIe/SSE2', 'NVIDIA GeForce RTX 3060']
  ])('%s', (_, renderer, model) => {
    expect(rendererModel(renderer)).toBe(model);
  });

  it.each([
    ['读不到', ''],
    ['Firefox 换成的代表型号', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar'],
    ['Firefox 把集成的 Arc 也换成 A750', 'ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0), or similar'],
    ['Firefox 认不出的', 'Generic Renderer'],
    ['Firefox 防指纹', 'Mozilla'],
    ['拿不到调试扩展时的 RENDERER（Chromium、Safari）', 'WebKit WebGL'],
    ['Safari', 'Apple GPU']
  ])('浏览器不给真实型号：%s', (_, renderer) => {
    expect(rendererModel(renderer)).toBeNull();
  });
});

describe('gpuMemory', () => {
  it.each([
    ['NVIDIA GeForce RTX 3060', 8, 'NVIDIA GeForce RTX 3060 Laptop GPU', 6],
    ['NVIDIA GeForce RTX 4080', 16, 'NVIDIA GeForce RTX 4080 Laptop GPU', 12],
    ['NVIDIA GeForce RTX 5070 Ti', 16, 'NVIDIA GeForce RTX 5070 Ti Laptop GPU', 12],
    ['NVIDIA RTX A4000', 16, 'NVIDIA RTX A4000 Laptop GPU', 8],
    ['NVIDIA RTX A1000', 8, 'NVIDIA RTX A1000 Laptop GPU', 4],
    ['NVIDIA RTX 4000 Ada Generation', 20, 'NVIDIA RTX 4000 Ada Generation Laptop GPU', 12],
    ['NVIDIA RTX 2000 Ada Generation', 16, 'NVIDIA RTX 2000 Ada Generation Laptop GPU', 8],
    ['NVIDIA RTX PRO 2000 Blackwell', 16, 'NVIDIA RTX PRO 2000 Blackwell Generation Laptop GPU', 8],
    ['AMD Radeon RX 6800', 16, 'AMD Radeon RX 6800M', 12]
  ])('台式和笔记本分开：%s %i GB，%s %i GB', (desktop, desktopGB, laptop, laptopGB) => {
    expect(gpuMemory(desktop)).toBe(desktopGB);
    expect(gpuMemory(laptop)).toBe(laptopGB);
  });

  it.each([
    // 一个名字几张卡：Quadro RTX 4000、RTX 4000 Ada Generation、RTX PRO 4000 Blackwell
    'NVIDIA RTX 4000',
    'NVIDIA RTX 5000',
    'NVIDIA RTX 6000',
    'NVIDIA RTX 2000 Ada Generation Embedded GPU',
    'NVIDIA RTX A4000H',
    'NVIDIA GeForce RTX 3050 OEM',
    'NVIDIA GeForce GTX 980'
  ])('整个名字查，不按前缀，没列的查不到：%s', model => {
    expect(gpuMemory(model)).toBeUndefined();
  });

  it.each([
    ['NVIDIA GeForce RTX 3060 Ti', 8],
    ['NVIDIA GeForce RTX 4090 D', 24],
    ['NVIDIA GeForce RTX 5090 D v2', 24],
    ['NVIDIA Quadro RTX 5000', 16],
    ['NVIDIA RTX 5000 Ada Generation', 32],
    ['NVIDIA RTX PRO 4000 Blackwell', 24]
  ])('型号完全一样才算：%s %i GB', (model, gigabytes) => {
    expect(gpuMemory(model)).toBe(gigabytes);
  });

  it.each([
    ['NVIDIA GeForce RTX 5060 Ti', 8],
    ['NVIDIA GeForce RTX 4060 Ti', 8],
    ['NVIDIA GeForce RTX 3080', 10],
    ['NVIDIA GeForce RTX 3060', 8],
    ['NVIDIA GeForce RTX 2060', 6],
    ['NVIDIA GeForce RTX 3080 Laptop GPU', 8],
    ['NVIDIA GeForce RTX 5070 Laptop GPU', 8],
    ['NVIDIA GeForce RTX 3050 Laptop GPU', 4],
    ['NVIDIA GeForce GTX 1060', 3],
    ['AMD Radeon RX 9060 XT', 8],
    ['AMD Radeon RX 6500 XT', 4],
    ['Intel(R) Arc(TM) A770 Graphics', 8]
  ])('同名有几种显存的按最小的：%s %i GB', (model, gigabytes) => {
    expect(gpuMemory(model)).toBe(gigabytes);
  });

  it.each([
    ['NVIDIA GeForce GTX 1060 6GB', 6],
    ['NVIDIA GeForce GTX 1060 3GB', 3],
    ['NVIDIA GeForce RTX 3050 6GB Laptop GPU', 6],
    ['NVIDIA RTX A2000 12GB', 12],
    ['NVIDIA RTX A3000 12GB Laptop GPU', 12],
    ['NVIDIA T1000 8GB', 8],
    ['NVIDIA RTX PRO 5000 72GB Blackwell', 72],
    ['NVIDIA A100-SXM4-40GB', 40],
    ['AMD Radeon PRO W7800 48GB', 48]
  ])('名字里写了显存的按名字：%s %i GB', (model, gigabytes) => {
    expect(gpuMemory(model)).toBe(gigabytes);
  });

  it('2048SP 是流处理器数，不是显存', () => {
    expect(gpuMemory('AMD Radeon RX 580 2048SP')).toBe(4);
  });

  it.each([
    ['商标写法', 'AMD Radeon(TM) RX 6600', 8],
    ['老驱动不带厂商、带 Series', 'Radeon RX 580 Series', 4],
    ['老驱动带 (TM) 和 Graphics', 'Radeon (TM) RX 480 Graphics', 4],
    ['Max-Q', 'NVIDIA Quadro RTX 5000 with Max-Q Design', 16],
    ['图灵笔记本的 Super', 'NVIDIA GeForce RTX 2080 Super with Max-Q Design', 8],
    ['Ti 前面不带空格', 'NVIDIA GeForce RTX 3050Ti Laptop GPU', 4],
    ['大小写、多余的空格', 'NVIDIA  GeForce RTX 4070 ti super', 16]
  ])('名字的写法不同：%s', (_, model, gigabytes) => {
    expect(gpuMemory(model)).toBe(gigabytes);
  });

  it('表里没有重名（按比较用的写法）', () => {
    const names = GPU_MEMORY_ROWS.map(([name]) => normalizeModel(name));
    expect(new Set(names).size).toBe(names.length);
    for (const [, gigabytes] of GPU_MEMORY_ROWS) {
      expect(gigabytes).toBeGreaterThan(0);
    }
  });
});
