import {
  BoundingSphere,
  Cartesian3,
  Math as CesiumMath,
  Matrix4,
  Rectangle,
  Transforms,
  type Ellipsoid
} from 'cesium';
import type { CameraState, FitBoundsOptions, FlyToOptions, ViewBounds, ViewPadding } from '@yzt/map-core';
import { scaleAtLatitude, VERTICAL_FOV, type CesiumCameraPose } from './camera-geometry';

/** 定位规划只读取画布和椭球，不修改当前相机 */
interface CameraPlanHost {
  readonly canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>;
  readonly scene: { readonly ellipsoid: Ellipsoid };
}

interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const MERCATOR_LATITUDE = 85.05112878;
const TAN_HALF_FOV = Math.tan(VERTICAL_FOV / 2);

function viewport(host: CameraPlanHost, padding: ViewPadding = 0): Viewport {
  const { clientWidth: width, clientHeight: height } = host.canvas;
  const edges = typeof padding === 'number' ? { left: padding, right: padding, top: padding, bottom: padding } : padding;
  if (
    ![width, height, edges.left, edges.right, edges.top, edges.bottom].every(Number.isFinite) ||
    width <= 0 || height <= 0 || Object.values(edges).some(value => value < 0) ||
    edges.left + edges.right >= width || edges.top + edges.bottom >= height
  ) {
    throw new RangeError('定位留白必须是非负像素，且剩余画布宽高必须大于零');
  }
  return { width, height, ...edges };
}

function validateCamera(state: CameraState): void {
  if (!state.center.every(Number.isFinite) || ![state.zoom, state.bearing, state.pitch].every(Number.isFinite)) {
    throw new RangeError('定位相机必须包含有限的经纬度、级别和角度');
  }
  if (Math.abs(state.center[1]) > 90) {
    throw new RangeError('定位纬度必须位于南北极之间');
  }
}

// 从目标点的 ENU 计算相机，保留与共享相机相同的缩放、方位角和俯角
function poseAt(host: CameraPlanHost, frame: Viewport, state: CameraState): CesiumCameraPose {
  const latitude = CesiumMath.clamp(state.center[1], -MERCATOR_LATITUDE, MERCATOR_LATITUDE);
  const heading = CesiumMath.toRadians(state.bearing);
  const pitch = CesiumMath.toRadians(CesiumMath.clamp(state.pitch, 0.01, 85));
  const range = scaleAtLatitude(latitude) / 2 ** state.zoom * frame.height / (2 * TAN_HALF_FOV);
  if (!Number.isFinite(range) || range <= 0) {
    throw new RangeError('相机缩放级无法转换为有限的三维距离');
  }
  const target = Cartesian3.fromDegrees(state.center[0], latitude, 0, host.scene.ellipsoid);
  const transform = Transforms.eastNorthUpToFixedFrame(target, host.scene.ellipsoid);
  const direction = Matrix4.multiplyByPointAsVector(transform, new Cartesian3(
    Math.sin(heading) * Math.sin(pitch), Math.cos(heading) * Math.sin(pitch), -Math.cos(pitch)
  ), new Cartesian3());
  const right = Matrix4.multiplyByPointAsVector(transform, new Cartesian3(
    Math.cos(heading), -Math.sin(heading), 0
  ), new Cartesian3());
  return {
    position: Cartesian3.subtract(target, Cartesian3.multiplyByScalar(direction, range, new Cartesian3()), new Cartesian3()),
    direction,
    up: Cartesian3.cross(right, direction, new Cartesian3())
  };
}

function projectTarget(pose: CesiumCameraPose, target: Cartesian3, frame: Viewport): readonly [number, number] | null {
  const delta = Cartesian3.subtract(target, pose.position, new Cartesian3());
  const depth = Cartesian3.dot(delta, pose.direction);
  if (depth <= 0) {
    return null;
  }
  const right = Cartesian3.cross(pose.direction, pose.up, new Cartesian3());
  const pixels = frame.height / (2 * TAN_HALF_FOV * depth);
  return [
    frame.width / 2 + Cartesian3.dot(delta, right) * pixels,
    frame.height / 2 - Cartesian3.dot(delta, pose.up) * pixels
  ];
}

// 留白只改变此次定位的中心；直接旋转相机会改变调用方要求的俯角，不能代替求解
function poseWithPadding(host: CameraPlanHost, frame: Viewport, state: CameraState): CesiumCameraPose {
  const target = Cartesian3.fromDegrees(state.center[0], CesiumMath.clamp(
    state.center[1], -MERCATOR_LATITUDE, MERCATOR_LATITUDE
  ), 0, host.scene.ellipsoid);
  const wantedX = (frame.left + frame.width - frame.right) / 2;
  const wantedY = (frame.top + frame.height - frame.bottom) / 2;
  let center: CameraState['center'] = state.center;
  const delta = 0.00001;
  for (let iteration = 0; iteration < 30; iteration++) {
    const pose = poseAt(host, frame, { ...state, center });
    const point = projectTarget(pose, target, frame);
    if (!point) {
      break;
    }
    const errorX = point[0] - wantedX;
    const errorY = point[1] - wantedY;
    if (Math.hypot(errorX, errorY) < 0.0001) {
      return pose;
    }
    const longitude = projectTarget(poseAt(host, frame, {
      ...state, center: [center[0] + delta, center[1]]
    }), target, frame);
    const latitude = projectTarget(poseAt(host, frame, {
      ...state, center: [center[0], center[1] + delta]
    }), target, frame);
    if (!longitude || !latitude) {
      break;
    }
    const a = (longitude[0] - point[0]) / delta;
    const b = (latitude[0] - point[0]) / delta;
    const c = (longitude[1] - point[1]) / delta;
    const d = (latitude[1] - point[1]) / delta;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      break;
    }
    const stepLng = (d * errorX - b * errorY) / determinant;
    const stepLat = (a * errorY - c * errorX) / determinant;
    const factor = Math.max(1, Math.abs(stepLng) / 10, Math.abs(stepLat) / 10);
    center = [center[0] - stepLng / factor, CesiumMath.clamp(
      center[1] - stepLat / factor, -MERCATOR_LATITUDE, MERCATOR_LATITUDE
    )];
  }
  throw new RangeError('当前俯角、级别和留白无法完成三维定位');
}

