import type { SceneInspection, TilesetInspection } from '@mx/map-cesium';
import type { CameraState } from '@mx/map-core';

// 诊断报告（纯函数）：会话里是原始采样，报告按姿态汇总成一行；Markdown 给人看，JSON 留着进一步分析

export type ProbeMode = 'sequence' | 'manual';

export type ProbeEventKind = 'warn' | 'error' | 'contextlost' | 'tilesetfailed';

export interface ProbeModel {
  readonly id: string;
  readonly name: string;
  /** tileset.json 的绝对地址 */
  readonly url: string;
}

export interface ProbeSize {
  readonly width: number;
  readonly height: number;
}

/** 运行环境：取自第一次读数和浏览器 */
export interface ProbeEnvironment {
  /** 开始时设定的屏幕误差（像素） */
  readonly requestedScreenSpaceError: number;
  readonly userAgent: string;
  /** 浏览器报告的显卡，取不到时为空串 */
  readonly renderer: string;
  readonly devicePixelRatio: number;
  readonly drawingBuffer: ProbeSize;
  readonly screen: ProbeSize;
  readonly window: ProbeSize;
  /** 瓦片集的显存预算、溢出余量和屏幕误差上限；读数里还没有瓦片集时为 null */
  readonly cacheBytes: number | null;
  readonly maximumCacheOverflowBytes: number | null;
  readonly maximumScreenSpaceError: number | null;
}

/** 自动序列里走过的一个姿态；时间是从开始记录起的毫秒数 */
export interface ProbePoseRecord {
  readonly label: string;
  readonly camera: CameraState;
  readonly startedMs: number;
  readonly endedMs: number;
}

export interface ProbeLongTasks {
  readonly count: number;
  readonly maxMs: number;
}

/** 一次采样；手动记录时 poseIndex 为 -1 */
export interface ProbeSample {
  readonly atMs: number;
  readonly poseIndex: number;
  readonly camera: CameraState | null;
  readonly inspection: SceneInspection;
  /** Chrome 的 performance.memory.usedJSHeapSize，其他浏览器没有 */
  readonly heapBytes?: number;
  /** 上次采样以来的长任务 */
  readonly longTasks: ProbeLongTasks;
}

/** 记录期间的事件；连续相同的只记一条、累计次数 */
export interface ProbeEvent {
  readonly atMs: number;
  readonly kind: ProbeEventKind;
  readonly message: string;
  readonly count: number;
}

export interface ProbeSession {
  readonly startedAt: string;
  readonly mode: ProbeMode;
  readonly model: ProbeModel;
  readonly environment: ProbeEnvironment;
  readonly poses: readonly ProbePoseRecord[];
  readonly samples: readonly ProbeSample[];
  readonly events: readonly ProbeEvent[];
}

/** 一次读数里所有瓦片集合起来的数（通常只有一个瓦片集） */
export interface InspectionTotals {
  readonly memoryBytes: number;
  /** 各瓦片集里最大的调整后屏幕误差 */
  readonly sse: number;
  /** 各瓦片集里最大的误差地板；都没定时为 null */
  readonly floor: number | null;
  readonly selected: number;
  readonly pending: number;
  readonly processing: number;
  readonly loaded: number;
  readonly unloaded: number;
  readonly failed: number;
  /** 每个瓦片集都已就绪；没有瓦片集时为 false */
  readonly tilesLoaded: boolean;
}

/** 一个姿态汇总成的一行；累计计数都是这个姿态期间的增量 */
export interface PoseSummary {
  readonly label: string;
  readonly durationS: number;
  readonly samples: number;
  readonly frames: number;
  readonly ticks: number;
  readonly memoryMaxMB: number;
  readonly memoryEndMB: number;
  readonly sseMin: number;
  readonly sseMax: number;
  readonly sseEnd: number;
  /** 结束时这个姿态定下的误差地板，没定时为 null */
  readonly floorEnd: number | null;
  readonly loaded: number;
  readonly unloaded: number;
  readonly failed: number;
  readonly selectedEnd: number;
  readonly pendingEnd: number;
  readonly processingEnd: number;
  readonly tilesLoadedEnd: boolean;
  readonly longTasks: ProbeLongTasks;
  /** 清晰→模糊的次数：相邻两次采样里选中的瓦片数从不少于 20 跌去三成以上 */
  readonly selectedDrops: number;
}

export interface ProbeReport {
  readonly session: ProbeSession;
  readonly poses: readonly PoseSummary[];
}

export interface ProbeReportFiles {
  readonly json: ProbeReport;
  readonly markdown: string;
}

const MB = 1024 * 1024;
// 清晰→模糊的判定：前一次采样选中的瓦片不少于这么多，这一次又少了三成以上
const DROP_FLOOR = 20;
const DROP_RATIO = 0.7;

const MODE_LABELS: Readonly<Record<ProbeMode, string>> = { sequence: '自动序列', manual: '手动记录' };
const EVENT_LABELS: Readonly<Record<ProbeEventKind, string>> = {
  warn: 'console.warn',
  error: 'console.error',
  contextlost: 'WebGL 上下文丢失',
  tilesetfailed: '瓦片加载失败'
};

