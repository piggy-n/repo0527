import type { Pixels } from '../sharpness.ts';

/** 解码一张 base64 的截图 */
export async function decodeShot(base64: string, type = 'image/png'): Promise<Pixels & { readonly data: Uint8ClampedArray }> {
  const blob = await (await fetch(`data:${type};base64,${base64}`)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('拿不到 2D 上下文');
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/** 画面几乎只有一种颜色：亮度的标准差很小，或者颜色种类很少 */
export function blankPixels({ data }: { readonly data: ArrayLike<number> }): boolean {
  const pixels = data.length / 4;
  let sum = 0;
  let squares = 0;
  const bins = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luminance;
    squares += luminance * luminance;
    const bin = (r >> 5) | ((g >> 5) << 3) | ((b >> 5) << 6);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const mean = sum / pixels;
  const deviation = Math.sqrt(Math.max(0, squares / pixels - mean * mean));
  const colors = [...bins.values()].filter(count => count > pixels * 0.001).length;
  return deviation < 4 || colors <= 2;
}
