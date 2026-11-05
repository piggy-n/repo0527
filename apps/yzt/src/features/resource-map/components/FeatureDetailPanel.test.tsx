import type { Point } from 'geojson';
import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

const FIRST = candidate(DLTB, 1, { guid: '1'.repeat(32), dlmc: '水田', dlbm: '0101', bsm: '3201' });
const SECOND = candidate(DLTB, 2, { guid: '2'.repeat(32), dlmc: '', dlbm: '0103' });
const LIST: CandidateList = { id: 1, mode: 'pick', target: DLTB, candidates: [FIRST, SECOND], pages: null };
// 框选出的几千个候选，名称是前缀加序号
const many = (prefix: string) =>
  Array.from({ length: 3000 }, (_, index) => candidate(DLTB, index, { dlmc: `${prefix} ${index}` }));
const POINT: Point = { type: 'Point', coordinates: [119, 33] };

/** 只记调用的拥有者：状态和详情由测试设置 */
function fakePick(initial: FeaturePickState, initialDetail: FeatureDetailStatus | null = null) {
  const state = shallowRef(initial);
  const detail = shallowRef(initialDetail);
  const pick: FeaturePick = {
    state,
    boxDraft: computed(() => null),
    hint: computed(() => null),
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

// jsdom 没有实现元素的 scrollTo，虚拟列表回到顶部要用：按 top 设置 scrollTop
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value(this: Element, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    }
  });
});

afterAll(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollTo');
});

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('dl > div').map(row => [row.get('dt').text(), row.get('dd').text()]);

// 候选的每一行：序号、名称、分类
const candidateRows = (wrapper: VueWrapper) =>
  wrapper.findAll('li').map(item => item.findAll('button > span').map(span => span.text()));

const titleOf = (wrapper: VueWrapper) => wrapper.get('h3').text();

const notice = (wrapper: VueWrapper, tone: string) => wrapper.find(`[data-notice="${tone}"]`);