// 最多一位小数
const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const mb = (bytes: number): string => fmt(bytes / MB);
const oneDecimal = (value: number): number => Math.round(value * 10) / 10;
const nullable = (value: number | null, format: (value: number) => string): string =>
  value === null ? '未知' : format(value);

/** 把一次读数里的各瓦片集合起来 */
export function summarizeInspection({ tilesets }: SceneInspection): InspectionTotals {
  const sum = (pick: (tileset: TilesetInspection) => number) =>
    tilesets.reduce((total, tileset) => total + pick(tileset), 0);
  const floors = tilesets.flatMap(({ screenSpaceErrorFloor }) =>
    screenSpaceErrorFloor === null ? [] : [screenSpaceErrorFloor]
  );
  return {
    memoryBytes: sum(tileset => tileset.totalMemoryUsageInBytes),
    sse: tilesets.reduce((max, tileset) => Math.max(max, tileset.memoryAdjustedScreenSpaceError), 0),
    floor: floors.length === 0 ? null : Math.max(...floors),
    selected: sum(tileset => tileset.statistics.selected),
    pending: sum(tileset => tileset.statistics.numberOfPendingRequests),
    processing: sum(tileset => tileset.statistics.numberOfTilesProcessing),
    loaded: sum(tileset => tileset.loaded),
    unloaded: sum(tileset => tileset.unloaded),
    failed: sum(tileset => tileset.failed),
    tilesLoaded: tilesets.length > 0 && tilesets.every(tileset => tileset.tilesLoaded)
  };
}

function emptySummary(label: string, durationS: number): PoseSummary {
  return {
    label,
    durationS,
    samples: 0,
    frames: 0,
    ticks: 0,
    memoryMaxMB: 0,
    memoryEndMB: 0,
    sseMin: 0,
    sseMax: 0,
    sseEnd: 0,
    floorEnd: null,
    loaded: 0,
    unloaded: 0,
    failed: 0,
    selectedEnd: 0,
    pendingEnd: 0,
    processingEnd: 0,
    tilesLoadedEnd: false,
    longTasks: { count: 0, maxMs: 0 },
    selectedDrops: 0
  };
}

// 累计计数的增量以 baseline（这个姿态之前的最后一次采样）为起点；没有时以姿态里的第一次采样为起点
function summarizePose(
  label: string,
  startedMs: number,
  endedMs: number,
  samples: readonly ProbeSample[],
  baseline: ProbeSample | undefined
): PoseSummary {
  const durationS = oneDecimal((endedMs - startedMs) / 1000);
  const last = samples.at(-1);
  const base = baseline ?? samples.at(0);
  if (!last || !base) {
    return emptySummary(label, durationS);
  }
  const totals = samples.map(sample => summarizeInspection(sample.inspection));
  const end = summarizeInspection(last.inspection);
  const start = summarizeInspection(base.inspection);
  const selectedDrops = totals.filter(
    (current, index) =>
      index > 0 && totals[index - 1].selected >= DROP_FLOOR && current.selected < totals[index - 1].selected * DROP_RATIO
  ).length;
  return {
    label,
    durationS,
    samples: samples.length,
    frames: last.inspection.frames - base.inspection.frames,
    ticks: last.inspection.ticks - base.inspection.ticks,
    memoryMaxMB: oneDecimal(Math.max(...totals.map(({ memoryBytes }) => memoryBytes)) / MB),
    memoryEndMB: oneDecimal(end.memoryBytes / MB),
    sseMin: oneDecimal(Math.min(...totals.map(({ sse }) => sse))),
    sseMax: oneDecimal(Math.max(...totals.map(({ sse }) => sse))),
    sseEnd: oneDecimal(end.sse),
    floorEnd: end.floor === null ? null : oneDecimal(end.floor),
    loaded: end.loaded - start.loaded,
    unloaded: end.unloaded - start.unloaded,
    failed: end.failed - start.failed,
    selectedEnd: end.selected,
    pendingEnd: end.pending,
    processingEnd: end.processing,
    tilesLoadedEnd: end.tilesLoaded,
    longTasks: {
      count: samples.reduce((count, sample) => count + sample.longTasks.count, 0),
      maxMs: oneDecimal(Math.max(0, ...samples.map(sample => sample.longTasks.maxMs)))
    },
    selectedDrops
  };
}

// 手动记录没有姿态：整段算一行
function poseSummaries(session: ProbeSession): PoseSummary[] {
  const { poses, samples } = session;
  if (poses.length === 0) {
    return [summarizePose('手动记录', samples.at(0)?.atMs ?? 0, samples.at(-1)?.atMs ?? 0, samples, undefined)];
  }
  return poses.map((pose, index) => {
    const own = samples.filter(sample => sample.poseIndex === index);
    const first = own.at(0);
    const firstIndex = first ? samples.indexOf(first) : -1;
    return summarizePose(pose.label, pose.startedMs, pose.endedMs, own, firstIndex > 0 ? samples[firstIndex - 1] : undefined);
  });
}

