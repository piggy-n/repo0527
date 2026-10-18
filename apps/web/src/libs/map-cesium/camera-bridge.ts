import type { CameraCause, CameraModel, CameraState } from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';

/** 相机桥接只依赖窄接口；精确姿态由 Cesium 适配器持有 */
export interface CameraPort<Pose> {
  read(): CameraState | null;
  apply(state: CameraState): void;
  capture(): Pose;
  restore(pose: Pose): void;
  equals(left: Pose, right: Pose): boolean;
}

/** 同一相机模型的三维桥接：显式标记写入、暂停期间不追随、按 cause 决定恢复方式 */
export class CesiumCameraBridge<Pose> implements Disposable {
  readonly #camera: CameraModel;
  readonly #port: CameraPort<Pose>;
  readonly #unsubscribe: () => void;
  readonly #report: (error: unknown) => void;
  #active = false;
  #disposed = false;
  #publishing = false;
  // 最后一次自己应用或已经观察到的姿态，用于排除下一帧迟到的回声
  #last: Pose | undefined;
  #saved: Pose | undefined;
  #canRestore = false;

  constructor(camera: CameraModel, port: CameraPort<Pose>, onError: (error: unknown) => void = console.error) {
    this.#camera = camera;
    this.#port = port;
    this.#report = safeReporter(onError, 'CesiumCameraBridge');
    this.#unsubscribe = camera.on('change', change => {
      if (this.#disposed || this.#publishing) {
        return;
      }
      if (!this.#active) {
        if (change.cause !== 'sync') {
          this.#canRestore = false;
        }
        return;
      }
      this.#guard(() => this.#apply(change.state));
    });
  }

  /** 用户开始拖动或缩放时作废尚未完成的定位操作，不依靠相机值猜测意图 */
  beginUserOperation(): void {
    if (this.#active && !this.#disposed) {
      this.#guard(() => { this.#camera.beginOperation(); });
    }
  }

  /** 每轮渲染后读取真实姿态；同步写入的迟到事件不会被归为用户操作 */
  update(cause: CameraCause = 'user'): void {
    if (!this.#active || this.#disposed) {
      return;
    }
    this.#guard(() => {
      const pose = this.#port.capture();
      if (this.#last !== undefined && this.#port.equals(this.#last, pose)) {
        return;
      }
      this.#last = pose;
      this.#publish(cause);
    });
  }

  /** 程序定位直接到达终点；先登记姿态，再按 program 写回，避免下一帧被认作用户操作 */
  move(pose: Pose): void {
    if (this.#active && !this.#disposed) {
      this.#guard(() => {
        this.#port.restore(pose);
        this.#last = this.#port.capture();
        this.#publish('program');
      });
    }
  }

  /** 视口改变了像素尺度，保持精确姿态并按同步原因更新共享相机 */
  viewportChanged(): void {
    if (this.#active && !this.#disposed) {
      this.#guard(() => {
        this.#last = this.#port.capture();
        this.#publish('sync');
      });
    }
  }

  /** 暂停前收下最后一帧操作，保存三维专有的精确姿态 */
  pause(): void {
    if (!this.#active || this.#disposed) {
      return;
    }
    this.update();
    if (!this.#active) {
      return;
    }
    this.#guard(() => {
      this.#saved = this.#port.capture();
      this.#canRestore = true;
      this.#active = false;
    });
  }

  /** 容器尺寸由拥有者先恢复；隐藏期间发生过实际定位时使用最新会话 */
  resume(): void {
    if (this.#active || this.#disposed) {
      return;
    }
    this.#guard(() => {
      this.#active = true;
      if (this.#canRestore && this.#saved !== undefined) {
        this.#port.restore(this.#saved);
        this.#last = this.#port.capture();
        this.#publish('sync');
      } else {
        this.#apply(this.#camera.current);
      }
    });
  }

  /** 释放时不再写会话，避免卸载改变业务状态 */
  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#active = false;
    this.#unsubscribe();
    this.#last = undefined;
    this.#saved = undefined;
  }

  #apply(state: CameraState): void {
    this.#port.apply(state);
    this.#last = this.#port.capture();
    this.#publish('sync');
  }

  #publish(cause: CameraCause): void {
    const state = this.#port.read();
    // 看向天空时没有共享中心，不用相机下方的位置代替真正的屏幕中心
    if (!state) {
      return;
    }
    this.#publishing = true;
    try {
      this.#camera.set(state, { view: '3d', cause });
    } finally {
      this.#publishing = false;
    }
  }

  #guard(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.#active = false;
      this.#report(error);
    }
  }
}
