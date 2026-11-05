// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { type ChartTheme, createGraphDisplay, GRAPH_SERIES_ID } from './graph-chart';
import { layoutGraph } from './graph-layout';
import type { GraphLayoutInput, GraphPoint, GraphView } from './graph-model';
import { legacySeeds, waterSeeds } from './graph-seeds';
import { searchContext, searchKnowledgeNodes } from './knowledge-graph';
import { buildLegacyView } from './legacy-view';
import { RELATION_KINDS, waterGraph } from './relation-graph';
import { buildRelationView } from './relation-view';

const theme: ChartTheme = {
  fontFamily: 'Alibaba PuHuiTi',
  background: '#ffffff',
  primary: '#597ef7',
  tooltipBackground: '#1f2937',
  tooltipText: '#ffffff'
};
const WIDE = { width: 1134, height: 546 };

function water(keyword = '') {
  const kinds = new Set(['organize', 'contains', ...RELATION_KINDS] as const);
  const full = buildRelationView(waterGraph, { keyword: '', hiddenProducts: new Set(), kinds, collapsed: new Set() });
  const view = buildRelationView(waterGraph, { keyword, hiddenProducts: new Set(), kinds, collapsed: new Set() });
  const input: GraphLayoutInput = {
    key: 'water',
    nodes: full.nodes,
    edges: full.edges,
    seeds: waterSeeds(waterGraph),
    mappingStrength: 0.07
  };
  return { view, positions: layoutGraph(input, WIDE) };
}

function legacy(keyword: string) {
  const matches = searchKnowledgeNodes(keyword);
  const view = buildLegacyView({
    keyword,
    context: searchContext(matches),
    matches,
    collapsed: new Set(),
    kinds: new Set(['contains', 'class-mapping'])
  });
  const input: GraphLayoutInput = { key: keyword, nodes: view.nodes, edges: view.edges, seeds: legacySeeds(), gap: 36 };
  return { view, positions: layoutGraph(input, WIDE) };
}

function landLayoutInput(): GraphLayoutInput {
  const { nodes, edges } = buildRelationView(waterGraph, {
    keyword: '',
    hiddenProducts: new Set(),
    kinds: new Set(['organize', 'contains', ...RELATION_KINDS]),
    collapsed: new Set()
  });
  return { key: 'water', nodes, edges, seeds: waterSeeds(waterGraph), mappingStrength: 0.07 };
}

function legacyLayoutInput(keyword: string): GraphLayoutInput {
  const { view } = legacy(keyword);
  return { key: keyword, nodes: view.nodes, edges: view.edges, seeds: legacySeeds(), gap: 36 };
}

interface ChartNode {
  id: string;
  name: string;
  symbol: string;
  symbolSize: number | number[];
  x: number;
  y: number;
  itemStyle: { borderColor: string; borderType: string };
  label: { show: boolean; position: string; formatter: string; fontSize: number; lineHeight: number; fontWeight: number };
}

interface ChartLink {
  source: string;
  target: string;
  name: string;
  symbol: string[];
  lineStyle: { type: string | number[]; curveness: number };
  label: { show: boolean; formatter: string; position: string };
}

function display(view: GraphView, positions: ReadonlyMap<string, GraphPoint>, overrides = new Map<string, GraphPoint>()) {
  return createGraphDisplay(view, positions, theme, WIDE, overrides);
}

const nodesOf = (items: unknown) => items as ChartNode[];
const linksOf = (items: unknown) => items as ChartLink[];

