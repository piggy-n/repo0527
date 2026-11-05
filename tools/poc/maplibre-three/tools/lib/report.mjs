// 从 raw.json 的内容生成 report.md 和 manual.md；每跑完一个场景就重新生成一次

const STATUS = { ok: '正常', timeout: '⚠ 超时', invalid: '✗ 无效', failed: '✗ 失败' };

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values) {
  const numbers = values.filter(isNumber).sort((a, b) => a - b);
  if (numbers.length === 0) {
    return null;
  }
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

const number = (value, digits = 1) => {
  if (!isNumber(value)) {
    return '—';
  }
  return Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(digits);
};

const integer = value => (isNumber(value) ? Math.round(value).toLocaleString('en-US') : '—');

// 重复跑时每个格子取中位数
const pick = (runs, read) => median(runs.map(run => read(run)));

function statusOf(runs) {
  const order = ['failed', 'invalid', 'timeout', 'ok'];
  const worst = order.find(status => runs.some(run => run.status === status)) ?? 'failed';
  return STATUS[worst] + (runs.length > 1 ? `（${runs.length} 次）` : '');
}

function frameCell(runs, phase, field = 'frame') {
  const values = key => pick(runs, run => run[phase]?.[field]?.[key]);
  if (values('p50') === null) {
    return null;
  }
  return `${number(values('mean'))} / ${number(values('p50'))} / ${number(values('p95'))} / ${number(values('p99'))} / ${number(values('max'))}`;
}

function gpuCell(runs, phase) {
  const cell = frameCell(runs, phase, 'gpu');
  if (cell) {
    return cell;
  }
  return runs.find(run => run[phase]?.gpuUnavailable)?.[phase].gpuUnavailable ? '取不到' : '—';
}

function longTaskCell(runs, read) {
  const value = key => pick(runs, run => read(run)?.[key]);
  if (value('count') === null) {
    return '—';
  }
  return `${integer(value('count'))} 次，最长 ${integer(value('maxMs'))}，共 ${integer(value('totalMs'))}（≥200：${integer(value('over200'))}，≥500：${integer(value('over500'))}）`;
}

function memoryCell(runs, kind, labels) {
  const first = pick(runs, run => run.memory?.[kind]?.[labels[0]]);
  const peak = pick(runs, run => run.memory?.[kind]?.peakMB);
  if (first === null && peak === null) {
    return kind === 'gpu' && runs.some(run => run.memory?.gpu?.unavailable) ? '取不到' : '—';
  }
  return `${integer(first)} / ${integer(peak)}`;
}

function topChunks(runs, phase) {
  const list = runs.find(run => run[phase]?.longTasks?.topChunks?.length)?.[phase].longTasks.topChunks;
  if (!list) {
    return '—';
  }
  return list.slice(0, 4).map(item => `${item.name} ${integer(item.ms)}`).join('，');
}

const ROWS = [
  ['状态', runs => statusOf(runs)],
  ['到稳定，从开始加载模型算（秒）', runs => {
    const value = pick(runs, run => run.load?.ttStableMs);
    const refused = pick(runs, run => run.load?.refusedAtStable);
    if (value === null) {
      return '—';
    }
    return number(value / 1000) + (runs.some(run => run.load && !run.load.stable) ? ' ⚠ 超时' : '') + (refused ? `（⚠ ${integer(refused)} 块瓦片被缓存拒绝，没加载完）` : '');
  }],
  ['到稳定，从打开页面算（秒）', runs => {
    const value = pick(runs, run => run.load?.ttFromNavigationMs);
    return value === null ? '—' : number(value / 1000);
  }],
  ['加载期 long task（毫秒）', runs => longTaskCell(runs, run => run.load?.longTasks)],
  ['加载期耗时最多的代码块（毫秒）', runs => {
    const list = runs.find(run => run.load?.longTasks?.topChunks?.length)?.load.longTasks.topChunks;
    return list ? list.slice(0, 4).map(item => `${item.name} ${integer(item.ms)}`).join('，') : '—';
  }],
  ['静止帧时间：平均/p50/p95/p99/最长（毫秒）', runs => frameCell(runs, 'static') ?? '—'],
  ['静止帧率（未封顶）', runs => number(pick(runs, run => run.static?.fps))],
  ['静止每帧 JS（p50 等，毫秒）', runs => frameCell(runs, 'static', 'js') ?? '—'],
  ['静止每帧 GPU（p50 等，毫秒）', runs => gpuCell(runs, 'static')],
  ['飞行第一遍帧时间：平均/p50/p95/p99/最长', runs => frameCell(runs, 'flightCold') ?? '—'],
  ['飞行第一遍 ≥50 / ≥100 / ≥200 毫秒的帧数', runs => {
    const value = key => pick(runs, run => run.flightCold?.overBudget?.[key]);
    return value('ms50') === null ? '—' : `${integer(value('ms50'))} / ${integer(value('ms100'))} / ${integer(value('ms200'))}`;
  }],
  ['飞行第一遍 long task（毫秒）', runs => longTaskCell(runs, run => run.flightCold?.longTasks)],
  ['飞行第一遍耗时最多的代码块（毫秒）', runs => topChunks(runs, 'flightCold')],
  ['飞行第一遍每帧 GPU（毫秒）', runs => gpuCell(runs, 'flightCold')],
  ['飞行后补齐瓦片（秒）', runs => {
    const value = pick(runs, run => run.settle?.ms);
    return value === null ? '—' : number(value / 1000) + (runs.some(run => run.settle && !run.settle.stable) ? ' ⚠ 没补齐' : '');
  }],
  ['补齐期 long task（毫秒）', runs => longTaskCell(runs, run => run.settle?.longTasks)],
  ['飞行第二遍帧时间：平均/p50/p95/p99/最长', runs => frameCell(runs, 'flightWarm') ?? '—'],
  ['飞行第二遍 long task（毫秒）', runs => longTaskCell(runs, run => run.flightWarm?.longTasks)],
  ['JS 堆：稳定时 / 峰值（MB）', runs => memoryCell(runs, 'heap', ['atStable'])],
  ['显存 Dedicated：稳定时 / 峰值（MB）', runs => memoryCell(runs, 'gpu', ['atStable'])],
  ['引擎自报的模型内存（MB）', runs => integer(pick(runs, run => run.engineStatic?.engineCacheMB ?? run.engineStatic?.splatGpuMB))],
  ['显示的瓦片数', runs => integer(pick(runs, run => run.engineStatic?.tilesVisible))],
  ['refused（缓存满了没加载的瓦片）', runs => {
    if (runs.every(run => run.engineStatic?.memoryAdjustedSse !== undefined)) {
      return `没有这一项；缓存压力下的屏幕误差 ${number(pick(runs, run => run.engineStatic?.memoryAdjustedSse))}`;
    }
    const start = pick(runs, run => run.engineStatic?.tilesRefused);
    const end = pick(runs, run => run.engineEnd?.tilesRefused);
    return start === null ? '—' : `静止 ${integer(start)}，飞行后 ${integer(end)}`;
  }],
  ['每帧三角形（GL 层统计）', runs => integer(pick(runs, run => run.draws?.primitivesPerFrame))],
  ['每帧 draw call（GL 层统计）', runs => integer(pick(runs, run => run.draws?.callsPerFrame))],
  ['引擎自报的三角形 / draw call', runs => `${integer(pick(runs, run => run.engineStatic?.engineTriangles))} / ${integer(pick(runs, run => run.engineStatic?.engineCalls))}`],
  ['模型占画面的比例（%）', runs => number(pick(runs, run => run.image?.modelCoveragePct))],
  ['GL 错误（控制台）', runs => integer(pick(runs, run => run.log?.glErrors))],
  ['页面错误', runs => integer(pick(runs, run => (run.pageErrorCount ?? 0) + (run.log?.pageErrors?.length ?? 0)))]
];

const LCC_ROWS = [
  ['显示的高斯数', runs => integer(pick(runs, run => run.engineStatic?.visibleSplats))],
  ['高斯内存：CPU / GPU，库的估算（MB）', runs => `${integer(pick(runs, run => run.engineStatic?.splatCpuMB))} / ${integer(pick(runs, run => run.engineStatic?.splatGpuMB))}`],
  ['gl-watch 纹理错误', runs => integer(pick(runs, run => run.glWatch?.textureErrors))],
  ['gl-watch 渲染回调外的调用', runs => {
    const outside = runs.find(run => run.glWatch)?.glWatch?.outside;
    return outside ? Object.entries(outside).map(([name, count]) => `${name} ${count}`).join('，') || '0' : '—';
  }]
];

function table(headers, rows) {
  const escapeCell = cell => String(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`)
  ].join('\n');
}

function groupRuns(raw) {
  const groups = new Map();
  for (const planned of raw.planned) {
    const key = planned.scene;
    if (!groups.has(key)) {
      groups.set(key, { id: key, title: planned.sceneTitle, variants: new Map() });
    }
    groups.get(key).variants.set(planned.variant, { label: planned.variantLabel, runs: [] });
  }
  for (const run of raw.runs) {
    groups.get(run.scene)?.variants.get(run.variant)?.runs.push(run);
  }
  return [...groups.values()];
}

function summaryRows(groups) {
  const rows = [];
  for (const group of groups) {
    for (const { label, runs } of group.variants.values()) {
      if (runs.length === 0) {
        rows.push([group.title, label, '还没跑', '', '', '', '', '', '']);
        continue;
      }
      const seconds = pick(runs, run => run.load?.ttStableMs);
      const refused = pick(runs, run => run.load?.refusedAtStable);
      const staticP95 = pick(runs, run => run.static?.frame?.p95);
      const flight = key => pick(runs, run => run.flightCold?.frame?.[key]);
      const tasks = key => pick(runs, run => run.load?.longTasks?.[key]);
      const flightTasks = key => pick(runs, run => run.flightCold?.longTasks?.[key]);
      rows.push([
        group.title,
        label,
        statusOf(runs),
        seconds === null ? '—' : number(seconds / 1000) + (refused ? ' ⚠ 没加载完' : ''),
        number(staticP95),
        flight('p50') === null ? '—' : `${number(flight('p50'))} / ${number(flight('p95'))} / ${number(flight('p99'))}`,
        tasks('count') === null ? '—' : `${integer(tasks('maxMs'))} / ${integer(tasks('totalMs'))}`,
        flightTasks('count') === null ? '—' : `${integer(flightTasks('maxMs'))} / ${integer(flightTasks('totalMs'))}`,
        memoryCell(runs, 'gpu', ['atStable'])
      ]);
    }
  }
  return rows;
}

function unavailableSection(raw) {
  const lines = [];
  const reasons = (read, title) => {
    const found = new Set(raw.runs.map(read).filter(Boolean));
    if (found.size > 0) {
      lines.push(`- **${title}：** ${[...found].slice(0, 3).join('；')}`);
    }
  };
  reasons(run => run.memory?.gpu?.unavailable, '显存（GPU Process Memory）');
  reasons(run => run.static?.gpuUnavailable, '每帧 GPU 耗时');
  if (raw.runs.some(run => run.setup && !run.setup.longAnimationFrame)) {
    lines.push('- **long animation frame 归因：** 这个浏览器不支持，代码块一栏为空；long task 不受影响。');
  }
  if (raw.runs.some(run => run.memory?.gpu?.peakMB === 0)) {
    lines.push('- **显存读数为 0：** 计数器读到了，但这个进程没有专用显存（软件渲染或显卡没有专用显存）。');
  }
  lines.push('- **Cesium 的 refused：** Cesium 没有这个统计。它在缓存不够时提高屏幕误差，所以报告里列的是 `memoryAdjustedScreenSpaceError`，大于 16 说明缓存有压力。');
  lines.push('- **Worker 的内存和耗时：** JS 堆只统计页面主线程。Cesium 把解码放在 Worker 里，这部分内存不在 JS 堆一栏；long task 也只统计主线程，这正是要比较的。');
  return lines.join('\n');
}

const METHOD = `- **冷启动：** 每个场景单独启动一个浏览器进程和空的配置目录，服务端发 \`Cache-Control: no-store\`，不受磁盘缓存影响。操作系统的文件缓存控制不了，重复跑（\`--repeat\`）时第二次起可能读盘更快。
- **模型来自本机服务：** 没有网络延迟，也没有 gzip。正式环境的下载更慢，所以"到稳定"是下限；主线程的解析成本不受影响。
- **解除 vsync：** 启动参数 \`--disable-gpu-vsync --disable-frame-rate-limit\`，帧时间不再封顶在刷新率上。启动前在空页面校准，结果写在"有效性"里。没有解除时帧时间可能被封顶，这时看每帧 JS 和每帧 GPU。
- **帧时间：** 两帧开始时刻的间隔。解除 vsync 以后，JS 提交得比 GPU 执行得快时命令会堆积：一串帧只有几毫秒，然后主线程被堵几秒，分位数和 long task 都失真。所以探针接管 \`requestAnimationFrame\`，用 fence 等上一帧在 GPU 上执行完才开始下一帧。这样帧时间约等于"每帧 JS + 每帧 GPU"，比真实流水线略保守（真实流水线里 JS 和 GPU 可以重叠），两个引擎的处理相同。和 16.7 毫秒比就是余量。
- **每帧 JS：** 同一帧所有 rAF 回调的总耗时，两个引擎用同一份代码。
- **每帧 GPU：** \`EXT_disjoint_timer_query_webgl2\`，只包住这一帧的回调，回调外的 GL 调用（如泼溅库的异步上传）不算在内。
- **静止：** 强制每帧重画（MapLibre 的 \`map.repaint\`，Cesium 的 \`requestRenderMode = false\`），否则静止时根本不渲染。
- **飞行：** 按时间走同一组关键帧（转满一圈，平移、缩放、俯仰都变），慢的引擎丢帧但走的路相同。第一遍边走边下载解析，第二遍大多在缓存里，两遍对比能分开渲染成本和解析卡顿。
- **Cesium 飞行时不请求瓦片：** 仓库的配置是 \`cullRequestsWhileMoving: true\`，所以它的解析卡顿可能落在"飞行后补齐"，要和方案 C 的第一遍飞行合起来看。
- **long task：** \`PerformanceObserver\` 的 \`longtask\`，主线程 50 毫秒以上的任务。代码块归因来自 \`long-animation-frame\`，名字是构建产物的分块（\`v-three\`、\`v-cesium\` 等）。
- **三角形和 draw call：** 在 WebGL 层统计 10 帧取平均，包括底图和地球本身，两个引擎口径相同。计数只在这 10 帧打开，不影响帧时间。
- **显存：** Windows 的 \`GPU Process Memory\` 计数器，取 GPU 进程的 Dedicated Usage（经 WMI 读同一个计数器，中文系统也能用）。只在阶段之间和加载期每 5 秒取一次，"峰值"是这些采样的最大值，不是真正的瞬时峰值。
- **空白判断：** 模型显示和隐藏各拍一张，比较差异。差异低于 0.2% 算模型没画出来，画面几乎只有一种颜色算空白，这两种都标为无效。
- **到稳定：** 模型的下载、解析队列连续约 1 秒都是空的（LCC2 约 3 秒，且显示的高斯数不再变化），从第一次变空算起。方案 C 缓存满了以后队列也是空的，这时只是不再加载，并不是加载完了，报告会标出 refused；缓存预算不同时，要结合显示的瓦片数、三角形数和截图一起看。
- **方案 C 的配置：** 自写 custom layer；\`errorTarget\` 16，和 Cesium 的 \`maximumScreenSpaceError\` 相同；所有瓦片集共用一个 LRU 缓存（默认 400 MB）。
- **Cesium 的配置：** 直接用 \`packages/map-cesium\` 的 \`SceneTilesets\`（384 MB 加 256 MB 溢出）、\`SceneUnderground\` 和 \`camera-math\`；\`CesiumWidget\` 的创建参数抄自 \`CesiumScene\`，因为它把 widget 藏在私有字段里，读不到统计。没有覆盖物和工具，只有底图和模型。
- **站内的方案 C：** "方案 C" 是地图里的自写层，模型抬高 20 米绕开 MapLibre 对相机的限制；"独立场景" 是单独的 Three 画布，没有底图，也没有 MapLibre。视场角都是 60°，和仓库的步行相同。`;

export function renderReport(raw) {
  const groups = groupRuns(raw);
  const { environment: env, validity } = raw;
  const parts = ['# 方案 C 与 Cesium 实测记录', ''];
  parts.push(`生成时间：${raw.meta.updatedAt}　提交：${raw.meta.commit ?? '未知'}　进度：${raw.runs.length} / ${raw.meta.plannedTotal}${raw.meta.finished ? '' : '（还在跑或被中断）'}`, '');
  if (validity.software) {
    parts.push(`> **⚠ 这次是软件渲染（${env.gpu}），所有数字都无效，只用来确认脚本能跑。**`, '');
  }
  if (validity.integrated) {
    parts.push(`> **⚠ 这次用的是集显（${env.gpu}），不代表独显的表现。**`, '');
  }
  if (raw.meta.quick) {
    parts.push('> **⚠ 这次用了 --quick，每段时长都被缩短，只用来确认脚本能跑。**', '');
  }
  parts.push('## 有效性', '');
  parts.push(table(['项目', '结果'], [
    ['渲染器', env.gpu],
    ['软件渲染', validity.software ? '是，结果无效' : '否'],
    ['帧率上限', validity.uncapped ? `已解除（空页面每帧 ${number(validity.rafMedianMs, 2)} 毫秒）` : `⚠ 没有解除（空页面每帧 ${number(validity.rafMedianMs, 2)} 毫秒），帧时间可能被封顶`],
    ['每帧 GPU 耗时', validity.timerQuery ? '可用' : '取不到（没有 EXT_disjoint_timer_query_webgl2）'],
    ['底图', raw.meta.basemap === 'arcgis' ? 'ArcGIS 影像（两个引擎相同）' : '无底图（两个引擎相同）'],
    ['视口 / DPR', `${raw.meta.viewport.width}×${raw.meta.viewport.height} / ${raw.meta.dpr}`]
  ]), '');
  if (raw.warnings.length > 0) {
    parts.push(raw.warnings.map(item => `- ${item}`).join('\n'), '');
  }
  parts.push('## 环境', '');
  parts.push(table(['项目', '值'], [
    ['GPU（实际使用）', env.gpu],
    ['系统里的显卡', env.adapters.length ? env.adapters.map(item => `${item.name}（驱动 ${item.driver ?? '未知'}）`).join('；') : '读不到'],
    ['CPU', `${env.cpu}，${env.cores} 线程`],
    ['内存', `${env.memoryGB} GB`],
    ['系统', env.os],
    ['浏览器', `${env.browserKind} ${env.browserVersion}`],
    ['Node', env.node]
  ]), '');
  parts.push('## 总览', '');
  parts.push('帧时间单位是毫秒，long task 是"最长 / 总和"（毫秒）。', '');
  parts.push(table(['场景', '方案', '状态', '到稳定（秒）', '静止 p95', '飞行 p50 / p95 / p99', '加载期 long task', '飞行 long task', '显存：稳定时 / 峰值（MB）'], summaryRows(groups)), '');

  const problems = raw.runs.filter(run => run.status !== 'ok' || run.notes.length > 0);
  parts.push('## 失败、超时和无效', '');
  if (problems.length === 0) {
    parts.push('没有。', '');
  } else {
    for (const run of problems) {
      const reasons = [run.error, ...(run.invalid ?? []), ...run.notes].filter(Boolean);
      parts.push(`- **${run.id}${run.repeat > 0 ? ` 第 ${run.repeat + 1} 次` : ''}：** ${STATUS[run.status]}。${reasons.join('；')}`);
    }
    parts.push('');
  }

  parts.push('## 各场景并排', '');
  for (const group of groups) {
    const variants = [...group.variants.values()];
    if (variants.every(({ runs }) => runs.length === 0)) {
      continue;
    }
    parts.push(`### ${group.title}`, '');
    const rows = [...ROWS, ...(group.id.startsWith('lcc2-') ? LCC_ROWS : [])];
    parts.push(
      table(
        ['指标', ...variants.map(({ label }) => label)],
        rows.map(([name, read]) => [name, ...variants.map(({ runs }) => (runs.length === 0 ? '还没跑' : read(runs)))])
      ),
      ''
    );
    const shots = variants.flatMap(({ label, runs }) => (runs[0] ? [`[${label}](screenshots/${runs[0].shot}.jpg)`] : []));
    if (shots.length > 0) {
      parts.push(`截图：${shots.join('，')}`, '');
    }
    const configs = variants.flatMap(({ label, runs }) => (runs[0]?.setup ? [`- ${label}：${JSON.stringify(runs[0].setup.config)}，画布 ${runs[0].setup.drawingBuffer.join('×')}，多重采样 ${runs[0].setup.samples}`] : []));
    if (configs.length > 0) {
      parts.push(configs.join('\n'), '');
    }
  }
  parts.push('## 取不到或要注意的指标', '', unavailableSection(raw), '');
  parts.push('## 口径', '', METHOD, '');
  return parts.join('\n');
}

export function renderManual(raw) {
  return `# 人工检查（脚本判断不了的）

先运行 \`pnpm manual\`，它会打开一个带链接的页面，每一项点对应的链接。关掉浏览器窗口后服务自动退出。每项写一两句就够。

环境：${raw.environment.gpu}

| 项目 | 怎么看 | 结果 |
|---|---|---|
| 第一人称手感 | WASD 走、左键拖动转头，比较方案 C（地图相机）、独立场景和 Cesium：有没有抖动、拖影、穿模、转头跟不跟手 | |
| z12 上下模型的出现方式 | 滚轮在 z13 和 z11 之间来回缩放：模型是突然消失、错位，还是平滑过渡 | |
| 转动时泼溅是否闪烁 | 按住右键转动：高斯的前后顺序有没有闪烁、跳变 | |
| 亮处偏白 | 看浅色墙面和地面：是否发白、丢失细节。有条件时和官方查看器对比 | |
| 模型和天地图目测对齐 | 配了天地图 key 时，放大到 z18 以上看建筑的底边和影像是否重合。没有 key 时写"没测" | |

**其他观察：**

`;
}
