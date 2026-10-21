import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElProgress } from 'element-plus';
import { defineComponent, ref, useId, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { useFileDownloads } from '../composables/useFileDownloads';
import { formatFileBytes } from '../file-types';
import styles from './FileTransfer.module.scss';

/** 进度区不依赖表格当前行，筛选或翻页仍可取消本页发起的下载 */
export const FileDownloadPanel = defineComponent({
  name: 'FileDownloadPanel',
  props: { model: { type: Object as PropType<ReturnType<typeof useFileDownloads>>, required: true } },
  setup(props) {
    // 新增和完成任务都不改变用户选择的展开状态
    const expanded = ref(false);
    const listId = useId();
    const showProgress = useDelayedFlag(() => props.model.tasks.value.some(task =>
      props.model.isDownloading(task.file.id)));
    return () => props.model.tasks.value.length > 0 && <section class={styles.downloads} aria-label="下载进度">
      <div class={styles.taskHeading}>
        <MxTitle class={styles.downloadTitle} level="section">
          下载进度 <span class={styles.count}>{props.model.tasks.value.length}</span>
        </MxTitle>
        <span class={styles.summary} role="status">
          进行中 {props.model.tasks.value.filter(task => props.model.isDownloading(task.file.id)).length}
          {' · '}失败 {props.model.tasks.value.filter(task => task.phase === 'error').length}
        </span>
        <ElButton
          link
          type="primary"
          size="small"
          icon={expanded.value ? ArrowDown : ArrowRight}
          aria-expanded={expanded.value}
          aria-controls={listId}
          onClick={() => { expanded.value = !expanded.value; }}
        >{expanded.value ? '收起' : '展开'}</ElButton>
        {expanded.value && <ElButton
          link
          type="primary"
          size="small"
          disabled={props.model.tasks.value.every(task => props.model.isDownloading(task.file.id))}
          onClick={props.model.clearFinished}
        >清除已结束</ElButton>}
      </div>
      {expanded.value && <div id={listId} class={styles.tasks}>
        {props.model.tasks.value.map(task => <div key={task.file.id} class={styles.task}>
          <div class={styles.filename}>{task.file.name}</div>
          <div class={styles.taskDetails}>
            <div
              class={[styles.taskStatus, task.phase === 'error' && styles.error, task.phase === 'done' && styles.success]}
              role="status"
            >
              {task.phase === 'receiving' && (typeof task.progress?.percent === 'number'
                ? `正在接收 · ${task.progress.percent}%`
                : `正在接收${task.progress ? ` · 已接收 ${formatFileBytes(task.progress.loaded)}（总量未知）` : '…'}`)}
              {task.phase === 'checking' && '文件已接收，正在检查下载内容'}
              {task.phase === 'done' && '已交给浏览器保存'}
              {task.phase === 'cancelled' && '已取消本次下载'}
              {task.phase === 'error' && task.failure}
            </div>
            <ElButton
              class="button-inline"
              link
              type="primary"
              size="small"
              onClick={() => {
                if (props.model.isDownloading(task.file.id)) {
                  props.model.cancel(task);
                } else {
                  void props.model.start(task.file);
                }
              }}
            >
              {props.model.isDownloading(task.file.id) ? '取消' : task.phase === 'done' ? '重新下载' : '重试'}
            </ElButton>
          </div>
          {showProgress.value && task.phase === 'receiving' && typeof task.progress?.percent === 'number'
            && <ElProgress class={styles.progress} percentage={task.progress.percent} showText={false} />}
        </div>)}
      </div>}
    </section>;
  }
});
