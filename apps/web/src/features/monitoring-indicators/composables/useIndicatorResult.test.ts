import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import type { ViewBounds } from '@yzt/map-core';
import type { CameraControl, CameraOperation } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, shallowRef } from 'vue';
import { findRegion, type Region } from '@/shared/map/region/region-catalog';
import type { RegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { required } from '@/shared/testing/required';
import type { IndicatorApi } from '../api';
import type { IndicatorLeaf } from '../indicator-tree';
import { type IndicatorResult, resultLayersOf } from '../result-layers';
import { type IndicatorResultOwner, useIndicatorResult } from './useIndicatorResult';

const leaf = (code: string): IndicatorLeaf => ({
  kind: 'leaf',
  code,
  dataId: `id-${code}`,
  name: `指标${code}`,
  disabled: false,
  status: null,
  result: '40.04%',
  reason: null
});

const resultOf = (id: string): IndicatorResult => ({
  analysisId: id,
  value: '40.04%',
  layers: resultLayersOf([
    { key: 'xxp', name: '社区小学', geometry: 'point' },
    { key: 'roads', name: '路网', geometry: 'line' },
    { key: 'cqjcfwa', name: '城区范围面', geometry: 'fill' }
  ])
});

const NANJING = required(findRegion('320100'), '南京市');
const WUXI = required(findRegion('320200'), '无锡市');
const BOUNDS: ViewBounds = [118.3, 31.2, 119.3, 32.6];

function host(fetchResult: IndicatorApi['fetchResult'] = id => Promise.resolve(resultOf(id))) {
  const fetchResultMock = vi.fn<IndicatorApi['fetchResult']>(fetchResult);
  const api: IndicatorApi = {
    fetchTree: () => Promise.resolve([]),
    verifyCalculation: () => Promise.resolve(false),
    startCalculation: () => Promise.resolve(),
    fetchProgress: () => Promise.resolve(null),
    fetchResult: fetchResultMock
  };
  const fitBounds = vi.fn<CameraControl['fitBounds']>();
  const camera: CameraControl = {
    fitBounds,
    flyTo: vi.fn<CameraControl['flyTo']>(),
    reveal: vi.fn<CameraControl['reveal']>()
  };
  const beginCameraOperation = vi.fn<() => CameraOperation>(() => ({
    signal: new AbortController().signal,
    run: action => action(camera)
  }));
  const load = vi.fn<RegionBoundaryLoader['load']>(region =>
    Promise.resolve({ code: region.code, geometry: SQUARE, bounds: BOUNDS })
  );
  const indicator = shallowRef<IndicatorLeaf | null>(null);
  const region = shallowRef<Region | null>(NANJING);
  let owner: IndicatorResultOwner | undefined;
  const Host = defineComponent({
    setup() {
      owner = useIndicatorResult({
        api,
        indicator: () => indicator.value,
        region: () => region.value,
        map: { beginCameraOperation },
        loader: { load }
      });
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { owner: required(owner, '成果的拥有者'), fetchResult: fetchResultMock, indicator, region, fitBounds, load };
}

const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [118.3, 31.2],
      [119.3, 31.2],
      [119.3, 32.6],
      [118.3, 31.2]
    ]
  ]
};

const layerById = (owner: IndicatorResultOwner, id: string) =>
  owner.deriveGroup().layers.find(layer => layer.id === `indicator-result-${id}`);

describe('useIndicatorResult', () => {
  it('选中指标后按记录 ID 请求成果，换指标时先回到加载中，不显示上一个的成果', async () => {
    const pending: ((value: IndicatorResult) => void)[] = [];
    const { owner, fetchResult, indicator } = host(id =>
      id === 'id-A-33' ? new Promise(resolve => pending.push(resolve)) : Promise.resolve(resultOf(id))
    );
    expect(owner.state.value.kind).toBe('none');
    expect(owner.deriveGroup().layers).toEqual([]);

    indicator.value = leaf('A-32');
    expect(owner.state.value.kind).toBe('loading');
    await flushPromises();
    expect(owner.state.value).toMatchObject({ kind: 'ready', result: { analysisId: 'id-A-32', value: '40.04%' } });
    expect(fetchResult.mock.calls[0]?.[0]).toBe('id-A-32');
    expect(owner.layers.value.map(view => [view.layer.key, view.recolorable])).toEqual([
      ['xxp', false],
      ['roads', true],
      ['cqjcfwa', true]
    ]);

    // 查询的 data 要到下一轮调度才换成新指标的，同步读取时也不能是上一个的成果
    indicator.value = leaf('A-33');
    expect(owner.state.value.kind).toBe('loading');
    expect(owner.deriveGroup().layers).toEqual([]);
    await flushPromises();
    expect(owner.state.value.kind).toBe('loading');

    required(pending[0], '第二个指标的请求')(resultOf('id-A-33'));
    await flushPromises();
    expect(owner.state.value).toMatchObject({ kind: 'ready', result: { analysisId: 'id-A-33' } });
  });

  it('加载失败显示原因，重试后恢复', async () => {
    let fails = true;
    const { owner, indicator } = host(id => (fails ? Promise.reject(new Error('成果加载失败')) : Promise.resolve(resultOf(id))));
    indicator.value = leaf('A-32');
    await flushPromises();
    expect(owner.state.value).toMatchObject({ kind: 'failed', message: '成果加载失败' });

    fails = false;
    owner.retry();
    await flushPromises();
    expect(owner.state.value.kind).toBe('ready');
  });

  it('子图层的显隐按指标记，换回来时还在', async () => {
    const { owner, indicator } = host();
    indicator.value = leaf('A-32');
    await flushPromises();

    owner.setVisible('roads', false);
    expect(owner.layers.value.find(view => view.layer.key === 'roads')?.visible).toBe(false);
    expect(layerById(owner, 'roads')).toMatchObject({ layout: { visibility: 'none' } });

    indicator.value = leaf('A-33');
    await flushPromises();
    expect(owner.layers.value.every(view => view.visible)).toBe(true);

    indicator.value = leaf('A-32');
    await flushPromises();
    expect(owner.layers.value.find(view => view.layer.key === 'roads')?.visible).toBe(false);
  });

  it('拖动取色只改地图上的预览，确认才算改色；改回默认色、换指标都算恢复默认', async () => {
    const { owner, indicator } = host();
    indicator.value = leaf('A-32');
    await flushPromises();
    const roads = () => required(owner.layers.value.find(view => view.layer.key === 'roads'), '路网');

    owner.previewColor('roads', 'rgb(255, 0, 0)');
    expect(layerById(owner, 'roads')).toMatchObject({ paint: { 'line-color': 'rgb(255, 0, 0)' } });
    expect(roads()).toMatchObject({ color: '#90966F', customized: false });

    owner.setColor('roads', 'rgb(255, 0, 0)');
    expect(roads()).toMatchObject({ color: 'rgb(255, 0, 0)', customized: true });
    // 取色器在 Esc、点外面时把颜色重置回 modelValue：预览等于确认过的颜色就是没有预览
    owner.previewColor('roads', 'rgb(0, 0, 255)');
    owner.previewColor('roads', 'rgb(255, 0, 0)');
    expect(layerById(owner, 'roads')).toMatchObject({ paint: { 'line-color': 'rgb(255, 0, 0)' } });

    owner.setColor('roads', 'rgb(144, 150, 111)');
    expect(roads()).toMatchObject({ color: '#90966F', customized: false });

    owner.setColor('roads', '#00FF00');
    owner.resetColor('roads');
    expect(roads().customized).toBe(false);

    owner.setColor('roads', '#00FF00');
    indicator.value = leaf('A-33');
    await flushPromises();
    expect(roads().customized).toBe(false);
  });

  it('选中指标时定位到监测范围；同一范围里换指标不再移动，换了范围或取消后再选会重新定位', async () => {
    const { indicator, region, fitBounds, load } = host();

    indicator.value = leaf('A-32');
    await flushPromises();
    expect(load).toHaveBeenCalledWith(NANJING);
    expect(fitBounds).toHaveBeenCalledWith(BOUNDS, { duration: 900, maxZoom: 13.5, pitch: 0 });

    indicator.value = leaf('A-33');
    await flushPromises();
    expect(fitBounds).toHaveBeenCalledTimes(1);

    region.value = WUXI;
    indicator.value = leaf('A-34');
    await flushPromises();
    expect(load).toHaveBeenLastCalledWith(WUXI);
    expect(fitBounds).toHaveBeenCalledTimes(2);

    indicator.value = null;
    await flushPromises();
    indicator.value = leaf('A-34');
    await flushPromises();
    expect(fitBounds).toHaveBeenCalledTimes(3);
  });
});
