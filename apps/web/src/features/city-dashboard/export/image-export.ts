import { saveFile } from '@/shared/file-transfer';

/** 字体等待可中止，离开页面后不保留下载任务 */
export async function waitForExportFonts(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!document.fonts) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new DOMException('导出已取消', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('字体加载超时，请稍后重试导出'));
    }, 15000);

    function cleanup(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }

    signal.addEventListener('abort', abort, { once: true });
    // 与页面绘制一致：缺少部署字体时使用系统字体，不阻断图片导出
    void Promise.allSettled([
      document.fonts.load('900 24px "City Dashboard Serif"'),
      document.fonts.load('600 16px "Alibaba PuHuiTi"'),
      document.fonts.load('400 16px "Alibaba PuHuiTi"')
    ]).then(() => {
      cleanup();
      resolve();
      return undefined;
    });
  });
  signal.throwIfAborted();
}

/** 按字形实际宽度换行，长指标名称不会被裁掉 */
export function titleLines(title: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of title) {
    if (line && (character === '\n' || measure(line + character) > maxWidth)) {
      lines.push(line);
      line = '';
    }
    if (character !== '\n') {
      line += character;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

export function imageWithTitle(image: HTMLCanvasElement, title: string, background = '#ECF6FE'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || !image.width || !image.height) {
    throw new Error('无法创建图片画布');
  }
  const ratio = 2;
  const width = image.width / ratio;
  const font = '900 24px "City Dashboard Serif", serif';
  context.font = font;
  const lines = titleLines(title, Math.max(1, width - 40), text => context.measureText(text).width);
  const headingHeight = Math.max(60, 32 + lines.length * 34);
  canvas.width = image.width;
  canvas.height = image.height + Math.ceil(headingHeight * ratio);
  context.scale(ratio, ratio);
  context.fillStyle = background;
  context.fillRect(0, 0, width, canvas.height / ratio);
  context.font = font;
  context.fillStyle = '#0F4FA6';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.forEach((line, index) => context.fillText(
    line,
    width / 2,
    16 + (index + 0.5) * 34
  ));
  context.drawImage(image, 0, headingHeight, width, image.height / ratio);
  return canvas;
}

/** 文件名清理只影响下载名称，不改标题文字 */
export function safeImageName(name: string): string {
  return `${name.replace(/[\p{Cc}<>:"/\\|?*]/gu, '-').slice(0, 150)}.png`;
}

export async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((
    resolve,
    reject
  ) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), 'image/png'));
}

export function saveImage(blob: Blob, name: string): void {
  saveFile({ blob, fileName: safeImageName(name) });
}
