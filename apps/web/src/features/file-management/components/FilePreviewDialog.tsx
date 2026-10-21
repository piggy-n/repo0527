import { Download, Loading, Minus, Plus, Warning } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { useElementSize } from '@vueuse/core';
import { ElButton, ElDialog, ElIcon, ElTag } from 'element-plus';
import { defineComponent, ref, watch, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { useFileDownloads } from '../composables/useFileDownloads';
import type { useFilePreview } from '../composables/useFilePreview';
import { formatFileBytes } from '../file-types';
import { DocxPreviewContent } from './DocxPreviewContent';
import styles from './FileTransfer.module.scss';

/** 统一外壳；PDF 使用浏览器阅读器，DOCX、图片与文本保留各自的显示方式 */
export const FilePreviewDialog = defineComponent({
  name: 'FilePreviewDialog',
  props: {
    model: { type: Object as PropType<ReturnType<typeof useFilePreview>>, required: true },
    downloads: { type: Object as PropType<ReturnType<typeof useFileDownloads>>, required: true }
  },
  setup(props) {
    const viewport = ref<HTMLElement>();
    // 图片按阅读区宽度显示，缩放基于原图与可用宽度的较小值
    const imageWidth = ref(0);
    const { width } = useElementSize(viewport);
    const loading = useDelayedFlag(() => props.model.visible.value
      && (props.model.phase.value === 'reading' || props.model.phase.value === 'rendering'));
    watch(() => props.model.content.value, () => {
      imageWidth.value = 0;
      if (viewport.value) {
        viewport.value.scrollTop = 0;
        viewport.value.scrollLeft = 0;
      }
    }, { flush: 'sync' });

    return () => {
      const model = props.model;
      const file = model.file.value;
      const content = model.content.value;
      const receiving = file ? props.downloads.isDownloading(file.id) : false;
      const scalable = content?.kind === 'docx' || content?.kind === 'image';
      return <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        title="文件预览"
        width="1120px"
        top="4vh"
        appendToBody
        modelValue={model.visible.value}
        beforeClose={done => { model.close(); done(); }}
        closeOnClickModal={false}
      >
        {{
          header: () => <MxTitle level="panel">文件预览</MxTitle>,
          default: () => file && <div class={styles.reader}>
            <div class={styles.fileHeading}>
              <div class={styles.filename}>
                <span>{file.name}</span><ElTag size="small" type="info">{file.type.toUpperCase()}</ElTag>
              </div>
              {model.phase.value === 'ready' && scalable && <div class={styles.zoom}>
                <ElButton
                  class={styles.zoomButton}
                  size="small"
                  icon={Minus}
                  aria-label="缩小"
                  disabled={model.zoom.value <= 50}
                  onClick={() => { model.zoom.value -= 25; }}
                />
                <span>{model.zoom.value}%</span>
                <ElButton
                  class={styles.zoomButton}
                  size="small"
                  icon={Plus}
                  aria-label="放大"
                  disabled={model.zoom.value >= 150}
                  onClick={() => { model.zoom.value += 25; }}
                />
              </div>}
            </div>
            <div
              ref={viewport}
              class={[styles.viewport, (content?.kind === 'docx' || content?.kind === 'pdf') && styles.frameViewport]}
              aria-label="文件阅读区"
              aria-busy={model.phase.value === 'reading' || model.phase.value === 'rendering'}
            >
              {loading.value && <div class={styles.center} role="status">
                <ElIcon size={40} class="is-loading"><Loading /></ElIcon>
                <strong>{model.phase.value === 'reading' ? '正在读取文件…' : '正在准备预览…'}</strong>
                <span>{model.progress.value
                  ? `已接收 ${formatFileBytes(model.progress.value.loaded)} · 关闭窗口可停止本次预览`
                  : '关闭窗口可停止本次预览'}</span>
              </div>}
              {model.phase.value === 'error' && <div class={styles.center} role="alert">
                <ElIcon size={40}><Warning /></ElIcon>
                <strong>{model.failure.value}</strong>
                <ElButton type="primary" onClick={() => void model.retry()}>重新加载</ElButton>
              </div>}
              <div class={[styles.content, model.phase.value !== 'ready' && styles.hiddenContent]}>
                {content?.kind === 'text' && (content.text
                  ? <pre class={styles.text}>{content.text}</pre>
                  : <div class={styles.center}>文件没有可显示的文本内容</div>)}
                {content?.kind === 'image' && <img
                  key={content.url}
                  class={styles.image}
                  src={content.url}
                  alt={file.name}
                  style={{
                    width: `${Math.min(imageWidth.value, Math.max(1, width.value - 32)) * model.zoom.value / 100}px`
                  }}
                  onLoad={event => {
                    // 被替换图片的 load 可能晚到，尺寸与就绪状态都只属于当前内容
                    if (model.content.value !== content || content.signal.aborted) {
                      return;
                    }
                    if (event.currentTarget instanceof HTMLImageElement) {
                      imageWidth.value = event.currentTarget.naturalWidth;
                    }
                    model.rendered(content);
                  }}
                  onError={() => model.renderFailed(content)}
                />}
                {content?.kind === 'pdf' && <iframe
                  key={content.url}
                  class={styles.frame}
                  title="PDF 阅读区"
                  src={content.url}
                  onLoad={() => model.rendered(content)}
                  onError={() => model.renderFailed(content)}
                />}
                {content?.kind === 'docx' && <DocxPreviewContent
                  content={content}
                  zoom={model.zoom.value}
                  onLoaded={model.rendered}
                  onFailed={model.renderFailed}
                />}
              </div>
            </div>
          </div>,
          footer: () => <div class={styles.footer}>
            <div>
              <ElButton onClick={model.close}>关闭</ElButton>
              <ElButton
                type="primary"
                icon={Download}
                disabled={!file || receiving}
                onClick={() => { if (file) { void props.downloads.start(file); } }}
              >{receiving ? '正在下载' : '下载文件'}</ElButton>
            </div>
          </div>
        }}
      </ElDialog>;
    };
  }
});