function rowOf(row: PoseSummary): string {
  const cells = [
    row.label,
    fmt(row.durationS),
    `${row.frames} / ${row.ticks}`,
    `${fmt(row.memoryMaxMB)} / ${fmt(row.memoryEndMB)}`,
    `${fmt(row.sseMin)} / ${fmt(row.sseMax)} / ${fmt(row.sseEnd)}`,
    row.floorEnd === null ? '—' : fmt(row.floorEnd),
    `${row.loaded} / ${row.unloaded} / ${row.failed}`,
    String(row.selectedEnd),
    `${row.pendingEnd} + ${row.processingEnd}`,
    row.tilesLoadedEnd ? '是' : '否',
    `${row.longTasks.count} / ${fmt(row.longTasks.maxMs)}`,
    String(row.selectedDrops)
  ];
  return `| ${cells.join(' | ')} |`;
}

// 相同的事件合成一条，记第一次出现的时刻
function eventLines(events: readonly ProbeEvent[]): string[] {
  if (events.length === 0) {
    return ['没有记录到事件'];
  }
  const merged = new Map<string, { kind: ProbeEventKind; message: string; count: number; firstMs: number }>();
  for (const event of events) {
    const key = `${event.kind}\n${event.message}`;
    const entry = merged.get(key);
    if (entry) {
      entry.count += event.count;
    } else {
      merged.set(key, { kind: event.kind, message: event.message, count: event.count, firstMs: event.atMs });
    }
  }
  return [...merged.values()].map(
    ({ firstMs, kind, count, message }) =>
      `- ${fmt(firstMs / 1000)} s 起 [${EVENT_LABELS[kind]}] ×${count}：${message.replace(/\s+/g, ' ')}`
  );
}

function markdownOf(session: ProbeSession, rows: readonly PoseSummary[]): string {
  const { model, environment } = session;
  const lines = [
    '# 瓦片集加载诊断',
    '',
    `- 模型：${model.name}（${model.id}）`,
    `- 地址：${model.url}`,
    `- 开始时间：${session.startedAt}`,
    `- 方式：${MODE_LABELS[session.mode]}`,
    `- 采样 ${session.samples.length} 次，事件 ${session.events.reduce((count, event) => count + event.count, 0)} 次`,
    '',
    '## 环境',
    '',
    `- 显卡：${environment.renderer || '未知（取不到 WEBGL_debug_renderer_info）'}`,
    `- 浏览器：${environment.userAgent}`,
    `- 屏幕：${environment.screen.width} × ${environment.screen.height}，` +
      `窗口 ${environment.window.width} × ${environment.window.height}，` +
      `devicePixelRatio ${fmt(environment.devicePixelRatio)}`,
    `- 绘图缓冲：${environment.drawingBuffer.width} × ${environment.drawingBuffer.height}`,
    `- 瓦片集：显存预算 ${nullable(environment.cacheBytes, mb)} MB + ` +
      `溢出 ${nullable(environment.maximumCacheOverflowBytes, mb)} MB，` +
      `屏幕误差上限 ${nullable(environment.maximumScreenSpaceError, fmt)}（设定 ${fmt(environment.requestedScreenSpaceError)}）`,
    '',
    '## 各姿态',
    '',
    '| 姿态 | 时长 (s) | 帧 / tick | 显存峰值 / 结束 (MB) | 调整后误差 最小 / 最大 / 结束 | 误差地板 | 加载 / 卸载 / 失败 | ' +
      '结束时选中 | 等待 + 处理 | 全部就绪 | 长任务 次数 / 最长 (ms) | 清晰→模糊 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(rowOf),
    '',
    '## 事件',
    '',
    ...eventLines(session.events),
    '',
    '## 怎么读',
    '',
    '- 显存峰值接近预算（预算 + 溢出），同一姿态里"调整后误差"又从最小升到最大，说明 Cesium 为了把显存压回预算放宽了精度：' +
      '这就是先清晰、后模糊',
    '- "误差地板"是这个姿态里为了不超显存定下的最低精度，有值说明显存不够、精度被钉在了这个数上',
    '- 相机没动的姿态里"加载 / 卸载"都很大、"清晰→模糊"不为 0，说明瓦片装进来又被丢掉、再装回来，在循环',
    '- 结束时"等待 + 处理"不为 0 或"全部就绪"为否，说明这个姿态在时限内没有加载完；"失败"不为 0 时看事件里的瓦片加载失败',
    '- 长任务多、最长超过 1000 ms，说明主线程被解码卡住；事件里的 WebGL 上下文丢失会让画面整个消失',
    '- 自动序列里每个姿态至少停几秒，瓦片都就绪、调整后误差稳定后才换下一个，到上限强制换；手动记录是整段一行'
  ];
  return `${lines.join('\n')}\n`;
}

/** 由一次记录生成报告：JSON 带原始采样和按姿态的汇总，Markdown 是汇总表加说明 */
export function buildProbeReport(session: ProbeSession): ProbeReportFiles {
  const poses = poseSummaries(session);
  return { json: { session, poses }, markdown: markdownOf(session, poses) };
}
