import type { CameraState, SceneStatus } from '@mx/map-core';
import { type MapContext, provideMap } from '@mx/map-vue';
import { type DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { ElOption, ElSelect } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, effectScope, nextTick, shallowRef, watchEffect } from 'vue';
import type { ResourceTreeCategory } from '@/features/resource-map/api';
import { buildCatalog, type ResourceCatalog } from '@/features/resource-map/catalog';
import { type ResourceLayers, useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { sceneManifestSchema } from '@/features/scene-models/api';
import { buildModelCatalog } from '@/features/scene-models/catalog';
import { ModelKindSelect } from '@/features/scene-models/components/ModelKindSelect';
import { type SceneModels, useSceneModels } from '@/features/scene-models/composables/useSceneModels';
import { LAYER_HINTS, type LayerHint } from '@/shared/config/layer-hints';
import { ALL_REQUEST_KINDS } from '@/shared/map/request-status/request-status';
import type { RequestStatus } from '@/shared/map/request-status/useRequestStatus';
import { required } from '@/shared/testing/required';
import { LayerPopover } from '@/shared/map/layer-panel/LayerPopover';
import { CurrentMapLayerPanel } from './CurrentMapLayerPanel';
import { type CurrentLayers, useCurrentLayers } from './useCurrentLayers';

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

// 页面创建地图和拥有者，渲染面板；没有画布，只看面板和拥有者的状态。模型的状态报告由用例给；
// 资源目录可以先不到（status 是页面给的查询状态，catalog 由用例在之后给）
async function mountPanel({
  modelsStatus = 'ready',
  status = 'ready',
  catalogReady = true,
  hints = new Set(LAYER_HINTS)
}: {
  modelsStatus?: 'ready' | 'failed';
  status?: 'ready' | 'loading' | 'failed';
  catalogReady?: boolean;
  hints?: ReadonlySet<LayerHint>;
} = {}) {
  let owner: ResourceLayers | undefined;
  let models: SceneModels | undefined;
  let current: CurrentLayers | undefined;
  let context: MapContext | undefined;
  const legendCodes: (string | null)[] = [];
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const onRetryModels = vi.fn<() => void>();
  const onRetry = vi.fn<() => void>();
  const catalog = shallowRef<ResourceCatalog | undefined>(catalogReady ? CATALOG : undefined);
  const catalogStatus = shallowRef(status);
  // 请求状态只用到行内转圈、失败的集合；页面在明细里点了一行时换一个新对象
  const loadingKeys = shallowRef<ReadonlySet<string>>(new Set());
  const failedKeys = shallowRef<ReadonlySet<string>>(new Set());
  const requests: RequestStatus = {
    items: computed(() => []),
    now: shallowRef(0),
    display: shallowRef(null),
    loadingKeys: computed(() => loadingKeys.value),
    failedKeys: computed(() => failedKeys.value),
    kinds: computed(() => ALL_REQUEST_KINDS)
  };
  const reveal = shallowRef<{ readonly key: string } | null>(null);
  const legendYield = shallowRef<string | null>(null);
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(map, { catalog, symbols, tileBase: 'http://localhost/tiles/' });
    const layout = useResourcePanelLayout();
    const sceneModels = useSceneModels({ ...map, sceneStatus }, MODELS);
    const list = useCurrentLayers(layers, sceneModels);
    owner = layers;
    models = sceneModels;
    current = list;
    context = map;
    return () => (
      <CurrentMapLayerPanel
        resources={layers}
        current={list}
        symbols={symbols}
        layout={layout}
        models={sceneModels}
        modelsStatus={modelsStatus}
        status={catalogStatus.value}
        onRetry={onRetry}
        requests={requests}
        hints={hints}
        reveal={reveal.value}
        legendYield={legendYield.value}
        onLegendCode={(code: string | null) => legendCodes.push(code)}
        onRetryModels={onRetryModels}
      />
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  await nextTick();
  if (!owner || !models || !current || !context) {
    throw new Error('页面没有创建拥有者');
  }
  return {
    wrapper,
    owner,
    models,
    current,
    map: context,
    sceneStatus,
    legendCodes,
    onRetryModels,
    onRetry,
    catalog,
    catalogStatus,
    loadingKeys,
    failedKeys,
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
// 图例浮层：标题上的样式设置，显示的是浏览、单项编辑还是整层的配置（整层的才有配色方式）
const layerPopover = () => required(popover(), '图例浮层');
const settingsButton = () =>
  required(layerPopover().querySelector<HTMLButtonElement>('button[aria-label="样式设置"]'), '样式设置');
const legendShown = () => ({
  pressed: settingsButton().getAttribute('aria-pressed'),
  browsing: layerPopover().querySelector('[data-layer-legend]') !== null,
  settings: layerPopover().querySelector('[data-legend-settings]') !== null,
  wholeLayer: layerPopover().querySelector('[aria-label="图层配色方式"]') !== null
});
// 右键菜单里的定位；焦点在不在右键菜单里
const locateItem = () => document.querySelector<HTMLButtonElement>('[data-menu-item="locate"]');
const menuItem = (key: string) =>
  required(document.querySelector<HTMLButtonElement>(`[data-menu-item="${key}"]`), `菜单项 ${key}`);
const menuHasFocus = () => Boolean(document.activeElement?.closest('[data-panel-menu]'));
const roamItem = () => required(document.querySelector<HTMLButtonElement>('[data-menu-item="roam"]'), '漫游');
// 目录显示的内容（用户 2026-11-15，2026-11-16 改成搜索行下面带数量的标签）：显示着的节点、选中的标签、
// 各标签的读屏名称（名称和数量）、点某个标签
const catalogKeys = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-catalog-node]').map(item => item.attributes('data-catalog-node'));
const shownView = (wrapper: VueWrapper) =>
  wrapper.get('[data-catalog-view][aria-selected="true"]').attributes('data-catalog-view');
const viewTabs = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-catalog-view]').map(item => item.attributes('aria-label'));
async function showView(wrapper: VueWrapper, view: 'all' | 'models' | 'resources') {
  await wrapper.get(`[data-catalog-view="${view}"]`).trigger('click');
}
// 图层（下段）的标签（ADR 0161）：三维里才有
const layerTabs = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-current-view]').map(item => item.attributes('aria-label'));
async function showLayers(wrapper: VueWrapper, view: 'all' | 'models' | 'resources') {
  await wrapper.get(`[data-current-view="${view}"]`).trigger('click');
}
// 图层里全部的行（资源、模型的键）
const rowKeys = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-current-row]').map(item => item.attributes('data-current-row'));
const coverOf = (wrapper: VueWrapper, code: string) => row(wrapper, code).find('[data-row-cover]').exists();
// 行内提示（ADR 0167）：同一份状态，模型加载失败、地类图斑盖住模型、这一轮有瓦片失败；看哪几样显示着
async function arrangeHints(hints?: ReadonlySet<LayerHint>) {
  const panel = await mountPanel(hints ? { hints } : {});
  panel.models.add(['white']);
  panel.map.setDimension('3d');
  panel.sceneStatus.value = new Map([['white/plain', { state: 'failed', error: new Error('404') }]]);
  await row(panel.wrapper, 'bgdc_dltb').trigger('click');
  await tool(panel.wrapper, 'move-top').trigger('click');
  panel.failedKeys.value = new Set(['resource:bgdc_dltb']);
  await nextTick();
  return panel.wrapper;
}
// 失败模型的右键菜单里有没有"重新加载"；看完按 Esc 关上
async function retryInMenu(wrapper: VueWrapper) {
  await wrapper.get('[data-current-row="model:white"]').trigger('contextmenu');
  const shown = document.querySelector('[data-menu-item="retry"]') !== null;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  return shown;
}
const hintsShown = (wrapper: VueWrapper) => [
  row(wrapper, 'bgdc_dltb').find('[data-status="tile-error"]').exists(),
  wrapper.get('[data-current-row="model:white"]').find('[aria-label="加载失败"]').exists(),
  wrapper.get('[data-current-row="model:white"]').text().includes('重试'),
  coverOf(wrapper, 'bgdc_dltb')
];
// 鼠标点一下：jsdom 按下鼠标时不移动焦点，这里照浏览器的做法，按下没被 preventDefault 时聚焦最近的可聚焦祖先
async function press(target: Pick<DOMWrapper<Element>, 'element' | 'trigger'>) {
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  target.element.dispatchEvent(down);
  if (!down.defaultPrevented) {
    target.element.closest<HTMLElement>('[tabindex]')?.focus();
  }
  await target.trigger('click');
}
// 鼠标点行里能聚焦的图标，再对有焦点的元素按 Delete：选中的行、焦点是否在这一行上、这一行是否被移除
async function pressRowIcon(wrapper: VueWrapper, key: string, icon: string) {
  const target = wrapper.get(`[data-current-row="${key}"]`);
  await press(target.get(icon));
  const selected = wrapper.get('[data-current-row][aria-selected="true"]').attributes('data-current-row');
  const focused = document.activeElement === target.element;
  required(document.activeElement, '有焦点的元素').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
  );
  await nextTick();
  return { selected, focused, removed: !rowKeys(wrapper).includes(key) };
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

  it('标注（ADR 0160）：工具栏第 8 个按钮、右键菜单的"标注…"打开第三种浮层；菜单直接显示、隐藏标注', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    await row(wrapper, 'csxhjctb_hydl').trigger('click');

    await tool(wrapper, 'label').trigger('click');
    expect(popover()?.getAttribute('aria-label')).toBe('水域线层的标注');
    expect(tool(wrapper, 'label').attributes('aria-pressed')).toBe('true');
    expect(popover()?.querySelector('[data-label-editor="csxhjctb_hydl"]')).not.toBeNull();
    await tool(wrapper, 'label').trigger('click');
    expect(popover()).toBeNull();

    await row(wrapper, 'csxhjctb_hydl').trigger('contextmenu');
    expect(menuItem('label-visible').textContent).toContain('显示标注');
    menuItem('label-visible').click();
    await nextTick();
    expect(owner.state.value.displays.get('csxhjctb_hydl')?.labeled).toBe(true);
    expect(popover()).toBeNull();

    await row(wrapper, 'bgdc_dltb').trigger('contextmenu');
    expect(menuItem('label-visible').textContent).toContain('显示标注');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    await row(wrapper, 'csxhjctb_hydl').trigger('contextmenu');
    expect(menuItem('label-visible').textContent).toContain('隐藏标注');
    menuItem('label').click();
    await nextTick();
    expect(selectedRow(wrapper)).toBe('csxhjctb_hydl');
    expect(popover()?.getAttribute('aria-label')).toBe('水域线层的标注');
  });

  it('换选中的行时浮层跟着换；隐藏的行仍在图层里，复选框不改选中', async () => {
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

  it('双击目录里已添加的资源：在图层里选中并闪一下；没添加的不动', async () => {
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

  it('右键图层的一行：先选中它，菜单里能隐藏、移动和移除', async () => {
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
      'label-visible',
      'label',
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

  it('三维模型在目录最后、按市分组；加入后和资源平铺：后加入的整批在最上面、批内按目录的先后，选中最上面的新行（ADR 0167）', async () => {
    const { wrapper, models, owner } = await mountPanel();
    await tool(wrapper, 'expand-all').trigger('click');
    const keys = wrapper.findAll('[data-catalog-node]').map(item => item.attributes('data-catalog-node'));
    expect(keys.slice(-4)).toStrictEqual(['model-root', 'model-city:320500', 'model:station', 'model:white']);
    expect(wrapper.get('[data-catalog-node="model:white"]').text()).toContain('白膜');

    await node(wrapper, 'csxhjctb_lrdl').trigger('click');
    await wrapper.get('[data-catalog-node="model:white"]').trigger('click', { ctrlKey: true });
    await tool(wrapper, 'add').trigger('click');
    expect(models.added.value).toStrictEqual(['white']);
    // 没有组，一个列表
    expect(wrapper.findAll('[role="listbox"]')).toHaveLength(1);
    expect(rowKeys(wrapper)).toStrictEqual(['resource:csxhjctb_lrdl', 'model:white', 'resource:bgdc_dltb']);
    expect(selectedRow(wrapper)).toBe('csxhjctb_lrdl');

    // 地类图斑置顶以后再加资源：新加的在最上面（用户 2026-11-17）
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'move-top').trigger('click');
    await node(wrapper, 'bgdc_cjdcq').trigger('click');
    await tool(wrapper, 'add').trigger('click');
    expect(rowKeys(wrapper)).toStrictEqual([
      'resource:bgdc_cjdcq',
      'resource:bgdc_dltb',
      'resource:csxhjctb_lrdl',
      'model:white'
    ]);
    // 资源的拥有者里也是这个先后，地图按它画
    expect(owner.state.value.order.slice(0, 3)).toStrictEqual(['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_lrdl']);
    expect(selectedRow(wrapper)).toBe('bgdc_cjdcq');
  });

  it('二维里模型行留在原位、变淡，悬停说明"切换到三维后显示"，不写"仅三维"：不能定位、不能漫游，没有透明度和图例；勾选、移动、移除照常', async () => {
    const { wrapper, models, current } = await mountPanel();
    current.add(['model:white', 'model:station']);
    await nextTick();
    expect(rowKeys(wrapper)).toStrictEqual(['model:white', 'model:station', 'resource:bgdc_dltb']);
    const station = () => wrapper.get('[data-current-row="model:station"]');
    expect(station().classes().join(' ')).toMatch(/dimmed/);
    expect(row(wrapper, 'bgdc_dltb').classes().join(' ')).not.toMatch(/dimmed/);
    expect(station().get('[data-row-text]').attributes('data-row-hint')).toBe('切换到三维后显示');
    expect(wrapper.text()).not.toContain('仅三维');

    const locate = vi.spyOn(models, 'locate');
    await station().trigger('click');
    await station().trigger('dblclick');
    expect(station().attributes('aria-selected')).toBe('true');
    expect(locate).not.toHaveBeenCalled();
    expect(tool(wrapper, 'opacity').attributes('aria-disabled')).toBe('true');
    expect(tool(wrapper, 'legend').attributes('aria-disabled')).toBe('true');
    expect(tool(wrapper, 'label').attributes('aria-disabled')).toBe('true');
    expect(wrapper.get('[data-roam="station"]').attributes('aria-disabled')).toBe('true');

    await tool(wrapper, 'move-up').trigger('click');
    expect(models.added.value).toStrictEqual(['station', 'white']);
    await station().trigger('keydown', { key: ' ' });
    expect(models.hidden.value).toStrictEqual(new Set(['station']));
    await station().trigger('keydown', { key: 'Delete' });
    expect(models.added.value).toStrictEqual(['white']);
    expect(selectedRow(wrapper)).toBe('model:white');
  });

  it('资源目录读不到时三维模型照常：三维里"模型"能搜索、筛选、加入；"全部"在资源的位置说明失败、能重试；"资源"整段说明（2026-11-15 审查发现）；读不到的期间"全部""二维资源"不写数量', async () => {
    const { wrapper, map, models, onRetry, catalog, catalogStatus } = await mountPanel({
      status: 'failed',
      catalogReady: false
    });
    map.setDimension('3d');
    await nextTick();
    expect(wrapper.text()).not.toContain('资源加载失败');
    expect(viewTabs(wrapper)).toStrictEqual(['全部', '二维资源', '三维模型 2 项']);
    expect(wrapper.find('input[placeholder="搜索模型或城市"]').exists()).toBe(true);
    expect(wrapper.findComponent(ModelKindSelect).exists()).toBe(true);
    await wrapper.get('[data-catalog-node="model:white"]').trigger('click');
    await tool(wrapper, 'add').trigger('click');
    expect(models.added.value).toStrictEqual(['white']);
    expect(wrapper.find('[data-current-row="model:white"]').exists()).toBe(true);

    // "全部"：模型照常列出，资源的失败在模型后面一行，可以重试
    await showView(wrapper, 'all');
    expect(catalogKeys(wrapper)[0]).toBe('model-root');
    expect(wrapper.find('[data-resources-status]').exists()).toBe(true);
    const notice = wrapper.get('[data-resources-status]');
    expect(notice.text()).toContain('资源加载失败');
    await notice.get('button').trigger('click');
    expect(onRetry).toHaveBeenCalledOnce();

    // "资源"：整段是失败和重试，搜索框还在
    await showView(wrapper, 'resources');
    expect(wrapper.get('[data-panel-section="catalog"]').text()).toContain('资源加载失败');
    expect(wrapper.find('input[placeholder="搜索资源"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('资源目录');

    // 目录到了：照常列出资源，没有说明，三项都有数量
    catalogStatus.value = 'ready';
    catalog.value = CATALOG;
    await nextTick();
    expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');
    expect(viewTabs(wrapper)).toStrictEqual(['全部 6 项', '二维资源 4 项', '三维模型 2 项']);
    await showView(wrapper, 'all');
    expect(wrapper.find('[data-resources-status]').exists()).toBe(false);
  });

  it('二维里资源目录还没到时，"全部"先说明正在加载，后面照常列出三维模型；"全部""二维资源"不写数量', async () => {
    const { wrapper } = await mountPanel({ status: 'loading', catalogReady: false });
    expect(wrapper.find('[data-resources-status]').exists()).toBe(true);
    expect(wrapper.get('[data-resources-status]').text()).toBe('正在加载资源…');
    expect(viewTabs(wrapper)).toStrictEqual(['全部', '二维资源', '三维模型 2 项']);
    expect(catalogKeys(wrapper)).toStrictEqual(['model-root']);
    const section = wrapper.get('[data-panel-section="catalog"]').element;
    const status = wrapper.get('[data-resources-status]').element;
    const root = wrapper.get('[data-catalog-node="model-root"]').element;
    expect(section.contains(status) && status.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('展开不被整份换掉：资源目录晚于模型清单到时各市仍展开；在一种显示内容里全部展开、全部收起不动别的（2026-11-15 审查发现）', async () => {
    const { wrapper, map, catalog, catalogStatus } = await mountPanel({ status: 'loading', catalogReady: false });
    map.setDimension('3d');
    await nextTick();
    expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500', 'model:station', 'model:white']);
    catalogStatus.value = 'ready';
    catalog.value = CATALOG;
    await nextTick();
    expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500', 'model:station', 'model:white']);

    // 资源里地类图斑所在的分类默认展开；在"模型"里全部收起，回到"资源"它还展开着
    await showView(wrapper, 'resources');
    expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');
    await showView(wrapper, 'models');
    await tool(wrapper, 'collapse-all').trigger('click');
    expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500']);
    await showView(wrapper, 'resources');
    expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');

    // 在"资源"里全部展开，"模型"里收起的市不跟着展开
    await tool(wrapper, 'expand-all').trigger('click');
    await showView(wrapper, 'models');
    expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500']);
  });

  it('在"模型"里全部展开，"资源"里原来展开的分类仍然展开（2026-11-15 核对发现）', async () => {
    const { wrapper, map } = await mountPanel();
    map.setDimension('3d');
    await nextTick();
    await showView(wrapper, 'resources');
    expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');

    await showView(wrapper, 'models');
    await tool(wrapper, 'expand-all').trigger('click');
    await showView(wrapper, 'resources');
    expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');
  });

  it('三维里模型行照常：不变淡，选中模型时定位能用，交给拥有者飞过去（还没加载完的等加载完）', async () => {
    const { wrapper, models, map } = await mountPanel();
    models.add(['station']);
    map.setDimension('3d');
    await nextTick();
    const station = wrapper.get('[data-current-row="model:station"]');
    expect(station.classes().join(' ')).not.toMatch(/dimmed/);
    expect(station.find('[data-row-hint]').exists()).toBe(false);
    const locate = vi.spyOn(models, 'locate');

    await wrapper.get('[data-current-row="model:station"]').trigger('click');
    await wrapper.get('[data-current-row="model:station"]').trigger('dblclick');
    expect(locate).toHaveBeenCalledExactlyOnceWith('station');
  });

  it('上下方向键在资源和模型之间换选中：一个列表，到头时不动', async () => {
    const { wrapper, models } = await mountPanel();
    models.add(['white']);
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await row(wrapper, 'bgdc_dltb').trigger('keydown', { key: 'ArrowUp' });
    expect(selectedRow(wrapper)).toBe('model:white');
    await wrapper.get('[data-current-row="model:white"]').trigger('keydown', { key: 'ArrowUp' });
    expect(selectedRow(wrapper)).toBe('model:white');
    await wrapper.get('[data-current-row="model:white"]').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
  });

  it('模型清单读不到时目录最后提示，可以重试', async () => {
    const { wrapper, onRetryModels } = await mountPanel({ modelsStatus: 'failed' });
    const failed = wrapper.get('[data-models-failed]');
    expect(failed.text()).toContain('三维模型清单加载失败');
    await failed.get('button').trigger('click');
    expect(onRetryModels).toHaveBeenCalledOnce();
  });

  it('请求状态（ADR 0158）：加载超过 0.4 秒的二维图层行内转圈；明细里点了一行，在图层里选中它', async () => {
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

  it('请求状态（ADR 0162）：三维里模型行按 loadingKeys 转圈，集合里的键和行的键一样带 model: 前缀', async () => {
    const { wrapper, models, map, loadingKeys } = await mountPanel();
    models.add(['white']);
    map.setDimension('3d');
    await nextTick();
    const spinning = () => wrapper.get('[data-current-row="model:white"]').find('[aria-label="加载中"]').exists();
    // 模型还在读索引，请求状态还没说加载中（不到 0.4 秒）：不转圈
    expect(spinning()).toBe(false);

    loadingKeys.value = new Set(['model:white']);
    await nextTick();
    expect(spinning()).toBe(true);
    loadingKeys.value = new Set(['white']);
    await nextTick();
    expect(spinning()).toBe(false);
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

  it('键盘的 Delete 移除以后焦点到新选中的行；选中的行被筛掉时没有选中，Tab 落到看得见的第一行（2026-11-14 审查发现）', async () => {
    const { wrapper, owner, models, map } = await mountPanel();
    owner.add(['bgdc_cjdcq']);
    models.add(['white']);
    await nextTick();
    await row(wrapper, 'bgdc_cjdcq').trigger('click');
    wrapper.get<HTMLElement>('[data-current-row="resource:bgdc_cjdcq"]').element.focus();
    await row(wrapper, 'bgdc_cjdcq').trigger('keydown', { key: 'Delete' });
    await nextTick();
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
    expect(document.activeElement).toBe(row(wrapper, 'bgdc_dltb').element);

    // 选中的模型被筛掉：没有选中，二维资源的第一行能用 Tab 进入
    map.setDimension('3d');
    await nextTick();
    await wrapper.get('[data-current-row="model:white"]').trigger('click');
    await showLayers(wrapper, 'resources');
    expect(wrapper.find('[data-current-row="model:white"]').exists()).toBe(false);
    expect(selectedRow(wrapper)).toBeNull();
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

  it('三维里图层标题下面有"全部、二维资源、三维模型"的标签，带数量，默认"全部"；二维里没有，切换维度回到"全部"（ADR 0161）', async () => {
    const { wrapper, models, map } = await mountPanel();
    models.add(['white']);
    await nextTick();
    expect(layerTabs(wrapper)).toStrictEqual([]);

    map.setDimension('3d');
    await nextTick();
    expect(layerTabs(wrapper)).toStrictEqual(['全部 2 项', '二维资源 1 项', '三维模型 1 项']);
    expect(wrapper.get('[data-current-view][aria-selected="true"]').attributes('data-current-view')).toBe('all');
    expect(wrapper.get('[data-panel-section="current"] [role="tablist"]').attributes('aria-label')).toBe('图层显示的内容');

    await showLayers(wrapper, 'models');
    expect(rowKeys(wrapper)).toStrictEqual(['model:white']);
    await showLayers(wrapper, 'resources');
    expect(rowKeys(wrapper)).toStrictEqual(['resource:bgdc_dltb']);

    // 筛掉了全部的行：说明这一类没有
    models.remove(['white']);
    await showLayers(wrapper, 'models');
    expect(wrapper.get('[data-panel-section="current"]').text()).toContain('图层里没有三维模型');

    map.setDimension('2d');
    await nextTick();
    expect(layerTabs(wrapper)).toStrictEqual([]);
    map.setDimension('3d');
    await nextTick();
    expect(wrapper.get('[data-current-view][aria-selected="true"]').attributes('data-current-view')).toBe('all');
  });

  it('筛选时也能排序：按看得见的行算，上移放到越过的那一行正上方，被筛掉的行原地不动（ADR 0161）', async () => {
    const { wrapper, owner, current, map } = await mountPanel();
    owner.add(['bgdc_cjdcq', 'csxhjctb_hydl']);
    current.add(['model:white']);
    map.setDimension('3d');
    await nextTick();
    // 地类图斑挪到最上面：[地类图斑, 白膜, 村级调查区, 水域线层]
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'move-top').trigger('click');
    expect(rowKeys(wrapper)).toStrictEqual([
      'resource:bgdc_dltb',
      'model:white',
      'resource:bgdc_cjdcq',
      'resource:csxhjctb_hydl'
    ]);

    // 只看二维资源：水域线层上移一行，放到村级调查区的正上方，模型不动（按全部的行算会越过模型）
    await showLayers(wrapper, 'resources');
    await row(wrapper, 'csxhjctb_hydl').trigger('click');
    expect(tool(wrapper, 'move-down').attributes('aria-disabled')).toBe('true');
    await tool(wrapper, 'move-up').trigger('click');
    expect(rowKeys(wrapper)).toStrictEqual(['resource:bgdc_dltb', 'resource:csxhjctb_hydl', 'resource:bgdc_cjdcq']);
    await showLayers(wrapper, 'all');
    expect(rowKeys(wrapper)).toStrictEqual([
      'resource:bgdc_dltb',
      'model:white',
      'resource:csxhjctb_hydl',
      'resource:bgdc_cjdcq'
    ]);

    // Alt 加下移同样按看得见的行：地类图斑下移一行，放到水域线层的正下方，越过了模型
    await showLayers(wrapper, 'resources');
    await row(wrapper, 'bgdc_dltb').trigger('keydown', { key: 'ArrowDown', altKey: true });
    await showLayers(wrapper, 'all');
    expect(rowKeys(wrapper)).toStrictEqual([
      'model:white',
      'resource:csxhjctb_hydl',
      'resource:bgdc_dltb',
      'resource:bgdc_cjdcq'
    ]);
    // 资源的拥有者里也是这个先后
    expect(owner.state.value.order.slice(0, 3)).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']);
  });

  it('筛选着加入会被筛掉的行、在目录里定位筛掉的行：回到"全部"再选中（ADR 0161）', async () => {
    const { wrapper, models, map } = await mountPanel();
    map.setDimension('3d');
    await nextTick();
    await showLayers(wrapper, 'models');
    await showView(wrapper, 'resources');
    await tool(wrapper, 'expand-all').trigger('click');
    await node(wrapper, 'bgdc_cjdcq').trigger('click');
    await tool(wrapper, 'add').trigger('click');
    expect(wrapper.get('[data-current-view][aria-selected="true"]').attributes('data-current-view')).toBe('all');
    expect(selectedRow(wrapper)).toBe('bgdc_cjdcq');

    models.add(['white']);
    await showLayers(wrapper, 'models');
    await node(wrapper, 'bgdc_dltb').trigger('dblclick');
    expect(wrapper.get('[data-current-view][aria-selected="true"]').attributes('data-current-view')).toBe('all');
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
  });

  it('行内提示按部署的开关（.env）显示：关掉的一类在行内不显示；瓦片失败和数据加载用同一份（用户 2026-11-17，ADR 0167）', async () => {
    const all = await arrangeHints();
    expect(hintsShown(all)).toStrictEqual([true, true, true, true]);
    expect(await retryInMenu(all)).toBe(true);
    // 关掉加载失败、盖住模型：资源的失败图标、模型的失败和重试（行内和右键菜单）、盖住模型都不显示
    const off = new Set(LAYER_HINTS.filter(hint => hint !== 'failed' && hint !== 'covering'));
    const wrapper = await arrangeHints(off);
    expect(hintsShown(wrapper)).toStrictEqual([false, false, false, false]);
    expect(await retryInMenu(wrapper)).toBe(false);
  });

  it('三维里画在模型上面、接近不透明的面，名称后面一个"盖住模型"的图标，说明调低透明度（S4，ADR 0161）', async () => {
    const { wrapper, owner, models, map } = await mountPanel();
    owner.add(['bgdc_cjdcq', 'csxhjctb_hydl']);
    models.add(['white']);
    await nextTick();
    // [白膜, 村级调查区, 水域线层, 地类图斑]：都在模型下面
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'move-top').trigger('click');
    await row(wrapper, 'csxhjctb_hydl').trigger('click');
    await tool(wrapper, 'move-top').trigger('click');
    await row(wrapper, 'bgdc_cjdcq').trigger('click');
    await tool(wrapper, 'move-top').trigger('click');
    expect(rowKeys(wrapper)).toStrictEqual([
      'resource:bgdc_cjdcq',
      'resource:csxhjctb_hydl',
      'resource:bgdc_dltb',
      'model:white'
    ]);
    // 二维里不提示
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(false);

    map.setDimension('3d');
    await nextTick();
    // 地类图斑不透明：提示；线不算；村级调查区还没到最小显示级别（8 级）
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(true);
    // 只有图标（用户 2026-11-16），说明是它的读屏名称和提示
    const cover = row(wrapper, 'bgdc_dltb').get('[data-row-cover]');
    expect(cover.text()).toBe('');
    expect(cover.attributes('role')).toBe('img');
    expect(cover.attributes('aria-label')).toBe('盖住模型：调低透明度可以透出模型');
    expect(coverOf(wrapper, 'csxhjctb_hydl')).toBe(false);
    expect(coverOf(wrapper, 'bgdc_cjdcq')).toBe(false);

    // 有效不透明度低于 0.8、隐藏、模型都隐藏着、挪到模型下面时不提示
    owner.setOpacity('bgdc_dltb', 0.7);
    await nextTick();
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(false);
    owner.setOpacity('bgdc_dltb', 0.8);
    await nextTick();
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(true);
    models.setVisible('white', false);
    await nextTick();
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(false);
    models.setVisible('white', true);
    owner.setVisible('bgdc_dltb', false);
    await nextTick();
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(false);
    owner.setVisible('bgdc_dltb', true);
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'move-bottom').trigger('click');
    expect(coverOf(wrapper, 'bgdc_dltb')).toBe(false);
  });

  it('"盖住模型"的图标：键盘能聚焦，聚焦时显示说明（用户 2026-11-16）', async () => {
    const { wrapper, models, map } = await mountPanel();
    models.add(['white']);
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'move-top').trigger('click');
    map.setDimension('3d');
    await nextTick();
    expect(document.body.textContent).not.toContain('调低透明度可以透出模型');

    const cover = row(wrapper, 'bgdc_dltb').get('[data-row-cover]');
    expect(cover.attributes('tabindex')).toBe('0');
    await cover.trigger('focus');

    await vi.waitFor(() => expect(document.body.textContent).toContain('盖住模型：调低透明度可以透出模型'));
  });

  // 行里能聚焦的图标只在 Tab 进来时得到焦点：鼠标点了以后这一行被选中、焦点在行上，行的键盘操作照常（按 Delete 移除）
  describe('鼠标点行里能聚焦的图标，焦点落在这一行', () => {
    it('"盖住模型"的图标', async () => {
      const { wrapper, models, map } = await mountPanel();
      models.add(['white']);
      await nextTick();
      await row(wrapper, 'bgdc_dltb').trigger('click');
      await tool(wrapper, 'move-top').trigger('click');
      map.setDimension('3d');
      await nextTick();
      await wrapper.get('[data-current-row="model:white"]').trigger('click');

      expect(await pressRowIcon(wrapper, 'resource:bgdc_dltb', '[data-row-cover]')).toStrictEqual({
        selected: 'resource:bgdc_dltb',
        focused: true,
        removed: true
      });
    });

    it('状态图标（没到最小显示级别的放大镜）', async () => {
      const { wrapper, owner } = await mountPanel();
      // 村级调查区 8 级起，面板在 7 级
      owner.add(['bgdc_cjdcq']);
      await nextTick();
      await row(wrapper, 'bgdc_dltb').trigger('click');

      expect(await pressRowIcon(wrapper, 'resource:bgdc_cjdcq', '[data-status="minzoom"]')).toStrictEqual({
        selected: 'resource:bgdc_cjdcq',
        focused: true,
        removed: true
      });
    });

    it('模型加载失败的图标', async () => {
      const { wrapper, models, map, sceneStatus } = await mountPanel();
      models.add(['white']);
      map.setDimension('3d');
      sceneStatus.value = new Map([['white/plain', { state: 'failed', error: new Error('404') }]]);
      await nextTick();
      await row(wrapper, 'bgdc_dltb').trigger('click');

      expect(await pressRowIcon(wrapper, 'model:white', 'span[aria-label="加载失败"]')).toStrictEqual({
        selected: 'model:white',
        focused: true,
        removed: true
      });
    });
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

  it('二维里图层只剩三维模型时，列表上面一行说明；有二维资源、三维里没有这一行（2026-11-15 审查发现，2026-11-16 改成平铺）', async () => {
    const { wrapper, owner, models, map } = await mountPanel();
    models.add(['white']);
    await nextTick();
    expect(wrapper.find('[data-list-note]').exists()).toBe(false);
    owner.remove(['bgdc_dltb']);
    await nextTick();
    expect(wrapper.get('[data-list-note]').text()).toBe('三维模型切换到三维模式后显示');

    map.setDimension('3d');
    await nextTick();
    expect(wrapper.find('[data-list-note]').exists()).toBe(false);
  });

  it('右键菜单里不能用的定位写出原因：二维里的模型"切换到三维后可用"，到了可见级别的二维图层"已在可见级别"（2026-11-15 审查发现）', async () => {
    const { wrapper, models } = await mountPanel();
    models.add(['white']);
    await nextTick();
    await wrapper.get('[data-current-row="model:white"]').trigger('contextmenu');
    expect(required(locateItem(), '定位').disabled).toBe(true);
    expect(locateItem()?.textContent).toContain('切换到三维后可用');
    expect(locateItem()?.textContent).not.toContain('双击');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('contextmenu');
    expect(locateItem()?.textContent).toContain('已在可见级别');
  });

  it('键盘打开的右键菜单关闭、执行以后焦点回到行上；移除了这一行时到新选中的行（2026-11-15 审查发现）', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['bgdc_cjdcq']);
    await nextTick();
    const element = (code: string) => row(wrapper, code).element;
    const openMenu = async (code: string) => {
      await row(wrapper, code).trigger('click');
      wrapper.get<HTMLElement>(`[data-current-row="resource:${code}"]`).element.focus();
      await row(wrapper, code).trigger('keydown', { key: 'F10', shiftKey: true });
      await nextTick();
      await nextTick();
    };

    await openMenu('bgdc_cjdcq');
    expect(menuHasFocus()).toBe(true);
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(element('bgdc_cjdcq'));

    await openMenu('bgdc_cjdcq');
    const remove = required(document.querySelector<HTMLButtonElement>('[data-menu-item="remove"]'), '移除');
    remove.focus();
    remove.click();
    await nextTick();
    await nextTick();
    expect(selectedRow(wrapper)).toBe('bgdc_dltb');
    expect(document.activeElement).toBe(element('bgdc_dltb'));
  });

  it('没有选中时用键盘在一行上开菜单再关，焦点回到这一行；目录里同样回到打开菜单的那一项（2026-11-15 核对发现）', async () => {
    const { wrapper } = await mountPanel();
    const first = wrapper.get<HTMLElement>('[data-current-row="resource:bgdc_dltb"]');
    expect(selectedRow(wrapper)).toBeNull();
    first.element.focus();
    await first.trigger('keydown', { key: 'F10', shiftKey: true });
    await nextTick();
    await nextTick();
    expect(menuHasFocus()).toBe(true);
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(first.element);

    await tool(wrapper, 'expand-all').trigger('click');
    const leaf = wrapper.get<HTMLElement>('[data-catalog-node="resource:bgdc_cjdcq"]');
    leaf.element.focus();
    await leaf.trigger('keydown', { key: 'F10', shiftKey: true });
    await nextTick();
    await nextTick();
    expect(menuHasFocus()).toBe(true);
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(leaf.element);
  });

  it('页面里的浮层卸载时焦点在里面（点了浮层的关闭），还给选中的行（2026-11-15 核对发现）', async () => {
    const { wrapper } = await mountPanel();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'legend').trigger('click');
    const close = required(popover()?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]'), '浮层的关闭');
    close.focus();
    close.click();
    await nextTick();
    await nextTick();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(row(wrapper, 'bgdc_dltb').element);
  });

  it('右键菜单里不能用的漫游写出原因：二维里、隐藏着、还没加载完（2026-11-15 核对发现）', async () => {
    const { wrapper, models, map } = await mountPanel();
    models.add(['station']);
    await nextTick();
    const openMenu = async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();
      await wrapper.get('[data-current-row="model:station"]').trigger('contextmenu');
    };

    await openMenu();
    expect([roamItem().disabled, roamItem().textContent]).toStrictEqual([true, '漫游切换到三维后可用']);

    map.setDimension('3d');
    await nextTick();
    await openMenu();
    expect(roamItem().textContent).toBe('漫游加载完成后可用');

    models.setVisible('station', false);
    await nextTick();
    await openMenu();
    expect(roamItem().textContent).toBe('漫游显示后可用');
  });

  it('浮层的箭头对着选中的行；选中的行被筛掉时没有选中，浮层关闭', async () => {
    const { wrapper, models, map } = await mountPanel();
    models.add(['white']);
    map.setDimension('3d');
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'legend').trigger('click');
    const anchor = () => wrapper.getComponent(LayerPopover).props('anchor')();
    expect(anchor()).toBe(row(wrapper, 'bgdc_dltb').element);

    await showLayers(wrapper, 'models');
    expect(selectedRow(wrapper)).toBeNull();
    expect(popover()).toBeNull();
  });

  it('图例浮层里正在编辑一类时点标题上的样式设置：换成整层的配置，再点一次回到浏览（2026-11-14 审查发现）', async () => {
    const { wrapper } = await mountPanel();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'legend').trigger('click');

    required(layerPopover().querySelector<HTMLButtonElement>('[data-landuse] button'), '地类的条目').click();
    await nextTick();
    expect(legendShown()).toStrictEqual({ pressed: 'false', browsing: false, settings: true, wholeLayer: false });

    settingsButton().click();
    await nextTick();
    expect(legendShown()).toStrictEqual({ pressed: 'true', browsing: false, settings: true, wholeLayer: true });

    settingsButton().click();
    await nextTick();
    expect(legendShown()).toStrictEqual({ pressed: 'false', browsing: true, settings: false, wholeLayer: false });
  });

  it('选中的行上移、下移以后浮层重新放：箭头对着的元素读图层的顺序，元素不变也重新量（2026-11-14 审查发现）', async () => {
    const { wrapper, owner } = await mountPanel();
    owner.add(['bgdc_cjdcq']);
    await nextTick();
    await row(wrapper, 'bgdc_dltb').trigger('click');
    await tool(wrapper, 'legend').trigger('click');
    // 浮层按 anchor() 读到的响应式状态重新放，这里看同样的依赖
    const anchor = wrapper.getComponent(LayerPopover).props('anchor');
    const scope = effectScope();
    let reads = 0;
    scope.run(() => watchEffect(() => {
      anchor();
      reads++;
    }));
    reads = 0;

    await tool(wrapper, 'move-up').trigger('click');
    expect(currentOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq']);
    expect(reads).toBeGreaterThan(0);
    expect(anchor()).toBe(row(wrapper, 'bgdc_dltb').element);
    scope.stop();
  });

  describe('三维里先体现三维模型（用户 2026-11-15 选的方案乙；2026-11-16 选的丁：搜索行下面带数量的标签）', () => {
    it('标签依次是全部、二维资源、三维模型，带各自显示的项数（用户 2026-11-16）；二维默认"全部"、模型在最后；进入三维是"三维模型"，各市展开、能按类型筛选；三维里的"全部"模型在最上面；回到二维又是"全部"', async () => {
      const { wrapper, map } = await mountPanel();
      // 数量是叶子（资源、模型），不算分类
      expect(viewTabs(wrapper)).toStrictEqual(['全部 6 项', '二维资源 4 项', '三维模型 2 项']);
      expect(shownView(wrapper)).toBe('all');
      expect(catalogKeys(wrapper).at(-1)).toBe('model-root');
      expect(wrapper.find('input[placeholder="搜索资源"]').exists()).toBe(true);

      map.setDimension('3d');
      await nextTick();
      expect(shownView(wrapper)).toBe('models');
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
      // 类型筛选只在"三维模型"里起作用，数量跟着显示的项
      expect(viewTabs(wrapper)).toStrictEqual(['全部 6 项', '二维资源 4 项', '三维模型 1 项']);

      // 三维里的"全部"：三维模型分类在最上面，下面是二维的分类
      await showView(wrapper, 'all');
      expect(catalogKeys(wrapper)[0]).toBe('model-root');
      expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');
      expect(wrapper.find('input[placeholder="搜索资源"]').exists()).toBe(true);

      // 只看资源：只有二维的分类，搜索框、筛选年份照旧
      await showView(wrapper, 'resources');
      expect(catalogKeys(wrapper).some(key => key?.startsWith('model'))).toBe(false);
      expect(catalogKeys(wrapper)).toContain('resource:bgdc_dltb');
      expect(wrapper.find('input[placeholder="搜索资源"]').exists()).toBe(true);
      expect(wrapper.findComponent(ModelKindSelect).exists()).toBe(false);

      // 回到二维又是"全部"，不管三维里看的是什么；再进三维又是"三维模型"
      map.setDimension('2d');
      await nextTick();
      expect(shownView(wrapper)).toBe('all');
      expect(catalogKeys(wrapper).at(-1)).toBe('model-root');

      await showView(wrapper, 'resources');
      map.setDimension('3d');
      await nextTick();
      expect(shownView(wrapper)).toBe('models');
    });

    it('搜索时数量变成各项匹配的项数，列表下面不再有"还有 N 项匹配"的提示（用户 2026-11-16）；只看模型或资源时只搜这一项；换了以后看不见的项不再算选中', async () => {
      const { wrapper, map } = await mountPanel();
      map.setDimension('3d');
      await nextTick();
      await wrapper.get('[data-catalog-node="model:white"]').trigger('click');
      expect(tool(wrapper, 'add').attributes('aria-disabled')).toBe('false');
      await showView(wrapper, 'resources');
      expect(tool(wrapper, 'add').attributes('aria-disabled')).toBe('true');

      // 二维资源里没有"苏州"：标签上看得到三维模型里有 2 项
      await wrapper.get('input[placeholder="搜索资源"]').setValue('苏州');
      expect(catalogKeys(wrapper)).toStrictEqual([]);
      expect(wrapper.text()).toContain('没有找到资源');
      expect(viewTabs(wrapper)).toStrictEqual(['全部 2 项', '二维资源 0 项', '三维模型 2 项']);
      expect(wrapper.text()).not.toContain('项匹配');
      await showView(wrapper, 'models');
      expect(catalogKeys(wrapper)).toStrictEqual(['model-city:320500', 'model:station', 'model:white']);

      await wrapper.get('input[placeholder="搜索模型或城市"]').setValue('地类');
      expect(wrapper.text()).toContain('没有找到模型');
      expect(viewTabs(wrapper)).toStrictEqual(['全部 1 项', '二维资源 1 项', '三维模型 0 项']);
      expect(wrapper.text()).not.toContain('项匹配');

      // "全部"搜全部：搜"苏州"时模型就在列表里
      await showView(wrapper, 'all');
      await wrapper.get('input[placeholder="搜索资源"]').setValue('苏州');
      expect(catalogKeys(wrapper)).toContain('model:white');
      expect(viewTabs(wrapper)).toStrictEqual(['全部 2 项', '二维资源 0 项', '三维模型 2 项']);
    });

    it('两段叫"资源""图层"（用户 2026-11-16）：工具栏、目录树、右键菜单的读屏名称跟着改', async () => {
      const { wrapper } = await mountPanel();
      expect(wrapper.findAll('[role="toolbar"]').map(item => item.attributes('aria-label'))).toStrictEqual([
        '资源的操作',
        '图层的操作'
      ]);
      expect(wrapper.get('[role="tree"]').attributes('aria-label')).toBe('资源');
      expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('资源显示的内容');

      await node(wrapper, 'bgdc_dltb').trigger('contextmenu');
      expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('资源的菜单');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();
      await row(wrapper, 'bgdc_dltb').trigger('contextmenu');
      expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('图层的菜单');
    });

    it('图层的顺序就是叠放，不随维度变：二维、三维里一样（ADR 0161 取代方案乙的"模型组在上"）', async () => {
      const { wrapper, models, map } = await mountPanel();
      models.add(['white']);
      await nextTick();
      expect(rowKeys(wrapper)).toStrictEqual(['model:white', 'resource:bgdc_dltb']);
      map.setDimension('3d');
      await nextTick();
      expect(rowKeys(wrapper)).toStrictEqual(['model:white', 'resource:bgdc_dltb']);
    });

    it('模型清单读不到时，"三维模型""全部"里提示失败，只看资源时不提示；"全部""三维模型"不写数量', async () => {
      const { wrapper, map } = await mountPanel({ modelsStatus: 'failed' });
      map.setDimension('3d');
      await nextTick();
      expect(wrapper.find('[data-models-failed]').exists()).toBe(true);
      expect(viewTabs(wrapper)).toStrictEqual(['全部', '二维资源 4 项', '三维模型']);
      await showView(wrapper, 'resources');
      expect(wrapper.find('[data-models-failed]').exists()).toBe(false);
      await showView(wrapper, 'all');
      expect(wrapper.find('[data-models-failed]').exists()).toBe(true);
    });
  });
});
