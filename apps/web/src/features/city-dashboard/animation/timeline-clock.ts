import type { gsap as Gsap } from 'gsap';

/** 按可见时长驱动有限入场，低帧率下不受全局 ticker 的补帧平滑拖长；不改 GSAP 全局配置 */
export function playVisibleTimeline(timeline: ReturnType<typeof Gsap.timeline>): Disposable {
  let frame: number | undefined;
  let elapsed = 0;
  let previous = performance.now();
  let disposed = false;
  timeline.pause();

  function dispose(): void {
    disposed = true;
    if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
    document.removeEventListener('visibilitychange', visibilityChanged);
  }

  function tick(now: number): void {
    frame = undefined;
    if (disposed || document.hidden) { return; }
    elapsed += Math.max(0, now - previous); previous = now;
    const duration = timeline.totalDuration();
    timeline.totalTime(Math.min(duration, elapsed / 1000), false);
    if (elapsed / 1000 >= duration) { dispose(); }
    else if (!disposed) { frame = requestAnimationFrame(tick); }
  }

  function visibilityChanged(): void {
    if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
    if (!document.hidden && !disposed) {
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  return { [Symbol.dispose]: dispose };
}
