import type { BenchStats, BudgetReadings, DetailReadings, SceneSample, PhaseResult, SplatReadings, TileQueues } from './bench-api.ts';
import type { ProfileSummary } from './profile.ts';
import type { MeasureResults, QualityResult, RunResult, RunStatus, ShotPair } from './results.ts';
import { DEFAULT_VARIANT } from './scenes.ts';
import type { SharpnessComparison } from './sharpness.ts';
import { allPassed, type CheckRow, fillSampleAt, MACHINE_DRIFT_RATIO, machineDrift, median, sceneChecks } from './verdict.ts';

// 从 raw.json 的内容生成报告；每跑完一遍就重新生成一次，中断了也留得下

const STATUS: Readonly<Record<RunResult['status'], string>> = { ok: '正常', timeout: '⚠ 超时', invalid: '✗ 无效', failed: '✗ 失败' };

const number = (value: number | null | undefined, digits = 1) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(digits);
};

const integer = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n');
}

const pick = (runs: readonly RunResult[], read: (run: RunResult) => number | null | undefined) => median(runs.map(read));

function summaryCell(runs: readonly RunResult[], read: (run: RunResult) => PhaseResult['work'] | undefined): string {
  const value = (key: 'p50' | 'p95' | 'p99' | 'max') => pick(runs, run => read(run)?.[key]);
  return value('p50') === null ? '—' : `${number(value('p50'))} / ${number(value('p95'))} / ${number(value('p99'))} / ${number(value('max'))}`;
}

const STATUS_ORDER: readonly RunResult['status'][] = ['failed', 'invalid', 'timeout', 'ok'];
const WAN = 10000;

// 飞行中画得多细：工作量少可能只是画得粗
function flightDetail(runs: readonly RunResult[], phase: 'flightCold' | 'flightWarm'): string {
  const of = (read: (trace: readonly SceneSample[]) => number | null) =>
    pick(runs, run => {
      const trace = run[phase]?.trace;
      return trace && trace.length > 0 ? read(trace) : null;
    });
  const errorMedian = of(trace => median(trace.map(sample => sample.errorTarget)));
  if (errorMedian === null) {
    return '—';
  }
  const errorMax = of(trace => Math.max(...trace.map(sample => sample.errorTarget)));
  const trianglesMedian = of(trace => median(trace.map(sample => sample.triangles)));
  const trianglesMin = of(trace => Math.min(...trace.map(sample => sample.triangles)));
  return `${number(errorMedian)} / ${number(errorMax)} / ${number((trianglesMedian ?? 0) / WAN)} / ${number((trianglesMin ?? 0) / WAN)}`;
}

// 瓦片排在哪一步：飞行中的中位数
function queueDetail(runs: readonly RunResult[], phase: 'flightCold' | 'flightWarm'): string {
  const of = (read: (queues: TileQueues) => number) =>
    pick(runs, run => median((run[phase]?.trace ?? []).map(sample => read(sample.queues))));
  const value = of(queues => queues.used);
  if (value === null) {
    return '—';
  }
  return `${integer(of(queues => queues.downloading))} / ${integer(of(queues => queues.parsing))} / ${integer(of(queues => queues.culled))} / ${integer(value)} / ${integer(of(queues => queues.usedOutOfView))}`;
}

// 窗口和放宽的原因：窗口取这一段的中位数，放宽的帧数是这一段里新增的
function budgetDetail(runs: readonly RunResult[], phase: 'flightCold' | 'settle' | 'flightWarm'): string {
  const budgets = (run: RunResult) => (run[phase]?.trace ?? []).map(sample => sample.budget);
  const added = (read: (budget: BudgetReadings) => number) =>
    pick(runs, run => {
      const list = budgets(run);
      const first = list[0];
      const last = list.at(-1);
      return first && last ? read(last) - read(first) : null;
    });
  const window = pick(runs, run => median(budgets(run).map(budget => budget.cullWindow)));
  const full = added(budget => budget.raisedFull);
  if (full === null) {
    return '—';
  }
  return `${number(window, 2)} / ${integer(full)} / ${integer(added(budget => budget.raisedPredicted))}`;
}

// 显示的瓦片按细不细分（块）：够细 / 放宽了才停在这一级 / 等更细的 / 已是最细。中间两项（放宽、等着）都是 0 才是按规则整级清楚。
// ADD 的瓦片不分（DisplayedDetail），有的时候写在后面
function detailCell(runs: readonly RunResult[], read: (run: RunResult) => DetailReadings | undefined): string {
  const of = (key: keyof DetailReadings) => pick(runs, run => read(run)?.[key]);
  const sharp = of('sharp');
  if (sharp === null) {
    return '—';
  }
  const additive = of('additive') ?? 0;
  const note = additive > 0 ? `（另有 ADD 的 ${integer(additive)} 块不分）` : '';
  return `${integer(sharp)} / ${integer(of('relaxed'))} / ${integer(of('waiting'))} / ${integer(of('finest'))}${note}`;
}

// 需求、上限和锁定，只是读数：放宽以后缓存在同一个上限停止接收，稳定时需求一般就在上限以下，看不出细一级放不放得下；
// 要分清看放宽的原因（装满 / 估计、被拒绝的）和更大一档同一相机下是不是整级清楚。锁定按遍数，不取中位数
function demandCell(runs: readonly RunResult[], read: (run: RunResult) => BenchStats | undefined): string {
  const measured = runs.flatMap(run => {
    const value = read(run);
    return value ? [value] : [];
  });
  if (measured.length === 0) {
    return '—';
  }
  const demand = median(measured.map(item => item.budget.demandMB));
  const limit = median(measured.map(item => item.budget.limitMB));
  return `${integer(demand)} / ${integer(limit)}，锁定 ${measured.filter(item => item.locked).length} / ${measured.length} 遍`;
}

