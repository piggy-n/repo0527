import type { CameraState } from '@mx/map-core';
import type { BenchCamera, BenchStats } from '../bench-api.ts';
import { interpolateCamera } from '../look-sync.ts';

// --look 的页面一侧：跟随别的窗口、用户在这个窗口里操作、按 R 重新稳定，左上角的读数。只读引擎的读数，不改引擎

const READOUT_EVERY_MS = 500;
// 滚轮、键盘没有"松开"：最后一次操作之后这么久内还算用户在操作这个窗口
const DRIVING_GRACE_MS = 300;
// 按 R 时先缩小这么多级再到要去的相机：相机离开锁定的姿态（高度的四分之一以上），放宽的下限解开，到了以后按"跳到这里"重新判断
const AWAY_ZOOM = 3;

const integer = (value: number) => Math.round(value).toLocaleString('en-US');

/** 相机一行的写法，和 --at 的一样 */
export const cameraText = ({ center, zoom, pitch, bearing }: CameraState): string =>
  `${center[0].toFixed(6)},${center[1].toFixed(6)},${zoom.toFixed(2)},${pitch.toFixed(1)},${bearing.toFixed(1)}`;

/** Node 每一轮读的：相机，是不是在跟随（自己在走），用户是不是在操作这个窗口，按没按 R（读过就清掉） */
export interface LookState {
  readonly camera: BenchCamera;
  /** 这个窗口要去的相机：在跟随、重新稳定时是终点，不然是现在的相机。按 R 时所有窗口都去按 R 的那个窗口的这个相机 */
  readonly heading: BenchCamera;
  readonly following: boolean;
  readonly driving: boolean;
  readonly resettle: boolean;
}

// MapLibre 用键盘移动相机的键（平移、缩放、配合 Shift 转动和俯仰）：只有这些算用户在操作，Shift、Ctrl 这些单按不算
const CAMERA_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', '_', 'PageUp', 'PageDown']);

const nextFrame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

/**
 * 一个 --look 窗口：跟随时每一帧按插值设一次相机，和测量的飞行一样，引擎看到的是连续的移动，不是瞬移加停下。
 * 用户一按下就停止跟随和重新稳定，操作期间两者都不接受，拖动不会被下一帧取消
 */
export class LookControl {
  readonly #current: () => BenchCamera;
  readonly #setCamera: (camera: BenchCamera) => void;
  #frame = 0;
  #following = false;
  // 正在走向的相机（跟随、重新稳定的终点）；没有时为 null
  #heading: BenchCamera | null = null;
  // 代次：新的跟随、重新稳定或用户操作都让进行中的那一次作废，等待中的下一帧回来后不再设相机
  #generation = 0;
  #pointerDown = false;
  #drivenUntil = 0;
  #resettle = false;

  constructor(container: HTMLElement, current: () => BenchCamera, setCamera: (camera: BenchCamera) => void) {
    this.#current = current;
    this.#setCamera = setCamera;
    const drive = () => {
      this.#stop();
      this.#drivenUntil = performance.now() + DRIVING_GRACE_MS;
    };
    container.addEventListener(
      'pointerdown',
      () => {
        this.#pointerDown = true;
        drive();
      },
      { capture: true }
    );
    const release = () => {
      if (this.#pointerDown) {
        this.#pointerDown = false;
        drive();
      }
    };
    window.addEventListener('pointerup', release, { capture: true });
    window.addEventListener('pointercancel', release, { capture: true });
    container.addEventListener('wheel', drive, { capture: true, passive: true });
    window.addEventListener('keydown', event => {
      // 按住不放时系统每隔几十毫秒重复一次按键：只认第一次
      if ((event.key === 'r' || event.key === 'R') && !event.repeat) {
        this.#resettle = true;
      } else if (CAMERA_KEYS.has(event.key)) {
        drive();
      }
    });
  }

  get following(): boolean {
    return this.#following;
  }

  get driving(): boolean {
    return this.#pointerDown || performance.now() < this.#drivenUntil;
  }

