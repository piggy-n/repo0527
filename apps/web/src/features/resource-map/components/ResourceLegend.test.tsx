import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { type DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { ElColorPicker } from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { ResourceLegend } from './ResourceLegend';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function layer(
  code: string,
  name: string,
  geoType: ResourceTreeLayer['geoType'],
  yearList: [number, ...number[]] = [2022]
) {
  return { code, name, geoType, yearList };
}

// 地类、按取值配色、统一符号各一个；只有地类图斑默认勾选
const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_dltb', '地类图斑', 'Polygon'),
      layer('csxhjctb_hydl', '水域线层', 'Line', [2023, 2024, 2025]),
      layer('szy_kt', '坑塘', 'Polygon')
    ]
  }
]);

function mountLegend() {
  let owner: ResourceLayers | undefined;
  let symbolsOwner: ResourceSymbols | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(map, { catalog, tileBase: 'http://localhost/tiles/', symbols });
    owner = layers;
    symbolsOwner = symbols;
    return () => <ResourceLegend layers={layers} symbols={symbols} />;
  });
  const wrapper = mount(Page);
  if (!owner || !symbolsOwner) {
    throw new Error('页面没有创建资源图层和符号的拥有者');
  }
  return { wrapper, owner, symbols: symbolsOwner };
}

function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

async function openLegend(wrapper: VueWrapper) {
  await wrapper.findAll('button').find(item => item.text() === '图例')?.trigger('click');
}

// jsdom 里点 label 不会切换单选按钮，直接设置里面的 input（同底图面板的测试）；在一个条目里找，几个条目会有同名的选项
async function choose(entry: Pick<DOMWrapper<Element>, 'findAll'>, text: string) {
  const label = entry.findAll('label').find(item => item.text() === text);
  if (!label) {
    throw new Error(`没有选项 ${text}`);
  }
  await label.get('input').setValue(true);
}

const entries = (wrapper: VueWrapper) => wrapper.findAll('[data-legend]').map(item => item.attributes('data-legend'));
const landuseShown = (wrapper: VueWrapper) => wrapper.find('[data-landuse-section]').exists();

// 确认框放在 body 下，不归组件管
afterEach(() => {
  document.body.innerHTML = '';
});

