import type { GraphSeriesOption } from 'echarts/charts';
import type { TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import { CANVAS_MARGIN, DISPLAY_SCALES, requiredClearance } from './graph-layout';
import type { GraphEdge, GraphEdgeKind, GraphPoint, GraphView, GraphViewport } from './graph-model';
import { EDGE_STYLES, MATCH_STYLE, NODE_STYLES } from './graph-style';
import {
  adaptiveFont,
  edgeFont,
  labelLength,
  LINE_RATIO,
  type MeasuredNode,
  measureNodes,
  MIN_FONT,
  nodeBoxAt,
  nodeSizeAt
} from './graph-text';

export type KnowledgeChartOption = ComposeOption<GraphSeriesOption | TooltipComponentOption>;

/** 画布不能直接用 CSS 变量，由组件从页面读出令牌的实际值传进来 */
export interface ChartTheme {
  fontFamily: string;
  background: string;
  primary: string;
  tooltipBackground: string;
  tooltipText: string;
}

/** 系列的 id：跨字号档时只更新它的 data、links */
export const GRAPH_SERIES_ID = 'knowledge-graph';

// 节点很少时不要放大太多，线不会长得离谱
const MAX_FIT_SCALE = 1.6;
const CURVENESS: Readonly<Record<GraphEdgeKind, number>> = {
  organize: 0.06,
  contains: 0.12,
  'class-mapping': 0.16,
  temporal: 0.3,
  'field-mapping': 0.16,
  spatial: 0.16
};
// 弯曲量不超过这么多像素，长线不会跑出画布
const MAX_BULGE = 34;
// 上下级的线随层级变细，和旧页面一致
const CONTAINS_WIDTHS = [2.6, 2.2, 1.6, 1.4];
const ORGANIZE_WIDTH = 3;
// 名称避让的优先级：组织关系 > 对应、时序 > 包含
const LABEL_PRIORITY: Readonly<Record<GraphEdgeKind, number>> = {
  organize: 0,
  'class-mapping': 1,
  temporal: 1,
  'field-mapping': 1,
  spatial: 1,
  contains: 2
};

/** 按显示比例缩放后的节点 */
interface SizedNode extends MeasuredNode {
  size: number;
  box: readonly [number, number] | null;
}

function edgeCurveness(edge: GraphEdge, distance: number): number {
  return Math.min(CURVENESS[edge.kind], (MAX_BULGE * 2) / Math.max(1, distance));
}

function edgeWidth(edge: GraphEdge): number {
  if (edge.kind === 'organize') {
    return ORGANIZE_WIDTH;
  }
  if (edge.kind === 'contains') {
    return CONTAINS_WIDTHS[edge.depth] ?? 1.4;
  }
  return 1.8 + Math.min(edge.count - 1, 3) * 0.5;
}

interface FitBox {
  scale: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// 把节点完整放进画布：布局坐标到屏幕的比例（节点圆的大小不随它变）和系列的范围。系列的范围只算节点中心
function fitBox(nodes: readonly SizedNode[], positions: ReadonlyMap<string, GraphPoint>, viewport: GraphViewport) {
  const extent = (scale: number) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const point = positions.get(node.id) ?? { x: 0, y: 0 };
      const [halfW, halfH] = node.box ? [node.box[0] / 2, node.box[1] / 2] : [node.size / 2, node.size / 2];
      minX = Math.min(minX, point.x * scale - halfW);
      maxX = Math.max(maxX, point.x * scale + halfW);
      minY = Math.min(minY, point.y * scale - halfH);
      maxY = Math.max(maxY, point.y * scale + halfH);
    }
    return { minX, maxX, minY, maxY };
  };
  const fits = (scale: number) => {
    const box = extent(scale);
    return (
      box.maxX - box.minX <= viewport.width - CANVAS_MARGIN * 2 &&
      box.maxY - box.minY <= viewport.height - CANVAS_MARGIN * 2
    );
  };
  let low = 0.02;
  let high = MAX_FIT_SCALE;
  if (fits(high)) {
    low = high;
  } else {
    for (let step = 0; step < 28; step += 1) {
      const middle = (low + high) / 2;
      if (fits(middle)) {
        low = middle;
      } else {
        high = middle;
      }
    }
  }
  const box = extent(low);
  const xs = nodes.map(node => (positions.get(node.id)?.x ?? 0) * low);
  const ys = nodes.map(node => (positions.get(node.id)?.y ?? 0) * low);
  const result: FitBox = {
    scale: low,
    left: (viewport.width - (box.maxX - box.minX)) / 2 + (Math.min(...xs) - box.minX),
    top: (viewport.height - (box.maxY - box.minY)) / 2 + (Math.min(...ys) - box.minY),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys))
  };
  return result;
}

