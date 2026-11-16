// @vitest-environment node
import type { StyleImage } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import {
  markDistance,
  maxHaloWidth,
  POINT_SHAPE_NAMES,
  type PointShape,
  SHAPE_BASE_RADIUS,
  SHAPE_PIXEL_RATIO,
  shapeDistance,
  shapeImageId,
  shapeImages,
  shapeOffset,
  shapeSvgPath
} from './point-shapes';

function imageOf(shape: PointShape): StyleImage {
  const image = shapeImages([shape])[shapeImageId(shape)];
  if (!image) {
    throw new Error(`没有 ${shape} 的图片`);
  }
  return image;
}

// 图片像素 (x, y) 的距离场（0～1）
const fieldAt = (image: StyleImage, x: number, y: number) => (image.data[(y * image.width + x) * 4 + 3] ?? 0) / 255;

// 单位坐标的一点在图片里的像素
const pixelOf = (image: StyleImage, x: number) =>
  Math.floor(image.width / 2 + x * SHAPE_BASE_RADIUS * SHAPE_PIXEL_RATIO);

// 边缘以内（距离场 ≥ 0.75）的像素数，就是画出来的面积
function area(image: StyleImage): number {
  let inside = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    inside += (image.data[index] ?? 0) >= 192 ? 1 : 0;
  }
  return inside;
}

describe('点的形状', () => {
  it('8 种：圆、方形、三角形、菱形、五角星、六边形、十字、定位针', () => {
    expect(POINT_SHAPE_NAMES).toStrictEqual([
      'circle',
      'square',
      'triangle',
      'diamond',
      'star',
      'hexagon',
      'cross',
      'pin'
    ]);
  });

  it('距离在形状里为正、外面为负，多边形的顶点在边界上；定位针中间有孔', () => {
    expect(shapeDistance('circle', 0, 0)).toBe(1);
    expect(shapeDistance('circle', 2, 0)).toBe(-1);
    expect(shapeDistance('square', 0.86, 0.86)).toBeCloseTo(0, 6);
    expect(shapeDistance('diamond', 0, -1.15)).toBeCloseTo(0, 6);
    expect(shapeDistance('cross', 0.9, 0.9)).toBeLessThan(0);
    expect(shapeDistance('pin', 0, -0.4)).toBeLessThan(0);
    expect(shapeDistance('pin', 0, 1.2)).toBeCloseTo(0, 6);
    expect(shapeDistance('pin', 0, 0.5)).toBeGreaterThan(0);
  });

  it('SVG 路径和图片用同一份数据：路径的顶点就是距离为 0 的点', () => {
    expect(shapeSvgPath('square', 10, 10, 4)).toBe('M6.56 6.56L13.44 6.56L13.44 13.44L6.56 13.44Z');
    expect(shapeSvgPath('circle', 10, 10, 4)).toBe('M6 10a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z');
    // 定位针：针尖在中心下方 1.2 个半径，孔是第二段子路径
    const pin = shapeSvgPath('pin', 10, 10, 4);
    expect(pin.startsWith('M10 14.8L')).toBe(true);
    expect(pin.match(/M/g)).toHaveLength(2);
    expect(shapeSvgPath('star', 0, 0, 1).match(/L/g)).toHaveLength(9);
  });

  it('定位针的偏移让针尖落在要素的位置，其他形状不偏移', () => {
    expect(shapeOffset('pin')).toStrictEqual([0, -4.8]);
    expect(shapeOffset('triangle')).toStrictEqual([0, 0]);
  });
});