describe('createGraphDisplay：名称', () => {
  it('名称写在节点里，全部显示，只用不小于 12 的双数字号和字体有的两个字重', () => {
    for (const { view, positions } of [water(), legacy('耕地'), legacy('水')]) {
      const labels = nodesOf(display(view, positions).nodeItems(1)).map(node => node.label);

      expect(labels.every(label => label.show && label.position === 'inside')).toBe(true);
      expect(labels.every(label => label.fontSize >= 12 && label.fontSize % 2 === 0)).toBe(true);
      expect(new Set(labels.map(label => label.fontWeight)).size).toBeLessThanOrEqual(2);
    }
  });

  // 比例选择不单调：2026-11-02 900×414 能放下，900×439 反而把 10 个名称隐藏了
  it.each([
    [1166, 591],
    [1134, 546],
    [1000, 500],
    [900, 414],
    [900, 439],
    [900, 470],
    [850, 420],
    [728, 444]
  ])('%i×%i 的画布上，水资源和 33 个节点的图名称全部显示', (width, height) => {
    const viewport = { width, height };
    const land = water();
    const landInput = landLayoutInput();
    const graphs = [
      [land.view, layoutGraph(landInput, viewport)],
      [legacy('水').view, layoutGraph(legacyLayoutInput('水'), viewport)]
    ] as const;

    for (const [view, positions] of graphs) {
      const fonts = createGraphDisplay(view, positions, theme, viewport).fontsAt(1);
      expect(fonts.filter(size => size < 12)).toEqual([]);
    }
  });

  it('节点太多时才让小节点的名称放大后出现', () => {
    const matches = searchKnowledgeNodes('用地');
    const view = buildLegacyView({
      keyword: '用地',
      context: searchContext(matches),
      matches,
      collapsed: new Set(),
      kinds: new Set(['contains', 'class-mapping'])
    });
    const input: GraphLayoutInput = { key: 'all', nodes: view.nodes, edges: view.edges, seeds: legacySeeds(), gap: 36 };
    const graph = createGraphDisplay(view, layoutGraph(input, WIDE), theme, WIDE);

    expect(graph.displayScale).toBeLessThan(0.6);
    expect(graph.fontsAt(1).filter(size => size === 0).length).toBeGreaterThan(0);
    expect(graph.fontsAt(4).filter(size => size === 0)).toEqual([]);
  });

  it('放大时字号变大，行高跟着变；缩到看不清时不画', () => {
    const { view, positions } = water();
    const graph = display(view, positions);
    const fonts = (zoom: number) => nodesOf(graph.nodeItems(zoom)).map(node => node.label);

    const base = Math.max(...fonts(1).map(label => label.fontSize));
    const zoomed = fonts(2);
    expect(Math.max(...zoomed.map(label => label.fontSize))).toBeGreaterThan(base);
    expect(zoomed.every(label => label.lineHeight === Math.round(label.fontSize * 1.22))).toBe(true);
    expect(fonts(0.5).filter(label => !label.show).length).toBeGreaterThan(0);
  });

  it('根节点的名称：水资源是图谱名称，检索时带上关键词；总节点、大类都写在节点里', () => {
    const names = (keyword: string) => nodesOf(display(water(keyword).view, water(keyword).positions).nodeItems(1));

    expect(names('').map(node => node.name)).toContain('水资源调查监测成果');
    expect(names('河流').map(node => node.name)).toContain('“河流”关联知识图谱');
    expect(names('').find(node => node.id === 'root')?.label.formatter).toBe('水资源\n调查监测\n成果');
    const land = legacy('耕地');
    expect(nodesOf(display(land.view, land.positions).nodeItems(1)).map(node => node.name)).toEqual(
      expect.arrayContaining(['“耕地”关联知识图谱', '国土空间用地用海分类'])
    );
  });

  it('数据表是圆角矩形，分类是圆；命中的节点描边，收起的节点虚线', () => {
    const { view, positions } = water('河流');
    const nodes = nodesOf(display(view, positions).nodeItems(1));
    const river = required(nodes.find(node => node.id === 'land-survey/1101'), '河流水面');
    const parent = required(nodes.find(node => node.id === 'land-survey/11'), '水域及水利设施用地');

    expect(river.itemStyle.borderColor).toBe('#f59e0b');
    expect(parent.itemStyle.borderColor).toBe('#ffffff');

    const all = water();
    const fullNodes = nodesOf(display(all.view, all.positions).nodeItems(1));
    expect(required(fullNodes.find(node => node.id === 'land-survey/DLTB'), '地类图斑').symbol).toBe('roundRect');
    expect(required(fullNodes.find(node => node.id === 'root'), '总节点').symbol).toBe('circle');

    const collapsed = buildRelationView(waterGraph, {
      keyword: '',
      hiddenProducts: new Set(),
      kinds: new Set(RELATION_KINDS),
      collapsed: new Set(['land-use/17'])
    });
    const folded = nodesOf(display(collapsed, all.positions).nodeItems(1));
    const land = required(folded.find(node => node.id === 'land-use/17'), '陆地水域');
    expect(land.itemStyle.borderType).toBe('dashed');
    expect(land.label.formatter).toBe('陆地\n水域\n+6');
  });
});

