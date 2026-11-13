// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isIntegratedRenderer, SOFTWARE_RENDERER } from './renderer-class.ts';

// Windows 上 ANGLE 的写法：厂商、驱动里的设备名和设备号、Direct3D11
const angle = (vendor: string, device: string) => `ANGLE (${vendor}, ${device} (0x00001234) Direct3D11 vs_5_0 ps_5_0, D3D11)`;

describe('isIntegratedRenderer', () => {
  it.each([
    angle('Intel', 'Intel(R) UHD Graphics 620'),
    angle('Intel', 'Intel(R) HD Graphics 4600'),
    angle('Intel', 'Intel(R) Iris(R) Xe Graphics'),
    angle('Intel', 'Intel(R) Arc(TM) Graphics'),
    angle('Intel', 'Intel(R) Arc(TM) Pro Graphics'),
    angle('Intel', 'Intel(R) Arc(TM) 140V GPU (16GB)'),
    angle('Intel', 'Intel(R) Arc(TM) B390 GPU'),
    angle('Intel', 'Intel(R) Graphics'),
    angle('AMD', 'AMD Radeon(TM) Graphics'),
    angle('AMD', 'AMD Radeon(TM) 780M Graphics'),
    angle('AMD', 'AMD Radeon 890M Graphics'),
    angle('AMD', 'AMD Radeon(TM) 8060S Graphics'),
    angle('AMD', 'AMD Radeon(TM) Vega 8 Graphics'),
    angle('AMD', 'AMD Radeon(TM) R7 Graphics'),
    angle('Qualcomm', 'Qualcomm(R) Adreno(TM) X1-85 GPU'),
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'
  ])('集显：%s', renderer => {
    expect(isIntegratedRenderer(renderer)).toBe(true);
  });

  it.each([
    angle('NVIDIA', 'NVIDIA GeForce RTX 3060 Laptop GPU'),
    angle('Intel', 'Intel(R) Arc(TM) A770 Graphics'),
    angle('Intel', 'Intel(R) Arc(TM) A370M Graphics'),
    angle('Intel', 'Intel(R) Arc(TM) B580 Graphics'),
    angle('Intel', 'Intel(R) Arc(TM) Pro A60 Graphics'),
    angle('Intel', 'Intel(R) Iris(R) Xe MAX Graphics'),
    angle('AMD', 'AMD Radeon RX 6700 XT'),
    angle('AMD', 'AMD Radeon RX 7600M XT'),
    angle('AMD', 'Radeon RX Vega 56'),
    angle('AMD', 'AMD Radeon Pro 5500M'),
    'WebGL 2.0'
  ])('独显、读不到型号：%s', renderer => {
    expect(isIntegratedRenderer(renderer)).toBe(false);
  });

  it('软件渲染的名字', () => {
    expect(SOFTWARE_RENDERER.test('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(SOFTWARE_RENDERER.test(angle('Microsoft', 'Microsoft Basic Render Driver'))).toBe(true);
    expect(SOFTWARE_RENDERER.test(angle('NVIDIA', 'NVIDIA GeForce RTX 3060 Laptop GPU'))).toBe(false);
  });
});
