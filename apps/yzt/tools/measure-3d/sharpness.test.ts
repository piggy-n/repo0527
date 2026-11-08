// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blurEvents, compareSharpness, type Pixels, sharpnessGrid, type SharpnessGrid } from './sharpness.ts';

const WIDTH = 320;
const HEIGHT = 180;

// 可重复的伪随机纹理：格子大小 grain 像素，grain 越大越"糊"（高频越少）
function texture(grain: number, { gain = 1, offset = 40, seed = 1 } = {}, width = WIDTH, height = HEIGHT): Pixels {
  const noise = (x: number, y: number) => {
    const value = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return value - Math.floor(value);
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const luminance = (offset + 120 * noise(Math.floor(x / grain), Math.floor(y / grain))) * gain;
      const i = (y * width + x) * 4;
      data[i] = luminance;
      data[i + 1] = luminance;
      data[i + 2] = luminance;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

// 把左半边换成 blurred 的内容
function halfBlurred(sharp: Pixels, blurred: Pixels): Pixels {
  const data = Uint8ClampedArray.from(sharp.data);
  for (let y = 0; y < sharp.height; y++) {
    for (let x = 0; x < sharp.width / 2; x++) {
      for (let c = 0; c < 4; c++) {
        data[(y * sharp.width + x) * 4 + c] = blurred.data[(y * sharp.width + x) * 4 + c] ?? 0;
      }
    }
  }
  return { ...sharp, data };
}

// 像素级的锯齿：清晰的图上每隔一个像素交替明暗，缩小一半后就没有了
function aliased(sharp: Pixels): Pixels {
  const data = Uint8ClampedArray.from(sharp.data);
  for (let y = 0; y < sharp.height; y++) {
    for (let x = 0; x < sharp.width; x++) {
      if ((x + y) % 2 === 0) {
        for (let c = 0; c < 3; c++) {
          const i = (y * sharp.width + x) * 4 + c;
          data[i] = (data[i] ?? 0) + 12;
        }
      }
    }
  }
  return { ...sharp, data };
}

const flat = (width = WIDTH, height = HEIGHT): Pixels => ({
  data: new Uint8ClampedArray(width * height * 4).fill(128),
  width,
  height
});

describe('sharpnessGrid', () => {
  it('糊的图比清晰的低', () => {
    const sharp = sharpnessGrid(texture(1));
    const blurred = sharpnessGrid(texture(8));
    const comparison = compareSharpness(blurred, sharp);
    expect(comparison.medianRatio).toBeLessThan(0.6);
    expect(comparison.cells).toBe(16 * 9);
  });

  it('亮度整体乘一个数（两个引擎的光照不同）不影响', () => {
    const base = sharpnessGrid(texture(1));
    const dimmer = sharpnessGrid(texture(1, { gain: 0.5 }));
    const comparison = compareSharpness(dimmer, base);
    expect(comparison.medianRatio).toBeGreaterThan(0.9);
    expect(comparison.medianRatio).toBeLessThan(1.1);
  });

  it('像素级的锯齿不算清晰：没开多重采样不能抵消真的糊', () => {
    const smooth = texture(2);
    const comparison = compareSharpness(sharpnessGrid(aliased(smooth)), sharpnessGrid(smooth));
    expect(comparison.medianRatio).toBeGreaterThan(0.95);
    expect(comparison.medianRatio).toBeLessThan(1.05);
  });

  it('太平的格子不比', () => {
    const grid = sharpnessGrid(flat());
    expect(grid.values.every(value => value === null)).toBe(true);
    expect(compareSharpness(grid, sharpnessGrid(texture(1))).cells).toBe(0);
  });
});

describe('compareSharpness', () => {
  it('只糊半边时，中位数和最差 10% 不一样：能看出局部的糊', () => {
    const sharp = texture(1);
    const comparison = compareSharpness(sharpnessGrid(halfBlurred(sharp, texture(8))), sharpnessGrid(sharp));
    expect(comparison.worstDecileRatio).toBeLessThan(0.6);
    // 右半边一样清晰
    const rightColumn = comparison.ratios[15];
    expect(rightColumn).toBeCloseTo(1, 5);
    const leftColumn = comparison.ratios[0];
    expect(leftColumn).toBeLessThan(0.6);
  });

  it('mask 掉的格子不比', () => {
    const a = sharpnessGrid(texture(1));
    const mask = a.values.map((_, index) => index % 2 === 0);
    const comparison = compareSharpness(a, a, mask);
    expect(comparison.cells).toBe(Math.ceil(a.values.length / 2));
    expect(comparison.ratios[1]).toBeNull();
    expect(comparison.ratios[0]).toBe(1);
  });

  it('格子数不同时报错', () => {
    expect(() => compareSharpness(sharpnessGrid(texture(1), 8, 8), sharpnessGrid(texture(1)))).toThrow('格子数');
  });
});

const grid = (...values: (number | null)[]): SharpnessGrid => ({ cols: values.length, rows: 1, values });
const oneOfMany = (value: number) => grid(value, ...Array.from({ length: 99 }, () => 1));

describe('blurEvents', () => {
  it('越来越清晰（正常的加载）不算', () => {
    expect(blurEvents([grid(0.3, 0.3), grid(0.5, 0.4), grid(0.8, 0.8)])).toEqual([]);
  });

  it('掉下去持续两张才算一次，掉下去以后不重复算', () => {
    const events = blurEvents([grid(1, 1), grid(1, 0.5), grid(1, 0.5), grid(1, 0.5), grid(1, 0.5)]);
    expect(events).toEqual([{ index: 2, share: 0.5 }]);
  });

  it('只抖一张不算', () => {
    expect(blurEvents([grid(1), grid(0.5), grid(1), grid(0.5), grid(1)])).toEqual([]);
  });

  it('来回循环时每次都算（JKQ2 的加载后被删掉）', () => {
    const series = [1, 0.5, 0.5, 1, 1, 0.5, 0.5].map(value => grid(value));
    expect(blurEvents(series).map(event => event.index)).toEqual([2, 6]);
  });

  it('太小的一块不算：肉眼看不出来', () => {
    expect(blurEvents([oneOfMany(1), oneOfMany(0.5), oneOfMany(0.5)])).toEqual([]);
  });

  it('空序列', () => {
    expect(blurEvents([])).toEqual([]);
  });
});