// 私有内存（提交的字节）：渲染进程里有页面和它的 Worker
const memoryCell = (runs: readonly RunResult[]) =>
  `${integer(pick(runs, run => run.memory?.rendererAtStableMB))} / ${integer(pick(runs, run => run.memory?.rendererPeakMB))}，${integer(pick(runs, run => run.memory?.gpuProcessPeakMB))}`;

// 每一项是一行，各方案一列
const METRICS: readonly (readonly [string, (runs: readonly RunResult[]) => string])[] = [
  ['状态', runs => `${STATUS[STATUS_ORDER.find(status => runs.some(run => run.status === status)) ?? 'failed']}（${runs.length} 遍）`],
  ['到稳定（秒）', runs => number((pick(runs, run => run.load?.ttStableMs) ?? Number.NaN) / 1000)],
  ['加载期长任务：最长 / 总和（毫秒）', runs => `${integer(pick(runs, run => run.load?.longTasks.maxMs))} / ${integer(pick(runs, run => run.load?.longTasks.totalMs))}`],
  ['加载期：创建 WebGL 上下文 / 除去它最长的长任务（毫秒）', runs => `${integer(pick(runs, run => run.load?.longTasks.contextMs))} / ${integer(pick(runs, run => run.load?.longTasks.maxWithoutContextMs))}`],
  ['静止：每帧工作量 p50 / p95 / p99 / 最长', runs => summaryCell(runs, run => run.static?.work)],
  ['静止：每帧 JS', runs => summaryCell(runs, run => run.static?.js)],
  ['静止：每帧 GPU', runs => summaryCell(runs, run => run.static?.gpu)],
  ['静止：帧间隔', runs => summaryCell(runs, run => run.static?.interval)],
  ['第一遍飞行：每帧工作量', runs => summaryCell(runs, run => run.flightCold?.work)],
  ['第一遍飞行：每帧 GPU', runs => summaryCell(runs, run => run.flightCold?.gpu)],
  ['第一遍飞行：帧间隔', runs => summaryCell(runs, run => run.flightCold?.interval)],
  ['第一遍飞行：≥33 / ≥50 / ≥100 毫秒的帧', runs => `${integer(pick(runs, run => run.flightCold?.over.ms33))} / ${integer(pick(runs, run => run.flightCold?.over.ms50))} / ${integer(pick(runs, run => run.flightCold?.over.ms100))}`],
  ['第一遍飞行：长任务 次数 / 最长', runs => `${integer(pick(runs, run => run.flightCold?.longTasks.count))} / ${integer(pick(runs, run => run.flightCold?.longTasks.maxMs))}`],
  ['第一遍飞行：屏幕误差 中位 / 最高，三角形（万）中位 / 最低', runs => flightDetail(runs, 'flightCold')],
  ['第一遍飞行：下载中 / 解析中 / 没请求 / 在用 / 其中视野外（块，中位）', runs => queueDetail(runs, 'flightCold')],
  ['第一遍飞行：窗口（秒，中位）/ 放宽的帧 装满 / 估计', runs => budgetDetail(runs, 'flightCold')],
  ['第一遍飞行：上传 贴图 / 缓冲（MB）/ 最多的一帧', runs =>`${integer(pick(runs, run => run.flightCold?.uploads.textureMB))} / ${integer(pick(runs, run => run.flightCold?.uploads.bufferMB))} / ${number(pick(runs, run => run.flightCold?.uploads.maxFrameMB))}`],
  ['飞行后补齐（秒）', runs => number((pick(runs, run => run.settle?.ms) ?? Number.NaN) / 1000)],
  ['飞行后：窗口（秒，中位）/ 放宽的帧 装满 / 估计', runs => budgetDetail(runs, 'settle')],
  ['第二遍飞行：每帧工作量', runs => summaryCell(runs, run => run.flightWarm?.work)],
  ['第二遍飞行：帧间隔', runs => summaryCell(runs, run => run.flightWarm?.interval)],
  ['第二遍飞行：≥33 / ≥50 / ≥100 毫秒的帧', runs => `${integer(pick(runs, run => run.flightWarm?.over.ms33))} / ${integer(pick(runs, run => run.flightWarm?.over.ms50))} / ${integer(pick(runs, run => run.flightWarm?.over.ms100))}`],
  ['第二遍飞行：屏幕误差 中位 / 最高，三角形（万）中位 / 最低', runs => flightDetail(runs, 'flightWarm')],
  ['第二遍飞行：下载中 / 解析中 / 没请求 / 在用 / 其中视野外（块，中位）', runs => queueDetail(runs, 'flightWarm')],
  ['第二遍飞行：窗口（秒，中位）/ 放宽的帧 装满 / 估计', runs => budgetDetail(runs, 'flightWarm')],
  ['第二遍飞行：长任务 次数 / 最长', runs =>`${integer(pick(runs, run => run.flightWarm?.longTasks.count))} / ${integer(pick(runs, run => run.flightWarm?.longTasks.maxMs))}`],
  ['画面恢复（秒）', runs => number((pick(runs, run => run.recovery?.ms) ?? Number.NaN) / 1000)],
  ['稳定时：瓦片 / 三角形', runs => `${integer(pick(runs, run => run.atStable?.tilesVisible))} / ${integer(pick(runs, run => run.atStable?.triangles))}`],
  ['稳定时：屏幕误差 / 引擎估算的模型显存（MB）', runs => `${number(pick(runs, run => run.atStable?.errorTarget))} / ${integer(pick(runs, run => run.atStable?.cacheMB))}`],
  ['稳定时：显示的瓦片 够细 / 放宽了才停在这一级 / 等更细的 / 已是最细（块）', runs => detailCell(runs, run => run.atStable?.detail)],
  ['加载到稳定：放宽的帧 装满 / 估计', runs => `${integer(pick(runs, run => run.atStable?.budget.raisedFull))} / ${integer(pick(runs, run => run.atStable?.budget.raisedPredicted))}`],
  ['稳定时：需求 / 缓存上限（MB），锁定', runs => demandCell(runs, run => run.atStable)],
  ['恢复后：瓦片 / 三角形 / 屏幕误差', runs => `${integer(pick(runs, run => run.atRecovered?.tilesVisible))} / ${integer(pick(runs, run => run.atRecovered?.triangles))} / ${number(pick(runs, run => run.atRecovered?.errorTarget))}`],
  ['恢复后：显示的瓦片 够细 / 放宽了才停在这一级 / 等更细的 / 已是最细（块）', runs => detailCell(runs, run => run.atRecovered?.detail)],
  ['恢复后：需求 / 缓存上限（MB），锁定', runs => demandCell(runs, run => run.atRecovered)],
  ['显存：稳定时 / 峰值（MB）', runs => `${integer(pick(runs, run => run.memory?.gpuAtStableMB))} / ${integer(pick(runs, run => run.memory?.gpuPeakMB))}`],
  ['CPU 内存：渲染进程 稳定时 / 峰值，GPU 进程峰值（MB）', memoryCell],
  ['JS 堆峰值（MB）', runs => integer(pick(runs, run => run.memory?.heapPeakMB))],
  ['模型占画面的比例（%）', runs => number(pick(runs, run => run.image?.modelCoveragePct))],
  ['页面错误 / GL 错误', runs => `${integer(pick(runs, run => run.pageErrors?.length ?? 0))} / ${integer(pick(runs, run => run.glErrors ?? 0))}`]
];

