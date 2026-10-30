import type { ScreenPoint } from '@yzt/map-core';

/** 城市标注的三种写法：名称和值、只有名称、只有圆点（悬停看名称和值） */
export type LabelLevel = 'full' | 'name' | 'dot';

export interface LabelSpec {
  /** 标注中心在画布上的位置 */
  readonly point: ScreenPoint;
  readonly name: string;
  readonly value: string;
  /** 先摆：悬停的、放大的市 */
  readonly first: boolean;
}

/** 标注高 22，左右内边距 8，圆点 7、和文字间隔 4（SimulationMapOverlay.module.scss） */
const HEIGHT = 22;
const PADDING = 16;
const DOT = 7 + 4;
// 互相之间至少留 2 像素
const GAP = 2;

// 12 像素的字：汉字 12 宽，数字、字母、符号约 7 宽（标注里只有基本平面的字符，length 就是字数）
const textWidth = (text: string): number => text.length * 7 + (text.match(/[⺀-鿿＀-￯]/g)?.length ?? 0) * 5;

/** 每种写法的宽度 */
export function labelWidth(spec: Pick<LabelSpec, 'name' | 'value'>, level: LabelLevel): number {
  const name = PADDING + DOT + textWidth(spec.name);
  const widths: Record<LabelLevel, number> = { full: name + 4 + textWidth(spec.value), name, dot: 10 + 7 };
  return widths[level];
}

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const boxOf = (point: ScreenPoint, width: number): Box => ({
  left: point.x - width / 2,
  right: point.x + width / 2,
  top: point.y - HEIGHT / 2,
  bottom: point.y + HEIGHT / 2
});

const overlaps = (a: Box, b: Box) =>
  a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP;

/**
 * 按顺序摆标注（先摆 first 的）：和已经摆下的重叠时先省掉数值，再只留圆点；圆点也压住时照样摆（它很小）。
 * 返回值和输入一一对应
 */
export function labelLevels(specs: readonly LabelSpec[]): LabelLevel[] {
  const levels: LabelLevel[] = specs.map(() => 'dot');
  const placed: Box[] = [];
  const order = specs.map((spec, index) => ({ spec, index })).toSorted((a, b) => Number(b.spec.first) - Number(a.spec.first));
  for (const { spec, index } of order) {
    const level = (['full', 'name', 'dot'] as const).find(
      candidate => !placed.some(other => overlaps(boxOf(spec.point, labelWidth(spec, candidate)), other))
    ) ?? 'dot';
    levels[index] = level;
    placed.push(boxOf(spec.point, labelWidth(spec, level)));
  }
  return levels;
}
