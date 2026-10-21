/** 稳定的渲染入口只在打开 DOCX 时加载，不依赖库的内部解析模型 */
export async function renderDocx(blob: Blob, target: HTMLElement, signal: AbortSignal): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  signal.throwIfAborted();
  const bytes = await blob.arrayBuffer();
  signal.throwIfAborted();
  // 每轮在独立容器里完成；库本身不支持取消，晚到的结果不能写入当前阅读区
  const body = target.ownerDocument.createElement('div');
  const styles = target.ownerDocument.createElement('div');
  await renderAsync(bytes, body, styles, {
    className: 'file-docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
    ignoreFonts: false, breakPages: true, renderHeaders: true, renderFooters: true,
    useBase64URL: true, renderAltChunks: false
  });
  signal.throwIfAborted();
  // 阅读只展示内容，文档内的链接不能导航到业务页面或外部站点
  for (const link of body.querySelectorAll('a')) {
    link.removeAttribute('href');
    link.removeAttribute('target');
  }
  const appearance = target.ownerDocument.createElement('style');
  appearance.textContent = '.file-docx-wrapper{background:transparent;padding:16px;box-sizing:border-box;}'
    + '.file-docx-wrapper>section.file-docx{box-shadow:0 4px 16px #19376e14;margin-bottom:16px;}';
  target.replaceChildren(styles, appearance, body);
}

/** 100% 表示适合当前阅读宽度，放大时允许阅读区内部横向滚动 */
export function fittedPreviewScale(viewportWidth: number, contentWidth: number, zoom: number): number {
  return Math.min(1, Math.max(1, viewportWidth - 32) / Math.max(1, contentWidth)) * zoom / 100;
}
