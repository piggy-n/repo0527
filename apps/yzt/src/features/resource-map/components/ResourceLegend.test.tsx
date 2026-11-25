import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { type DOMWrapper, mount, type VueWrapper } from '@vue/test-utils';
import { ElColorPicker, ElOption, ElSelect } from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { CLASS_FIELD } from '../filter-fields';
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

// 地类、按取值配色、统一符号、只列实际类别的地类各一个；只有地类图斑默认勾选
const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_dltb', '地类图斑', 'Polygon'),
      layer('csxhjctb_hydl', '水域线层', 'Line', [2023, 2024, 2025]),
      layer('bgdc_ccwjq', '坑塘', 'Polygon'),
      layer('lcsh_sdtb', '湿地分布图斑', 'Polygon')
    ]
  }
]);

/** active 模拟外壳切到别的 Tab、让给另一边；attach 时挂到 body 上，焦点才能移动 */
function mountLegend({ attach = false } = {}) {
  let owner: ResourceLayers | undefined;
  let symbolsOwner: ResourceSymbols | undefined;
  const active = ref(true);
  const scene = ref(false);
  const editing = ref(false);
  // 图例浮层正在显示的资源，和报告给页面的正在编辑的资源（ADR 0157）
  const yieldCode = ref<string | null>(null);
  const editingCodes: (string | null)[] = [];
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
          scene={scene.value}
          yieldCode={yieldCode.value}
          onEditingChange={value => {
            editing.value = value;
          }}
          onEditingCode={code => editingCodes.push(code)}
        />
        {active.value && !editing.value && symbols.overrides.value.size > 0 && <ResourceLegendReset symbols={symbols} />}
      </>
    );
  });
  const wrapper = mount(Page, attach ? { attachTo: document.body } : {});
  if (!owner || !symbolsOwner) {
    throw new Error('页面没有创建资源图层和符号的拥有者');
  }
  return { wrapper, owner, symbols: symbolsOwner, active, scene, yieldCode, editingCodes };
}

function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

// 一行：摘要和行尾的样式设置；按类别配色的摘要是展开、收起的按钮，名称和年份就是它的名称
const row = (wrapper: VueWrapper, code: string) => wrapper.get(`[data-legend="${code}"] > div`);
const summaryButton = (wrapper: VueWrapper, code: string) => row(wrapper, code).get('button[aria-expanded]');

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

// 编辑器灰框第一行的类别下拉
const picker = (wrapper: VueWrapper) =>
  wrapper.findAllComponents(ElSelect).find(item => item.props('ariaLabel') === '选择要修改的类别');

// 样式设置的标题行：能接住焦点，各部分的文字
function headingOf(settings: Omit<DOMWrapper<Element>, 'exists'>) {
  const heading = settings.get('[data-settings-heading]');
  expect(heading.attributes('tabindex')).toBe('-1');
  return [...heading.element.children].map(item => item.textContent?.trim());
}

// 样式设置里选中的类别和编辑器对着的目标
const selected = (wrapper: VueWrapper) => ({
  picked: required(picker(wrapper), '类别下拉').props('modelValue'),
  target: wrapper.get('[data-symbol-editor]').attributes('data-symbol-editor')
});

// 预览里用到的颜色：SVG 各图形的填充和描边
const swatchColors = (swatch: Omit<DOMWrapper<Element>, 'exists'>) =>
  swatch
    .findAll('rect, polyline, circle, path')
    .flatMap(shape => [shape.attributes('fill'), shape.attributes('stroke')])
    .filter(color => color !== undefined);

// 摘要里画出的各类（data-piece）的颜色：线是描边，面和点是填充
const summaryColors = (summary: Omit<DOMWrapper<Element>, 'exists'>) =>
  summary
    .findAll('[data-piece]')
    .map(piece => (piece.element.tagName === 'polyline' ? piece.attributes('stroke') : piece.attributes('fill')));

const entries = (wrapper: VueWrapper) => wrapper.findAll('[data-legend]').map(item => item.attributes('data-legend'));
const landuseShown = (wrapper: VueWrapper) => wrapper.find('[data-landuse-section]').exists();

// 确认框、下拉放在 body 下，不归组件管
afterEach(() => {
  document.body.innerHTML = '';
});

