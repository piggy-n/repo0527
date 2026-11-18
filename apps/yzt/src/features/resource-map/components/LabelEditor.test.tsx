import { mount, type VueWrapper } from '@vue/test-utils';
import { ElColorPicker, ElSelect, ElSlider, ElSwitch } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { LabelEditor, zoomRangeText } from './LabelEditor';

function layer(code: string, name: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name, geoType, yearList: [2025] as [number] };
}

// 学校点层登记了标注字段，未登记的坑塘界线（bgdc_ccwjq）没有
const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [layer('csxhjctb_xxp', '学校点层', 'Point'), layer('bgdc_ccwjq', '城乡结合区', 'Polygon')]
  }
]);

function mountEditor(code = 'csxhjctb_xxp') {
  let symbolsOwner: ResourceSymbols | undefined;
  let layersOwner: ResourceLayers | undefined;
  const Page = defineComponent(() => {
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(
      {
        dimension: shallowRef('2d'),
        sceneCapabilities: { styleLayers: true, identify: true, splats: true }
      },
      { catalog, symbols, tileBase: 'http://localhost/tiles/' }
    );
    layers.add([code]);
    symbolsOwner = symbols;
    layersOwner = layers;
    return () => <LabelEditor layers={layers} symbols={symbols} code={code} />;
  });
  const wrapper = mount(Page);
  if (!symbolsOwner || !layersOwner) {
    throw new Error('页面没有创建拥有者');
  }
  return { wrapper, symbols: symbolsOwner, layers: layersOwner };
}

const switchOf = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAllComponents(ElSwitch).find(item => item.props('ariaLabel') === label);
  if (!found) {
    throw new Error(`没有开关 ${label}`);
  }
  return found;
};

// jsdom 里点 label 不会切换单选按钮，直接设置里面的 input（同符号编辑器的测试）
async function choose(wrapper: VueWrapper, text: string) {
  const label = wrapper.findAll('label').find(item => item.text() === text);
  if (!label) {
    throw new Error(`没有选项 ${text}`);
  }
  await label.get('input').setValue(true);
}

// Element 的提示挂在 body 下，不归组件管
afterEach(() => {
  document.body.innerHTML = '';
});

