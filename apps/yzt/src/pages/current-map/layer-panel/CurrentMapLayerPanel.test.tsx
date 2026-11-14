import type { CameraState, SceneStatus } from '@mx/map-core';
import { type MapContext, provideMap } from '@mx/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElOption, ElSelect } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '@/features/resource-map/api';
import { buildCatalog } from '@/features/resource-map/catalog';
import { type ResourceLayers, useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { sceneManifestSchema } from '@/features/scene-models/api';
import { buildModelCatalog } from '@/features/scene-models/catalog';
import { ModelKindSelect } from '@/features/scene-models/components/ModelKindSelect';
import { type SceneModels, useSceneModels } from '@/features/scene-models/composables/useSceneModels';
import type { RequestStatus } from '@/shared/map/request-status/useRequestStatus';
import { required } from '@/shared/testing/required';
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

// 两个三维模型：车站能漫游，白膜能换效果
const MODELS = buildModelCatalog(
  sceneManifestSchema.parse({
    models: [
      {
        id: 'station',
        name: '苏州站地下空间',
        cityCode: '320500',
        kind: 'indoor',
        underground: true,
        tileset: 'S.json',
        routes: [{ id: 'enter', name: '进站', path: [[120.666, 31.3175, -5.1], [120.667, 31.3175, -5.1]] }]
      },
      {
        id: 'white',
        name: '苏州白膜',
        cityCode: '320500',
        kind: 'white',
        underground: false,
        effects: [{ id: 'plain', label: '无纹理', tileset: 'W/plain.json' }]
      }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

// 页面创建地图和拥有者，渲染面板；没有画布，只看面板和拥有者的状态。模型的状态报告由用例给
async function mountPanel({ modelsStatus = 'ready' }: { modelsStatus?: 'ready' | 'failed' } = {}) {
  let owner: ResourceLayers | undefined;
  let models: SceneModels | undefined;
  let context: MapContext | undefined;
  const legendCodes: (string | null)[] = [];
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const onRetryModels = vi.fn<() => void>();
  // 请求状态只用到行内转圈的集合；页面在明细里点了一行时换一个新对象
  const loadingKeys = shallowRef<ReadonlySet<string>>(new Set());
  const requests: RequestStatus = {
    items: computed(() => []),
    now: shallowRef(0),
    loadingKeys: computed(() => loadingKeys.value)
  };
  const reveal = shallowRef<{ readonly key: string } | null>(null);
  const legendYield = shallowRef<string | null>(null);
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(map, { catalog, symbols, tileBase: 'http://localhost/tiles/' });
    const layout = useResourcePanelLayout();
    const sceneModels = useSceneModels({ ...map, sceneStatus }, MODELS);
    owner = layers;
    models = sceneModels;
    context = map;
    return () => (
      <CurrentMapLayerPanel
        resources={layers}
        symbols={symbols}
        layout={layout}
        models={sceneModels}
        modelsStatus={modelsStatus}
        requests={requests}
        reveal={reveal.value}
        legendYield={legendYield.value}
        onLegendCode={(code: string | null) => legendCodes.push(code)}
        onRetryModels={onRetryModels}
      />
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  await nextTick();
  if (!owner || !models || !context) {
    throw new Error('页面没有创建拥有者');
  }
  return {
    wrapper,
    owner,
    models,
    map: context,
    sceneStatus,
    legendCodes,
    onRetryModels,
    loadingKeys,
    reveal,
    legendYield
  };
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
// 右键菜单里的定位
const locateItem = () => document.querySelector<HTMLButtonElement>('[data-menu-item="locate"]');
// 目录显示的内容（用户 2026-11-15）：显示着的节点、标题后面选中的页签、点某个页签
const catalogKeys = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-catalog-node]').map(item => item.attributes('data-catalog-node'));
const shownView = (wrapper: VueWrapper) => wrapper.get('[data-catalog-view][aria-selected="true"]').text();
async function showView(wrapper: VueWrapper, view: 'all' | 'models' | 'resources') {
  await wrapper.get(`[data-catalog-view="${view}"]`).trigger('click');
}

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

  it('定位在右键菜单和双击里（工具栏换成了移除）：二维图层没到最小显示级别时放大到那一级，到了就不可用（后端给不出范围）', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_lrdl']);
    await nextTick();

    await row(wrapper, 'csxhjctb_lrdl').trigger('contextmenu');
    expect(locateItem()?.disabled).toBe(false);
    expect(locateItem()?.textContent).toContain('放大到第 9 级');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('contextmenu');
    expect(locateItem()?.disabled).toBe(true);
  });

  it('工具栏的移除（用户 2026-11-15）：移除选中的一行，选中相邻的；没有选中时不可用', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_lrdl']);
    await nextTick();
    expect(tool(wrapper, 'remove-layer').attributes('aria-disabled')).toBe('true');

    await row(wrapper, 'csxhjctb_lrdl').trigger('click');
    await tool(wrapper, 'remove-layer').trigger('click');
    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_dltb']);
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
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

  it('三维模型在目录最后、按市分组；加入后进"三维模型"组，资源、模型一起加时各自放在本组最上面（ADR 0157）', async () => {
    const { wrapper, models } = await mountPanel();
    await tool(wrapper, 'expand-all').trigger('click');
    const keys = wrapper.findAll('[data-catalog-node]').map(item => item.attributes('data-catalog-node'));
    expect(keys.slice(-4)).toStrictEqual(['model-root', 'model-city:320500', 'model:station', 'model:white']);
    expect(wrapper.get('[data-catalog-node="model:white"]').text()).toContain('白膜');

    await node(wrapper, 'csxhjctb_lrdl').trigger('click');
    await wrapper.get('[data-catalog-node="model:white"]').trigger('click', { ctrlKey: true });
    await tool(wrapper, 'add').trigger('click');
    expect(models.added.value).toStrictEqual(['white']);
    expect(wrapper.findAll('[data-current-group]').map(group => group.attributes('data-current-group'))).toStrictEqual([
      'layers',
      'models'
    ]);
    expect(wrapper.findAll('[data-current-row]').map(item => item.attributes('data-current-row'))).toStrictEqual([
      'resource:csxhjctb_lrdl',
      'resource:bgdc_dltb',
      'model:white'
    ]);
    expect(selectedRow(wrapper)).toBe('csxhjctb_lrdl');
  });

  it('二维里模型组变淡、标"仅三维"：不能定位、不能漫游，没有透明度和图例，移动只改列表顺序；勾选、移动、移除照常', async () => {
    const { wrapper, models } = await mountPanel();
    models.add(['white', 'station']);
    await nextTick();
    const group = wrapper.get('[data-current-group="models"]');
    expect(group.classes().join(' ')).toMatch(/dimmed/);
    expect(group.text()).toContain('仅三维');
    const station = () => wrapper.get('[data-current-row="model:station"]');

    const locate = vi.spyOn(models, 'locate');
    await station().trigger('click');
    await station().trigger('dblclick');
    expect(station().attributes('aria-selected')).toBe('true');
    expect(locate).not.toHaveBeenCalled();
    expect(tool(wrapper, 'opacity').attributes('aria-disabled')).toBe('true');
    expect(tool(wrapper, 'legend').attributes('aria-disabled')).toBe('true');
    expect(wrapper.get('[data-roam="station"]').attributes('aria-disabled')).toBe('true');

    await tool(wrapper, 'move-up').trigger('click');
    expect(models.added.value).toStrictEqual(['station', 'white']);
    await station().trigger('keydown', { key: ' ' });
    expect(models.hidden.value).toStrictEqual(new Set(['station']));
    await station().trigger('keydown', { key: 'Delete' });
    expect(models.added.value).toStrictEqual(['white']);
    expect(selectedRow(wrapper)).toBe('model:white');
  });

  it('三维里模型组照常：选中模型时定位能用，交给拥有者飞过去（还没加载完的等加载完）', async () => {
    const { wrapper, models, map } = await mountPanel();
    models.add(['station']);
    map.setDimension('3d');
    await nextTick();
    const group = wrapper.get('[data-current-group="models"]');
    expect(group.text()).not.toContain('仅三维');
    const locate = vi.spyOn(models, 'locate');

    await wrapper.get('[data-current-row="model:station"]').trigger('click');
    await wrapper.get('[data-current-row="model:station"]').trigger('dblclick');
    expect(locate).toHaveBeenCalledExactlyOnceWith('station');
  });

  it('上下方向键跨组换选中：二维图层的最后一行往下是第一个模型', async () => {
    const { wrapper, models } = await mountPanel();
    models.add(['white']);
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await row(wrapper, 'bgdc_dltb').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedRow(wrapper)).toBe('model:white');
    await wrapper.get('[data-current-row="model:white"]').trigger('keydown', { key: 'ArrowUp' });
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
  });

  it('模型清单读不到时目录最后提示，可以重试', async () => {
    const { wrapper, onRetryModels } = await mountPanel({ modelsStatus: 'failed' });
    const failed = wrapper.get('[data-models-failed]');
    expect(failed.text()).toContain('三维模型清单加载失败');
    await failed.get('button').trigger('click');
    expect(onRetryModels).toHaveBeenCalledOnce();
  });

  it('请求状态（ADR 0158）：加载超过 0.4 秒的二维图层行内转圈；明细里点了一行，在当前图层里选中它', async () => {
    const { wrapper, models, loadingKeys, reveal } = await mountPanel();
    models.add(['white']);
    await nextTick();
    expect(row(wrapper, 'bgdc_dltb').find('[aria-label="加载中"]').exists()).toBe(false);

    loadingKeys.value = new Set(['resource:bgdc_dltb']);
    await nextTick();
    expect(row(wrapper, 'bgdc_dltb').find('[aria-label="加载中"]').exists()).toBe(true);

    reveal.value = { key: 'model:white' };
    await nextTick();
    expect(selectedRow(wrapper)).toBe('model:white');
    await row(wrapper, 'bgdc_dltb').trigger('click');
    reveal.value = { key: 'model:white' };
    await nextTick();
    expect(selectedRow(wrapper)).toBe('model:white');
  });

  it('行尾的年份（ADR 0052）：多年份的是不带箭头的小下拉，新的在前，只改这一个资源', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    const select = row(wrapper, 'csxhjctb_hydl').getComponent(ElSelect);

    expect(select.classes()).toEqual(expect.arrayContaining(['select-no-arrow', 'select-compact']));
    expect(select.props('modelValue')).toBe(2024);
    expect(select.findAllComponents(ElOption).map(option => option.props('value'))).toStrictEqual([2024, 2023]);
    select.vm.$emit('update:modelValue', 2023);
    await nextTick();
    expect(owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
    expect(owner.state.value.displays.get('bgdc_dltb')?.year).toBe(2024);
  });

  it('键盘的 Delete 移除以后焦点到新选中的行；选中的行在收起的组里时 Tab 落到第一行（2026-11-14 审查发现）', async () => {
    const { wrapper, owner, models } = await mountPanel();
    owner.add(['bgdc_cjdcq']);
    models.add(['white']);
    await nextTick();
    await row(wrapper, 'bgdc_cjdcq').trigger('click');
    wrapper.get<HTMLElement>('[data-current-row="resource:bgdc_cjdcq"]').element.focus();
    await row(wrapper, 'bgdc_cjdcq').trigger('keydown', { key: 'Delete' });
    await nextTick();
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
    expect(document.activeElement).toBe(row(wrapper, 'bgdc_dltb').element);

    // 选中的模型所在的组收起：二维图层的第一行能用 Tab 进入
    await wrapper.get('[data-current-row="model:white"]').trigger('click');
    await wrapper.get('[data-current-group="models"] button[aria-expanded]').trigger('click');
    expect(wrapper.find('[data-current-row="model:white"]').exists()).toBe(false);
    expect(row(wrapper, 'bgdc_dltb').attributes('tabindex')).toBe('0');
  });

  it('右侧图例开始编辑图例浮层正开着的同一个资源时，图例浮层关掉，后打开编辑的一方为准（2026-11-14 审查发现）', async () => {
    const { wrapper, legendYield } = await mountPanel();
    await row(wrapper, 'bgdc_dltb').get('[data-row-symbol]').trigger('click');
    expect(popover()).not.toBeNull();

    legendYield.value = 'bgdc_cjdcq';
    await nextTick();
    expect(popover()).not.toBeNull();
    legendYield.value = 'bgdc_dltb';
    await nextTick();
    expect(popover()).toBeNull();
  });

  it('只有二维图层或只有三维模型时不显示组标题，行照常显示；两组都有时才有标题（用户 2026-11-15）', async () => {
    const { wrapper, owner, models } = await mountPanel();
    expect(wrapper.find('[data-current-group="layers"] button[aria-expanded]').exists()).toBe(false);
    expect(wrapper.find('[data-current-row="resource:bgdc_dltb"]').exists()).toBe(true);

    models.add(['white']);
    await nextTick();
    expect(wrapper.findAll('[data-current-group] > button[aria-expanded]')).toHaveLength(2);

    owner.remove(['bgdc_dltb']);
    await nextTick();
    expect(wrapper.find('[data-current-group="models"] > button[aria-expanded]').exists()).toBe(false);
    expect(wrapper.find('[data-current-row="model:white"]').exists()).toBe(true);
  });

  it('目录里右键分类：菜单作用于它下面的项，没有定位；分类不能选中（用户 2026-11-15）', async () => {
    const { wrapper, owner } = await mountPanel();
    await tool(wrapper, 'expand-all').trigger('click');
    // 土地资源这个分类的行
    const land = () =>
      required(
        wrapper.findAll('[data-catalog-node]').find(item => item.text().startsWith('土地资源')),
        '土地资源'
      );
    await land().trigger('contextmenu');
    const items = [...document.querySelectorAll<HTMLButtonElement>('[data-menu-item]')];
    expect(items.map(item => item.getAttribute('data-menu-item'))).toStrictEqual(['add', 'remove']);
    expect(items[0]?.textContent).toContain('添加 2 项');

    items[0]?.click();
    await nextTick();
    expect(currentOrder(wrapper)).toEqual(expect.arrayContaining(['bgdc_cjdcq', 'csxhjctb_hydl', 'bgdc_dltb']));
    expect(land().attributes('aria-selected')).toBeUndefined();
    expect(owner.state.value.displays.get('bgdc_cjdcq')?.added).toBe(true);
  });

  describe('三维里先体现三维模型（用户 2026-11-15 选的方案乙，标题后面的"全部、模型、资源"是方案一）', () => {
    it('二维默认"全部"、模型在最后；进入三维是"模型"，各市展开、能按类型筛选；三维里的"全部"模型在最上面；回到二维又是"全部"', async () => {
      const { wrapper, map } = await mountPanel();
      expect(wrapper.findAll('[data-catalog-view]').map(item => item.text())).toStrictEqual(['全部', '模型', '资源']);
      expect(shownView(wrapper)).toBe('全部');
      expect(catalogKeys(wrapper).at(-1)).toBe('model-root');

      map.setDimension('3d');
      await nextTick();
      expect(shownView(wrapper)).toBe('模型');
      expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500', 'model:station', 'model:white']);
      expect(wrapper.find('input[placeholder="搜索模型或城市"]').exists()).toBe(true);
      // 类型只列清单里有的；"筛选年份"的位置换成类型
      const kinds = wrapper.getComponent(ModelKindSelect).getComponent(ElSelect);
      expect(kinds.findAllComponents(ElOption).map(option => option.props('label'))).toStrictEqual([
        '全部类型',
        '白膜',
        '室内'
      ]);
      kinds.vm.$emit('update:modelValue', 'white');
      await nextTick();
      expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500', 'model:white']);

      // 三维里的"全部"：三维模型分类在最上面，下面是二维的分类
      await showView(wrapper, 'all');
      expect(catalogKeys(wrapper)[0]).toBe('model-root');
      expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');

      // 只看资源：只有二维的分类，搜索框、筛选年份照旧
      await showView(wrapper, 'resources');
      expect(catalogKeys(wrapper).some(key => key?.startsWith('model'))).toBe(false);
      expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');
      expect(wrapper.find('input[placeholder="搜索资源"]').exists()).toBe(true);
      expect(wrapper.findComponent(ModelKindSelect).exists()).toBe(false);

      // 回到二维又是"全部"，不管三维里看的是什么；再进三维又是"模型"
      map.setDimension('2d');
      await nextTick();
      expect(shownView(wrapper)).toBe('全部');
      expect(catalogKeys(wrapper).at(-1)).toBe('model-root');

      await showView(wrapper, 'resources');
      map.setDimension('3d');
      await nextTick();
      expect(shownView(wrapper)).toBe('模型');
    });

    it('只看模型或资源时搜索只搜这一项，另一项也有匹配时在列表下面提示，点了切过去；"全部"不提示；换了以后看不见的项不再算选中', async () => {
      const { wrapper, map } = await mountPanel();
      map.setDimension('3d');
      await nextTick();
      await wrapper.get('[data-catalog-node="model:white"]').trigger('click');
      expect(tool(wrapper, 'add').attributes('aria-disabled')).toBe('false');
      await showView(wrapper, 'resources');
      expect(tool(wrapper, 'add').attributes('aria-disabled')).toBe('true');
      expect(wrapper.find('[data-other-view]').exists()).toBe(false);

      // 二维资源里没有"苏州"
      await wrapper.get('input[placeholder="搜索资源"]').setValue('苏州');
      expect(catalogKeys(wrapper)).toStrictEqual([]);
      expect(wrapper.text()).toContain('没有找到资源');
      expect(wrapper.find('[data-other-view]').exists()).toBe(true);
      const hint = wrapper.get('[data-other-view]');
      expect(hint.text()).toBe('三维模型里还有 2 项匹配');
      await hint.trigger('click');
      expect(shownView(wrapper)).toBe('模型');
      expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500', 'model:station', 'model:white']);
      expect(wrapper.find('[data-other-view]').exists()).toBe(false);

      await wrapper.get('input[placeholder="搜索模型或城市"]').setValue('地类');
      expect(wrapper.text()).toContain('没有找到模型');
      expect(wrapper.find('[data-other-view]').exists()).toBe(true);
      expect(wrapper.get('[data-other-view]').text()).toBe('二维资源里还有 1 项匹配');

      // "全部"搜全部，不提示：搜"苏州"时模型就在列表里
      await showView(wrapper, 'all');
      await wrapper.get('input[placeholder="搜索资源"]').setValue('苏州');
      expect(catalogKeys(wrapper)).toContain('model:white');
      expect(wrapper.find('[data-other-view]').exists()).toBe(false);
    });

    it('当前图层里三维模型组在上，方向键先走模型；回到二维换回来', async () => {
      const { wrapper, models, map } = await mountPanel();
      models.add(['white']);
      map.setDimension('3d');
      await nextTick();
      const groups = () => wrapper.findAll('[data-current-group]').map(group => group.attributes('data-current-group'));
      expect(groups()).toStrictEqual(['models', 'layers']);
      await wrapper.get('[data-current-row="model:white"]').trigger('click');
      await wrapper.get('[data-current-row="model:white"]').trigger('keydown', { key: 'ArrowDown' });
      expect(selectedRow(wrapper)).toBe('bgdc_dltb');
      await row(wrapper, 'bgdc_dltb').trigger('keydown', { key: 'ArrowUp' });
      expect(selectedRow(wrapper)).toBe('model:white');

      map.setDimension('2d');
      await nextTick();
      expect(groups()).toStrictEqual(['layers', 'models']);
    });

    it('模型清单读不到时，"模型""全部"里提示失败，只看资源时不提示', async () => {
      const { wrapper, map } = await mountPanel({ modelsStatus: 'failed' });
      map.setDimension('3d');
      await nextTick();
      expect(wrapper.find('[data-models-failed]').exists()).toBe(true);
      await showView(wrapper, 'resources');
      expect(wrapper.find('[data-models-failed]').exists()).toBe(false);
      await showView(wrapper, 'all');
      expect(wrapper.find('[data-models-failed]').exists()).toBe(true);
    });
  });
});
