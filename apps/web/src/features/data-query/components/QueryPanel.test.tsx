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

const button = (wrapper: VueWrapper, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `${text}按钮`
  );

describe('QueryPanel', () => {
  it('标题是专题名；四个页签中高级查询排在空间查询之后，点页签切换内容', async () => {
    const wrapper = setup();
    expect(wrapper.find('h2').text()).toBe('城市国土空间监测查询');
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.text())).toStrictEqual(['属性查询', '空间查询', '高级查询', '自然语言查询']);
    expect(wrapper.text()).toContain('查询范围');

    await required(tabs[2], '高级查询页签').trigger('click');
    expect(wrapper.find('[aria-selected="true"]').text()).toBe('高级查询');
    expect(wrapper.text()).toContain('构造条件');
    expect(wrapper.text()).toContain('请先选择图层');

    await required(tabs[1], '空间查询页签').trigger('click');
    expect(wrapper.text()).toContain('选择方式');
  });

  it('没选图层就查询时提示，不发请求', async () => {
    const wrapper = setup();
    await button(wrapper, '查询').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.el-message')?.textContent).toContain('未选择图层');
  });

  it('框选按钮按下时显示为按下，再点一次取消', async () => {
    const wrapper = setup();
    await required(wrapper.findAll('[role="tab"]')[1], '空间查询页签').trigger('click');
    const rectangle = button(wrapper, '框选');
    await rectangle.trigger('click');
    expect(rectangle.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('在地图上拖动框选');
    await rectangle.trigger('click');
    expect(rectangle.attributes('aria-pressed')).toBe('false');
  });

  it('建设中的专题只有说明，没有页签和查询按钮', () => {
    const wrapper = setup('water-resource');
    expect(wrapper.find('h2').text()).toBe('水资源基础调查');
    expect(wrapper.text()).toContain('建设中');
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(wrapper.findAll('button').some(item => item.text() === '查询')).toBe(false);
  });
});
