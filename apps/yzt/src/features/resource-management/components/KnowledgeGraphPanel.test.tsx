import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { useLegacyGraph } from '../composables/useLegacyGraph';
import { type RelationGraphOwner, useRelationGraph } from '../composables/useRelationGraph';
import { waterGraph } from '../extraction/relation-graph';
import { GraphNodeDetail } from './GraphNodeDetail';
import { KnowledgeGraphChart } from './KnowledgeGraphChart';
import { KnowledgeGraphPanel } from './KnowledgeGraphPanel';
import { RelationToolbar } from './RelationToolbar';

// 画布要真实的 ECharts，在浏览器测试里验证；这里测筛选、图例和详情
const stubs = { KnowledgeGraphChart: true };

function mountWater() {
  let owner: RelationGraphOwner | undefined;
  const wrapper = mount(
    defineComponent(() => {
      const graph = useRelationGraph(waterGraph);
      owner = graph;
      return () => (
        <div>
          <KnowledgeGraphPanel owner={graph}>{{ toolbar: () => <RelationToolbar owner={graph} /> }}</KnowledgeGraphPanel>
          <GraphNodeDetail detail={graph.detail.value} onLocate={graph.locate} />
        </div>
      );
    }),
    { global: { stubs } }
  );
  return { wrapper, owner: required(owner, '水资源图谱的拥有者') };
}

const edgeLegend = (wrapper: ReturnType<typeof mountWater>['wrapper']) =>
  wrapper.get('[role="group"][aria-label="关系类型"]');

describe('KnowledgeGraphPanel', () => {
  it('图例列出节点类型和关系类型：一直显示的只是说明，能开关的是按钮，没有数据的不能打开', async () => {
    const { wrapper, owner } = mountWater();

    expect(wrapper.get('[role="group"][aria-label="节点类型"]').text()).toContain('中心主题');
    expect(edgeLegend(wrapper).text()).toContain('组织关系4');
    expect(edgeLegend(wrapper).text()).toContain('包含35');
    const buttons = edgeLegend(wrapper).findAll('button');
    expect(buttons.map(button => button.text())).toEqual(['分类对应6', '时序关联3', '字段映射待补充', '空间关联待补充']);

    await buttons[1].trigger('click');
    expect(owner.kinds.value.has('temporal')).toBe(false);
    expect(buttons[1].attributes('aria-pressed')).toBe('false');
    expect(owner.view.value.edges.some(edge => edge.kind === 'temporal')).toBe(false);

    await buttons[2].trigger('click');
    expect(buttons[2].attributes('aria-disabled')).toBe('true');
    expect(buttons[2].attributes('aria-pressed')).toBe('false');
  });

  it('把图、布局和选中交给画布；画布发出的选中、收起交给拥有者', async () => {
    const { wrapper, owner } = mountWater();
    const chart = wrapper.getComponent(KnowledgeGraphChart);

    expect(chart.props('view')).toBe(owner.view.value);
    expect(chart.props('layoutInput')).toMatchObject({ key: 'water' });

    chart.vm.$emit('select', 'land-survey/1101');
    await flushPromises();
    expect(owner.selectedId.value).toBe('land-survey/1101');
    expect(chart.props('selectedId')).toBe('land-survey/1101');

    chart.vm.$emit('toggle', 'land-use/17');
    await flushPromises();
    expect(owner.collapsed.value.has('land-use/17')).toBe(true);
    expect(owner.view.value.nodes.some(node => node.id === 'land-use/1701')).toBe(false);
  });

  it('其他资源的图例是旧图例的 7 类和两种关系，没有筛选栏', () => {
    const wrapper = mount(
      defineComponent(() => {
        const graph = useLegacyGraph();
        graph.enter('耕地');
        return () => <KnowledgeGraphPanel owner={graph} />;
      }),
      { global: { stubs } }
    );

    expect(wrapper.findAll('[role="group"][aria-label="节点类型"] i')).toHaveLength(7);
    expect(wrapper.get('[role="group"][aria-label="关系类型"]').text()).toContain('分类对应4');
    expect(wrapper.find('[role="group"][aria-label="数据成果"]').exists()).toBe(false);
  });
});

