import { mount } from '@vue/test-utils';
import type { GraphSeriesOption } from 'echarts/charts';
import { type ECharts, getInstanceByDom } from 'echarts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { required } from '@/shared/testing/required';
import { useLegacyGraph } from '../composables/useLegacyGraph';
import { useRelationGraph } from '../composables/useRelationGraph';
import type { GraphEdgeKind } from '../extraction/graph-model';
import { waterGraph } from '../extraction/relation-graph';
import { KnowledgeGraphChart } from './KnowledgeGraphChart';

const hosts: HTMLElement[] = [];

afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
});

function legacyGraph(keyword: string) {
  const owner = useLegacyGraph();
  owner.enter(keyword);
  return owner;
}

interface MountOptions {
  owner?: ReturnType<typeof useLegacyGraph> | ReturnType<typeof useRelationGraph>;
  width?: number;
  height?: number;
}

async function mountChart({ owner = legacyGraph('耕地'), width = 1000, height = 520 }: MountOptions = {}) {
  const host = document.createElement('div');
  host.style.cssText = `position:relative;width:${width}px;height:${height}px`;
  document.body.append(host);
  hosts.push(host);
  const wrapper = mount(KnowledgeGraphChart, {
    attachTo: host,
    props: { view: owner.view.value, layoutInput: owner.layoutInput.value }
  });
  const canvasHost = wrapper.get('[role="img"]').element as HTMLElement;
  // 测试里不加载组件样式，画布按内联尺寸占满
  canvasHost.style.cssText = `width:${width}px;height:${height}px`;
  // 运行时动态导入、等字体，就绪后加载状态消失
  await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(false), { timeout: 10_000 });
  const chart = required(getInstanceByDom(canvasHost), 'ECharts 实例');
  await vi.waitFor(() => expect(series(chart).data?.length).toBeGreaterThan(0));
  return { wrapper, canvasHost, chart, owner };
}

function series(chart: ECharts): GraphSeriesOption {
  const [item] = chart.getOption().series as GraphSeriesOption[];
  return item;
}

interface OptionNode {
  id: string;
  x: number;
  y: number;
  symbolSize: number;
  label: { show: boolean; fontSize: number };
}

function optionNodes(chart: ECharts): OptionNode[] {
  return (series(chart).data ?? []) as OptionNode[];
}

function optionNode(chart: ECharts, id: string): OptionNode {
  return required(optionNodes(chart).find(node => node.id === id), `节点 ${id}`);
}

// 节点在画布上的位置：布局坐标经过关系图的视图变换
function nodePixel(chart: ECharts, id: string): [number, number] {
  const node = optionNode(chart, id);
  const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, [node.x, node.y]);
  return [x, y];
}

function fire(type: string, canvasHost: HTMLElement, [x, y]: [number, number], target?: EventTarget) {
  const rect = canvasHost.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, clientX: rect.left + x, clientY: rect.top + y };
  (target ?? required(canvasHost.querySelector('canvas'), '画布')).dispatchEvent(new MouseEvent(type, init));
}

function click(canvasHost: HTMLElement, point: [number, number]) {
  fire('mousemove', canvasHost, point);
  fire('mousedown', canvasHost, point);
  fire('mouseup', canvasHost, point);
  fire('click', canvasHost, point);
}

function fontSizes(chart: ECharts): number[] {
  return optionNodes(chart).map(node => (node.label.show ? node.label.fontSize : 0));
}

const settle = () => new Promise(resolve => setTimeout(resolve, 60));