// ---------- 高斯泼溅的预算（ADR 0149 L.3） ----------

// 稳定时可见的高斯到预算的这么多算用满了：不到说明这个视角稳定时要不了这么多，飞行和峰值的行仍然反映这个预算的开销
export const SPLAT_FILLED_RATIO = 0.9;

const splatOf = (run: RunResult, read: (splats: SplatReadings) => number) => {
  const splats = run.atStable?.splats;
  return splats ? read(splats) : null;
};

// 飞行中画得多少：中位、最低、最高（万）
function splatFlight(runs: readonly RunResult[], phase: 'flightCold' | 'flightWarm'): string {
  const of = (read: (values: readonly number[]) => number | null) =>
    pick(runs, run => {
      const values = (run[phase]?.trace ?? []).flatMap(sample => (sample.splats ? [sample.splats.visible] : []));
      return values.length > 0 ? read(values) : null;
    });
  const middle = of(values => median(values));
  return middle === null ? '—' : `${number(middle / WAN)} / ${number((of(values => Math.min(...values)) ?? 0) / WAN)} / ${number((of(values => Math.max(...values)) ?? 0) / WAN)}`;
}

// 各遍里最大的：长任务的"最长"不能取中位数，两遍的中点可能是 50 毫秒以下、根本不存在的长任务
function maxOf(runs: readonly RunResult[], read: (run: RunResult) => number | undefined): number | null {
  const values = runs.map(read).filter(value => value !== undefined);
  return values.length > 0 ? Math.max(...values) : null;
}

/** 可见的高斯占预算的比例（中位数）；没有读数时为 null */
export function splatFill(runs: readonly RunResult[]): number | null {
  return pick(runs, run => splatOf(run, splats => splats.visible / splats.budget));
}

const SPLAT_METRICS: readonly (readonly [string, (runs: readonly RunResult[]) => string])[] = [
  ['状态', runs => `${STATUS[STATUS_ORDER.find(status => runs.some(run => run.status === status)) ?? 'failed']}（${runs.length} 遍）`],
  ['到稳定（秒）', runs => number((pick(runs, run => run.load?.ttStableMs) ?? Number.NaN) / 1000)],
  [
    '稳定时：可见的高斯 / 预算（万），用满了吗',
    runs => {
      const fill = splatFill(runs);
      const visible = pick(runs, run => splatOf(run, splats => splats.visible));
      const budget = pick(runs, run => splatOf(run, splats => splats.budget));
      const verdict = fill === null ? '' : fill >= SPLAT_FILLED_RATIO ? '，用满' : `，**没用满（${number(fill * 100, 0)}%）**`;
      return `${number((visible ?? Number.NaN) / WAN)} / ${number((budget ?? Number.NaN) / WAN)}${verdict}`;
    }
  ],
  ['稳定时：驻留分块 / 累计下载（MB）', runs => `${integer(pick(runs, run => splatOf(run, splats => splats.residentChunks)))} / ${integer(pick(runs, run => splatOf(run, splats => splats.downloadedMB)))}`],
  ['显存（GPU 进程专用）：稳定时 / 峰值（MB）', runs => `${integer(pick(runs, run => run.memory?.gpuAtStableMB))} / ${integer(pick(runs, run => run.memory?.gpuPeakMB))}`],
  ['库估计：GPU / CPU / WASM 峰值（MB，稳定时）', runs => `${integer(pick(runs, run => splatOf(run, splats => splats.gpuMB)))} / ${integer(pick(runs, run => splatOf(run, splats => splats.cpuMB)))} / ${integer(pick(runs, run => splatOf(run, splats => splats.peakWasmMB)))}`],
  ['CPU 内存：渲染进程 稳定时 / 峰值，GPU 进程峰值（MB）', memoryCell],
  ['JS 堆峰值（MB）', runs => integer(pick(runs, run => run.memory?.heapPeakMB))],
  ['静止：每帧工作量 p50 / p95 / p99 / 最长', runs => summaryCell(runs, run => run.static?.work)],
  ['静止：每帧 GPU', runs => summaryCell(runs, run => run.static?.gpu)],
  ['第一遍飞行：每帧工作量', runs => summaryCell(runs, run => run.flightCold?.work)],
  ['第一遍飞行：每帧 GPU', runs => summaryCell(runs, run => run.flightCold?.gpu)],
  ['第一遍飞行：≥33 / ≥50 / ≥100 毫秒的帧', runs => `${integer(pick(runs, run => run.flightCold?.over.ms33))} / ${integer(pick(runs, run => run.flightCold?.over.ms50))} / ${integer(pick(runs, run => run.flightCold?.over.ms100))}`],
  ['第一遍飞行：长任务 次数（中位数）/ 最长（各遍最大）', runs => `${integer(pick(runs, run => run.flightCold?.longTasks.count))} / ${integer(maxOf(runs, run => run.flightCold?.longTasks.maxMs))}`],
  ['第一遍飞行：可见的高斯（万）中位 / 最低 / 最高', runs => splatFlight(runs, 'flightCold')],
  ['第一遍飞行：上传 贴图 / 缓冲（MB）/ 最多的一帧', runs => `${integer(pick(runs, run => run.flightCold?.uploads.textureMB))} / ${integer(pick(runs, run => run.flightCold?.uploads.bufferMB))} / ${number(pick(runs, run => run.flightCold?.uploads.maxFrameMB))}`],
  ['飞行后补齐（秒）', runs => number((pick(runs, run => run.settle?.ms) ?? Number.NaN) / 1000)],
  ['第二遍飞行：每帧工作量', runs => summaryCell(runs, run => run.flightWarm?.work)],
  ['第二遍飞行：≥33 / ≥50 / ≥100 毫秒的帧', runs => `${integer(pick(runs, run => run.flightWarm?.over.ms33))} / ${integer(pick(runs, run => run.flightWarm?.over.ms50))} / ${integer(pick(runs, run => run.flightWarm?.over.ms100))}`],
  ['第二遍飞行：可见的高斯（万）中位 / 最低 / 最高', runs => splatFlight(runs, 'flightWarm')],
  ['加载期：最长的长任务，除去创建 WebGL 上下文（毫秒）', runs => integer(pick(runs, run => run.load?.longTasks.maxWithoutContextMs))],
  ['模型占画面 / 其中接近白色（%）', runs => `${number(pick(runs, run => run.image?.modelCoveragePct))} / ${number(pick(runs, run => run.image?.brightPct))}`],
  ['页面错误 / GL 错误', runs => `${integer(pick(runs, run => run.pageErrors?.length ?? 0))} / ${integer(pick(runs, run => run.glErrors ?? 0))}`]
];

