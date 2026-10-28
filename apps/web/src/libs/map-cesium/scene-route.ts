import { type RoutePath, type RoutePose, smoothAngle } from '@yzt/map-core';
import { Cartesian3, Math as CesiumMath, type CesiumWidget } from 'cesium';
import type { RoutePlayback } from './scene-like';
import { keepInputsOff, releaseCamera, type RoamSaved, takeOverCamera } from './scene-roam-camera';

// 室内需要比二维对齐时（约 37°）宽得多的竖直视场角
const ROAM_FOVY = CesiumMath.toRadians(60);
// 朝向、俯仰向路线方向靠近的时间常数；暂停时转头的偏移在继续后回正的时间常数（约 0.6 秒回正）
const SMOOTHING = 0.4;
const LOOK_RETURN = 0.2;
// 一帧最多按这么多秒推进：页面停用、卡顿回来不跳一大段
const MAX_FRAME = 0.1;
// 暂停时拖动转头：每像素多少度，俯仰的范围
const LOOK_SENSITIVITY = 0.2;
const MAX_LOOK_PITCH = 60;
// 飞到起点的秒数
const START_FLIGHT = 1.5;

export interface SceneRouteEvents {
  readonly progress: (distance: number) => void;
  readonly end: () => void;
  /** 换竖直视场角（弧度）；null 换回场景默认的 */
  readonly setFovy: (fovy: number | null) => void;
}

/**
 * 路线漫游的相机（ADR 0083 第 3 节）：开始时飞到起点停住；播放时每帧按真实流逝的时间推进，朝向看前方并平滑；
 * 暂停时左键拖动原地转头，继续后转回路线的朝向；结束时还原视场角、相机控制，可以飞回开始前的位置
 */
export class SceneRoute implements Disposable {
  readonly #widget: CesiumWidget;
  readonly #events: SceneRouteEvents;
  readonly #stack = new DisposableStack();
  #path: RoutePath | null = null;
  #saved: RoamSaved | null = null;
  #distance = 0;
  #playing = false;
  // 米/秒，开始时由视图设
  #speed = 1;
  #flying = false;
  #last: number | null = null;
  // 相机现在的朝向和俯仰（度），暂停时转头的偏移
  #heading = 0;
  #pitch = 0;
  #lookHeading = 0;
  #lookPitch = 0;
  #drag: { readonly x: number; readonly y: number } | null = null;

  constructor(widget: CesiumWidget, events: SceneRouteEvents) {
    this.#widget = widget;
    this.#events = events;
    const { scene, canvas } = widget;
    this.#stack.defer(scene.preRender.addEventListener(() => this.#tick()));
    const down = (event: PointerEvent) => this.#onPointerDown(event);
    const move = (event: PointerEvent) => this.#onPointerMove(event);
    const up = () => {
      this.#drag = null;
    };
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.#stack.defer(() => {
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
  }

  get active(): boolean {
    return this.#path !== null;
  }

  /** 开始一条路线：之前的路线一并结束；inherited 是步行换手过来时它记下的相机 */
  start(path: RoutePath, inherited: RoamSaved | null = null): void {
    const { camera } = this.#widget;
    this.#saved = takeOverCamera(this.#widget, this.#saved ?? inherited);
    this.#events.setFovy(ROAM_FOVY);
    this.#path = path;
    this.#distance = 0;
    this.#playing = false;
    this.#last = null;
    this.#resetLook(path.pose(0));
    const pose = path.pose(0);
    this.#flying = true;
    camera.flyTo({
      destination: Cartesian3.fromDegrees(pose.lng, pose.lat, pose.height),
      orientation: { heading: CesiumMath.toRadians(pose.heading), pitch: CesiumMath.toRadians(pose.pitch), roll: 0 },
      duration: START_FLIGHT,
      complete: () => this.#landed(),
      cancel: () => this.#landed()
    });
  }

  restart(): void {
    const path = this.#path;
    if (!path) {
      return;
    }
    this.#widget.camera.cancelFlight();
    this.#flying = false;
    this.#distance = 0;
    this.#last = null;
    this.#resetLook(path.pose(0));
    this.#apply(path.pose(0));
    this.#events.progress(0);
  }

