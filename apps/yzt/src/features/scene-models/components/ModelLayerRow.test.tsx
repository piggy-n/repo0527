import type { CameraState, RoamStatus, SceneStatus } from '@mx/map-core';
import { type CameraControl, MAPLIBRE_ENGINE } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { ElOption, ElSelect } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { sceneManifestSchema } from '../api';
import { buildModelCatalog } from '../catalog';
import { type SceneModels, useSceneModels } from '../composables/useSceneModels';
import { ModelLayerRow, roamTip } from './ModelLayerRow';

const CAMERA: CameraState = { center: [120.66, 31.31], zoom: 16, bearing: 0, pitch: 55 };

const CATALOG = buildModelCatalog(
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

// 拥有者用测试控制的状态报告；三个模型都已加入，每个一行
function mountRows() {
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const roamStatus = shallowRef<RoamStatus | null>(null);
  const dimension = ref<'2d' | '3d'>('3d');
  const control = { flyTo: vi.fn<CameraControl['flyTo']>() } as unknown as CameraControl;
  const onRemove = vi.fn<(id: string) => void>();
  let owner: SceneModels | undefined;
  const Page = defineComponent(() => {
    const models = useSceneModels(
      {
        sceneStatus,
        roamStatus,
        dimension,
        sceneCapabilities: MAPLIBRE_ENGINE.capabilities,
        runCameraOperation: action => action(control),
        beginCameraOperation: () => ({ signal: new AbortController().signal, run: action => action(control) })
      },
      CATALOG
    );
    models.add(['station', 'white', 'city']);
    owner = models;
    return () => (
      <ul>
        {models.added.value.map(id => (
          <li key={id} data-row={id}>
            <ModelLayerRow models={models} id={id} scene={dimension.value === '3d'} onRemove={() => onRemove(id)} />
          </li>
        ))}
      </ul>
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
  return { wrapper, owner: required(owner, '页面没有创建拥有者'), dimension, report, onRemove };
}

describe('ModelLayerRow', () => {
  it('三维里加载中转圈，失败时红色图标和"重试"（加重试次数），就绪后没有状态；二维里、隐藏时不显示状态', async () => {
    const { wrapper, owner, dimension, report } = mountRows();
    const row = (id: string) => wrapper.get(`[data-row="${id}"]`);
    expect(row('station').find('[aria-label="加载中"]').exists()).toBe(true);

    await report({ station: 'failed', city: 'ready' });
    expect(row('station').find('[aria-label="加载失败"]').exists()).toBe(true);
    await row('station').get('button[aria-label="重新加载：苏州站地下空间"]').trigger('click');
    expect(owner.deriveContent().tilesets.find(({ id }) => id === 'station')?.attempt).toBe(1);
    expect(row('city').find('[aria-label="加载中"]').exists()).toBe(false);

    owner.setVisible('station', false);
    await nextTick();
    expect(row('station').find('[aria-label="加载失败"]').exists()).toBe(false);
    dimension.value = '2d';
    await nextTick();
    expect(row('white').find('[aria-label="加载中"]').exists()).toBe(false);
  });

  it('名称的提示带市和类型；白膜的行尾是效果，二维里照样能换；移除报告给页面', async () => {
    const { wrapper, owner, dimension, onRemove } = mountRows();
    expect(wrapper.get('[data-row="city"] [data-row-text]').attributes('title')).toBe('新街口倾斜摄影 · 南京市 · 倾斜摄影');

    dimension.value = '2d';
    await nextTick();
    const select = wrapper.get('[data-row="white"]').findComponent(ElSelect);
    expect(select.props('modelValue')).toBe('plain');
    expect(select.findAllComponents(ElOption).map(option => option.props('label'))).toStrictEqual([
      '无纹理',
      '内置效果1'
    ]);
    select.vm.$emit('update:modelValue', 'window');
    await nextTick();
    expect(owner.effectOf('white')).toBe('window');

    await wrapper.get('button[aria-label="移除：苏州白膜"]').trigger('click');
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('white');
  });

  it('能漫游的才有"漫游"：二维里、隐藏时、加载完成以前不能点，提示里写原因', async () => {
    const { wrapper, owner, dimension, report } = mountRows();
    expect(wrapper.find('[data-roam="city"]').exists()).toBe(false);
    const roam = () => wrapper.get('[data-roam="station"]');
    expect(roam().attributes('aria-disabled')).toBe('true');

    await report({ station: 'ready' });
    expect(roam().attributes('aria-disabled')).toBe('false');
    dimension.value = '2d';
    await nextTick();
    expect(roam().attributes('aria-disabled')).toBe('true');
    await roam().trigger('click');
    expect(owner.roam.value).toBeNull();

    dimension.value = '3d';
    owner.setVisible('station', false);
    await nextTick();
    expect(roam().attributes('aria-disabled')).toBe('true');

    expect(roamTip(false, false, true)).toBe('漫游（切换到三维后可用）');
    expect(roamTip(true, true, true)).toBe('漫游（显示后可用）');
    expect(roamTip(true, false, false)).toBe('漫游（加载完成后可用）');
    expect(roamTip(true, false, true)).toBe('漫游');
  });
});
