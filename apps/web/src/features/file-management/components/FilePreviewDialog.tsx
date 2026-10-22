import { Download, Loading, Minus, Plus, Warning } from '@element-plus/icons-vue';
import { useElementSize } from '@vueuse/core';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElDialog, ElIcon, ElTag } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { useFileDownloads } from '../composables/useFileDownloads';
import type { FilePreviewContent, useFilePreview } from '../composables/useFilePreview';
import { formatFileBytes } from '../file-types';
import { DocxPreviewContent } from './DocxPreviewContent';
import styles from './FileTransfer.module.scss';

// 缩放只对 DOCX 和图片开放，按 25% 一档
const ZOOM_STEP = 25;
const ZOOM_MIN = 50;
const ZOOM_MAX = 150;

/** 预览窗口：统一的外壳；PDF 用浏览器自带的阅读器，DOCX、图片、文本各自显示。状态和取流归 useFilePreview */
export const FilePreviewDialog = defineComponent({
  name: 'FilePreviewDialog',
  props: {
    model: { type: Object as PropType<ReturnType<typeof useFilePreview>>, required: true },
    downloads: { type: Object as PropType<ReturnType<typeof useFileDownloads>>, required: true }
  },
  setup(props) {
    const viewport = ref<HTMLElement>();
    const { width: viewportWidth } = useElementSize(viewport);
    // 图片原图宽度，加载后才知道；显示宽度取原图和阅读区可用宽度的较小值，再乘缩放
    const imageWidth = ref(0);
    const loading = useDelayedFlag(() => {
      const { visible, phase } = props.model;
      return visible.value && (phase.value === 'reading' || phase.value === 'rendering');
    });
    // 换内容时回到左上角，图片宽度等新图片加载后再量
    watch(
      () => props.model.content.value,
      () => {
        imageWidth.value = 0;
        if (viewport.value) {
          viewport.value.scrollTop = 0;
          viewport.value.scrollLeft = 0;
        }
      },
      { flush: 'sync' }
    );

    function changeZoom(delta: number) {
      props.model.zoom.value += delta;
    }

    function renderImage(content: Extract<FilePreviewContent, { url: string }>, name: string) {
      // 阅读区左右各留 16
      const fitWidth = Math.min(imageWidth.value, Math.max(1, viewportWidth.value - 32));
      return (
        <img
          key={content.url}
          class={styles.image}
          src={content.url}
          alt={name}
          style={{ width: `${fitWidth * props.model.zoom.value / 100}px` }}
          onLoad={event => {
            // 被替换的图片晚到的 load 不能改写当前图片的尺寸和就绪状态
            if (props.model.content.value !== content || content.signal.aborted) {
              return;
            }
            if (event.currentTarget instanceof HTMLImageElement) {
              imageWidth.value = event.currentTarget.naturalWidth;
            }
            props.model.rendered(content);
          }}
          onError={() => props.model.renderFailed(content)}
        />
      );
    }

    function renderContent(content: FilePreviewContent, name: string) {
      if (content.kind === 'text') {
        return content.text
          ? <pre class={styles.text}>{content.text}</pre>
          : <div class={styles.center}>文件没有可显示的文本内容</div>;
      }
      if (content.kind === 'docx') {
        return (
          <DocxPreviewContent
            content={content}
            zoom={props.model.zoom.value}
            onLoaded={props.model.rendered}
            onFailed={props.model.renderFailed}
          />
        );
      }
      if (content.kind === 'image') {
        return renderImage(content, name);
      }
      return (
        <iframe
          key={content.url}
          class={styles.frame}
          title="PDF 阅读区"
          src={content.url}
          onLoad={() => props.model.rendered(content)}
          onError={() => props.model.renderFailed(content)}
        />
      );
    }

    function renderLoading() {
      const { phase, progress } = props.model;
      const hint = '关闭窗口可停止本次预览';
      return (
        <div class={styles.center} role="status">
          <ElIcon size={40} class="is-loading">
            <Loading />
          </ElIcon>
          <strong>{phase.value === 'reading' ? '正在读取文件…' : '正在准备预览…'}</strong>
          <span>{progress.value ? `已接收 ${formatFileBytes(progress.value.loaded)} · ${hint}` : hint}</span>
        </div>
      );
    }

    function renderError() {
      return (
        <div class={styles.center} role="alert">
          <ElIcon size={40}>
            <Warning />
          </ElIcon>
          <strong>{props.model.failure.value}</strong>
          <ElButton type="primary" onClick={() => void props.model.retry()}>
            重新加载
          </ElButton>
        </div>
      );
    }

    function renderZoom() {
      const { zoom } = props.model;
      return (
        <div class={styles.zoom}>
          <ElButton
            class={styles.zoomButton}
            size="small"
            icon={Minus}
            aria-label="缩小"
            disabled={zoom.value <= ZOOM_MIN}
            onClick={() => changeZoom(-ZOOM_STEP)}
          />
          <span>{zoom.value}%</span>
          <ElButton
            class={styles.zoomButton}
            size="small"
            icon={Plus}
            aria-label="放大"
            disabled={zoom.value >= ZOOM_MAX}
            onClick={() => changeZoom(ZOOM_STEP)}
          />
        </div>
      );
    }

    function renderReader() {
      const { file, content, phase } = props.model;
      if (!file.value) {
        return null;
      }
      const scalable = content.value?.kind === 'docx' || content.value?.kind === 'image';
      // DOCX、PDF 自己带滚动，阅读区不再加内边距和滚动条
      const framed = content.value?.kind === 'docx' || content.value?.kind === 'pdf';
      const busy = phase.value === 'reading' || phase.value === 'rendering';
      return (
        <div class={styles.reader}>
          <div class={styles.fileHeading}>
            <div class={styles.filename}>
              <span>{file.value.name}</span>
              <ElTag size="small" type="info">
                {file.value.type.toUpperCase()}
              </ElTag>
            </div>
            {phase.value === 'ready' && scalable && renderZoom()}
          </div>
          <div
            ref={viewport}
            class={[styles.viewport, framed && styles.frameViewport]}
            aria-label="文件阅读区"
            aria-busy={busy}
          >
            {loading.value && renderLoading()}
            {phase.value === 'error' && renderError()}
            {/* 渲染期间内容已挂载但不可见：DOCX、图片要挂载后才能报告是否显示成功 */}
            <div class={[styles.content, phase.value !== 'ready' && styles.hiddenContent]}>
              {content.value && renderContent(content.value, file.value.name)}
            </div>
          </div>
        </div>
      );
    }

    function renderFooter() {
      const file = props.model.file.value;
      const receiving = file !== null && props.downloads.isDownloading(file.id);
      return (
        <div class={styles.footer}>
          <div>
            <ElButton onClick={props.model.close}>关闭</ElButton>
            <ElButton
              type="primary"
              icon={Download}
              disabled={!file || receiving}
              onClick={() => {
                if (file) {
                  void props.downloads.start(file);
                }
              }}
            >
              {receiving ? '正在下载' : '下载文件'}
            </ElButton>
          </div>
        </div>
      );
    }

    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        title="文件预览"
        width="1120px"
        top="4vh"
        appendToBody
        modelValue={props.model.visible.value}
        beforeClose={done => {
          props.model.close();
          done();
        }}
        closeOnClickModal={false}
      >
        {{
          header: () => <MxTitle level="panel">文件预览</MxTitle>,
          default: renderReader,
          footer: renderFooter
        }}
      </ElDialog>
    );
  }
});
