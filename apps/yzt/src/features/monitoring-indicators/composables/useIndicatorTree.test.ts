import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import type { IndicatorApi, IndicatorTreeParams } from '../api';
import type { IndicatorCategory, IndicatorLeaf, IndicatorTreeNode } from '../indicator-tree';
import { type IndicatorConditions, useIndicatorConditions } from './useIndicatorConditions';
import { type IndicatorPickMode, type IndicatorTree, useIndicatorTree } from './useIndicatorTree';

const leaf = (code: string, change: Partial<IndicatorLeaf> = {}): IndicatorLeaf => ({
  kind: 'leaf',
  code,
  dataId: null,
  name: `指标${code}`,
  disabled: false,
  status: null,
  result: null,
  reason: null,
  ...change
});

const TREES: Readonly<Record<IndicatorCategory, IndicatorTreeNode[]>> = {
  cstjpg: [
    { kind: 'group', code: 'A', name: '教育便利性', children: [leaf('A-32'), leaf('A-33'), leaf('A-34', { disabled: true })] }
  ],
  zhfxzb: [{ kind: 'group', code: 'C', name: '公共服务均衡普惠', children: [leaf('C01-1'), leaf('C01-2')] }]
};

function host(mode: IndicatorPickMode, fetchTree: IndicatorApi['fetchTree'] = (_, { category }) => Promise.resolve(TREES[category])) {
  const fetchTreeMock = vi.fn<IndicatorApi['fetchTree']>(fetchTree);
  const api: IndicatorApi = {
    fetchTree: fetchTreeMock,
    verifyCalculation: () => Promise.resolve(false),
    startCalculation: () => Promise.resolve(),
    fetchProgress: () => Promise.resolve(null),
    fetchResult: () => Promise.reject(new Error('没有成果'))
  };
  let owner: { tree: IndicatorTree; conditions: IndicatorConditions } | undefined;
  const Host = defineComponent({
    setup() {
      const conditions = useIndicatorConditions();
      conditions.setYear(2025);
      owner = { conditions, tree: useIndicatorTree({ api, source: 'calculation', mode, conditions }) };
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { ...required(owner, '指标树的拥有者'), fetchTree: fetchTreeMock };
}

const leafOf = (tree: IndicatorTree, code: string) => {
  const { state } = tree;
  if (state.value.kind !== 'ready') {
    throw new Error('树还没有加载');
  }
  const found = state.value.nodes.flatMap(node => (node.kind === 'group' ? node.children : [node]));
  return required(
    found.find((node): node is IndicatorLeaf => node.kind === 'leaf' && node.code === code),
    `指标 ${code}`
  );
};

describe('useIndicatorTree', () => {
  it('年份和监测范围都有时按当前页签请求，没有时等待', async () => {
    const { tree, conditions, fetchTree } = host('multiple');
    expect(tree.state.value.kind).toBe('loading');
    await flushPromises();

    expect(tree.state.value).toMatchObject({ kind: 'ready', nodes: TREES.cstjpg, refreshing: false });
    expect(fetchTree.mock.calls[0]?.slice(0, 2)).toEqual([
      'calculation',
      { category: 'cstjpg', regionCode: '320100', year: 2025 } satisfies IndicatorTreeParams
    ]);

    conditions.setYear(null);
    expect(tree.state.value.kind).toBe('waiting');
  });

  it('请求失败时显示原因', async () => {
    const { tree } = host('multiple', () => Promise.reject(new Error('指标树加载失败')));
    await flushPromises();
    expect(tree.state.value).toEqual({ kind: 'failed', message: '指标树加载失败' });
  });

  it('计算时跨页签累计勾选；全选只选当前页签可选的指标，禁用的勾不上', async () => {
    const { tree } = host('multiple');
    await flushPromises();

    tree.toggle(leafOf(tree, 'A-34'), true);
    expect(tree.checked.value.size).toBe(0);

    tree.toggleAll(true);
    expect([...tree.checked.value]).toEqual(['A-32', 'A-33']);

    tree.setCategory('zhfxzb');
    await flushPromises();
    tree.toggle(leafOf(tree, 'C01-2'), true);
    expect(tree.picked.value.map(item => item.code)).toEqual(['A-32', 'A-33', 'C01-2']);

    tree.toggleAll(false);
    expect([...tree.checked.value]).toEqual(['A-32', 'A-33']);
  });

  it('展示时每个页签各选一个，只看当前页签的；换年份或监测范围后清空', async () => {
    const { tree, conditions } = host('single');
    await flushPromises();

    tree.toggle(leafOf(tree, 'A-32'), true);
    tree.toggle(leafOf(tree, 'A-33'), true);
    expect(tree.picked.value.map(item => item.code)).toEqual(['A-33']);
    tree.toggleAll(true);
    expect([...tree.checked.value]).toEqual(['A-33']);

    tree.setCategory('zhfxzb');
    await flushPromises();
    expect(tree.picked.value).toEqual([]);
    tree.toggle(leafOf(tree, 'C01-1'), true);
    tree.setCategory('cstjpg');
    expect(tree.picked.value.map(item => item.code)).toEqual(['A-33']);

    conditions.setRegion('320200');
    await flushPromises();
    expect(tree.picked.value).toEqual([]);
  });

  it('刷新后当前页签里不在了、变成禁用的指标取消选择，其余换成新的记录', async () => {
    let round = 0;
    const { tree } = host('multiple', (_, { category }) => {
      round++;
      if (round === 1 || category === 'zhfxzb') {
        return Promise.resolve(TREES[category]);
      }
      return Promise.resolve([
        {
          kind: 'group',
          code: 'A',
          name: '教育便利性',
          children: [leaf('A-32', { status: 'done', result: '40.04%' }), leaf('A-34', { disabled: true })]
        }
      ]);
    });
    await flushPromises();
    tree.toggleAll(true);
    tree.setCategory('zhfxzb');
    await flushPromises();
    tree.toggle(leafOf(tree, 'C01-1'), true);
    tree.setCategory('cstjpg');

    tree.refresh();
    await flushPromises();

    expect(tree.picked.value.map(item => [item.code, item.result])).toEqual([
      ['A-32', '40.04%'],
      ['C01-1', null]
    ]);
  });
});