describe('LabelEditor（ADR 0160）', () => {
  it('最上面是"显示标注"开关，默认关；关着时编辑器的控件都不能用，打开后能用', async () => {
    const { wrapper, layers } = mountEditor();
    const fieldSelect = () => wrapper.findAllComponents(ElSelect)[0];

    expect(switchOf(wrapper, '显示学校点层的标注').props('modelValue')).toBe(false);
    expect(fieldSelect()?.props('disabled')).toBe(true);
    expect(wrapper.findComponent(ElSlider).props('disabled')).toBe(true);

    switchOf(wrapper, '显示学校点层的标注').vm.$emit('update:modelValue', true);
    await nextTick();

    expect(layers.state.value.displays.get('csxhjctb_xxp')?.labeled).toBe(true);
    expect(fieldSelect()?.props('disabled')).toBe(false);
  });

  it('字段、字号、描边宽度、放置、压盖点下就保存；点的放置是自动、右侧、下方，默认下方（用户 2026-11-16）', async () => {
    const { wrapper, symbols, layers } = mountEditor();
    layers.setLabeled('csxhjctb_xxp', true);
    await nextTick();

    expect(wrapper.text()).toContain('自动右侧下方');
    expect(wrapper.text()).not.toContain('上方');
    const checked = wrapper.findAll('label').filter(item => item.get('input').element.checked);
    expect(checked.map(item => item.text())).toContain('下方');
    wrapper.findAllComponents(ElSelect)[0]?.vm.$emit('update:modelValue', 'type');
    await choose(wrapper, '16');
    await choose(wrapper, '3');
    await choose(wrapper, '右侧');
    switchOf(wrapper, '标注的压盖').vm.$emit('update:modelValue', true);
    await nextTick();

    expect(symbols.overrides.value.get('csxhjctb_xxp')?.label).toStrictEqual({
      field: 'type',
      size: 16,
      haloWidth: 3,
      placement: 'right',
      overlap: true
    });
  });

  it('颜色拖动时只预览，确认时写入；编辑器卸载时丢弃没确认的预览', async () => {
    const { wrapper, symbols, layers } = mountEditor();
    layers.setLabeled('csxhjctb_xxp', true);
    await nextTick();
    const colorPicker = () => {
      const found = wrapper.findAllComponents(ElColorPicker).find(item => item.props('ariaLabel') === '标注的颜色');
      if (!found) {
        throw new Error('没有颜色的取色器');
      }
      return found;
    };

    colorPicker().vm.$emit('activeChange', '#FF0000');
    expect(symbols.overrides.value.has('csxhjctb_xxp')).toBe(false);
    expect(symbols.overrideOf('csxhjctb_xxp')?.label?.color).toBe('rgba(255, 0, 0, 1)');

    colorPicker().vm.$emit('change', '#0000FF');
    expect(symbols.overrides.value.get('csxhjctb_xxp')?.label).toStrictEqual({ color: 'rgba(0, 0, 255, 1)' });

    colorPicker().vm.$emit('activeChange', '#00FF00');
    wrapper.unmount();
    expect(symbols.overrideOf('csxhjctb_xxp')?.label).toStrictEqual({ color: 'rgba(0, 0, 255, 1)' });
  });

  it('显示级别松手时写入，拖动中只显示；最大级别拉到头写"N 级起"', async () => {
    const { wrapper, symbols, layers } = mountEditor();
    layers.setLabeled('csxhjctb_xxp', true);
    await nextTick();
    const slider = wrapper.findComponent(ElSlider);

    slider.vm.$emit('update:modelValue', [12, 17]);
    await nextTick();
    expect(wrapper.text()).toContain('12～17 级');
    expect(symbols.overrides.value.has('csxhjctb_xxp')).toBe(false);

    slider.vm.$emit('change', [12, 17]);
    await nextTick();
    expect(symbols.overrides.value.get('csxhjctb_xxp')?.label).toStrictEqual({ minzoom: 12, maxzoom: 17 });
    expect(zoomRangeText(14, 20)).toBe('14 级起');
  });

  it('恢复默认标注只在改过时能用（关着标注时也能用），去掉这个资源的标注；压盖的说明在问号里', async () => {
    const { wrapper, symbols, layers } = mountEditor();
    layers.setLabeled('csxhjctb_xxp', true);
    await nextTick();
    const reset = () => {
      const found = wrapper.findAll('button').find(button => button.text() === '恢复默认标注');
      if (!found) {
        throw new Error('没有恢复默认标注');
      }
      return found;
    };

    expect(reset().attributes('disabled')).toBeDefined();
    symbols.setLabel('csxhjctb_xxp', { size: 18 });
    // 关着标注时也能恢复：只改了标注的资源，图例上没有别的入口清掉它
    layers.setLabeled('csxhjctb_xxp', false);
    await nextTick();
    expect(reset().attributes('disabled')).toBeUndefined();
    await reset().trigger('click');

    expect(symbols.overrides.value.has('csxhjctb_xxp')).toBe(false);
    expect(wrapper.find('[aria-label="压盖：文字之间允许重叠"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('文字之间允许重叠');
  });

  it('压盖后面的问号：悬停或键盘聚焦时显示"文字之间允许重叠"', async () => {
    const { wrapper, layers } = mountEditor();
    layers.setLabeled('csxhjctb_xxp', true);
    await nextTick();
    expect(document.body.textContent).not.toContain('文字之间允许重叠');

    await wrapper.get('[aria-label="压盖：文字之间允许重叠"]').trigger('focus');

    await vi.waitFor(() => expect(document.body.textContent).toContain('文字之间允许重叠'));
  });

  it('没有登记标注字段的资源说明没有字段', () => {
    const { wrapper } = mountEditor('bgdc_ccwjq');

    expect(wrapper.text()).toBe('这个资源没有可标注的字段');
  });
});
