// @vitest-environment node
import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImage } from '@yzt/map-core/worker';
import { describe, expect, it } from 'vitest';
import { patternPixels, patternTransform } from './canvas-pattern';

const image = (alpha: readonly number[], sdf = true): StyleImage => ({
  width: alpha.length, height: 1, pixelRatio: 2, sdf,
  data: new Uint8Array(alpha.flatMap(value => [12, 34, 56, value]))
});
const phaseAt = (local: number, origin: number) => ((local + origin) % 1.3 + 1.3) % 1.3;

describe('Canvas 花纹像素', () => {
  it('普通图片保留自己的颜色与透明度，SDF 用颜色和距离边缘生成覆盖', () => {
    const rgba = image([20, 100, 255], false);
    expect(patternPixels(rgba, Color.red, 1)).toEqual(new Uint8ClampedArray(rgba.data));
    const red = new Color(1, 0, 0, 0.5, false);
    const pixels = patternPixels(image([0, 0, 255, 255, 255, 0]), red, 1);
    expect(pixels.slice(12, 16)).toEqual(new Uint8ClampedArray([255, 0, 0, 128]));
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBeLessThan(20);
    expect(patternPixels(image([191, 191, 191]), Color.red, 1)[3]).toBe(0);
    expect(patternPixels(image([192, 192, 192]), Color.red, 1)[3]).toBe(255);
  });

  it('像素比、非整数缩放与相邻瓦片使用同一世界相位', () => {
    const sample = { ...image([0, 255]), width: 2, height: 1 };
    const first = patternTransform(sample, 1.3, [512, 1024]);
    const second = patternTransform(sample, 1.3, [1024, 1024]);
    expect(first.a).toBe(0.65);
    expect(first.d).toBe(0.65);
    expect(phaseAt(512, 512)).toBeCloseTo(phaseAt(0, 1024));
    expect(first.e).toBeCloseTo(-phaseAt(0, 512));
    expect(second.e).toBeCloseTo(-phaseAt(0, 1024));
    expect(second.f).toBe(first.f);
  });

  it('透明占位图不会把距离场当普通 alpha 画出来，输入图片保持不变', () => {
    const blank = image([0, 0]);
    const before = [...blank.data];
    expect([...patternPixels(blank, Color.white, 0.5)].filter((_, index) => index % 4 === 3)).toEqual([0, 0]);
    expect([...blank.data]).toEqual(before);
    expect(() => patternPixels(blank, Color.red, 0)).toThrow('有限正数');
  });
});
