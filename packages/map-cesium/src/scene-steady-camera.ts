import { Cartesian3, Matrix4, type Scene } from 'cesium';

// 比它小的变化只是舍入误差（1e-12 弧度在 1000 像素的焦距上不到 1e-9 像素）
// 位置按最大分量缩放，和 Cesium 判断相机变化的口径相同
const DRIFT = 1e-12;

const scratch = new Cartesian3();

/** 相机静止时撤销 Cesium 自己的舍入漂移（map-cesium.md"相机的舍入漂移"），返回取消的函数 */
export function holdCameraSteady(scene: Scene): () => void {
  const { camera } = scene;
  const held = {
    position: Cartesian3.clone(camera.position),
    direction: Cartesian3.clone(camera.direction),
    up: Cartesian3.clone(camera.up),
    right: Cartesian3.clone(camera.right),
    transform: Matrix4.clone(camera.transform)
  };
  // preUpdate 在漂移之后（initializeFrame 里读 heading、roll）、判断相机变没变之前（checkForCameraUpdates）
  return scene.preUpdate.addEventListener(() => {
    const scale = Math.max(1, Cartesian3.maximumComponent(Cartesian3.abs(held.position, scratch)));
    const drifted =
      Matrix4.equals(camera.transform, held.transform) &&
      Cartesian3.equalsEpsilon(camera.position, held.position, 0, DRIFT * scale) &&
      Cartesian3.equalsEpsilon(camera.direction, held.direction, 0, DRIFT) &&
      Cartesian3.equalsEpsilon(camera.up, held.up, 0, DRIFT) &&
      Cartesian3.equalsEpsilon(camera.right, held.right, 0, DRIFT);
    if (drifted) {
      Cartesian3.clone(held.position, camera.position);
      Cartesian3.clone(held.direction, camera.direction);
      Cartesian3.clone(held.up, camera.up);
      Cartesian3.clone(held.right, camera.right);
      return;
    }
    // 真的动了：记下新的相机
    Cartesian3.clone(camera.position, held.position);
    Cartesian3.clone(camera.direction, held.direction);
    Cartesian3.clone(camera.up, held.up);
    Cartesian3.clone(camera.right, held.right);
    Matrix4.clone(camera.transform, held.transform);
  });
}