const reachOf = (node: SizedNode) => (node.box ? Math.max(node.box[0], node.box[1]) / 2 : node.size / 2);

// 相距最近的一对节点边缘的距离；小于 0 说明重叠
function minClearance(nodes: readonly SizedNode[], positions: ReadonlyMap<string, GraphPoint>, scale: number): number {
  let smallest = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = positions.get(nodes[i].id) ?? { x: 0, y: 0 };
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = positions.get(nodes[j].id) ?? { x: 0, y: 0 };
      const distance = Math.hypot(a.x - b.x, a.y - b.y) * scale;
      smallest = Math.min(smallest, distance - reachOf(nodes[i]) - reachOf(nodes[j]));
    }
  }
  return smallest;
}

// 取节点互不重叠、还留得下空隙的最大显示比例
function chooseDisplay(
  nodes: readonly MeasuredNode[],
  positions: ReadonlyMap<string, GraphPoint>,
  viewport: GraphViewport
): { displayScale: number; box: FitBox; sized: SizedNode[] } {
  let chosen: { displayScale: number; box: FitBox; sized: SizedNode[] } | null = null;
  for (const displayScale of DISPLAY_SCALES) {
    const sized = nodes.map(node => ({
      ...node,
      size: nodeSizeAt(node, displayScale),
      box: nodeBoxAt(node, displayScale)
    }));
    const box = fitBox(sized, positions, viewport);
    chosen = { displayScale, box, sized };
    if (minClearance(sized, positions, box.scale) >= requiredClearance(displayScale) - 1) {
      break;
    }
  }
  if (!chosen) {
    throw new Error('显示比例的清单不能为空');
  }
  return chosen;
}

type LabelPosition =
  | 'middle'
  | 'insideMiddleBottom'
  | 'insideStartTop'
  | 'insideEndTop'
  | 'insideStartBottom'
  | 'insideEndBottom';

function nodeTooltip(node: MeasuredNode): string {
  const lines = [[node.code, node.name].filter(Boolean).join(' ')];
  if (node.childCount > 0) {
    lines.push(node.hiddenChildren > 0 ? `已收起 ${node.hiddenChildren} 个下级，双击展开` : '双击收起下级');
  }
  return lines.join('<br>');
}

/** 关系图一次显示的全部内容：缩放时只有 labelKey 变了才需要换 data、links */
export interface GraphDisplay {
  option: KnowledgeChartOption;
  /** 缩放为 1 时布局坐标到屏幕的比例，组件用它算当前缩放 */
  baseScale: number;
  /** 这个缩放下的字号和关系名称的位置，相同就不用更新 */
  labelKey: (zoom: number) => string;
  nodeItems: (zoom: number) => NonNullable<GraphSeriesOption['data']>;
  linkItems: (zoom: number) => NonNullable<GraphSeriesOption['links']>;
  /** 这个缩放下每条线的名称放在哪；放不下的为 null（悬停时显示） */
  planLabels: (zoom: number) => ReadonlyMap<string, LabelPosition | null>;
  /** 显示比例，节点和字号相对基准的倍数 */
  displayScale: number;
  /** 这个缩放下每个节点的字号，0 表示太小、不画 */
  fontsAt: (zoom: number) => readonly number[];
}

/**
 * 关系图的显示：名称写在节点里，字号跟屏幕上的直径走；每条线写关系名称，压节点或压别的名称就换位置，都不行就不画。
 * overrides 是拖动过的节点位置，ECharts 不写回配置，更新标签时要带上
 */