describe('createGraphDisplay：关系', () => {
  it('每条线都有名称和箭头，线从节点边缘开始（两端都有 symbol，ECharts 才裁线）', () => {
    const { view, positions } = water();
    const links = linksOf(display(view, positions).linkItems(1));

    expect(links.map(link => link.label.formatter)).toEqual(view.edges.map(edge => edge.label));
    expect(links.every(link => link.symbol[0] !== 'none' && link.symbol[1] === 'arrow')).toBe(true);
    expect(links.find(link => link.target === 'land-use')?.label.formatter).toBe('规划用途');
    expect(links.filter(link => link.label.formatter === '分类对应')).toHaveLength(6);
    expect(links.filter(link => link.label.formatter === '时序关联')).toHaveLength(3);
  });

  it('关系名称只在放得下的地方画：不压节点，大部分都能显示', () => {
    const { view, positions } = water();
    const plan = display(view, positions).planLabels(1);

    expect(plan.size).toBe(view.edges.length);
    expect([...plan.values()].filter(Boolean).length).toBeGreaterThanOrEqual(view.edges.length * 0.85);
    const links = linksOf(display(view, positions).linkItems(1));
    expect(links.every(link => link.label.show === (link.label.position !== undefined && plan.get(edgeId(view, link)) !== null))).toBe(true);
  });

  it('线的中点有别的节点时，名称让开到别处，不压节点', () => {
    // 线向上弯，名称在线的上方，c 正好在名称的位置
    const positions = new Map<string, GraphPoint>([
      ['a', { x: -400, y: 0 }],
      ['b', { x: 400, y: 0 }],
      ['c', { x: 0, y: -45 }]
    ]);
    const clear = sketch(['a', 'b'], [['a', 'b']]);
    const blocked = sketch(['a', 'b', 'c'], [['a', 'b']]);

    expect(display(clear, positions).planLabels(1).get('a-b')).toBe('middle');
    const position = display(blocked, positions).planLabels(1).get('a-b');
    expect(position).not.toBe('middle');
    expect(position).not.toBeNull();
  });

  it('两条线的名称落在同一处时，后面的让开，不压前面的名称', () => {
    const positions = new Map<string, GraphPoint>([
      ['a', { x: -400, y: 0 }],
      ['b', { x: 400, y: 0 }],
      ['c', { x: -250, y: 0 }],
      ['d', { x: 250, y: 0 }]
    ]);
    const plan = display(sketch(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]), positions).planLabels(1);

    expect(plan.get('a-b')).toBe('middle');
    expect(plan.get('c-d')).not.toBe('middle');
  });

  it('线短得放不下名称时不画，放大后出现', () => {
    // 远处的节点把比例定住，两个节点之间只剩很短的线
    const positions = new Map<string, GraphPoint>([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 90, y: 0 }],
      ['c', { x: 1000, y: 0 }]
    ]);
    const graph = display(sketch(['a', 'b', 'c'], [['a', 'b']]), positions);

    expect(graph.planLabels(1).get('a-b')).toBeNull();
    expect(graph.planLabels(2).get('a-b')).not.toBeNull();
  });

  it('节点小到放不下时关系名称都不画', () => {
    const { view, positions } = water();
    const graph = display(view, positions);

    expect(graph.planLabels(0.5).size).toBe(0);
    expect(linksOf(graph.linkItems(0.5)).every(link => !link.label.show)).toBe(true);
  });

  it('弯曲量有上限，长线不会跑出画布', () => {
    const { view, positions } = water();
    const links = linksOf(display(view, positions).linkItems(1));
    const longest = required(
      links.toSorted((a, b) => b.lineStyle.curveness - a.lineStyle.curveness).at(-1),
      '最长的线'
    );
    const a = required(positions.get(longest.source), '起点');
    const b = required(positions.get(longest.target), '终点');

    expect((longest.lineStyle.curveness * Math.hypot(a.x - b.x, a.y - b.y)) / 2).toBeLessThanOrEqual(34);
  });

  it('线型和颜色一起区分：对应是虚线，包含是实线', () => {
    const { view, positions } = water();
    const links = linksOf(display(view, positions).linkItems(1));

    expect(links.find(link => link.name === '分类对应')?.lineStyle.type).toEqual([6, 4]);
    expect(links.find(link => link.name === '包含')?.lineStyle.type).toBe('solid');
  });

  it('其他资源根节点的线沿用旧项目的"分类体系"', () => {
    const { view, positions } = legacy('耕地');
    const links = linksOf(display(view, positions).linkItems(1));

    expect(links.filter(link => link.source === 'root').map(link => link.label.formatter)).toEqual(['分类体系', '分类体系']);
  });
});

