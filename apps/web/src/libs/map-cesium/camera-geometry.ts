import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  Transforms,
  type Camera,
  type Scene
} from 'cesium';
import type { CameraState } from '@yzt/map-core';
import type { CameraPort } from './camera-bridge';

// 与 MapLibre 6 的 transform_helper、mercator_coordinate 保持相同的视场角和 512 像素缩放口径
const VERTICAL_FOV = 0.6435011087932844;
const METERS_PER_PIXEL_AT_EQUATOR = 2 * Math.PI * 6371008.8 / 512;
const MERCATOR_LATITUDE = 85.05112878;
// lookAt 在正天底丢失方位角，用微小俯角保留朝向，读回时归零
const NADIR_PITCH = 0.01;

/** 只依赖相机数学和画布尺寸，测试不需要创建 WebGL 场景 */
interface CameraGeometryHost {
  readonly camera: Pick<
    Camera,
    'frustum' | 'positionCartographic' | 'positionWC' | 'directionWC' | 'upWC' |
    'lookAt' | 'lookAtTransform' | 'pickEllipsoid' | 'setView'
  >;
  readonly canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>;
  readonly scene: Pick<Scene, 'ellipsoid'>;
}

/** 保留三维的精确姿态，避免只经过共享相机往返造成收敛 */
export interface CesiumCameraPose {
  readonly position: Cartesian3;
  readonly direction: Cartesian3;
  readonly up: Cartesian3;
}

// 极区按二维可表示的纬度计算比例尺，避免 cos(90°) 退化
function scaleAtLatitude(latitude: number): number {
  const limited = CesiumMath.clamp(latitude, -MERCATOR_LATITUDE, MERCATOR_LATITUDE);
  return METERS_PER_PIXEL_AT_EQUATOR * Math.cos(CesiumMath.toRadians(limited));
}

/** Cesium 在横屏时把 fov 解释为水平角，按实际宽高比保持统一的竖直视场角 */
export function resizeCameraFrustum({ camera, canvas }: CameraGeometryHost): void {
  if (!(camera.frustum instanceof PerspectiveFrustum)) {
    return;
  }
  const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
  camera.frustum.aspectRatio = aspect;
  camera.frustum.fov = aspect > 1 ? 2 * Math.atan(Math.tan(VERTICAL_FOV / 2) * aspect) : VERTICAL_FOV;
}

/** 共享相机与 Cesium 姿态的转换；不接触会话、事件或原生实例出口 */
export function createCesiumCameraPort(widget: CameraGeometryHost): CameraPort<CesiumCameraPose> {
  const { camera, canvas, scene } = widget;

  return {
    read(): CameraState | null {
      // 隐藏画布无法产生拾取射线；地下相机可能打到地球另一侧，不作为二维中心
      if (
        canvas.clientWidth <= 0 || canvas.clientHeight <= 0 || camera.positionCartographic.height <= 0 ||
        !(camera.frustum instanceof PerspectiveFrustum)
      ) {
        return null;
      }
      const target = camera.pickEllipsoid(
        new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), scene.ellipsoid
      );
      if (!target) {
        return null;
      }
      const ground = Cartographic.fromCartesian(target, scene.ellipsoid);
      const latitude = CesiumMath.toDegrees(ground.latitude);
      // 在目标点的 ENU 系中解算，直接用相机所在地的 heading/pitch 会在省域倾斜视角漂移
      const toLocal = Matrix4.inverseTransformation(
        Transforms.eastNorthUpToFixedFrame(target, scene.ellipsoid), new Matrix4()
      );
      const offset = Matrix4.multiplyByPoint(toLocal, camera.positionWC, new Cartesian3());
      const distance = Cartesian3.magnitude(offset);
      const up = Matrix4.multiplyByPointAsVector(toLocal, camera.upWC, new Cartesian3());
      const bearing = CesiumMath.toDegrees(Math.atan2(up.x, up.y));
      const pitch = CesiumMath.toDegrees(Math.atan2(Math.hypot(offset.x, offset.y), offset.z));
      const metersPerPixel = 2 * distance * Math.tan(camera.frustum.fovy / 2) / canvas.clientHeight;
      const zoom = Math.log2(scaleAtLatitude(latitude) / metersPerPixel);
      if (![latitude, bearing, pitch, zoom].every(Number.isFinite)) {
        return null;
      }
      return {
        center: [CesiumMath.toDegrees(ground.longitude), latitude],
        zoom,
        bearing: (bearing + 360) % 360,
        pitch: pitch <= NADIR_PITCH * 2 ? 0 : pitch
      };
    },
    apply(state): void {
      resizeCameraFrustum(widget);
      if (!(camera.frustum instanceof PerspectiveFrustum)) {
        throw new Error('共享相机只支持 Cesium 三维透视视图');
      }
      const latitude = CesiumMath.clamp(state.center[1], -MERCATOR_LATITUDE, MERCATOR_LATITUDE);
      const pitch = CesiumMath.clamp(state.pitch, NADIR_PITCH, 85);
      const range = scaleAtLatitude(latitude) / 2 ** state.zoom * Math.max(1, canvas.clientHeight) /
        (2 * Math.tan(camera.frustum.fovy / 2));
      if (!Number.isFinite(range) || range <= 0) {
        throw new RangeError('相机缩放级无法转换为有限的三维距离');
      }
      const target = Cartesian3.fromDegrees(state.center[0], latitude, 0, scene.ellipsoid);
      camera.lookAt(target, new HeadingPitchRange(
        CesiumMath.toRadians(state.bearing), CesiumMath.toRadians(pitch - 90), range
      ));
      // 解除 lookAt 设置的参考系，后续鼠标操作仍是自由相机
      camera.lookAtTransform(Matrix4.IDENTITY);
    },
    capture(): CesiumCameraPose {
      return {
        position: Cartesian3.clone(camera.positionWC),
        direction: Cartesian3.clone(camera.directionWC),
        up: Cartesian3.clone(camera.upWC)
      };
    },
    restore(pose): void {
      camera.setView({
        destination: pose.position,
        orientation: { direction: pose.direction, up: pose.up },
        endTransform: Matrix4.IDENTITY
      });
    },
    equals(a, b): boolean {
      // 世界坐标只用绝对误差，避免按地球半径计算相对误差而吞掉真实移动
      return Cartesian3.equalsEpsilon(a.position, b.position, 0, 1e-6) &&
        Cartesian3.equalsEpsilon(a.direction, b.direction, 0, 1e-12) &&
        Cartesian3.equalsEpsilon(a.up, b.up, 0, 1e-12);
    }
  };
}
