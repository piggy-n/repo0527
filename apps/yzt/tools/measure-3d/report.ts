import type { SceneSample, PhaseResult, TileQueues } from './bench-api.ts';
import type { ProfileSummary } from './profile.ts';
import type { MeasureResults, RunResult } from './results.ts';
import {
  allPassed,
  FILL_REACHED_RATIO,
  fillReachedAt,
  fillSampleAt,
  MACHINE_DRIFT_RATIO,
  machineDrift,
  median,
  sceneVerdict,
  type VerdictRow
} from './verdict.ts';

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

// 瓦片排在哪一步（MapLibre 引擎）：飞行中的中位数。Cesium 没有这些读数
function queueDetail(runs: readonly RunResult[], phase: 'flightCold' | 'flightWarm'): string {
  const of = (read: (queues: TileQueues) => number) =>
    pick(runs, run => median((run[phase]?.trace ?? []).map(sample => (sample.queues ? read(sample.queues) : null))));
  const value = of(queues => queues.used);
  if (value === null) {
    return '—';
  }
  return `${integer(of(queues => queues.downloading))} / ${integer(of(queues => queues.parsing))} / ${integer(of(queues => queues.culled))} / ${integer(value)} / ${integer(of(queues => queues.usedOutOfView))}`;
}

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
  ['第一遍飞行：上传 贴图 / 缓冲（MB）/ 最多的一帧', runs =>`${integer(pick(runs, run => run.flightCold?.uploads.textureMB))} / ${integer(pick(runs, run => run.flightCold?.uploads.bufferMB))} / ${number(pick(runs, run => run.flightCold?.uploads.maxFrameMB))}`],
  ['飞行后补齐（秒）', runs => number((pick(runs, run => run.settle?.ms) ?? Number.NaN) / 1000)],
  ['第二遍飞行：每帧工作量', runs => summaryCell(runs, run => run.flightWarm?.work)],
  ['第二遍飞行：帧间隔', runs => summaryCell(runs, run => run.flightWarm?.interval)],
  ['第二遍飞行：≥33 / ≥50 / ≥100 毫秒的帧', runs => `${integer(pick(runs, run => run.flightWarm?.over.ms33))} / ${integer(pick(runs, run => run.flightWarm?.over.ms50))} / ${integer(pick(runs, run => run.flightWarm?.over.ms100))}`],
  ['第二遍飞行：屏幕误差 中位 / 最高，三角形（万）中位 / 最低', runs => flightDetail(runs, 'flightWarm')],
  ['第二遍飞行：下载中 / 解析中 / 没请求 / 在用 / 其中视野外（块，中位）', runs => queueDetail(runs, 'flightWarm')],
  ['第二遍飞行：长任务 次数 / 最长', runs =>`${integer(pick(runs, run => run.flightWarm?.longTasks.count))} / ${integer(pick(runs, run => run.flightWarm?.longTasks.maxMs))}`],
  ['画面恢复（秒）', runs => number((pick(runs, run => run.recovery?.ms) ?? Number.NaN) / 1000)],
  ['稳定时：瓦片 / 三角形', runs => `${integer(pick(runs, run => run.atStable?.tilesVisible))} / ${integer(pick(runs, run => run.atStable?.triangles))}`],
  ['稳定时：屏幕误差 / 引擎估算的模型显存（MB）', runs => `${number(pick(runs, run => run.atStable?.errorTarget))} / ${integer(pick(runs, run => run.atStable?.cacheMB))}`],
  ['恢复后：瓦片 / 三角形 / 屏幕误差', runs => `${integer(pick(runs, run => run.atRecovered?.tilesVisible))} / ${integer(pick(runs, run => run.atRecovered?.triangles))} / ${number(pick(runs, run => run.atRecovered?.errorTarget))}`],
  ['显存：稳定时 / 峰值（MB）', runs => `${integer(pick(runs, run => run.memory?.gpuAtStableMB))} / ${integer(pick(runs, run => run.memory?.gpuPeakMB))}`],
  ['JS 堆峰值（MB）', runs => integer(pick(runs, run => run.memory?.heapPeakMB))],
  ['模型占画面的比例（%）', runs => number(pick(runs, run => run.image?.modelCoveragePct))],
  ['页面错误 / GL 错误', runs => `${integer(pick(runs, run => run.pageErrors?.length ?? 0))} / ${integer(pick(runs, run => run.glErrors ?? 0))}`]
];

const verdictMark = ({ pass }: VerdictRow) => (pass === null ? '算不出' : pass ? '通过' : '**不通过**');

