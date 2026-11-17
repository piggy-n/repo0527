// 比例尺总长度的候选（千米；1 千米都放不下时同样的数改用米），从短到长
const LENGTHS = [1, 2, 4, 5, 8, 10, 20, 40, 50, 80, 100, 120, 160, 200, 400];

// 刻度文字依次尝试的显示方式：五个都写、只写 0 和 L/2 和 L、只写两端
const LABEL_SETS = [[0, 1, 2, 3, 4], [0, 2, 4], [0, 4]];

// 相邻两个刻度文字之间至少留的空隙（像素）
const LABEL_GAP = 6;

/** 最后一个刻度文字和单位之间的空隙（像素） */
export const SCALE_UNIT_GAP = 4;

export interface ScaleTick {
  /** 离比例尺左端的像素 */
  readonly offset: number;
  /** 刻度文字；放不下时为 null，只画分段 */
  readonly label: string | null;
}

export interface ScaleBar {
  /** 总长度 L 的像素宽度 */
  readonly width: number;
  /** 总长度 L 的数值，单位见 unit */
  readonly length: number;
  readonly unit: '千米' | '米';
  /** 0、L/4、L/2、3L/4、L 五个刻度 */
  readonly ticks: readonly ScaleTick[];
}

/** 按 maxWidth 选比例尺的总长度和刻度文字，算法见 docs/modules/dashboard.md「指北针和比例尺」；算不出来时为 null */
export function scaleBar(
  metersPerPixel: number,
  maxWidth: number,
  textWidth: (text: string) => number
): ScaleBar | null {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0 || !(maxWidth > 0)) {
    return null;
  }
  const candidates = [
    ...LENGTHS.map(length => ({ length, unit: '千米' as const, meters: length * 1000 })),
    ...LENGTHS.map(length => ({ length, unit: '米' as const, meters: length }))
  ];
  const chosen = candidates
    .toSorted((a, b) => b.meters - a.meters)
    .find(({ length, unit, meters }) => {
      const overhang = (textWidth('0') + textWidth(String(length))) / 2 + SCALE_UNIT_GAP + textWidth(unit);
      return meters / metersPerPixel + overhang <= maxWidth;
    });
  if (!chosen) {
    return null;
  }
  const width = chosen.meters / metersPerPixel;
  const texts = [0, 1, 2, 3, 4].map(index => String(chosen.length * index / 4));
  const offsets = texts.map((_, index) => width * index / 4);
  const fits = (indexes: readonly number[]) => indexes.slice(1).every((index, position) => {
    const previous = indexes[position];
    const room = offsets[index] - offsets[previous];
    return room >= (textWidth(texts[index]) + textWidth(texts[previous])) / 2 + LABEL_GAP;
  });
  // 两端都放不下时也写两端：这么窄的比例尺只出现在极小的地图上
  const shown = LABEL_SETS.find(fits) ?? [0, 4];
  return {
    width,
    length: chosen.length,
    unit: chosen.unit,
    ticks: texts.map((text, index) => ({ offset: offsets[index], label: shown.includes(index) ? text : null }))
  };
}
