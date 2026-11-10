import type { LongTaskWindow } from './bench-api.ts';

// CPU 采样的归因（ADR 0147 3C.4"归因要拆到模块"）：长任务按分块和原生调用拆开。
// long animation frame 只能归到入口，帧回调都从探针进入，所以单独跑一遍带 CDP 采样，直接看每段的调用栈。
// 哪段算长任务听页面的 longtask：采样里看不出任务的边界，帧率不封顶时一帧接一帧没有空闲，按空闲切会把几百帧并成一段

/** CDP Profiler.stop 的结果里用到的部分 */
export interface CpuProfile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: { readonly functionName: string; readonly url: string };
  }[];
  /** 微秒，和 timeDeltas 同一个时钟 */
  readonly endTime?: number;
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

export interface BusySegment {
  readonly durationMs: number;
  /** 按模块的自身耗时，从多到少 */
  readonly modules: readonly { readonly name: string; readonly ms: number }[];
}

export interface ProfileSummary {
  readonly totalBusyMs: number;
  /** 采样期间的长任务个数 */
  readonly longTasks: number;
  /** 最长的几个长任务 */
  readonly longest: readonly BusySegment[];
  /** 所有长任务合起来按模块的耗时 */
  readonly modules: readonly { readonly name: string; readonly ms: number }[];
}

const IDLE = '(idle)';
const PROBE_CHUNK = 'bench';

// 产物的分块名（按包分块，见 vite.config.ts）；没有地址的是原生调用和 V8 的内部项，直接用函数名。
// 探针包住了 getContext 和上传的 GL 调用，采样把原生耗时记在包装函数上，归到探针会以为是测量本身慢
function moduleOf({ functionName, url }: { readonly functionName: string; readonly url: string }): string {
  if (!url) {
    return functionName || '(native)';
  }
  const file = url.split('?')[0]?.split('/').pop() ?? url;
  const chunk = file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '') || url;
  if (chunk === PROBE_CHUNK) {
    if (functionName.endsWith('getContext')) {
      return '创建 WebGL 上下文';
    }
    if (functionName.includes('<computed>')) {
      return 'GL 上传（经探针）';
    }
  }
  return chunk;
}

function add(map: Map<string, number>, name: string, ms: number): void {
  map.set(name, (map.get(name) ?? 0) + ms);
}

const sorted = (map: ReadonlyMap<string, number>) =>
  [...map.entries()].toSorted((a, b) => b[1] - a[1]).map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 }));

/**
 * 把采样按长任务汇总。tasks 是页面时钟（performance.now），endedAt 是采样结束时的页面时钟，靠它对齐两个时钟；
 * 对齐的误差是一次 CDP 往返，比 50 毫秒小得多
 */
export function summarizeProfile(
  profile: CpuProfile,
  tasks: readonly LongTaskWindow[],
  endedAt: number,
  topTasks = 5
): ProfileSummary {
  const frames = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const elapsedMs = deltas.reduce((sum, delta) => sum + delta, 0) / 1000;
  const startedAt = endedAt - elapsedMs;
  const ordered = tasks
    .filter(task => task.startTime + task.duration > startedAt && task.startTime < endedAt)
    .toSorted((a, b) => a.startTime - b.startTime);
  const parts = ordered.map(() => new Map<string, number>());
  let totalBusy = 0;
  let clock = startedAt;
  let next = 0;
  samples.forEach((id, index) => {
    const ms = (deltas[index] ?? 0) / 1000;
    // 一个样本代表它之前的这一小段，按中点算落在哪个长任务里
    const at = clock + ms / 2;
    clock += ms;
    const frame = frames.get(id);
    if (!frame || frame.functionName === IDLE) {
      return;
    }
    totalBusy += ms;
    for (let task = ordered[next]; task && at >= task.startTime + task.duration; task = ordered[next]) {
      next += 1;
    }
    const task = ordered[next];
    const part = parts[next];
    if (task && part && at >= task.startTime) {
      add(part, moduleOf(frame), ms);
    }
  });
  const modules = new Map<string, number>();
  for (const part of parts) {
    for (const [name, ms] of part) {
      add(modules, name, ms);
    }
  }
  const longest = ordered
    .map((task, index) => ({ durationMs: Math.round(task.duration), modules: sorted(parts[index] ?? new Map<string, number>()).slice(0, 6) }))
    .toSorted((a, b) => b.durationMs - a.durationMs);
  return {
    totalBusyMs: Math.round(totalBusy),
    longTasks: ordered.length,
    longest: longest.slice(0, topTasks),
    modules: sorted(modules).slice(0, 10)
  };
}
