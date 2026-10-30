import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { type RelationGraphOwner, useRelationGraph } from '../composables/useRelationGraph';
import { waterGraph } from '../extraction/relation-graph';
import { RelationGraph } from './RelationGraph';
import { RelationNodeDetail } from './RelationNodeDetail';

function mountGraph() {
  let owner: RelationGraphOwner | undefined;
  const wrapper = mount(
    defineComponent(() => {
      const graph = useRelationGraph(waterGraph);
      owner = graph;
      return () => (
        <div>
          <RelationGraph owner={graph} />
          <RelationNodeDetail owner={graph} />
        </div>
      );
    })
  );
  return { wrapper, owner: required(owner, '关系图的拥有者') };
}

describe('RelationGraph', () => {
  it('四条泳道、35 张卡片；点卡片选中，详情列出关系，点关联的节点定位过去', async () => {
    const { wrapper, owner } = mountGraph();

    expect(wrapper.findAll('section[aria-label]').map(lane => lane.attributes('aria-label'))).toEqual([
      '用地用海分类',
      '国土调查',
      '城市国土空间监测',
      '水资源基础调查'
    ]);
    expect(wrapper.findAll('[data-node-id]')).toHaveLength(35);

    await wrapper.get('[data-node-id="land-survey/1101"]').trigger('click');
    expect(owner.selectedId.value).toBe('land-survey/1101');
    expect(wrapper.get('[data-node-id="land-survey/1101"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('关联关系1');

    const related = required(
      wrapper.findAll('button').find(button => button.text() === '1701河流水面' && !button.attributes('data-node-id')),
      '详情里的 1701'
    );
    await related.trigger('click');
    expect(owner.selectedId.value).toBe('land-use/1701');
  });

  it('展开按钮收起下级，卡片标出收起的个数；选中被收起的节点时由上级代表', async () => {
    const { wrapper, owner } = mountGraph();
    owner.select('land-use/1702');
    await wrapper.get('button[aria-label="收起 陆地水域"]').trigger('click');

    expect(wrapper.find('[data-node-id="land-use/1702"]').exists()).toBe(false);
    const parent = wrapper.get('[data-node-id="land-use/17"]');
    expect(parent.attributes('aria-label')).toBe('17 陆地水域，已收起 6 个下级');
    expect(parent.attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('button[aria-label="展开 陆地水域"]').attributes('aria-expanded')).toBe('false');
  });

  it('数据成果标签隐藏泳道，图例开关关系类型；没有关系数据的类型不能打开', async () => {
    const { wrapper, owner } = mountGraph();
    const tag = required(
      wrapper.findAll('[role="group"][aria-label="数据成果"] .el-check-tag').find(item => item.text() === '国土调查'),
      '国土调查的标签'
    );
    await tag.trigger('click');
    expect(wrapper.findAll('section[aria-label]')).toHaveLength(3);

    const kinds = wrapper.findAll('[role="group"][aria-label="关系类型"] button');
    expect(kinds.map(button => button.text())).toEqual(['分类对应0', '时序关联3', '字段映射待补充', '空间关联待补充']);
    await kinds[1].trigger('click');
    expect(owner.kinds.value.has('temporal')).toBe(false);
    expect(kinds[1].attributes('aria-pressed')).toBe('false');

    await kinds[2].trigger('click');
    expect(owner.kinds.value.has('field-mapping')).toBe(true);
    expect(kinds[2].attributes('aria-disabled')).toBe('true');
    expect(kinds[2].attributes('aria-pressed')).toBe('false');
  });

  it('检索时只留命中节点周围，命中的文字高亮；关掉检索标签恢复全部', async () => {
    const { wrapper, owner } = mountGraph();
    owner.reset('河流');
    await flushPromises();

    expect(wrapper.findAll('[data-node-id]')).toHaveLength(11);
    expect(wrapper.findAll('mark').map(mark => mark.text())).toEqual(Array(5).fill('河流'));
    const keyword = wrapper.get('.el-tag');
    expect(keyword.text()).toBe('检索：河流 · 命中 5');

    await keyword.get('.el-tag__close').trigger('click');
    expect(owner.keyword.value).toBe('');
    expect(wrapper.findAll('[data-node-id]')).toHaveLength(35);
  });
});

describe('RelationNodeDetail', () => {
  it('没选中时提示；数据表显示时点和字段，没有字段说明的表不显示字段表', async () => {
    const { wrapper, owner } = mountGraph();
    expect(wrapper.text()).toContain('请选择关系图节点');

    owner.select('urban-monitoring/HYDA');
    await flushPromises();
    expect(wrapper.text()).toContain('城市国土空间监测 · 数据表');
    expect(wrapper.text()).toContain('几何：面 · 时点：年度');
    expect(wrapper.findAll('.el-table__body tr')).toHaveLength(28);

    owner.select('urban-monitoring/HYDL');
    await flushPromises();
    expect(wrapper.find('.el-table').exists()).toBe(false);
    expect(wrapper.text()).toContain('几何：线 · 时点：年度');
  });

  it('上级分类列出下级分类和它们与外部的关系', async () => {
    const { wrapper, owner } = mountGraph();
    owner.select('water-survey/FSQ');
    await flushPromises();

    expect(wrapper.text()).toContain('下级分类的关系3');
    expect(wrapper.text()).toContain('下级分类3');
    expect(wrapper.text()).toContain('水资源基础调查 · 一级类');
  });

  it('下级分类的卡片前都留出展开按钮的位置，二级类、三级类逐级缩进（2026-10-30）', () => {
    const { wrapper } = mountGraph();
    // 卡片前面的元素：展开按钮或同宽的占位
    const before = (id: string) => wrapper.get(`[data-node-id="${id}"]`).element.previousElementSibling;

    const nested = ['land-use/1701', 'land-survey/1101', 'urban-monitoring/130A01', 'water-survey/HL_FS'];
    expect(nested.map(id => before(id)?.getAttribute('aria-hidden'))).toEqual(nested.map(() => 'true'));
    expect(before('urban-monitoring/130A')?.getAttribute('aria-label')).toBe('收起 水域网络');
  });
});
