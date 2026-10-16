import { mount, type VueWrapper } from '@vue/test-utils';
import { ElColorPicker, ElSelect } from 'element-plus';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { SymbolTarget } from '../resource-symbols';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { COLOR_PRESETS } from '../palette';
import { SymbolEditor } from './SymbolEditor';

function layer(code: string, name: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name, geoType, yearList: [2022] as [number] };
}

const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('csxhjctb_gyssp', '公用设施点层', 'Point'),
      layer('bgdc_cjdcqjx', '村级调查区界线', 'Line'),
      layer('szy_kt', '坑塘', 'Polygon'),
      layer('csxhjctb_hydl', '水域线层', 'Line')
    ]
  }
]);

// 只给资源时编辑统一样式，给了取值时编辑这个取值
function mountEditor(code: string, item?: string) {
  let owner: ResourceSymbols | undefined;
  const target = item === undefined ? { code } : { code, item };
  const Page = defineComponent(() => {
    const symbols = useResourceSymbols({ catalog: shallowRef(CATALOG) });
    owner = symbols;
    return () => <SymbolEditor symbols={symbols} target={target} name={item ?? CATALOG.resources.get(code)?.name ?? code} />;
  });
  const wrapper = mount(Page);
  if (!owner) {
    throw new Error('页面没有创建符号的拥有者');
  }
  return { wrapper, symbols: owner };
}

// 页面按资源设 key 列出编辑器，每次渲染给出新的目标对象（同图例）；同一资源换取值时编辑器复用，renders 变化时页面重新渲染
function mountEditors(initial: readonly SymbolTarget[]) {
  let owner: ResourceSymbols | undefined;
  const targets = shallowRef(initial);
  const renders = shallowRef(0);
  const Page = defineComponent(() => {
    const symbols = useResourceSymbols({ catalog: shallowRef(CATALOG) });
    owner = symbols;
    return () => (
      <div data-renders={renders.value}>
        {targets.value.map(({ code, item }) => (
          <SymbolEditor
            key={code}
            symbols={symbols}
            target={item === undefined ? { code } : { code, item }}
            name={item ?? CATALOG.resources.get(code)?.name ?? code}
          />
        ))}
      </div>
    );
  });
  const wrapper = mount(Page);
  if (!owner) {
    throw new Error('页面没有创建符号的拥有者');
  }
  return { wrapper, symbols: owner, targets, renders };
}

// jsdom 里点 label 不会切换单选按钮，直接设置里面的 input（同底图面板的测试）
async function choose(wrapper: VueWrapper, text: string) {
  const label = wrapper.findAll('label').find(item => item.text() === text);
  if (!label) {
    throw new Error(`没有选项 ${text}`);
  }
  await label.get('input').setValue(true);
}

function picker(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAllComponents(ElColorPicker).find(item => item.props('ariaLabel') === label);
  if (!found) {
    throw new Error(`没有取色器 ${label}`);
  }
  return found;
}

const customInput = (wrapper: VueWrapper) => wrapper.find('input[aria-label^="自定义"]');

// 下拉框放在 body 下，不归组件管
afterEach(() => {
  document.body.innerHTML = '';
});

// 下拉框里某个线型选项的示意的 stroke-dasharray；实线没有
const dasharray = (dash: string) =>
  document.body.querySelector(`[data-dash="${dash}"] [data-swatch] line`)?.getAttribute('stroke-dasharray') ?? null;

