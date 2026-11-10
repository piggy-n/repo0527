// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { longTaskStats } from './long-task-stats.ts';

const window = (startTime: number, duration: number) => ({ startTime, duration });

describe('longTaskStats', () => {
  it('没有长任务时都是 0', () => {
    expect(longTaskStats([], [], 0, 1000)).toEqual({
      count: 0,
      maxMs: 0,
      totalMs: 0,
      over100: 0,
      over200: 0,
      over500: 0,
      contextMs: 0,
      maxWithoutContextMs: 0
    });
  });

  it('只算开始时刻在这段时间里的任务', () => {
    const stats = longTaskStats([window(100, 60), window(500, 120), window(1000, 300)], [], 200, 1000);
    expect(stats.count).toBe(1);
    expect(stats.maxMs).toBe(120);
    expect(stats.totalMs).toBe(120);
    expect(stats.over100).toBe(1);
    expect(stats.over200).toBe(0);
  });

  it('创建 WebGL 上下文最长时：另一份减去它，看的是剩下的任务', () => {
    const tasks = [window(100, 1282), window(2000, 553)];
    const stats = longTaskStats(tasks, [window(120, 1155)], 0, 5000);
    expect(stats.maxMs).toBe(1282);
    expect(stats.contextMs).toBe(1155);
    expect(stats.maxWithoutContextMs).toBe(553);
  });

  it('任务里除了创建上下文还有别的事：那部分还算这个任务的', () => {
    const stats = longTaskStats([window(100, 1000)], [window(100, 400)], 0, 5000);
    expect(stats.maxWithoutContextMs).toBe(600);
  });

  it('创建上下文只和任务重叠一部分：只减重叠的部分', () => {
    const stats = longTaskStats([window(100, 100)], [window(150, 200)], 0, 5000);
    expect(stats.maxWithoutContextMs).toBe(50);
  });

  it('创建上下文不在这段时间里：不算', () => {
    const stats = longTaskStats([window(3000, 80)], [window(100, 1000)], 2000, 5000);
    expect(stats.contextMs).toBe(0);
    expect(stats.maxWithoutContextMs).toBe(80);
  });
});
