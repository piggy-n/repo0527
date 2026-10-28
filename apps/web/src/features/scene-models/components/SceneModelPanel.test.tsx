import {
  type CameraState,
  NavGrid,
  type Navigation,
  navigationFrame,
  type RoamStatus,
  type SceneStatus,
  type WalkNotice
} from '@yzt/map-core';
import { type CameraControl, provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElDropdown, ElDropdownItem, ElOption, ElRadioGroup, ElSelect, ElSlider } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { sceneManifestSchema } from '../api';
import { buildModelCatalog, type SceneModel } from '../catalog';
import { type SceneModels, useSceneModels } from '../composables/useSceneModels';
import { RoamBar } from './RoamBar';
import { SceneModelPanel } from './SceneModelPanel';
import { UndergroundBar } from './UndergroundBar';
import styles from './SceneModelPanel.module.scss';

const CAMERA: CameraState = { center: [120.66, 31.31], zoom: 16, bearing: 0, pitch: 55 };

// 结构同入库的清单，多一个南京的倾斜摄影
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
        spawn: { lng: 120.666, lat: 31.3175, height: -5.1, heading: 76 },
        // 往东约 95 米、再往北约 11 米
        routes: [
          {
            id: 'enter',
            name: '进站乘车',
            path: [[120.666, 31.3175, -5.1], [120.667, 31.3175, -5.1], [120.667, 31.3176, -5.1]]
          }
        ]
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

/** 页面创建地图和拥有者，渲染面板和钻地条；状态报告和相机操作换成测试控制的。null 表示清单还没到 */
function mountPanel(catalog: readonly SceneModel[] | null = CATALOG) {
  const source = shallowRef(catalog ?? undefined);
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const roamStatus = shallowRef<RoamStatus | null>(null);
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control = { flyTo } as unknown as CameraControl;
  const failed = ref(false);
  const onRetry = vi.fn<() => void>();
  const collapsed = ref(false);
  // 建导航网格换成用例控制的
  const builds: { resolve: (navigation: Navigation) => void; reject: (error: Error) => void }[] = [];
  const loadNavigation = () => new Promise<Navigation>((resolve, reject) => builds.push({ resolve, reject }));
  let owner: SceneModels | undefined;
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: CAMERA });
    owner = useSceneModels(
      {
        sceneStatus,
        roamStatus,
        runCameraOperation: action => action(control),
        beginCameraOperation: () => ({ signal: new AbortController().signal, run: action => action(control) })
      },
      source,
      { loadNavigation }
    );
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
        <RoamBar models={models} />
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
  const progress = (distance: number, finished = false) => {
    const roam = owner?.roam.value;
    const total = owner?.models.value[0]?.routes[0]?.length ?? 0;
    roamStatus.value =
      roam?.kind === 'route' ? { kind: 'route', id: roam.id, run: roam.run, distance, total, finished } : null;
    return nextTick();
  };
  // 步行时视图报告的阶段和提示
  const walk = (phase: 'entering' | 'walking' | 'failed', notice: WalkNotice | null = null, notices = 0) => {
    const roam = owner?.roam.value;
    roamStatus.value =
      roam?.kind === 'walk' ? { kind: 'walk', id: roam.id, phase, notice, notices, player: null } : null;
    return nextTick();
  };
  const ownerOf = required(owner, '页面没有创建拥有者');
  return { wrapper, owner: ownerOf, source, failed, onRetry, collapsed, flyTo, report, progress, builds, walk };
}

function button(wrapper: VueWrapper, label: string, within = '') {
  return wrapper.get(`${within} button[aria-label="${label}"]`);
}

// 文字按钮（漫游操作条的开始、暂停等）
const textButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find(item => item.text() === label);

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

