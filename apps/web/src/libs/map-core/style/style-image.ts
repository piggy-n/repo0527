/** 样式图片（ADR 0045 第 4 节）：RGBA 像素加元数据；数据不可变，变化时换新对象 */
export interface StyleImage {
  readonly width: number;
  readonly height: number;
  /** RGBA，每个像素 4 字节，按行排列 */
  readonly data: Uint8Array;
  /** 图片像素和 CSS 像素之比，默认 1 */
  readonly pixelRatio?: number;
  /** 距离场图片：只用透明度通道，颜色由图层的颜色属性给出；默认 false */
  readonly sdf?: boolean;
}

export type StyleImages = Readonly<Record<string, StyleImage>>;

/** 图片的格式：宽高、像素比、是否距离场；格式相同时才能只换像素 */
export function sameImageFormat(a: StyleImage, b: StyleImage): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    (a.pixelRatio ?? 1) === (b.pixelRatio ?? 1) &&
    (a.sdf ?? false) === (b.sdf ?? false)
  );
}

/** 宽高是正整数、数据长度对得上；不合法时抛错（拥有者的错误，和重复 ID 一样在提交时报出） */
export function assertStyleImage(id: string, image: StyleImage): void {
  const { width, height, data, pixelRatio = 1 } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`图片 "${id}" 的宽高不是正整数：${width} × ${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(`图片 "${id}" 的数据长度 ${data.length} 和宽高 ${width} × ${height} 对不上`);
  }
  if (!(pixelRatio > 0)) {
    throw new Error(`图片 "${id}" 的像素比不是正数：${pixelRatio}`);
  }
}
