import { mount, type VueWrapper } from '@vue/test-utils';
import { ElColorPicker, ElSelect } from 'element-plus';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
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

function mountEditor(code: string) {
  let owner: ResourceSymbols | undefined;
  const Page = defineComponent(() => {
    const symbols = useResourceSymbols({ catalog: shallowRef(CATALOG) });
    owner = symbols;
    return () => <SymbolEditor symbols={symbols} code={code} name={CATALOG.resources.get(code)?.name ?? code} />;
  });
  const wrapper = mount(Page);
  if (!owner) {
    throw new Error('页面没有创建符号的拥有者');
  }
  return { wrapper, symbols: owner };
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

describe('SymbolEditor', () => {
  it('点：档位、描边宽度点下就确认；改过之后可以恢复默认，只恢复这个资源', async () => {
    const { wrapper, symbols } = mountEditor('csxhjctb_gyssp');
    symbols.setUniform('szy_kt', { fillColor: '#000' });
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

    symbols.resetUniform('bgdc_cjdcqjx');
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

    symbols.setUniform('csxhjctb_gyssp', { size: 6 });
    await nextTick();
    await customInput(wrapper).setValue('30');
    await customInput(wrapper).trigger('keydown', { key: 'Enter' });
    symbols.setUniform('csxhjctb_gyssp', { size: 8 });
    await nextTick();
    expect((customInput(wrapper).element as HTMLInputElement).value).toBe('8');
    expect(invalidShown()).toBe(false);
  });

  it('颜色：拖动时预览，确认时写入；取消时取色器报回原来的颜色，预览清掉', async () => {
    const { wrapper, symbols } = mountEditor('szy_kt');
    const fill = picker(wrapper, '坑塘的填充色');
    const committed = fill.props('modelValue');

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

  it('线：颜色、线宽、线型；面：只有填充色和描边色', async () => {
    const line = mountEditor('bgdc_cjdcqjx');
    expect(line.wrapper.findAllComponents(ElColorPicker).map(item => item.props('ariaLabel'))).toStrictEqual([
      '村级调查区界线的颜色'
    ]);
    line.wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'dashDot');
    expect(line.symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { dash: 'dashDot' } });

    const fill = mountEditor('szy_kt');
    expect(fill.wrapper.findAllComponents(ElColorPicker).map(item => item.props('ariaLabel'))).toStrictEqual([
      '坑塘的填充色',
      '坑塘的描边色'
    ]);
    expect(fill.wrapper.findAll('label').map(item => item.text())).toStrictEqual([]);
  });

  it('按属性配色的资源没有统一符号的编辑器', () => {
    const { wrapper } = mountEditor('csxhjctb_hydl');

    expect(wrapper.find('[data-symbol-editor]').exists()).toBe(false);
  });
});
