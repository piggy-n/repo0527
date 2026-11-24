import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { buildCatalog } from '../catalog';
import { OTHER_ITEM } from '../classification';
import { type FeatureFilter as Filter, NO_FILTER, normalizedFilter } from '../feature-filter';
import { CLASS_FIELD, filterFieldsOf } from '../filter-fields';
import { EMPTY_RESOURCE_LAYERS, mergeDisplayState, type ResourceLayersState } from '../resource-layers';
import { FeatureFilter } from './FeatureFilter';

const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      { code: 'csxhjctb_xxa', name: '学校面层', geoType: 'Polygon', yearList: [2025] },
      { code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2022] }
    ]
  }
]);

// 拥有者只用到状态和 setFilter：同拥有者，按能过滤的字段整理后写进显示状态
function setup(code: string, filter: Filter = NO_FILTER) {
  const merged = mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG);
  const withFilter = (state: ResourceLayersState, next: Filter): ResourceLayersState => {
    const display = state.displays.get(code);
    if (!display) {
      throw new Error(`没有 ${code}`);
    }
    const normalized = normalizedFilter(filterFieldsOf(code), next);
    return { ...state, displays: new Map([...state.displays, [code, { ...display, filter: normalized }]]) };
  };
  const state = shallowRef(withFilter(merged, filter));
  const setFilter = vi.fn<(target: string, next: Filter) => void>((target, next) => {
    expect(target).toBe(code);
    state.value = withFilter(state.value, next);
  });
  const wrapper = mount(FeatureFilter, {
    props: { layers: { state, setFilter }, symbols: { overrideOf: () => undefined }, code }
  });
  const filterOf = () => state.value.displays.get(code)?.filter;
  return { wrapper, setFilter, filterOf };
}

const value = (wrapper: VueWrapper, key: string) => wrapper.get(`[data-filter-value="${key}"]`);
const checked = (wrapper: VueWrapper, key: string) =>
  value(wrapper, key).get<HTMLInputElement>('input').element.checked;
const allBox = (wrapper: VueWrapper) => wrapper.get('[data-filter-all]');
const summary = (wrapper: VueWrapper) => wrapper.get('[data-filter-summary]');
const clearButton = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-filter-summary] button').find(item => item.text() === '清空过滤');

describe('FeatureFilter（ADR 0173）', () => {
  it('字段：分类在前、登记的类型在后；打开时先看有条件的字段；只有一个字段时只写名称', () => {
    const { wrapper } = setup('csxhjctb_xxa', { type: ['小学'] });
    const tabs = wrapper.findAll('[data-filter-field]');
    expect(tabs.map(tab => tab.text())).toStrictEqual(['分类', '类型1']);
    expect(tabs.map(tab => tab.attributes('aria-selected'))).toStrictEqual(['false', 'true']);
    expect(checked(wrapper, '小学')).toBe(true);
    expect(checked(wrapper, '幼儿园')).toBe(false);

    const single = setup('bgdc_dltb').wrapper;
    expect(single.findAll('[data-filter-field]')).toHaveLength(0);
    expect(single.text()).toContain('按地类');
  });

  it('勾掉一项立即交给拥有者，底部写条件；"全选"半选，点了恢复全勾（不再过滤）', async () => {
    const { wrapper, filterOf } = setup('csxhjctb_xxa');
    expect(summary(wrapper).text()).toContain('没有过滤，显示全部要素');
    expect(clearButton(wrapper)?.attributes('disabled')).toBeDefined();

    await value(wrapper, '08H214').get('input').setValue(false);
    expect(filterOf()).toStrictEqual({ [CLASS_FIELD]: ['08H211', '08H212', '08H213', '08H215', '08H216', OTHER_ITEM] });
    expect(summary(wrapper).text()).toContain('已过滤：分类：高等院校、中等职业学校、中小学等 6 项');
    expect(allBox(wrapper).find('.is-indeterminate').exists()).toBe(true);
    expect(allBox(wrapper).text()).toContain('6/7');

    await allBox(wrapper).get('input').setValue(true);
    expect(filterOf()).toBe(NO_FILTER);
  });

  it('"仅此项"只留这一项；"清空过滤"去掉全部条件', async () => {
    const { wrapper, filterOf } = setup('csxhjctb_xxa');
    await wrapper.findAll('[data-filter-field]')[1]?.trigger('click');
    await value(wrapper, '小学').get('[data-filter-only]').trigger('click');
    expect(filterOf()).toStrictEqual({ type: ['小学'] });
    expect(summary(wrapper).text()).toContain('类型：小学');
    expect(wrapper.findAll('[data-filter-field]')[1]?.text()).toBe('类型1');

    await clearButton(wrapper)?.trigger('click');
    expect(filterOf()).toBe(NO_FILTER);
  });

  it('取值多于 10 个时可以搜索：只列搜到的，"全选"只管搜到的；换字段时清空搜索', async () => {
    const { wrapper, filterOf } = setup('csxhjctb_xxa');
    expect(wrapper.find('input[aria-label="搜索分类的取值"]').exists()).toBe(false);
    await wrapper.findAll('[data-filter-field]')[1]?.trigger('click');

    await wrapper.get('input[aria-label="搜索类型的取值"]').setValue('高级中学');
    expect(wrapper.findAll('[data-filter-value]').map(item => item.attributes('data-filter-value'))).toStrictEqual([
      '高级中学',
      '高级中学/初级中学',
      '初级中学/高级中学'
    ]);
    expect(allBox(wrapper).text()).toContain('全选搜索结果');
    await allBox(wrapper).get('input').setValue(false);
    expect(filterOf()?.type).toHaveLength(23);
    expect(filterOf()?.type).not.toContain('高级中学');

    await wrapper.findAll('[data-filter-field]')[0]?.trigger('click');
    await wrapper.findAll('[data-filter-field]')[1]?.trigger('click');
    expect(wrapper.get<HTMLInputElement>('input[aria-label="搜索类型的取值"]').element.value).toBe('');
  });

  it('地类按一级类分组，组能整组勾掉、再整组勾上；地类写编码', async () => {
    const { wrapper, filterOf } = setup('bgdc_dltb');
    const group = wrapper.get('[data-filter-group="耕地"]');
    expect(group.text()).toContain('3/3');
    expect(value(wrapper, '0101').text()).toContain('0101');
    expect(value(wrapper, '0101').text()).toContain('水田');

    await group.get('input').setValue(false);
    expect(filterOf()?.[CLASS_FIELD]).not.toContain('0101');
    expect(filterOf()?.[CLASS_FIELD]).not.toContain('0103');
    expect(wrapper.get('[data-filter-group="耕地"]').text()).toContain('0/3');

    await wrapper.get('[data-filter-group="耕地"]').get('input').setValue(true);
    expect(filterOf()).toBe(NO_FILTER);
  });

  it('一项都没勾时提醒这一层不显示', async () => {
    const { wrapper } = setup('csxhjctb_xxa', { [CLASS_FIELD]: [] });
    expect(summary(wrapper).text()).toContain('有字段一项都没选，地图上不显示这一层');
    expect(summary(wrapper).text()).toContain('分类：一项都没选');
  });
});