function verdictTable(rows: readonly VerdictRow[]): string {
  return table(
    ['类别', '条件', 'MapLibre', 'Cesium', '结果'],
    rows.map(row => [row.group, row.condition, `${number(row.subject, 2)} ${row.unit}`, row.reference === null ? '—' : `${number(row.reference, 2)} ${row.unit}`, verdictMark(row)])
  );
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

const finalOf = (run: RunResult) => run.settle?.trace.at(-1);

/** 飞行后画面怎样变：两个引擎终点的粗细不同，只比"补齐"的时间看不出用户看到什么 */
function fillLines(perf: readonly { readonly id: string; readonly label: string; readonly runs: readonly RunResult[] }[]): string[] {
  const measured = perf.filter(item => item.runs.some(run => run.settle?.trace.length));
  if (measured.length === 0) {
    return [];
  }
  const rows = measured.map(({ label, runs }) => [
    label,
    ...FILL_TIMES.map(t => fillCell(runs, run => fillSampleAt(run.settle?.trace ?? [], t))),
    fillCell(runs, finalOf)
  ]);
  const parts = ['**飞行后的过程（第一遍）：** 每格是屏幕误差 / 三角形（万）', '', table(['方案', ...FILL_TIMES.map(t => `${t / 1000} 秒`), '最后'], rows), ''];
  const reference = perf.find(item => item.id === 'cesium');
  const final = reference ? pick(reference.runs, run => finalOf(run)?.triangles) : null;
  if (final !== null) {
    const target = final * FILL_REACHED_RATIO;
    for (const { id, label, runs } of measured) {
      if (id !== 'cesium') {
        const reached = pick(runs, run => fillReachedAt(run.settle?.trace ?? [], target));
        parts.push(`${label} 到 Cesium 终点的 ${FILL_REACHED_RATIO * 100}%（${number(target / WAN)} 万个三角形）用了 ${reached === null ? '—' : number(reached / 1000, 2)} 秒`, '');
      }
    }
  }
  return parts;
}

const METHOD = `- **都是生产代码：** 真实的 \`MapSession\`、\`MapLibreView\` + \`ThreeSceneRenderer\`、\`CesiumView\` + \`CesiumScene\`，生产模式构建；页面只有底图和模型。按包分块，方便归因，运行的代码相同。
- **冷启动：** 每遍一个新的浏览器进程和空的配置目录，服务端发 \`Cache-Control: no-store\`。操作系统的文件缓存控制不了。
- **模型来自本机服务（设了 \`YZT_3DT_PROXY\` 时除外）：** 没有网络延迟，"到稳定"是下限；主线程的解析成本不受影响。
- **每帧工作量：** 同一帧的 JS 加 GPU，验收的 p50、p95、p99 看它。帧间隔有下限（见"有效性"里的校准），看不出余量；工作量不受影响。
- **≥50 毫秒的帧：** 看实际帧间隔：这个长度远高于下限，而且能抓到不在工作量里的卡顿（垃圾回收、合成）。
- **每帧 GPU：** \`EXT_disjoint_timer_query_webgl2\`，只包住这一帧的回调。Cesium 开 4 倍多重采样，离屏解析在计时内；MapLibre 默认不开（和产品一样），所以 GPU 这一项不是同样的画法，要比就加 \`--antialias\` 再跑一次。
- **上传假设：** 每帧的 \`texImage2D\`、\`texSubImage2D\`、\`bufferData\` 的字节和 \`generateMipmap\` 次数，和这一帧的 GPU 耗时放在一起。按上传量分桶后 GPU 耗时随上传量上涨，才说明尖峰来自上传。
- **长任务归因：** 单独跑一遍带 CDP CPU 采样，页面报的每个长任务按分块（three、maplibre-gl、cesium……）和原生调用（\`linkProgram\`、\`texSubImage2D\`）汇总。\`profiles/\` 里的 \`.cpuprofile\` 可以用 DevTools 打开。创建 WebGL 上下文另外包住 \`getContext\` 量，每一遍都有：它和瓦片无关，同一台机器上 0.6～1.2 秒来回跳。
- **清晰度：** 单独跑一遍，同一相机拍截图。见 \`quality.html\` 的说明。
- **到稳定：** 引擎报告瓦片都到了（MapLibre 还要上传队列空、屏幕误差不再变），连续 1 秒。飞行后补齐从飞行结束的时刻算；这个数只说明引擎不再动，不说明画面一样细：Cesium 飞完不一定回到飞行前的粗细，要一起看"飞行后的过程"。所以验收不比这个数，比到 Cesium 终点的 98% 用了多久，和终点的三角形。
- **显存：** Windows 的 GPU Process Memory 计数器，取 GPU 进程的专用显存，采样的最大值不是真正的瞬时峰值。`;

/** report.md */
export function renderReport(results: MeasureResults): string {
  const { meta, environment: env, runs, quality } = results;
  const parts: string[] = ['# MapLibre 引擎和 Cesium 的实测（ADR 0147 3C.4）', ''];
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

  parts.push('## 验收', '');
  for (const scene of results.scenes) {
    const sceneRuns = runs.filter(run => run.scene === scene.id);
    if (sceneRuns.length === 0) {
      continue;
    }
    const rows = sceneVerdict(sceneRuns, quality.find(item => item.scene === scene.id));
    parts.push(`### ${scene.title}${scene.acceptance ? '' : '（不在验收里）'}：${allPassed(rows) ? '全部通过' : '没有全部通过'}`, '', verdictTable(rows), '');
  }
  parts.push('"截图不比 Cesium 糊"最后要人工看 `quality.html`，结论写进 `manual.md`。', '');

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
      ['底图', meta.basemap === 'arcgis' ? 'ArcGIS 影像（两个引擎相同）' : '无底图（两个引擎相同）'],
      ['视口', `${meta.viewport.width}×${meta.viewport.height}`],
      ['MapLibre 多重采样', meta.antialias ? '开' : '不开（和产品一样）']
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
    const perf = results.variants.map(({ id, label }) => ({
      id,
      label,
      runs: runs.filter(run => run.scene === scene.id && run.variant === id && run.kind === 'perf')
    }));
    if (perf.every(item => item.runs.length === 0)) {
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
    for (const variant of results.variants) {
      const profile = runs.find(run => run.scene === scene.id && run.variant === variant.id && run.kind === 'profile')?.profile;
      if (profile) {
        parts.push(`**长任务归因：${variant.label}**`, '', ...profileLines('加载期', profile.load), ...profileLines('飞行中', profile.flight));
      }
    }
    for (const variant of results.variants) {
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

/** manual.md：脚本判断不了的 */
export function renderManual(results: MeasureResults): string {
  return `# 人工检查

环境：${results.environment.gpu}

打开结果目录里的 \`quality.html\`，逐个场景看，每项写一两句就够。

| 项目 | 怎么看 | 结果 |
|---|---|---|
| 不比 Cesium 糊（z17） | 左右两张同一相机的截图，看建筑的纹理、文字、边缘；热力图里标红的格子重点看 | |
| 不比 Cesium 糊（z19） | 同上 | |
| 清晰度的数字和肉眼相符吗 | 标红的格子，肉眼也觉得糊吗；没标红但肉眼觉得糊的地方有吗。不相符时告诉我哪里，我再调算法 | |
| 飞一圈回来的画面 | "飞行后"那一组 | |

**其他观察：**

`;
}

const IMAGE_STYLE = 'max-width:100%;display:block;margin:4px 0';

/** quality.html：并排的截图、热力图和最差几格的放大 */
export function renderQualityPage(results: MeasureResults): string {
  const sections = results.quality.map(item => {
    const scene = results.scenes.find(({ id }) => id === item.scene);
    const after = item.afterFlight
      ? `<p>飞一圈回来：比了 ${item.afterFlight.cells} 格，中位数 ${number(item.afterFlight.medianRatio, 2)}，最差 10% ${number(item.afterFlight.worstDecileRatio, 2)}</p>`
      : '';
    return `<section>
<h2>${scene?.title ?? item.scene}</h2>
<p>MapLibre / Cesium 的清晰度比值：比了 ${item.stable.cells} 格，中位数 <b>${number(item.stable.medianRatio, 2)}</b>，最差 10% <b>${number(item.stable.worstDecileRatio, 2)}</b></p>
${after}
<div class="pair"><figure><figcaption>MapLibre</figcaption><img src="${item.subject}" style="${IMAGE_STYLE}"></figure><figure><figcaption>Cesium</figcaption><img src="${item.reference}" style="${IMAGE_STYLE}"></figure></div>
<h3>热力图（格子里是比值，低于 0.93 标红、高于 1.1 标绿）</h3>
<img src="${item.heatmap}" style="${IMAGE_STYLE}">
<h3>比值最低的几格，放大 3 倍（左 MapLibre，右 Cesium）</h3>
<img src="${item.worstCrops}" style="${IMAGE_STYLE}">
</section>`;
  });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>截图对比</title>
<style>
body{font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;margin:24px;background:#fff;color:#222}
.pair{display:flex;gap:8px}.pair figure{flex:1;margin:0;min-width:0}figcaption{font-weight:600}
section{margin-bottom:48px}
</style></head><body>
<h1>截图对比（ADR 0147 3C.4）</h1>
<p>怎样算：每张图先缩小一半（去掉像素级的锯齿），分成 16×9 格，每格算对数亮度的梯度能量，再除以缩小 4 倍后的梯度能量。取对数和比值是为了抵消两个引擎光照的不同：光照差异是乘性的、整片的，糊是高频丢失。只比模型占到四分之一以上的格子。数字只是提醒哪里可能糊，<b>结论以人看图为准</b>，写进 manual.md。</p>
${sections.join('\n') || '<p>还没有结果。</p>'}
</body></html>
`;
}