describe('createGraphDisplay：缩放和拖动', () => {
  it('labelKey 只在字号或名称位置变化时变：缩放很小不用更新', () => {
    const { view, positions } = water();
    const graph = display(view, positions);

    expect(graph.labelKey(1)).toBe(graph.labelKey(1));
    expect(graph.labelKey(2)).not.toBe(graph.labelKey(1));
  });

  it('更新标签时带上拖动过的位置，节点不跳回去；名称重新避让', () => {
    const { view, positions } = water();
    const overrides = new Map<string, GraphPoint>();
    const graph = display(view, positions, overrides);
    const before = graph.labelKey(1);
    expect(graph.planLabels(1).get('tree:land-use/24')).not.toBeNull();

    // 拖到紧贴上级的地方，线短得放不下关系名称
    const parent = required(positions.get('land-use'), '用地用海分类');
    overrides.set('land-use/24', { x: parent.x + 90, y: parent.y });
    const moved = required(nodesOf(graph.nodeItems(1)).find(node => node.id === 'land-use/24'), '其他海域');
    expect([moved.x, moved.y]).toEqual([parent.x + 90, parent.y]);
    expect(graph.planLabels(1).get('tree:land-use/24')).toBeNull();
    expect(graph.labelKey(1)).not.toBe(before);
  });

  it('配置：节点和间距一起缩放，用系列 id 更新；不用 labelLayout（它会打乱线上文字的位置）', () => {
    const { view, positions } = water();
    const option = display(view, positions).option;
    const [series] = option.series as Record<string, unknown>[];

    expect(series).toMatchObject({ id: GRAPH_SERIES_ID, type: 'graph', layout: 'none', nodeScaleRatio: 1, roam: true });
    expect(series.labelLayout).toBeUndefined();
    expect(option.tooltip).toMatchObject({ appendToBody: true, backgroundColor: theme.tooltipBackground });
  });
});

// 手写的小图：验证名称的避让
function sketch(ids: readonly string[], lines: readonly (readonly [string, string])[]): GraphView {
  return {
    nodes: ids.map(id => ({
      id,
      name: id,
      code: '',
      kind: 'class',
      level: 2,
      category: 'survey-2',
      match: false,
      childCount: 0,
      hiddenChildren: 0
    })),
    edges: lines.map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      kind: 'contains',
      label: '包含',
      depth: 1,
      count: 1
    })),
    matches: new Set(),
    counts: {}
  };
}

// 配置里的线按顺序对应 view.edges
function edgeId(view: GraphView, link: ChartLink): string {
  return required(
    view.edges.find(edge => edge.source === link.source && edge.target === link.target),
    '线'
  ).id;
}