describe('形状的 SDF 图片', () => {
  it('ID 以 resources 分组为前缀；同一个 ID 每次都是同一个对象，重复的形状只给一张', () => {
    const first = shapeImages(['circle', 'pin', 'circle']);
    const again = shapeImages(['pin']);

    expect(Object.keys(first)).toStrictEqual(['resources-shape-circle', 'resources-shape-pin']);
    expect(again['resources-shape-pin']).toBe(first['resources-shape-pin']);
  });

  it('距离场图片：像素比 4，四周留出 6 + 1 个图片像素，图片边上的距离场是 0', () => {
    const image = imageOf('circle');

    expect(image).toMatchObject({ width: 95, height: 95, pixelRatio: 4, sdf: true });
    expect(image.data).toHaveLength(95 * 95 * 4);
    expect(fieldAt(image, 0, 47)).toBe(0);
    expect(fieldAt(image, 47, 94)).toBe(0);
  });

  it('边缘在 0.75，往外每个图片像素降 1/8：描边宽度的数值就是屏幕像素', () => {
    const image = imageOf('circle');
    const center = 47;
    // 半径 4 个图片像素，即 16 个设备像素；往外 2、6 个图片像素
    const at = (pixels: number) => fieldAt(image, center + Math.round(pixels * SHAPE_PIXEL_RATIO), center);

    expect(fieldAt(image, center, center)).toBe(1);
    expect(at(4)).toBeCloseTo(0.75, 1);
    expect(at(6)).toBeCloseTo(0.5, 1);
    expect(at(10)).toBeCloseTo(0, 1);
  });

  it('各形状看起来一样大：画出的面积和圆相差不到三成（五角星的尖角细、定位针有孔，面积小一些）；定位针的孔不画', () => {
    const circle = area(imageOf('circle'));
    const lower: Partial<Record<PointShape, number>> = { star: 0.55, pin: 0.65 };
    const outOfRange = POINT_SHAPE_NAMES.filter(shape => {
      const ratio = area(imageOf(shape)) / circle;
      return ratio <= (lower[shape] ?? 0.7) || ratio >= 1.3;
    });
    expect(outOfRange).toStrictEqual([]);
    const pin = imageOf('pin');
    expect(fieldAt(pin, pixelOf(pin, 0), pixelOf(pin, -0.4))).toBeLessThan(0.75);
    // 针尾在边缘以内
    expect(fieldAt(pin, pixelOf(pin, 0), pixelOf(pin, 0.8))).toBeGreaterThan(0.75);
  });
});

describe('点选的距离（ADR 0159）', () => {
  it('到画出的形状：按半径的圆加描边，在里面为 0，随 icon-size 缩放', () => {
    const circle = { shape: 'circle', iconSize: 1, strokeWidth: 1 } as const;

    expect(markDistance(circle, 3, 0)).toBe(0);
    expect(markDistance(circle, 10, 0)).toBe(5);
    expect(markDistance(circle, 0, -15)).toBe(10);
    expect(markDistance({ ...circle, iconSize: 2, strokeWidth: 0 }, 10, 0)).toBe(2);
    expect(markDistance({ ...circle, shape: 'star' }, 10, 0)).toBe(5);
  });

  it('定位针：针尖在要素的位置，针头在上面 1.6 个半径；取到针尖和到针头里近的一个', () => {
    const pin = { shape: 'pin', iconSize: 1, strokeWidth: 1 } as const;

    // 针头中心在要素上方 6.4 像素，半径 3.2 加描边 1
    expect(markDistance(pin, 0, -6.4)).toBe(0);
    expect(markDistance(pin, 5, -6.4)).toBeCloseTo(0.8, 6);
    expect(markDistance(pin, 0, -12)).toBeCloseTo(1.4, 6);
    // 针尖下面按到针尖算
    expect(markDistance(pin, 0, 5)).toBe(4);
    expect(markDistance({ ...pin, iconSize: 2 }, 0, -12.8)).toBe(0);
  });
});

describe('描边宽度的上限', () => {
  it('6 × icon-size − 0.84 − 0.25，不小于 0', () => {
    expect(maxHaloWidth(1)).toBeCloseTo(4.91, 6);
    expect(maxHaloWidth(0.5)).toBeCloseTo(1.91, 6);
    expect(maxHaloWidth(0.1)).toBe(0);
  });
});
