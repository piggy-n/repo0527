import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElOption, ElSelect, ElSlider } from 'element-plus';
import SortableJS from 'sortablejs';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '../api';
import { buildCatalog, type ResourceCatalog } from '../catalog';
import { type CatalogOrderOwner, useCatalogOrder } from '../composables/useCatalogOrder';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourcePanelLayout, useResourcePanelLayout } from '../composables/useResourcePanelLayout';
import { checkedAreaHeight, ResourceLayerPanel } from './ResourceLayerPanel';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function layer(
  code: string,
  name: string,
  geoType: 'Polygon' | 'Line' | 'Point' = 'Polygon',
  yearList: [number, ...number[]] = [2024]
) {
  return { code, name, geoType, yearList };
}

// 结构同真实的资源树；只有地类图斑默认勾选
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

const LAND = '基础库 / 土地资源';

/**
 * 页面创建地图和拥有者，渲染面板；没有画布，只看面板和拥有者的状态。null 表示目录还没到；
 * 要检查焦点时挂到文档上（脱离文档的元素不能获得焦点）
 */
async function mountPanel(catalog: ResourceCatalog | null = CATALOG, attach = false) {
  const source = shallowRef(catalog ?? undefined);
  const failed = ref(false);
  const onRetry = vi.fn<() => void>();
  // 收起由页面决定：这里像页面一样按面板发出的事件改
  const collapsed = ref(false);
  let owners: { layers: ResourceLayers; order: CatalogOrderOwner; layout: ResourcePanelLayout } | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const layers = useResourceLayers(map, { catalog: source, tileBase: 'http://localhost/tiles/' });
    const order = useCatalogOrder();
    const layout = useResourcePanelLayout();
    map.bindStyle({ resources: layers.deriveGroup });
    owners = { layers, order, layout };
    return () => (
      <ResourceLayerPanel
        layers={layers}
        catalogOrder={order}
        layout={layout}
        failed={failed.value}
        collapsed={collapsed.value}
        onRetry={onRetry}
        onUpdate:collapsed={value => (collapsed.value = value)}
      />
    );
  });
  const wrapper = mount(Page, attach ? { attachTo: document.body } : {});
  // 拖动的实例在挂载后的下一轮渲染里建
  await nextTick();
  if (!owners) {
    throw new Error('页面没有创建拥有者');
  }
  return { wrapper, owner: owners.layers, order: owners.order, source, failed, onRetry, collapsed };
}

function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

// 目录树里的一行（资源或分类）的复选框
function checkbox(wrapper: VueWrapper, selector: string) {
  return wrapper.get(`${selector} input[type="checkbox"]`);
}

const visibleResources = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-resource]').map(row => row.attributes('data-resource'));

const checkedOrder = (wrapper: VueWrapper) => wrapper.findAll('[data-layer]').map(row => row.attributes('data-layer'));

// 模拟 SortableJS 放下：它已经把元素移到了新位置，再调用 onEnd
function drop(list: Element, from: number, to: number) {
  const sortable = list instanceof HTMLElement ? SortableJS.get(list) : null;
  const item = list.children[from];
  if (!sortable || !(item instanceof HTMLElement)) {
    throw new Error('列表上没有拖动的实例');
  }
  item.remove();
  list.insertBefore(item, list.children[to] ?? null);
  const event = { item, from: list, oldIndex: from, newIndex: to, oldDraggableIndex: from, newDraggableIndex: to };
  sortable.options.onEnd?.(event as unknown as SortableJS.SortableEvent);
}

