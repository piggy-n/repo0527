import type { Pixels } from './sharpness.ts';

// 三个通道都不低于它算接近白色（ADR 0149 的亮处偏白）
const BRIGHT_LEVEL = 235;
// 显示和隐藏模型的两张图，三个通道的差加起来超过它才算模型的像素：底图的压缩噪声不算
const CHANGED_LEVEL = 24;

export interface ShotCoverageRatios {
  readonly modelCoveragePct: number;
  /** 模型的像素里接近白色的比例；没有模型的像素时为 null */
  readonly brightPct: number | null;
}

/** 模型显示和隐藏各拍一张，比较后知道模型占多少画面、其中多少接近白色 */
export function shotCoverage(withModel: Pixels, withoutModel: Pixels): ShotCoverageRatios {
  const a = withModel.data;
  const b = withoutModel.data;
  let changed = 0;
  let bright = 0;
  for (let i = 0; i < a.length; i += 4) {
    const red = a[i] ?? 0;
    const green = a[i + 1] ?? 0;
    const blue = a[i + 2] ?? 0;
    const difference = Math.abs(red - (b[i] ?? 0)) + Math.abs(green - (b[i + 1] ?? 0)) + Math.abs(blue - (b[i + 2] ?? 0));
    if (difference > CHANGED_LEVEL) {
      changed += 1;
      if (Math.min(red, green, blue) >= BRIGHT_LEVEL) {
        bright += 1;
      }
    }
  }
  return {
    modelCoveragePct: (changed / (a.length / 4)) * 100,
    brightPct: changed > 0 ? (bright / changed) * 100 : null
  };
}
