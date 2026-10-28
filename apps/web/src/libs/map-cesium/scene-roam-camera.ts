import { Cartesian3, type CesiumWidget } from 'cesium';

// 结束漫游时飞回开始前的位置的秒数
const BACK_FLIGHT = 1.2;

/** 开始漫游前的相机和相机控制：结束时还原；路线和步行之间换手时交给下一个（ADR 0083 第 3 节、ADR 0086 第 3 节） */
export interface RoamSaved {
  readonly position: Cartesian3;
  readonly direction: Cartesian3;
  readonly up: Cartesian3;
  readonly inputs: boolean;
}

/** 接管相机：记下当前的相机（换手时沿用上一个记下的），关掉 Cesium 自己的拖动、缩放 */
export function takeOverCamera(widget: CesiumWidget, inherited: RoamSaved | null): RoamSaved {
  const { camera, scene } = widget;
  const saved = inherited ?? {
    position: Cartesian3.clone(camera.positionWC),
    direction: Cartesian3.clone(camera.directionWC),
    up: Cartesian3.clone(camera.upWC),
    inputs: scene.screenSpaceCameraController.enableInputs
  };
  scene.screenSpaceCameraController.enableInputs = false;
  return saved;
}

/**
 * 漫游期间每帧调用：Cesium 的 flyTo 结束、取消时会在回调之后把相机控制重新打开（CameraFlightPath 的 wrapCallback），
 * 飞到起点、闪切之后都会这样，所以逐帧关掉
 */
export function keepInputsOff(widget: CesiumWidget): void {
  const controller = widget.scene.screenSpaceCameraController;
  if (controller.enableInputs) {
    controller.enableInputs = false;
  }
}

/** 交还相机：恢复相机控制，停下进行中的飞行；back 为 true 时飞回开始前的位置 */
export function releaseCamera(widget: CesiumWidget, saved: RoamSaved, back: boolean): void {
  const { camera, scene } = widget;
  camera.cancelFlight();
  scene.screenSpaceCameraController.enableInputs = saved.inputs;
  if (back) {
    camera.flyTo({
      destination: saved.position,
      orientation: { direction: saved.direction, up: saved.up },
      duration: BACK_FLIGHT
    });
  }
  scene.requestRender();
}