describe('ResourceLayerPanel', () => {
  it('目录还没到：显示加载中；加载失败：显示失败和重试', async () => {
    const { wrapper, failed, onRetry } = await mountPanel(null);
    expect(wrapper.text()).toContain('正在加载资源目录');

    failed.value = true;
    await nextTick();
    await wrapper.findAll('button').find(item => item.text() === '重试')?.trigger('click');

    expect(wrapper.text()).toContain('资源目录加载失败');
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('统计报表、分节点资源两个页签是"暂无数据"，切回主节点照常', async () => {
    const { wrapper } = await mountPanel();

    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === '统计报表')?.trigger('click');
    expect(wrapper.text()).toContain('暂无数据');
    expect(wrapper.find('input[placeholder="搜索资源"]').exists()).toBe(false);

    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === '主节点')?.trigger('click');
    expect(visibleResources(wrapper)).toHaveLength(3);
  });

  it('默认展开含有勾选资源的分类；点击箭头展开、收起分类', async () => {
    const { wrapper } = await mountPanel();
    expect(visibleResources(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);

    await button(wrapper, '展开水资源').trigger('click');
    expect(visibleResources(wrapper)).toContain('szy_kt');

    await button(wrapper, '收起基础库').trigger('click');
    expect(visibleResources(wrapper)).toStrictEqual([]);
  });

  it('勾选分类时下面的资源一起勾选；部分勾选时分类显示半选，资源数显示在旁边', async () => {
    const { wrapper, owner } = await mountPanel();
    const land = `[data-category="${LAND}"]`;
    expect(wrapper.get(`${land} .el-checkbox__input`).classes()).toContain('is-indeterminate');
    expect(wrapper.get(land).text()).toContain('3');

    await checkbox(wrapper, `${land} > div`).setValue(true);
    expect(checkedOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);

    await checkbox(wrapper, '[data-resource="bgdc_cjdcq"]').setValue(false);
    expect(owner.state.value.displays.get('bgdc_cjdcq')?.checked).toBe(false);
    expect(wrapper.get(`${land} .el-checkbox__input`).classes()).toContain('is-indeterminate');
  });

  it('搜索：只显示命中的资源并展开它的路径，不能拖动；没有命中时提示', async () => {
    const { wrapper } = await mountPanel();
    const input = wrapper.get('input[placeholder="搜索资源"]');
    expect(wrapper.findAll('button[title="调整目录顺序"]').length).toBeGreaterThan(0);

    const rootList = wrapper.get('[data-resource-layer-panel] ul').element;
    expect(rootList instanceof HTMLElement && SortableJS.get(rootList)?.option('disabled')).toBe(false);

    await input.setValue('坑塘');
    expect(visibleResources(wrapper)).toStrictEqual(['szy_kt']);
    expect(wrapper.findAll('button[title="调整目录顺序"]')).toHaveLength(0);
    expect(rootList instanceof HTMLElement && SortableJS.get(rootList)?.option('disabled')).toBe(true);

    await input.setValue('没有这个');
    expect(wrapper.text()).toContain('没有找到资源');
  });

  it('目录顺序：拖动或在手柄上按方向键只调整同一个分类下的展示顺序，不改叠放顺序（ADR 0053 第 6 节）', async () => {
    const { wrapper, owner, order } = await mountPanel(CATALOG, true);
    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    const stacking = checkedOrder(wrapper);

    await button(wrapper, '调整目录顺序：地类图斑').trigger('keydown', { key: 'ArrowDown' });
    expect(visibleResources(wrapper)).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_hydl']);
    expect(order.order.value).toStrictEqual({ [LAND]: ['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_hydl'] });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('调整目录顺序：地类图斑');

    drop(wrapper.get(`[data-category="${LAND}"] > ul`).element, 2, 0);
    await nextTick();
    expect(visibleResources(wrapper)).toStrictEqual(['csxhjctb_hydl', 'bgdc_cjdcq', 'bgdc_dltb']);

    expect(checkedOrder(wrapper)).toStrictEqual(stacking);
    expect(owner.state.value.order.slice(0, 3)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);
  });

  it('"已勾选"：拖动或在手柄上按方向键调整叠放顺序，不改目录顺序', async () => {
    const { wrapper, owner, order } = await mountPanel(CATALOG, true);
    // 叠放顺序是地类图斑、村级调查区（没勾选）、水域线层、坑塘：已勾选里的位置和叠放顺序里的位置不同
    owner.setChecked('csxhjctb_hydl', true);
    owner.setChecked('szy_kt', true);
    await nextTick();
    expect(checkedOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl', 'szy_kt']);

    await button(wrapper, '调整叠放顺序：水域线层').trigger('keydown', { key: 'ArrowUp' });
    expect(checkedOrder(wrapper)).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'szy_kt']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('调整叠放顺序：水域线层');

    drop(wrapper.get('[data-layer="bgdc_dltb"]').element.parentElement ?? document.body, 0, 2);
    await nextTick();
    expect(checkedOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'szy_kt', 'csxhjctb_hydl']);

    expect(visibleResources(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);
    expect(order.order.value).toStrictEqual({});
  });

  it('× 取消勾选；年份和透明度按资源保留，重新勾选时照旧', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.setOpacity('bgdc_dltb', 0.5);

    await button(wrapper, '取消勾选地类图斑').trigger('click');
    expect(owner.state.value.displays.get('bgdc_dltb')?.checked).toBe(false);
    expect(checkedOrder(wrapper)).toStrictEqual([]);
    expect(wrapper.text()).toContain('勾选资源后在这里调整叠放顺序和透明度');

    owner.setChecked('bgdc_dltb', true);
    await nextTick();
    expect(button(wrapper, '地类图斑的透明度').text()).toBe('50%');
  });

  it('透明度：带边框的百分比，默认 100%，点开滑块拖动时把 0～1 的透明度交给拥有者', async () => {
    const { wrapper, owner } = await mountPanel();
    expect(button(wrapper, '地类图斑的透明度').text()).toBe('100%');
    expect(wrapper.findComponent(ElSlider).exists()).toBe(false);

    await button(wrapper, '地类图斑的透明度').trigger('click');
    expect(button(wrapper, '地类图斑的透明度').attributes('aria-expanded')).toBe('true');
    const slider = wrapper.findComponent(ElSlider);
    expect(slider.props('modelValue')).toBe(100);
    slider.vm.$emit('update:modelValue', 40);
    await nextTick();

    expect(owner.state.value.displays.get('bgdc_dltb')?.opacity).toBe(0.4);
    expect(button(wrapper, '地类图斑的透明度').text()).toBe('40%');
  });

  it('级别不够时名称后有信息图标，提示放大到几级；级别够了就没有', async () => {
    const { wrapper, owner } = await mountPanel();
    const minzoom = owner.minzoomOf('bgdc_cjdcq');
    if (minzoom === undefined || minzoom <= CAMERA.zoom) {
      throw new Error('村级调查区应当有高于当前级别的最小显示级别');
    }
    owner.setChecked('bgdc_cjdcq', true);
    await nextTick();

    expect(wrapper.get('[data-layer="bgdc_cjdcq"] [role="img"]').attributes('aria-label')).toBe(
      `放大至第 ${minzoom} 级显示`
    );
    expect(wrapper.get('[data-layer="bgdc_cjdcq"]').text()).not.toContain('放大');
    expect(wrapper.find('[data-layer="bgdc_dltb"] [role="img"]').exists()).toBe(false);
  });

  it('收起按钮通知页面；显示为收起时是竖条，点它通知展开', async () => {
    const { wrapper, collapsed } = await mountPanel();

    await button(wrapper, '收起资源图层').trigger('click');

    expect(collapsed.value).toBe(true);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toBe('资源图层');
    await button(wrapper, '展开资源图层').trigger('click');
    expect(collapsed.value).toBe(false);
    expect(visibleResources(wrapper)).toHaveLength(3);
  });
});

