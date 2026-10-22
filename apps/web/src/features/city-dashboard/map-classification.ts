import { isValue } from './calculations';

export interface MapClassification {
  readonly breaks: readonly number[];
  readonly min: number | null;
  readonly max: number | null;
  readonly displayMin: number | null;
  readonly displayMax: number | null;
  readonly sampleCount: number;
  readonly classCount: number;
}

/** 清理步长尾差，不改变原始观测值 */
function cleanBoundary(value: number): number {
  return Number(value.toPrecision(14));
}

/** 在不同观测值间寻找整齐边界，相等值不拆档 */
function friendlyBoundary(lower: number, upper: number): number {
  if (!Number.isFinite(upper - lower)) {
    return lower / 2 + upper / 2;
  }
  const magnitude = Math.ceil(Math.log10(upper - lower));
  for (let exponent = magnitude; exponent >= magnitude - 16; exponent--) {
    for (const factor of [5, 2, 1]) {
      const step = factor * 10 ** exponent;
      const value = cleanBoundary((Math.floor(lower / step) + 1) * step);
      if (value > lower && value <= upper) {
        return value;
      }
    }
  }
  return upper;
}

/** 分布接近时优先采用 0 / 5 结尾的整数 */
function boundaryPenalty(value: number): number {
  if (Number.isInteger(value)) {
    return value % 5 === 0 ? 0 : 0.08;
  }
  const [coefficient, exponent = '0'] = String(value).split('e');
  const digits = Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
  return 0.08 + digits * 0.12;
}

function displayExtent(min: number, max: number, count: number): [number, number] {
  const rawStep = (max - min) / count;
  if (min === max || !Number.isFinite(rawStep) || rawStep <= 0) {
    return [min, max];
  }
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const factor = [1, 2, 5, 10].find(value => value * magnitude >= rawStep) ?? 10;
  const step = factor * magnitude;
  return [
    cleanBoundary(Math.floor(cleanBoundary(min / step)) * step),
    cleanBoundary(Math.ceil(cleanBoundary(max / step)) * step)
  ];
}

/** 保留旧动态规划：联合平衡各档样本数与边界可读性，详见模块文档 */
export function createMapClassification(values: readonly (number | null)[], maxClasses = 5): MapClassification {
  const samples = values.filter(isValue).toSorted((a, b) => a - b);
  const groups: { value: number; count: number }[] = [];
  samples.forEach((value, index) => {
    if (index === 0 || value !== samples[index - 1]) {
      groups.push({ value, count: index });
    }
  });
  const classCount = Math.min(groups.length, 5, Math.max(1, Math.floor(maxClasses) || 5));
  const min = samples[0] ?? null;
  const max = samples.at(-1) ?? null;
  const breaks: number[] = [];
  if (classCount > 1) {
    // 首尾不参与边界惩罚，仍提供明确数值以免出现未定义的分界
    const nodes = [{ count: 0, value: samples[0] }, ...groups.slice(1).map((group, index) => ({
      count: group.count,
      value: friendlyBoundary(groups[index].value, group.value)
    })), { count: samples.length, value: samples[samples.length - 1] }];
    const last = nodes.length - 1;
    const costs = Array.from({ length: classCount + 1 }, () => Array<number>(nodes.length).fill(Infinity));
    const previous = Array.from({ length: classCount + 1 }, () => Array<number>(nodes.length).fill(-1));
    costs[0][0] = 0;
    for (let count = 1; count <= classCount; count++) {
      for (let end = count; end <= last; end++) {
        if ((count === classCount) !== (end === last)) {
          continue;
        }
        for (let start = count - 1; start < end; start++) {
          if (!Number.isFinite(costs[count - 1][start])) {
            continue;
          }
          const proportion = (nodes[end].count - nodes[start].count) / samples.length;
          const balance = (proportion * classCount - 1) ** 2 / classCount;
          const friendly = end === last ? 0 : boundaryPenalty(nodes[end].value) / classCount;
          const score = costs[count - 1][start] + balance + friendly;
          if (score < costs[count][end]) {
            costs[count][end] = score;
            previous[count][end] = start;
          }
        }
      }
    }
    let cursor = last;
    for (let count = classCount; count > 1; count--) {
      cursor = previous[count][cursor];
      breaks.unshift(nodes[cursor].value);
    }
  }
  const [displayMin, displayMax] = min !== null && max !== null
    ? displayExtent(min, max, classCount) : [null, null];
  return { breaks, min, max, displayMin, displayMax, sampleCount: samples.length, classCount };
}

/** 左闭右开，末档包含最大值，越界有效值归首尾档 */
export function getMapClassIndex(value: number | null, classification: MapClassification): number | null {
  if (!isValue(value) || !classification.classCount) {
    return null;
  }
  const index = classification.breaks.findIndex(boundary => value < boundary);
  return index < 0 ? classification.breaks.length : index;
}
