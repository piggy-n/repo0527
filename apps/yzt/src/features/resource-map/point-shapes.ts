import type { StyleImage, StyleImages } from '@mx/map-core';

// 点的形状（ADR 0159）：每种形状是单位坐标里的一份几何（中心在原点，y 向下，1 是符号的半径），
// 地图的 SDF 图片和图例的 SVG 路径都从它推出，图例和地图同源（同 fill-patterns.ts，ADR 0045 第 3 节）；
// 图片只和形状有关，懒生成，同一个 ID 始终是同一个对象。数值来自 2026-11-15 的样板和实测（local/design/legend-symbols-v1）

/** 8 种形状和编辑器里的名称；存进偏好的是键，以后只能增加，不能改名或删除（ADR 0159） */
export const POINT_SHAPES = {
  circle: '圆',
  square: '方形',
  triangle: '三角形',
  diamond: '菱形',
  star: '五角星',
  hexagon: '六边形',
  cross: '十字',
  pin: '定位针'
} as const;

export type PointShape = keyof typeof POINT_SHAPES;

export const POINT_SHAPE_NAMES = Object.keys(POINT_SHAPES) as [PointShape, ...PointShape[]];

type Vertex = readonly [x: number, y: number];

// 几何数据保留 4 位小数
const fixed = (value: number) => Number(value.toFixed(4));

// 正多边形或星形的顶点：从正上方开始顺时针，radii 轮流取，整体往下挪 shiftY（外接框居中）
function radial(count: number, radii: readonly number[], shiftY = 0): Vertex[] {
  const total = count * radii.length;
  return Array.from({ length: total }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
    const radius = radii[index % radii.length] ?? 0;
    return [fixed(radius * Math.cos(angle)), fixed(radius * Math.sin(angle) + shiftY)];
  });
}

// 大小按"看起来一样大"调过：方形、菱形、三角、星形的面积和圆接近
const HALF_SQUARE = 0.86;
const DIAMOND = 1.15;
const ARM = 0.36;

/** 定位针：针头的圆心、半径和孔，针尖在中心下方 tipY；针尖是锚点 */
const PIN = { cy: -0.4, r: 0.8, hole: 0.3, tipY: 1.2 } as const;

// 针尖到针头的两条切线的切点：圆心到针尖的距离 L，切点在圆心两侧，sin α = r / L
const PIN_TANGENT = (() => {
  const length = PIN.tipY - PIN.cy;
  const atCenter = Math.PI / 2 - Math.asin(PIN.r / length);
  return { x: fixed(PIN.r * Math.sin(atCenter)), y: fixed(PIN.cy + PIN.r * Math.cos(atCenter)) };
})();

const PIN_TAIL: readonly Vertex[] = [
  [-PIN_TANGENT.x, PIN_TANGENT.y],
  [PIN_TANGENT.x, PIN_TANGENT.y],
  [0, PIN.tipY]
];

const POLYGONS: Readonly<Record<Exclude<PointShape, 'circle' | 'pin'>, readonly Vertex[]>> = {
  square: [
    [-HALF_SQUARE, -HALF_SQUARE],
    [HALF_SQUARE, -HALF_SQUARE],
    [HALF_SQUARE, HALF_SQUARE],
    [-HALF_SQUARE, HALF_SQUARE]
  ],
  triangle: radial(3, [1.3], 0.325),
  diamond: [
    [0, -DIAMOND],
    [DIAMOND, 0],
    [0, DIAMOND],
    [-DIAMOND, 0]
  ],
  star: radial(5, [1.2, 0.5], 0.115),
  hexagon: radial(6, [1.05]),
  cross: [
    [-ARM, -1],
    [ARM, -1],
    [ARM, -ARM],
    [1, -ARM],
    [1, ARM],
    [ARM, ARM],
    [ARM, 1],
    [-ARM, 1],
    [-ARM, ARM],
    [-1, ARM],
    [-1, -ARM],
    [-ARM, -ARM]
  ]
};

/** 形状在单位坐标里离中心最远的距离：图片按它留出形状的位置 */
const EXTENT = 1.2;

function segmentDistance(x: number, y: number, [ax, ay]: Vertex, [bx, by]: Vertex): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// 多边形的有符号距离：里面为正
function polygonDistance(points: readonly Vertex[], x: number, y: number): number {
  let distance = Infinity;
  let inside = false;
  points.forEach((a, index) => {
    const b = points.at(index - 1) ?? a;
    distance = Math.min(distance, segmentDistance(x, y, a, b));
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
  });
  return inside ? distance : -distance;
}

/** 某点到形状边界的有符号距离（单位坐标，里面为正） */
export function shapeDistance(shape: PointShape, x: number, y: number): number {
  if (shape === 'circle') {
    return 1 - Math.hypot(x, y);
  }
  if (shape === 'pin') {
    // 针头和针尾的并集，再挖掉针头中间的孔
    const toCenter = Math.hypot(x, y - PIN.cy);
    return Math.min(Math.max(PIN.r - toCenter, polygonDistance(PIN_TAIL, x, y)), toCenter - PIN.hole);
  }
  return polygonDistance(POLYGONS[shape], x, y);
}