/** 这个场景跑的方案（泼溅场景只有各个预算） */
function sceneVariants(results: MeasureResults, scene: MeasureResults['scenes'][number]) {
  return results.variants.filter(({ id }) => scene.variants?.includes(id) ?? true);
}

function splatLines(results: MeasureResults): string[] {
  const splatScenes = results.scenes.filter(scene => scene.splat);
  if (splatScenes.length === 0) {
    return [];
  }
  const parts = [
    '## 高斯泼溅的预算（ADR 0149 L.3）',
    '',
    `模型来自${results.meta.manifest ?? '清单'}。帧时间单位是毫秒，四个数是 p50 / p95 / p99 / 最长；重复跑的取中位数。稳定时可见的高斯不到预算的 ${SPLAT_FILLED_RATIO * 100}% 时算"没用满"：这个视角稳定时要不了这么多，稳定时的行不代表这个预算的开销；飞行要经过要得更多的视角，飞行和峰值的行仍然反映它。`,
    ''
  ];
  for (const scene of splatScenes) {
    const perf = sceneVariants(results, scene).map(({ id, label }) => ({
      label,
      runs: results.runs.filter(run => run.scene === scene.id && run.variant === id && run.kind === 'perf')
    }));
    if (perf.every(item => item.runs.length === 0)) {
      continue;
    }
    parts.push(
      `### ${scene.title}`,
      '',
      table(
        ['指标', ...perf.map(item => item.label)],
        SPLAT_METRICS.map(([name, read]) => [name].concat(perf.map(item => (item.runs.length === 0 ? '还没跑' : read(item.runs)))))
      ),
      ''
    );
  }
  return parts;
}

const checkMark = ({ pass }: CheckRow) => (pass === null ? '算不出' : pass ? '通过' : '**不通过**');

function checkTable(rows: readonly CheckRow[]): string {
  return table(
    ['类别', '条件', '读数', '结果'],
    rows.map(row => [row.group, row.condition, `${integer(row.value)} ${row.unit}`, checkMark(row)])
  );
}

function ratioText({ cells, medianRatio, worstDecileRatio, ratios }: SharpnessComparison): string {
  const values = ratios.filter(value => value !== null);
  const worst = values.length > 0 ? Math.min(...values) : null;
  return `比了 ${cells} 格，中位数 ${number(medianRatio, 2)}，最差 10% ${number(worstDecileRatio, 2)}，最差一格 ${number(worst, 2)}`;
}

const qualityRunOf = (results: MeasureResults, scene: string, variant: string) =>
  results.runs.find(run => run.scene === scene && run.variant === variant && run.kind === 'quality');

// 截图比出来的清晰度：飞一圈回来和飞行前比；缓存上限的各档，产品默认值和它比。只比状态正常的遍（cli.ts），
// 有一边超时、无效时写出来，不然看不出是没比还是还没跑完。数字只提醒哪里可能糊，图在 quality.html
function sharpnessLines(results: MeasureResults, scene: MeasureResults['scenes'][number]): string[] {
  const fallback = qualityRunOf(results, scene.id, DEFAULT_VARIANT);
  return sceneVariants(results, scene).flatMap(({ id, label }) => {
    const own = qualityRunOf(results, scene.id, id);
    if (!own) {
      return [];
    }
    const compared = results.quality.find(item => item.scene === scene.id && item.variant === id);
    const lines: string[] = [];
    const afterTitle = `**飞一圈回来的清晰度（${id === DEFAULT_VARIANT ? '' : `${label}，`}和飞行前比）：**`;
    if (compared?.afterFlight) {
      lines.push(`${afterTitle} ${ratioText(compared.afterFlight.comparison)}；图在 \`quality.html\``, '');
    } else if (own.status !== 'ok') {
      lines.push(`${afterTitle} 这一遍${STATUS[own.status]}，截图不是稳定后的，没比`, '');
    }
    if (id === DEFAULT_VARIANT || !fallback) {
      return lines;
    }
    const versusTitle = `**产品默认值和${label}比（稳定后同一相机，低于 1 是默认值在那里更糊）：**`;
    if (compared?.versusDefault) {
      lines.push(`${versusTitle} ${ratioText(compared.versusDefault.comparison)}；图在 \`quality.html\``, '');
    } else if (own.status !== 'ok' || fallback.status !== 'ok') {
      lines.push(`${versusTitle} 默认值那一遍${STATUS[fallback.status]}、这一档${STATUS[own.status]}，有一边没稳定，没比`, '');
    }
    return lines;
  });
}

