// CPU 采样的归因（ADR 0147 3C.4"归因要拆到模块"）：长任务按分块和原生调用拆开。
// long animation frame 只能归到入口，帧回调都从探针进入，所以单独跑一遍带 CDP 采样，直接看每段的调用栈

/** CDP Profiler.stop 的结果里用到的部分 */
export interface CpuProfile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: { readonly functionName: string; readonly url: string };
  }[];
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
  /** 最长的几段连续忙碌（超过 50 毫秒的才算长任务） */
  readonly longest: readonly BusySegment[];
  /** 所有长任务合起来按模块的耗时 */
  readonly modules: readonly { readonly name: string; readonly ms: number }[];
}

const LONG_TASK_MS = 50;
// 中间短暂空闲不算断开：同一个任务里也会采到一两个空闲样本
const IDLE_GAP_MS = 2;
const IDLE = '(idle)';

// 产物的分块名（按包分块，见 vite.config.ts）；没有地址的是原生调用和 V8 的内部项，直接用函数名
function moduleOf({ functionName, url }: { readonly functionName: string; readonly url: string }): string {
  if (!url) {
    return functionName || '(native)';
  }
  const file = url.split('?')[0]?.split('/').pop() ?? url;
  return file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '') || url;
}

function add(map: Map<string, number>, name: string, ms: number): void {
  map.set(name, (map.get(name) ?? 0) + ms);
}

const sorted = (map: ReadonlyMap<string, number>) =>
  [...map.entries()].toSorted((a, b) => b[1] - a[1]).map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 }));

/** 把采样切成连续忙碌的段，按模块汇总 */
export function summarizeProfile(profile: CpuProfile, topSegments = 5): ProfileSummary {
  const frames = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const segments: { durationMs: number; modules: Map<string, number> }[] = [];
  let current: { durationMs: number; modules: Map<string, number> } | null = null;
  let idle = 0;
  let totalBusyMs = 0;
  samples.forEach((id, index) => {
    const ms = (deltas[index] ?? 0) / 1000;
    const frame = frames.get(id);
    if (!frame || frame.functionName === IDLE) {
      idle += ms;
      if (current && idle > IDLE_GAP_MS) {
        segments.push(current);
        current = null;
      }
      return;
    }
    idle = 0;
    totalBusyMs += ms;
    current ??= { durationMs: 0, modules: new Map() };
    current.durationMs += ms;
    add(current.modules, moduleOf(frame), ms);
  });
  if (current) {
    segments.push(current);
  }
  const long = segments.filter(segment => segment.durationMs >= LONG_TASK_MS).toSorted((a, b) => b.durationMs - a.durationMs);
  const modules = new Map<string, number>();
  for (const segment of long) {
    for (const [name, ms] of segment.modules) {
      add(modules, name, ms);
    }
  }
  return {
    totalBusyMs: Math.round(totalBusyMs),
    longest: long.slice(0, topSegments).map(({ durationMs, modules: parts }) => ({
      durationMs: Math.round(durationMs),
      modules: sorted(parts).slice(0, 6)
    })),
    modules: sorted(modules).slice(0, 10)
  };
}