describe('SymbolEditor', () => {
  it('点：档位、描边宽度点下就确认；改过之后可以恢复默认，只恢复这个资源', async () => {
    const { wrapper, symbols } = mountEditor('csxhjctb_gyssp');
    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    const reset = () => wrapper.findAll('button').find(item => item.text() === '恢复默认');
    expect(reset()?.attributes('disabled')).toBeDefined();

    await choose(wrapper, 'XL');
    await choose(wrapper, '3');
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { size: 'XL', strokeWidth: 3 } });

    expect(reset()?.attributes('disabled')).toBeUndefined();
    await reset()?.trigger('click');
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(false);
    expect(symbols.isCustomized('szy_kt')).toBe(true);
  });

  it('自定义大小：初始为当前档位的像素；回车或失焦时确认并按步长取整，输入法选字的回车不算；不合法的值留在输入框里提示范围', async () => {
    const { wrapper, symbols } = mountEditor('csxhjctb_gyssp');
    expect(customInput(wrapper).exists()).toBe(false);

    await choose(wrapper, '自定义');
    const input = customInput(wrapper);
    expect((input.element as HTMLInputElement).value).toBe('4');

    await input.setValue('30');
    await input.trigger('keydown', { key: 'Enter' });
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(false);
    expect((input.element as HTMLInputElement).value).toBe('30');
    expect(wrapper.find('[class*="invalid"]').exists()).toBe(true);

    await input.setValue('6.2');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(false);
    await input.trigger('keydown', { key: 'Enter' });
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { size: 6 } });
    expect(wrapper.find('[class*="invalid"]').exists()).toBe(false);

    await input.setValue('8');
    await input.trigger('blur');
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { size: 8 } });
  });

  it('自定义大小：和当前档位像素相同时不提交，输入框换成取整后的值；恢复默认后回到档位', async () => {
    const { wrapper, symbols } = mountEditor('bgdc_cjdcqjx');
    await choose(wrapper, '自定义');
    await customInput(wrapper).setValue(' 1.84 ');
    await customInput(wrapper).trigger('keydown', { key: 'Enter' });
    expect(symbols.isCustomized('bgdc_cjdcqjx')).toBe(false);
    expect((customInput(wrapper).element as HTMLInputElement).value).toBe('1.8');

    await customInput(wrapper).setValue('3');
    await customInput(wrapper).trigger('keydown', { key: 'Enter' });
    expect(symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { width: 3 } });

    symbols.resetSymbol({ code: 'bgdc_cjdcqjx' });
    await nextTick();
    expect(customInput(wrapper).exists()).toBe(false);
  });

  it('不合法的输入：重新进入自定义、大小在别处变化时换成当前的像素，清掉提示', async () => {
    const { wrapper, symbols } = mountEditor('csxhjctb_gyssp');
    const invalidShown = () => wrapper.find('[class*="invalid"]').exists();
    await choose(wrapper, '自定义');
    await customInput(wrapper).setValue('30');
    await customInput(wrapper).trigger('keydown', { key: 'Enter' });
    expect(invalidShown()).toBe(true);

    // 选回同一档，大小没变
    await choose(wrapper, 'M');
    await choose(wrapper, '自定义');
    expect((customInput(wrapper).element as HTMLInputElement).value).toBe('4');
    expect(invalidShown()).toBe(false);

    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 6 });
    await nextTick();
    await customInput(wrapper).setValue('30');
    await customInput(wrapper).trigger('keydown', { key: 'Enter' });
    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 8 });
    await nextTick();
    expect((customInput(wrapper).element as HTMLInputElement).value).toBe('8');
    expect(invalidShown()).toBe(false);
  });

  it('颜色：拖动时预览，确认时写入；取消时取色器报回原来的颜色，预览清掉', async () => {
    const { wrapper, symbols } = mountEditor('szy_kt');
    const fill = picker(wrapper, '坑塘的填充色');
    const committed = fill.props('modelValue');
    // 预设色是排满两行的色卡（2026-10-16 用户要求）
    expect(fill.props('predefine')).toStrictEqual(COLOR_PRESETS);

    fill.vm.$emit('activeChange', 'rgba(0, 0, 255, 0.5)');
    expect(symbols.preview.value).toStrictEqual({ code: 'szy_kt', field: 'fillColor', color: 'rgba(0, 0, 255, 0.5)' });
    // 取色器的值是确认过的颜色，不跟着预览走
    await nextTick();
    expect(fill.props('modelValue')).toBe(committed);

    fill.vm.$emit('activeChange', committed);
    expect(symbols.preview.value).toBeNull();

    fill.vm.$emit('activeChange', 'rgba(0, 128, 0, 0.8)');
    fill.vm.$emit('change', 'rgba(0, 128, 0, 0.8)');
    expect(symbols.preview.value).toBeNull();
    expect(symbols.overrides.value.get('szy_kt')).toStrictEqual({ uniform: { fillColor: 'rgba(0, 128, 0, 0.8)' } });
    await nextTick();
    expect(picker(wrapper, '坑塘的填充色').props('modelValue')).toBe('rgba(0, 128, 0, 0.8)');
  });

  it('线：颜色、线宽、线型', () => {
    const line = mountEditor('bgdc_cjdcqjx');
    expect(line.wrapper.findAllComponents(ElColorPicker).map(item => item.props('ariaLabel'))).toStrictEqual([
      '村级调查区界线的颜色'
    ]);
    line.wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'dashDot');
    expect(line.symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { dash: 'dashDot' } });
  });

  it('面（ADR 0045）：填充方式、颜色、描边宽度、描边线型；有花纹时才有纹理颜色，无填充时没有填充色', async () => {
    const { wrapper, symbols } = mountEditor('szy_kt');
    const pickers = () => wrapper.findAllComponents(ElColorPicker).map(item => item.props('ariaLabel'));
    expect(pickers()).toStrictEqual(['坑塘的填充色', '坑塘的描边色']);
    const [fillStyle, outlineDash] = wrapper.findAllComponents(ElSelect);

    fillStyle?.vm.$emit('update:modelValue', 'diagonal');
    await nextTick();
    expect(pickers()).toStrictEqual(['坑塘的填充色', '坑塘的纹理颜色', '坑塘的描边色']);
    fillStyle?.vm.$emit('update:modelValue', 'none');
    await nextTick();
    expect(pickers()).toStrictEqual(['坑塘的描边色']);

    outlineDash?.vm.$emit('update:modelValue', 'dotted');
    await choose(wrapper, 'XL');
    expect(symbols.overrides.value.get('szy_kt')).toStrictEqual({
      uniform: { fillStyle: 'none', outlineWidth: 'XL', outlineDash: 'dotted' }
    });
  });

  it('面的描边宽度可以自定义 0～8 像素，0 是无描边；清空输入框不算 0', async () => {
    const { wrapper, symbols } = mountEditor('szy_kt');
    await choose(wrapper, '自定义');
    const input = wrapper.get('input[aria-label="自定义描边宽度，0～8 像素"]');
    const submit = async (text: string) => {
      await input.setValue(text);
      await input.trigger('keydown', { key: 'Enter' });
      return wrapper.find('[class*="invalid"]').exists();
    };

    expect(await submit('0')).toBe(false);
    expect(symbols.symbolOf({ code: 'szy_kt' })).toMatchObject({ outlineWidth: 0 });
    // 每次不合法的输入之前先输一次合法的，提示要先消失
    expect(await submit('')).toBe(true);
    expect(await submit('0')).toBe(false);
    expect(await submit('8.5')).toBe(true);
    expect(symbols.symbolOf({ code: 'szy_kt' })).toMatchObject({ outlineWidth: 0 });
  });

  it('填充方式的选项带预览：按当前的颜色画出每种填充方式', async () => {
    const { wrapper } = mountEditor('szy_kt');
    // 下拉框打开后才渲染选项
    await wrapper.findComponent(ElSelect).find('.el-select__wrapper').trigger('click');
    await nextTick();
    const options = [...document.body.querySelectorAll<HTMLElement>('[data-fill-style]')];

    expect(options.map(option => option.dataset.fillStyle)).toHaveLength(10);
    const hasPattern = (name: string) =>
      options.find(option => option.dataset.fillStyle === name)?.querySelector('[data-swatch] pattern') !== null;
    expect(hasPattern('dot')).toBe(true);
    expect(hasPattern('solid')).toBe(false);
  });

  it('线型的选项带示意：按当前的颜色和粗细画出每种线型（设计稿 5D.5）', async () => {
    const { wrapper, symbols } = mountEditor('bgdc_cjdcqjx');
    symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { width: 'L' });
    await nextTick();
    await wrapper.findComponent(ElSelect).find('.el-select__wrapper').trigger('click');
    await nextTick();
    // L 档 14 级 2.88 像素，线型的线段和间隔按线宽换算
    expect(dasharray('dashed')).toBe('8.64 5.76');
    expect(dasharray('dotted')).toBe('2.88 5.76');
    expect(dasharray('solid')).toBeNull();
  });

  it('颜色旁写出色值：#RRGGBB，半透明时带百分比', () => {
    const { wrapper } = mountEditor('szy_kt');

    const text = wrapper.get('[data-symbol-editor]').text();
    // 坑塘的默认符号：半透明的填充，同色不透明的描边
    expect(text).toContain('填充色#C74F9B 35%');
    expect(text).toContain('描边色#C74F9B描边宽度');
  });

  it('分类样式的取值：改的是这个取值，恢复默认只恢复它；规则里没有的取值没有编辑器', async () => {
    const { wrapper, symbols } = mountEditor('csxhjctb_hydl', '水渠');
    symbols.setSymbol({ code: 'csxhjctb_hydl' }, { width: 'S' });
    expect(picker(wrapper, '水渠的颜色').props('modelValue')).toBe('#4FC3F7');

    await choose(wrapper, 'XL');
    picker(wrapper, '水渠的颜色').vm.$emit('activeChange', 'rgba(0, 0, 0, 1)');
    expect(symbols.preview.value).toMatchObject({ item: '水渠', field: 'color' });
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ uniform: { width: 'S' }, items: { 水渠: { width: 'XL' } } });

    await wrapper.findAll('button').find(item => item.text() === '恢复默认')?.trigger('click');
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ uniform: { width: 'S' } });
    expect(mountEditor('csxhjctb_hydl', '湖泊').wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });
});