  state(): LookState {
    const resettle = this.#resettle;
    this.#resettle = false;
    const camera = this.#current();
    return { camera, heading: this.#heading ?? camera, following: this.#following, driving: this.driving, resettle };
  }

  /** ms 毫秒内一帧一帧地走到 target；新的一段从当前位置接着走，前一段作废。用户在操作时不跟 */
  followTo(target: BenchCamera, ms: number): void {
    if (this.driving) {
      return;
    }
    const generation = this.#begin(target);
    const from = this.#current();
    const start = performance.now();
    const step = () => {
      if (generation !== this.#generation) {
        return;
      }
      const t = Math.min(1, (performance.now() - start) / ms);
      this.#setCamera(interpolateCamera(from, target, t));
      if (t < 1) {
        this.#frame = window.requestAnimationFrame(step);
      } else {
        this.#finish(generation);
      }
    };
    this.#frame = window.requestAnimationFrame(step);
  }

  /**
   * 在 target 重新稳定：先移开再到 target，放宽的下限解开，按"跳到这里"重新判断。所有窗口用同一个 target 一起做，
   * 比较才公平。用户在操作的窗口不做；中途用户一操作、又来一次跟随或重新稳定，这一次就作废，不再设相机
   */
  async resettle(target: BenchCamera): Promise<void> {
    if (this.driving) {
      return;
    }
    const generation = this.#begin(target);
    this.#setCamera({ ...target, zoom: Math.max(0, target.zoom - AWAY_ZOOM) });
    await nextFrame();
    await nextFrame();
    if (generation !== this.#generation) {
      return;
    }
    this.#setCamera(target);
    await nextFrame();
    this.#finish(generation);
  }

  // 开始新的一次（跟随或重新稳定）：上一次作废，返回这一次的代次
  #begin(target: BenchCamera): number {
    this.#stop();
    this.#following = true;
    this.#heading = target;
    return this.#generation;
  }

  #finish(generation: number): void {
    if (generation === this.#generation) {
      this.#following = false;
      this.#heading = null;
    }
  }

  #stop(): void {
    window.cancelAnimationFrame(this.#frame);
    this.#generation++;
    this.#following = false;
    this.#heading = null;
  }
}

function readoutLines(label: string, stats: BenchStats, camera: CameraState, control: LookControl): string[] {
  const { detail, budget } = stats;
  const window = budget.cullWindow === null ? '动着也请求' : `${budget.cullWindow.toFixed(2)} 秒`;
  const motion = control.driving ? '你在操作这个窗口' : control.following ? '在追别的窗口' : '停着';
  return [
    label,
    `屏幕误差 ${stats.errorTarget.toFixed(1)}，${stats.locked ? '锁在这个姿态' : '没锁'}；${motion}`,
    `需求 ${integer(budget.demandMB)} / 上限 ${integer(budget.limitMB)} MB，缓存 ${integer(stats.cacheMB)} MB`,
    `显示的瓦片：够细 ${detail.sharp}，放宽了才停在这一级 ${detail.relaxed}，等更细的 ${detail.waiting}，已是最细 ${detail.finest}` +
      (detail.additive > 0 ? `，ADD 的 ${detail.additive} 块不分` : ''),
    `放宽的帧：装满 ${budget.raisedFull}，估计 ${budget.raisedPredicted}；被拒绝 ${stats.refused}`,
    `加载中 ${stats.loading}，没请求 ${stats.queues.culled}，窗口 ${window}`,
    `相机 ${cameraText(camera)}`,
    '按 R：所有窗口在这个视角重新稳定（比较之前按一次）'
  ];
}

/** 每半秒更新一次读数；引擎还没就绪时显示原因 */
export function showReadout(label: string, stats: () => BenchStats, camera: () => CameraState, control: LookControl): void {
  const box = document.body.appendChild(document.createElement('pre'));
  // 测量工具自己的页面，不走应用的样式和令牌；可以选中、复制相机一行
  box.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:8px 10px;font:13px/1.5 Consolas,"Microsoft YaHei",monospace;' +
    'color:#f2f2f2;background:rgba(0,0,0,0.65);border-radius:4px;user-select:text;z-index:10;white-space:pre';
  const update = () => {
    try {
      box.textContent = readoutLines(label, stats(), camera(), control).join('\n');
    } catch (error) {
      box.textContent = `${label}\n${String(error)}`;
    }
  };
  update();
  setInterval(update, READOUT_EVERY_MS);
}
