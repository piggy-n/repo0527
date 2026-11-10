import type { AnchorMatrices, SceneFrame, ScreenPoint } from '@mx/map-core';
import { MathUtils, Matrix4, type PerspectiveCamera, Vector3, Vector4 } from 'three';

// 每帧的投影换算（ADR 0147 第 5 节，做法来自 PoC 的 own-layer）：一个锚点的局部系（x 东、y 上、z 南，米）到裁剪空间，
// 再从这个矩阵拆出 Three 的相机。局部系按锚点各算一份，远处的模型也有足够的精度

/** 换算时复用的矩阵，避免每帧分配 */
export class FrameMath {
  readonly #flat = new Matrix4();
  readonly #anchor = new Matrix4();
  readonly #view = new Matrix4();
  readonly #scale = new Vector3();
  readonly #point = new Vector4();

  /**
   * 局部系到裁剪空间：墨卡托、地球各用一个矩阵；地球投影的过渡段在裁剪空间按 mix(墨卡托, 地球, t) 插值，
   * 和 MapLibre 着色器的做法相同，z<12 也画
   */
  clipMatrix(frame: SceneFrame, anchor: AnchorMatrices, out: Matrix4): Matrix4 {
    const t = frame.transition;
    if (t <= 0) {
      return out.fromArray(frame.mainMatrix).multiply(this.#anchor.fromArray(anchor.mercator));
    }
    out.fromArray(frame.mainMatrix).multiply(this.#anchor.fromArray(anchor.globe));
    if (t >= 1) {
      return out;
    }
    this.#flat.fromArray(frame.fallbackMatrix).multiply(this.#anchor.fromArray(anchor.mercator));
    const elements = out.elements;
    for (let i = 0; i < 16; i++) {
      elements[i] = MathUtils.lerp(this.#flat.elements[i], elements[i], t);
    }
    return out;
  }

  /** 从裁剪矩阵拆出相机的位姿和投影（同 maplibre-gl-three 的 MapCameraSync），拾取和瓦片的视锥裁剪都用它 */
  syncCamera(camera: PerspectiveCamera, clip: Matrix4, frame: SceneFrame): void {
    this.#view.fromArray(frame.projectionMatrix).invert().multiply(clip);
    this.#view.invert().decompose(camera.position, camera.quaternion, this.#scale);
    camera.quaternion.normalize();
    camera.scale.set(1, 1, 1);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    camera.projectionMatrix.multiplyMatrices(clip, camera.matrixWorld);
    // 统一缩放成 w = -z 的常规形式：整个矩阵乘同一个数，裁剪结果不变
    const normalization = -camera.projectionMatrix.elements[11];
    if (normalization !== 0) {
      camera.projectionMatrix.multiplyScalar(1 / normalization);
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // 读 fov、near、far 的第三方代码（瓦片的屏幕误差）用这些字段
    const p = camera.projectionMatrix.elements;
    camera.fov = MathUtils.radToDeg(2 * Math.atan(1 / p[5]));
    camera.aspect = p[5] / p[0];
    camera.near = p[14] / (p[10] - 1);
    camera.far = p[14] / (p[10] + 1);
  }

  /** 地球投影时锚点在球的背面（被裁剪面挡住）：整个模型不画，也拾取不到 */
  behindGlobe(frame: SceneFrame, anchor: AnchorMatrices): boolean {
    if (frame.transition <= 0) {
      return false;
    }
    const [a, b, c, d] = frame.clippingPlane;
    const { globe } = anchor;
    return globe[12] * a + globe[13] * b + globe[14] * c + d < 0;
  }

  /** 锚点正上方 height 米处在画布上的位置（CSS 像素）；在相机背后、地球背面时为 null */
  project(
    frame: SceneFrame,
    anchor: AnchorMatrices,
    height: number,
    size: { readonly width: number; readonly height: number },
    scratch: Matrix4
  ): ScreenPoint | null {
    if (this.behindGlobe(frame, anchor)) {
      return null;
    }
    const clip = this.#point.set(0, height, 0, 1).applyMatrix4(this.clipMatrix(frame, anchor, scratch));
    if (clip.w <= 0) {
      return null;
    }
    return { x: ((clip.x / clip.w + 1) / 2) * size.width, y: ((1 - clip.y / clip.w) / 2) * size.height };
  }
}

/** 画布上的点换成裁剪空间的 x、y */
export function toNdc({ x, y }: ScreenPoint, size: { readonly width: number; readonly height: number }): [number, number] {
  return [(x / size.width) * 2 - 1, 1 - (y / size.height) * 2];
}
