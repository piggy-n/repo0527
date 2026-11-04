import type { GraphNode } from './graph-model';

// 名称写在节点里：圆内排版和字号自适应，纯函数（ADR 0126）

/** 字号的下限：低于它的名称不画，放大后出现，不让名称小到看不清 */
export const MIN_FONT = 12;
const MAX_FONT = 40;
// 圆内留给边缘的空隙，按直径的比例
const INSET = 0.06;
/** 多行名称的行高，相对字号 */
export const LINE_RATIO = 1.22;
// 关系名称放大后的字号和需要的显示比例；再小（节点放不下）就不画
const EDGE_FONT = 12;
const EDGE_FONT_LARGE = 14;
const EDGE_LARGE_FROM = 1.6;
const EDGE_HIDDEN_BELOW = 0.72;

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
// 分词器不认识的专业词，不从中间折行
const KEEP_TOGETHER = ['用地用海', '国土空间', '调查监测', '丰水期', '枯水期', '商业服务业', '畜禽'];
// 标点跟着旁边的字，不单独成行
const OPENING = /[“（《]/;
const CLOSING = /[”）》、，]/;
// 一个名称最多分几行
const MAX_LINES = 5;
// 枚举断点是指数级的，片段多于这个数时先按字数并成这么多段；总节点的名称带检索词，不由数据决定长度
const MAX_PARTS = 14;
// 按词比按字大超过这个比例才按字拆
const WORD_TOLERANCE = 1.25;

/** 文字的宽度，单位是字号：汉字占满一格，字母数字约六成 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) <= 0xff ? 0.6 : 1;
  }
  return width;
}

function splitWords(text: string): string[] {
  const breaks = new Set<number>();
  let at = 0;
  for (const { segment } of segmenter.segment(text)) {
    at += segment.length;
    breaks.add(at);
  }
  breaks.delete(text.length);
  for (const word of KEEP_TOGETHER) {
    let found = text.indexOf(word);
    while (found >= 0) {
      for (let index = found + 1; index < found + word.length; index += 1) {
        breaks.delete(index);
      }
      found = text.indexOf(word, found + 1);
    }
  }
  for (const index of breaks) {
    if (OPENING.test(text[index - 1]) || CLOSING.test(text[index])) {
      breaks.delete(index);
    }
  }
  const parts: string[] = [];
  let last = 0;
  for (const index of [...breaks].toSorted((a, b) => a - b)) {
    parts.push(text.slice(last, index));
    last = index;
  }
  parts.push(text.slice(last));
  return parts;
}

// 字号为 1 时，这种分行方案的文字块要多大的圆才放得下（半径）：每行的四个角都要在圆内
function requiredRadius(lines: readonly string[]): number {
  const total = lines.length * LINE_RATIO;
  let radius = 0;
  lines.forEach((line, index) => {
    const top = index * LINE_RATIO - total / 2;
    const reach = Math.max(Math.abs(top), Math.abs(top + LINE_RATIO));
    radius = Math.max(radius, Math.hypot(textWidth(line) / 2, reach));
  });
  return radius;
}

interface LineLayout {
  lines: string[];
  radius: number;
  score: number;
}

// 枚举断点，选所需半径最小的分行；多一行、单字成行都扣分，差不多大时选好读的
function bestLines(parts: readonly string[]): LineLayout {
  let best: LineLayout | null = null;
  for (let mask = 0; mask < 1 << (parts.length - 1); mask += 1) {
    const lines = [parts[0]];
    for (let index = 1; index < parts.length; index += 1) {
      if (mask & (1 << (index - 1))) {
        lines.push(parts[index]);
      } else {
        lines[lines.length - 1] += parts[index];
      }
    }
    if (lines.length > MAX_LINES) {
      continue;
    }
    const radius = requiredRadius(lines);
    const single = lines.length > 1 && lines.some(line => line.length === 1);
    const score = radius * (1 + (lines.length - 1) * 0.03) * (single ? 1.15 : 1);
    if (!best || score < best.score) {
      best = { lines, radius, score };
    }
  }
  return best ?? { lines: [...parts], radius: requiredRadius(parts), score: Infinity };
}

// 片段太多时按字数平均并起来，不丢字
function limitParts(text: string, parts: string[]): string[] {
  if (parts.length <= MAX_PARTS) {
    return parts;
  }
  const chars = Array.from(text);
  const size = Math.ceil(chars.length / MAX_PARTS);
  const grouped: string[] = [];
  for (let at = 0; at < chars.length; at += size) {
    grouped.push(chars.slice(at, at + size).join(''));
  }
  return grouped;
}

export interface NameFit {
  /** 折好行的名称 */
  lines: readonly string[];
  /** 字号为 1 时所需的圆半径 */
  radius: number;
}

// 名称来自内置数据和命中数据的检索词，数量有限，不用淘汰
const fits = new Map<string, NameFit>();

/**
 * 圆内排版：放大圆不改变最优的分行方案，所以每个名称只算一次；字号 = 可用半径 ÷ 这个半径，和节点直径成正比。
 * 优先在词之间折行，放不下才按字；不截断
 */
export function fitNameInCircle(name: string): NameFit {
  const cached = fits.get(name);
  if (cached) {
    return cached;
  }
  const clean = name.replace(/\s+/g, '');
  const byWord = bestLines(limitParts(clean, splitWords(clean)));
  const chars = Array.from(clean);
  const byChar = chars.length <= MAX_PARTS ? bestLines(chars) : byWord;
  const chosen = byWord.radius <= byChar.radius * WORD_TOLERANCE ? byWord : byChar;
  const fit = { lines: chosen.lines, radius: chosen.radius };
  fits.set(name, fit);
  return fit;
}

