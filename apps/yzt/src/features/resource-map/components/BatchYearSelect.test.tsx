import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ElOption, ElSelect } from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '../api';
import { buildCatalog, type ResourceCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { BatchYearSelect } from './BatchYearSelect';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function layer(
  code: string,
  name: string,
  geoType: 'Polygon' | 'Line' = 'Polygon',
  yearList: [number, ...number[]] = [2024]
) {
  return { code, name, geoType, yearList };
}

// 结构同真实的资源树；只有地类图斑默认在当前地图里
const CATALOG = buildCatalog([
  {
    code: null,
    name: '基础库',
    children: [
      {
        code: 'tdzy',
        name: '土地资源',
        children: [
          layer('bgdc_dltb', '地类图斑'),
          layer('bgdc_cjdcq', '村级调查区', 'Polygon', [2023, 2024]),
          layer('csxhjctb_hydl', '水域线层', 'Line', [2023, 2024, 2025])
        ]
      },
      { code: 'szy', name: '水资源', children: [layer('szy_kt', '坑塘')] }
    ]
  }
] satisfies ResourceTreeCategory[]);

// 页面创建地图和拥有者，渲染选择框；下拉放在 body 下，所以挂到文档上
async function mountSelect(catalog: ResourceCatalog = CATALOG) {
  let owner: ResourceLayers | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const layers = useResourceLayers(map, { catalog: shallowRef(catalog), tileBase: 'http://localhost/tiles/' });
    owner = layers;
    return () => <BatchYearSelect layers={layers} />;
  });
  const wrapper = mount(Page, { attachTo: document.body });
  await nextTick();
  if (!owner) {
    throw new Error('页面没有创建拥有者');
  }
  return { wrapper, owner };
}

const select = (wrapper: VueWrapper) => wrapper.getComponent(ElSelect);

// 点下拉里一项的文字（事件再冒泡到选项上）
async function pickOption(label: string) {
  const option = [...document.body.querySelectorAll('.el-select-dropdown__item')].find(
    item => item.textContent?.trim() === label
  );
  const text = option?.firstElementChild ?? option;
  if (!(text instanceof HTMLElement)) {
    throw new Error(`下拉里没有 ${label}`);
  }
  text.click();
  await nextTick();
}

const yearsOf = (owner: ResourceLayers) =>
  Object.fromEntries([...owner.state.value.displays].map(([code, { year }]) => [code, year]));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BatchYearSelect（ADR 0052、0116）', () => {
  it('选完就执行：有这一年的资源不论是否加入都切过去，选择框回显这一年；下拉里只有年份，新的在前，固定加 2021、2020', async () => {
    const { wrapper, owner } = await mountSelect();
    expect(select(wrapper).findAllComponents(ElOption).map(option => option.props('value'))).toStrictEqual([
      2025, 2024, 2023, 2021, 2020
    ]);
    expect(select(wrapper).props('modelValue')).toBeUndefined();
    expect(document.querySelector('.el-select-dropdown__footer')).toBeNull();

    await pickOption('2023 年');
    // 没加入的村级调查区、水域线层也切过去；地类图斑、坑塘没有 2023 年，不变
    expect(yearsOf(owner)).toStrictEqual({ bgdc_dltb: 2024, bgdc_cjdcq: 2023, csxhjctb_hydl: 2023, szy_kt: 2024 });
    expect(select(wrapper).props('modelValue')).toBe(2023);
    expect(select(wrapper).text()).toContain('2023 年');
  });

  it('单独改一个资源的年份不影响回显；再选同一年把它切回来', async () => {
    const { wrapper, owner } = await mountSelect();
    await pickOption('2023 年');

    owner.setYear('csxhjctb_hydl', 2025);
    await nextTick();
    expect(select(wrapper).props('modelValue')).toBe(2023);
    await pickOption('2023 年');
    expect(owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
  });

  it('选了没有资源有数据的年份：不提示，图层不变，选择框回显这一年', async () => {
    const { wrapper, owner } = await mountSelect();
    const before = yearsOf(owner);

    await pickOption('2020 年');
    await flushPromises();

    expect(yearsOf(owner)).toStrictEqual(before);
    expect(select(wrapper).props('modelValue')).toBe(2020);
    expect(document.body.querySelector('.el-message')).toBeNull();
  });

  it('没有多年份的资源时只有固定的 2021、2020（ADR 0094）', async () => {
    const single = buildCatalog([{ code: null, name: '基础库', children: [layer('bgdc_dltb', '地类图斑')] }]);
    const { wrapper } = await mountSelect(single);

    expect(select(wrapper).findAllComponents(ElOption).map(option => option.props('value'))).toStrictEqual([
      2021, 2020
    ]);
  });
});
