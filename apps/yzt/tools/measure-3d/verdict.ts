import type { SceneSample } from './bench-api.ts';
import type { RunResult, SceneQuality } from './results.ts';

// ADR 0147 3C.4 的验收：同模型同视角和 Cesium 比，这些条件要同时满足，不能靠降低画质换帧率。
// 重复跑的每一项取中位数。阈值可以在复测前调，这里一处改

const TRIANGLE_RATIO = 0.9;
const STABLE_RATIO = 1.2;
const FRAME_RATIO = 1.1;
// 清晰度：最差 10% 的格子不低于 Cesium 的这个比例。这只是提醒哪里可能糊，最后看图。
// 校准（docs/modules/map-three.md）：PoC 的默认缓存明显糊是 0.90，正常的都在 0.95 以上
const SHARPNESS_RATIO = 0.93;
// 最差一格：局部糊一块时最差 10% 看不出来（132 格里连着 4 格）。校准：看不出差别的最低 0.92，看得出糊的 0.85、0.89
const WORST_CELL_RATIO = 0.9;
// 等稳定是每 200 毫秒查一次：差这么多分不出先后
const STABLE_SAMPLE_MS = 200;
/** 同样的静止画面，每帧 JS 差这么多倍就算机器不稳定 */
export const MACHINE_DRIFT_RATIO = 1.5;
/** 三角形到 Cesium 终点的这个比例算到了：Cesium 自己各遍的终点就差这么多 */
export const FILL_REACHED_RATIO = 0.98;

export type VerdictGroup = '画质' | '到稳定' | '帧时间' | '主线程' | '振荡';

export interface VerdictRow {
  readonly group: VerdictGroup;
  readonly condition: string;
  /** 这一项的 MapLibre、Cesium 的值；没有时为 null */
  readonly subject: number | null;
  readonly reference: number | null;
  readonly unit: string;
  /** 能不能判断：缺数据时为 null */
  readonly pass: boolean | null;
}

export function median(values: readonly (number | null | undefined)[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).toSorted((a, b) => a - b);
  if (numbers.length === 0) {
    return null;
  }
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? (numbers[middle] ?? null) : ((numbers[middle - 1] ?? 0) + (numbers[middle] ?? 0)) / 2;
}

const usable = (runs: readonly RunResult[]) => runs.filter(run => run.status !== 'failed' && run.status !== 'invalid');

interface RowSpec {
  readonly group: VerdictGroup;
  readonly condition: string;
  readonly read: (run: RunResult) => number | null | undefined;
  readonly unit: string;
  /** 比较 MapLibre 和 Cesium */
  readonly passes: (subject: number, reference: number) => boolean;
}

const noMoreThan = (ratio: number) => (subject: number, reference: number) => subject <= reference * ratio;
const atLeast = (ratio: number) => (subject: number, reference: number) => subject >= reference * ratio;

function frameRows(label: string, phase: 'flightCold' | 'flightWarm'): RowSpec[] {
  const work = (key: 'p50' | 'p95' | 'p99') => ({
    group: '帧时间' as const,
    condition: `${label}每帧工作量 ${key} 不超过 Cesium 的 ${FRAME_RATIO} 倍`,
    read: (run: RunResult) => run[phase]?.work?.[key],
    unit: '毫秒',
    passes: noMoreThan(FRAME_RATIO)
  });
  return [
    work('p50'),
    work('p95'),
    work('p99'),
    {
      group: '帧时间',
      condition: `${label}≥50 毫秒的帧不多于 Cesium`,
      read: run => run[phase]?.over.ms50,
      unit: '帧',
      passes: noMoreThan(1)
    }
  ];
}

const ROWS: readonly RowSpec[] = [
  {
    group: '画质',
    condition: `稳定后显示的三角形不少于 Cesium 的 ${TRIANGLE_RATIO * 100}%`,
    read: run => run.atStable?.triangles,
    unit: '个',
    passes: atLeast(TRIANGLE_RATIO)
  },
  {
    group: '到稳定',
    condition: `从开始加载到稳定不超过 Cesium 的 ${STABLE_RATIO} 倍`,
    read: run => run.load?.ttStableMs,
    unit: '毫秒',
    passes: noMoreThan(STABLE_RATIO)
  },
  {
    group: '到稳定',
    condition: '飞行后补齐的时间不超过 Cesium',
    read: run => run.settle?.ms,
    unit: '毫秒',
    passes: (subject, reference) => subject <= reference + STABLE_SAMPLE_MS
  },
  ...frameRows('第一遍飞行', 'flightCold'),
  ...frameRows('第二遍飞行', 'flightWarm'),
  {
    group: '主线程',
    condition: '加载期最长的长任务不超过 Cesium',
    read: run => run.load?.longTasks.maxMs,
    unit: '毫秒',
    passes: noMoreThan(1)
  },
  {
    group: '主线程',
    condition: '飞行中最长的长任务不超过 Cesium',
    read: run => Math.max(run.flightCold?.longTasks.maxMs ?? 0, run.flightWarm?.longTasks.maxMs ?? 0),
    unit: '毫秒',
    passes: noMoreThan(1)
  }
];

