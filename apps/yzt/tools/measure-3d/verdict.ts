import type { SceneSample } from './bench-api.ts';
import type { RunResult } from './results.ts';
import { DEFAULT_VARIANT, KEEP_SUFFIX } from './scenes.ts';

// 每个场景的检查：不和别的引擎比，只看本来就不该出现的情况，看的是产品的默认值。重复跑的取中位数

/** 同样的静止画面，每帧 JS 差这么多倍就算机器不稳定 */
export const MACHINE_DRIFT_RATIO = 1.5;

export type CheckGroup = '画质' | '振荡';

export interface CheckRow {
  readonly group: CheckGroup;
  readonly condition: string;
  /** 这一项的读数；没有时为 null */
  readonly value: number | null;
  readonly unit: string;
  /** 能不能判断：缺数据时为 null */
  readonly pass: boolean | null;
}

export function median(values: readonly (number | null | undefined)[]): number | null {
  const sorted = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const usable = (runs: readonly RunResult[]) => runs.filter(run => run.status !== 'failed' && run.status !== 'invalid');

/** 一个场景的检查：runs 是这个场景的所有遍 */
export function sceneChecks(runs: readonly RunResult[]): CheckRow[] {
  const ofDefault = runs.filter(run => run.variant === DEFAULT_VARIANT);
  const refused = median(usable(ofDefault.filter(run => run.kind === 'perf')).map(run => run.atStable?.refused));
  const hold = ofDefault.find(run => run.kind === 'quality')?.quality?.hold;
  const churn = hold ? hold.loaded + hold.unloaded : null;
  return [
    {
      group: '画质',
      condition: '稳定时没有被拒绝的瓦片',
      value: refused,
      unit: '块',
      pass: refused === null ? null : refused === 0
    },
    {
      group: '振荡',
      condition: '静止观察期间没有瓦片加载、卸载',
      value: churn,
      unit: '次',
      pass: churn === null ? null : churn === 0
    }
  ];
}

/** 离飞行结束 t 毫秒时的读数：那一刻之前最后一次记录；第一次记录比 0 晚一点点，算作 0 */
export function fillSampleAt(trace: readonly SceneSample[], t: number): SceneSample | null {
  return trace.findLast(sample => sample.t <= t) ?? trace[0] ?? null;
}

// 静止时画的、内存和产品默认值不同的方案：泼溅的预算、缓存上限，不提前上传（也不释放贴图，scenes.ts 的方案 id）；
// 保留贴图的另外按后缀认
const OWN_WORKLOAD = /^maplibre-(splat|cache|no-budget)/;

/**
 * 同一个场景的静止画面，每帧 JS 最多差几倍：工作量相同，差得多说明运行期间机器被别的事占着，
 * 这次的帧时间要打折扣。算不出来时是 null
 */
export function machineDrift(runs: readonly RunResult[]): number | null {
  const groups = new Map<string, number[]>();
  for (const run of runs) {
    const js = run.kind === 'perf' ? run.static?.js?.p50 : undefined;
    if (js) {
      // 上传预算、窗口不同的方案静止时画的一样；泼溅的预算、缓存上限不同，画的就不同（缓存大了放宽得少），各算各的；
      // 保留贴图的、不提前上传的（不提前上传的贴图不释放）也各算各的：内存的压力不同，只和它自己的几遍比
      const own = OWN_WORKLOAD.test(run.variant) || run.variant.endsWith(KEEP_SUFFIX);
      const workload = own ? run.variant : DEFAULT_VARIANT;
      const key = `${run.scene}/${workload}`;
      groups.set(key, (groups.get(key) ?? []).concat(js));
    }
  }
  const ratios = [...groups.values()].filter(values => values.length > 1).map(values => Math.max(...values) / Math.min(...values));
  return ratios.length > 0 ? Math.max(...ratios) : null;
}

/** 全部能判断、全部通过才算通过；缺数据时不算通过 */
export const allPassed = (rows: readonly CheckRow[]) => rows.every(row => row.pass === true);
