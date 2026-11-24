// 估计瓦片集模型的地面（ADR 0170）：读最粗一级内容的顶点，换成经纬度和椭球高，取地面所在的高度。
// 只用 Node 自带的能力，不依赖地图的包；坐标换算按 WGS84，和 map-core 的 fromEcef 是同一个椭球
import { ToolError } from './errors.ts';

/** 4×4 矩阵，列主序（3D Tiles、glTF 的写法） */
export type Matrix = readonly number[];

export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// glTF 的 y 向上换成 3D Tiles 的 z 向上（绕 x 轴转 90°）
const Y_UP_TO_Z_UP: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

/** 地心坐标换成 [经度, 纬度, 椭球高] */
export function fromEcef([x, y, z]: readonly [number, number, number]): [number, number, number] {
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let height = 0;
  for (let i = 0; i < 6; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    height = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + height)));
  }
  return [(Math.atan2(y, x) * 180) / Math.PI, (lat * 180) / Math.PI, height];
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = Array.from({ length: 16 }, () => 0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) {
        out[column * 4 + row] += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
    }
  }
  return out;
}

function translation([x = 0, y = 0, z = 0]: readonly number[]): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function apply(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  const at = (index: number) => m[index] ?? 0;
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14)
  ];
}

interface GltfNode {
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}

interface Gltf {
  readonly asset?: { readonly version?: string };
  readonly extensionsUsed?: readonly string[];
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly GltfNode[];
  readonly meshes?: readonly {
    readonly primitives: readonly { readonly attributes: { readonly POSITION?: number } }[];
  }[];
  readonly accessors?: readonly {
    readonly bufferView?: number;
    readonly byteOffset?: number;
    readonly componentType: number;
    readonly count: number;
    readonly type: string;
  }[];
  readonly bufferViews?: readonly { readonly byteOffset?: number; readonly byteStride?: number }[];
}

function nodeMatrix({ matrix, translation: t, rotation, scale }: GltfNode): Matrix {
  if (matrix) {
    return matrix;
  }
  let m = t ? translation(t) : IDENTITY;
  if (rotation) {
    const [x = 0, y = 0, z = 0, w = 1] = rotation;
    m = multiply(m, [
      1 - 2 * (y * y + z * z),
      2 * (x * y + z * w),
      2 * (x * z - y * w),
      0,
      2 * (x * y - z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z + x * w),
      0,
      2 * (x * z + y * w),
      2 * (y * z - x * w),
      1 - 2 * (x * x + y * y),
      0,
      0,
      0,
      0,
      1
    ]);
  }
  if (scale) {
    const [x = 1, y = 1, z = 1] = scale;
    m = multiply(m, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  }
  return m;
}

/** 一块内容的顶点（地心坐标）；压缩过、量化过的读不了，记在 skipped 里 */
export interface ContentPoints {
  readonly points: [number, number, number][];
  readonly skipped: readonly string[];
}

/**
 * 读 glb 的顶点：base 是内容到地心坐标的矩阵（瓦片的变换、RTC），zUp 为 true 时 glTF 本来就是 z 向上
 * （瓦片集写了 asset.gltfUpAxis: 'Z'），否则先按 3D Tiles 的约定从 y 向上换过来
 */
export function glbPoints(glb: Uint8Array, base: Matrix, zUp: boolean): ContentPoints {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    return { points: [], skipped: ['不是 glb'] };
  }
  if (view.getUint32(4, true) !== 2) {
    return { points: [], skipped: [`glTF ${view.getUint32(4, true)}.0（只读 2.0）`] };
  }
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Gltf;
  const compressed = (gltf.extensionsUsed ?? []).filter(name => /draco|meshopt/i.test(name));
  if (compressed.length > 0) {
    return { points: [], skipped: [`压缩的网格（${compressed.join('、')}）`] };
  }
  const binStart = 20 + jsonLength + 8;
  const bin = new DataView(glb.buffer, glb.byteOffset + binStart, glb.byteLength - binStart);
  const root = multiply(base, zUp ? IDENTITY : Y_UP_TO_Z_UP);
  const points: [number, number, number][] = [];
  const skipped: string[] = [];
  const visit = (index: number, parent: Matrix) => {
    const node = gltf.nodes?.[index];
    if (!node) {
      return;
    }
    const m = multiply(parent, nodeMatrix(node));
    for (const primitive of node.mesh === undefined ? [] : (gltf.meshes?.[node.mesh]?.primitives ?? [])) {
      const position = primitive.attributes.POSITION;
      const accessor = position === undefined ? undefined : gltf.accessors?.[position];
      const bufferView = accessor?.bufferView === undefined ? undefined : gltf.bufferViews?.[accessor.bufferView];
      // 5126 是 FLOAT：量化过的（KHR_mesh_quantization）不读
      if (!accessor || !bufferView || accessor.componentType !== 5126 || accessor.type !== 'VEC3') {
        skipped.push('不是浮点的顶点');
        continue;
      }
      const stride = bufferView.byteStride ?? 12;
      const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      for (let i = 0; i < accessor.count; i++) {
        const offset = start + i * stride;
        const x = bin.getFloat32(offset, true);
        const y = bin.getFloat32(offset + 4, true);
        const z = bin.getFloat32(offset + 8, true);
        points.push(apply(m, x, y, z));
      }
    }
    for (const child of node.children ?? []) {
      visit(child, m);
    }
  };
  for (const index of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) {
    visit(index, root);
  }
  return { points, skipped };
}

