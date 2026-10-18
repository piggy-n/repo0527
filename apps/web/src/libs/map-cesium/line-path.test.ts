// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { visibleLinePaths } from './line-path';

const identity = (x: number, y: number): readonly [number, number] => [x, y];

describe('画布附近的线片段', () => {
  it('截去远端线段而保留原路径的累计里程', () => {
    expect([...visibleLinePaths([[-1000, 10, 1000, 10]], identity, [-4, -4, 104, 104], false, [])])
      .toEqual([{ points: [-4, 10, 104, 10], distance: 996, closed: false }]);
    expect([...visibleLinePaths([[-1000, -10, 1000, -10]], identity, [-4, -4, 104, 104], false, [])])
      .toEqual([]);
  });

  it('可见的闭环原点合并首尾实线段，完整小环仍由画布闭合', () => {
    const ring = [20, 20, 200, 20, 200, 200, 20, 200, 20, 20];
    expect([...visibleLinePaths([ring], identity, [-4, -4, 104, 104], true, [])])
      .toEqual([{ points: [20, 104, 20, 20, 104, 20], distance: 636, closed: false }]);
    expect([...visibleLinePaths([[20, 20, 80, 20, 80, 80, 20, 80]], identity, [-4, -4, 104, 104], true, [])])
      .toEqual([{ points: [20, 20, 80, 20, 80, 80, 20, 80, 20, 20], distance: 0, closed: true }]);
  });

  it('数万远端顶点只向画布提交附近少量顶点，遍历仍定期让出', () => {
    const path = Array.from({ length: 70000 }, (_, index) => [-1e6 + index * 2e6 / 69999, 64]).flat();
    const steps = [...visibleLinePaths([path], identity, [-16, -16, 144, 144], false, [])];
    const parts = steps.filter(value => value !== undefined);
    expect(parts).toHaveLength(1);
    expect(parts[0].points.length).toBeLessThan(20);
    expect(parts[0].points[0]).toBe(-16);
    expect(parts[0].points.at(-2)).toBe(144);
    expect(parts[0].distance).toBeCloseTo(999984);
    expect(steps.filter(value => value === undefined).length).toBeGreaterThan(200);
  });

  it('很小的虚线周期仍让出遍历，不能因零段失去前进条件', () => {
    const iterator = visibleLinePaths([[0, 0, 100, 0]], identity, [-1, -1, 101, 1], false, [0, 0.001]);
    let steps = 0;
    while (iterator.next().value !== undefined) { steps++; }
    expect(steps).toBeLessThanOrEqual(256);
    iterator.return(undefined);
    expect(() => [...visibleLinePaths([[0, 0, 100, 0]], identity, [-1, -1, 101, 1], false, [0, 0])])
      .toThrow('有限正数');
    expect(() => [...visibleLinePaths([[0, 0, 100, 0]], identity, [-1, -1, 101, 1], false, [1, Number.MIN_VALUE])])
      .toThrow('画布坐标精度');
  });
});