function compare(spec: RowSpec, subjectRuns: readonly RunResult[], referenceRuns: readonly RunResult[]): VerdictRow {
  const subject = median(usable(subjectRuns).map(spec.read));
  const reference = median(usable(referenceRuns).map(spec.read));
  return {
    group: spec.group,
    condition: spec.condition,
    subject,
    reference,
    unit: spec.unit,
    pass: subject === null || reference === null ? null : spec.passes(subject, reference)
  };
}

/** 一个场景的验收：runs 是这个场景的所有遍 */
export function sceneVerdict(runs: readonly RunResult[], quality: SceneQuality | undefined): VerdictRow[] {
  const perf = (variant: string) => runs.filter(run => run.variant === variant && run.kind === 'perf');
  const qualityRun = (variant: string) => runs.find(run => run.variant === variant && run.kind === 'quality')?.quality;
  const subjectRuns = perf('maplibre');
  const refused = median(usable(subjectRuns).map(run => run.atStable?.refused));
  const rows: VerdictRow[] = [
    {
      group: '画质',
      condition: '稳定时没有被拒绝的瓦片',
      subject: refused,
      reference: null,
      unit: '块',
      pass: refused === null ? null : refused === 0
    }
  ];
  rows.push(...ROWS.map(spec => compare(spec, subjectRuns, perf('cesium'))));
  const ratio = quality?.stable.worstDecileRatio ?? null;
  rows.push({
    group: '画质',
    condition: `清晰度最差 10% 的格子不低于 Cesium 的 ${SHARPNESS_RATIO} 倍（还要人工看对比图）`,
    subject: ratio,
    reference: null,
    unit: '倍',
    pass: ratio === null ? null : ratio >= SHARPNESS_RATIO
  });
  const cells = quality?.stable.ratios.filter(value => value !== null) ?? [];
  const worstCell = cells.length > 0 ? Math.min(...cells) : null;
  rows.push({
    group: '画质',
    condition: `清晰度最差的一格不低于 Cesium 的 ${WORST_CELL_RATIO} 倍（局部糊一块时最差 10% 看不出来）`,
    subject: worstCell,
    reference: null,
    unit: '倍',
    pass: worstCell === null ? null : worstCell >= WORST_CELL_RATIO
  });
  const hold = qualityRun('maplibre')?.hold;
  const referenceHold = qualityRun('cesium')?.hold;
  rows.push({
    group: '振荡',
    condition: '静止观察期间没有瓦片加载、卸载',
    subject: hold ? hold.loaded + hold.unloaded : null,
    reference: referenceHold ? referenceHold.loaded + referenceHold.unloaded : null,
    unit: '次',
    pass: hold ? hold.loaded + hold.unloaded === 0 : null
  });
  rows.push({
    group: '振荡',
    condition: '静止观察期间画面变糊的次数不多于 Cesium',
    subject: hold ? hold.blurEvents.length : null,
    reference: referenceHold ? referenceHold.blurEvents.length : null,
    unit: '次',
    pass: hold && referenceHold ? hold.blurEvents.length <= referenceHold.blurEvents.length : null
  });
  return rows;
}

/** 离飞行结束 t 毫秒时的读数：那一刻之前最后一次记录；第一次记录比 0 晚一点点，算作 0 */
export function fillSampleAt(trace: readonly SceneSample[], t: number): SceneSample | null {
  return trace.findLast(sample => sample.t <= t) ?? trace[0] ?? null;
}

/**
 * 飞行结束多久以后，显示的三角形不再少于 triangles：两个引擎终点的粗细不同时，"补齐"的时间不能直接比，
 * 要看画面到同样的粗细用了多久。瓦片替换的中途三角形会回落，所以看最后一次低于它的时候。一直没到时是 null
 */
export function fillReachedAt(trace: readonly SceneSample[], triangles: number): number | null {
  const lastBelow = trace.findLastIndex(sample => sample.triangles < triangles);
  return trace[lastBelow + 1]?.t ?? null;
}

/**
 * 同一种引擎、同一个场景的静止画面，每帧 JS 最多差几倍：工作量相同，差得多说明运行期间机器被别的事占着，
 * 这次的帧时间要打折扣。算不出来时是 null
 */
export function machineDrift(runs: readonly RunResult[]): number | null {
  const groups = new Map<string, number[]>();
  for (const run of runs) {
    const js = run.kind === 'perf' ? run.static?.js?.p50 : undefined;
    if (js) {
      const key = `${run.scene}/${run.variant === 'cesium' ? 'cesium' : 'maplibre'}`;
      groups.set(key, (groups.get(key) ?? []).concat(js));
    }
  }
  const ratios = [...groups.values()].filter(values => values.length > 1).map(values => Math.max(...values) / Math.min(...values));
  return ratios.length > 0 ? Math.max(...ratios) : null;
}

/** 全部能判断、全部通过才算通过；缺数据时不算通过 */
export const allPassed = (rows: readonly VerdictRow[]) => rows.every(row => row.pass === true);
