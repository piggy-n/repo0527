import { createNanoEvents } from 'nanoevents';
import type { Unsubscribe } from '../events';

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
  readonly #emitter = createNanoEvents<CameraModelEvents>();
  #current: CameraState;
  #intentRevision = 0;
  #disposed = false;

  constructor(initial: CameraState) {
    this.#current = snapshot(initial);
  }

  get current(): CameraState {
    return this.#current;
  }

  /** 用户操作或程序定位造成的变化次数，同步不计；三维据此判断能否还原离开时的精确视角 */
  get intentRevision(): number {
    return this.#intentRevision;
  }

  /** 写入相机并同步通知；数值都没变时不通知 */
  set(state: CameraState, { view, cause }: { view: ViewKind; cause: CameraCause }): void {
    this.#assertAlive();
    const next = snapshot(state);
    if (isSameCamera(next, this.#current)) {
      return;
    }
    this.#current = next;
    if (cause !== 'sync') {
      this.#intentRevision++;
    }
    this.#emitter.emit('change', { state: next, view, cause });
  }

  on<E extends keyof CameraModelEvents>(event: E, callback: CameraModelEvents[E]): Unsubscribe {
    this.#assertAlive();
    return this.#emitter.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#emitter.events = {};
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new Error('CameraModel 已释放');
    }
  }
}
