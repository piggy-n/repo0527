import type { Point } from 'geojson';
import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, shallowRef } from 'vue';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import type { ResourceTreeCategory } from '../api';
import { buildCatalog } from '../catalog';
import type { PickCandidate, PickResource } from '../feature-query';
import type { CandidateList, FeatureDetailStatus, FeaturePick, FeaturePickState } from '../composables/useFeaturePick';
import { FeatureDetailPanel } from './FeatureDetailPanel';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

const tree: ResourceTreeCategory[] = [
  {
    code: null,
    name: '测试',
    children: [
      { code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2022] },
      { code: 'szy_kt', name: '坑塘', geoType: 'Polygon', yearList: [2025] }
    ]
  }
];
const CATALOG = buildCatalog(tree);

function targetOf(code: string, year: number): PickResource {
  const resource = CATALOG.resources.get(code);
  if (!resource) {
    throw new Error(`测试目录里没有 ${code}`);
  }
  return { resource, year, sourceId: `resources-${code}`, layerCode: `${code}_${year}` };
}

const DLTB = targetOf('bgdc_dltb', 2022);
const SZY = targetOf('szy_kt', 2025);

function candidate(target: PickResource, index: number, properties: Record<string, unknown>): PickCandidate {
  const guid = String(index).repeat(32);
  return { key: `${target.sourceId}:${guid}`, target, guid, properties, origin: 'rendered', distance: 0 };
}

const FIRST = candidate(DLTB, 1, { guid: '1'.repeat(32), dlmc: '水田', bsm: '3201' });
const SECOND = candidate(DLTB, 2, { guid: '2'.repeat(32), dlmc: '旱地' });
const LIST: CandidateList = { target: DLTB, candidates: [FIRST, SECOND], pages: null };
const POINT: Point = { type: 'Point', coordinates: [119, 33] };

/** 只记调用的拥有者：状态和详情由测试设置 */
function fakePick(initial: FeaturePickState, initialDetail: FeatureDetailStatus | null = null) {
  const state = shallowRef(initial);
  const detail = shallowRef(initialDetail);
  const pick: FeaturePick = {
    state,
    detail: computed(() => detail.value),
    tools: { [FEATURE_PICK_TOOL]: { persistent: true } },
    choose: vi.fn<FeaturePick['choose']>(),
    back: vi.fn<FeaturePick['back']>(),
    loadMore: vi.fn<FeaturePick['loadMore']>(),
    retry: vi.fn<FeaturePick['retry']>(),
    locate: vi.fn<FeaturePick['locate']>(),
    close: vi.fn<FeaturePick['close']>(),
    deriveGroup: () => ({ sources: {}, layers: [] })
  };
  return { pick, state, detail };
}

/** 页面创建地图，渲染面板（面板登记为悬浮元素，要在 provideMap 下面） */
function mountPanel(pick: FeaturePick) {
  const Page = defineComponent(() => {
    provideMap({ groups: ['selection'], camera: CAMERA });
    return () => <FeatureDetailPanel pick={pick} />;
  });
  return mount(Page);
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text);
  if (!found) {
    throw new Error(`没有"${text}"按钮`);
  }
  return found;
}

afterEach(() => {
  vi.useRealTimers();
});

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('dl > div').map(row => [row.get('dt').text(), row.get('dd').text()]);