function uploadTable(runs: readonly RunResult[], phase: 'flightCold' | 'flightWarm'): string | null {
  const first = runs.find(run => run[phase])?.[phase];
  if (!first) {
    return null;
  }
  const rows = first.uploads.buckets.map(({ label }, index) => {
    const bucket = (run: RunResult) => run[phase]?.uploads.buckets[index];
    return [
      label,
      integer(pick(runs, run => bucket(run)?.frames)),
      number(pick(runs, run => bucket(run)?.gpuP50)),
      number(pick(runs, run => bucket(run)?.gpuP95))
    ];
  });
  return table(['这一帧上传（MB）', '帧数', 'GPU p50（毫秒）', 'GPU p95（毫秒）'], rows);
}

const moduleParts = (modules: ProfileSummary['modules']) => modules.map(item => `${item.name} ${number(item.ms)}`).join('，') || '—';

function profileLines(title: string, summary: ProfileSummary): string[] {
  if (summary.longTasks === 0) {
    return [`**${title}：** 忙碌共 ${integer(summary.totalBusyMs)} 毫秒；没有长任务`, ''];
  }
  return [
    `**${title}：** 忙碌共 ${integer(summary.totalBusyMs)} 毫秒；长任务 ${summary.longTasks} 个，合计：${moduleParts(summary.modules)}`,
    ...summary.longest.map((segment, index) => `- 第 ${index + 1} 长 ${integer(segment.durationMs)} 毫秒：${moduleParts(segment.modules)}`),
    ''
  ];
}

// 飞行后的过程取这几个时刻（毫秒）
const FILL_TIMES: readonly number[] = [0, 250, 500, 1000, 1500, 2000, 3000];

function fillCell(runs: readonly RunResult[], read: (run: RunResult) => SceneSample | null | undefined): string {
  const value = (key: 'errorTarget' | 'triangles') => pick(runs, run => read(run)?.[key]);
  const error = value('errorTarget');
  return error === null ? '—' : `${number(error)} / ${number((value('triangles') ?? 0) / WAN)}`;
}

// 放宽了才停在这一级的、等更细的瓦片（块）：飞完是在等加载，还是停在了放宽的一级
function fillDetailCell(runs: readonly RunResult[], read: (run: RunResult) => SceneSample | null | undefined): string {
  const relaxed = pick(runs, run => read(run)?.detail.relaxed);
  return relaxed === null ? '—' : `${integer(relaxed)} / ${integer(pick(runs, run => read(run)?.detail.waiting))}`;
}

const finalOf = (run: RunResult) => run.settle?.trace.at(-1);

/** 飞行后画面怎样变："补齐"的时间只说明引擎不再动，看不出画面怎样一步步变细 */
function fillLines(perf: readonly { readonly label: string; readonly runs: readonly RunResult[] }[]): string[] {
  const measured = perf.filter(item => item.runs.some(run => run.settle?.trace.length));
  if (measured.length === 0) {
    return [];
  }
  const rows = (render: typeof fillCell) =>
    measured.map(({ label, runs }) =>
      [label].concat(
        FILL_TIMES.map(t => render(runs, run => fillSampleAt(run.settle?.trace ?? [], t))),
        render(runs, finalOf)
      )
    );
  const headers = ['方案', ...FILL_TIMES.map(t => `${t / 1000} 秒`), '最后'];
  return [
    '**飞行后的过程（第一遍）：** 每格是屏幕误差 / 三角形（万）',
    '',
    table(headers, rows(fillCell)),
    '',
    '**飞行后显示的瓦片（第一遍）：** 每格是放宽了才停在这一级 / 等更细的（块）。等着的一直不归零是加载跟不上；最后还有放宽的，原因看上表"飞行后：窗口 / 放宽的帧 装满 / 估计"一行，细一级放不放得下看更大一档的同一行',
    '',
    table(headers, rows(fillDetailCell)),
    ''
  ];
}

