import type { CameraState, SceneStatus } from '@yzt/map-core';
import { type CameraControl, provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElOption, ElSelect, ElSlider } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { sceneManifestSchema } from '../api';
import { buildModelCatalog, type SceneModel } from '../catalog';
import { type SceneModels, useSceneModels } from '../composables/useSceneModels';
import { SceneModelPanel } from './SceneModelPanel';
import { UndergroundBar } from './UndergroundBar';
import styles from './SceneModelPanel.module.scss';

const CAMERA: CameraState = { center: [120.66, 31.31], zoom: 16, bearing: 0, pitch: 55 };

// 结构同入库的清单，多一个南京的倾斜摄影
const CATALOG = buildModelCatalog(
  sceneManifestSchema.parse({
    models: [
      { id: 'station', name: '苏州站地下空间', cityCode: '320500', kind: 'indoor', underground: true, tileset: 'S.json' },
      {
        id: 'white',
        name: '苏州白膜',
        cityCode: '320500',
        kind: 'white',
        underground: false,
        effects: [
          { id: 'plain', label: '无纹理', tileset: 'W/plain.json' },
          { id: 'window', label: '内置效果1', tileset: 'W/window.json' }
        ]
      },
      { id: 'city', name: '新街口倾斜摄影', cityCode: '320100', kind: 'oblique', underground: false, tileset: 'C.json' }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

/** 页面创建地图和拥有者，渲染面板和钻地条；状态报告和相机操作换成测试控制的。null 表示清单还没到 */
function mountPanel(catalog: readonly SceneModel[] | null = CATALOG) {
  const source = shallowRef(catalog ?? undefined);
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control = { flyTo } as unknown as CameraControl;
  const failed = ref(false);
  const onRetry = vi.fn<() => void>();
  const collapsed = ref(false);
  let owner: SceneModels | undefined;
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: CAMERA });
    owner = useSceneModels({ sceneStatus, runCameraOperation: action => action(control) }, source);
    const models = owner;
    return () => (
      <div>
        <SceneModelPanel
          models={models}
          failed={failed.value}
          collapsed={collapsed.value}
          onRetry={onRetry}
          onUpdate:collapsed={value => (collapsed.value = value)}
        />
        <UndergroundBar models={models} />
      </div>
    );
  });
  const wrapper = mount(Page);
  const report = (entries: Record<string, 'ready' | 'failed'>) => {
    sceneStatus.value = new Map(
      Object.entries(entries).map(([id, state]) => [
        id,
        state === 'ready' ? { state, camera: CAMERA } : { state, error: new Error('404') }
      ])
    );
    return nextTick();
  };
  return { wrapper, owner: required(owner, '页面没有创建拥有者'), source, failed, onRetry, collapsed, flyTo, report };
}

function button(wrapper: VueWrapper, label: string, within = '') {
  return wrapper.get(`${within} button[aria-label="${label}"]`);
}

const check = (wrapper: VueWrapper, id: string, value: boolean) =>
  wrapper.get(`[data-model="${id}"] input[type="checkbox"]`).setValue(value);

const loadedIds = (wrapper: VueWrapper) => wrapper.findAll('[data-loaded]').map(row => row.attributes('data-loaded'));

const cityRows = (wrapper: VueWrapper) =>
  wrapper.findAll('button[aria-expanded]').filter(row => row.text().includes('市')).map(row => row.text());

