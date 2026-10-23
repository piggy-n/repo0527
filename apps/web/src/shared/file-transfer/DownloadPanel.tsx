import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElProgress } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type Ref, useId } from 'vue';
import { useDelayedFlag } from '../composables/useDelayedFlag';
import type { DownloadPhase, DownloadTask } from './useDownloads';
import { formatFileBytes } from './file-size';
import styles from './DownloadPanel.module.scss';

interface DownloadsModel {
  tasks: Ref<readonly DownloadTask[]>;
  isDownloading: (id: string) => boolean;
  cancel: (task: DownloadTask) => void;
  retry: (id: string) => Promise<void>;
  clearFinished: () => void;
}

// 接收中有百分比时显示百分比；总量未知时只显示已接收的字节
function receivingText({ progress }: DownloadTask): string {
  if (typeof progress?.percent === 'number') {
    return `正在接收 · ${progress.percent}%`;
  }
  return progress ? `正在接收 · 已接收 ${formatFileBytes(progress.loaded)}（总量未知）` : '正在接收…';
}

// 文字固定的几种状态；接收中和失败另外拼
const PHASE_TEXTS: Record<Exclude<DownloadPhase, 'receiving' | 'error'>, string> = {
  checking: '文件已接收，正在检查下载内容',
  done: '已交给浏览器保存',
  canceled: '已取消本次下载'
};

function statusText(task: DownloadTask): string {
  if (task.phase === 'receiving') {
    return receivingText(task);
  }
  return task.phase === 'error' ? task.failure : PHASE_TEXTS[task.phase];
}

/** 下载进度区：放在表格上方，不依赖表格当前的行，筛选或翻页后仍能取消、重试本页发起的下载 */
export const DownloadPanel = defineComponent({
  name: 'DownloadPanel',
  props: {
    model: { type: Object as PropType<DownloadsModel>, required: true }
  },
  setup(props) {
    // 默认收起；新增和完成任务都不改变用户选择的展开状态
    const expanded = ref(false);
    const listId = useId();
    const runningCount = computed(
      () => props.model.tasks.value.filter(task => props.model.isDownloading(task.file.id)).length
    );
    const failedCount = computed(() => props.model.tasks.value.filter(task => task.phase === 'error').length);
    // 进度条延迟出现，很快完成的下载不闪一下
    const showProgress = useDelayedFlag(() => runningCount.value > 0);

    function toggleTask(task: DownloadTask) {
      if (props.model.isDownloading(task.file.id)) {
        props.model.cancel(task);
      } else {
        void props.model.retry(task.file.id);
      }
    }

    function actionLabel(task: DownloadTask): string {
      if (props.model.isDownloading(task.file.id)) {
        return '取消';
      }
      return task.phase === 'done' ? '重新下载' : '重试';
    }

    function renderTask(task: DownloadTask) {
      const percent = task.progress?.percent;
      const statusClass = [
        styles.taskStatus,
        task.phase === 'error' && styles.error,
        task.phase === 'done' && styles.success
      ];
      return (
        <div key={task.file.id} class={styles.task}>
          <div class={styles.filename}>{task.file.name}</div>
          <div class={styles.taskDetails}>
            <div class={statusClass} role="status">
              {statusText(task)}
            </div>
            <ElButton class="button-inline" link type="primary" size="small" onClick={() => toggleTask(task)}>
              {actionLabel(task)}
            </ElButton>
          </div>
          {showProgress.value && task.phase === 'receiving' && typeof percent === 'number' && (
            <ElProgress class={styles.progress} percentage={percent} showText={false} />
          )}
        </div>
      );
    }

    return () => {
      const { tasks } = props.model;
      if (tasks.value.length === 0) {
        return null;
      }
      return (
        <section class={styles.downloads} aria-label="下载进度">
          <div class={styles.taskHeading}>
            <MxTitle class={styles.downloadTitle} level="section">
              下载进度 <span class={styles.count}>{tasks.value.length}</span>
            </MxTitle>
            <span class={styles.summary} role="status">
              进行中 {runningCount.value} · 失败 {failedCount.value}
            </span>
            <ElButton
              link
              type="primary"
              size="small"
              icon={expanded.value ? ArrowDown : ArrowRight}
              aria-expanded={expanded.value}
              aria-controls={listId}
              onClick={() => {
                expanded.value = !expanded.value;
              }}
            >
              {expanded.value ? '收起' : '展开'}
            </ElButton>
            {expanded.value && (
              <ElButton
                link
                type="primary"
                size="small"
                disabled={runningCount.value === tasks.value.length}
                onClick={props.model.clearFinished}
              >
                清除已结束
              </ElButton>
            )}
          </div>
          {expanded.value && (
            <div id={listId} class={styles.tasks}>
              {tasks.value.map(renderTask)}
            </div>
          )}
        </section>
      );
    };
  }
});