describe('FeatureDetailPanel', () => {
  it('候选列表：资源名、年份和个数，每行是年份和名称；点一行选中它', async () => {
    const { pick } = fakePick({ kind: 'candidates', list: LIST, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);

    expect(wrapper.text()).toContain('地类图斑');
    expect(wrapper.text()).toContain('2022 年 · 共 2 个');
    expect(wrapper.findAll('li').map(item => item.text())).toStrictEqual(['1. 2022 · 水田', '2. 2022 · 旱地']);

    await button(wrapper, '2. 2022 · 旱地').trigger('click');
    expect(pick.choose).toHaveBeenCalledWith(SECOND);
    expect(wrapper.findAll('button').some(item => item.text() === '加载更多')).toBe(false);
  });

  it('后端识别还有更多页时可以加载更多，失败时显示原因并可以重试', async () => {
    const list: CandidateList = { ...LIST, pages: { geometry: POINT, loaded: 1, total: 45 } };
    const { pick, state } = fakePick({ kind: 'candidates', list, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);

    expect(wrapper.text()).toContain('共 45 个，已列出 2 个');
    await button(wrapper, '加载更多').trigger('click');
    expect(pick.loadMore).toHaveBeenCalledOnce();

    state.value = { kind: 'candidates', list, more: { kind: 'failed', error: new Error('系统异常') } };
    await nextTick();
    expect(wrapper.text()).toContain('加载失败：系统异常');
    await button(wrapper, '重试').trigger('click');
    expect(pick.loadMore).toHaveBeenCalledTimes(2);
  });

  it('详情：标题是资源名，副标题是年份和名称，字段用中文名；有列表时可以返回，详情到了才能定位', async () => {
    const { pick, detail } = fakePick({ kind: 'detail', candidate: FIRST, back: null }, { kind: 'loading' });
    const wrapper = mountPanel(pick);

    expect(wrapper.text()).toContain('2022 · 水田');
    expect(wrapper.findAll('button').some(item => item.text() === '返回列表')).toBe(false);
    expect(wrapper.get('[aria-label="定位到要素"]').attributes('disabled')).toBeDefined();

    const properties = { guid: FIRST.guid, BSM: '3201', DLMC: '水田' };
    detail.value = { kind: 'ready', detail: { properties, geometry: POINT } };
    await nextTick();
    expect(rows(wrapper)).toStrictEqual([
      ['标识码', '3201'],
      ['地类名称', '水田']
    ]);
    await wrapper.get('[aria-label="定位到要素"]').trigger('click');
    expect(pick.locate).toHaveBeenCalledOnce();
    await wrapper.get('[aria-label="关闭点选"]').trigger('click');
    expect(pick.close).toHaveBeenCalledOnce();
  });

  it('从列表进入的详情可以返回列表', async () => {
    const { pick } = fakePick({ kind: 'detail', candidate: FIRST, back: { list: LIST, camera: CAMERA } }, null);
    const wrapper = mountPanel(pick);

    await button(wrapper, '返回列表').trigger('click');

    expect(pick.back).toHaveBeenCalledOnce();
  });

  it('详情失败时显示原因并可以重试；不能查详情的资源注明，列出地图上的属性', async () => {
    const error = new Error('系统异常');
    const failed = fakePick({ kind: 'detail', candidate: FIRST, back: null }, { kind: 'failed', error });
    const wrapper = mountPanel(failed.pick);

    expect(wrapper.text()).toContain('详情加载失败：系统异常');
    await button(wrapper, '重试').trigger('click');
    expect(failed.pick.retry).toHaveBeenCalledOnce();

    const pond = candidate(SZY, 3, { guid: '3'.repeat(32), name: '某坑塘', mj: 120 });
    const unsupported = fakePick({ kind: 'detail', candidate: pond, back: null }, { kind: 'unsupported' });
    const other = mountPanel(unsupported.pick);
    expect(other.text()).toContain('这个资源暂不支持查询完整信息');
    expect(rows(other)).toStrictEqual([
      ['name', '某坑塘'],
      ['mj', '120']
    ]);
  });

  it('没有结果、识别失败时显示原因，识别失败可以重试', async () => {
    const { pick, state } = fakePick({ kind: 'empty' });
    const wrapper = mountPanel(pick);
    expect(wrapper.text()).toContain('这里没有可查询的要素');

    state.value = { kind: 'failed', target: DLTB, error: new Error('系统异常') };
    await nextTick();
    expect(wrapper.text()).toContain('地类图斑识别失败：系统异常');
    await button(wrapper, '重试').trigger('click');
    expect(pick.retry).toHaveBeenCalledOnce();
  });

  it('识别和加载详情很快结束时不显示提示，超过 300 毫秒才显示', async () => {
    vi.useFakeTimers();
    const { pick } = fakePick({ kind: 'identifying' });
    const wrapper = mountPanel(pick);
    expect(wrapper.text()).not.toContain('正在识别');

    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.text()).toContain('正在识别');
  });
});
