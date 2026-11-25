// 导出图片的图例（ADR 0174）：各拥有者给出从上到下的几组，这里只排版；符号由拥有者画（资源、模型、行政区边界各有画法）

/** 符号画在哪里，CSS 像素 */
export interface SwatchBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 图例的一行：文字和画符号的函数 */
export interface PrintLegendRow {
  readonly label: string;
  readonly drawSwatch: (context: CanvasRenderingContext2D, box: SwatchBox) => void;
}

/** 一组：有标题时是分类的资源、三维模型、行政区边界；没有标题时只有一行，文字是资源名，加粗 */
export interface PrintLegendBlock {
  readonly title: string | null;
  /** 跨到下一列时那一列开头的标题；不给时是"标题（续）" */
  readonly continued?: string;
  readonly rows: readonly PrintLegendRow[];
}

/** 文字的几种样式：图例两字、组的标题、单独一行的资源名、各行的文字 */
export type LegendFont = 'title' | 'header' | 'strong' | 'label';

/** 排版的尺寸，CSS 像素：一列宽 232，符号同子图例 22 × 16 */
export const LEGEND_METRICS = {
  columnWidth: 232,
  padding: 16,
  titleHeight: 30,
  headerHeight: 26,
  rowHeight: 24,
  lineHeight: 18,
  gap: 8,
  swatchWidth: 22,
  swatchHeight: 16,
  swatchGap: 8
} as const;

/** 排好的一项：在第几列、离图例顶上多远、分好的行 */
export type LegendItem =
  | {
      readonly kind: 'title' | 'header';
      readonly column: number;
      readonly y: number;
      readonly lines: readonly string[];
    }
  | {
      readonly kind: 'row';
      readonly column: number;
      readonly y: number;
      readonly height: number;
      readonly lines: readonly string[];
      readonly font: 'strong' | 'label';
      readonly row: PrintLegendRow;
    };

export interface LegendLayout {
  readonly items: readonly LegendItem[];
  readonly columns: number;
  /** 整个图例的宽高（含内边距） */
  readonly width: number;
  readonly height: number;
}

/** 按字形的实际宽度分行，放不下的字挪到下一行；一个字也放不下时照样占一行 */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of text) {
    if (line !== '' && measure(line + character) > maxWidth) {
      lines.push(line);
      line = '';
    }
    line += character;
  }
  return line === '' ? lines : [...lines, line];
}

const { columnWidth, padding, titleHeight, headerHeight, rowHeight, lineHeight, gap, swatchWidth, swatchGap } =
  LEGEND_METRICS;
const TEXT_WIDTH = columnWidth - padding * 2;
const ROW_TEXT_WIDTH = TEXT_WIDTH - swatchWidth - swatchGap;

// 一项文字分成几行后的高度：至少一行的高度，多出的行按行高加
const heightOf = (minimum: number, lines: number) => Math.max(minimum, minimum + (lines - 1) * lineHeight);

/**
 * 按高度分列（ADR 0174）：一列放不下就换到右边一列；组的标题不和它的第一行分开，整组放得进新的一列时整组换列，
 * 比一列还高的组才跨列，跨列时新的一列开头写"（续）"。
 * maxHeight 是图例最高多高（含内边距），一项本身比它高时照样放下
 */
export function layoutPrintLegend(
  blocks: readonly PrintLegendBlock[],
  maxHeight: number,
  measure: (text: string, font: LegendFont) => number
): LegendLayout {
  const items: LegendItem[] = [{ kind: 'title', column: 0, y: padding, lines: ['图例'] }];
  const bottom = maxHeight - padding;
  let column = 0;
  let y = padding + titleHeight;
  let filled = true;
  let lowest = y;
  const nextColumn = () => {
    column += 1;
    y = padding;
    filled = false;
  };
  const header = (text: string) => {
    const lines = wrapText(text, TEXT_WIDTH, value => measure(value, 'header'));
    return { lines, height: heightOf(headerHeight, lines.length) };
  };
  const place = (item: LegendItem, height: number) => {
    items.push(item);
    y += height;
    filled = true;
    lowest = Math.max(lowest, y);
  };
  for (const block of blocks) {
    const font = block.title === null ? 'strong' : 'label';
    const rows = block.rows.map(row => {
      const lines = wrapText(row.label, ROW_TEXT_WIDTH, value => measure(value, font));
      return { row, lines, height: heightOf(rowHeight, lines.length) };
    });
    if (filled && y > padding) {
      y += gap;
    }
    const title = block.title === null ? null : header(block.title);
    // 标题至少带着第一行；整组放得进新的一列时不拆开，比一列还高的组才跨列
    const first = (title?.height ?? 0) + (rows[0]?.height ?? 0);
    const whole = (title?.height ?? 0) + rows.reduce((sum, item) => sum + item.height, 0);
    if (filled && (y + first > bottom || (y + whole > bottom && padding + whole <= bottom))) {
      nextColumn();
    }
    if (title) {
      place({ kind: 'header', column, y, lines: title.lines }, title.height);
    }
    rows.forEach(({ row, lines, height }, index) => {
      if (index > 0 && y + height > bottom) {
        nextColumn();
        if (block.title !== null) {
          const continued = header(block.continued ?? `${block.title}（续）`);
          place({ kind: 'header', column, y, lines: continued.lines }, continued.height);
        }
      }
      place({ kind: 'row', column, y, height, lines, font, row }, height);
    });
  }
  const columns = column + 1;
  return { items, columns, width: columns * columnWidth, height: lowest + padding };
}
