import { type RoutePath, type RoutePose, smoothAngle } from '../../scene/route-path';
import { eyeOf, type RoamEye } from './roam-camera';
import type { RoamHost } from './roam-host';

// 室内要比二维（约 37°）宽得多的竖直视场角
const ROAM_FOVY = (60 * Math.PI) / 180;
// 朝向、俯仰向路线方向靠近的时间常数；暂停时转头的偏移在继续后回正的时间常数（约 0.6 秒回正）
const SMOOTHING = 0.4;
const LOOK_RETURN = 0.2;
// 一帧最多按这么多秒推进：页面停用、卡顿回来不跳一大段
const MAX_FRAME = 0.1;
// 转头最快每秒多少度；朝向比路线的方向偏 SLOW_FROM 度以上开始放慢，再偏 SLOW_RANGE 度时只按 MIN_PACE 的速度走：
// 掉头、急弯处先转过来再走，不原地甩头（ADR 0156 R.5）
const MAX_TURN_RATE = 60;
const SLOW_FROM = 15;
const SLOW_RANGE = 30;
const MIN_PACE = 0.15;

// 从 from 转到 to 最近的角度差（度，-180～180）
const angleTo = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;
// 暂停时拖动转头：每像素多少度，俯仰的范围
const LOOK_SENSITIVITY = 0.2;
const MAX_LOOK_PITCH = 60;

/** 路线漫游的播放（ADR 0083 第 3 节）：speed 是米/秒（ADR 0097 第 4 节） */
export interface RoutePlayback {
  readonly playing: boolean;
  readonly speed: number;
}

export interface RouteRoamerEvents {
  readonly progress: (distance: number) => void;
  readonly end: () => void;
}

/**
 * 路线漫游的相机（ADR 0083 第 3 节）：放到起点以后，播放时每帧按真实流逝的时间推进，
 * 朝向看前方并平滑，转头限速、转弯时放慢（ADR 0156 R.5）；暂停时左键拖动原地转头，继续后转回路线的朝向。
 * 进出、抬高和黑幕由 MapLibreRoam 负责
 */
export class RouteRoamer implements Disposable {
  readonly #host: RoamHost;
  readonly #events: RouteRoamerEvents;
  readonly #stack = new DisposableStack();
  #path: RoutePath | null = null;
  // 放到起点以后才推进
  #placed = false;
  #distance = 0;
  #playing = false;
  // 米/秒，开始时由 MapLibreRoam 设
  #speed = 1;
  #last: number | null = null;
  // 相机现在的朝向和俯仰（度），暂停时转头的偏移
  #heading = 0;
  #pitch = 0;
  #lookHeading = 0;
  #lookPitch = 0;
  #drag: { readonly x: number; readonly y: number } | null = null;
  #eye: RoamEye | null = null;

  constructor(host: RoamHost, events: RouteRoamerEvents) {
    this.#host = host;
    this.#events = events;
    const down = (event: PointerEvent) => this.#onPointerDown(event);
    const move = (event: PointerEvent) => this.#onPointerMove(event);
    const up = () => {
      this.#drag = null;
    };
    host.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.#stack.defer(() => {
      host.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
  }

  get active(): boolean {
    return this.#path !== null;
  }

  /** 最后设给相机的视点；还没放到起点时为 null */
  get eye(): RoamEye | null {
    return this.#eye;
  }

  /** 起点的视点：放过去之前用来算要不要闪切 */
  get startEye(): RoamEye | null {
    return this.#path ? eyeOf(this.#path.pose(0)) : null;
  }

  /** 开始一条路线：之前的一并结束；place 之前不动相机 */
  start(path: RoutePath): void {
    this.#path = path;
    this.#placed = false;
    this.#distance = 0;
    this.#playing = false;
    this.#last = null;
    this.#drag = null;
    this.#eye = null;
    this.#resetLook(path.pose(0));
  }