describe('ResourceLegend', () => {
  it('面板进入页面时收起，勾选变化不会打开；由用户打开、收起', async () => {
    const { wrapper, owner } = mountLegend();
    expect(wrapper.find('[data-legend]').exists()).toBe(false);

    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    expect(wrapper.find('[data-legend]').exists()).toBe(false);

    await openLegend(wrapper);
    expect(entries(wrapper)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
    await button(wrapper, '收起图例').trigger('click');
    expect(wrapper.find('[data-legend]').exists()).toBe(false);
  });

  it('只有一条时自动展开这一条；手动收起后改透明度、调顺序不再展开；集合变化后又只剩一条时再展开', async () => {
    const { wrapper, owner } = mountLegend();
    await openLegend(wrapper);
    expect(landuseShown(wrapper)).toBe(true);

    await button(wrapper, '收起地类图斑').trigger('click');
    owner.setOpacity('bgdc_dltb', 0.5);
    owner.move('bgdc_dltb', 2);
    await nextTick();
    expect(landuseShown(wrapper)).toBe(false);

    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    // 两条时都不自动展开
    expect(landuseShown(wrapper)).toBe(false);
    expect(wrapper.find('button[aria-label="展开水域线层"]').exists()).toBe(true);
    owner.setChecked('csxhjctb_hydl', false);
    await nextTick();
    expect(landuseShown(wrapper)).toBe(true);
  });

  it('只剩一个统一符号时不自动展开：展开是编辑', async () => {
    const { wrapper, owner } = mountLegend();
    await openLegend(wrapper);
    owner.setChecked('szy_kt', true);
    await nextTick();
    owner.setChecked('bgdc_dltb', false);
    await nextTick();

    expect(entries(wrapper)).toStrictEqual(['szy_kt']);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('改过符号时出现"全部恢复默认"，确认后恢复全部资源的默认符号', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('szy_kt', true);
    await openLegend(wrapper);
    const resetAll = () => wrapper.findAll('button').find(item => item.text() === '全部恢复默认');
    expect(resetAll()).toBeUndefined();

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    await nextTick();
    await resetAll()?.trigger('click');
    // 弹出层由定时器打开
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    // 测试里没有语言包，按钮文字是英文，按位置找确认按钮
    const confirm = document.body.querySelector<HTMLButtonElement>('.el-popconfirm__action .el-button--primary');
    expect(confirm).not.toBeNull();
    confirm?.click();
    await nextTick();

    expect(symbols.overrides.value.size).toBe(0);
    expect(resetAll()).toBeUndefined();
  });

  it('统一符号：名称前是预览，展开后是编辑器；按取值配色展开后列出取值和"其他"', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setCheckedMany(['csxhjctb_hydl', 'szy_kt'], true);
    await openLegend(wrapper);

    expect(wrapper.get('[data-legend="szy_kt"]').text()).toBe('坑塘 · 2022');
    expect(wrapper.get('[data-legend="szy_kt"] [data-swatch]').attributes('style')).toContain('background-color');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    await button(wrapper, '展开坑塘').trigger('click');
    expect(wrapper.find('[data-symbol-editor="szy_kt"]').exists()).toBe(true);

    await button(wrapper, '展开水域线层').trigger('click');
    expect(wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('li').map(item => item.text())).toStrictEqual([
      '河流',
      '水渠',
      '其他'
    ]);
  });

  it('预览和确认的符号都反映在图例上，丢弃预览后回到确认的颜色', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('szy_kt', true);
    await openLegend(wrapper);
    const swatchStyle = () => wrapper.get('[data-legend="szy_kt"] [data-swatch]').attributes('style');

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await nextTick();
    expect(swatchStyle()).toContain('background-color: rgba(0, 0, 255, 0.5)');

    symbols.previewColor({ code: 'szy_kt' }, 'fillColor', 'rgba(0, 128, 0, 0.8)');
    await nextTick();
    expect(swatchStyle()).toContain('background-color: rgba(0, 128, 0, 0.8)');

    symbols.clearPreview();
    await nextTick();
    expect(swatchStyle()).toContain('background-color: rgba(0, 0, 255, 0.5)');
  });

  it('分类样式的覆盖反映在取值列表和地类图例的预览上', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { color: 'rgba(255, 0, 0, 0.5)' });
    symbols.setSymbol({ code: 'bgdc_dltb', item: '0201K' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await openLegend(wrapper);
    await button(wrapper, '展开水域线层').trigger('click');

    const canal = wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('li').find(item => item.text() === '水渠');
    expect(canal?.get('[data-swatch]').attributes('style')).toContain('rgba(255, 0, 0, 0.5)');
    // 地类图斑在只有它一条时已经自动展开
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('0201K');
    expect(wrapper.get('[data-landuse="0201K"] [data-swatch]').attributes('style')).toContain('rgba(0, 0, 255, 0.5)');
  });

  it('按属性配色：切换到统一样式时展开的是统一样式的编辑器、名称前显示预览；恢复默认恢复这个资源的全部', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { width: 'L' });
    await openLegend(wrapper);
    await button(wrapper, '展开水域线层').trigger('click');
    const entry = () => wrapper.get('[data-legend="csxhjctb_hydl"]');
    const rowSwatch = () => entry().find('button[aria-label="收起水域线层"] [data-swatch]');
    expect(rowSwatch().exists()).toBe(false);
    expect(entry().find('[data-value="河流"]').exists()).toBe(true);

    await choose(entry(), '统一样式');
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('uniform');
    expect(entry().find('[data-value="河流"]').exists()).toBe(false);
    expect(entry().find('[data-symbol-editor="csxhjctb_hydl"]').exists()).toBe(true);
    expect(rowSwatch().exists()).toBe(true);

    await button(wrapper, '恢复水域线层的默认符号').trigger('click');
    expect(symbols.isCustomized('csxhjctb_hydl')).toBe(false);
    expect(entry().find('[data-value="河流"]').exists()).toBe(true);
    expect(button(wrapper, '恢复水域线层的默认符号').attributes('disabled')).toBeDefined();
  });

  it('按取值配色：展开一个取值编辑它，同一时间只展开一个', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    await openLegend(wrapper);
    await button(wrapper, '展开水域线层').trigger('click');

    await button(wrapper, '展开水渠').trigger('click');
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);
    await choose(wrapper.get('[data-symbol-editor="水渠"]'), 'XL');
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ items: { 水渠: { width: 'XL' } } });

    await button(wrapper, '展开河流').trigger('click');
    expect(wrapper.find('[data-symbol-editor="河流"]').exists()).toBe(true);
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(false);
    await button(wrapper, '收起河流').trigger('click');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('标题带显示的年份；换年份后条目仍展开，正在编辑的取值仍打开（ADR 0052 第 3 节）', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    await openLegend(wrapper);
    await button(wrapper, '展开水域线层').trigger('click');
    await button(wrapper, '展开水渠').trigger('click');
    const title = () => wrapper.get('[data-legend="csxhjctb_hydl"]').get('button').text();
    expect(title()).toContain('水域线层 · 2025');

    owner.setYear('csxhjctb_hydl', 2023);
    await nextTick();
    expect(title()).toContain('水域线层 · 2023');
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);

    owner.setYearForAll(2024);
    await nextTick();
    expect(title()).toContain('水域线层 · 2024');
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);
  });

  it('地类：展开一个地类编辑它，同一时间只展开一个', async () => {
    const { wrapper, symbols } = mountLegend();
    await openLegend(wrapper);
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('010');

    await button(wrapper, '展开水田').trigger('click');
    const fill = wrapper.findAllComponents(ElColorPicker).find(item => item.props('ariaLabel') === '水田的填充色');
    fill?.vm.$emit('change', 'rgba(0, 0, 255, 0.5)');
    expect(symbols.overrides.value.get('bgdc_dltb')).toStrictEqual({ items: { '0101': { fillColor: 'rgba(0, 0, 255, 0.5)' } } });
    await nextTick();
    expect(wrapper.get('[data-landuse="0101"] [data-swatch]').attributes('style')).toContain('rgba(0, 0, 255, 0.5)');

    await button(wrapper, '展开旱地').trigger('click');
    expect(wrapper.find('[data-symbol-editor="0103"]').exists()).toBe(true);
    expect(wrapper.find('[data-symbol-editor="0101"]').exists()).toBe(false);
    await button(wrapper, '收起旱地').trigger('click');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('地类图例：默认现状分类，可以切换和搜索；含义放在 title，可调整地类有标记', async () => {
    const { wrapper } = mountLegend();
    await openLegend(wrapper);
    const sections = () => wrapper.findAll('[data-landuse-section]').map(item => item.attributes('data-landuse-section'));
    expect(sections().slice(0, 2)).toStrictEqual(['01', '02']);

    // jsdom 里点 label 不会切换单选按钮，直接设置里面的 input（同底图面板的测试）
    const work = wrapper.findAll('label').find(item => item.text() === '工作分类 A.2');
    await work?.get('input').setValue(true);
    expect(sections().slice(0, 2)).toStrictEqual(['00', '01']);

    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('0201K');
    expect(wrapper.find('[data-landuse="0201K"]').exists()).toBe(true);
    const item = wrapper.get('[data-landuse="0201K"]');
    // 名称"可调整果园"本身就含"可调整"，要看单独的标记
    expect(item.findAll('span').map(span => span.text())).toContain('可调整');
    expect(item.attributes('title')).toContain('果园');
  });

  it('没有勾选时提示', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setChecked('bgdc_dltb', false);
    await openLegend(wrapper);

    expect(wrapper.text()).toContain('勾选资源后查看图例');
  });
});
