import type { CameraState } from '@mx/map-core';
import type { BenchCamera, BenchStats } from '../bench-api.ts';
import { interpolateCamera } from '../look-sync.ts';

// --look 的页面一侧：跟随别的窗口、用户在这个窗口里操作、按 R 重新稳定，左上角的读数。只读引擎的读数，不改引擎

const READOUT_EVERY_MS = 500;
// 滚轮、键盘没有"松开"：最后一次操作之后这么久内还算用户在操作这个窗口
const DRIVING_GRACE_MS = 300;
// 按 R 时先缩小这么多级再回来：相机离开锁定的姿态（高度的四分之一以上），放宽的下限解开，回来时按"跳到这里"重新判断
const AWAY_ZOOM = 3;

const integer = (value: number) => Math.round(value).toLocaleString('en-US');

/** 相机一行的写法，和 --at 的一样 */
export const cameraText = ({ center, zoom, pitch, bearing }: CameraState): string =>
  `${center[0].toFixed(6)},${center[1].toFixed(6)},${zoom.toFixed(2)},${pitch.toFixed(1)},${bearing.toFixed(1)}`;

/** Node 每一轮读的：相机，是不是在跟随（自己在走），用户是不是在操作这个窗口，按没按 R（读过就清掉） */
export interface LookState {
  readonly camera: BenchCamera;
  readonly following: boolean;
  readonly driving: boolean;
  readonly resettle: boolean;
}

const nextFrame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

/**
 * 一个 --look 窗口：跟随时每一帧按插值设一次相机，和测量的飞行一样，引擎看到的是连续的移动，不是瞬移加停下。
 * 用户一按下就停止跟随，操作期间不接受跟随，拖动不会被下一帧的跟随取消
 */
export class LookControl {
  readonly #current: () => BenchCamera;
  readonly #setCamera: (camera: BenchCamera) => void;
  #frame = 0;
  #following = false;
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
      if (event.key === 'r' || event.key === 'R') {
        this.#resettle = true;
      } else {
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
    return { camera: this.#current(), following: this.#following, driving: this.driving, resettle };
  }

  /** ms 毫秒内一帧一帧地走到 target；新的一段从当前位置接着走，前一段作废。用户在操作时不跟 */
  followTo(target: BenchCamera, ms: number): void {
    if (this.driving) {
      return;
    }
    this.#stop();
    const from = this.#current();
    const start = performance.now();
    this.#following = true;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      this.#setCamera(interpolateCamera(from, target, t));
      if (t < 1) {
        this.#frame = window.requestAnimationFrame(step);
      } else {
        this.#following = false;
      }
    };
    this.#frame = window.requestAnimationFrame(step);
  }

  /** 先移开再回到现在的相机：放宽的下限解开，按"跳到这里"重新稳定。几个窗口一起做，比较才公平 */
  async resettle(): Promise<void> {
    this.#stop();
    const back = this.#current();
    this.#following = true;
    this.#setCamera({ ...back, zoom: Math.max(0, back.zoom - AWAY_ZOOM) });
    await nextFrame();
    await nextFrame();
    this.#setCamera(back);
    await nextFrame();
    this.#following = false;
  }

  #stop(): void {
    window.cancelAnimationFrame(this.#frame);
    this.#following = false;
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