export function createGraphDisplay(
  view: GraphView,
  positions: ReadonlyMap<string, GraphPoint>,
  theme: ChartTheme,
  viewport: GraphViewport,
  overrides: ReadonlyMap<string, GraphPoint> = new Map()
): GraphDisplay {
  const { displayScale, box, sized } = chooseDisplay(measureNodes(view.nodes), positions, viewport);
  const nodeById = new Map(sized.map(node => [node.id, node]));
  const pointOf = (id: string) => overrides.get(id) ?? positions.get(id) ?? { x: 0, y: 0 };
  const orderedEdges = view.edges.toSorted(
    (a, b) => LABEL_PRIORITY[a.kind] - LABEL_PRIORITY[b.kind] || a.depth - b.depth
  );

  function planLabels(zoom: number): Map<string, LabelPosition | null> {
    const plan = new Map<string, LabelPosition | null>();
    const fontSize = edgeFont(displayScale, zoom);
    if (fontSize === 0) {
      return plan;
    }
    const scale = box.scale * zoom;
    const circles = sized.map(node => {
      const point = pointOf(node.id);
      return { id: node.id, x: point.x * scale, y: point.y * scale, r: reachOf(node) * zoom };
    });
    const circleOf = new Map(circles.map(circle => [circle.id, circle]));
    const placed: GraphPoint[][] = [];
    for (const edge of orderedEdges) {
      const from = circleOf.get(edge.source);
      const to = circleOf.get(edge.target);
      if (!from || !to) {
        continue;
      }
      const length = labelLength(edge.label, fontSize);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const gap = distance - from.r - to.r;
      if (gap < length + 2) {
        plan.set(edge.id, null);
        continue;
      }
      const ux = dx / distance;
      const uy = dy / distance;
      // 线的弯曲和文字在线旁边的偏移；ECharts 的线向法线方向弯，文字上下相对屏幕
      const bulge = (edgeCurveness(edge, distance) * distance) / 2;
      const nx = uy;
      const ny = -ux;
      const up = ny <= 0 ? 1 : -1;
      const offset = fontSize / 2 + 5;
      const centerAt = (along: number, side: number): GraphPoint => {
        const t = along / distance;
        const bend = bulge * 4 * t * (1 - t);
        return {
          x: from.x + ux * along + nx * bend + nx * up * side * offset,
          y: from.y + uy * along + ny * bend + ny * up * side * offset
        };
      };
      const candidates: readonly (readonly [LabelPosition, number, number])[] = [
        ['middle', from.r + gap / 2, 1],
        ['insideMiddleBottom', from.r + gap / 2, -1],
        ['insideStartTop', from.r + length / 2 + 6, 1],
        ['insideEndTop', distance - to.r - length / 2 - 6, 1],
        ['insideStartBottom', from.r + length / 2 + 6, -1],
        ['insideEndBottom', distance - to.r - length / 2 - 6, -1]
      ];
      let position: LabelPosition | null = null;
      for (const [name, along, side] of candidates) {
        const center = centerAt(along, side);
        const samples = [-0.5, -0.25, 0, 0.25, 0.5].map(part => ({
          x: center.x + ux * length * part,
          y: center.y + uy * length * part
        }));
        const hitsNode = circles.some(circle =>
          samples.some(sample => Math.hypot(sample.x - circle.x, sample.y - circle.y) < circle.r + 3)
        );
        const hitsLabel = placed.some(other =>
          samples.some(sample => other.some(point => Math.hypot(sample.x - point.x, sample.y - point.y) < fontSize + 2))
        );
        if (!hitsNode && !hitsLabel) {
          position = name;
          placed.push(samples);
          break;
        }
      }
      plan.set(edge.id, position);
    }
    return plan;
  }

  function nodeItems(zoom: number): NonNullable<GraphSeriesOption['data']> {
    return sized.map(node => {
      const style = NODE_STYLES[node.category];
      const point = pointOf(node.id);
      const fontSize = adaptiveFont(node, displayScale, zoom);
      const shownSize = fontSize || MIN_FONT;
      return {
        id: node.id,
        name: node.name,
        x: point.x,
        y: point.y,
        symbol: node.box ? 'roundRect' : 'circle',
        symbolSize: node.box ? [...node.box] : node.size,
        itemStyle: {
          color: style.fill,
          borderColor: node.match ? MATCH_STYLE.border : (style.border ?? theme.background),
          borderWidth: node.match ? 3 : node.box ? 1.5 : 2,
          borderType: node.hiddenChildren > 0 ? 'dashed' : 'solid',
          shadowBlur: node.kind === 'root' ? 18 : 8,
          shadowColor: node.match ? MATCH_STYLE.glow : style.glow
        },
        label: {
          show: fontSize > 0,
          position: 'inside',
          formatter: node.labelText,
          fontFamily: theme.fontFamily,
          fontSize: shownSize,
          lineHeight: Math.round(shownSize * LINE_RATIO),
          fontWeight: node.fontWeight,
          color: style.text,
          align: 'center',
          verticalAlign: 'middle'
        }
      };
    });
  }

  function linkItems(zoom: number): NonNullable<GraphSeriesOption['links']> {
    const fontSize = edgeFont(displayScale, zoom) || MIN_FONT;
    const plan = planLabels(zoom);
    return view.edges.map(edge => {
      const style = EDGE_STYLES[edge.kind];
      const from = pointOf(edge.source);
      const to = pointOf(edge.target);
      const distance = Math.hypot(from.x - to.x, from.y - to.y) * box.scale;
      const position = plan.get(edge.id) ?? null;
      return {
        source: edge.source,
        target: edge.target,
        name: edge.label,
        // 两端都有 symbol 时线才裁到节点边缘，名称的位置才按可见的线段算；起点的 symbol 小到看不见
        symbol: ['circle', 'arrow'],
        symbolSize: [0.01, 9],
        lineStyle: {
          color: style.color,
          width: edgeWidth(edge),
          type: style.dash ? [...style.dash] : 'solid',
          curveness: edgeCurveness(edge, distance),
          opacity: edge.kind === 'contains' ? 0.75 : 0.95
        },
        label: {
          show: position !== null,
          position: position ?? 'middle',
          formatter: edge.label,
          fontFamily: theme.fontFamily,
          fontSize,
          fontWeight: edge.kind === 'contains' ? 400 : 600,
          color: style.text,
          textBorderColor: theme.background,
          textBorderWidth: 3
        }
      };
    });
  }

  const fontsAt = (zoom: number) => sized.map(node => adaptiveFont(node, displayScale, zoom));

  function edgeTooltip(edge: GraphEdge): string {
    const names = [nodeById.get(edge.source)?.name, nodeById.get(edge.target)?.name].join(' → ');
    return `${names}<br>${edge.label}${edge.kind === 'organize' ? '（组织关系，只用于展示）' : ''}`;
  }

  return {
    baseScale: box.scale,
    displayScale,
    labelKey: zoom =>
      `${edgeFont(displayScale, zoom)}|${fontsAt(zoom).join()}|${[...planLabels(zoom).values()].join()}`,
    nodeItems,
    linkItems,
    planLabels,
    fontsAt,
    option: {
      animation: false,
      textStyle: { fontFamily: theme.fontFamily },
      tooltip: {
        confine: true,
        appendToBody: true,
        backgroundColor: theme.tooltipBackground,
        borderWidth: 0,
        padding: [6, 10],
        textStyle: { color: theme.tooltipText, fontSize: MIN_FONT, fontFamily: theme.fontFamily },
        // 名称都来自内置数据，不含用户输入
        formatter: params => {
          const item = Array.isArray(params) ? params[0] : params;
          return item.dataType === 'edge'
            ? edgeTooltip(view.edges[item.dataIndex])
            : nodeTooltip(sized[item.dataIndex]);
        }
      },
      series: [
        {
          id: GRAPH_SERIES_ID,
          type: 'graph',
          layout: 'none',
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          roam: true,
          draggable: true,
          // 节点和间距一起缩放，重叠的情况不随缩放变化；字号跟着直径走
          nodeScaleRatio: 1,
          scaleLimit: { min: 0.5, max: 6 },
          selectedMode: 'single',
          emphasis: {
            focus: 'adjacency',
            scale: false,
            itemStyle: { shadowBlur: 20 },
            lineStyle: { width: 3, opacity: 1 },
            edgeLabel: { show: true, fontSize: MIN_FONT, fontWeight: 600 }
          },
          blur: {
            itemStyle: { opacity: 0.22 },
            label: { opacity: 0.45 },
            lineStyle: { opacity: 0.08 },
            edgeLabel: { opacity: 0 }
          },
          select: {
            itemStyle: { borderColor: theme.primary, borderWidth: 4, shadowBlur: 20, shadowColor: theme.primary }
          },
          data: nodeItems(1),
          links: linkItems(1)
        }
      ]
    }
  };
}