describe('KnowledgeGraphChart（真实 ECharts）', () => {
  it('点击节点发出选中，选中状态始终以 selectedId 为准', async () => {
    const { wrapper, canvasHost, chart, owner } = await mountChart();
    const index = owner.view.value.nodes.findIndex(node => node.id === 'S01');
    // 图上当前选中的节点序号，从 ECharts 的选中变化事件里读
    let selected: number[] = [];
    chart.on('selectchanged', params => {
      const { selected: items } = params as { selected: { seriesIndex: number; dataIndex: number[] }[] };
      selected = items.find(item => item.seriesIndex === 0)?.dataIndex ?? [];
    });

    click(canvasHost, nodePixel(chart, 'S01'));
    expect(wrapper.emitted('select')?.at(-1)?.[0]).toBe('S01');
    await nextTick();
    // 没有改 selectedId 时，ECharts 自己切换的选中被改回来
    expect(selected).toEqual([]);

    await wrapper.setProps({ selectedId: 'S01' });
    expect(selected).toEqual([index]);
  });

  it('双击有下级的节点发出收起，叶子节点不发', async () => {
    const { wrapper, canvasHost, chart } = await mountChart();

    fire('mousemove', canvasHost, nodePixel(chart, 'S01'));
    fire('dblclick', canvasHost, nodePixel(chart, 'S01'));
    expect(wrapper.emitted('toggle')?.at(-1)?.[0]).toBe('S01');

    const before = wrapper.emitted('toggle')?.length;
    fire('mousemove', canvasHost, nodePixel(chart, 'S01-0101'));
    fire('dblclick', canvasHost, nodePixel(chart, 'S01-0101'));
    expect(wrapper.emitted('toggle')).toHaveLength(required(before, '收起的次数'));
  });

  it('名称写在节点里；放大时字号跟着变大，适配全图恢复', async () => {
    const { wrapper, chart } = await mountChart({ owner: useRelationGraph(waterGraph) });
    const initial = fontSizes(chart);
    const zoomIn = wrapper.get('button[aria-label="放大"]');

    expect(initial.every(size => size >= 12 && size % 2 === 0)).toBe(true);
    expect(optionNodes(chart).length).toBe(40);

    await zoomIn.trigger('click');
    await zoomIn.trigger('click');
    await settle();
    expect(series(chart).zoom).toBeCloseTo(1.5625, 3);
    expect(Math.max(...fontSizes(chart))).toBeGreaterThan(Math.max(...initial));

    await wrapper.get('button[aria-label="适配全图"]').trigger('click');
    await settle();
    expect(series(chart).zoom).toBe(1);
    expect(fontSizes(chart)).toEqual(initial);
  });

  it('缩小到适配全图以下时，放不下的名称不画，而不是把字压到节点外', async () => {
    const { wrapper, chart } = await mountChart({ owner: useRelationGraph(waterGraph) });
    const zoomOut = wrapper.get('button[aria-label="缩小"]');

    await zoomOut.trigger('click');
    await zoomOut.trigger('click');
    await zoomOut.trigger('click');
    await settle();
    expect(fontSizes(chart).filter(size => size === 0).length).toBeGreaterThan(0);
    expect(fontSizes(chart).filter(size => size > 0).every(size => size >= 12)).toBe(true);
  });

  it('拖动节点后再缩放，节点留在拖到的位置', async () => {
    const { wrapper, canvasHost, chart } = await mountChart();
    const id = 'P01';
    const before = optionNode(chart, id);
    const start = nodePixel(chart, id);
    const end: [number, number] = [start[0] + 60, start[1] + 36];

    fire('mousemove', canvasHost, start);
    fire('mousedown', canvasHost, start);
    // 第一次移动发在画布上，之后 zrender 改在 document 上监听
    fire('mousemove', canvasHost, [start[0] + 5, start[1] + 3]);
    fire('mousemove', canvasHost, end, document);
    fire('mouseup', canvasHost, end, document);
    await settle();

    await wrapper.get('button[aria-label="放大"]').trigger('click');
    await wrapper.get('button[aria-label="放大"]').trigger('click');
    await settle();
    const after = optionNode(chart, id);
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    // 数据坐标和屏幕基本 1:1（节点不多时可能放大），按比例换算回屏幕距离
    expect(moved * chart.getWidth()).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(30);
    expect(fontSizes(chart).every(size => size >= 12)).toBe(true);
  });

  it('换一张图时重新布局并更新；筛选后留下的节点不跳动', async () => {
    const owner = useRelationGraph(waterGraph);
    const { wrapper, chart } = await mountChart({ owner });
    const before = optionNode(chart, 'land-use/17');

    owner.toggleKind('temporal' satisfies GraphEdgeKind);
    owner.toggleCollapsed('land-survey/11');
    await wrapper.setProps({ view: owner.view.value });
    await settle();

    expect(optionNodes(chart).length).toBe(34);
    const after = optionNode(chart, 'land-use/17');
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });

  it('节点都在画布里，不进右下角视角按钮以外的范围', async () => {
    const { canvasHost, chart, owner } = await mountChart({ owner: useRelationGraph(waterGraph), width: 900, height: 414 });

    for (const node of owner.view.value.nodes) {
      const [x, y] = nodePixel(chart, node.id);
      const size = optionNode(chart, node.id).symbolSize;
      const half = (Array.isArray(size) ? size[0] : size) / 2;
      expect(x - half).toBeGreaterThanOrEqual(-1);
      expect(x + half).toBeLessThanOrEqual(canvasHost.clientWidth + 1);
      expect(y - half).toBeGreaterThanOrEqual(-1);
      expect(y + half).toBeLessThanOrEqual(canvasHost.clientHeight + 1);
    }
  });

  it('卸载时释放 ECharts 实例', async () => {
    const { wrapper, canvasHost } = await mountChart();

    wrapper.unmount();
    expect(getInstanceByDom(canvasHost)).toBeUndefined();
  });
});
