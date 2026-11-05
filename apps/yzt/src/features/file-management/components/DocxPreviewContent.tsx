import { LatestController } from '@yzt/utils';
import { defineComponent, onScopeDispose, type PropType, ref, watch } from 'vue';
import type { FilePreviewContent } from '../composables/useFilePreview';
import { documentTokenStyles, renderDocx } from '../docx-preview';
import styles from './FileTransfer.module.scss';

type DocxContent = Extract<FilePreviewContent, { kind: 'docx' }>;

// 隔离文档的样式和脚本：不执行脚本、不加载外部图片和字体，文档里嵌入的资源由 docx-preview 转成 data URL
const DOCUMENT_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function documentShell(): string {
  const body = 'body{margin:0;background:var(--color-bg-page);color:var(--color-text-primary)}';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_POLICY}">`,
    `<style>${documentTokenStyles()}${body}</style>`,
    '</head><body></body></html>'
  ].join('');
}

// 左右内边距之和；在 iframe 自己的窗口里计算，令牌声明在那里
function horizontalPadding(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style ? Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight) : 0;
}

/** DOCX 阅读区：把 docx-preview 的 DOM 渲染接到 iframe 上；状态和取流归预览的拥有者，这里只报告显示成功或失败 */
export const DocxPreviewContent = defineComponent({
  name: 'DocxPreviewContent',
  props: {
    content: { type: Object as PropType<DocxContent>, required: true },
    zoom: { type: Number, required: true }
  },
  emits: {
    loaded: (_content: DocxContent) => true,
    failed: (_content: DocxContent) => true
  },
  setup(props, { emit }) {
    const frame = ref<HTMLIFrameElement>();
    // 换文件是可替换操作：旧文件的渲染晚到时不报告
    const renderOperation = new LatestController();
    const shell = documentShell();
    let wrapper: HTMLElement | null = null;

    // 只按用户选的比例缩放，不随窗口宽度自动适配
    function applyZoom() {
      if (wrapper) {
        wrapper.style.zoom = String(props.zoom / 100);
      }
    }

    async function render() {
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
        if (wrapper) {
          // 外层容器按最宽的一页加左右留白定宽并居中，缩放时整页一起缩放
          const pages = Array.from(target.querySelectorAll<HTMLElement>('section.file-docx'), page => page.offsetWidth);
          wrapper.style.width = `${Math.max(1, ...pages) + horizontalPadding(wrapper)}px`;
          wrapper.style.margin = '0 auto';
        }
        applyZoom();
        emit('loaded', content);
      } catch {
        if (!signal.aborted) {
          emit('failed', content);
        }
      }
    }

    // 第一次由 iframe 的 load 触发渲染；之后换内容时 iframe 不重建，由这里触发
    watch(() => props.content, () => void render(), { flush: 'post' });
    watch(() => props.zoom, applyZoom);
    onScopeDispose(() => {
      renderOperation[Symbol.dispose]();
      wrapper = null;
    });

    return () => (
      <iframe
        ref={frame}
        class={styles.frame}
        title="DOCX 阅读区"
        sandbox="allow-same-origin"
        srcdoc={shell}
        onLoad={() => void render()}
      />
    );
  }
});