  setPlayback({ playing, speed }: RoutePlayback): void {
    this.#speed = speed;
    if (playing !== this.#playing) {
      this.#playing = playing && this.#path !== null && this.#distance < this.#path.total;
      this.#last = null;
      this.#drag = null;
    }
    this.#widget.scene.requestRender();
  }

  stop(back: boolean): void {
    const saved = this.handOff();
    if (saved) {
      this.#events.setFovy(null);
      releaseCamera(this.#widget, saved, back);
    }
  }

  /** 交给步行：停下路线，不还原相机，给出开始路线前记下的相机；没有在漫游时为 null */
  handOff(): RoamSaved | null {
    const saved = this.#saved;
    this.#path = null;
    this.#saved = null;
    this.#playing = false;
    this.#flying = false;
    this.#drag = null;
    return saved;
  }

  [Symbol.dispose](): void {
    this.#stack.dispose();
  }

  #landed(): void {
    this.#flying = false;
    this.#last = null;
    this.#widget.scene.requestRender();
  }

  #resetLook(pose: RoutePose): void {
    this.#heading = pose.heading;
    this.#pitch = pose.pitch;
    this.#lookHeading = 0;
    this.#lookPitch = 0;
  }

  // 每帧：播放时推进，朝向平滑地转向路线的方向；暂停时停在原处，只按转头的偏移
  #tick(): void {
    const path = this.#path;
    if (!path || this.#flying) {
      return;
    }
    keepInputsOff(this.#widget);
    const now = performance.now();
    const dt = this.#last === null ? 0 : Math.min((now - this.#last) / 1000, MAX_FRAME);
    this.#last = now;
    if (this.#playing) {
      this.#distance = Math.min(path.total, this.#distance + dt * this.#speed);
      this.#events.progress(this.#distance);
      if (this.#distance >= path.total) {
        this.#playing = false;
        this.#events.end();
      }
    }
    const pose = path.pose(this.#distance);
    this.#heading = smoothAngle(this.#heading, pose.heading, dt, SMOOTHING);
    this.#pitch += (pose.pitch - this.#pitch) * (1 - Math.exp(-dt / SMOOTHING));
    const returning = this.#playing && (Math.abs(this.#lookHeading) > 0.05 || Math.abs(this.#lookPitch) > 0.05);
    if (this.#playing) {
      const keep = Math.exp(-dt / LOOK_RETURN);
      this.#lookHeading *= keep;
      this.#lookPitch *= keep;
    }
    this.#apply(pose);
    const turning = Math.abs(((((pose.heading - this.#heading) % 360) + 540) % 360) - 180) > 0.05;
    if (this.#playing || returning || turning) {
      this.#widget.scene.requestRender();
    }
  }

  #apply(pose: RoutePose): void {
    this.#widget.camera.setView({
      destination: Cartesian3.fromDegrees(pose.lng, pose.lat, pose.height),
      orientation: {
        heading: CesiumMath.toRadians(this.#heading + this.#lookHeading),
        pitch: CesiumMath.toRadians(Math.max(-89, Math.min(89, this.#pitch + this.#lookPitch))),
        roll: 0
      }
    });
  }

  // 暂停时左键拖动：原地转头
  #onPointerDown(event: PointerEvent): void {
    if (this.#path && !this.#playing && !this.#flying && event.button === 0) {
      this.#drag = { x: event.clientX, y: event.clientY };
    }
  }

  #onPointerMove(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || !this.#path || this.#playing) {
      return;
    }
    this.#lookHeading -= (event.clientX - drag.x) * LOOK_SENSITIVITY;
    this.#lookPitch = Math.max(
      -MAX_LOOK_PITCH,
      Math.min(MAX_LOOK_PITCH, this.#lookPitch + (event.clientY - drag.y) * LOOK_SENSITIVITY)
    );
    this.#drag = { x: event.clientX, y: event.clientY };
    this.#widget.scene.requestRender();
  }
}
