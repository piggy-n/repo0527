// 导航网格的坐标系（ADR 0085 第 2 节）：瓦片集根节点的局部系（米）与经纬度、椭球高的互换

export type Point3 = [number, number, number];

/** 列主序的 4×4 矩阵，同 3D Tiles 的 transform */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const out = new Float64Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const out = identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** 刚体变换（旋转加平移）的逆：旋转部分转置 */
export function invertRigid(m: ArrayLike<number>): Mat4 {
  const out = identity();
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[col * 4 + row] = m[row * 4 + col];
    }
  }
  for (let row = 0; row < 3; row++) {
    out[12 + row] = -(m[row * 4] * m[12] + m[row * 4 + 1] * m[13] + m[row * 4 + 2] * m[14]);
  }
  return out;
}

export function transformPoint(m: ArrayLike<number>, [x, y, z]: readonly [number, number, number]): Point3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}


// WGS84
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

/** 经纬度（度）、椭球高（米）→ 地心坐标 */
export function toEcef(lng: number, lat: number, height: number): Point3 {
  const lambda = toRadians(lng);
  const phi = toRadians(lat);
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  return [
    (n + height) * Math.cos(phi) * Math.cos(lambda),
    (n + height) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - E2) + height) * Math.sin(phi)
  ];
}

/** 地心坐标 → [经度, 纬度, 椭球高]，迭代求纬度 */
export function fromEcef([x, y, z]: readonly [number, number, number]): Point3 {
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - E2));
  let height = 0;
  for (let i = 0; i < 8; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
    height = p / Math.cos(phi) - n;
    phi = Math.atan2(z, p * (1 - (E2 * n) / (n + height)));
  }
  return [toDegrees(Math.atan2(y, x)), toDegrees(phi), height];
}

/** 导航网格的局部系 */
export interface NavFrame {
  /** 局部系 → 地心坐标 */
  readonly toWorld: Mat4;
  /** 局部 y 轴的方位角（度，从正北顺时针）：平面图按它旋转，保证正北朝上 */
  readonly north: number;
  /** 地面（原点处的椭球面）在局部系里的高度 */
  readonly ground: number;
  toLocal(lng: number, lat: number, height: number): Point3;
  /** [经度, 纬度, 椭球高] */
  toLngLat(point: readonly [number, number, number]): Point3;
}

/** 由瓦片集根节点的 transform 得到局部系；只支持旋转加平移 */
export function navigationFrame(transform: readonly number[]): NavFrame {
  if (transform.length !== 16 || !transform.every(Number.isFinite)) {
    throw new Error('瓦片集根节点的 transform 不是 16 个数');
  }
  const toWorld = Float64Array.from(transform);
  const fromWorld = invertRigid(toWorld);
  const origin = fromEcef([toWorld[12], toWorld[13], toWorld[14]]);
  const [lng, lat] = origin;
  const lambda = toRadians(lng);
  const phi = toRadians(lat);
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const yAxis = [toWorld[4], toWorld[5], toWorld[6]];
  const toLocal = (pointLng: number, pointLat: number, height: number) =>
    transformPoint(fromWorld, toEcef(pointLng, pointLat, height));
  return {
    toWorld,
    north: (toDegrees(Math.atan2(dot(yAxis, east), dot(yAxis, north))) + 360) % 360,
    ground: toLocal(lng, lat, 0)[2],
    toLocal,
    toLngLat: point => fromEcef(transformPoint(toWorld, point))
  };
}