describe('ResourceLegend', () => {
  it('按叠放顺序列出画在地图上的资源：新加入的在最上面，隐藏的不列出', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    await nextTick();

    expect(entries(wrapper)).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb']);

    owner.setVisible('bgdc_dltb', false);
    await nextTick();

    expect(entries(wrapper)).toStrictEqual(['csxhjctb_hydl']);
  });

  it('湿地只列它实际有的地类，搜索也只在这些里找；地类图斑仍是全表（ADR 0124）', async () => {
    const { wrapper, owner } = mountLegend();
    await nextTick();
    expect(wrapper.findAll('[data-landuse]')).toHaveLength(76);

    owner.remove(['bgdc_dltb']);
    owner.add(['lcsh_sdtb']);
    await nextTick();

    expect(wrapper.findAll('[data-landuse]')).toHaveLength(49);
    expect(wrapper.find('[data-landuse="1106"]').exists()).toBe(true);
    expect(wrapper.find('[data-landuse="1002"]').exists()).toBe(false);

    const search = wrapper.get('input[aria-label="搜索地类编码或名称"]');
    await search.setValue('轨道交通');
    expect(wrapper.findAll('[data-landuse]')).toHaveLength(0);
    await search.setValue('滩涂');
    expect(wrapper.findAll('[data-landuse]').map(item => item.attributes('data-landuse'))).toStrictEqual(['1105', '1106']);
  });

  it('每一行是摘要和行尾的样式设置，三种图例都有设置；只有按类别配色的摘要是展开、收起的按钮（用户 2026-11-24）', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['csxhjctb_hydl', 'bgdc_ccwjq']);
    symbols.setMode('csxhjctb_hydl', 'uniform');
    await nextTick();
    const buttons = (code: string) =>
      row(wrapper, code)
        .findAll('button')
        .map(item => ({ label: item.attributes('aria-label'), expanded: item.attributes('aria-expanded') }));

    // 按类别配色：摘要按钮没有 aria-label，名称和年份就是它的名称
    expect(buttons('bgdc_dltb')).toStrictEqual([
      { label: undefined, expanded: 'true' },
      { label: '地类图斑的样式设置', expanded: undefined }
    ]);
    expect(summaryButton(wrapper, 'bgdc_dltb').text()).toBe('地类图斑2022');
    // 统一配色、单一符号的摘要不是按钮
    expect(buttons('csxhjctb_hydl')).toStrictEqual([{ label: '水域线层的样式设置', expanded: undefined }]);
    expect(buttons('bgdc_ccwjq')).toStrictEqual([{ label: '坑塘的样式设置', expanded: undefined }]);
    for (const code of ['bgdc_dltb', 'csxhjctb_hydl', 'bgdc_ccwjq']) {
      const children = [...row(wrapper, code).element.children];
      expect(children.map(item => item.tagName)).toStrictEqual([code === 'bgdc_dltb' ? 'BUTTON' : 'DIV', 'BUTTON']);
      expect(children[1]?.getAttribute('title')).toBe('样式设置');
      expect(children[1]?.hasAttribute('data-legend-settings-button')).toBe(true);
    }
    expect(row(wrapper, 'csxhjctb_hydl').text()).toBe('水域线层2025');
    expect(row(wrapper, 'bgdc_ccwjq').text()).toBe('坑塘2022');
  });

  it('单一符号、统一配色的摘要单击不做任何事；按类别配色的单击展开、收起', async () => {
    const { wrapper, owner, symbols, editingCodes } = mountLegend();
    owner.add(['csxhjctb_hydl', 'bgdc_ccwjq']);
    symbols.setMode('csxhjctb_hydl', 'uniform');
    await nextTick();
    const html = wrapper.html();

    await row(wrapper, 'csxhjctb_hydl').get('div').trigger('click');
    await row(wrapper, 'bgdc_ccwjq').get('div').trigger('click');
    expect(wrapper.html()).toBe(html);
    expect(wrapper.find('[data-legend-settings]').exists()).toBe(false);
    expect(editingCodes).toStrictEqual([null]);

    await summaryButton(wrapper, 'bgdc_dltb').trigger('click');
    expect(summaryButton(wrapper, 'bgdc_dltb').attributes('aria-expanded')).toBe('false');
    expect(landuseShown(wrapper)).toBe(false);
    await summaryButton(wrapper, 'bgdc_dltb').trigger('click');
    expect(landuseShown(wrapper)).toBe(true);
  });

  it('图例上没有显示方式的快捷切换、名称后面的漏斗、"改过符号"的点和过滤的文字（用户 2026-11-24）', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['csxhjctb_hydl', 'bgdc_ccwjq']);
    symbols.setSymbol({ code: 'bgdc_ccwjq' }, { fillColor: '#000' });
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { width: 'XL' });
    symbols.setSymbol({ code: 'bgdc_dltb', item: '0101' }, { fillColor: '#000' });
    owner.setFilter('csxhjctb_hydl', { [CLASS_FIELD]: ['河流'] });
    owner.setFilter('bgdc_dltb', { [CLASS_FIELD]: ['0101'] });
    await nextTick();

    const legend = wrapper.get('[data-resource-legend]');
    // 显示方式的切换、漏斗、改过符号的点、过滤的文字、行尾的占位
    const removed = [
      '[data-legend-mode]',
      '[data-legend-filtered]',
      '[data-edited]',
      '[data-filter-note]',
      '[data-legend-slot]'
    ];
    expect(removed.filter(selector => legend.find(selector).exists())).toStrictEqual([]);
    expect(legend.findAll('button').some(item => item.attributes('aria-label')?.includes('显示方式'))).toBe(false);
  });

  it('隐藏时不渲染条目，编辑器卸载、丢弃取色预览；再显示时展开状态保留（ADR 0053 第 4 节）', async () => {
    const { wrapper, owner, symbols, active } = mountLegend();
    owner.add(['bgdc_ccwjq']);
    await nextTick();
    await button(wrapper, '坑塘的样式设置').trigger('click');
    symbols.previewColor({ code: 'bgdc_ccwjq' }, 'fillColor', 'rgba(0, 128, 0, 0.8)');
    expect(symbols.preview.value).not.toBeNull();

    active.value = false;
    await nextTick();
    expect(wrapper.find('[data-legend]').exists()).toBe(false);
    expect(symbols.preview.value).toBeNull();

    active.value = true;
    await nextTick();
    expect(wrapper.find('[data-legend-settings="bgdc_ccwjq"] [data-symbol-editor]').exists()).toBe(true);
  });

  it('三维时只显示说明、丢弃取色预览；切回二维后编辑目标照旧（ADR 0080 第 5 节）', async () => {
    const { wrapper, owner, symbols, scene } = mountLegend();
    owner.add(['bgdc_ccwjq']);
    await nextTick();
    await button(wrapper, '坑塘的样式设置').trigger('click');
    symbols.previewColor({ code: 'bgdc_ccwjq' }, 'fillColor', 'rgba(0, 128, 0, 0.8)');

    scene.value = true;
    await nextTick();
    expect(wrapper.get('[data-legend-scene-note]').text()).toBe('三维模式暂不显示资源图层，图例在切回二维后可用。');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(symbols.preview.value).toBeNull();

    scene.value = false;
    await nextTick();
    expect(wrapper.find('[data-legend-scene-note]').exists()).toBe(false);
    expect(wrapper.find('[data-legend-settings="bgdc_ccwjq"] [data-symbol-editor]').exists()).toBe(true);
  });

  it('切走再切回保留当前编辑目标，返回后保留搜索词和各图层展开状态', async () => {
    const { wrapper, owner, active } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    // 两个图层默认都展开，收起水域线层；编辑时替换浏览视图，返回后展开、收起照旧
    await summaryButton(wrapper, 'csxhjctb_hydl').trigger('click');
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
    expect(wrapper.find('[data-legend="csxhjctb_hydl"] [data-value]').exists()).toBe(false);
    expect(summaryButton(wrapper, 'csxhjctb_hydl').attributes('aria-expanded')).toBe('false');
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('');
    expect(summaryButton(wrapper, 'bgdc_dltb').attributes('aria-expanded')).toBe('true');
  });

  it('复合图例默认展开（ADR 0094），名称前是按几何画的摘要（ADR 0159）；浏览与配置分开，状态变化不改收起', async () => {
    const { wrapper, owner } = mountLegend();
    await nextTick();
    expect(landuseShown(wrapper)).toBe(true);
    expect(wrapper.get('[data-legend="bgdc_dltb"] [data-summary]').attributes('data-summary')).toBe('fill');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);

    await summaryButton(wrapper, 'bgdc_dltb').trigger('click');
    expect(landuseShown(wrapper)).toBe(false);
    owner.setOpacity('bgdc_dltb', 0.5);
    await nextTick();
    expect(landuseShown(wrapper)).toBe(false);

    owner.add(['csxhjctb_hydl']);
    await nextTick();
    // 新勾选的复合图例展开，收起过的仍收起
    expect(landuseShown(wrapper)).toBe(false);
    expect(summaryButton(wrapper, 'csxhjctb_hydl').attributes('aria-expanded')).toBe('true');
    owner.remove(['csxhjctb_hydl']);
    await nextTick();
    expect(landuseShown(wrapper)).toBe(false);
    expect(wrapper.get('[data-legend="bgdc_dltb"]').attributes('style')).toContain('--legend-opacity: 0.5');
  });

  it('单一符号直接显示预览，编辑器由独立入口打开', async () => {
    const { wrapper, owner } = mountLegend();
    await nextTick();
    owner.add(['bgdc_ccwjq']);
    await nextTick();
    owner.remove(['bgdc_dltb']);
    await nextTick();

    expect(entries(wrapper)).toStrictEqual(['bgdc_ccwjq']);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('仅有符号覆盖时显示全部恢复默认，确认后恢复并隐藏入口', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['bgdc_ccwjq']);
    await nextTick();
    const resetAll = () => wrapper.findAll('button').find(item => item.text() === '全部恢复默认');
    expect(resetAll()).toBeUndefined();

    symbols.setSymbol({ code: 'bgdc_ccwjq' }, { fillColor: '#000' });
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

  it('单一符号的行只有样式设置一个按钮；按取值配色展开后列出取值和"其他"', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl', 'bgdc_ccwjq']);
    await nextTick();

    expect(wrapper.get('[data-legend="bgdc_ccwjq"]').text()).toBe('坑塘2022');
    expect(swatchColors(wrapper.get('[data-legend="bgdc_ccwjq"] [data-swatch]'))).toContain('rgba(199,79,155,0.35)');
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(wrapper.get('[data-legend="bgdc_ccwjq"]').findAll('button')).toHaveLength(1);
    await button(wrapper, '坑塘的样式设置').trigger('click');
    expect(wrapper.find('[data-symbol-editor="bgdc_ccwjq"]').exists()).toBe(true);
    await back(wrapper);
    expect(wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('li').map(item => item.text())).toStrictEqual([
      '河流',
      '水渠',
      '其他'
    ]);
  });

  it('所有编辑视图都隐藏全部恢复默认，返回浏览后重新显示', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['bgdc_ccwjq']);
    symbols.setSymbol({ code: 'bgdc_ccwjq' }, { fillColor: '#000' });
    await nextTick();
    const resetAll = () => wrapper.findAll('button').some(item => item.text() === '全部恢复默认');
    expect(resetAll()).toBe(true);

    await button(wrapper, '坑塘的样式设置').trigger('click');
    expect(resetAll()).toBe(false);
    await back(wrapper);
    expect(resetAll()).toBe(true);
    await button(wrapper, '地类图斑的样式设置').trigger('click');
    expect(resetAll()).toBe(false);
    await back(wrapper);
    expect(resetAll()).toBe(true);
    await button(wrapper, '编辑水田样式').trigger('click');
    expect(resetAll()).toBe(false);
    owner.remove(['bgdc_dltb']);
    await nextTick();
    expect(resetAll()).toBe(true);
  });

  it('按属性配色的条目名称前是代表取值按几何画的摘要（ADR 0159），单一符号是它自己的符号', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl', 'bgdc_ccwjq']);
    await nextTick();

    // 水域线层只有河流、水渠两个取值（兜底不算）：三段折线依次是河流、水渠、河流
    const hydl = row(wrapper, 'csxhjctb_hydl').get('[data-summary]');
    expect(hydl.attributes('data-summary')).toBe('line');
    expect(summaryColors(hydl)).toStrictEqual(['#1E88E5', '#4FC3F7', '#1E88E5']);
    expect(row(wrapper, 'bgdc_ccwjq').find('[data-summary]').exists()).toBe(false);
    expect(row(wrapper, 'bgdc_ccwjq').find('[data-swatch]').exists()).toBe(true);
  });

  it('预览和确认的符号都反映在图例上，丢弃预览后回到确认的颜色', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['bgdc_ccwjq']);
    await nextTick();
    const colors = () => swatchColors(wrapper.get('[data-legend="bgdc_ccwjq"] [data-swatch]'));

    symbols.setSymbol({ code: 'bgdc_ccwjq' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await nextTick();
    expect(colors()).toContain('rgba(0, 0, 255, 0.5)');

    symbols.previewColor({ code: 'bgdc_ccwjq' }, 'fillColor', 'rgba(0, 128, 0, 0.8)');
    await nextTick();
    expect(colors()).toContain('rgba(0, 128, 0, 0.8)');

    symbols.clearPreview({ code: 'bgdc_ccwjq' });
    await nextTick();
    expect(colors()).toContain('rgba(0, 0, 255, 0.5)');
    expect(colors()).not.toContain('rgba(0, 128, 0, 0.8)');
  });

  it('分类样式的覆盖反映在取值列表和地类图例的预览上', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { color: 'rgba(255, 0, 0, 0.5)' });
    symbols.setSymbol({ code: 'bgdc_dltb', item: '0201K' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await nextTick();

    const canal = wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('li').find(item => item.text() === '水渠');
    // 半透明的线整组设透明度，线用不透明的颜色（ADR 0159）
    expect(canal?.get('[data-swatch] g').attributes('opacity')).toBe('0.5');
    expect(canal && swatchColors(canal.get('[data-swatch]'))).toContain('rgba(255,0,0,1)');
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('0201K');
    expect(swatchColors(wrapper.get('[data-landuse="0201K"] [data-swatch]'))).toContain('rgba(0, 0, 255, 0.5)');
  });

  it('图层设置中切换统一配色，返回后图例同步；恢复本图层默认保留其他图层修改', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { width: 'L' });
    symbols.setSymbol({ code: 'bgdc_dltb', item: '0101' }, { fillColor: '#000' });
    await nextTick();
    const entry = () => wrapper.get('[data-legend="csxhjctb_hydl"]');
    const rowSwatch = () => entry().get('div').find('[data-swatch]');
    expect(rowSwatch().exists()).toBe(false);
    expect(entry().find('[data-value="河流"]').exists()).toBe(true);

    await button(wrapper, '水域线层的样式设置').trigger('click');
    await choose(wrapper, '统一配色');
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('uniform');
    expect(wrapper.find('[data-symbol-editor="csxhjctb_hydl"]').exists()).toBe(true);
    await back(wrapper);
    expect(entry().find('[data-value="河流"]').exists()).toBe(false);
    expect(entry().find('button[aria-expanded]').exists()).toBe(false);
    expect(rowSwatch().exists()).toBe(true);
    await button(wrapper, '水域线层的样式设置').trigger('click');
    await button(wrapper, '恢复水域线层整个图层的默认符号').trigger('click');
    expect(symbols.isCustomized('csxhjctb_hydl')).toBe(false);
    expect(button(wrapper, '恢复水域线层整个图层的默认符号').attributes('disabled')).toBeDefined();
    expect(symbols.hasOverride({ code: 'bgdc_dltb', item: '0101' })).toBe(true);
    await back(wrapper);
    expect(entry().find('[data-value="河流"]').exists()).toBe(true);
  });

  it('样式设置替换整张列表：标题行是资源名和最右的"返回图例"，下面一行显示方式；单一符号没有显示方式（用户 2026-11-24）', async () => {
    const { wrapper, owner, editingCodes } = mountLegend();
    owner.add(['csxhjctb_hydl', 'bgdc_ccwjq']);
    await nextTick();

    await button(wrapper, '水域线层的样式设置').trigger('click');
    expect(wrapper.find('[data-legend]').exists()).toBe(false);
    expect(editingCodes.at(-1)).toBe('csxhjctb_hydl');
    const settings = wrapper.get('[data-legend-settings="csxhjctb_hydl"]');
    expect(settings.element.firstElementChild).toBe(settings.get('[data-settings-heading]').element);
    expect(headingOf(settings)).toStrictEqual(['水域线层', '返回图例']);
    const modes = settings.get('[role="radiogroup"][aria-label="图层配色方式"]');
    expect(modes.findAll('label').map(item => item.text())).toStrictEqual(['按类别配色', '统一配色']);
    expect(modes.get('label.is-active').text()).toBe('按类别配色');

    await back(wrapper);
    await button(wrapper, '坑塘的样式设置').trigger('click');
    const symbolSettings = wrapper.get('[data-legend-settings="bgdc_ccwjq"]');
    expect(headingOf(symbolSettings)).toStrictEqual(['坑塘', '返回图例']);
    expect(symbolSettings.find('[aria-label="图层配色方式"]').exists()).toBe(false);
    expect(picker(wrapper)).toBeUndefined();
    expect(symbolSettings.get('[data-symbol-editor]').attributes('data-symbol-editor')).toBe('bgdc_ccwjq');
  });

  it('按类别配色时编辑器灰框第一行选类别：只列资源实际有的类别、带符号，不收别的；从行尾进时是第一类（用户 2026-11-24）', async () => {
    const { wrapper, owner } = mountLegend();
    owner.remove(['bgdc_dltb']);
    owner.add(['lcsh_sdtb']);
    await nextTick();
    // 图例列的地类：编码加名称，历史地类和未匹配的只有名称
    const listed = wrapper.findAll('[data-landuse]').map(item => {
      const code = item.attributes('data-landuse');
      return code === item.text() ? item.text() : `${code} ${item.text()}`;
    });
    await button(wrapper, '湿地分布图斑的样式设置').trigger('click');

    // 第一类是资源有的：选到资源没有的地类时编辑器整块是空的（原来列全部 76 项的问题）
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(true);
    const select = required(picker(wrapper), '类别下拉');
    const editor = wrapper.get('[data-symbol-editor]');
    const lead = required(editor.element.firstElementChild, '编辑器的第一行');
    expect(lead.firstElementChild?.textContent).toBe('类别');
    expect(lead.querySelector('input[aria-label="选择要修改的类别"]')).not.toBeNull();
    // 湿地的 49 类，和图例一样按地类图例的顺序；没有的地类（1002 轨道交通用地）不列
    const options = select.findAllComponents(ElOption);
    expect(options.map(option => option.props('label'))).toStrictEqual(listed);
    const keys = options.map(option => option.props('value'));
    expect(keys).toHaveLength(49);
    expect(keys).toContain('1106');
    expect(keys).not.toContain('1002');
    expect(selected(wrapper)).toStrictEqual({ picked: keys[0], target: keys[0] });

    // 选项带符号
    await select.find('.el-select__wrapper').trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-class-option="1106"] [data-swatch]')).not.toBeNull();
    expect(document.body.querySelector('[data-class-option="1002"]')).toBeNull();

    select.vm.$emit('update:modelValue', '1002');
    await nextTick();
    expect(selected(wrapper)).toStrictEqual({ picked: keys[0], target: keys[0] });
    select.vm.$emit('update:modelValue', '1106');
    await nextTick();
    expect(selected(wrapper)).toStrictEqual({ picked: '1106', target: '1106' });
  });

  it('按取值配色：点子图例的一类进这一类的样式设置、类别选好它；从行尾再进时是上次选的类别', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    await nextTick();

    await button(wrapper, '编辑水渠样式').trigger('click');
    expect(selected(wrapper)).toStrictEqual({ picked: '水渠', target: '水渠' });
    await choose(wrapper.get('[data-symbol-editor="水渠"]'), 'XL');
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ items: { 水渠: { width: 'XL' } } });
    await back(wrapper);
    await button(wrapper, '编辑河流样式').trigger('click');
    expect(selected(wrapper)).toStrictEqual({ picked: '河流', target: '河流' });
    expect(wrapper.findAll('[data-symbol-editor]')).toHaveLength(1);
    await back(wrapper);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);

    await button(wrapper, '水域线层的样式设置').trigger('click');
    expect(selected(wrapper)).toStrictEqual({ picked: '河流', target: '河流' });
  });

  it('恢复按钮：编辑器写"恢复××的默认"、只恢复这一类，统一配色时写"恢复默认"；"恢复整个图层默认"没改过时禁用（用户 2026-11-24）', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    await button(wrapper, '编辑水渠样式').trigger('click');
    const resetItem = () =>
      required(
        wrapper
          .get('[data-symbol-editor]')
          .findAll('button')
          .find(item => item.text().startsWith('恢复')),
        '编辑器的恢复按钮'
      );
    const resetLayer = () => button(wrapper, '恢复水域线层整个图层的默认符号');
    expect(resetItem().text()).toBe('恢复水渠的默认');
    expect(resetItem().attributes('disabled')).toBeDefined();
    expect(resetLayer().text()).toBe('恢复整个图层默认');
    expect(resetLayer().attributes('disabled')).toBeDefined();

    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { width: 'XL' });
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '河流' }, { width: 'L' });
    await nextTick();
    expect(resetLayer().attributes('disabled')).toBeUndefined();
    await resetItem().trigger('click');
    expect(symbols.hasOverride({ code: 'csxhjctb_hydl', item: '水渠' })).toBe(false);
    expect(symbols.hasOverride({ code: 'csxhjctb_hydl', item: '河流' })).toBe(true);

    await choose(wrapper, '统一配色');
    expect(picker(wrapper)).toBeUndefined();
    expect(resetItem().text()).toBe('恢复默认');
    expect(resetLayer().text()).toBe('恢复整个图层默认');
  });

  it('进样式设置时焦点到标题行，返回时回到这一行的样式设置；焦点在图例外面时让出不抢焦点（用户 2026-11-24）', async () => {
    const { wrapper, owner, yieldCode } = mountLegend({ attach: true });
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    const gear = button(wrapper, '地类图斑的样式设置');
    (gear.element as HTMLElement).focus();

    await gear.trigger('click');
    expect(document.activeElement).toBe(wrapper.get('[data-settings-heading]').element);
    await back(wrapper);
    expect(document.activeElement).toBe(button(wrapper, '地类图斑的样式设置').element);

    // 点了子图例的一类进来，返回时也回到这一行的样式设置
    await button(wrapper, '编辑水渠样式').trigger('click');
    expect(document.activeElement).toBe(wrapper.get('[data-settings-heading]').element);
    await back(wrapper);
    expect(document.activeElement).toBe(button(wrapper, '水域线层的样式设置').element);

    // 图例浮层开着同一个资源的设置时这边回到浏览，焦点留在别处
    await button(wrapper, '水域线层的样式设置').trigger('click');
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    yieldCode.value = 'csxhjctb_hydl';
    await nextTick();
    expect(wrapper.find('[data-legend-settings]').exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('按分类过滤时子图例照样列出全部类别，过滤掉的淡显、写明已过滤，仍能点进设置；摘要只画地图上的类别（ADR 0173，用户 2026-11-24）', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    owner.setFilter('csxhjctb_hydl', { [CLASS_FIELD]: ['河流'] });
    owner.setFilter('bgdc_dltb', { [CLASS_FIELD]: ['0101'] });
    await nextTick();

    const values = wrapper
      .get('[data-legend="csxhjctb_hydl"]')
      .findAll('[data-value] button')
      .map(item => ({
        excluded: item.attributes('data-excluded'),
        faded: item.classes().some(name => name.includes('excluded')),
        title: item.attributes('title'),
        label: item.attributes('aria-label')
      }));
    expect(values).toStrictEqual([
      { excluded: undefined, faded: false, title: '河流', label: '编辑河流样式' },
      { excluded: 'true', faded: true, title: '水渠（已过滤，地图上不显示）', label: '编辑水渠样式（已过滤）' },
      { excluded: 'true', faded: true, title: '其他（已过滤，地图上不显示）', label: '编辑其他样式（已过滤）' }
    ]);

    expect(wrapper.findAll('[data-landuse]')).toHaveLength(76);
    expect(wrapper.findAll('[data-landuse] button[data-excluded]')).toHaveLength(75);
    expect(wrapper.find('[data-landuse="0101"] button').attributes('data-excluded')).toBeUndefined();
    const irrigated = wrapper.get('[data-landuse="0102"] button');
    expect(irrigated.attributes('title')).toContain('0102 水浇地（已过滤，地图上不显示）');
    expect(irrigated.attributes('aria-label')).toBe('编辑水浇地样式（已过滤）');

    // 行头照旧，摘要只画勾着的河流
    expect(summaryButton(wrapper, 'csxhjctb_hydl').text()).toBe('水域线层2025');
    expect(summaryColors(row(wrapper, 'csxhjctb_hydl').get('[data-summary]'))).toStrictEqual(['#1E88E5']);

    // 过滤掉的一类也能点进设置，类别下拉不跟着过滤
    await button(wrapper, '编辑水渠样式（已过滤）').trigger('click');
    expect(selected(wrapper)).toStrictEqual({ picked: '水渠', target: '水渠' });
    const options = required(picker(wrapper), '类别下拉')
      .findAllComponents(ElOption)
      .map(option => option.props('label'));
    expect(options).toStrictEqual(['河流', '水渠', '其他']);
  });

  it('按分类过滤到一类都不剩：子图例全部淡显，行首的摘要空着，不退回去画统一的符号（ADR 0175）', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    owner.setFilter('csxhjctb_hydl', { [CLASS_FIELD]: [] });
    await nextTick();

    const values = wrapper.get('[data-legend="csxhjctb_hydl"]').findAll('[data-value] button');
    expect(values.map(value => value.attributes('data-excluded'))).toStrictEqual(['true', 'true', 'true']);
    expect(row(wrapper, 'csxhjctb_hydl').find('[data-swatch], [data-summary]').exists()).toBe(false);
  });

  it('标题带显示的年份；换年份后条目仍展开，正在编辑的取值仍打开（ADR 0052 第 3 节）', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    await button(wrapper, '编辑水渠样式').trigger('click');
    await back(wrapper);
    const title = () => summaryButton(wrapper, 'csxhjctb_hydl').text();
    expect(title()).toContain('水域线层2025');

    owner.setYear('csxhjctb_hydl', 2023);
    await nextTick();
    expect(title()).toContain('水域线层2023');
    expect(summaryButton(wrapper, 'csxhjctb_hydl').attributes('aria-expanded')).toBe('true');
    await button(wrapper, '编辑水渠样式').trigger('click');
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);

    owner.setYearForAll(2024);
    await nextTick();
    expect(wrapper.find('[data-symbol-editor="水渠"]').exists()).toBe(true);
    await back(wrapper);
    expect(title()).toContain('水域线层2024');
  });

  it('地类：点一个地类进它的样式设置，改的是这一类；返回后预览跟着变，再点另一类换成另一类', async () => {
    const { wrapper, symbols } = mountLegend();
    await nextTick();
    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('010');

    await button(wrapper, '编辑水田样式').trigger('click');
    const fill = wrapper.findAllComponents(ElColorPicker).find(item => item.props('ariaLabel') === '水田的填充色');
    fill?.vm.$emit('change', 'rgba(0, 0, 255, 0.5)');
    expect(symbols.overrides.value.get('bgdc_dltb')).toStrictEqual({ items: { '0101': { fillColor: 'rgba(0, 0, 255, 0.5)' } } });
    await nextTick();
    await back(wrapper);
    expect(swatchColors(wrapper.get('[data-landuse="0101"] [data-swatch]'))).toContain('rgba(0, 0, 255, 0.5)');

    await button(wrapper, '编辑旱地样式').trigger('click');
    expect(wrapper.find('[data-symbol-editor="0103"]').exists()).toBe(true);
    expect(wrapper.find('[data-symbol-editor="0101"]').exists()).toBe(false);
    await back(wrapper);
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });

  it('正在设置的一类被过滤掉（ADR 0173）：编辑器和类别仍对着它，一类都不剩时也不改到统一符号上', async () => {
    const { wrapper, owner } = mountLegend();
    owner.add(['csxhjctb_hydl']);
    await nextTick();
    await button(wrapper, '编辑水渠样式').trigger('click');
    const heading = () => wrapper.get('[data-settings-heading]').element.firstElementChild?.textContent;
    expect(heading()).toBe('水域线层');
    expect(selected(wrapper)).toStrictEqual({ picked: '水渠', target: '水渠' });

    owner.setFilter('csxhjctb_hydl', { [CLASS_FIELD]: ['河流'] });
    await nextTick();
    expect(selected(wrapper)).toStrictEqual({ picked: '水渠', target: '水渠' });
    owner.setFilter('csxhjctb_hydl', { [CLASS_FIELD]: [] });
    await nextTick();
    expect(selected(wrapper)).toStrictEqual({ picked: '水渠', target: '水渠' });
    expect(heading()).toBe('水域线层');
  });

  it('地类平铺、浏览时没有下拉；悬浮提示包含编码和含义，点一类进这一类的样式设置、类别选好它', async () => {
    const { wrapper } = mountLegend();
    await nextTick();
    expect(wrapper.findComponent(ElSelect).exists()).toBe(false);

    await wrapper.get('input[placeholder="搜索编码或名称"]').setValue('0201K');
    expect(wrapper.find('[data-landuse="0201K"]').exists()).toBe(true);
    const item = wrapper.get('[data-landuse="0201K"] button');
    expect(item.attributes('title')).toContain('（可调整）');
    expect(item.attributes('title')).toContain('果园');
    await item.trigger('click');
    expect(wrapper.get('[data-settings-heading]').element.firstElementChild?.textContent).toBe('地类图斑');
    expect(selected(wrapper)).toStrictEqual({ picked: '0201K', target: '0201K' });
    // 编辑器的名称是这一类
    const fills = wrapper.findAllComponents(ElColorPicker).map(colorPicker => colorPicker.props('ariaLabel'));
    expect(fills).toContain('可调整果园的填充色');
  });

  it('没有勾选时提示', async () => {
    const { wrapper, owner } = mountLegend();
    owner.remove(['bgdc_dltb']);
    await nextTick();

    expect(wrapper.text()).toContain('勾选资源后查看图例');
  });

  it('取消正在编辑的资源时关闭编辑器并丢弃预览，重新勾选不自动进入编辑', async () => {
    const { wrapper, owner, symbols } = mountLegend();
    await nextTick();
    await button(wrapper, '编辑水田样式').trigger('click');
    symbols.previewColor({ code: 'bgdc_dltb', item: '0101' }, 'fillColor', '#000');
    expect(symbols.preview.value).not.toBeNull();
    owner.remove(['bgdc_dltb']);
    await nextTick();
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(symbols.preview.value).toBeNull();
    owner.add(['bgdc_dltb']);
    await nextTick();
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(wrapper.find('[data-landuse="0101"]').exists()).toBe(true);
  });

  it('正在显示的编辑器对着的资源报告给页面，隐藏时报 null；图例浮层开着同一个资源时回到浏览（ADR 0157）', async () => {
    const { wrapper, active, yieldCode, editingCodes } = mountLegend();
    await nextTick();
    expect(editingCodes).toStrictEqual([null]);
    await button(wrapper, '编辑水田样式').trigger('click');
    expect(editingCodes.at(-1)).toBe('bgdc_dltb');

    active.value = false;
    await nextTick();
    expect(editingCodes.at(-1)).toBeNull();
    active.value = true;
    await nextTick();
    expect(editingCodes.at(-1)).toBe('bgdc_dltb');

    yieldCode.value = 'bgdc_dltb';
    await nextTick();
    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
    expect(editingCodes.at(-1)).toBeNull();
  });
});