describe('RelationToolbar', () => {
  it('数据成果标签隐藏这一支；连到它的关系数变成 0', async () => {
    const { wrapper, owner } = mountWater();
    const tag = required(
      wrapper.findAll('[role="group"][aria-label="数据成果"] .el-check-tag').find(item => item.text() === '国土调查分类'),
      '国土调查分类的标签'
    );

    await tag.trigger('click');
    expect(owner.hiddenProducts.value.has('land-survey')).toBe(true);
    expect(owner.view.value.nodes.some(node => node.id === 'land-survey')).toBe(false);
    expect(edgeLegend(wrapper).text()).toContain('分类对应0');
  });

  it('检索时显示命中数；关掉检索标签恢复全部', async () => {
    const { wrapper, owner } = mountWater();
    owner.reset('河流');
    await flushPromises();
    expect(owner.view.value.nodes).toHaveLength(16);
    const keyword = wrapper.get('.el-tag');
    expect(keyword.text()).toBe('检索：河流 · 命中 5');

    await keyword.get('.el-tag__close').trigger('click');
    expect(owner.keyword.value).toBe('');
    expect(owner.view.value.nodes).toHaveLength(40);
  });
});

describe('GraphNodeDetail', () => {
  it('没选中时提示；选中分类时列出关系，点关联的节点定位过去', async () => {
    const { wrapper, owner } = mountWater();
    expect(wrapper.text()).toContain('请选择知识图谱节点');

    owner.select('land-survey/1101');
    await flushPromises();
    expect(wrapper.text()).toContain('已选中');
    expect(wrapper.text()).toContain('关联关系1');
    expect(wrapper.text()).toContain('国土调查分类 · 二级类');

    const related = required(wrapper.findAll('button').find(button => button.text() === '1701河流水面'), '详情里的 1701');
    await related.trigger('click');
    expect(owner.selectedId.value).toBe('land-use/1701');
  });

  it('总节点和大类不标"已选中"，总节点说明只用于组织展示', async () => {
    const { wrapper, owner } = mountWater();

    owner.select('root');
    await flushPromises();
    expect(wrapper.text()).not.toContain('已选中');
    expect(wrapper.text()).toContain('中心主题');
    expect(wrapper.text()).toContain('只用于组织展示');
    expect(wrapper.text()).toContain('规划用途');

    const product = required(wrapper.findAll('button').find(button => button.text() === '用地用海分类'), '详情里的大类');
    await product.trigger('click');
    expect(owner.selectedId.value).toBe('land-use');
    expect(wrapper.text()).toContain('分类体系 · 分类标准');
  });

  it('数据表显示时点和字段，没有字段说明的表不显示字段表', async () => {
    const { wrapper, owner } = mountWater();

    owner.select('urban-monitoring/HYDA');
    await flushPromises();
    expect(wrapper.text()).toContain('城市国土空间监测分类 · 数据表');
    expect(wrapper.text()).toContain('几何：面 · 时点：年度');
    expect(wrapper.findAll('.el-table__body tr')).toHaveLength(28);

    owner.select('urban-monitoring/HYDL');
    await flushPromises();
    expect(wrapper.find('.el-table').exists()).toBe(false);
    expect(wrapper.text()).toContain('几何：线 · 时点：年度');
  });

  it('定位被挡住的节点时显示出来：清检索、取消隐藏、展开上级', async () => {
    const { wrapper, owner } = mountWater();
    owner.reset('河流');
    owner.select('land-survey/11');
    await flushPromises();
    expect(owner.view.value.nodes.some(node => node.id === 'land-survey/1102')).toBe(false);

    owner.locate('land-survey/1102');
    expect(owner.keyword.value).toBe('');
    expect(owner.view.value.nodes.some(node => node.id === 'land-survey/1102')).toBe(true);

    owner.toggleProduct('land-use');
    owner.toggleCollapsed('land-survey/11');
    await flushPromises();
    owner.locate('land-use/1701');
    expect(owner.hiddenProducts.value.has('land-use')).toBe(false);
    owner.locate('land-survey/1110');
    await flushPromises();
    expect(owner.collapsed.value.has('land-survey/11')).toBe(false);
    expect(wrapper.text()).toContain('冰川及永久积雪');
  });
});
