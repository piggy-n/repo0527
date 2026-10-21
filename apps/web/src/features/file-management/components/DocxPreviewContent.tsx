import { LatestController } from '@yzt/utils';
import { useElementSize } from '@vueuse/core';
import { defineComponent, onScopeDispose, ref, watch, type PropType } from 'vue';
import type { FilePreviewContent } from '../composables/useFilePreview';
import { fittedPreviewScale, renderDocx } from '../docx-preview';
import styles from './FileTransfer.module.scss';

type DocxContent = Extract<FilePreviewContent, { kind: 'docx' }>;

// 隔离文档样式；不执行脚本、不加载外部图片/字体，嵌入资源由库转为 data URL
const documentPolicy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; "
  + "base-uri 'none'; form-action 'none'";
const documentShell = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${documentPolicy}">
<style>body{margin:0;background:#f4f6fa;color:#30343b}</style></head><body></body></html>`;

/** DOM 渲染桥接只在组件内部，状态和取流归预览拥有者 */
export const DocxPreviewContent = defineComponent({
  name: 'DocxPreviewContent',
  props: {
    content: { type: Object as PropType<DocxContent>, required: true },
    zoom: { type: Number, required: true }
  },
  emits: { loaded: (_content: DocxContent) => true, failed: (_content: DocxContent) => true },
  setup(props, { emit }) {
    const frame = ref<HTMLIFrameElement>();
    const { width } = useElementSize(frame);
    const renderOperation = new LatestController();
    let wrapper: HTMLElement | null = null;
    let pageWidth = 1;
    const fit = () => {
      if (wrapper) {
        wrapper.style.zoom = String(fittedPreviewScale(width.value, pageWidth, props.zoom));
      }
    };
    const render = async () => {
      const target = frame.value?.contentDocument?.body;
      if (!target) {
        return;
      }
      const content = props.content;
      const signal = AbortSignal.any([renderOperation.next(), content.signal]);
      wrapper = null;
      try {
        await renderDocx(content.blob, target, signal);
        if (signal.aborted) {
          return;
        }
        wrapper = target.querySelector<HTMLElement>('.file-docx-wrapper');
        pageWidth = Math.max(1, ...Array.from(target.querySelectorAll<HTMLElement>('section.file-docx'),
          page => page.offsetWidth)) + 32;
        if (wrapper) {
          wrapper.style.width = `${pageWidth}px`;
          wrapper.style.margin = '0 auto';
        }
        fit();
        emit('loaded', content);
      } catch {
        if (!signal.aborted) {
          emit('failed', content);
        }
      }
    };
    watch(() => props.content, () => void render(), { flush: 'post' });
    watch([width, () => props.zoom], fit);
    onScopeDispose(() => { renderOperation[Symbol.dispose](); wrapper = null; });
    return () => <iframe
      ref={frame}
      class={styles.frame}
      title="DOCX 阅读区"
      sandbox="allow-same-origin"
      srcdoc={documentShell}
      onLoad={() => void render()}
    />;
  }
});
