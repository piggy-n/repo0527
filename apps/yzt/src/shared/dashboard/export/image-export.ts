import { saveFile } from '../../file-transfer';

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

/** 导出图片的像素是 CSS 尺寸的 2 倍 */
export const EXPORT_RATIO = 2;

const TITLE_FONT = '900 24px "City Dashboard Serif", serif';
const TITLE_LINE = 34;

/** 导出图片顶上的标题栏：按宽度换行后的各行和标题栏的高度（CSS 像素） */
export function titleBand(
  context: CanvasRenderingContext2D,
  title: string,
  maxWidth: number
): { readonly lines: readonly string[]; readonly height: number } {
  context.font = TITLE_FONT;
  const lines = titleLines(title, Math.max(1, maxWidth), text => context.measureText(text).width);
  return { lines, height: Math.max(60, 32 + lines.length * TITLE_LINE) };
}

/** 在标题栏里居中写各行，centerX 是标题栏中线（CSS 像素） */
export function drawTitle(context: CanvasRenderingContext2D, lines: readonly string[], centerX: number): void {
  context.font = TITLE_FONT;
  context.fillStyle = '#0F4FA6';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.forEach((line, index) => context.fillText(line, centerX, 16 + (index + 0.5) * TITLE_LINE));
}

export function imageWithTitle(image: HTMLCanvasElement, title: string, background = '#ECF6FE'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || !image.width || !image.height) {
    throw new Error('无法创建图片画布');
  }
  const width = image.width / EXPORT_RATIO;
  const heading = titleBand(context, title, width - 40);
  canvas.width = image.width;
  canvas.height = image.height + Math.ceil(heading.height * EXPORT_RATIO);
  context.scale(EXPORT_RATIO, EXPORT_RATIO);
  context.fillStyle = background;
  context.fillRect(0, 0, width, canvas.height / EXPORT_RATIO);
  drawTitle(context, heading.lines, width / 2);
  context.drawImage(image, 0, heading.height, width, image.height / EXPORT_RATIO);
  return canvas;
}

/** 文件名清理只影响下载名称，不改标题文字 */
export function safeImageName(name: string): string {
  return `${name.replace(/[\p{Cc}<>:"/\\|?*]/gu, '-').slice(0, 150)}.png`;
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const encoded = (blob: Blob | null) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('图片编码失败'));
      }
    };
    canvas.toBlob(encoded, 'image/png');
  });
}

export function saveImage(blob: Blob, name: string): void {
  saveFile({ blob, fileName: safeImageName(name) });
}
