import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '@/features/resource-map/api';
import { buildCatalog } from '@/features/resource-map/catalog';
import { type ResourceLayers, useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { CurrentMapLayerPanel } from './CurrentMapLayerPanel';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function layer(code: string, name: string, geoType: 'Polygon' | 'Line' | 'Point' = 'Polygon') {
  return { code, name, geoType, yearList: [2023, 2024] as [number, ...number[]] };
}

// 只有地类图斑默认在当前地图里；公路线层的最小显示级别是 9（登记的层级）
const CATALOG = buildCatalog([
  {
    code: null,
    name: '基础库',
    children: [
      {
        code: 'tdzy',
        name: '土地资源',
        children: [layer('bgdc_dltb', '地类图斑'), layer('bgdc_cjdcq', '村级调查区'), layer('csxhjctb_hydl', '水域线层', 'Line')]
      }
    ]
  },
  { code: 'jt', name: '交通', children: [layer('csxhjctb_lrdl', '公路线层', 'Line')] }
] satisfies ResourceTreeCategory[]);

// 页面创建地图和拥有者，渲染面板；没有画布，只看面板和拥有者的状态
async function mountPanel() {
  let owner: ResourceLayers | undefined;
  const legendCodes: (string | null)[] = [];
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(map, { catalog, symbols, tileBase: 'http://localhost/tiles/' });
    const layout = useResourcePanelLayout();
    owner = layers;
    return () => (
      <CurrentMapLayerPanel
        resources={layers}
        symbols={symbols}
        layout={layout}
        onLegendCode={(code: string | null) => legendCodes.push(code)}
      />
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  await nextTick();
  if (!owner) {
    throw new Error('页面没有创建拥有者');
  }
  return { wrapper, owner, legendCodes };
}

const node = (wrapper: VueWrapper, code: string) => wrapper.get(`[data-catalog-node="resource:${code}"]`);
const row = (wrapper: VueWrapper, code: string) => wrapper.get(`[data-current-row="resource:${code}"]`);
const tool = (wrapper: VueWrapper, key: string) => wrapper.get(`[data-tool="${key}"]`);
const currentOrder = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-current-row]').map(item => item.attributes('data-current-row')?.replace('resource:', ''));
function selectedRow(wrapper: VueWrapper): string | null {
  const found = wrapper.find('[data-current-row][aria-selected="true"]');
  return found.exists() ? (found.attributes('data-current-row')?.replace('resource:', '') ?? null) : null;
}
const popover = () => document.querySelector<HTMLElement>('[data-layer-popover]');

afterEach(() => {
  // Element 的提示挂在 body 下，不归组件管
  document.body.innerHTML = '';
});

describe('CurrentMapLayerPanel', () => {
  it('目录多选后添加：只加还没加的，整批放在最上面、保持目录的先后，选中第一个（ADR 0157）', async () => {
    const { wrapper, owner } = await mountPanel();
    await tool(wrapper, 'expand-all').trigger('click');
    expect(tool(wrapper, 'add').attributes('aria-disabled')).toBe('true');

    await node(wrapper, 'csxhjctb_hydl').trigger('click');
    await node(wrapper, 'bgdc_dltb').trigger('click', { ctrlKey: true });
    await node(wrapper, 'bgdc_cjdcq').trigger('click', { ctrlKey: true });
    await tool(wrapper, 'add').trigger('click');

    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_cjdcq', 'csxhjctb_hydl', 'bgdc_dltb']);
    expect(selectedRow(wrapper)).toBe('bgdc_cjdcq');
    expect(owner.state.value.displays.get('csxhjctb_hydl')).toMatchObject({ added: true, checked: true });
    // 都加过了：添加不可用，移除可用
    expect(tool(wrapper, 'add').attributes('aria-disabled')).toBe('true');
    expect(tool(wrapper, 'remove').attributes('aria-disabled')).toBe('false');
  });

  it('移除选中的行：选中相邻的，目录里的资源仍在；全部移除后是空状态，工具栏不可用', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['bgdc_cjdcq', 'csxhjctb_hydl']);
    await nextTick();
    await row(wrapper, 'csxhjctb_hydl').trigger('click');

    await row(wrapper, 'csxhjctb_hydl').get('button[aria-label="移除：水域线层"]').trigger('click');
    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb']);
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
    expect(owner.state.value.displays.get('csxhjctb_hydl')?.added).toBe(false);

    await row(wrapper, 'bgdc_dltb').trigger('keydown', { key: 'Delete' });
    await row(wrapper, 'bgdc_cjdcq').trigger('keydown', { key: 'Delete' });
    expect(wrapper.text()).toContain('当前地图还没有图层');
    expect(tool(wrapper, 'move-up').attributes('aria-disabled')).toBe('true');
    expect(tool(wrapper, 'opacity').attributes('aria-disabled')).toBe('true');
  });

  it('工具栏移动选中的一行：上移、置顶、置底，到头时不可用', async () => {
    const { wrapper } = await mountPanel();
    await tool(wrapper, 'expand-all').trigger('click');
    await node(wrapper, 'bgdc_cjdcq').trigger('click');
    await node(wrapper, 'csxhjctb_hydl').trigger('click', { ctrlKey: true });
    await tool(wrapper, 'add').trigger('click');
    await row(wrapper, 'bgdc_dltb').trigger('click');

    await tool(wrapper, 'move-top').trigger('click');
    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);
    expect(tool(wrapper, 'move-up').attributes('aria-disabled')).toBe('true');
    await tool(wrapper, 'move-bottom').trigger('click');
    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_cjdcq', 'csxhjctb_hydl', 'bgdc_dltb']);
    await tool(wrapper, 'move-up').trigger('click');
    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_hydl']);
  });

  it('透明度和图例是两个浮层：再点入口、关闭按钮、Esc 关闭；点行首的符号选中并打开图例，告诉页面是哪个资源', async () => {
    const { wrapper, owner, legendCodes } = await mountPanel();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');

    await tool(wrapper, 'opacity').trigger('click');
    expect(popover()?.getAttribute('aria-label')).toBe('地类图斑的透明度');
    expect(tool(wrapper, 'opacity').attributes('aria-pressed')).toBe('true');
    await tool(wrapper, 'opacity').trigger('click');
    expect(popover()).toBeNull();

    await row(wrapper, 'csxhjctb_hydl').get('[data-row-symbol]').trigger('click');
    expect(selectedRow(wrapper)).toBe('csxhjctb_hydl');
    expect(popover()?.getAttribute('aria-label')).toBe('水域线层的图例');
    expect(legendCodes.at(-1)).toBe('csxhjctb_hydl');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(popover()).toBeNull();
    expect(legendCodes.at(-1)).toBeNull();
  });

  it('换选中的行时浮层跟着换；隐藏的行仍在当前图层里，复选框不改选中', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'opacity').trigger('click');

    await row(wrapper, 'csxhjctb_hydl').trigger('click');
    expect(popover()?.getAttribute('aria-label')).toBe('水域线层的透明度');

    await row(wrapper, 'bgdc_dltb').get('input[type="checkbox"]').setValue(false);
    expect(owner.state.value.displays.get('bgdc_dltb')).toMatchObject({ added: true, checked: false });
    expect(selectedRow(wrapper)).toBe('csxhjctb_hydl');
  });

  it('双击目录里已添加的资源：在当前图层里选中并闪一下；没添加的不动', async () => {
    const { wrapper } = await mountPanel();
    await tool(wrapper, 'expand-all').trigger('click');

    await node(wrapper, 'bgdc_cjdcq').trigger('dblclick');
    expect(selectedRow(wrapper)).toBeNull();
    await node(wrapper, 'bgdc_dltb').trigger('dblclick');
    await nextTick();
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
    expect(row(wrapper, 'bgdc_dltb').classes().some(name => name.includes('flash'))).toBe(true);
  });

  it('定位：二维图层没到最小显示级别时放大到那一级，到了就不可用（后端给不出范围）', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_lrdl']);
    await nextTick();

    await row(wrapper, 'csxhjctb_lrdl').trigger('click');
    expect(tool(wrapper, 'locate').attributes('aria-disabled')).toBe('false');
    await row(wrapper, 'bgdc_dltb').trigger('click');
    expect(tool(wrapper, 'locate').attributes('aria-disabled')).toBe('true');
  });

  it('右键当前图层的一行：先选中它，菜单里能隐藏、移动和移除', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_hydl']);
    await nextTick();

    await row(wrapper, 'bgdc_dltb').trigger('contextmenu');
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
    const labels = [...document.querySelectorAll('[data-menu-item]')].map(item => item.getAttribute('data-menu-item'));
    expect(labels).toStrictEqual([
      'visible',
      'opacity',
      'legend',
      'locate',
      'move-up',
      'move-down',
      'move-top',
      'move-bottom',
      'remove'
    ]);

    document.querySelector<HTMLElement>('[data-menu-item="visible"]')?.click();
    await nextTick();
    expect(owner.state.value.displays.get('bgdc_dltb')?.checked).toBe(false);
    expect(document.querySelector('[data-panel-menu]')).toBeNull();
  });
});
