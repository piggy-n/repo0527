import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { StyleImage } from '@yzt/map-core/worker';

interface PatternEntry {
  readonly image: StyleImage;
  readonly color: string;
  readonly scale: number;
  readonly canvas: OffscreenCanvas;
  readonly bytes: number;
}

// 着色纹理只在一次瓦片绘制中复用，图片数量和字节数同时设上限
const MAX_PATTERNS = 64;
const MAX_BYTES = 4 * 1024 * 1024;

/** 从同一份样式图片生成 Canvas 纹理，不根据图片 ID 重新猜测花纹 */
export class CanvasPatternCache {
  readonly #entries: PatternEntry[] = [];
  #bytes = 0;

  image(image: StyleImage, color: Color, scale: number): OffscreenCanvas {
    const key = image.sdf ? color.toString() : '';
    const index = this.#entries.findIndex(entry => entry.image === image && entry.color === key && entry.scale === scale);
    if (index >= 0) {
      const [entry] = this.#entries.splice(index, 1);
      this.#entries.push(entry);
      return entry.canvas;
    }
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (!context) { throw new Error('无法创建三维花纹画布'); }
    context.putImageData(new ImageData(patternPixels(image, color, scale), image.width, image.height), 0, 0);
    const bytes = image.width * image.height * 4;
    if (bytes <= MAX_BYTES) {
      while (this.#entries.length >= MAX_PATTERNS || this.#bytes + bytes > MAX_BYTES) {
        const removed = this.#entries.shift();
        if (removed) { this.#bytes -= removed.bytes; }
      }
      this.#entries.push({ image, color: key, scale, canvas, bytes });
      this.#bytes += bytes;
    }
    return canvas;
  }
}

/** SDF 的透明度是距离，不可作为普通 RGBA 直接绘制；梯度随当前像素比例调整 */
export function patternPixels(image: StyleImage, color: Color, scale: number): Uint8ClampedArray<ArrayBuffer> {
  if (!Number.isFinite(scale) || scale <= 0) { throw new RangeError('花纹像素比例必须是有限正数'); }
  const pixels = new Uint8ClampedArray(image.data);
  if (!image.sdf) { return pixels; }
  const [red, green, blue, opacity] = color.rgb;
  const ratio = (image.pixelRatio ?? 1) / scale;
  const alpha = (x: number, y: number) => image.data[
    (((y + image.height) % image.height) * image.width + (x + image.width) % image.width) * 4 + 3
  ] / 255;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const distance = alpha(x, y);
      // MapLibre SDF 边缘为 0.75；用相邻距离差近似 shader 的屏幕导数
      const gradientX = Math.max(Math.abs(alpha(x + 1, y) - distance), Math.abs(distance - alpha(x - 1, y)));
      const gradientY = Math.max(Math.abs(alpha(x, y + 1) - distance), Math.abs(distance - alpha(x, y - 1)));
      const gamma = Math.max((gradientX + gradientY) * ratio / 2, 1 / 255 / 16);
      const amount = Math.min(1, Math.max(0, (distance - (0.75 - gamma)) / (2 * gamma)));
      const coverage = amount * amount * (3 - 2 * amount);
      pixels.set([red * 255, green * 255, blue * 255, coverage * opacity * 255], (y * image.width + x) * 4);
    }
  }
  return pixels;
}

/** 使用世界像素相位，保证相邻瓦片和局部面画布使用同一花纹原点 */
export function patternTransform(image: StyleImage, scale: number, origin: readonly [number, number]): DOMMatrix2DInit {
  const factor = scale / (image.pixelRatio ?? 1);
  const width = image.width * factor;
  const height = image.height * factor;
  return {
    a: factor, b: 0, c: 0, d: factor,
    e: -((origin[0] % width + width) % width),
    f: -((origin[1] % height + height) % height)
  };
}
