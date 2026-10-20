import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { type DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { ElColorPicker, ElSelect } from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { ResourceLegend } from './ResourceLegend';
import { ResourceLegendReset } from './ResourceLegendReset';

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

/** active 模拟外壳切到别的 Tab、让给另一边 */
function mountLegend() {
  let owner: ResourceLayers | undefined;
  let symbolsOwner: ResourceSymbols | undefined;
  const active = ref(true);
  const editing = ref(false);
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(map, { catalog, tileBase: 'http://localhost/tiles/', symbols });
    owner = layers;
    symbolsOwner = symbols;
    return () => (
      <>
        <ResourceLegend
          layers={layers}
          symbols={symbols}
          active={active.value}
          onEditingChange={value => { editing.value = value; }}
        />
        {active.value && !editing.value && symbols.overrides.value.size > 0 && <ResourceLegendReset symbols={symbols} />}
      </>
    );
  });
  const wrapper = mount(Page);
  if (!owner || !symbolsOwner) {
    throw new Error('页面没有创建资源图层和符号的拥有者');
  }
  return { wrapper, owner, symbols: symbolsOwner, active };
}

function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

// jsdom 里点 label 不会切换单选按钮，直接设置里面的 input（同底图面板的测试）；在一个条目里找，几个条目会有同名的选项
async function choose(entry: Pick<DOMWrapper<Element>, 'findAll'>, text: string) {
  const label = entry.findAll('label').find(item => item.text() === text);
  if (!label) {
    throw new Error(`没有选项 ${text}`);
  }
  await label.get('input').setValue(true);
}

// 设置视图与浏览视图共用面板，返回后检查原有的浏览状态
async function back(wrapper: VueWrapper) {
  const trigger = wrapper.findAll('button').find(item => item.text() === '返回图例');
  if (!trigger) {
    throw new Error('没有返回图例入口');
  }
  await trigger.trigger('click');
}

// 预览里用到的颜色：SVG 各图形的填充和描边
const swatchColors = (swatch: Omit<DOMWrapper<Element>, 'exists'>) =>
  swatch
    .findAll('rect, line, circle')
    .flatMap(shape => [shape.attributes('fill'), shape.attributes('stroke')])
    .filter(color => color !== undefined);

const entries = (wrapper: VueWrapper) => wrapper.findAll('[data-legend]').map(item => item.attributes('data-legend'));
const landuseShown = (wrapper: VueWrapper) => wrapper.find('[data-landuse-section]').exists();

// 确认框放在 body 下，不归组件管
afterEach(() => {
  document.body.innerHTML = '';
});