const round = (value: number) => Number(value.toFixed(2));

/** 图例用的 SVG 路径：中心 (cx, cy)、半径 r 像素；定位针的孔要用 evenodd 挖出 */
export function shapeSvgPath(shape: PointShape, cx: number, cy: number, r: number): string {
  const at = (x: number, y: number) => `${round(cx + x * r)} ${round(cy + y * r)}`;
  if (shape === 'circle') {
    const d = round(r * 2);
    return `M${round(cx - r)} ${round(cy)}a${round(r)} ${round(r)} 0 1 0 ${d} 0a${round(r)} ${round(r)} 0 1 0 ${-d} 0Z`;
  }
  if (shape === 'pin') {
    // 针尖、右切点，沿针头的大弧到左切点；孔是两段半圆
    const head = round(PIN.r * r);
    const hole = round(PIN.hole * r);
    const { x, y } = PIN_TANGENT;
    const outline = `M${at(0, PIN.tipY)}L${at(x, y)}A${head} ${head} 0 1 0 ${at(-x, y)}Z`;
    const arc = (to: number) => `A${hole} ${hole} 0 1 0 ${at(to, PIN.cy)}`;
    return `${outline}M${at(PIN.hole, PIN.cy)}${arc(-PIN.hole)}${arc(PIN.hole)}Z`;
  }
  return `M${POLYGONS[shape].map(([x, y]) => at(x, y)).join('L')}Z`;
}

/** 图片里形状的半径（icon-size 为 1 时的 CSS 像素）：icon-size 是符号的半径除以它 */
export const SHAPE_BASE_RADIUS = 4;

/** 图片的像素比：半径 4、像素比 4 时小尺寸的描边范围也够（实测） */
export const SHAPE_PIXEL_RATIO = 4;

// MapLibre 的 SDF 约定（symbol_sdf.fragment.glsl）：边缘在 0.75，描边的位置是 (6 - 宽度 / icon-size) / 8，
// 所以每个图片像素（icon-size 为 1 时的 CSS 像素）对应 1/8 的透明度，距离场要从边缘往外留 6 个图片像素
const SDF_EDGE = 0.75;
const SDF_PER_PIXEL = 8;
const FIELD_RANGE = 6;

/**
 * 不露出图片方框的最大描边宽度（屏幕像素）：描边要留在距离场的范围里，再减去抗锯齿的宽度
 * （按 1 倍屏算：0.105 × 8 = 0.84），再留 0.25；实测超出时整个图片的方框都会露出来
 */
export function maxHaloWidth(iconSize: number): number {
  return Math.max(0, FIELD_RANGE * iconSize - 0.84 - 0.25);
}

/** 图标的偏移（图片像素，随 icon-size 缩放）：定位针往上挪，针尖落在要素的位置；其他形状的中心在要素的位置 */
export function shapeOffset(shape: PointShape): readonly [number, number] {
  return shape === 'pin' ? [0, -PIN.tipY * SHAPE_BASE_RADIUS] : [0, 0];
}

// ID 以分组名为前缀（ADR 0027、0045），resources 分组的推导用到；选中高亮的分组也引用这些图片
const PREFIX = 'resources-shape-';

export function shapeImageId(shape: PointShape): string {
  return `${PREFIX}${shape}`;
}

// 四周留出距离场的范围再加 1 个图片像素，图片边上的距离场已经降到 0
function sdfImage(shape: PointShape): StyleImage {
  const half = EXTENT * SHAPE_BASE_RADIUS + FIELD_RANGE + 1;
  const size = Math.ceil(half * 2 * SHAPE_PIXEL_RATIO);
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      // 像素中心换成图片像素，再换成单位坐标
      const x = (column + 0.5 - center) / SHAPE_PIXEL_RATIO / SHAPE_BASE_RADIUS;
      const y = (row + 0.5 - center) / SHAPE_PIXEL_RATIO / SHAPE_BASE_RADIUS;
      const distance = shapeDistance(shape, x, y) * SHAPE_BASE_RADIUS;
      const alpha = Math.min(1, Math.max(0, SDF_EDGE + distance / SDF_PER_PIXEL));
      // 颜色通道不用，只有透明度通道是距离场
      data.set([255, 255, 255, Math.round(alpha * 255)], (row * size + column) * 4);
    }
  }
  return { width: size, height: size, data, pixelRatio: SHAPE_PIXEL_RATIO, sdf: true };
}

// 生成过的图片：同一个 ID 始终返回同一个对象（会话按引用比较图片）
const generated = new Map<PointShape, StyleImage>();

function imageOf(shape: PointShape): StyleImage {
  let image = generated.get(shape);
  if (!image) {
    image = sdfImage(shape);
    generated.set(shape, image);
  }
  return image;
}

/** 这些形状的图片，按 ID */
export function shapeImages(shapes: Iterable<PointShape>): StyleImages {
  return Object.fromEntries([...new Set(shapes)].map(shape => [shapeImageId(shape), imageOf(shape)]));
}
