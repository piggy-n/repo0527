import {
  type CameraState,
  NavGrid,
  type Navigation,
  navigationFrame,
  type RoamStatus,
  type ScanNavigation,
  type SceneStatus,
  type WalkNotice
} from '@mx/map-core';
import { type CameraControl, MAPLIBRE_ENGINE, provideMap } from '@mx/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { sceneManifestSchema } from '../api';
import { buildModelCatalog, type SceneModel } from '../catalog';
import { type SceneModels, useSceneModels } from '../composables/useSceneModels';
import { ModelLayerRow } from './ModelLayerRow';
import { RoamPanel } from './RoamPanel';

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
        // 进站乘车往东约 95 米、再往北约 11 米；站台漫步往东约 48 米
        routes: [
          {
            id: 'enter',
            name: '进站乘车',
            path: [[120.666, 31.3175, -5.1], [120.667, 31.3175, -5.1], [120.667, 31.3176, -5.1]]
          },
          { id: 'platform', name: '站台漫步', path: [[120.666, 31.3175, -10], [120.6665, 31.3175, -10]] }
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
          { id: 'window', label: '效果1', tileset: 'W/window.json' }
        ]
      },
      { id: 'city', name: '新街口倾斜摄影', cityCode: '320100', kind: 'oblique', underground: false, tileset: 'C.json' }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

/**
 * 页面创建地图和拥有者，和现状底图一样漫游时左侧是漫游面板、否则是当前图层里的模型行（ADR 0157）；状态报告和相机操作换成
 * 测试控制的，在三维里。personSwitch 是页面让漫游面板显示人称切换
 */
function mountPanel(catalog: readonly SceneModel[] = CATALOG, { personSwitch = false } = {}) {
  const source = shallowRef(catalog);
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const roamStatus = shallowRef<RoamStatus | null>(null);
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control = { flyTo } as unknown as CameraControl;
  const collapsed = ref(false);
  // 建导航网格换成用例控制的；高斯泼溅的也放进同一个列表
  const builds: { resolve: (navigation: Navigation) => void; reject: (error: Error) => void }[] = [];
  const loadNavigation = () => new Promise<Navigation>((resolve, reject) => builds.push({ resolve, reject }));
  const loadSplatNavigation = () =>
    new Promise<ScanNavigation>((resolve, reject) =>
      builds.push({ resolve: navigation => resolve({ ...navigation, partial: false }), reject })
    );
  let owner: SceneModels | undefined;
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: CAMERA });
    owner = useSceneModels(
      {
        sceneStatus,
        roamStatus,
        sceneCapabilities: MAPLIBRE_ENGINE.capabilities,
        dimension: ref('3d'),
        runCameraOperation: action => action(control),
        beginCameraOperation: () => ({ signal: new AbortController().signal, run: action => action(control) })
      },
      source,
      { loadNavigation, loadSplatNavigation }
    );
    const models = owner;
    return () => (
      <div>
        {models.roam.value ? (
          <RoamPanel
            models={models}
            personSwitch={personSwitch}
            collapsed={collapsed.value}
            onUpdate:collapsed={value => (collapsed.value = value)}
          />
        ) : (
          <ul data-current-list>
            {models.added.value.map(id => (
              <li key={id} data-current-row={id}>
                <ModelLayerRow models={models} id={id} scene />
              </li>
            ))}
          </ul>
        )}
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
      roam?.kind === 'walk'
        ? { kind: 'walk', id: roam.id, phase, view: roam.view, notice, notices, player: null }
        : null;
    return nextTick();
  };
  const ownerOf = required(owner, '页面没有创建拥有者');
  return { wrapper, owner: ownerOf, collapsed, report, progress, builds, walk };
}

