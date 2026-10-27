import type { GraphSeriesOption } from 'echarts/charts';
import type { LegendComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import { layoutGraph, nodeSize } from './graph-layout';
import { NODE_CATEGORIES, nodeCategory, nodeTitle } from './graph-style';
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from './knowledge-graph';

export type KnowledgeChartOption = ComposeOption<GraphSeriesOption | LegendComponentOption | TooltipComponentOption>;

/** 画布不能直接用 CSS 变量，由组件从页面读出令牌的实际值传进来 */
export interface ChartTheme {
  fontFamily: string;
  text: string;
  textSecondary: string;
  background: string;
  primary: string;
  warning: string;
}

// 图例左边距和右侧留给缩放按钮的宽度
const LEGEND_LEFT = 12;
const LEGEND_RIGHT = 128;
// 名称最宽 8 个字，超出换行，不截断
const LABEL_WIDTH = 112;
// 画布四周留白：左右放得下名称的一半，上面是图例，下面是最低一行节点的名称
const PADDING = { top: 64, right: 72, bottom: 48, left: 72 };
// 节点圆按布局里的直径和适配全图的比例缩放，和旧页面的几何一致、互不重叠；节点少时最多缩到一半
const MAX_NODE_SCALE = 0.5;
const MIN_NODE_SIZE = 10;

export interface ChartViewport {
  width: number;
  height: number;
}

// 名称的字号、字重：根节点、体系和一级类 14 / 600，其余 12 / 400；字体只有 400、600 两个字重
function labelFont(node: KnowledgeNode): [number, number] {
  return node.level === null || node.level === 1 ? [14, 600] : [12, 400];
}

// 适配全图时布局坐标到屏幕像素的比例（preserveAspect 的 contain）
function fitScale(points: Iterable<{ x: number; y: number }>, viewport: ChartViewport): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { x, y } of points) {
    xs.push(x);
    ys.push(y);
  }
  const width = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const height = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const viewWidth = viewport.width - PADDING.left - PADDING.right;
  const viewHeight = viewport.height - PADDING.top - PADDING.bottom;
  return Math.max(0, Math.min(viewWidth / width, viewHeight / height));
}

function edgeName(edge: KnowledgeEdge): string {
  return edge.type === 'contains' ? '包含' : '对应';
}

// 悬浮提示：完整的"编码 名称"和所属体系、层级；名称都来自内置数据，不含用户输入
function nodeTooltip(node: KnowledgeNode): string {
  const level = [node.systemName, node.levelName].filter(Boolean).join(' · ');
  return level ? `${node.label}<br>${level}` : node.label;
}

/**
 * 搜索子图的 ECharts 关系图配置：坐标沿用旧页面的力导布局，名称放在节点下方、屏幕字号固定，
 * 缩小时重叠的名称先隐藏小节点的（hideOverlap 按节点大小排优先级）；悬浮时突出相邻节点和关系
 */
export function knowledgeChartOption(
  graph: KnowledgeGraph,
  keyword: string,
  theme: ChartTheme,
  viewport: ChartViewport
): KnowledgeChartOption {
  const positions = layoutGraph(graph.nodes, graph.edges);
  const nodeScale = Math.min(MAX_NODE_SCALE, fitScale(positions.values(), viewport));
  const categoryIndex = new Map(NODE_CATEGORIES.map((category, index) => [category.id, index]));
  const textStyle = {
    fontFamily: theme.fontFamily,
    color: theme.text,
    textBorderColor: theme.background,
    textBorderWidth: 3
  };
  return {
    animation: false,
    textStyle: { fontFamily: theme.fontFamily },
    tooltip: {
      confine: true,
      formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        if (item.dataType === 'edge') {
          return item.name;
        }
        return nodeTooltip(graph.nodes[item.dataIndex]);
      }
    },
    // 一行放不下时翻页，不压到关系图上；右上角留给缩放按钮。图例同时给 left 和 right 时 ECharts 会丢掉 right，宽度要直接给
    legend: {
      type: 'scroll',
      top: 14,
      left: LEGEND_LEFT,
      width: viewport.width - LEGEND_LEFT - LEGEND_RIGHT,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { ...textStyle, textBorderWidth: 0, color: theme.textSecondary, fontSize: 12 },
      data: NODE_CATEGORIES.map(category => category.label)
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        // 布局坐标等比例缩放到画布里，圆不被拉成椭圆
        preserveAspect: true,
        ...PADDING,
        roam: true,
        draggable: true,
        // 放大时节点圆比间距长得慢，名称字号不变，越放大越不拥挤
        nodeScaleRatio: 0.6,
        scaleLimit: { min: 0.5, max: 8 },
        selectedMode: 'single',
        labelLayout: { hideOverlap: true },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6,
        categories: NODE_CATEGORIES.map(category => ({ name: category.label, itemStyle: { color: category.color } })),
        label: {
          show: true,
          position: 'bottom',
          distance: 4,
          width: LABEL_WIDTH,
          overflow: 'break',
          lineHeight: 18,
          ...textStyle
        },
        itemStyle: { borderColor: theme.background, borderWidth: 2 },
        lineStyle: { color: theme.textSecondary, opacity: 0.5, width: 1.5 },
        emphasis: {
          focus: 'adjacency',
          label: { show: true },
          lineStyle: { width: 2.5, opacity: 1 },
          edgeLabel: { show: true, formatter: '{b}', fontSize: 12, ...textStyle, color: theme.textSecondary }
        },
        blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 }, label: { opacity: 0.2 } },
        select: { itemStyle: { borderColor: theme.primary, borderWidth: 4 }, label: { color: theme.primary } },
        data: graph.nodes.map(node => {
          const [fontSize, fontWeight] = labelFont(node);
          const point = positions.get(node.id) ?? { x: 0, y: 0 };
          return {
            id: node.id,
            name: nodeTitle(node, keyword),
            x: point.x,
            y: point.y,
            symbolSize: Math.max(MIN_NODE_SIZE, nodeSize(node) * nodeScale),
            category: categoryIndex.get(nodeCategory(node)),
            label: { fontSize, fontWeight }
          };
        }),
        links: graph.edges.map(edge => ({
          source: edge.source,
          target: edge.target,
          name: edgeName(edge),
          lineStyle: edge.type === 'mapping' ? { type: 'dashed', color: theme.warning, curveness: 0.2 } : undefined
        }))
      }
    ]
  };
}
