import { LatestController } from '@yzt/utils';
import { onScopeDispose, reactive, ref, shallowRef } from 'vue';

/** 设计稿只持有固定样例的元数据，不解析用户文件 */
export interface PreviewSample {
  id: string;
  name: string;
  type: string;
  year: string;
  tag: string;
}

export type DownloadScene = 'success' | 'unknown' | 'error' | 'waiting';
export type ReadScene = 'success' | 'error' | 'render-error' | 'waiting';
type DownloadPhase = 'receiving' | 'done' | 'error' | 'cancelled';

export interface DownloadDemo {
  file: PreviewSample;
  phase: DownloadPhase;
  received: number;
  unknown: boolean;
}

// 与旧项目已使用的范围一致，不开放其他 Office 格式
const previewTypes = new Set(['docx', 'pdf', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
export const canPreviewSample = (file: PreviewSample) => previewTypes.has(file.type.toLowerCase());

/** 下载演示按文件防重复，独立取消，不发送请求或保存文件 */
export function useDownloadPreview() {
  const scene = ref<DownloadScene>('success');
  const tasks = ref<DownloadDemo[]>([]);
  const controllers = new Map<string, AbortController>();

  const start = (file: PreviewSample) => {
    if (controllers.has(file.id)) {
      return;
    }
    const controller = new AbortController();
    controllers.set(file.id, controller);
    const result = scene.value;
    const task = reactive<DownloadDemo>({ file, phase: 'receiving', received: 0, unknown: result === 'unknown' });
    tasks.value = [task, ...tasks.value.filter(item => item.file.id !== file.id)];
    const timer = setInterval(() => {
      if (controller.signal.aborted || (result === 'waiting' && task.received >= 40)) {
        return;
      }
      task.received += 10;
      if (result === 'error' && task.received >= 60) {
        task.phase = 'error';
      } else if (task.received === 100) {
        task.phase = 'done';
      }
      if (task.phase !== 'receiving') {
        controller.abort();
      }
    }, 600);
    controller.signal.addEventListener('abort', () => {
      clearInterval(timer);
      controllers.delete(file.id);
    }, { once: true });
  };
  const cancel = (task: DownloadDemo) => {
    controllers.get(task.file.id)?.abort();
    task.phase = 'cancelled';
  };
  const clearFinished = () => { tasks.value = tasks.value.filter(task => task.phase === 'receiving'); };
  const isReceiving = (id: string) => tasks.value.some(task => task.file.id === id && task.phase === 'receiving');
  onScopeDispose(() => {
    for (const controller of controllers.values()) {
      controller.abort();
    }
  });
  return { scene, tasks, start, cancel, clearFinished, isReceiving };
}

/** 预览读取可替换，关闭或切换文件立即作废上一轮演示 */
export function useDocumentPreview() {
  const scene = ref<ReadScene>('success');
  const file = shallowRef<PreviewSample | null>(null);
  const visible = ref(false);
  const phase = ref<'reading' | 'rendering' | 'ready' | 'error'>('reading');
  const failure = ref('');
  const zoom = ref(100);
  const operation = new LatestController();

  const open = (target: PreviewSample) => {
    const signal = operation.next();
    file.value = null;
    visible.value = false;
    if (!canPreviewSample(target)) {
      return;
    }
    file.value = target;
    visible.value = true;
    phase.value = 'reading';
    failure.value = '';
    zoom.value = 100;
    const result = scene.value;
    // 只有计时器驱动固定状态，正式实现再替换为取流与渲染
    let timer = setTimeout(() => {
      if (signal.aborted || result === 'waiting') {
        return;
      }
      if (result === 'error') {
        phase.value = 'error';
        failure.value = '文件读取失败，请重试';
        return;
      }
      phase.value = 'rendering';
      timer = setTimeout(() => {
        if (signal.aborted) {
          return;
        }
        phase.value = result === 'render-error' ? 'error' : 'ready';
        failure.value = result === 'render-error' ? '暂时无法显示此文件，可重试或下载后查看' : '';
      }, 600);
    }, 1200);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  };
  const close = () => {
    operation.abort();
    visible.value = false;
    file.value = null;
    failure.value = '';
    zoom.value = 100;
  };
  // 失败演示只失败一次，便于在弹窗内直接验证重试恢复
  const retry = () => {
    if (file.value) {
      scene.value = 'success';
      open(file.value);
    }
  };
  onScopeDispose(() => operation[Symbol.dispose]());
  return { scene, file, visible, phase, failure, zoom, open, close, retry };
}