  /** 放到起点（MapLibreRoam 在黑幕下、或者近处直接调用） */
  place(): void {
    const path = this.#path;
    if (!path) {
      return;
    }
    this.#placed = true;
    this.#last = null;
    this.#apply(path.pose(this.#distance));
    this.#host.requestFrame();
  }

  restart(): void {
    const path = this.#path;
    if (!path) {
      return;
    }
    this.#distance = 0;
    this.#last = null;
    this.#resetLook(path.pose(0));
    if (this.#placed) {
      this.#apply(path.pose(0));
    }
    this.#events.progress(0);
  }

  setPlayback({ playing, speed }: RoutePlayback): void {
    this.#speed = speed;
    if (playing !== this.#playing) {
      this.#playing = playing && this.#path !== null && this.#distance < this.#path.total;
      this.#last = null;
      this.#drag = null;
    }
    this.#host.requestFrame();
  }

  /** 停下：不动相机 */
  stop(): void {
    this.#path = null;
    this.#placed = false;
    this.#playing = false;
    this.#drag = null;
    this.#eye = null;
  }

  /** 每帧：播放时推进（朝向还没转过来时放慢），朝向平滑、限速地转向路线的方向；暂停时停在原处，只按转头的偏移 */
  tick(now: number): void {
    const path = this.#path;
    if (!path || !this.#placed) {
      return;
    }
    const dt = this.#last === null ? 0 : Math.min((now - this.#last) / 1000, MAX_FRAME);
    this.#last = now;
    if (this.#playing) {
      const behind = Math.abs(angleTo(this.#heading, path.pose(this.#distance).heading));
      const pace = Math.max(MIN_PACE, Math.min(1, 1 - (behind - SLOW_FROM) / SLOW_RANGE));
      this.#distance = Math.min(path.total, this.#distance + dt * this.#speed * pace);
      this.#events.progress(this.#distance);
      if (this.#distance >= path.total) {
        this.#playing = false;
        this.#events.end();
      }
    }
    // 结束事件里可能已经撤掉了这条路线
    if (this.#path !== path) {
      return;
    }
    const pose = path.pose(this.#distance);
    const turn = angleTo(this.#heading, smoothAngle(this.#heading, pose.heading, dt, SMOOTHING));
    const limit = MAX_TURN_RATE * dt;
    this.#heading = (this.#heading + Math.max(-limit, Math.min(limit, turn)) + 360) % 360;
    this.#pitch += (pose.pitch - this.#pitch) * (1 - Math.exp(-dt / SMOOTHING));
    const returning = this.#playing && (Math.abs(this.#lookHeading) > 0.05 || Math.abs(this.#lookPitch) > 0.05);
    if (this.#playing) {
      const keep = Math.exp(-dt / LOOK_RETURN);
      this.#lookHeading *= keep;
      this.#lookPitch *= keep;
    }
    this.#apply(pose);
    const turning = Math.abs(angleTo(this.#heading, pose.heading)) > 0.05;
    if (this.#playing || returning || turning) {
      this.#host.requestFrame();
    } else {
      // 停下来以后，下一次动起来从 0 开始算时间
      this.#last = null;
    }
  }

  [Symbol.dispose](): void {
    this.stop();
    this.#stack.dispose();
  }

  #resetLook(pose: RoutePose): void {
    this.#heading = pose.heading;
    this.#pitch = pose.pitch;
    this.#lookHeading = 0;
    this.#lookPitch = 0;
  }

  #apply(pose: RoutePose): void {
    const eye = eyeOf({
      lng: pose.lng,
      lat: pose.lat,
      height: pose.height,
      heading: this.#heading + this.#lookHeading,
      pitch: Math.max(-89, Math.min(89, this.#pitch + this.#lookPitch))
    });
    this.#eye = eye;
    this.#host.setEye(eye, ROAM_FOVY);
  }

  // 暂停时左键拖动：原地转头
  #onPointerDown(event: PointerEvent): void {
    if (this.#path && this.#placed && !this.#playing && event.button === 0) {
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
    this.#host.requestFrame();
  }
}
