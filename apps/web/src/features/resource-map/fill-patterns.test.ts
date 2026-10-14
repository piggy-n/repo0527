// @vitest-environment node
import type { StyleImage } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import {
  BLANK_PATTERN_IMAGE_ID,
  FILL_PATTERNS,
  type FillPattern,
  PATTERN_PIXEL_RATIO,
  PATTERN_SHAPES,
  patternImageId,
  patternImages,
  patternPreviewSvg
} from './fill-patterns';

const BANDS = [0, 1, 2] as const;

function imageAt(pattern: FillPattern, band: 0 | 1 | 2): StyleImage {
  const image = patternImages([pattern], false)[patternImageId(pattern, band)];
  if (!image) {
    throw new Error(`没有 ${pattern} 第 ${band} 档的图片`);
  }
  return image;
}

const alphaAt = (image: StyleImage, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3] ?? 0;

// 边缘以内（距离场 ≥ 0.75）的像素占比，就是画出来的部分
function coverage(image: StyleImage): number {
  let inside = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    inside += (image.data[index] ?? 0) >= 192 ? 1 : 0;
  }
  return inside / (image.width * image.height);
}

// 预览里的线段数（每段以 M 开头）和点数
const countOf = (svg: string) => ({
  segments: (svg.match(/M/g) ?? []).length,
  dots: (svg.match(/<circle/g) ?? []).length
});

describe('图例的花纹预览', () => {
  it('按同一份形状数据画：横线、竖线每格一条，斜线从图块外画进来，点阵每格一个；颜色就是纹理颜色', () => {
    const horizontal = patternPreviewSvg('horizontal', 'rgba(0, 0, 255, 0.5)');
    expect(horizontal.size).toBe(8);
    expect(horizontal.svg).toContain('stroke="rgba(0, 0, 255, 0.5)"');
    expect(horizontal.svg).toContain('M0 2H8M0 6H8');
    expect(countOf(patternPreviewSvg('cross', '#000').svg)).toStrictEqual({ segments: 4, dots: 0 });
    expect(countOf(patternPreviewSvg('xCross', '#000').svg)).toStrictEqual({ segments: 14, dots: 0 });
    expect(countOf(patternPreviewSvg('dot', '#000').svg)).toStrictEqual({ segments: 0, dots: 4 });
  });

  it('紧凑网格用 12 像素的图块，每个方向 4 条线', () => {
    const dense = patternPreviewSvg('dense', '#000');

    expect(dense.size).toBe(12);
    expect(countOf(dense.svg)).toStrictEqual({ segments: 8, dots: 0 });
  });
});

describe('花纹的图片', () => {
  it('ID 以 resources 分组为前缀、带图块边长；紧凑网格的疏档和中档是同一张', () => {
    expect(BANDS.map(band => patternImageId('diagonal', band))).toStrictEqual([
      'resources-pattern-diagonal-8',
      'resources-pattern-diagonal-16',
      'resources-pattern-diagonal-32'
    ]);
    expect(BANDS.map(band => patternImageId('dense', band))).toStrictEqual([
      'resources-pattern-dense-16',
      'resources-pattern-dense-16',
      'resources-pattern-dense-32'
    ]);
    expect(BLANK_PATTERN_IMAGE_ID.startsWith('resources-')).toBe(true);
  });

  it('同一个 ID 每次都是同一个对象（会话按引用比较）；按需带上透明图片', () => {
    const first = patternImages(['dot', 'cross'], true);
    const again = patternImages(['cross'], false);

    expect(Object.keys(first)).toHaveLength(7);
    expect(again[patternImageId('cross', 1)]).toBe(first[patternImageId('cross', 1)]);
    expect(again[BLANK_PATTERN_IMAGE_ID]).toBeUndefined();
    const blank = first[BLANK_PATTERN_IMAGE_ID];
    expect(blank?.sdf).toBe(true);
    expect(blank?.data.every(byte => byte === 0)).toBe(true);
  });

  it('都是 2 倍像素比的距离场图片，边长是图块的 2 倍，数据长度对得上', () => {
    for (const pattern of FILL_PATTERNS) {
      for (const band of BANDS) {
        const image = imageAt(pattern, band);
        expect([image.sdf, image.pixelRatio]).toStrictEqual([true, PATTERN_PIXEL_RATIO]);
        expect(image.width).toBe(image.height);
        expect(image.data.length).toBe(image.width * image.height * 4);
      }
    }
    expect(imageAt('dot', 2).width).toBe(64);
  });

  it('平移一个格距后不变：图块拼起来不断开（斜线跨过图块边缘也能接上）', () => {
    for (const pattern of FILL_PATTERNS) {
      for (const band of BANDS) {
        const image = imageAt(pattern, band);
        const step = image.width / PATTERN_SHAPES[pattern].divisions;
        const shifted = (x: number, y: number) => alphaAt(image, (x + step) % image.width, (y + step) % image.height);
        const mismatch = Array.from({ length: image.width * image.height }, (_, index) => index).find(index => {
          const [x, y] = [index % image.width, Math.floor(index / image.width)];
          return alphaAt(image, x, y) !== shifted(x, y);
        });
        expect(mismatch).toBeUndefined();
      }
    }
  });

  it('线上不透明、线间透明：水平线的中档，线在每格中间', () => {
    const image = imageAt('horizontal', 1);
    // 中档 16 像素、2 格：设备像素里每 16 行一条线，在第 8 行附近
    expect(alphaAt(image, 5, 7)).toBeGreaterThanOrEqual(192);
    expect(alphaAt(image, 5, 0)).toBe(0);
    expect(alphaAt(image, 5, 15)).toBe(0);
  });

  it('斜线和横线一样粗：线宽按垂直方向量；斜线的垂直线距是横线的 1/√2，画出来的部分约多 √2 倍', () => {
    for (const band of BANDS) {
      const ratio = coverage(imageAt('diagonal', band)) / coverage(imageAt('horizontal', band));
      expect(ratio).toBeGreaterThan(1.25);
      expect(ratio).toBeLessThan(1.65);
    }
  });

  it('画出来的部分占比合理：都看得出花纹，紧凑网格在疏档也不糊成实心', () => {
    const coverages = FILL_PATTERNS.flatMap(pattern => BANDS.map(band => coverage(imageAt(pattern, band))));

    expect(Math.min(...coverages)).toBeGreaterThan(0.01);
    // 最密的是 X 斜线的疏档，约 62%（两组斜线交叉，几何同旧项目）；紧凑网格的疏档用中档后约 44%
    expect(Math.max(...coverages)).toBeLessThan(0.7);
  });
});