describe('路线漫游的入口和操作条（ADR 0083）', () => {
  it('加载完成、有路线的模型显示"路线漫游"，列出路线名和长度；选一条开始，行标漫游中，钻地条让给漫游操作条', async () => {
    const { wrapper, owner, report } = mountPanel();
    await check(wrapper, 'station', true);
    expect(wrapper.get('[data-loaded="station"]').text()).not.toContain('路线漫游');
    await report({ station: 'ready' });

    const dropdown = wrapper.get('[data-loaded="station"]').findComponent(ElDropdown);
    expect(dropdown.text()).toContain('路线漫游');
    expect(dropdown.findAllComponents(ElDropdownItem).map(item => item.text())).toStrictEqual(['进站乘车106 m']);
    dropdown.vm.$emit('command', 'enter');
    await nextTick();

    expect(owner.roam.value).toMatchObject({ kind: 'route', routeId: 'enter' });
    expect(wrapper.get('[data-loaded="station"]').text()).toContain('漫游中');
    expect(wrapper.find('[data-underground-bar]').exists()).toBe(false);
    const bar = wrapper.get('[data-roam-bar]');
    expect(bar.text()).toContain('路线漫游 · 进站乘车');
    expect(bar.text()).toContain('苏州站地下空间');
    expect(bar.text()).toContain('0 m / 106 m · 剩余 1:06');
    expect(textButton(wrapper, '开始')).toBeDefined();
  });

  it('操作条：开始后是暂停，走过一段后暂停是继续，到终点是重新开始；倍速改剩余时间；退出后换回钻地条', async () => {
    const { wrapper, owner, report, progress } = mountPanel();
    await check(wrapper, 'station', true);
    await report({ station: 'ready' });
    owner.startRoute('station', 'enter');
    await nextTick();

    await textButton(wrapper, '开始')?.trigger('click');
    expect(owner.routePhase.value).toBe('playing');
    await progress(53);
    expect(wrapper.get('[data-roam-bar]').text()).toContain('53 m / 106 m · 剩余 0:33');
    await textButton(wrapper, '暂停')?.trigger('click');
    expect(textButton(wrapper, '继续')).toBeDefined();
    expect(wrapper.get('[data-roam-bar]').text()).toContain('暂停时可拖动查看四周');

    wrapper.get('[data-roam-bar]').findComponent(ElRadioGroup).vm.$emit('update:modelValue', 2);
    await nextTick();
    expect(owner.roam.value).toMatchObject({ rate: 2 });
    expect(wrapper.get('[data-roam-bar]').text()).toContain('剩余 0:17');

    await progress(106, true);
    expect(wrapper.get('[data-roam-bar]').text()).toContain('已到终点');
    await textButton(wrapper, '重新开始')?.trigger('click');
    expect(owner.roam.value).toMatchObject({ playing: true, run: 1 });

    await textButton(wrapper, '退出漫游')?.trigger('click');
    expect(wrapper.find('[data-roam-bar]').exists()).toBe(false);
    expect(wrapper.get('[data-underground-bar]').text()).toContain('钻地观察 · 苏州站地下空间');
  });
});

// 一块空网格：面板只把它交给会话
const NAVIGATION: Navigation = {
  grid: new NavGrid({
    meta: {
      minX: 0,
      minY: 0,
      cellSize: 0.2,
      width: 1,
      height: 1,
      chunksX: 1,
      chunksY: 1,
      maxLevels: 4,
      floorCells: 0,
      droppedLevels: 0
    },
    chunkIndex: Int32Array.of(-1),
    data: new Int16Array(0),
    headroom: new Uint8Array(0)
  }),
  frame: navigationFrame([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2_700_000, 4_700_000, 3_300_000, 1])
};

const flushBuild = () => new Promise(resolve => setTimeout(resolve, 0));

