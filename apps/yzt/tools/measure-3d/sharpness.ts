// 画面的清晰度（算法和校准见 docs/modules/map-three.md）：不数瓦片，看画面。
// 分格算对数亮度的梯度能量，再除以缩小 4 倍后的梯度能量：
// - 取对数：光照是乘在亮度上的，取对数后变成加减，梯度里就没有了，明暗整体变了不影响
// - 除以缩小后的：糊是丢了高频，低频还在；同一格里自己比自己，对比度整体高低也不影响
// - 先缩小一半：像素级的锯齿（没开多重采样时的边缘）不算清晰。瓦片粗一级时贴图糊了不止一个像素，缩小一半后还看得出来

/** 一张图：每个像素 4 个字节（RGBA） */
export interface Pixels {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

/** 按格的清晰度，从左到右、从上到下；太平的格子（没有内容可比）是 null */
export interface SharpnessGrid {
  readonly cols: number;
  readonly rows: number;
  readonly values: readonly (number | null)[];
}

export const GRID_COLS = 16;
export const GRID_ROWS = 9;
const PREFILTER = 2;
const DOWNSCALE = 4;
// 梯度低于它算太平：天空、纯色的地面没有清晰度可言。log 亮度的单位，约等于 0.4% 的亮度差
const MIN_ENERGY = 0.004;

function logLuminance({ data, width, height }: Pixels): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    // 加 1：全黑的像素取对数不会是负无穷
    out[i] = Math.log(0.299 * r + 0.587 * g + 0.114 * b + 1);
  }
  return out;
}

function shrink(source: Float32Array, width: number, height: number, factor: number) {
  const smallWidth = Math.floor(width / factor);
  const smallHeight = Math.floor(height / factor);
  const out = new Float32Array(smallWidth * smallHeight);
  for (let y = 0; y < smallHeight; y++) {
    for (let x = 0; x < smallWidth; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          sum += source[(y * factor + dy) * width + x * factor + dx] ?? 0;
        }
      }
      out[y * smallWidth + x] = sum / (factor * factor);
    }
  }
  return { values: out, width: smallWidth, height: smallHeight };
}

// 每格的平均梯度（相邻像素的差的绝对值）；格子按比例划分，缩小以后还是同一块画面
function gradientEnergy(values: Float32Array, width: number, height: number, cols: number, rows: number): Float32Array {
  const sums = new Float64Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < height - 1; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width - 1; x++) {
      const col = Math.min(cols - 1, Math.floor((x * cols) / width));
      const here = values[y * width + x] ?? 0;
      const gradient = Math.abs((values[y * width + x + 1] ?? 0) - here) + Math.abs((values[(y + 1) * width + x] ?? 0) - here);
      const cell = row * cols + col;
      sums[cell] = (sums[cell] ?? 0) + gradient;
      counts[cell] = (counts[cell] ?? 0) + 1;
    }
  }
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) {
    const count = counts[i] ?? 0;
    out[i] = count > 0 ? (sums[i] ?? 0) / count : 0;
  }
  return out;
}

/** 算一张图按格的清晰度 */
export function sharpnessGrid(pixels: Pixels, cols = GRID_COLS, rows = GRID_ROWS): SharpnessGrid {
  const halved = shrink(logLuminance(pixels), pixels.width, pixels.height, PREFILTER);
  const small = shrink(halved.values, halved.width, halved.height, DOWNSCALE);
  const fine = gradientEnergy(halved.values, halved.width, halved.height, cols, rows);
  const coarse = gradientEnergy(small.values, small.width, small.height, cols, rows);
  const values = Array.from(fine, (energy, index) => {
    const base = coarse[index] ?? 0;
    return base < MIN_ENERGY ? null : energy / base;
  });
  return { cols, rows, values };
}

/** 两张图的比较：只比模型所在的格子 */
export interface SharpnessComparison {
  /** 比了多少格 */
  readonly cells: number;
  /** subject / reference 的比值：中位数、最差 10% 的那个值 */
  readonly medianRatio: number | null;
  readonly worstDecileRatio: number | null;
  /** 每格的比值，不比的格子是 null */
  readonly ratios: readonly (number | null)[];
}

function quantile(sorted: readonly number[], fraction: number): number | null {
  return sorted.length === 0 ? null : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null);
}

/** subject / reference 按格的比值；mask 为 false 的格子（没有模型）不比 */
export function compareSharpness(
  subject: SharpnessGrid,
  reference: SharpnessGrid,
  mask: readonly boolean[] | null = null
): SharpnessComparison {
  if (subject.values.length !== reference.values.length) {
    throw new Error('两张图的格子数不同');
  }
  const ratios = subject.values.map((value, index) => {
    const base = reference.values[index];
    if (value === null || value === undefined || base === null || base === undefined || base === 0) {
      return null;
    }
    return mask && !mask[index] ? null : value / base;
  });
  const sorted = ratios.filter(value => value !== null).toSorted((a, b) => a - b);
  return {
    cells: sorted.length,
    medianRatio: quantile(sorted, 0.5),
    worstDecileRatio: quantile(sorted, 0.1),
    ratios
  };
}

/** 一次清晰→模糊：时刻（序列里的第几张）和掉下去的格子占可比格子的比例 */
export interface BlurEvent {
  readonly index: number;
  readonly share: number;
}

// 跌破这一格自己的最高值这么多，而且持续两张以上才算：一张的抖动可能是截图的时机
const BLUR_DROP = 0.85;
const BLUR_SAMPLES = 2;
// 掉下去的格子少于这个比例不算：肉眼看不出来
const BLUR_MIN_SHARE = 0.02;

/**
 * 静止时的一串截图里，画面变糊了几次。每格记自己到目前为止的最高值（变清晰是正常的加载），
 * 跌破最高值 15% 且持续两张才算；同一张里新掉下去的格子合成一次
 */
export function blurEvents(series: readonly SharpnessGrid[]): BlurEvent[] {
  const first = series[0];
  if (!first) {
    return [];
  }
  const cells = first.values.length;
  const peaks = Array.from({ length: cells }, () => 0);
  const low = Array.from({ length: cells }, () => 0);
  const events: BlurEvent[] = [];
  series.forEach((grid, index) => {
    let fallen = 0;
    let comparable = 0;
    for (let cell = 0; cell < cells; cell++) {
      const value = grid.values[cell];
      if (value === null || value === undefined) {
        continue;
      }
      comparable++;
      const peak = peaks[cell] ?? 0;
      if (value < peak * BLUR_DROP) {
        const run = (low[cell] ?? 0) + 1;
        low[cell] = run;
        if (run === BLUR_SAMPLES) {
          fallen++;
          // 这一次算过了：从这个值重新开始记，回不去的话不重复算
          peaks[cell] = value;
          low[cell] = 0;
        }
      } else {
        low[cell] = 0;
        peaks[cell] = Math.max(peak, value);
      }
    }
    if (comparable > 0 && fallen / comparable >= BLUR_MIN_SHARE) {
      events.push({ index, share: fallen / comparable });
    }
  });
  return events;
}