const METHOD = `- **都是生产代码：** 真实的 \`MapSession\`、\`MapLibreView\` + \`ThreeSceneRenderer\`，生产模式构建；页面只有底图和模型。按包分块，方便归因，运行的代码相同。
- **冷启动：** 每遍一个新的浏览器进程和空的配置目录，服务端发 \`Cache-Control: no-store\`。操作系统的文件缓存控制不了。
- **模型来自本机服务（设了 \`YZT_3DT_PROXY\` 时除外）：** 没有网络延迟，"到稳定"是下限；主线程的解析成本不受影响。
- **每帧工作量：** 同一帧的 JS 加 GPU，比较方案时 p50、p95、p99 看它。帧间隔有下限（见"有效性"里的校准），看不出余量；工作量不受影响。
- **≥50 毫秒的帧：** 看实际帧间隔：这个长度远高于下限，而且能抓到不在工作量里的卡顿（垃圾回收、合成）。
- **每帧 GPU：** \`EXT_disjoint_timer_query_webgl2\`，只包住这一帧的回调。默认和产品一样不开多重采样；加 \`--antialias\` 打开后，离屏解析也在计时内。
- **上传假设：** 每帧的 \`texImage2D\`、\`texSubImage2D\`、\`texImage3D\`、\`texSubImage3D\`、\`bufferData\` 的字节和 \`generateMipmap\` 次数，和这一帧的 GPU 耗时放在一起。按上传量分桶后 GPU 耗时随上传量上涨，才说明尖峰来自上传。
- **长任务归因：** 单独跑一遍带 CDP CPU 采样，页面报的每个长任务按分块（three、maplibre-gl、map-three……）和原生调用（\`linkProgram\`、\`texSubImage2D\`）汇总。\`profiles/\` 里的 \`.cpuprofile\` 可以用 DevTools 打开。创建 WebGL 上下文另外包住 \`getContext\` 量，每一遍都有：它和瓦片无关，同一台机器上 0.6～1.2 秒来回跳。
- **清晰度：** 单独跑一遍画质：静止观察时每秒截一张，看画面有没有变糊；飞一圈回来再拍一张，和飞行前同一相机的那张比。见 \`quality.html\` 的说明。
- **到稳定：** 引擎报告瓦片都到了、上传队列空、屏幕误差不再变，连续 1 秒。飞行后补齐从飞行结束的时刻算；这个数只说明引擎不再动，不说明画面回到了飞行前的粗细，要一起看"飞行后的过程"和飞一圈回来的清晰度。
- **显存：** Windows 的 GPU Process Memory 计数器，取 GPU 进程的专用显存。"峰值"是加载时、稳定时和每遍飞行结束补齐后这些采样的最大值，不是真正的瞬时峰值，飞行途中不采样（读计数器要起 PowerShell，会干扰帧时间）。
- **CPU 内存：** 渲染进程（页面和它的 Worker，备用的空进程也算，只有几十 MB）、GPU 进程的私有内存（提交的字节，\`Get-Process\` 的 PrivateMemorySize64），和显存同时采样。
- **高斯泼溅（ADR 0149 L.3）：** 每个预算一个方案，都是产品的设置（\`limit\`、\`maxSh: 0\`、并发 2），只换总预算。"稳定"是每份都读到了索引、当前视角要的细节都到了（库的 \`loadProgress\` 为 1）、没有在加载的分块。"库估计"是库自己报的数（CPU 不含 Worker 的堆和还没放进存储的副本）。库在渲染回调外上传、排序，这部分不在"每帧 GPU"里，上传量记在下一帧。"接近白色"是模型的像素里三个通道都不低于 235 的比例，同一个相机下软件渲染和显卡比，看亮处偏白是不是软件渲染造成的。`;

/** report.md */
export function renderReport(results: MeasureResults): string {
  const { meta, environment: env, runs } = results;
  const onlySplats = results.scenes.length > 0 && results.scenes.every(scene => scene.splat);
  const title = onlySplats ? '# 高斯泼溅的预算实测（ADR 0149 L.3）' : '# 三维实测（MapLibre 引擎）';
  const parts: string[] = [title, ''];
  parts.push(`生成时间：${meta.updatedAt}　提交：${meta.commit ?? '未知'}　进度：${runs.length} / ${meta.plannedTotal}${meta.finished ? '' : '（还在跑或被中断）'}`, '');
  if (env.software) {
    parts.push(`> **⚠ 这次是软件渲染（${env.gpu}），所有帧时间、GPU 数字都无效，只用来确认脚本能跑。**`, '');
  }
  if (env.integrated) {
    parts.push(`> **⚠ 这次用的是集显（${env.gpu}），不代表独显的表现。**`, '');
  }
  if (meta.quick) {
    parts.push('> **⚠ 这次用了 --quick，每段时长都被缩短，只用来确认脚本能跑。**', '');
  }
  const drift = machineDrift(runs);
  const unsteady = drift !== null && drift > MACHINE_DRIFT_RATIO;
  if (unsteady) {
    parts.push(`> **⚠ 运行期间机器状态不稳定：同样的静止画面，每帧 JS 最多差 ${number(drift)} 倍，帧时间的比较要打折扣。** 关掉其他程序和远程连接，插上电源再跑一次。`, '');
  }

  parts.push(...splatLines(results));
  if (!onlySplats) {
    parts.push('## 检查', '');
  }
  for (const scene of results.scenes) {
    const sceneRuns = runs.filter(run => run.scene === scene.id);
    // 泼溅场景比较预算，上面单独一节
    if (sceneRuns.length === 0 || scene.splat) {
      continue;
    }
    const rows = sceneChecks(sceneRuns);
    parts.push(
      `### ${scene.title}：${allPassed(rows) ? '全部通过' : '没有全部通过'}`,
      '',
      checkTable(rows),
      '',
      ...sharpnessLines(results, scene)
    );
  }
  if (!onlySplats) {
    parts.push('画面清不清楚、飞一圈回来有没有变糊，最后要人工看 `quality.html`，结论写进 `manual.md`。', '');
  }

  parts.push('## 有效性', '');
  parts.push(
    table(['项目', '结果'], [
      ['渲染器', env.gpu],
      ['软件渲染', env.software ? '是，结果无效' : '否'],
      ['每帧 GPU 耗时', env.gpuTimer ? '可用' : '取不到（没有 EXT_disjoint_timer_query_webgl2）'],
      ['空页面的帧间隔（毫秒）', `不等 ${number(env.floorMs['pacing-0'], 2)}；最多 1 帧在路上 ${number(env.floorMs['pacing-1'], 2)}（PoC 的做法）；最多 2 帧 ${number(env.floorMs['pacing-2'], 2)}`],
      ['这次用的', `最多 ${meta.pacing} 帧在路上`],
      ['帧率上限', meta.fps === null ? '不封顶' : `${meta.fps} 帧`],
      ['机器状态', drift === null ? '算不出' : `同样的静止画面，每帧 JS 最多差 ${number(drift)} 倍（超过 ${MACHINE_DRIFT_RATIO} 倍算不稳定）`],
      ['底图', meta.basemap === 'arcgis' ? 'ArcGIS 影像' : '无底图'],
      ['视口', `${meta.viewport.width}×${meta.viewport.height}`],
      ['多重采样', meta.antialias ? '开（--antialias）' : '不开（和产品一样）']
    ]),
    ''
  );
  if (results.warnings.length > 0) {
    parts.push(results.warnings.map(item => `- ${item}`).join('\n'), '');
  }

  const problems = runs.filter(run => run.status !== 'ok' || run.notes.length > 0);
  if (problems.length > 0) {
    parts.push('## 失败、超时和无效', '');
    for (const run of problems) {
      parts.push(`- **${run.id}：** ${STATUS[run.status]}。${[run.error, ...run.notes].filter(Boolean).join('；')}`);
    }
    parts.push('');
  }

  parts.push('## 各场景并排', '', '帧时间单位是毫秒，四个数是 p50 / p95 / p99 / 最长；重复跑的取中位数。', '');
  for (const scene of results.scenes) {
    const perf = sceneVariants(results, scene).map(({ id, label }) => ({
      label,
      runs: runs.filter(run => run.scene === scene.id && run.variant === id && run.kind === 'perf')
    }));
    // 泼溅场景的数字在上面那一节，这里只留长任务归因
    if (perf.every(item => item.runs.length === 0) || scene.splat) {
      for (const variant of sceneVariants(results, scene)) {
        const profile = runs.find(run => run.scene === scene.id && run.variant === variant.id && run.kind === 'profile')?.profile;
        if (profile) {
          parts.push(`**长任务归因：${scene.title}，${variant.label}**`, '', ...profileLines('加载期', profile.load), ...profileLines('飞行中', profile.flight));
        }
      }
      continue;
    }
    parts.push(`### ${scene.title}`, '');
    parts.push(
      table(
        ['指标', ...perf.map(item => item.label)],
        METRICS.map(([name, read]) => [name].concat(perf.map(item => (item.runs.length === 0 ? '还没跑' : read(item.runs)))))
      ),
      ''
    );
    parts.push(...fillLines(perf));
    parts.push('**GPU 耗时随上传量（第一遍飞行）：**', '');
    for (const item of perf) {
      const uploads = uploadTable(item.runs, 'flightCold');
      if (uploads) {
        parts.push(item.label, '', uploads, '');
      }
    }
    for (const variant of sceneVariants(results, scene)) {
      const profile = runs.find(run => run.scene === scene.id && run.variant === variant.id && run.kind === 'profile')?.profile;
      if (profile) {
        parts.push(`**长任务归因：${variant.label}**`, '', ...profileLines('加载期', profile.load), ...profileLines('飞行中', profile.flight));
      }
    }
    for (const variant of sceneVariants(results, scene)) {
      const hold = runs.find(run => run.scene === scene.id && run.variant === variant.id && run.kind === 'quality')?.quality?.hold;
      if (hold) {
        const events = hold.blurEvents.map(event => `第 ${event.index} 秒 ${number(event.share * 100, 0)}%`).join('，') || '没有';
        parts.push(`**静止观察 ${hold.seconds} 秒：${variant.label}：** 加载 ${hold.loaded} 次，卸载 ${hold.unloaded} 次；画面变糊：${events}`, '');
      }
    }
  }

  parts.push('## 环境', '');
  parts.push(
    table(['项目', '值'], [
      ['GPU（实际使用）', env.gpu],
      ['系统里的显卡', env.adapters.join('；') || '读不到'],
      ['CPU', env.cpu],
      ['内存', `${env.memoryGB} GB`],
      ['系统', env.os],
      ['浏览器', env.browser],
      ['Node', env.node]
    ]),
    ''
  );
  parts.push('## 口径', '', METHOD, '');
  return parts.join('\n');
}