describe('ResourceLegend', () => {
  it('按叠放顺序列出勾选的资源', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();

    expect(entries(wrapper)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
  });

  it('隐藏时不渲染条目，编辑器卸载、丢弃取色预览；再显示时展开状态保留（ADR 0053 第 4 节）', async () => {
    const { wrapper, owner, symbols, active } = mountLegend();
    owner.setChecked('szy_kt', true);
    await nextTick();
    await button(wrapper, '编辑坑塘图例').trigger('click');
    symbols.previewColor({ code: 'szy_kt' }, 'fillColor', 'rgba(0, 128, 0, 0.8)');
    expect(symbols.preview.value).not.toBeNull();

    active.value = false;
    await nextTick();
    expect(wrapper.find('[data-legend]').exists()).toBe(false);
    expect(symbols.preview.value).toBeNull();

    active.value = true;
    await nextTick();
    expect(wrapper.find('[data-legend-settings="szy_kt"] [data-symbol-editor]').exists()).toBe(true);
  });

  it('切走再切回保留当前编辑目标，返回后保留搜索词和各图层展开状态', async () => {
    const { wrapper, owner, active } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    // 两个图层都展开，编辑时替换浏览视图，返回后仍然展开
    await button(wrapper, '展开水域线层').trigger('click');
    await button(wrapper, '展开地类图斑').trigger('click');
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('水田');
    await wrapper.get('[data-landuse="0101"] button').trigger('click');

    active.value = false;
    await nextTick();
    active.value = true;
    await nextTick();

    expect(wrapper.find('[data-symbol-editor="0101"]').exists()).toBe(true);
    expect(wrapper.find('[data-legend]').exists()).toBe(false);
    await back(wrapper);
    expect((wrapper.get('input[placeholder="搜索编码或名称"]').element as HTMLInputElement).value).toBe('水田');
    expect(wrapper.find('[data-legend="csxhjctb_hydl"] [data-value]').exists()).toBe(true);
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('');
    expect(button(wrapper, '收起地类图斑').attributes('aria-expanded')).toBe('true');
  });

  it('复杂图例默认显示多色块摘要；浏览与配置分开，状态变化不自动展开', async () => {
    const { wrapper, owner } = mountLegend();
    await nextTick();
    expect(landuseShown(wrapper)).toBe(false);
    expect(wrapper.find('[data-legend="bgdc_dltb"] [data-colors]').exists()).toBe(true);
    await button(wrapper, '展开地类图斑').trigger('click');
    expect(landuseShown(wrapper)).toBe(true);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);

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
    expect(landuseShown(wrapper)).toBe(false);
    expect(wrapper.get('[data-legend="bgdc_dltb"]').attributes('style')).toContain('--legend-opacity: 0.5');
  });

  it('单一符号直接显示预览，编辑器由独立入口打开', async () => {
    const { wrapper, owner } = mountLegend();
    await nextTick();
    owner.setChecked('szy_kt', true);
    await nextTick();
    owner.setChecked('bgdc_dltb', false);
    await nextTick();

    expect(entries(wrapper)).toStrictEqual(['szy_kt']);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('仅有符号覆盖时显示全部恢复默认，确认后恢复并隐藏入口', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('szy_kt', true);
    await nextTick();
    const resetAll = () => wrapper.findAll('button').find(item => item.text() === '全部恢复默认');
    expect(resetAll()).toBeUndefined();

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    await nextTick();
    expect(resetAll()?.attributes('disabled')).toBeUndefined();
    expect(resetAll()).toBeDefined();
    await resetAll()?.trigger('click');
    // 弹出层由定时器打开
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    expect(document.body.textContent).toContain('包括未勾选图层');
    const confirm = document.body.querySelector<HTMLButtonElement>('.el-popconfirm__action .el-button--primary');
    expect(confirm).not.toBeNull();
    confirm?.click();
    await nextTick();

    expect(symbols.overrides.value.size).toBe(0);
    expect(resetAll()).toBeUndefined();
  });

  it('普通图例只有整行编辑入口；按取值配色展开后列出取值和"其他"', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setCheckedMany(['csxhjctb_hydl', 'szy_kt'], true);
    await nextTick();

    expect(wrapper.get('[data-legend="szy_kt"]').text()).toBe('坑塘2022');
    expect(swatchColors(wrapper.get('[data-legend="szy_kt"] [data-swatch]'))).toContain('rgba(199,79,155,0.35)');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(wrapper.get('[data-legend="szy_kt"]').findAll('button')).toHaveLength(1);
    await button(wrapper, '编辑坑塘图例').trigger('click');
    expect(wrapper.find('[data-symbol-editor="szy_kt"]').exists()).toBe(true);
    await back(wrapper);
    await button(wrapper, '展开水域线层').trigger('click');
    expect(wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('li').map(item => item.text())).toStrictEqual([
      '河流',
      '水渠',
      '其他'
    ]);
  });

  it('所有编辑视图都隐藏全部恢复默认，返回浏览后重新显示', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('szy_kt', true);
    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    await nextTick();
    const resetAll = () => wrapper.findAll('button').some(item => item.text() === '全部恢复默认');
    expect(resetAll()).toBe(true);

    await button(wrapper, '编辑坑塘图例').trigger('click');
    expect(resetAll()).toBe(false);
    await back(wrapper);
    expect(resetAll()).toBe(true);
    await button(wrapper, '编辑地类图斑样式').trigger('click');
    expect(resetAll()).toBe(false);
    await back(wrapper);
    expect(resetAll()).toBe(true);
    await button(wrapper, '展开地类图斑').trigger('click');
    await button(wrapper, '编辑水田样式').trigger('click');
    expect(resetAll()).toBe(false);
    owner.setChecked('bgdc_dltb', false);
    await nextTick();
    expect(resetAll()).toBe(true);
  });

  it('按属性配色的条目名称前是前三个取值的颜色；改过符号的条目、取值名称后有小圆点（设计稿 5D.5）', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setCheckedMany(['csxhjctb_hydl', 'szy_kt'], true);
    await nextTick();
    const row = (code: string) => wrapper.get(`[data-legend="${code}"] > div`);
    const edited = (code: string) => row(code).find('[data-edited]').exists();

    // 河流、水渠、其他三个取值的颜色
    expect(row('csxhjctb_hydl').findAll('[data-colors] i').map(chip => chip.attributes('style'))).toStrictEqual([
      'background-color: rgb(30, 136, 229);',
      'background-color: rgb(79, 195, 247);',
      'background-color: rgb(47, 128, 237);'
    ]);
    expect(row('szy_kt').find('[data-colors]').exists()).toBe(false);
    expect([edited('szy_kt'), edited('csxhjctb_hydl')]).toStrictEqual([false, false]);

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { color: 'rgba(255, 0, 0, 1)' });
    await nextTick();
    expect([edited('szy_kt'), edited('csxhjctb_hydl')]).toStrictEqual([true, true]);

    await button(wrapper, '展开水域线层').trigger('click');
    const valueEdited = (key: string) => wrapper.get(`[data-value="${key}"]`).find('[data-edited]').exists();
    expect([valueEdited('河流'), valueEdited('水渠')]).toStrictEqual([false, true]);
  });

  it('预览和确认的符号都反映在图例上，丢弃预览后回到确认的颜色', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('szy_kt', true);
    await nextTick();
    const colors = () => swatchColors(wrapper.get('[data-legend="szy_kt"] [data-swatch]'));

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await nextTick();
    expect(colors()).toContain('rgba(0, 0, 255, 0.5)');

    symbols.previewColor({ code: 'szy_kt' }, 'fillColor', 'rgba(0, 128, 0, 0.8)');
    await nextTick();
    expect(colors()).toContain('rgba(0, 128, 0, 0.8)');

    symbols.clearPreview({ code: 'szy_kt' });
    await nextTick();
    expect(colors()).toContain('rgba(0, 0, 255, 0.5)');
    expect(colors()).not.toContain('rgba(0, 128, 0, 0.8)');
  });

  it('分类样式的覆盖反映在取值列表和地类图例的预览上', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { color: 'rgba(255, 0, 0, 0.5)' });
    symbols.setSymbol({ code: 'bgdc_dltb', item: '0201K' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await nextTick();
    await button(wrapper, '展开水域线层').trigger('click');

    const canal = wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('li').find(item => item.text() === '水渠');
    expect(canal && swatchColors(canal.get('[data-swatch]'))).toContain('rgba(255, 0, 0, 0.5)');
    await button(wrapper, '展开地类图斑').trigger('click');
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('0201K');
    expect(swatchColors(wrapper.get('[data-landuse="0201K"] [data-swatch]'))).toContain('rgba(0, 0, 255, 0.5)');
  });

  it('图层设置中切换统一配色，返回后图例同步；恢复本图层默认保留其他图层修改', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { width: 'L' });
    symbols.setSymbol({ code: 'bgdc_dltb', item: '0101' }, { fillColor: '#000' });
    await nextTick();
    await button(wrapper, '展开水域线层').trigger('click');
    const entry = () => wrapper.get('[data-legend="csxhjctb_hydl"]');
    const rowSwatch = () => entry().get('div').find('[data-swatch]');
    expect(rowSwatch().exists()).toBe(false);
    expect(entry().find('[data-value="河流"]').exists()).toBe(true);

    await button(wrapper, '编辑水域线层样式').trigger('click');
    await choose(wrapper, '统一配色');
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('uniform');
    expect(wrapper.find('[data-symbol-editor="csxhjctb_hydl"]').exists()).toBe(true);
    await back(wrapper);
    expect(entry().find('[data-value="河流"]').exists()).toBe(false);
    expect(rowSwatch().exists()).toBe(true);
    await button(wrapper, '编辑水域线层图例').trigger('click');
    await button(wrapper, '恢复水域线层的默认符号').trigger('click');
    expect(symbols.isCustomized('csxhjctb_hydl')).toBe(false);
    expect(button(wrapper, '恢复水域线层的默认符号').attributes('disabled')).toBeDefined();
    expect(symbols.hasOverride({ code: 'bgdc_dltb', item: '0101' })).toBe(true);
    await back(wrapper);
    expect(entry().find('[data-value="河流"]').exists()).toBe(true);
  });

  it('按取值配色：展开一个取值编辑它，同一时间只展开一个', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    await button(wrapper, '展开水域线层').trigger('click');

    await button(wrapper, '编辑水渠样式').trigger('click');
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);
    await choose(wrapper.get('[data-symbol-editor="水渠"]'), 'XL');
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ items: { 水渠: { width: 'XL' } } });
    await back(wrapper);
    await button(wrapper, '编辑河流样式').trigger('click');
    expect(wrapper.find('[data-symbol-editor="河流"]').exists()).toBe(true);
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(false);
    await back(wrapper);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('标题带显示的年份；换年份后条目仍展开，正在编辑的取值仍打开（ADR 0052 第 3 节）', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setChecked('csxhjctb_hydl', true);
    await nextTick();
    await button(wrapper, '展开水域线层').trigger('click');
    await button(wrapper, '编辑水渠样式').trigger('click');
    await back(wrapper);
    const title = () => button(wrapper, '收起水域线层').text();
    expect(title()).toContain('水域线层2025');

    owner.setYear('csxhjctb_hydl', 2023);
    await nextTick();
    expect(title()).toContain('水域线层2023');
    await button(wrapper, '编辑水渠样式').trigger('click');
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);

    owner.setYearForAll(2024);
    await nextTick();
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);
    await back(wrapper);
    expect(title()).toContain('水域线层2024');
  });

  it('地类：展开一个地类编辑它，同一时间只展开一个', async () => {
    const { wrapper, symbols } = mountLegend();
    await nextTick();
    await button(wrapper, '展开地类图斑').trigger('click');
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('010');

    await button(wrapper, '编辑水田样式').trigger('click');
    const fill = wrapper.findAllComponents(ElColorPicker).find(item => item.props('ariaLabel') === '水田的填充色');
    fill?.vm.$emit('change', 'rgba(0, 0, 255, 0.5)');
    expect(symbols.overrides.value.get('bgdc_dltb')).toStrictEqual({ items: { '0101': { fillColor: 'rgba(0, 0, 255, 0.5)' } } });
    await nextTick();
    await back(wrapper);
    expect(swatchColors(wrapper.get('[data-landuse="0101"] [data-swatch]'))).toContain('rgba(0, 0, 255, 0.5)');
    expect(wrapper.find('[data-landuse="0101"] [data-edited]').exists()).toBe(true);
    expect(wrapper.find('[data-landuse="0102"] [data-edited]').exists()).toBe(false);

    await button(wrapper, '编辑旱地样式').trigger('click');
    expect(wrapper.find('[data-symbol-editor="0103"]').exists()).toBe(true);
    expect(wrapper.find('[data-symbol-editor="0101"]').exists()).toBe(false);
    await back(wrapper);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('地类平铺且没有分类选择器；悬浮提示包含编码和含义，点击条目直接进入单项编辑', async () => {
    const { wrapper } = mountLegend();
    await nextTick();
    await button(wrapper, '展开地类图斑').trigger('click');
    expect(wrapper.findComponent(ElSelect).exists()).toBe(false);

    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('0201K');
    expect(wrapper.find('[data-landuse="0201K"]').exists()).toBe(true);
    const item = wrapper.get('[data-landuse="0201K"] button');
    expect(item.attributes('title')).toContain('（可调整）');
    expect(item.attributes('title')).toContain('果园');
    await item.trigger('click');
    expect(wrapper.get('[data-legend-settings] h3').text()).toBe('可调整果园');
    expect(wrapper.find('[data-symbol-editor="0201K"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('统一配色');
  });

  it('没有勾选时提示', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setChecked('bgdc_dltb', false);
    await nextTick();

    expect(wrapper.text()).toContain('勾选资源后查看图例');
  });

  it('取消正在编辑的资源时关闭编辑器并丢弃预览，重新勾选不自动进入编辑', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    await button(wrapper, '展开地类图斑').trigger('click');
    await button(wrapper, '编辑水田样式').trigger('click');
    symbols.previewColor({ code: 'bgdc_dltb', item: '0101' }, 'fillColor', '#000');
    expect(symbols.preview.value).not.toBeNull();
    owner.setChecked('bgdc_dltb', false);
    await nextTick();
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(symbols.preview.value).toBeNull();
    owner.setChecked('bgdc_dltb', true);
    await nextTick();
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(wrapper.find('[data-landuse="0101"]').exists()).toBe(true);
  });
});
