// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bytesPerTexel, texture3dBytes } from './upload-bytes.ts';

const RED = 0x1903;
const RGBA = 0x1908;
const RGBA_INTEGER = 0x8d99;
const RG_INTEGER = 0x8228;
const UNSIGNED_BYTE = 0x1401;
const UNSIGNED_SHORT = 0x1403;
const UNSIGNED_INT = 0x1405;
const FLOAT = 0x1406;
const HALF_FLOAT = 0x140b;
const UNSIGNED_INT_10F_11F_11F_REV = 0x8c3b;

// texSubImage3D(target, level, x, y, z, width, height, depth, format, type, data)
const subImage = (width: number, height: number, depth: number, format: number, type: number, data: unknown) => [0, 0, 0, 0, 0, width, height, depth, format, type, data];
// texImage3D(target, level, internalformat, width, height, depth, border, format, type, data)
const image = (width: number, height: number, depth: number, format: number, type: number, data: unknown) => [0, 0, 0, width, height, depth, 0, format, type, data];
const SUB = [5, 8] as const;
const FULL = [3, 7] as const;

describe('bytesPerTexel', () => {
  it.each([
    [RGBA, UNSIGNED_BYTE, 4],
    [RED, FLOAT, 4],
    [RGBA, HALF_FLOAT, 8],
    [RGBA_INTEGER, UNSIGNED_INT, 16],
    [RG_INTEGER, UNSIGNED_SHORT, 4],
    [RGBA, FLOAT, 16]
  ])('格式 %#x、类型 %#x：%i 字节', (format, type, bytes) => {
    expect(bytesPerTexel(format, type)).toBe(bytes);
  });

  it('打包的类型整个像素算，不按分量乘', () => {
    expect(bytesPerTexel(0x1907, UNSIGNED_INT_10F_11F_11F_REV)).toBe(4);
  });

  it('不认识的组合是 0，不编一个数', () => {
    expect(bytesPerTexel(0x1234, UNSIGNED_BYTE)).toBe(0);
    expect(bytesPerTexel(RGBA, 0x1234)).toBe(0);
  });
});

describe('texture3dBytes', () => {
  const data = new Uint8Array(1);

  it('texSubImage3D：宽 × 高 × 深 × 每像素字节数', () => {
    expect(texture3dBytes(subImage(2048, 2048, 1, RGBA_INTEGER, UNSIGNED_INT, data), ...SUB)).toBe(2048 * 2048 * 16);
  });

  it('texImage3D 的参数位置不同', () => {
    expect(texture3dBytes(image(4, 8, 2, RGBA, UNSIGNED_BYTE, data), ...FULL)).toBe(4 * 8 * 2 * 4);
  });

  it('只分配（data 是 null）不算上传', () => {
    expect(texture3dBytes(image(2048, 2048, 64, RGBA, UNSIGNED_BYTE, null), ...FULL)).toBe(0);
  });

  it('从 PBO 取（data 是偏移）不重复算', () => {
    expect(texture3dBytes(subImage(4, 4, 1, RGBA, UNSIGNED_BYTE, 0), ...SUB)).toBe(0);
  });
});