const SPLAT_MANUAL = `

## 高斯泼溅（ADR 0149 L.3）

在同一台机器上开开发服务器，打开 \`/dev/splat-watch\`，按 300 万、600 万、1000 万各看一遍（步骤见 docs/modules/map-three.md"泼溅的预算"）。

| 项目 | 怎么看 | 300 万 | 600 万 | 1000 万 |
|---|---|---|---|---|
| 移动时的手感 | 拖动、转动、缩放，卡不卡、有没有一顿一顿 | | | |
| 转动时排序闪不闪 | 原地转动，前后的高斯有没有闪烁、穿插 | | | |
| 加载新分块时 | 飞到没看过的地方，有没有卡顿、空洞多久补上 | | | |
| 细节够不够 | 近处的地面、树、文字清不清楚，和小预算比差别大不大 | | | |
| 亮处偏白 | 浅色的墙面、地面、楼梯上方是不是一片白；和 report.md 的"其中接近白色"、软件渲染的数对照 | | | |
| GL 监听 | 页面上"GL 错误"是不是 0，"库在渲染回调外的调用"有多少 | | | |

**选哪个预算作默认值，为什么：**

`;

// 比较了缓存上限：多一项肉眼比各档
const tierRow = (results: MeasureResults) =>
  results.runs.some(run => run.kind === 'quality' && run.variant !== DEFAULT_VARIANT)
    ? '| 缓存上限的各档 | "和产品默认值比"里两张并排，热力图标红的是默认值更糊的地方：肉眼看得出差别吗，到哪一档以后看不出了 | |\n'
    : '';

/** manual.md：脚本判断不了的 */
export function renderManual(results: MeasureResults): string {
  const splat = results.scenes.some(scene => scene.splat) ? SPLAT_MANUAL : '';
  if (results.scenes.every(scene => scene.splat)) {
    return `# 人工检查

环境：${results.environment.gpu}
${splat}`;
  }
  return `# 人工检查

环境：${results.environment.gpu}

打开结果目录里的 \`quality.html\`，逐个场景看，每项写一两句就够。

| 项目 | 怎么看 | 结果 |
|---|---|---|
| 画面清不清楚 | 每个场景稳定后的截图，看建筑的纹理、文字、边缘 | |
| 飞一圈回来的画面 | 和飞行前同一相机的两张并排，热力图里标红的格子重点看 | |
${tierRow(results)}| 清晰度的数字和肉眼相符吗 | 标红的格子，肉眼也觉得糊吗；没标红但肉眼觉得糊的地方有吗。不相符时告诉我哪里，我再调算法 | |

**其他观察：**
${splat}`;
}

const IMAGE_STYLE = 'max-width:100%;display:block;margin:4px 0';

