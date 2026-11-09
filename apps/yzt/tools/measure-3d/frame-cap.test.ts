// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FrameCap } from './frame-cap.ts';

// 每 stepMs 问一次，跑 durationMs：放行了哪些时刻
function run(cap: FrameCap, stepMs: number, durationMs: number): number[] {
  const passed: number[] = [];
  for (let now = 1000; now < 1000 + durationMs; now += stepMs) {
    if (cap.ready(now)) {
      passed.push(now);
    }
  }
  return passed;
}

describe('FrameCap', () => {
  it('不封顶时都放行', () => {
    expect(run(new FrameCap(null), 3, 30)).toHaveLength(10);
  });

  it('封顶时平均是这个帧率：问得不准时也不偏', () => {
    const passed = run(new FrameCap(60), 3, 6000);
    expect(passed.length).toBeGreaterThan(355);
    expect(passed.length).toBeLessThan(362);
  });

  it('相邻两帧不会很短：Cesium 按一帧走的路判断要不要请求，短帧会把瓦片放行', () => {
    // 第一帧之后的那一帧算"卡了一下"，单独有用例
    const passed = run(new FrameCap(60), 3, 3000).slice(1);
    const intervals = passed.slice(1).map((time, index) => time - (passed[index] ?? 0));
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...intervals)).toBeLessThanOrEqual(18);
  });

  it('卡了一下以后不连续补帧：只有一帧缩短，不短于一半', () => {
    const cap = new FrameCap(60);
    expect(cap.ready(1000)).toBe(true);
    // 卡了 200 毫秒
    expect(cap.ready(1200)).toBe(true);
    expect(cap.ready(1203)).toBe(false);
    expect(cap.ready(1209)).toBe(true);
    expect(cap.ready(1212)).toBe(false);
    expect(cap.ready(1224)).toBe(false);
    expect(cap.ready(1226)).toBe(true);
  });
});
