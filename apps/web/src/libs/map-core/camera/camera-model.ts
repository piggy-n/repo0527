import type { Unsubscribe } from '../events';
import { ModelEvents } from '../model-events';

/** 相机变化发生在哪个视图 */
export type ViewKind = '2d' | '3d';

/** 相机变化的原因：用户操作、程序定位、从另一个视图同步（ADR 0024） */
export type CameraCause = 'user' | 'program' | 'sync';

/** 二三维共用的相机：`center` 为 [经度, 纬度]，角度的单位是度 */
export interface CameraState {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export interface CameraChange {
  readonly state: CameraState;
  readonly view: ViewKind;
  readonly cause: CameraCause;
}

interface CameraModelEvents {
  change: (change: CameraChange) => void;
}

// 复制并冻结：调用方和监听器都改不到会话里的相机；NaN 写进地图会悄悄扩散，在入口拦住
function snapshot({ center: [lng, lat], zoom, bearing, pitch }: CameraState): CameraState {
  for (const [name, value] of Object.entries({ lng, lat, zoom, bearing, pitch })) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`相机的 ${name} 不是有限数：${value}`);
    }
  }
  if (lat < -90 || lat > 90) {
    throw new RangeError(`纬度超出范围：${lat}`);
  }
  return Object.freeze({ center: Object.freeze<readonly [number, number]>([lng, lat]), zoom, bearing, pitch });
}

function isSameCamera(a: CameraState, b: CameraState): boolean {
  return (
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    a.zoom === b.zoom &&
    a.bearing === b.bearing &&
    a.pitch === b.pitch
  );
}

/** 二三维共用的相机状态；范围收敛（如俯角上限）由各视图应用时处理（ADR 0024） */
export class CameraModel implements Disposable {
  readonly #events = new ModelEvents<CameraModelEvents>('CameraModel');
  #current: CameraState;
  // 当前这次相机操作，开始下一次时中止（ADR 0038）
  #operation = new AbortController();

  constructor(initial: CameraState) {
    this.#current = snapshot(initial);
  }

  get current(): CameraState {
    return this.#current;
  }

  /** 当前这次相机操作的信号：开始下一次操作、相机释放时中止（ADR 0038） */
  get operation(): AbortSignal {
    return this.#operation.signal;
  }

  /**
   * 开始一次新的相机操作：中止上一次的信号，返回这一次的（ADR 0038）。
   * 用户开始拖动或缩放、用户发起的定位（区划、默认视角、坐标）各是一次操作，动画的每一帧和视图之间的同步不是
   */
  beginOperation(): AbortSignal {
    this.#events.assertAlive();
    this.#operation.abort(new DOMException('有新的相机操作', 'AbortError'));
    this.#operation = new AbortController();
    return this.#operation.signal;
  }

  /** 写入相机并同步通知；数值都没变时不通知 */
  set(state: CameraState, { view, cause }: { view: ViewKind; cause: CameraCause }): void {
    this.#events.assertAlive();
    const next = snapshot(state);
    if (isSameCamera(next, this.#current)) {
      return;
    }
    this.#current = next;
    this.#events.emit('change', { state: next, view, cause });
  }

  on<E extends keyof CameraModelEvents>(event: E, callback: CameraModelEvents[E]): Unsubscribe {
    return this.#events.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#operation.abort(new DOMException('CameraModel 已释放', 'AbortError'));
    this.#events[Symbol.dispose]();
  }
}