/** 读一块内容（b3dm 或 glb）的顶点；别的格式（i3dm、pnts、cmpt）记在 skipped 里 */
export function contentPoints(data: Uint8Array, tileMatrix: Matrix, zUp: boolean): ContentPoints {
  const magic = new TextDecoder().decode(data.subarray(0, 4));
  if (magic === 'glTF') {
    return glbPoints(data, tileMatrix, zUp);
  }
  if (magic !== 'b3dm') {
    return { points: [], skipped: [`不读 ${magic} 格式`] };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [featureJson, featureBinary, batchJson, batchBinary] = [12, 16, 20, 24].map(offset =>
    view.getUint32(offset, true)
  );
  const feature = featureJson
    ? (JSON.parse(new TextDecoder().decode(data.subarray(28, 28 + featureJson))) as { RTC_CENTER?: number[] })
    : {};
  const glbStart = 28 + featureJson + featureBinary + batchJson + batchBinary;
  const base = feature.RTC_CENTER ? multiply(tileMatrix, translation(feature.RTC_CENTER)) : tileMatrix;
  return glbPoints(data.subarray(glbStart), base, zUp);
}

/** 估计出的地面：参照点（经纬度、椭球高）和高度的分布，方便人核对 */
export interface GroundEstimate {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly vertices: number;
  /** 最低、5%、25%、中位、最高 */
  readonly spread: readonly [number, number, number, number, number];
}

/**
 * 地面：低的一半顶点里按 1 米分档、最多的那一档。倾斜摄影里地面是面积最大的一片，屋顶分散在各个高度；
 * 只看低的一半，楼多的地方屋顶也挤不过地面。参照点的经纬度是这一档顶点的平均位置，高度是它们的中位数
 */
export function estimateGround(points: readonly (readonly [number, number, number])[]): GroundEstimate {
  if (points.length === 0) {
    throw new ToolError('没有读到顶点');
  }
  const geodetic = points.map(point => fromEcef(point));
  const heights = geodetic.map(([, , height]) => height).toSorted((a, b) => a - b);
  const at = (fraction: number) => heights[Math.min(heights.length - 1, Math.floor(fraction * heights.length))] ?? 0;
  const median = at(0.5);
  const bins = new Map<number, number>();
  for (const height of heights) {
    if (height <= median) {
      bins.set(Math.floor(height), (bins.get(Math.floor(height)) ?? 0) + 1);
    }
  }
  const [mode] = [...bins].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const inMode = geodetic.filter(([, , height]) => Math.floor(height) === mode);
  const modeHeights = inMode.map(([, , height]) => height).toSorted((a, b) => a - b);
  const sum = inMode.reduce((total, [lng, lat]) => [total[0] + lng, total[1] + lat], [0, 0]);
  return {
    lng: sum[0] / inMode.length,
    lat: sum[1] / inMode.length,
    height: modeHeights[Math.floor(modeHeights.length / 2)] ?? mode,
    vertices: points.length,
    spread: [at(0), at(0.05), at(0.25), median, at(1)]
  };
}
