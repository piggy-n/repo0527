import { LatestController } from '@yzt/utils';
import { onScopeDispose, reactive, ref, shallowRef } from 'vue';
import type { FileDownloadTask, useFileDownloads } from '@/features/file-management/composables/useFileDownloads';
import type {
  FilePreviewContent,
  FilePreviewPhase,
  useFilePreview
} from '@/features/file-management/composables/useFilePreview';
import { type FilePreviewKind, filePreviewType, type FileTransferTarget } from '@/features/file-management/file-types';
import docxUrl from '@/features/file-management/fixtures/sample.docx?url';
import pdfUrl from '@/features/file-management/fixtures/sample.pdf?url';
import pngUrl from '@/features/file-management/fixtures/sample.png?url';
import type { TransferProgress } from '@/shared/file-transfer';
import type { DownloadTask } from '@/shared/file-transfer/useDownloads';

/** 样例文件：固定的元数据，不读取用户文件 */
export interface PreviewSample extends FileTransferTarget {
  year: string;
  tag: string;
}

export type DownloadScene = 'success' | 'unknown' | 'error' | 'waiting' | 'checking';
export type ReadScene = 'success' | 'error' | 'render-error' | 'waiting';

// 模拟的文件大小和节奏：每 600 毫秒接收 10%
const SAMPLE_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TICK = 600;
const READ_DELAY = 1200;

const SAMPLE_TEXT = [
  '调查成果目录说明',
  '',
  '一、成果组成',
  '01  调查范围与工作说明',
  '02  成果清单与质量检查记录',
  '03  汇交材料与附表',
  '',
  '二、备注',
  '这是固定文本示例，用于确认阅读、换行和关闭交互。',
  '',
  '长行示例：江苏省自然资源统一调查监测成果质量检查与汇交说明及附表（征求意见稿），正文自动换行，完整内容可在阅读区滚动查看。'
].join('\n');

/** 和正式页同一个预览范围 */
export const canPreviewSample = (file: { type: string }) => filePreviewType(file.type) !== undefined;

// percent 为已接收的百分比；总量未知时只给出字节数
function progressOf(percent: number, unknownTotal: boolean): TransferProgress {
  const loaded = Math.round(SAMPLE_BYTES * percent / 100);
  return unknownTotal ? { loaded, total: null, percent: null } : { loaded, total: SAMPLE_BYTES, percent };
}

/**
 * 下载演示使用正式 DownloadPanel，按 scene 模拟结果，不发请求、不保存文件
 */
export function useDownloadSample() {
  const scene = ref<DownloadScene>('success');
  const tasks = ref<FileDownloadTask[]>([]);
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  function stop(id: string) {
    clearInterval(timers.get(id));
    timers.delete(id);
  }

  async function start(file: FileTransferTarget): Promise<void> {
    if (timers.has(file.id)) {
      return;
    }
    const result = scene.value;
    const task = reactive<FileDownloadTask>({ file: { ...file }, phase: 'receiving', progress: null, failure: '' });
    tasks.value = [task, ...tasks.value.filter(item => item.file.id !== file.id)];
    let received = 0;
    const timer = setInterval(() => {
      // "持续接收"停在 40%
      if (result === 'waiting' && received >= 40) {
        return;
      }
      received += 10;
      task.progress = progressOf(received, result === 'unknown');
      if (result === 'error' && received >= 60) {
        task.phase = 'error';
        task.failure = '下载失败，请重试';
      } else if (received === 100) {
        // "检查内容"停在检查阶段，用来看这个状态的排版
        task.phase = result === 'checking' ? 'checking' : 'done';
      }
      if (task.phase !== 'receiving') {
        stop(file.id);
      }
    }, DOWNLOAD_TICK);
    timers.set(file.id, timer);
  }

  function cancel(task: DownloadTask) {
    stop(task.file.id);
    task.phase = 'canceled';
  }

  const isDownloading = (id: string) =>
    tasks.value.some(task => task.file.id === id && (task.phase === 'receiving' || task.phase === 'checking'));

  function clearFinished() {
    tasks.value = tasks.value.filter(task => isDownloading(task.file.id));
  }

  function clearAll() {
    for (const id of timers.keys()) {
      stop(id);
    }
    tasks.value = [];
  }

  /** 一次列出各种状态（静止不动），方便核对排版；不改变进度区的展开状态 */
  function showStates(file: PreviewSample) {
    clearAll();
    const sample = (id: string, name: string, patch: Partial<FileDownloadTask>): FileDownloadTask => ({
      file: { ...file, id, name },
      phase: 'receiving',
      progress: null,
      failure: '',
      ...patch
    });
    tasks.value = [
      sample('demo-receiving', file.name, { progress: progressOf(37, false) }),
      sample('demo-unknown', '调查区域影像成果附件.zip', { progress: progressOf(64, true) }),
      sample('demo-checking', '年度成果汇交说明.pdf', { phase: 'checking', progress: progressOf(100, false) }),
      sample('demo-error', '质量检查记录.pdf', { phase: 'error', failure: '下载失败，请重试' }),
      sample('demo-done', '调查区域示意图.png', { phase: 'done', progress: progressOf(100, false) }),
      sample('demo-canceled', '调查成果目录说明.txt', { phase: 'canceled', progress: progressOf(25, false) })
    ];
  }

  onScopeDispose(clearAll);

  async function retry(id: string) {
    const task = tasks.value.find(item => item.file.id === id);
    if (task) {
      await start(task.file);
    }
  }

  const model: ReturnType<typeof useFileDownloads> = { tasks, start, retry, cancel, isDownloading, clearFinished };
  return { ...model, scene, clearAll, showStates };
}

