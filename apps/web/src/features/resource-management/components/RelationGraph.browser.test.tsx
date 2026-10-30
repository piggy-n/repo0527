import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { type RelationGraphOwner, useRelationGraph } from '../composables/useRelationGraph';
import { waterGraph } from '../extraction/relation-graph';
import { RelationGraph } from './RelationGraph';

const hosts: HTMLElement[] = [];

afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
});

function mountGraph(width: number, height: number) {
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(host);
  hosts.push(host);
  let owner: RelationGraphOwner | undefined;
  const wrapper = mount(
    defineComponent(() => {
      const graph = useRelationGraph(waterGraph);
      owner = graph;
      return () => <RelationGraph owner={graph} />;
    }),
    { attachTo: host }
  );
  return { wrapper, owner: required(owner, '关系图的拥有者') };
}

function rect(id: string): DOMRect {
  return required(document.querySelector(`[data-node-id="${id}"]`), `卡片 ${id}`).getBoundingClientRect();
}

// 关系线所在的 SVG：舞台里第一个 svg
function edgePaths(): SVGPathElement[] {
  const svg = required(document.querySelector('[aria-label="水资源关系图"] svg'), '关系线');
  return [...svg.querySelectorAll('path')];
}

describe('RelationGraph（真实布局）', () => {
  it('对应的分类排在同一行；分类对应的线从左边卡片的右缘连到右边卡片的左缘', async () => {
    mountGraph(1000, 600);
    await vi.waitFor(() => expect(edgePaths().filter(path => path.getAttribute('d')?.startsWith('M'))).toHaveLength(9));

    expect(rect('land-use/1701').top).toBe(rect('land-survey/1101').top);
    expect(rect('land-use/1706').top).toBe(rect('land-survey/1110').top);

    const stage = required(edgePaths()[0].ownerSVGElement, '关系线的画布').getBoundingClientRect();
    const first = required(edgePaths()[0].getAttribute('d'), '第一条线').match(/-?[\d.]+/g)?.map(Number) ?? [];
    const left = rect('land-use/1701');
    const right = rect('land-survey/1101');
    expect(first[0] + stage.left).toBeCloseTo(left.right, 0);
    expect(first[1] + stage.top).toBeCloseTo(left.top + left.height / 2, 0);
    expect(first.at(-2) ?? 0).toBeCloseTo(right.left - stage.left, 0);
  });

  it('悬停卡片时相关的线加粗并显示关系名称，其他线变淡', async () => {
    const { wrapper } = mountGraph(1000, 600);
    await vi.waitFor(() => expect(edgePaths()).toHaveLength(9));

    await wrapper.get('[data-node-id="water-survey/HL_FS"]').trigger('mouseenter');
    const spans = [...document.querySelectorAll('[aria-label="水资源关系图"] span')];
    const labels = spans.filter(span => span.textContent === '时序关联');
    expect(labels).toHaveLength(1);
    const widths = edgePaths().map(path => path.getAttribute('stroke-width'));
    expect(widths.at(-1)).toBe('2.5');
    expect(edgePaths().filter(path => path.getAttribute('opacity') === '0.18')).toHaveLength(8);
  });

  it('适配全图在窄视口里缩小到能放下全部泳道，再恢复 100%', async () => {
    const { wrapper } = mountGraph(700, 420);
    await vi.waitFor(() => expect(edgePaths()).toHaveLength(9));
    const viewport = required(document.querySelector<HTMLElement>('[aria-label="水资源关系图"]'), '画布');
    expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);

    await wrapper.get('button[aria-label="适配全图"]').trigger('click');
    await vi.waitFor(() => expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth));
    const value = wrapper.get('button[aria-label="恢复 100%"]');
    expect(Number.parseInt(value.text(), 10)).toBeLessThan(100);

    await value.trigger('click');
    await vi.waitFor(() => expect(value.text()).toBe('100%'));
  });
});
