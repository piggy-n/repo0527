// 页面的样式不进入阅读区的 iframe，用到的令牌在写入时从页面读出，声明到 iframe 的根上
const DOCUMENT_TOKENS = ['--color-bg-page', '--color-text-primary', '--shadow-sm', '--space-lg'] as const;

/** iframe 根上的令牌声明；外壳和文档的样式只用这里的变量 */
export function documentTokenStyles(source: Element = document.documentElement): string {
  const style = getComputedStyle(source);
  const declarations = DOCUMENT_TOKENS.map(name => `${name}:${style.getPropertyValue(name).trim()}`);
  return `:root{${declarations.join(';')}}`;
}

// docx-preview 的外层容器去掉自带的灰底，页与页之间用页面的阴影和间距
const DOCUMENT_APPEARANCE = [
  '.file-docx-wrapper{background:transparent;padding:var(--space-lg);box-sizing:border-box}',
  '.file-docx-wrapper>section.file-docx{box-shadow:var(--shadow-sm);margin-bottom:var(--space-lg)}'
].join('');

/** 把 DOCX 渲染进阅读区；docx-preview 只在打开 DOCX 时加载，只用它稳定的渲染入口，不依赖内部的解析模型 */
export async function renderDocx(blob: Blob, target: HTMLElement, signal: AbortSignal): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  signal.throwIfAborted();
  const bytes = await blob.arrayBuffer();
  signal.throwIfAborted();
  // 每次渲染进新的容器：库本身不能取消，晚到的结果不能写进当前的阅读区
  const body = target.ownerDocument.createElement('div');
  const styles = target.ownerDocument.createElement('div');
  await renderAsync(bytes, body, styles, {
    className: 'file-docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    // 图片转成 data URL：阅读区的 CSP 不允许加载 blob 或外部地址
    useBase64URL: true,
    renderAltChunks: false
  });
  signal.throwIfAborted();
  // 阅读区只展示内容，文档里的链接不能跳到业务页面或外部站点
  for (const link of body.querySelectorAll('a')) {
    link.removeAttribute('href');
    link.removeAttribute('target');
  }
  const appearance = target.ownerDocument.createElement('style');
  appearance.textContent = DOCUMENT_APPEARANCE;
  target.replaceChildren(styles, appearance, body);
}