// 模拟读取的耗时；中止时以 AbortError 结束
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('演示已取消', 'AbortError'));
      },
      { once: true }
    );
  });
}

// 样例内容：仓库里自建的 DOCX、PDF、PNG（features/file-management/fixtures），文本是固定的
async function sampleContent(kind: FilePreviewKind, signal: AbortSignal): Promise<FilePreviewContent> {
  if (kind === 'text') {
    return { kind, text: SAMPLE_TEXT, signal };
  }
  if (kind === 'docx') {
    const response = await fetch(docxUrl, { signal });
    return { kind, blob: await response.blob(), signal };
  }
  return { kind, url: kind === 'pdf' ? pdfUrl : pngUrl, signal };
}

/**
 * 预览的演示：接口和 useFilePreview 一样，交给正式的 FilePreviewDialog 显示（DOCX 真实渲染）；
 * 按 scene 模拟读取结果，失败的演示只失败一次，方便在弹窗里直接验证重试
 */
export function usePreviewSample() {
  const scene = ref<ReadScene>('success');
  const operation = new LatestController();
  const file = shallowRef<FileTransferTarget | null>(null);
  const content = shallowRef<FilePreviewContent | null>(null);
  const visible = ref(false);
  const phase = ref<FilePreviewPhase>('reading');
  const progress = shallowRef<TransferProgress | null>(null);
  const failure = ref('');
  const zoom = ref(100);
  // "显示失败一次"：内容显示出来时报告失败
  let failRender = false;

  function fail(message: string) {
    content.value = null;
    phase.value = 'error';
    failure.value = message;
  }

  function close() {
    operation.abort();
    content.value = null;
    visible.value = false;
    file.value = null;
    progress.value = null;
    failure.value = '';
    zoom.value = 100;
  }

  async function open(target: FileTransferTarget): Promise<void> {
    const signal = operation.next();
    content.value = null;
    file.value = { ...target };
    visible.value = true;
    phase.value = 'reading';
    progress.value = null;
    failure.value = '';
    zoom.value = 100;
    const type = filePreviewType(target.type);
    if (!type) {
      fail('不支持预览这种格式，请下载后查看');
      return;
    }
    const result = scene.value;
    failRender = result === 'render-error';
    try {
      await delay(READ_DELAY / 2, signal);
      progress.value = progressOf(50, true);
      await delay(READ_DELAY / 2, signal);
      // "持续加载"一直停在读取中
      if (result === 'waiting') {
        return;
      }
      if (result === 'error') {
        fail('文件读取失败，请重试');
        return;
      }
      phase.value = 'rendering';
      const next = await sampleContent(type.kind, signal);
      content.value = next;
      if (next.kind === 'text') {
        rendered(next);
      }
    } catch (error) {
      if (!signal.aborted) {
        fail(error instanceof Error ? error.message : '样例文件读取失败');
      }
    }
  }

  function rendered(target: FilePreviewContent) {
    if (content.value !== target || target.signal.aborted) {
      return;
    }
    if (failRender) {
      fail('暂时无法显示此文件，可重试或下载后查看');
      return;
    }
    phase.value = 'ready';
  }

  function renderFailed(target: FilePreviewContent) {
    if (content.value === target && !target.signal.aborted) {
      fail('暂时无法显示此文件，可重试或下载后查看');
    }
  }

  // 重试时按成功演示
  function retry(): Promise<void> {
    if (!file.value) {
      return Promise.resolve();
    }
    scene.value = 'success';
    return open(file.value);
  }

  onScopeDispose(() => operation[Symbol.dispose]());

  const model: ReturnType<typeof useFilePreview> = {
    file,
    content,
    visible,
    phase,
    progress,
    failure,
    zoom,
    open,
    close,
    retry,
    rendered,
    renderFailed
  };
  return { ...model, scene };
}