describe('SymbolEditor：卸载和换目标时的预览', () => {
  it('收起编辑器时丢弃这个目标没确认的预览；之后别的编辑器开始的预览不受它卸载的影响', async () => {
    const { wrapper, symbols, targets, renders } = mountEditors([{ code: 'szy_kt' }, { code: 'bgdc_cjdcqjx' }]);
    picker(wrapper, '坑塘的填充色').vm.$emit('activeChange', 'rgba(0, 0, 255, 0.5)');
    // 页面重新渲染给出新的目标对象，目标没变，预览保留
    renders.value += 1;
    await nextTick();
    expect(symbols.preview.value).toMatchObject({ code: 'szy_kt', field: 'fillColor' });

    targets.value = [{ code: 'bgdc_cjdcqjx' }];
    await nextTick();
    expect(symbols.preview.value).toBeNull();

    // 坑塘拖动到一半，别的编辑器开始了新的预览：坑塘卸载时不动它
    targets.value = [{ code: 'szy_kt' }, { code: 'bgdc_cjdcqjx' }];
    await nextTick();
    picker(wrapper, '坑塘的填充色').vm.$emit('activeChange', 'rgba(0, 0, 255, 0.5)');
    picker(wrapper, '村级调查区界线的颜色').vm.$emit('activeChange', 'rgba(255, 0, 0, 1)');
    targets.value = [{ code: 'bgdc_cjdcqjx' }];
    await nextTick();
    expect(symbols.preview.value).toStrictEqual({ code: 'bgdc_cjdcqjx', field: 'color', color: 'rgba(255, 0, 0, 1)' });
    expect(symbols.overrides.value.size).toBe(0);
  });

  it('编辑器换了目标时丢弃原目标的预览；预览属于别的资源时不动', async () => {
    const { wrapper, symbols, targets } = mountEditors([{ code: 'csxhjctb_hydl', item: '水渠' }]);
    picker(wrapper, '水渠的颜色').vm.$emit('activeChange', 'rgba(0, 0, 0, 1)');
    expect(symbols.preview.value).toMatchObject({ item: '水渠' });

    // 同一个编辑器改编辑河流
    targets.value = [{ code: 'csxhjctb_hydl', item: '河流' }];
    await nextTick();
    expect(symbols.preview.value).toBeNull();

    symbols.previewColor({ code: 'szy_kt' }, 'fillColor', 'rgba(0, 0, 255, 0.5)');
    targets.value = [{ code: 'csxhjctb_hydl', item: '水渠' }];
    await nextTick();
    expect(symbols.preview.value).toMatchObject({ code: 'szy_kt' });
  });
});
