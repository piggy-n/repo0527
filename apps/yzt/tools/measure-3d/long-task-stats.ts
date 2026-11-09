import type { LongTaskStats, LongTaskWindow } from './bench-api.ts';

const endOf = ({ startTime, duration }: LongTaskWindow) => startTime + duration;

function overlap(a: LongTaskWindow, b: LongTaskWindow): number {
  return Math.max(0, Math.min(endOf(a), endOf(b)) - Math.max(a.startTime, b.startTime));
}

/** from 到 to 开始的长任务：创建 WebGL 上下文和瓦片无关，只看驱动和机器，单独算一份 */
export function longTaskStats(
  tasks: readonly LongTaskWindow[],
  contexts: readonly LongTaskWindow[],
  from: number,
  to: number
): LongTaskStats {
  const inRange = tasks.filter(({ startTime }) => startTime >= from && startTime < to);
  const durations = inRange.map(({ duration }) => duration);
  const remaining = inRange.map(task => contexts.reduce((rest, context) => rest - overlap(task, context), task.duration));
  const over = (limit: number) => durations.filter(value => value >= limit).length;
  return {
    count: durations.length,
    maxMs: durations.length > 0 ? Math.max(...durations) : 0,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    over100: over(100),
    over200: over(200),
    over500: over(500),
    contextMs: contexts.filter(({ startTime }) => startTime >= from && startTime < to).reduce((sum, { duration }) => sum + duration, 0),
    maxWithoutContextMs: remaining.length > 0 ? Math.max(...remaining) : 0
  };
}
