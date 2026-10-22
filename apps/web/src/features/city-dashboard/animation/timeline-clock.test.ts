import { afterEach, describe, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { playVisibleTimeline } from './timeline-clock';

afterEach(() => { vi.restoreAllMocks(); });

describe('可见入场时钟', () => {
  it('长帧按可见时长前进，不会将一秒动画拖成长时间等待', () => {
    let next: FrameRequestCallback | undefined;
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { next = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { next = undefined; });
    const target = { value: 0 };
    const done = vi.fn<() => void>();
    const timeline = gsap.timeline({ paused: true, onComplete: done }).to(target, { value: 100, duration: 1, ease: 'none' });
    const clock = playVisibleTimeline(timeline);
    try {
      next?.(800);
      expect(target.value).toBe(80);
      next?.(1600);
      expect(target.value).toBe(100);
      expect(done).toHaveBeenCalledOnce();
    } finally { clock[Symbol.dispose](); timeline.kill(); }
  });

  it('隐藏时间不计入进度，销毁后不再恢复', () => {
    let next: FrameRequestCallback | undefined;
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { next = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { next = undefined; });
    const target = { value: 0 };
    const timeline = gsap.timeline({ paused: true }).to(target, { value: 100, duration: 1, ease: 'none' });
    const clock = playVisibleTimeline(timeline);
    try {
      next?.(200);
      hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
      expect(next).toBeUndefined();
      now.mockReturnValue(10000);
      hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
      next?.(10200);
      expect(target.value).toBe(40);
      clock[Symbol.dispose]();
      document.dispatchEvent(new Event('visibilitychange'));
      expect(next).toBeUndefined();
    } finally { clock[Symbol.dispose](); timeline.kill(); }
  });
});
