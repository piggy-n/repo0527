// Cesium 相机的数值换算（ADR 0079 第 4 节），算法沿用旧 CesiumEngine；缩放级和距离的换算在 map-core 的 camera-distance

/** 正俯视时俯角抬高到这个值（度）：俯角正好为 0 时方位编码不进相机的姿态，读回时会丢掉 */
export const NADIR_EPSILON = 0.01;

/** Cesium 透视视锥的 fov：宽屏（宽高比大于 1）时它表示水平视场角，要按竖直视场角换算 */
export function frustumFov(fovy: number, aspect: number): number {
  return aspect > 1 ? 2 * Math.atan(Math.tan(fovy / 2) * aspect) : fovy;
}

/** 写进三维相机的俯角（度，0 是正俯视）：正俯视时抬高一点，保住方位 */
export function writablePitch(pitch: number): number {
  return Math.max(pitch, NADIR_EPSILON);
}

/** 从三维相机读回的俯角：写入时抬高的那一点归零 */
export function readablePitch(pitch: number): number {
  return pitch <= NADIR_EPSILON * 2 ? 0 : pitch;
}

// 读回的方位离 360° 小于这个值（度）时当作 0：解算出的 -0.00000001° 取模后会变成 359.99999999°
const FULL_TURN_EPSILON = 1e-6;

/** 方位角归到 [0, 360) */
export function normalizeBearing(bearing: number): number {
  const value = ((bearing % 360) + 360) % 360;
  return value > 360 - FULL_TURN_EPSILON ? 0 : value;
}
