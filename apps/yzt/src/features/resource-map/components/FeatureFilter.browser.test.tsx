import 'element-plus/dist/index.css';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { buildCatalog } from '../catalog';
import { type FeatureFilter as Filter, normalizedFilter } from '../feature-filter';
import { CLASS_FIELD, filterFieldsOf } from '../filter-fields';
import { EMPTY_RESOURCE_LAYERS, mergeDisplayState, type ResourceLayersState } from '../resource-layers';
import { FeatureFilter } from './FeatureFilter';

const CODE = 'csxhjctb_xxa';
const CATALOG = buildCatalog([
  { code: null, name: '测试', children: [{ code: CODE, name: '学校面层', geoType: 'Polygon', yearList: [2025] }] }
]);

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach(host => host.remove());
});

// 拥有者只用到状态和 setFilter，同 FeatureFilter.test.tsx；放进真实页面，按真实的悬停和焦点算样式
function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.width = '300px';
  hosts.push(host);
  const withFilter = (state: ResourceLayersState, next: Filter): ResourceLayersState => {
    const display = required(state.displays.get(CODE), '学校面层的显示状态');
    const filter = normalizedFilter(filterFieldsOf(CODE), next);
    return { ...state, displays: new Map([...state.displays, [CODE, { ...display, filter }]]) };
  };
  const state = shallowRef(mergeDisplayState(EMPTY_RESOURCE_LAYERS, CATALOG));
  const setFilter = (_code: string, next: Filter) => {
    state.value = withFilter(state.value, next);
  };
  const wrapper = mount(FeatureFilter, {
    attachTo: host,
    props: { layers: { state, setFilter }, symbols: { overrideOf: () => undefined }, code: CODE }
  });
  const row = (key: string) => required(host.querySelector<HTMLElement>(`[data-filter-value="${key}"]`), `${key}一行`);
  const only = (key: string) => required(row(key).querySelector<HTMLElement>('[data-filter-only]'), `${key}的仅此项`);
  const shown = (key: string) => getComputedStyle(only(key)).opacity === '1';
  return { wrapper, state, row, only, shown };
}

describe('FeatureFilter 的"仅此项"（浏览器）', () => {
  it('鼠标点完"仅此项"、复选框，移开后"仅此项"不再挂着（用户 2026-11-24）', async () => {
    const { state, row, only, shown } = setup();
    expect(shown('08H214')).toBe(false);
    await userEvent.hover(row('08H214'));
    expect(shown('08H214')).toBe(true);

    await userEvent.click(only('08H214'));
    expect(state.value.displays.get(CODE)?.filter).toStrictEqual({ [CLASS_FIELD]: ['08H214'] });
    await userEvent.unhover(row('08H214'));
    expect(document.activeElement).toBe(only('08H214'));
    expect(shown('08H214')).toBe(false);

    await userEvent.click(required(row('08H211').querySelector('.el-checkbox'), '高等院校的复选框'));
    await userEvent.unhover(row('08H211'));
    expect(row('08H211').contains(document.activeElement)).toBe(true);
    expect(shown('08H211')).toBe(false);
  });

  it('键盘：Tab 到一行时"仅此项"显示，回车以后焦点还在它上面、仍显示', async () => {
    const { state, row, only, shown } = setup();
    required(row('08H211').querySelector<HTMLInputElement>('input'), '高等院校的复选框').focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(only('08H211'));
    expect(shown('08H211')).toBe(true);
    expect(only('08H211').matches(':focus-visible')).toBe(true);

    await userEvent.keyboard('{Enter}');
    expect(state.value.displays.get(CODE)?.filter).toStrictEqual({ [CLASS_FIELD]: ['08H211'] });
    expect(document.activeElement).toBe(only('08H211'));
    expect(shown('08H211')).toBe(true);

    await userEvent.tab();
    expect(row('08H212').contains(document.activeElement)).toBe(true);
    expect(shown('08H211')).toBe(false);
    expect(shown('08H212')).toBe(true);
  });
});
