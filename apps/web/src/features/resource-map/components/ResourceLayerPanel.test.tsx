import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '../api';
import { buildCatalog, type ResourceCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { ResourceLayerPanel } from './ResourceLayerPanel';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function layer(code: string, name: string, geoType: 'Polygon' | 'Line' | 'Point' = 'Polygon') {
  return { code, name, geoType, yearList: [2024] as [number] };
}

// 结构同真实的资源树；只有地类图斑默认勾选
const CATALOG = buildCatalog([
  {
    code: null,
    name: '基础库',
    children: [
      {
        code: 'tdzy',
        name: '土地资源',
        children: [
          layer('bgdc_dltb', '地类图斑'),
          layer('bgdc_cjdcq', '村级调查区'),
          layer('csxhjctb_hydl', '水域线层', 'Line')
        ]
      },
      { code: 'szy', name: '水资源', children: [layer('szy_kt', '坑塘')] }
    ]
  }
] satisfies ResourceTreeCategory[]);

/** 页面创建地图和拥有者，渲染面板；没有画布，只看面板和拥有者的状态。null 表示目录还没到 */
function mountPanel(catalog: ResourceCatalog | null = CATALOG) {
  const source = shallowRef(catalog ?? undefined);
  const failed = ref(false);
  const onRetry = vi.fn<() => void>();
  let owner: ResourceLayers | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const layers = useResourceLayers(map, { catalog: source, tileBase: 'http://localhost/tiles/' });
    map.bindStyle({ resources: layers.deriveGroup });
    owner = layers;
    return () => <ResourceLayerPanel layers={layers} failed={failed.value} onRetry={onRetry} />;
  });
  const wrapper = mount(Page);
  if (!owner) {
    throw new Error('页面没有创建资源图层的拥有者');
  }
  return { wrapper, owner, source, failed, onRetry };
}

function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

// 目录树里的一行（资源或分类）的复选框
function checkbox(wrapper: VueWrapper, selector: string) {
  return wrapper.get(`${selector} input[type="checkbox"]`);
}

const visibleResources = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-resource]').map(row => row.attributes('data-resource'));

const checkedOrder = (wrapper: VueWrapper) => wrapper.findAll('[data-layer]').map(row => row.attributes('data-layer'));

describe('ResourceLayerPanel', () => {
  it('目录还没到：显示加载中；加载失败：显示失败和重试', async () => {
    const { wrapper, failed, onRetry } = mountPanel(null);
    expect(wrapper.text()).toContain('正在加载资源目录');

    failed.value = true;
    await nextTick();
    await wrapper.findAll('button').find(item => item.text() === '重试')?.trigger('click');

    expect(wrapper.text()).toContain('资源目录加载失败');
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('默认展开含有勾选资源的分类；点击箭头展开、收起分类', async () => {
    const { wrapper } = mountPanel();
    expect(visibleResources(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);

    await button(wrapper, '展开水资源').trigger('click');
    expect(visibleResources(wrapper)).toContain('szy_kt');

    await button(wrapper, '收起基础库').trigger('click');
    expect(visibleResources(wrapper)).toStrictEqual([]);
  });

  it('勾选分类时下面的资源一起勾选；部分勾选时分类显示半选，资源数显示在旁边', async () => {
    const { wrapper, owner } = mountPanel();
    const land = '[data-category="基础库 / 土地资源"]';
    expect(wrapper.get(`${land} .el-checkbox__input`).classes()).toContain('is-indeterminate');
    expect(wrapper.get(land).text()).toContain('3');

    await checkbox(wrapper, `${land} > div`).setValue(true);
    expect(checkedOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);

    await checkbox(wrapper, '[data-resource="bgdc_cjdcq"]').setValue(false);
    expect(owner.state.value.displays.get('bgdc_cjdcq')?.checked).toBe(false);
    expect(wrapper.get(`${land} .el-checkbox__input`).classes()).toContain('is-indeterminate');
  });

  it('搜索：只显示命中的资源并展开它的路径；没有命中时提示', async () => {
    const { wrapper } = mountPanel();
    const input = wrapper.get('input[placeholder="搜索资源或分类"]');

    await input.setValue('坑塘');
    expect(visibleResources(wrapper)).toStrictEqual(['szy_kt']);

    await input.setValue('没有这个');
    expect(wrapper.text()).toContain('没有找到资源');
  });

  it('已勾选区按叠放顺序列出；上移、下移改变顺序，到顶、到底时按钮不可用', async () => {
    const { wrapper } = mountPanel();
    await checkbox(wrapper, '[data-resource="csxhjctb_hydl"]').setValue(true);
    expect(checkedOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
    expect(button(wrapper, '上移地类图斑').attributes('disabled')).toBeDefined();

    await button(wrapper, '上移水域线层').trigger('click');

    expect(checkedOrder(wrapper)).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb']);
    expect(button(wrapper, '上移水域线层').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '下移地类图斑').attributes('disabled')).toBeDefined();
    await button(wrapper, '下移水域线层').trigger('click');
    expect(checkedOrder(wrapper)).toStrictEqual(['bgdc_dltb', 'csxhjctb_hydl']);
  });

  it('透明度：点开滑块按百分比显示，拖动时把 0～1 的透明度交给拥有者', async () => {
    const { wrapper, owner } = mountPanel();
    expect(wrapper.findComponent(ElSlider).exists()).toBe(false);

    await button(wrapper, '地类图斑的透明度').trigger('click');
    const slider = wrapper.findComponent(ElSlider);
    expect(slider.props('modelValue')).toBe(90);
    slider.vm.$emit('update:modelValue', 40);

    expect(owner.state.value.displays.get('bgdc_dltb')?.opacity).toBe(0.4);
  });

  it('收起面板只留标题', async () => {
    const { wrapper } = mountPanel();

    await button(wrapper, '收起资源图层').trigger('click');

    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toBe('资源图层');
    await button(wrapper, '展开资源图层').trigger('click');
    expect(visibleResources(wrapper)).toHaveLength(3);
  });
});