function button(wrapper: VueWrapper, label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

// 文字按钮（漫游面板的开始、暂停等）
const textButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find(item => item.text() === label);

// 加入当前地图（面板的目录、工具栏最后都调它）
const add = (owner: SceneModels, id: string) => {
  owner.add([id]);
  return nextTick();
};

describe('漫游的入口和面板（ADR 0097）', () => {
  it('当前图层里加载完成、有出生点或路线的模型行尾有"漫游"；点了换成漫游面板，从步行开始；退出后换回当前图层', async () => {
    const { wrapper, owner, report } = mountPanel();
    await add(owner, 'station');
    await add(owner, 'white');
    expect(wrapper.find('[data-roam="white"]').exists()).toBe(false);
    const entry = () => wrapper.get('[data-roam="station"]');
    expect(entry().attributes('aria-disabled')).toBe('true');
    await entry().trigger('click');
    expect(owner.roam.value).toBeNull();

    await report({ station: 'ready', 'white/plain': 'ready' });
    expect(entry().attributes('aria-disabled')).toBe('false');
    await entry().trigger('click');
    expect(owner.roam.value).toMatchObject({ kind: 'walk', modelId: 'station', speed: 4 });
    expect(wrapper.find('[data-current-list]').exists()).toBe(false);
    const panel = wrapper.get('[data-roam-panel]');
    expect(panel.get('header').text()).toContain('漫游苏州站地下空间 · 室内');
    expect(panel.get('[aria-label="漫游方式"] .is-active').text()).toBe('步行');
    expect(panel.text()).toContain('正在分析站内空间 0%');

    await textButton(wrapper, '退出漫游')?.trigger('click');
    expect(owner.roam.value).toBeNull();
    expect(wrapper.find('[data-roam-panel]').exists()).toBe(false);
    expect(wrapper.find('[data-current-list]').exists()).toBe(true);
  });

  it('没有出生点的模型从第一条路线开始，步行那一段不可用；选路线停在它的起点', async () => {
    const [station, ...others] = CATALOG;
    const { wrapper, owner, report } = mountPanel([{ ...required(station, '目录里没有车站'), spawn: undefined }, ...others]);
    await add(owner, 'station');
    await report({ station: 'ready' });

    await wrapper.get('[data-roam="station"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ kind: 'route', routeId: 'enter', playing: false, speed: 4 });
    const panel = () => wrapper.get('[data-roam-panel]');
    const modes = panel().findAll('[aria-label="漫游方式"] label');
    expect(modes.map(mode => [mode.text(), mode.classes('is-disabled')])).toStrictEqual([
      ['步行', true],
      ['路线', false]
    ]);
    const routes = () => panel().findAll('[role="radio"][data-route]');
    expect(routes().map(route => [route.text(), route.attributes('aria-checked')])).toStrictEqual([
      ['进站乘车106 m', 'true'],
      ['站台漫步48 m', 'false']
    ]);
    expect(panel().text()).toContain('0 m / 106 m · 剩余 0:27');

    await routes()[1]?.trigger('click');
    expect(owner.roam.value).toMatchObject({ kind: 'route', routeId: 'platform', playing: false });
    expect(routes().map(route => route.attributes('aria-checked'))).toStrictEqual(['false', 'true']);
  });

  it('路线：开始后是暂停，走过一段后暂停是继续，到终点是重新开始；速度改剩余时间', async () => {
    const { wrapper, owner, report, progress } = mountPanel();
    await add(owner, 'station');
    await report({ station: 'ready' });
    owner.startRoute('station', 'enter');
    await nextTick();
    const panel = () => wrapper.get('[data-roam-panel]');

    await textButton(wrapper, '开始')?.trigger('click');
    expect(owner.routePhase.value).toBe('playing');
    await progress(53);
    // 剩余时间按播放的规则估算，北拐的弯放慢也算进去（ADR 0156 R.5）：按长度和速度是 13.3 秒、写 0:13
    expect(panel().text()).toContain('53 m / 106 m · 剩余 0:14');
    await textButton(wrapper, '暂停')?.trigger('click');
    expect(textButton(wrapper, '继续')).toBeDefined();
    expect(panel().text()).toContain('暂停时拖动查看四周，继续后回到路线视角');

    await panel().get('button[aria-label="加速"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 6 });
    expect(panel().text()).toContain('剩余 0:09');

    await progress(106, true);
    expect(panel().text()).toContain('已到终点');
    await textButton(wrapper, '重新开始')?.trigger('click');
    expect(owner.roam.value).toMatchObject({ playing: true, run: 1 });
  });

  it('换方式：步行、路线之间切换，速度不变；面板可以收起成竖条', async () => {
    const { wrapper, owner, report, collapsed } = mountPanel();
    await add(owner, 'station');
    await report({ station: 'ready' });
    owner.startRoam('station');
    owner.setSpeed(2.5);
    await nextTick();
    const modes = () => wrapper.get('[data-roam-panel] [aria-label="漫游方式"]');

    await modes().findAll('input').at(1)?.setValue(true);
    expect(owner.roam.value).toMatchObject({ kind: 'route', routeId: 'enter', speed: 2.5 });
    expect(modes().get('.is-active').text()).toBe('路线');
    await modes().findAll('input').at(0)?.setValue(true);
    expect(owner.roam.value).toMatchObject({ kind: 'walk', speed: 2.5 });

    await button(wrapper, '收起漫游').trigger('click');
    expect(collapsed.value).toBe(true);
    expect(wrapper.get('button[aria-label="展开漫游"]').text()).toBe('漫游');
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

describe('漫游面板里的步行（ADR 0086、0097）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('建好后进入站内、行走：调速、回到起始点、脱困改意图；提示几秒后消失，同样的提示再来一次重新显示', async () => {
    const { wrapper, owner, report, builds, walk } = mountPanel();
    await add(owner, 'station');
    await report({ station: 'ready' });
    owner.startWalk('station');
    builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    const panel = () => wrapper.get('[data-roam-panel]');
    expect(panel().text()).toContain('正在进入站内…');

    await walk('walking');
    expect(panel().text()).toContain('4 m/s');
    expect(panel().text()).toContain('W / A / S / D行走');
    await panel().get('button[aria-label="加速"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 6 });
    await textButton(wrapper, '默认')?.trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 4 });
    await panel().get('button[aria-label="减速"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 2.5 });
    // 最慢一档时减速不可用
    owner.setSpeed(1);
    await nextTick();
    await panel().get('button[aria-label="减速"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ speed: 0.5 });
    expect(panel().get('button[aria-label="减速"]').attributes('disabled')).toBeDefined();
    await textButton(wrapper, '回到起始点')?.trigger('click');
    await textButton(wrapper, '脱困')?.trigger('click');
    expect(owner.roam.value).toMatchObject({ respawn: 1, unstuck: 1 });

    vi.useFakeTimers();
    await walk('walking', 'open', 1);
    expect(panel().text()).toContain('当前位置可以正常行走，无需脱困');
    vi.advanceTimersByTime(3500);
    await nextTick();
    expect(panel().text()).not.toContain('无需脱困');
    await walk('walking', 'open', 2);
    expect(panel().text()).toContain('无需脱困');
  });

  it('人称切换由页面决定显示（ADR 0090）：默认没有，操作说明是第一人称的；显示时点第三人称改意图、换操作说明', async () => {
    const hidden = mountPanel();
    await add(hidden.owner, 'station');
    await hidden.report({ station: 'ready' });
    hidden.owner.startWalk('station');
    hidden.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    await hidden.walk('walking');
    const hiddenPanel = hidden.wrapper.get('[data-roam-panel]');
    expect(hiddenPanel.find('[aria-label="人称"]').exists()).toBe(false);
    expect(hiddenPanel.text()).toContain('右键拖动转向滚轮缩放视野');

    const { wrapper, owner, report, builds, walk } = mountPanel(CATALOG, { personSwitch: true });
    await add(owner, 'station');
    await report({ station: 'ready' });
    owner.startWalk('station');
    builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    await walk('walking');
    const panel = () => wrapper.get('[data-roam-panel]');
    const views = panel().get('[aria-label="人称"]');
    expect(views.text()).toBe('第一人称第三人称');
    await views.findAll('input').at(1)?.setValue(true);
    expect(owner.roam.value).toMatchObject({ view: 'third' });
    expect(panel().text()).toContain('右键拖动旋转视角滚轮 / 中键拖动调远近');
  });

  it('分析失败可以重试；附近找不到能站的地方时提示，只能退出', async () => {
    const { wrapper, owner, report, builds, walk } = mountPanel();
    await add(owner, 'station');
    await report({ station: 'ready' });
    owner.startWalk('station');
    builds[0]?.reject(new Error('瓦片下载失败（404）'));
    await flushBuild();
    const panel = () => wrapper.get('[data-roam-panel]');
    expect(panel().text()).toContain('站内空间分析失败，请重试');

    await textButton(wrapper, '重试')?.trigger('click');
    expect(builds).toHaveLength(2);
    expect(panel().text()).toContain('正在分析站内空间');
    builds[1]?.resolve(NAVIGATION);
    await flushBuild();
    await walk('failed');
    expect(panel().text()).toContain('附近没有找到可以站立的室内位置');
    expect(textButton(wrapper, '重试')).toBeUndefined();

    await textButton(wrapper, '退出漫游')?.trigger('click');
    expect(wrapper.find('[data-roam-panel]').exists()).toBe(false);
  });
});

describe('高斯泼溅的漫游（ADR 0156）', () => {
  const SPLATS = buildModelCatalog(
    sceneManifestSchema.parse({
      models: [
        {
          id: 'tomb',
          name: '土山墓',
          cityCode: '320300',
          kind: 'splat',
          underground: false,
          lcc2: 'T/lcc2-sog-result/T.lcc2',
          placement: { lng: 117.18, lat: 34.25, height: 42, heading: 0 },
          spawn: { lng: 117.18, lat: 34.25, height: 41.3, heading: 20 },
          routes: [{ id: 'hall', name: '入口进保护厅', path: [[117.18, 34.25, 41.3], [117.18, 34.2502, 42.6]] }]
        }
      ]
    }),
    'https://maps.test/3dt/manifest.json'
  );

  it('有出生点的泼溅也有"漫游"，从步行开始；叫法不是站内：分析中、失败、进入、找不到能站的地方', async () => {
    const { wrapper, owner, report, builds, walk } = mountPanel(SPLATS);
    await add(owner, 'tomb');
    await report({ tomb: 'ready' });
    await wrapper.get('[data-roam="tomb"]').trigger('click');
    expect(owner.roam.value).toMatchObject({ kind: 'walk', modelId: 'tomb' });
    const panel = () => wrapper.get('[data-roam-panel]');
    expect(panel().get('header').text()).toContain('漫游土山墓 · 高斯泼溅');
    expect(panel().text()).toContain('正在分析可行走的空间 0%');

    builds[0]?.reject(new Error('网格下载失败（404）'));
    await flushBuild();
    expect(panel().text()).toContain('可行走的空间分析失败，请重试');
    await textButton(wrapper, '重试')?.trigger('click');
    builds[1]?.resolve(NAVIGATION);
    await flushBuild();
    expect(panel().text()).toContain('正在进入…');
    await walk('failed');
    expect(panel().text()).toContain('附近没有找到可以站立的位置');
    expect(panel().text()).not.toContain('站内');
    expect(panel().text()).not.toContain('室内');
  });
});