describe('checkedAreaHeight', () => {
  it('按比例，限制在两边的最小高度以内：目录至少 3 行（96），"已勾选"至少标题加 2 行（102）', () => {
    expect(checkedAreaHeight(500, 0.4)).toBe(200);
    expect(checkedAreaHeight(500, 0.05)).toBe(102);
    expect(checkedAreaHeight(500, 0.95)).toBe(404);
  });

  it('放不下两边的最小高度时只按比例', () => {
    expect(checkedAreaHeight(150, 0.4)).toBe(60);
    expect(checkedAreaHeight(0, 0.4)).toBe(0);
  });
});

// 批量设置年份的选择
function batchSelect(wrapper: VueWrapper) {
  const select = wrapper.findAllComponents(ElSelect).find(item => item.props('placeholder') === '批量设置年份');
  if (!select) {
    throw new Error('没有批量设置年份');
  }
  return select;
}

// 点下拉里的一项；下拉放在 body 下
async function pickOption(label: string) {
  const option = [...document.body.querySelectorAll('.el-select-dropdown__item')].find(
    item => item.textContent?.trim() === label
  );
  if (!(option instanceof HTMLElement)) {
    throw new Error(`下拉里没有 ${label}`);
  }
  option.click();
  await nextTick();
}

const yearsOf = (owner: ResourceLayers) =>
  Object.fromEntries([...owner.state.value.displays].map(([code, { year }]) => [code, year]));

describe('ResourceLayerPanel：年份（ADR 0052）', () => {
  it('已勾选的多年份资源可以选年份（新的在前），单年份资源只显示年份', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    const select = wrapper.get('[data-layer="csxhjctb_hydl"]').findComponent(ElSelect);

    expect(select.props('modelValue')).toBe(2025);
    expect(select.findAllComponents(ElOption).map(option => option.props('value'))).toStrictEqual([2025, 2024, 2023]);
    select.vm.$emit('update:modelValue', 2023);
    await nextTick();
    expect(owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
    // 只改这一个资源，有 2023 年的村级调查区不跟着变
    expect(owner.state.value.displays.get('bgdc_cjdcq')?.year).toBe(2024);
    expect(wrapper.get('[data-layer="csxhjctb_hydl"]').findComponent(ElSelect).props('modelValue')).toBe(2023);

    const parcel = wrapper.get('[data-layer="bgdc_dltb"]');
    expect(parcel.findComponent(ElSelect).exists()).toBe(false);
    expect(parcel.text()).toContain('2024');
  });

  it('批量设置年份：选完就执行、选择框回到空，连续两次选同一年都执行；下拉里提示没有这一年的资源保持不变', async () => {
    const { wrapper, owner } = await mountPanel();
    expect(batchSelect(wrapper).findAllComponents(ElOption).map(option => option.props('value'))).toStrictEqual([
      2025, 2024, 2023
    ]);
    expect(document.body.textContent).toContain('没有这一年的资源保持不变');

    await pickOption('2023 年');
    // 没勾选的村级调查区也切过去；地类图斑没有 2023 年，不变
    expect(yearsOf(owner)).toStrictEqual({ bgdc_dltb: 2024, bgdc_cjdcq: 2023, csxhjctb_hydl: 2023, szy_kt: 2024 });
    expect(batchSelect(wrapper).props('modelValue')).toBeUndefined();

    owner.setYear('csxhjctb_hydl', 2025);
    await nextTick();
    await pickOption('2023 年');
    expect(owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
  });

  it('没有多年份的资源时不显示批量设置', async () => {
    const single = buildCatalog([{ code: null, name: '基础库', children: [layer('bgdc_dltb', '地类图斑')] }]);
    const { wrapper } = await mountPanel(single);

    expect(document.body.textContent).not.toContain('没有这一年的资源保持不变');
    expect(wrapper.findAllComponents(ElSelect)).toHaveLength(0);
  });
});
