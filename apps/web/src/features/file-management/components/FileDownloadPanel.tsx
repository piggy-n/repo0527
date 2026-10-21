import { MxTitle } from '@yzt/ui';
import { ElButton, ElProgress } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { useFileDownloads } from '../composables/useFileDownloads';
import { formatFileBytes } from '../file-types';
import styles from './FileTransfer.module.scss';

/** 进度区不依赖表格当前行，筛选或翻页仍可取消本页发起的下载 */
export const FileDownloadPanel = defineComponent({
  name: 'FileDownloadPanel',
  props: { model: { type: Object as PropType<ReturnType<typeof useFileDownloads>>, required: true } },
  setup(props) {
    const showProgress = useDelayedFlag(() => props.model.tasks.value.some(task =>
      props.model.isDownloading(task.file.id)));
    return () => props.model.tasks.value.length > 0 && <section class={styles.downloads} aria-label="下载进度">
      <div class={styles.taskHeading}>
        <MxTitle level="section">下载进度</MxTitle>
        <ElButton
          link
          type="primary"
          disabled={props.model.tasks.value.every(task => props.model.isDownloading(task.file.id))}
          onClick={props.model.clearFinished}
        >清除已结束</ElButton>
      </div>
      <div class={styles.tasks}>
        {props.model.tasks.value.map(task => <div key={task.file.id} class={styles.task}>
          <div class={styles.taskMain}>
            <div class={styles.filename}>{task.file.name}</div>
            <div class={styles.taskStatus} role="status">
              {task.phase === 'receiving' && (typeof task.progress?.percent === 'number'
                ? `正在接收 · ${task.progress.percent}%`
                : `正在接收${task.progress ? ` · 已接收 ${formatFileBytes(task.progress.loaded)}（总量未知）` : '…'}`)}
              {task.phase === 'checking' && '文件已接收，正在检查下载内容'}
              {task.phase === 'done' && '已交给浏览器保存'}
              {task.phase === 'cancelled' && '已取消本次下载'}
              {task.phase === 'error' && <span class={styles.error}>{task.failure}</span>}
            </div>
            {showProgress.value && task.phase === 'receiving' && typeof task.progress?.percent === 'number'
              && <ElProgress percentage={task.progress.percent} showText={false} />}
          </div>
          {props.model.isDownloading(task.file.id)
            ? <ElButton onClick={() => props.model.cancel(task)}>取消</ElButton>
            : <ElButton link type="primary" onClick={() => void props.model.start(task.file)}>
              {task.phase === 'done' ? '重新下载' : '重试'}
            </ElButton>}
        </div>)}
      </div>
    </section>;
  }
});