/** 保持共享相机语义规划定位；没有目标中心时忽略留白 */
export function planCesiumFlyTo(
  host: CameraPlanHost, current: CameraState, target: Partial<CameraState>, options: FlyToOptions = {}
): CesiumCameraPose {
  const state = { ...current, ...target };
  validateCamera(state);
  const frame = viewport(host, target.center ? options.padding : 0);
  return poseWithPadding(host, frame, state);
}

function sphereFits(pose: CesiumCameraPose, sphere: BoundingSphere, frame: Viewport): boolean {
  const delta = Cartesian3.subtract(sphere.center, pose.position, new Cartesian3());
  const right = Cartesian3.cross(pose.direction, pose.up, new Cartesian3());
  const tangentX = TAN_HALF_FOV * frame.width / frame.height;
  const planes: readonly [Cartesian3, number, number][] = [
    [right, 1, (1 - 2 * frame.left / frame.width) * tangentX],
    [right, -1, (1 - 2 * frame.right / frame.width) * tangentX],
    [pose.up, 1, (1 - 2 * frame.bottom / frame.height) * TAN_HALF_FOV],
    [pose.up, -1, (1 - 2 * frame.top / frame.height) * TAN_HALF_FOV]
  ];
  return Cartesian3.dot(delta, pose.direction) > sphere.radius && planes.every(([axis, sign, tangent]) => {
    const normal = Cartesian3.add(
      Cartesian3.multiplyByScalar(axis, sign, new Cartesian3()),
      Cartesian3.multiplyByScalar(pose.direction, tangent, new Cartesian3()), new Cartesian3()
    );
    return Cartesian3.dot(delta, normal) >= sphere.radius * Cartesian3.magnitude(normal);
  });
}

/** 使用椭球矩形包围球保证整个范围落入留白区域，旋转归零、未指定的俯角沿用当前值 */
export function planCesiumFitBounds(
  host: CameraPlanHost, current: CameraState, bounds: ViewBounds, options: FitBoundsOptions = {}
): CesiumCameraPose {
  const [west, south, east, north] = bounds;
  const span = east >= west ? east - west : east + 360 - west;
  if (
    !bounds.every(Number.isFinite) || south > north || south < -90 || north > 90 || span < 0 || span > 360 ||
    (options.maxZoom !== undefined && !Number.isFinite(options.maxZoom))
  ) {
    throw new RangeError('定位范围或最大缩放级不合法');
  }
  const frame = viewport(host, options.padding);
  const state: CameraState = {
    center: [west + span / 2, (south + north) / 2], zoom: options.maxZoom ?? 22,
    bearing: 0, pitch: options.pitch ?? current.pitch
  };
  validateCamera(state);
  const sphere = BoundingSphere.fromRectangle3D(Rectangle.fromDegrees(west, south, east, north), host.scene.ellipsoid);
  const minimumTangent = Math.min(
    (frame.width - frame.left - frame.right) / frame.height * TAN_HALF_FOV,
    (frame.height - frame.top - frame.bottom) / frame.height * TAN_HALF_FOV
  );
  const approximateRange = Math.max(1, sphere.radius / minimumTangent);
  let zoom = Math.min(state.zoom, Math.log2(
    scaleAtLatitude(state.center[1]) * frame.height / (2 * TAN_HALF_FOV * approximateRange)
  ));
  let pose = poseWithPadding(host, frame, { ...state, zoom });
  // 先找到可容纳包围球的距离，再二分收紧，避免倾斜及球面曲率使边界越出留白
  for (let attempt = 0; !sphereFits(pose, sphere, frame); attempt++) {
    if (attempt >= 30) {
      throw new RangeError('当前俯角和留白无法容纳三维定位范围');
    }
    zoom -= 1;
    pose = poseWithPadding(host, frame, { ...state, zoom });
  }
  let lower = zoom;
  let upper = state.zoom;
  for (let attempt = 0; attempt < 24 && upper - lower > 0.000001; attempt++) {
    const middle = (lower + upper) / 2;
    const candidate = poseWithPadding(host, frame, { ...state, zoom: middle });
    if (sphereFits(candidate, sphere, frame)) {
      lower = middle;
      pose = candidate;
    } else {
      upper = middle;
    }
  }
  return pose;
}
