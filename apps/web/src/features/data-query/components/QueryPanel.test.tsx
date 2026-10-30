import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { provideMap } from '@yzt/map-vue';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { required } from '@/shared/testing/required';
import { useDataQuery } from '../composables/useDataQuery';
import { QUERY_TOPICS, type TopicId } from '../topics';
import { QueryPanel } from './QueryPanel';

afterEach(() => {
  // ElMessage 挂在 body 下，不随组件卸载
  document.body.innerHTML = '';
});

function setup(topicId: TopicId = 'space-monitoring') {
  const Page = defineComponent(() => {
    const map = provideMap({ groups: [], camera: JIANGSU_CAMERA });
    const query = useDataQuery({ topic: QUERY_TOPICS[topicId], map });
    map.registerTools(query.spatial.draw.tools);
    return () => <QueryPanel query={query} />;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Page, { global: { plugins: [[VueQueryPlugin, { queryClient }]] }, attachTo: document.body });
}

// 查询方式的按钮组里的一项
const mode = (wrapper: VueWrapper, text: string) =>
  required(
    wrapper.findAll('[role="radiogroup"] .el-radio-button').find(item => item.text() === text),
    `${text}按钮`
  );

const button = (wrapper: VueWrapper, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `${text}按钮`
  );

describe('QueryPanel', () => {
  it('标题是专题名；查询方式是一组按钮，高级查询暂时隐藏，点一项切换内容', async () => {
    const wrapper = setup();
    expect(wrapper.find('h2').text()).toBe('城市国土空间监测查询');
    const group = wrapper.get('[role="radiogroup"]');
    expect(group.attributes('aria-label')).toBe('查询方式');
    expect(group.findAll('.el-radio-button').map(item => item.text())).toStrictEqual([
      '属性查询',
      '空间查询',
      '自然语言查询'
    ]);
    expect(wrapper.text()).toContain('查询范围');

    await mode(wrapper, '空间查询').get('input').setValue(true);
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('空间查询');
    expect(wrapper.text()).toContain('选择方式');

    await mode(wrapper, '自然语言查询').get('input').setValue(true);
    expect(wrapper.get('.el-radio-button.is-active').text()).toBe('自然语言查询');
  });

  it('参考旧页面的按钮：条件下面是"添加查询条件"（选图层前不可用），底部查询在前、重置在后', () => {
    const wrapper = setup();

    expect(button(wrapper, '添加查询条件').attributes('disabled')).toBeDefined();
    const footer = wrapper.findAll('button').filter(item => ['查询', '重置'].includes(item.text()));
    expect(footer.map(item => item.text())).toStrictEqual(['查询', '重置']);
  });

  it('没选图层就查询时提示，不发请求', async () => {
    const wrapper = setup();
    await button(wrapper, '查询').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.el-message')?.textContent).toContain('未选择图层');
  });

  it('框选按钮按下时显示为按下，再点一次取消', async () => {
    const wrapper = setup();
    await mode(wrapper, '空间查询').get('input').setValue(true);
    const rectangle = button(wrapper, '框选');
    await rectangle.trigger('click');
    expect(rectangle.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('在地图上拖动框选');
    await rectangle.trigger('click');
    expect(rectangle.attributes('aria-pressed')).toBe('false');
  });

  it('建设中的专题只有说明，没有查询方式和查询按钮', () => {
    const wrapper = setup('water-resource');
    expect(wrapper.find('h2').text()).toBe('水资源基础调查');
    expect(wrapper.text()).toContain('建设中');
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === '查询')).toBe(false);
  });
});
