import { mount } from '@vue/test-utils';
import type { GraphSeriesOption } from 'echarts/charts';
import type { LegendComponentOption } from 'echarts/components';
import { type ECharts, getInstanceByDom } from 'echarts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { required } from '@/shared/testing/required';
import { layoutGraph } from '../extraction/graph-layout';
import { searchContext, searchKnowledgeNodes } from '../extraction/knowledge-graph';
import { KnowledgeGraphChart } from './KnowledgeGraphChart';

const hosts: HTMLElement[] = [];

afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
});

const graph = searchContext(searchKnowledgeNodes('耕地'));

async function mountChart(width = 760, height = 520) {
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(host);
  hosts.push(host);
  const wrapper = mount(KnowledgeGraphChart, { attachTo: host, props: { graph, keyword: '耕地' } });
  const canvasHost = wrapper.get('[role="img"]').element as HTMLElement;
  // 运行时动态导入、等字体，就绪后加载状态消失
  await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(false), { timeout: 10_000 });
  const chart = required(getInstanceByDom(canvasHost), 'ECharts 实例');
  return { wrapper, canvasHost, chart };
}

function zoom(chart: ECharts): number {
  const [series] = chart.getOption().series as GraphSeriesOption[];
  return required(series.zoom, '缩放比例');
}

// 节点在画布上的位置：布局坐标经过关系图的视图变换
function nodePixel(chart: ECharts, id: string): [number, number] {
  const point = required(layoutGraph(graph.nodes, graph.edges).get(id), `${id} 的坐标`);
  const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, [point.x, point.y]);
  return [x, y];
}

function click(element: HTMLElement, [x, y]: [number, number]) {
  const rect = element.getBoundingClientRect();
  const init = { bubbles: true, clientX: rect.left + x, clientY: rect.top + y };
  const target = required(element.querySelector('canvas'), '画布');
  target.dispatchEvent(new MouseEvent('mousemove', init));
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  target.dispatchEvent(new MouseEvent('click', init));
}

describe('KnowledgeGraphChart（真实 ECharts）', () => {
  it('点击节点发出选中，选中状态始终以 selectedId 为准', async () => {
    const { wrapper, canvasHost, chart } = await mountChart();
    const index = graph.nodes.findIndex(node => node.id === 'S01');
    // 图上当前选中的节点序号，从 ECharts 的选中变化事件里读
    let selected: number[] = [];
    chart.on('selectchanged', params => {
      const { selected: items } = params as { selected: { seriesIndex: number; dataIndex: number[] }[] };
      selected = items.find(item => item.seriesIndex === 0)?.dataIndex ?? [];
    });

    click(canvasHost, nodePixel(chart, 'S01'));
    expect(wrapper.emitted('select')?.at(-1)?.[0]).toMatchObject({ id: 'S01' });
    await nextTick();
    // 没有改 selectedId 时，ECharts 自己切换的选中被改回来
    expect(selected).toEqual([]);

    await wrapper.setProps({ selectedId: 'S01' });
    expect(selected).toEqual([index]);
  });

  it('按钮缩放和适配全图', async () => {
    const { wrapper, chart } = await mountChart();
    const zoomIn = wrapper.get('button[aria-label="放大"]');

    await zoomIn.trigger('click');
    await zoomIn.trigger('click');
    expect(zoom(chart)).toBeCloseTo(1.5625, 3);
    await wrapper.get('button[aria-label="适配全图"]').trigger('click');
    expect(zoom(chart)).toBe(1);
  });

  it('图例在左上角竖排；适配全图时节点名称不进右下角按钮那一列', async () => {
    // 窄而高的画布，适配全图时关系图左右顶到留白的边上
    const { canvasHost, chart } = await mountChart(420, 640);
    const [legend] = chart.getOption().legend as LegendComponentOption[];
    // 名称宽 112、以节点为中心；按钮那一列是右边距 12 加宽 40（测试里不加载组件样式，按样式表里的值算）
    const labelRight = Math.max(...graph.nodes.map(node => nodePixel(chart, node.id)[0])) + 56;

    expect(legend).toMatchObject({ orient: 'vertical', left: 12, top: 12 });
    expect(labelRight).toBeLessThanOrEqual(canvasHost.clientWidth - 52);
  });

  it('卸载时释放 ECharts 实例', async () => {
    const { wrapper, canvasHost } = await mountChart();

    wrapper.unmount();
    expect(getInstanceByDom(canvasHost)).toBeUndefined();
  });
});
