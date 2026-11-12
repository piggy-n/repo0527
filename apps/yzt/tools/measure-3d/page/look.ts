import type { CameraState } from '@mx/map-core';
import type { BenchCamera, BenchStats } from '../bench-api.ts';
import { interpolateCamera } from '../look-sync.ts';

// --look 窗口左上角的读数：哪一条让画面停在粗的一级，就看这里。只读引擎的读数，不改引擎

const READOUT_EVERY_MS = 500;

const integer = (value: number) => Math.round(value).toLocaleString('en-US');

/** 相机一行的写法，和 --at 的一样 */
export const cameraText = ({ center, zoom, pitch, bearing }: CameraState): string =>
  `${center[0].toFixed(6)},${center[1].toFixed(6)},${zoom.toFixed(2)},${pitch.toFixed(1)},${bearing.toFixed(1)}`;

function readoutLines(label: string, stats: BenchStats, camera: CameraState): string[] {
  const { detail, budget } = stats;
  const window = budget.cullWindow === null ? '动着也请求' : `${budget.cullWindow.toFixed(2)} 秒`;
  return [
    label,
    `屏幕误差 ${stats.errorTarget.toFixed(1)}，${stats.locked ? '锁在这个姿态' : '没锁'}`,
    `需求 ${integer(budget.demandMB)} / 上限 ${integer(budget.limitMB)} MB，缓存 ${integer(stats.cacheMB)} MB`,
    `显示的瓦片：够细 ${detail.sharp}，放宽了才停在这一级 ${detail.relaxed}，等更细的 ${detail.waiting}，已是最细 ${detail.finest}` +
      (detail.additive > 0 ? `，ADD 的 ${detail.additive} 块不分` : ''),
    `放宽的帧：装满 ${budget.raisedFull}，估计 ${budget.raisedPredicted}；被拒绝 ${stats.refused}`,
    `加载中 ${stats.loading}，没请求 ${stats.queues.culled}，窗口 ${window}`,
    `相机 ${cameraText(camera)}`
  ];
}

/**
 * 跟随窗口：每一帧按插值设一次相机，ms 毫秒走到 target；新的一段从当前位置接着走，前一段作废。
 * 和测量的飞行一样一帧一帧地走，引擎看到的是连续的移动，不是瞬移加停下
 */
export function createFollower(current: () => BenchCamera, setCamera: (camera: BenchCamera) => void): (target: BenchCamera, ms: number) => void {
  let frame = 0;
  return (target, ms) => {
    window.cancelAnimationFrame(frame);
    const from = current();
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      setCamera(interpolateCamera(from, target, t));
      if (t < 1) {
        frame = window.requestAnimationFrame(step);
      }
    };
    frame = window.requestAnimationFrame(step);
  };
}

/** 每半秒更新一次读数；引擎还没就绪时显示原因 */
export function showReadout(label: string, stats: () => BenchStats, camera: () => CameraState): void {
  const box = document.body.appendChild(document.createElement('pre'));
  // 测量工具自己的页面，不走应用的样式和令牌；可以选中、复制相机一行
  box.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:8px 10px;font:13px/1.5 Consolas,"Microsoft YaHei",monospace;' +
    'color:#f2f2f2;background:rgba(0,0,0,0.65);border-radius:4px;user-select:text;z-index:10;white-space:pre';
  const update = () => {
    try {
      box.textContent = readoutLines(label, stats(), camera()).join('\n');
    } catch (error) {
      box.textContent = `${label}\n${String(error)}`;
    }
  };
  update();
  setInterval(update, READOUT_EVERY_MS);
}
