import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { ResourceLegend } from './ResourceLegend';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function layer(code: string, name: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name, geoType, yearList: [2022] as [number] };
}

// 地类、按取值配色、统一符号各一个；只有地类图斑默认勾选
const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_dltb', '地类图斑', 'Polygon'),
      layer('csxhjctb_hydl', '水域线层', 'Line'),
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

const entries = (wrapper: VueWrapper) => wrapper.findAll('[data-legend]').map(item => item.attributes('data-legend'));
const landuseShown = (wrapper: VueWrapper) => wrapper.find('[data-landuse-section]').exists();

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

  it('统一符号只有一行预览；按取值配色展开后列出取值和"其他"', async () => {
    const { wrapper, owner } = mountLegend();
    owner.setCheckedMany(['csxhjctb_hydl', 'szy_kt'], true);
    await openLegend(wrapper);

    expect(wrapper.get('[data-legend="szy_kt"]').text()).toBe('坑塘');
    expect(wrapper.get('[data-legend="szy_kt"] span').attributes('style')).toContain('background-color');
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
    const swatchStyle = () => wrapper.get('[data-legend="szy_kt"] span').attributes('style');

    symbols.setUniform('szy_kt', { fillColor: 'rgba(0, 0, 255, 0.5)' });
    await nextTick();
    expect(swatchStyle()).toContain('background-color: rgba(0, 0, 255, 0.5)');

    symbols.previewColor('szy_kt', 'fillColor', 'rgba(0, 128, 0, 0.8)');
    await nextTick();
    expect(swatchStyle()).toContain('background-color: rgba(0, 128, 0, 0.8)');

    symbols.clearPreview();
    await nextTick();
    expect(swatchStyle()).toContain('background-color: rgba(0, 0, 255, 0.5)');
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