describe('SceneModelPanel', () => {
  it('清单还没到时显示加载中；失败时显示重试；空清单显示暂无三维模型', async () => {
    const { wrapper, source, failed, onRetry } = mountPanel(null);
    expect(wrapper.text()).toContain('正在加载模型清单…');

    failed.value = true;
    await nextTick();
    await wrapper.findAll('button').find(item => item.text() === '重试')?.trigger('click');
    expect(onRetry).toHaveBeenCalledOnce();

    source.value = [];
    await nextTick();
    expect(wrapper.text()).toContain('暂无三维模型');
  });

  it('按市分组、默认展开，带数量；点市收起；搜索时只列匹配的、不能收起，没有匹配时提示', async () => {
    const { wrapper } = mountPanel();
    expect(cityRows(wrapper)).toStrictEqual(['苏州市2', '南京市1']);
    expect(wrapper.findAll('[data-model]').map(row => row.attributes('data-model'))).toStrictEqual([
      'station',
      'white',
      'city'
    ]);

    await wrapper.findAll('button[aria-expanded]')[0]?.trigger('click');
    expect(wrapper.findAll('[data-model]').map(row => row.attributes('data-model'))).toStrictEqual(['city']);

    await wrapper.get('input[placeholder="搜索模型或所属市"]').setValue('白膜');
    expect(cityRows(wrapper)).toStrictEqual(['苏州市1']);
    expect(wrapper.findAll('[data-model]').map(row => row.attributes('data-model'))).toStrictEqual(['white']);
    expect(wrapper.get('button[aria-expanded]').attributes('disabled')).toBeDefined();

    await wrapper.get('input[placeholder="搜索模型或所属市"]').setValue('没有的');
    expect(wrapper.text()).toContain('没有找到模型');
  });

  it('勾选即加载：已加载按勾选的先后；加载中不能定位，失败可以重试，就绪后显示市和类型', async () => {
    const { wrapper, owner, report } = mountPanel();
    await check(wrapper, 'city', true);
    await check(wrapper, 'station', true);

    expect(loadedIds(wrapper)).toStrictEqual(['city', 'station']);
    expect(wrapper.text()).toContain('已加载2');
    expect(wrapper.find('[data-model="station"] [aria-label="加载中"]').exists()).toBe(true);
    expect(wrapper.find('[data-model="white"] [aria-label="加载中"]').exists()).toBe(false);
    expect(wrapper.get('[data-loaded="station"]').text()).toContain('加载中…');
    expect(button(wrapper, '定位', '[data-loaded="station"]').attributes('disabled')).toBeDefined();

    await report({ station: 'failed', city: 'ready' });
    expect(wrapper.get('[data-model="station"]').text()).toContain('失败');
    const station = wrapper.get('[data-loaded="station"]');
    expect(station.text()).toContain('加载失败');
    await station.findAll('button').find(item => item.text() === '重试')?.trigger('click');
    expect(owner.deriveContent().tilesets.find(({ id }) => id === 'station')?.attempt).toBe(1);

    expect(wrapper.get('[data-loaded="city"]').text()).toContain('南京市 · 倾斜摄影');
    expect(button(wrapper, '定位', '[data-loaded="city"]').attributes('disabled')).toBeUndefined();
  });

  it('定位：飞到报告的相机并标为当前；地下的模型标上钻地，钻地条可以调地表不透明度、退出钻地', async () => {
    const { wrapper, owner, flyTo, report } = mountPanel();
    await check(wrapper, 'station', true);
    await report({ station: 'ready' });
    expect(wrapper.find('[data-underground-bar]').exists()).toBe(false);

    await button(wrapper, '定位', '[data-loaded="station"]').trigger('click');

    expect(flyTo).toHaveBeenCalledWith(CAMERA);
    expect(wrapper.get('[data-loaded="station"]').classes()).toContain(styles.focused);
    expect(wrapper.get('[data-loaded="station"]').text()).toContain('钻地');
    const bar = wrapper.get('[data-underground-bar]');
    expect(bar.text()).toContain('钻地观察 · 苏州站地下空间');
    expect(bar.text()).toContain('25%');
    expect(bar.findComponent(ElSlider).props()).toMatchObject({ min: 0, max: 60, step: 5, modelValue: 25 });

    bar.findComponent(ElSlider).vm.$emit('update:modelValue', 40);
    await nextTick();
    expect(owner.underground.value?.opacity).toBe(0.4);
    expect(wrapper.get('[data-underground-bar]').text()).toContain('40%');

    await wrapper.findAll('[data-underground-bar] button').find(item => item.text() === '退出钻地')?.trigger('click');
    expect(wrapper.find('[data-underground-bar]').exists()).toBe(false);
    expect(wrapper.get('[data-loaded="station"]').text()).not.toContain('钻地');
  });

  it('白膜就绪后可以换效果；卸载从已加载里去掉并取消勾选，全部卸载后不显示已加载', async () => {
    const { wrapper, owner, report } = mountPanel();
    await check(wrapper, 'white', true);
    await report({ 'white/plain': 'ready' });

    const select = wrapper.get('[data-loaded="white"]').findComponent(ElSelect);
    expect(select.props('modelValue')).toBe('plain');
    expect(select.findAllComponents(ElOption).map(option => option.props('label'))).toStrictEqual([
      '无纹理',
      '内置效果1'
    ]);
    select.vm.$emit('update:modelValue', 'window');
    await nextTick();
    expect(owner.effectOf('white')).toBe('window');
    // 新效果还没有报告，回到加载中
    expect(wrapper.get('[data-loaded="white"]').text()).toContain('加载中…');

    await button(wrapper, '卸载', '[data-loaded="white"]').trigger('click');
    expect(owner.loaded.value).toStrictEqual([]);
    expect(wrapper.get<HTMLInputElement>('[data-model="white"] input[type="checkbox"]').element.checked).toBe(false);
    expect(wrapper.text()).not.toContain('已加载');
  });

  it('已加载可以收起；面板收起后是竖条，点竖条展开', async () => {
    const { wrapper, collapsed } = mountPanel();
    await check(wrapper, 'city', true);
    await wrapper.findAll('button').find(item => item.text().startsWith('已加载'))?.trigger('click');
    expect(loadedIds(wrapper)).toStrictEqual([]);
    expect(wrapper.text()).toContain('展开');

    await button(wrapper, '收起三维模型').trigger('click');
    expect(collapsed.value).toBe(true);
    expect(wrapper.find('[data-model]').exists()).toBe(false);
    await button(wrapper, '展开三维模型').trigger('click');
    expect(collapsed.value).toBe(false);
  });
});