describe('FeatureDetailPanel', () => {
  it('候选列表：标题是资源名，下面是年份和个数；每行是序号、名称和分类，没有名称的写"未命名"；点一行选中它', async () => {
    const { pick } = fakePick({ kind: 'candidates', list: LIST, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);
    // 虚拟列表在容器挂载后的下一轮渲染出行
    await nextTick();

    expect(titleOf(wrapper)).toBe('地类图斑');
    expect(wrapper.text()).toContain('2022 · 共 2 个');
    expect(candidateRows(wrapper)).toStrictEqual([
      ['1', '水田', '0101'],
      ['2', '未命名', '0103']
    ]);

    await wrapper.findAll('li button')[1]?.trigger('click');
    // 拥有者按对象身份确认候选在列表里，交过去的要是列表里的原对象，不能是响应式代理
    expect(vi.mocked(pick.choose).mock.calls[0]?.[0]).toBe(SECOND);
    expect(wrapper.findAll('button').some(item => item.text() === '加载更多')).toBe(false);
  });

  it('后端识别还有更多页时可以加载更多，加载中不能再点；失败时显示原因并可以重试', async () => {
    const list: CandidateList = { ...LIST, pages: { geometry: POINT, loaded: 1, total: 45 } };
    const { pick, state } = fakePick({ kind: 'candidates', list, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);

    expect(wrapper.text()).toContain('2022 · 共 45 个，已列出 2 个');
    // 单击的结果没有批量高亮，不提示
    expect(wrapper.text()).not.toContain('放大到 14 级以上');
    await button(wrapper, '加载更多').trigger('click');
    expect(pick.loadMore).toHaveBeenCalledOnce();

    state.value = { kind: 'candidates', list, more: { kind: 'loading' } };
    await nextTick();
    expect(button(wrapper, '正在加载…').attributes('disabled')).toBeDefined();

    state.value = { kind: 'candidates', list, more: { kind: 'failed', error: new Error('系统异常') } };
    await nextTick();
    expect(notice(wrapper, 'error').text()).toContain('加载失败：系统异常');
    await button(wrapper, '重试').trigger('click');
    expect(pick.loadMore).toHaveBeenCalledTimes(2);
  });

  it('详情：要素名称作标题，下面是资源和年份；详情到了用完整的属性；没有列表时不能返回，详情到了才能定位', async () => {
    const { pick, detail } = fakePick({ kind: 'detail', candidate: FIRST, back: null }, { kind: 'loading' });
    const wrapper = mountPanel(pick);

    expect(titleOf(wrapper)).toBe('水田');
    expect(wrapper.text()).toContain('地类图斑 · 2022');
    expect(wrapper.findAll('button').some(item => item.text() === '返回列表')).toBe(false);
    expect(wrapper.get('[aria-label="定位到要素"]').attributes('disabled')).toBeDefined();

    const properties = { guid: FIRST.guid, bsm: '3201', dlmc: '旱地' };
    detail.value = { kind: 'ready', detail: { properties, geometry: POINT } };
    await nextTick();
    expect(titleOf(wrapper)).toBe('旱地');
    expect(rows(wrapper)).toStrictEqual([
      ['标识码', '3201'],
      ['地类名称', '旱地']
    ]);
    await wrapper.get('[aria-label="定位到要素"]').trigger('click');
    expect(pick.locate).toHaveBeenCalledOnce();
  });

  it('没有值的字段收在最后、默认不显示，点"显示"后列出，值是灰色的"-"；字段名表里没有的显示字段编码', async () => {
    const properties = { guid: FIRST.guid, BSM: '3201', ngrade: '7', ZLDWMC: '', name: '-9999', tbmj: -9999 };
    const { pick } = fakePick(
      { kind: 'detail', candidate: FIRST, back: null },
      { kind: 'ready', detail: { properties, geometry: POINT } }
    );
    const wrapper = mountPanel(pick);

    expect(rows(wrapper)).toStrictEqual([
      ['标识码', '3201'],
      ['ngrade', '7']
    ]);
    expect(wrapper.text()).toContain('另有 3 个字段没有值');

    await button(wrapper, '显示').trigger('click');
    expect(rows(wrapper)).toStrictEqual([
      ['标识码', '3201'],
      ['ngrade', '7'],
      ['坐落单位名称', '-'],
      ['name', '-'],
      ['图斑面积', '-']
    ]);
    const dims = wrapper.findAll('dd').map(item => item.attributes('data-empty') !== undefined);
    expect(dims).toStrictEqual([false, false, true, true, true]);

    await button(wrapper, '收起没有值的字段').trigger('click');
    expect(rows(wrapper)).toHaveLength(2);
  });

  it('字段都没有值时写明，没有"另有"', () => {
    const properties = { guid: FIRST.guid, bz: '', name: -9999 };
    const { pick } = fakePick(
      { kind: 'detail', candidate: FIRST, back: null },
      { kind: 'ready', detail: { properties, geometry: POINT } }
    );
    const wrapper = mountPanel(pick);

    expect(rows(wrapper)).toStrictEqual([]);
    expect(wrapper.text()).toContain('2 个字段都没有值');
    expect(wrapper.text()).not.toContain('另有');
  });

  it('从列表进入的详情可以返回列表', async () => {
    const { pick } = fakePick({ kind: 'detail', candidate: FIRST, back: { list: LIST, camera: CAMERA } }, null);
    const wrapper = mountPanel(pick);

    await button(wrapper, '返回列表').trigger('click');

    expect(pick.back).toHaveBeenCalledOnce();
  });

  it('详情失败时显示原因并可以重试；不能查详情的资源注明，列出地图上的属性，没有"定位"', async () => {
    const error = new Error('系统异常');
    const failed = fakePick({ kind: 'detail', candidate: FIRST, back: null }, { kind: 'failed', error });
    const wrapper = mountPanel(failed.pick);

    expect(notice(wrapper, 'error').text()).toContain('详情加载失败：系统异常');
    await button(wrapper, '重试').trigger('click');
    expect(failed.pick.retry).toHaveBeenCalledOnce();

    const pond = candidate(SZY, 3, { guid: '3'.repeat(32), name: '某坑塘', mj: 120 });
    const unsupported = fakePick({ kind: 'detail', candidate: pond, back: null }, { kind: 'unsupported' });
    const other = mountPanel(unsupported.pick);
    expect(titleOf(other)).toBe('某坑塘');
    expect(notice(other, 'info').text()).toBe('这个资源暂不支持查询完整信息，下面是地图上的属性');
    expect(rows(other)).toStrictEqual([
      ['name', '某坑塘'],
      ['mj', '120']
    ]);
    expect(other.find('[aria-label="定位到要素"]').exists()).toBe(false);
  });

  it('没有名称字段的要素：标题是资源名称', () => {
    const plain = candidate(DLTB, 4, { guid: '4'.repeat(32), bsm: '3201' });
    const { pick } = fakePick({ kind: 'detail', candidate: plain, back: null }, { kind: 'loading' });

    expect(titleOf(mountPanel(pick))).toBe('地类图斑');
  });

  it('框选的列表：标题注明框选；渲染要素的写"地图上已画出的"，后端的写总数并提示低级别看不到高亮', async () => {
    const box: CandidateList = { ...LIST, mode: 'box' };
    const { pick, state } = fakePick({ kind: 'candidates', list: box, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);

    expect(titleOf(wrapper)).toBe('框选 · 地类图斑');
    expect(wrapper.text()).toContain('2022 · 地图上已画出的 2 个');
    expect(notice(wrapper, 'info').exists()).toBe(false);

    const pages = { geometry: POINT, loaded: 1, total: 45 };
    state.value = { kind: 'candidates', list: { ...box, pages }, more: { kind: 'idle' } };
    await nextTick();
    expect(wrapper.text()).toContain('2022 · 共 45 个，已列出 2 个');
    expect(notice(wrapper, 'info').text()).toBe('低级别下地图上可能看不到高亮，放大到 14 级以上可以看到');
  });

  it('框选的列表只渲染看得见的几行：几千个候选时也只有几十行', async () => {
    const list: CandidateList = { ...LIST, mode: 'box', candidates: many('地类') };
    const { pick } = fakePick({ kind: 'candidates', list, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);
    await nextTick();

    expect(wrapper.text()).toContain('地图上已画出的 3000 个');
    expect(wrapper.findAll('li').length).toBeLessThan(50);
    expect(candidateRows(wrapper)[0]).toStrictEqual(['1', '地类 0']);
  });

  it('连续框选：新一轮的列表从头显示；加载更多时保留滚动位置', async () => {
    const first: CandidateList = { ...LIST, id: 1, mode: 'box', candidates: many('第一轮') };
    const { pick, state } = fakePick({ kind: 'candidates', list: first, more: { kind: 'idle' } });
    const wrapper = mountPanel(pick);
    await nextTick();
    const scroller = () => wrapper.get('ul').element.parentElement as HTMLElement;
    const firstRow = () => candidateRows(wrapper)[0];

    // 滚到第 40 行（每行 34 像素），前面多渲染 10 行
    scroller().scrollTop = 1360;
    scroller().dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(firstRow()).toStrictEqual(['32', '第一轮 31']);

    // 加载更多：同一轮，位置不变
    state.value = { kind: 'candidates', list: { ...first, candidates: [...first.candidates] }, more: { kind: 'idle' } };
    await nextTick();
    await nextTick();
    expect(scroller().scrollTop).toBe(1360);
    expect(firstRow()).toStrictEqual(['32', '第一轮 31']);

    // 新一轮框选（中间不经过别的状态，面板不重新挂载）：回到顶部
    const second: CandidateList = { ...LIST, id: 2, mode: 'box', candidates: many('第二轮') };
    state.value = { kind: 'candidates', list: second, more: { kind: 'idle' } };
    await nextTick();
    await nextTick();
    expect(scroller().scrollTop).toBe(0);
    expect(firstRow()).toStrictEqual(['1', '第二轮 0']);
  });

  it('框里要素过多时说明估数和上限，提示缩小框选范围', () => {
    const { pick } = fakePick({ kind: 'too-many', target: DLTB, estimate: 12000 });
    const wrapper = mountPanel(pick);

    expect(notice(wrapper, 'warning').text()).toBe(
      '框里约 12000 个地类图斑，超过 5000 个，没有查询。请缩小框选范围后再试'
    );
  });

  it('区划边界太复杂：框选提示缩小范围或放大，单击提示放大', async () => {
    const { pick, state } = fakePick({ kind: 'too-complex', target: DLTB, mode: 'box' });
    const wrapper = mountPanel(pick);

    expect(notice(wrapper, 'warning').text()).toBe(
      '这里的区划边界太复杂，没法和框选范围一起查询地类图斑。请缩小框选范围，或者放大地图后再试'
    );

    state.value = { kind: 'too-complex', target: DLTB, mode: 'pick' };
    await nextTick();
    expect(notice(wrapper, 'warning').text()).toBe(
      '这里的区划边界太复杂，没法和点击的位置一起查询地类图斑。请放大地图后再试'
    );
  });

  it('没有结果时说明怎么点；识别失败时显示原因，可以重试；规划出错（没有资源）时只写识别失败', async () => {
    const { pick, state } = fakePick({ kind: 'empty' });
    const wrapper = mountPanel(pick);
    expect(wrapper.text()).toBe('这里没有可查询的要素点在勾选的资源上，或放大地图后再点');

    state.value = { kind: 'failed', target: DLTB, error: new Error('系统异常') };
    await nextTick();
    expect(notice(wrapper, 'error').text()).toBe('地类图斑识别失败：系统异常重试');
    await button(wrapper, '重试').trigger('click');
    expect(pick.retry).toHaveBeenCalledOnce();

    state.value = { kind: 'failed', target: null, error: new Error('求交失败') };
    await nextTick();
    expect(notice(wrapper, 'error').text()).toBe('识别失败：求交失败重试');
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