describe('步行的入口和操作条（ADR 0086）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('清单里有出生点、加载完成的模型才有"步行漫游"；开始后操作条显示分析进度，可以取消', async () => {
    const { wrapper, owner, report, builds } = mountPanel();
    await check(wrapper, 'station', true);
    await check(wrapper, 'white', true);
    expect(textButton(wrapper, '步行漫游')).toBeUndefined();
    await report({ station: 'ready', 'white/plain': 'ready' });
    expect(wrapper.get('[data-loaded="white"]').text()).not.toContain('步行漫游');

    await textButton(wrapper, '步行漫游')?.trigger('click');
    expect(wrapper.get('[data-loaded="station"]').text()).toContain('漫游中');
    const bar = wrapper.get('[data-roam-bar]');
    expect(bar.text()).toContain('步行漫游 · 苏州站地下空间');
    expect(bar.text()).toContain('正在分析站内空间 0%');
    expect(wrapper.find('[data-underground-bar]').exists()).toBe(false);

    await textButton(wrapper, '取消')?.trigger('click');
    expect(owner.roam.value).toBeNull();
    expect(wrapper.find('[data-roam-bar]').exists()).toBe(false);
    expect(builds).toHaveLength(1);
  });

  it('地下的模型清单里没有出生点时也没有"步行漫游"', async () => {
    const [station, ...others] = CATALOG;
    const { wrapper, report } = mountPanel([{ ...required(station, '目录里没有车站'), spawn: undefined }, ...others]);
    await check(wrapper, 'station', true);
    await report({ station: 'ready' });

    expect(wrapper.get('[data-loaded="station"]').text()).toContain('路线漫游');
    expect(textButton(wrapper, '步行漫游')).toBeUndefined();
  });

  it('建好后进入站内、行走：调速、回到出生点、脱困改意图；提示几秒后消失，同样的提示再来一次重新显示', async () => {
    const { wrapper, owner, report, builds, walk } = mountPanel();
    await check(wrapper, 'station', true);
    await report({ station: 'ready' });
    owner.startWalk('station');
    builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    const bar = () => wrapper.get('[data-roam-bar]');
    expect(bar().text()).toContain('正在进入站内…');
    expect(textButton(wrapper, '取消')).toBeDefined();

    await walk('walking');
    expect(bar().text()).toContain('1.6 m/s');
    expect(bar().text()).toContain('W/A/S/D 行走');
    expect(textButton(wrapper, '退出漫游')).toBeDefined();
    await bar().get('button[aria-label="加速"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 2.5 });
    await textButton(wrapper, '默认')?.trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 1.6 });
    await bar().get('button[aria-label="减速"]').trigger('click');
    await bar().get('button[aria-label="减速"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 0.5 });
    expect(bar().get('button[aria-label="减速"]').attributes('disabled')).toBeDefined();
    await textButton(wrapper, '回到出生点')?.trigger('click');
    await textButton(wrapper, '脱困')?.trigger('click');
    expect(owner.roam.value).toMatchObject({ respawn: 1, unstuck: 1 });

    vi.useFakeTimers();
    await walk('walking', 'open', 1);
    expect(bar().text()).toContain('当前位置可以正常行走，无需脱困');
    vi.advanceTimersByTime(3500);
    await nextTick();
    expect(bar().text()).not.toContain('无需脱困');
    await walk('walking', 'open', 2);
    expect(bar().text()).toContain('无需脱困');
  });

  it('分析失败可以重试；附近找不到能站的地方时提示，只能退出', async () => {
    const { wrapper, owner, report, builds, walk } = mountPanel();
    await check(wrapper, 'station', true);
    await report({ station: 'ready' });
    owner.startWalk('station');
    builds[0]?.reject(new Error('瓦片下载失败（404）'));
    await flushBuild();
    const bar = () => wrapper.get('[data-roam-bar]');
    expect(bar().text()).toContain('站内空间分析失败，请重试');

    await textButton(wrapper, '重试')?.trigger('click');
    expect(builds).toHaveLength(2);
    expect(bar().text()).toContain('正在分析站内空间');
    builds[1]?.resolve(NAVIGATION);
    await flushBuild();
    await walk('failed');
    expect(bar().text()).toContain('附近没有找到可以站立的室内位置');
    expect(textButton(wrapper, '重试')).toBeUndefined();

    await textButton(wrapper, '退出漫游')?.trigger('click');
    expect(wrapper.find('[data-roam-bar]').exists()).toBe(false);
  });
});