const figure = (caption: string, src: string) => `<figure><figcaption>${caption}</figcaption><img src="${src}" style="${IMAGE_STYLE}"></figure>`;

const NOT_COMPARED = '<p>没有比较结果：全部跑完以后才比，比较出错时 report.md 里有提示。</p>';

const ratioHtml = ({ cells, medianRatio, worstDecileRatio }: SharpnessComparison) =>
  `比了 ${cells} 格，中位数 <b>${number(medianRatio, 2)}</b>，最差 10% <b>${number(worstDecileRatio, 2)}</b>`;

// 热力图和最差几格：left、right 是放大图左右两边各是哪一张
const pairImages = (pair: ShotPair, heading: string, onto: string, left: string, right: string) => `<${heading}>热力图（画在${onto}的那张上，格子里是比值，低于 0.93 标红、高于 1.1 标绿）</${heading}>
<img src="${pair.heatmap}" style="${IMAGE_STYLE}">
<${heading}>比值最低的几格，放大 3 倍（左 ${left}，右 ${right}）</${heading}>
<img src="${pair.worstCrops}" style="${IMAGE_STYLE}">`;

// 飞行前后：截图并排，比过的再加比值、热力图和最差几格的放大
// 截图的说明：状态不正常时不是稳定后的
const settledCaption = (status: RunStatus) => (status === 'ok' ? '稳定后' : `没稳定（${STATUS[status]}）`);

function afterFlightPart(shots: QualityResult, status: RunStatus, pair: ShotPair | null): string {
  if (status !== 'ok') {
    return `<p>这一遍${STATUS[status]}，截图不是稳定后的，不比较。</p>
<div class="pair">${figure(settledCaption(status), shots.shot)}</div>`;
  }
  if (!shots.shotAfterFlight) {
    return `<p>飞一圈回来没有稳定，没有拍，不比较。</p>
<div class="pair">${figure('稳定后', shots.shot)}</div>`;
  }
  const images = `<div class="pair">${figure('飞一圈回来', shots.shotAfterFlight)}${figure('飞行前', shots.shot)}</div>`;
  if (!pair) {
    return `${NOT_COMPARED}\n${images}`;
  }
  return `<p>飞一圈回来 / 飞行前的清晰度比值：${ratioHtml(pair.comparison)}</p>
${images}
${pairImages(pair, 'h3', '飞一圈回来', '飞一圈回来', '飞行前')}`;
}

interface ShotsOfRun {
  readonly shots: QualityResult;
  readonly status: RunStatus;
}

// 缓存上限的一档和产品默认值：稳定后同一相机的两张，热力图画在默认值那张上，红的是默认值更糊的地方
function versusDefaultPart(own: ShotsOfRun, fallback: ShotsOfRun | undefined, pair: ShotPair | null): string {
  if (!fallback) {
    return '';
  }
  const images = `<div class="pair">${figure(`产品默认值，${settledCaption(fallback.status)}`, fallback.shots.shot)}${figure(`这一档，${settledCaption(own.status)}`, own.shots.shot)}</div>`;
  let body = `${NOT_COMPARED}\n${images}`;
  if (own.status !== 'ok' || fallback.status !== 'ok') {
    body = `<p>默认值那一遍${STATUS[fallback.status]}、这一档${STATUS[own.status]}：有一边没稳定，不比较。</p>\n${images}`;
  } else if (pair) {
    body = `<p>产品默认值 / 这一档的清晰度比值：${ratioHtml(pair.comparison)}，低于 1 是默认值在那里更糊</p>
${images}
${pairImages(pair, 'h4', '产品默认值', '产品默认值', '这一档')}`;
  }
  return `<h3>和产品默认值比（同一相机）</h3>\n${body}`;
}

/** quality.html：每个场景每个跑了画质的方案一节，飞行前后的截图，缓存上限的各档再和产品默认值比 */
export function renderQualityPage(results: MeasureResults): string {
  const shotsOf = (scene: string, variant: string): ShotsOfRun | undefined => {
    const run = qualityRunOf(results, scene, variant);
    return run?.quality ? { shots: run.quality, status: run.status } : undefined;
  };
  const sections = results.scenes.flatMap(scene =>
    sceneVariants(results, scene).flatMap(({ id, label }) => {
      const own = shotsOf(scene.id, id);
      if (!own) {
        return [];
      }
      const compared = results.quality.find(item => item.scene === scene.id && item.variant === id);
      const fallback = id === DEFAULT_VARIANT ? undefined : shotsOf(scene.id, DEFAULT_VARIANT);
      return [
        `<section>
<h2>${id === DEFAULT_VARIANT ? scene.title : `${scene.title}，${label}`}</h2>
${afterFlightPart(own.shots, own.status, compared?.afterFlight ?? null)}
${versusDefaultPart(own, fallback, compared?.versusDefault ?? null)}
</section>`
      ];
    })
  );
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>飞行前后的截图</title>
<style>
body{font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;margin:24px;background:#fff;color:#222}
.pair{display:flex;gap:8px}.pair figure{flex:1;margin:0;min-width:0}figcaption{font-weight:600}
section{margin-bottom:48px}
</style></head><body>
<h1>飞行前后的截图</h1>
<p>每个场景同一相机的两张截图：稳定后，和飞一圈回来稳定后；比较缓存上限时每一档一节，再拿产品默认值稳定后的那张和这一档的比。清晰度怎样算：每张图先缩小一半（去掉像素级的锯齿），分成 16×9 格，每格算对数亮度的梯度能量，再除以缩小 4 倍后的梯度能量。取对数和比值，亮度、对比度整片的变化就不算糊，糊是高频丢失。比值是飞一圈回来除以飞行前、产品默认值除以这一档，只比模型占到四分之一以上的格子。数字只是提醒哪里可能糊，<b>结论以人看图为准</b>，写进 manual.md。</p>
${sections.join('\n') || '<p>还没有结果。</p>'}
</body></html>
`;
}
