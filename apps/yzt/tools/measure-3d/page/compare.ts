import { compareSharpness, GRID_COLS, GRID_ROWS, sharpnessGrid, type SharpnessComparison } from '../sharpness.ts';
import { decodeShot } from './shots.ts';

// 截图对比（飞一圈回来的和飞行前的）：只用来解码和画图，算法在 sharpness.ts。在页面里跑是因为 Node 这边没有图片解码

export interface ShotComparison extends SharpnessComparison {
  /** 热力图：比值低的格子标红（PNG，base64） */
  readonly heatmap: string;
  /** 最差几格：左边 subject、右边 reference，放大 3 倍（PNG，base64） */
  readonly worstCrops: string;
}

// 格子里模型占了多少才比：这之下主要是底图
const MIN_MODEL_SHARE = 0.25;
const DIFFERENT = 24;

type Pixels = Awaited<ReturnType<typeof decodeShot>>;

// 模型所在的格子：显示和隐藏模型的两张图有差别的像素够多
function modelMask(withModel: Pixels, withoutModel: Pixels): boolean[] {
  const { width, height, data } = withModel;
  const changed = new Uint32Array(GRID_COLS * GRID_ROWS);
  const total = new Uint32Array(GRID_COLS * GRID_ROWS);
  for (let y = 0; y < height; y++) {
    const row = Math.min(GRID_ROWS - 1, Math.floor((y * GRID_ROWS) / height));
    for (let x = 0; x < width; x++) {
      const cell = row * GRID_COLS + Math.min(GRID_COLS - 1, Math.floor((x * GRID_COLS) / width));
      const i = (y * width + x) * 4;
      total[cell] = (total[cell] ?? 0) + 1;
      const difference =
        Math.abs((data[i] ?? 0) - (withoutModel.data[i] ?? 0)) +
        Math.abs((data[i + 1] ?? 0) - (withoutModel.data[i + 1] ?? 0)) +
        Math.abs((data[i + 2] ?? 0) - (withoutModel.data[i + 2] ?? 0));
      if (difference > DIFFERENT) {
        changed[cell] = (changed[cell] ?? 0) + 1;
      }
    }
  }
  return Array.from(changed, (count, cell) => count / Math.max(1, total[cell] ?? 1) >= MIN_MODEL_SHARE);
}

function toCanvas({ data, width, height }: Pixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

const base64Of = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1] ?? '';

function drawHeatmap(subject: Pixels, ratios: readonly (number | null)[]): string {
  const canvas = toCanvas(subject);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('拿不到 2D 上下文');
  }
  const cellWidth = subject.width / GRID_COLS;
  const cellHeight = subject.height / GRID_ROWS;
  context.font = '13px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  ratios.forEach((ratio, cell) => {
    if (ratio === null) {
      return;
    }
    const x = (cell % GRID_COLS) * cellWidth;
    const y = Math.floor(cell / GRID_COLS) * cellHeight;
    // 不到 0.93 的格子越低越红，高于 1.1 的标绿，其余不盖：数字只是提醒，最后看图
    if (ratio < 0.93) {
      context.fillStyle = `rgba(230, 40, 40, ${Math.min(0.6, (0.93 - ratio) * 2 + 0.15)})`;
      context.fillRect(x, y, cellWidth, cellHeight);
    } else if (ratio > 1.1) {
      context.fillStyle = 'rgba(40, 180, 90, 0.2)';
      context.fillRect(x, y, cellWidth, cellHeight);
    }
    context.fillStyle = 'white';
    context.strokeStyle = 'black';
    context.lineWidth = 3;
    const text = ratio.toFixed(2);
    context.strokeText(text, x + cellWidth / 2, y + cellHeight / 2);
    context.fillText(text, x + cellWidth / 2, y + cellHeight / 2);
  });
  return base64Of(canvas);
}

function drawWorstCrops(subject: Pixels, reference: Pixels, ratios: readonly (number | null)[]): string {
  const worst = ratios
    .map((ratio, cell) => ({ ratio, cell }))
    .filter((item): item is { ratio: number; cell: number } => item.ratio !== null)
    .toSorted((a, b) => a.ratio - b.ratio)
    .slice(0, 4);
  const cellWidth = Math.floor(subject.width / GRID_COLS);
  const cellHeight = Math.floor(subject.height / GRID_ROWS);
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = cellWidth * scale * 2 + 8;
  canvas.height = Math.max(1, worst.length) * (cellHeight * scale + 8);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('拿不到 2D 上下文');
  }
  const subjectCanvas = toCanvas(subject);
  const referenceCanvas = toCanvas(reference);
  context.imageSmoothingEnabled = false;
  worst.forEach(({ cell }, index) => {
    const sx = (cell % GRID_COLS) * cellWidth;
    const sy = Math.floor(cell / GRID_COLS) * cellHeight;
    const y = index * (cellHeight * scale + 8);
    context.drawImage(subjectCanvas, sx, sy, cellWidth, cellHeight, 0, y, cellWidth * scale, cellHeight * scale);
    context.drawImage(referenceCanvas, sx, sy, cellWidth, cellHeight, cellWidth * scale + 8, y, cellWidth * scale, cellHeight * scale);
  });
  return base64Of(canvas);
}

/** subject 和 reference 比；withoutModel 是隐藏模型的那张，用来找模型所在的格子 */
async function compareShots(subject: string, reference: string, withoutModel: string | null, type?: string): Promise<ShotComparison> {
  const [a, b] = await Promise.all([decodeShot(subject, type), decodeShot(reference, type)]);
  const mask = withoutModel ? modelMask(b, await decodeShot(withoutModel, type)) : null;
  const comparison = compareSharpness(sharpnessGrid(a), sharpnessGrid(b), mask);
  return {
    ...comparison,
    heatmap: drawHeatmap(a, comparison.ratios),
    worstCrops: drawWorstCrops(a, b, comparison.ratios)
  };
}

declare global {
  interface Window {
    compareShots: typeof compareShots;
  }
}

window.compareShots = compareShots;
