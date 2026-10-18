import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImage } from '@yzt/map-core/worker';
import { describe, expect, it } from 'vitest';
import { CanvasPatternCache } from './canvas-pattern';

function image(width = 1, height = 1): StyleImage {
  return { width, height, data: new Uint8Array(width * height * 4).fill(255) };
}

describe('Canvas 纹理工作集预算', () => {
  it('同一快照复用纹理，超过64张时逐出最久未用的纹理', () => {
    const cache = new CanvasPatternCache();
    const first = image();
    const pixels = cache.image(first, Color.red, 1);
    expect(cache.image(first, Color.white, 1)).toBe(pixels);
    for (let index = 0; index < 64; index++) { cache.image(image(), Color.red, 1); }
    expect(cache.image(first, Color.red, 1)).not.toBe(pixels);
    expect(first.data.byteLength).toBe(4);
  });

  it('不足64张但超过4MiB时也逐出，单张超限图片只绘制而不驻留', () => {
    const cache = new CanvasPatternCache();
    const full = image(1024, 1024);
    const pixels = cache.image(full, Color.red, 1);
    cache.image(image(), Color.red, 1);
    expect(cache.image(full, Color.red, 1)).not.toBe(pixels);
    const oversized = image(1025, 1024);
    const temporary = cache.image(oversized, Color.red, 1);
    expect(cache.image(oversized, Color.red, 1)).not.toBe(temporary);
  });
});