/** 排好版的节点：显示比例和缩放都是 1 时的大小 */
export interface MeasuredNode extends GraphNode {
  /** 这一层的基准字号和字重；字体只有 400、600 两个字重 */
  baseFont: number;
  fontWeight: 400 | 600;
  /** 写在节点里的文字：折好行的名称，收起时多一行"+n" */
  labelText: string;
  /** 圆的直径；数据表是矩形的宽 */
  baseSize: number;
  /** 放得下下限字号的最小直径；数据表是最小的宽 */
  minSize: number;
  /** 数据表是圆角矩形：[宽, 高] */
  baseBox: readonly [number, number] | null;
  /** 字号为 1 时圆内文字所需的半径；数据表是文字的宽度 */
  fitRadius: number;
}

// 每层的基准直径和基准字号
function levelStyle(node: GraphNode): { size: number; font: number; fontWeight: 400 | 600 } {
  if (node.kind === 'root') {
    return { size: 92, font: 16, fontWeight: 600 };
  }
  if (node.kind === 'system') {
    return { size: 76, font: 14, fontWeight: 600 };
  }
  if (node.kind === 'dataset') {
    return { size: 72, font: 12, fontWeight: 600 };
  }
  if (node.level === 1) {
    return { size: 62, font: 14, fontWeight: 600 };
  }
  return node.level === 2 ? { size: 54, font: 12, fontWeight: 600 } : { size: 46, font: 12, fontWeight: 400 };
}

const DATASET_HEIGHT = 36;
const DATASET_MIN_HEIGHT = 22;
const DATASET_PADDING = 20;
// 显示比例不低于这个值时，节点不缩到放不下下限字号：名称优先于节点之间的空隙。再小说明节点太多，才让小节点的名称放大后出现
const KEEP_NAMES_FROM = 0.6;

/** 给节点排版；圆不小于下限字号放得下名称的直径，名称再长也不截断 */
export function measureNodes(nodes: readonly GraphNode[]): MeasuredNode[] {
  return nodes.map(node => {
    const style = levelStyle(node);
    const base = { ...node, baseFont: style.font, fontWeight: style.fontWeight };
    if (node.kind === 'dataset') {
      const units = textWidth(node.name);
      const width = Math.max(style.size, units * MIN_FONT + DATASET_PADDING);
      return {
        ...base,
        labelText: node.name,
        baseSize: width,
        minSize: units * MIN_FONT + DATASET_PADDING,
        baseBox: [width, DATASET_HEIGHT],
        fitRadius: units
      };
    }
    const fit = fitNameInCircle(node.name);
    const mark = node.hiddenChildren > 0 ? `+${node.hiddenChildren}` : '';
    const fitRadius = mark ? fit.radius + LINE_RATIO / 2 : fit.radius;
    const needed = (fitRadius * MIN_FONT * 2) / (1 - INSET * 2);
    return {
      ...base,
      labelText: [...fit.lines, mark].filter(Boolean).join('\n'),
      baseSize: Math.max(style.size, Math.ceil(needed)),
      minSize: Math.ceil(needed),
      baseBox: null,
      fitRadius
    };
  });
}

/** 这个显示比例下节点的直径；数据表是矩形的宽 */
export function nodeSizeAt(node: MeasuredNode, displayScale: number): number {
  const size = node.baseSize * displayScale;
  return displayScale >= KEEP_NAMES_FROM ? Math.max(size, node.minSize) : size;
}

/** 这个显示比例下数据表的 [宽, 高]；其他节点为 null */
export function nodeBoxAt(node: MeasuredNode, displayScale: number): readonly [number, number] | null {
  if (!node.baseBox) {
    return null;
  }
  const height = node.baseBox[1] * displayScale;
  return [nodeSizeAt(node, displayScale), displayScale >= KEEP_NAMES_FROM ? Math.max(height, DATASET_MIN_HEIGHT) : height];
}

/**
 * 节点内的字号：基准字号 × 显示比例 × 缩放，放不下时按圆内空间；只取双数。
 * 差一点才放满时仍按下限显示（边缘的留白小一些），差得多返回 0，表示不画
 */
export function adaptiveFont(node: MeasuredNode, displayScale: number, zoom: number): number {
  const box = nodeBoxAt(node, displayScale);
  const room = box
    ? Math.min((box[0] * zoom - 12) / node.fitRadius, box[1] * zoom - 8)
    : ((nodeSizeAt(node, displayScale) * zoom) / 2) * (1 - INSET * 2) / node.fitRadius;
  const size = Math.min(node.baseFont * displayScale * zoom, room, MAX_FONT);
  if (size < MIN_FONT) {
    return room >= MIN_FONT - 1 ? MIN_FONT : 0;
  }
  return Math.floor(size / 2) * 2;
}

/** 关系名称的字号，0 表示节点太小、放不下 */
export function edgeFont(displayScale: number, zoom: number): number {
  const scale = displayScale * zoom;
  if (scale < EDGE_HIDDEN_BELOW) {
    return 0;
  }
  return scale >= EDGE_LARGE_FROM ? EDGE_FONT_LARGE : EDGE_FONT;
}

/** 关系名称沿线占的长度 */
export function labelLength(text: string, fontSize: number): number {
  return textWidth(text) * fontSize + 6;
}
