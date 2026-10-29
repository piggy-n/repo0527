// @vitest-environment node
import {
  type CameraState,
  type NavBuildProgress,
  NavGrid,
  type Navigation,
  navigationFrame,
  type RoamStatus,
  type SceneStatus,
  type WalkView
} from '@yzt/map-core';
import type { CameraControl } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { sceneManifestSchema } from '../api';
import { buildModelCatalog } from '../catalog';
import { type SceneModelsContext, useSceneModels } from './useSceneModels';

const CATALOG = buildModelCatalog(
  sceneManifestSchema.parse({
    models: [
      {
        id: 'station',
        name: '车站',
        cityCode: '320500',
        kind: 'indoor',
        underground: true,
        tileset: 'S/tileset.json',
        spawn: { lng: 120.666, lat: 31.3175, height: -5.1, heading: 76 },
        routes: [
          { id: 'enter', name: '进站', path: [[120.666, 31.3175, -5.1], [120.6662, 31.3175, -5.1]] },
          { id: 'platform', name: '站台', path: [[120.666, 31.3175, -10], [120.666, 31.3176, -10]] }
        ]
      },
      {
        id: 'white',
        name: '白膜',
        cityCode: '320500',
        kind: 'white',
        underground: false,
        effects: [
          { id: 'plain', label: '无纹理', tileset: 'W/plain/tileset.json' },
          { id: 'window', label: '内置效果1', tileset: 'W/window/tileset.json' }
        ]
      },
      { id: 'city', name: '倾斜', cityCode: '320100', kind: 'oblique', underground: false, tileset: 'C/tileset.json' }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

const CAMERA: CameraState = { center: [120.66, 31.31], zoom: 16, bearing: 0, pitch: 55 };
const AVATAR_URL = 'https://maps.test/roam/Cesium_Man.glb';

// 拥有者只把导航网格原样交给会话：一块空网格就够
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

// 建导航网格换成用例控制的：记下每次请求，由用例决定建好、失败
interface PendingBuild {
  readonly url: string;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: NavBuildProgress) => void;
  readonly resolve: (navigation: Navigation) => void;
  readonly reject: (error: Error) => void;
}

function setup(catalog = CATALOG) {
  const builds: PendingBuild[] = [];
  const loadNavigation = (url: string, { signal, onProgress }: Pick<PendingBuild, 'signal' | 'onProgress'>) =>
    new Promise<Navigation>((resolve, reject) => builds.push({ url, signal, onProgress, resolve, reject }));
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const roamStatus = shallowRef<RoamStatus | null>(null);
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control = { flyTo } as unknown as CameraControl;
  // 和上下文一样：开始一次新的相机操作时，上一次的信号中止，被作废的操作 run 时放弃
  let current = new AbortController();
  const beginCameraOperation = vi.fn<SceneModelsContext['beginCameraOperation']>(() => {
    current.abort(new DOMException('有新的相机操作', 'AbortError'));
    current = new AbortController();
    const { signal } = current;
    return {
      signal,
      run: action => {
        if (!signal.aborted) {
          action(control);
        }
      }
    };
  });
  const runCameraOperation = vi.fn<SceneModelsContext['runCameraOperation']>(action =>
    beginCameraOperation().run(action)
  );
  const scope = effectScope();
  const owner = scope.run(() =>
    useSceneModels({ sceneStatus, roamStatus, runCameraOperation, beginCameraOperation }, catalog, {
      loadNavigation,
      avatarUrl: AVATAR_URL
    })
  );
  if (!owner) {
    throw new Error('作用域没有运行');
  }
  const ready = (...ids: string[]) => {
    sceneStatus.value = new Map(ids.map(id => [id, { state: 'ready', camera: CAMERA }]));
  };
  const dispose = () => scope.stop();
  return { owner, sceneStatus, roamStatus, flyTo, runCameraOperation, ready, builds, [Symbol.dispose]: dispose };
}

const summary = ({ tilesets }: ReturnType<ReturnType<typeof setup>['owner']['deriveContent']>) =>
  tilesets.map(({ id, show, lighting, group }) => [id, show, lighting, group ?? null]);

describe('useSceneModels', () => {
  it('勾选即加载、按勾选的先后；地下、室内用头灯，白膜按效果分组', () => {
    using ctx = setup();

    ctx.owner.setChecked('city', true);
    ctx.owner.setChecked('white', true);
    ctx.owner.setChecked('station', true);
    ctx.owner.setChecked('city', true);

    expect(ctx.owner.loaded.value).toStrictEqual(['city', 'white', 'station']);
    expect(summary(ctx.owner.deriveContent())).toStrictEqual([
      ['city', true, 'sun', null],
      ['white/plain', true, 'sun', 'white'],
      ['station', true, 'headlight', null]
    ]);
    expect(ctx.owner.deriveContent().tilesets[0]?.url).toBe('https://maps.test/3dt/C/tileset.json');
  });

  it('换白膜效果：显示过的留在场景里、只显示当前的，换回来不重新加载', () => {
    using ctx = setup();
    ctx.owner.setChecked('white', true);

    ctx.owner.setEffect('white', 'window');
    expect(ctx.owner.effectOf('white')).toBe('window');
    expect(summary(ctx.owner.deriveContent())).toStrictEqual([
      ['white/plain', false, 'sun', 'white'],
      ['white/window', true, 'sun', 'white']
    ]);

    ctx.owner.setEffect('white', 'plain');
    expect(summary(ctx.owner.deriveContent()).map(([id, show]) => [id, show])).toStrictEqual([
      ['white/plain', true],
      ['white/window', false]
    ]);
  });

  it('状态取当前瓦片集的报告；没有报告时是加载中', () => {
    using ctx = setup();
    ctx.owner.setChecked('white', true);
    expect(ctx.owner.stateOf('white')).toBe('loading');

    ctx.sceneStatus.value = new Map([['white/plain', { state: 'failed', error: new Error('404') }]]);
    expect(ctx.owner.stateOf('white')).toBe('failed');
    ctx.owner.setEffect('white', 'window');
    expect(ctx.owner.stateOf('white')).toBe('loading');
  });

  it('定位：就绪后飞到报告的相机；没有单独的钻地，地下的模型也只是飞过去（ADR 0097 第 5 节）', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.owner.setChecked('white', true);
    ctx.owner.setChecked('city', true);
    expect(() => ctx.owner.locate('station')).toThrow('模型 station 还不能定位');

    ctx.ready('station', 'white/plain', 'city');
    ctx.owner.locate('station');

    expect(ctx.flyTo).toHaveBeenCalledWith(CAMERA);
    expect(ctx.owner.deriveContent().underground).toBeNull();
    expect(summary(ctx.owner.deriveContent()).map(([id, show]) => [id, show])).toStrictEqual([
      ['station', true],
      ['white/plain', true],
      ['city', true]
    ]);
  });

  it('单独勾选一个模型时就绪后飞过去；多选、取消勾选、有了别的定位时不动相机', async () => {
    using ctx = setup();
    ctx.owner.setChecked('city', true);
    await nextTick();
    expect(ctx.flyTo).not.toHaveBeenCalled();
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledExactlyOnceWith(CAMERA);

    // 多选：后勾选的不飞；取消勾选剩下一个也不飞
    ctx.owner.setChecked('white', true);
    ctx.ready('city', 'white/plain');
    ctx.owner.setChecked('city', false);
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledOnce();

    // 单独勾选、还没就绪时又勾选了别的
    ctx.owner.setChecked('white', false);
    ctx.owner.setChecked('station', true);
    ctx.owner.setChecked('city', true);
    ctx.ready('station', 'city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledOnce();

    // 单独勾选、还没就绪时有了别的定位
    ctx.owner.setChecked('station', false);
    ctx.owner.setChecked('city', false);
    ctx.sceneStatus.value = new Map();
    ctx.owner.setChecked('white', true);
    ctx.runCameraOperation(() => {});
    ctx.ready('white/plain');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledOnce();
  });

  it('单独勾选的模型加载失败后重试，就绪时照样飞过去', async () => {
    using ctx = setup();
    ctx.owner.setChecked('city', true);
    ctx.sceneStatus.value = new Map([['city', { state: 'failed', error: new Error('404') }]]);
    await nextTick();
    ctx.owner.retry('city');
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledExactlyOnceWith(CAMERA);
  });

  it('卸载时忘掉效果和重试次数', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.retry('station');
    expect(ctx.owner.deriveContent().tilesets[0]?.attempt).toBe(1);

    ctx.owner.setChecked('station', false);
    ctx.owner.setChecked('station', true);
    expect(ctx.owner.deriveContent().tilesets[0]?.attempt).toBe(0);
  });

  it('重试只加当前效果的次数', () => {
    using ctx = setup();
    ctx.owner.setChecked('white', true);
    ctx.owner.retry('white');
    ctx.owner.setEffect('white', 'window');
    ctx.owner.retry('white');
    ctx.owner.retry('white');

    expect(ctx.owner.deriveContent().tilesets.map(({ id, attempt }) => [id, attempt])).toStrictEqual([
      ['white/plain', 1],
      ['white/window', 2]
    ]);
  });

  it('参数不合法时抛错：没有的模型和效果、没加载、不是白膜', () => {
    using ctx = setup();
    expect(() => ctx.owner.setChecked('nothing', true)).toThrow('目录里没有模型 nothing');
    expect(() => ctx.owner.locate('city')).toThrow('模型 city 没有加载');
    expect(() => ctx.owner.setEffect('city', '')).toThrow('模型 city 没有效果');
    expect(() => ctx.owner.setEffect('white', 'tech')).toThrow('模型 white 没有效果 tech');
  });
});

describe('useSceneModels 的路线漫游（ADR 0083）', () => {
  it('只有加载完成的模型、清单里有的路线能开始', () => {
    using ctx = setup();
    expect(() => ctx.owner.startRoute('station', 'enter')).toThrow('模型 station 没有加载');
    ctx.owner.setChecked('station', true);
    expect(() => ctx.owner.startRoute('station', 'enter')).toThrow('模型 station 还不能漫游');
    ctx.ready('station');
    expect(() => ctx.owner.startRoute('station', 'nowhere')).toThrow('模型 station 没有路线 nowhere');
  });

  it('开始：停在起点交给会话；漫游地下的模型时在地下空间，地面上的模型不显示；播放、暂停、速度改意图', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');

    ctx.owner.startRoute('station', 'enter');
    const roam = ctx.owner.deriveContent().roam;
    expect(roam).toMatchObject({ kind: 'route', playing: false, speed: 4, run: 0 });
    expect(roam?.kind === 'route' && roam.path).toHaveLength(2);
    expect(ctx.owner.deriveContent().underground).toStrictEqual({ tilesetId: 'station', surfaceOpacity: 0.25 });
    expect(ctx.owner.routePhase.value).toBe('ready');

    ctx.owner.playRoute();
    expect(ctx.owner.routePhase.value).toBe('playing');
    ctx.owner.setSpeed(2.5);
    ctx.owner.pauseRoute();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: false, speed: 2.5, run: 0 });
    expect(() => ctx.owner.setSpeed(3)).toThrow('漫游速度只能是 0.5、1、1.6、2.5、4、6、8');
  });

  it('进度只认这一次、这一遍的；走过一段后暂停是 paused，到终点再播放从头走一遍', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');
    const id = ctx.owner.roam.value?.id ?? '';

    ctx.roamStatus.value = { kind: 'route', id: 'other', run: 0, distance: 5, total: 19, finished: false };
    expect(ctx.owner.roamStatus.value).toBeNull();
    ctx.roamStatus.value = { kind: 'route', id, run: 0, distance: 5, total: 19, finished: false };
    expect(ctx.owner.routePhase.value).toBe('paused');

    ctx.owner.playRoute();
    ctx.roamStatus.value = { kind: 'route', id, run: 0, distance: 19, total: 19, finished: true };
    expect(ctx.owner.routePhase.value).toBe('finished');
    ctx.owner.playRoute();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: true, run: 1 });
    expect(ctx.owner.roamStatus.value).toBeNull();
  });

  it('有了别的定位就退出漫游、回到地面；换一条路线不会被上一条的信号退出，沿用选过的速度', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');
    ctx.owner.setSpeed(2.5);
    ctx.owner.startRoute('station', 'platform');
    expect(ctx.owner.roam.value).toMatchObject({ routeId: 'platform', speed: 2.5, playing: false });

    ctx.owner.locate('station');
    expect(ctx.owner.roam.value).toBeNull();
    expect(ctx.owner.deriveContent().roam).toBeUndefined();
    expect(ctx.owner.deriveContent().underground).toBeNull();
  });

  it('退出、卸载这个模型都结束漫游；退出后回到地面（ADR 0097 第 5 节）', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');

    ctx.owner.exitRoam();
    expect(ctx.owner.roam.value).toBeNull();
    expect(ctx.owner.deriveContent().underground).toBeNull();
    expect(() => ctx.owner.playRoute()).toThrow('没有在路线漫游');

    ctx.owner.startRoute('station', 'enter');
    ctx.owner.setChecked('station', false);
    expect(ctx.owner.roam.value).toBeNull();
  });
});

const flushBuild = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useSceneModels 的步行（ADR 0086）', () => {
  it('只有加载完成、清单里有出生点的模型能开始；漫游地下的模型时在地下空间', () => {
    using ctx = setup();
    expect(() => ctx.owner.startWalk('station')).toThrow('模型 station 没有加载');
    ctx.owner.setChecked('station', true);
    ctx.owner.setChecked('city', true);
    expect(() => ctx.owner.startWalk('station')).toThrow('模型 station 还不能步行');
    ctx.ready('station', 'city');
    expect(() => ctx.owner.startWalk('city')).toThrow('模型 city 的清单里没有出生点，不能步行');

    ctx.owner.startWalk('station');

    expect(ctx.owner.roam.value).toMatchObject({
      kind: 'walk',
      modelId: 'station',
      speed: 4,
      respawn: 0,
      unstuck: 0
    });
    expect(ctx.owner.deriveContent().underground).toStrictEqual({ tilesetId: 'station', surfaceOpacity: 0.25 });
    expect(ctx.owner.routePhase.value).toBeNull();
  });

  it('先建导航网格并报告进度，建好以后才交给会话；之后按视图报告的阶段和提示', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    const id = ctx.owner.roam.value?.id ?? '';
    const [build] = ctx.builds;

    expect(build?.url).toBe('https://maps.test/3dt/S/tileset.json');
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'preparing', progress: 0 });
    expect(ctx.owner.deriveContent().roam).toBeUndefined();
    build?.onProgress({ stage: 'download', done: 1, total: 2 });
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'preparing', progress: 0.4 });
    build?.onProgress({ stage: 'build' });
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'preparing', progress: 0.9 });

    build?.resolve(NAVIGATION);
    await flushBuild();
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'entering' });
    expect(ctx.owner.deriveContent().roam).toStrictEqual({
      kind: 'walk',
      id,
      navigation: NAVIGATION,
      spawn: { lng: 120.666, lat: 31.3175, height: -5.1, heading: 76 },
      speed: 4,
      respawn: 0,
      unstuck: 0,
      paused: false,
      teleport: null,
      view: 'first',
      avatar: AVATAR_URL
    });

    const status = { kind: 'walk', view: 'first', player: null } as const;
    ctx.roamStatus.value = { ...status, id: 'other', phase: 'walking', notice: 'blocked', notices: 1 };
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'entering' });
    expect(ctx.owner.walkNotice.value).toBeNull();
    ctx.roamStatus.value = { ...status, id, phase: 'walking', notice: 'blocked', notices: 1 };
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'walking' });
    expect(ctx.owner.walkNotice.value).toStrictEqual({ notice: 'blocked', count: 1 });
    ctx.roamStatus.value = { ...status, id, phase: 'failed', notice: null, notices: 1 };
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'failed', reason: 'spawn' });
  });

  it('建好的导航网格按模型留着：再步行不用重建；卸载模型时丢掉', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    ctx.owner.exitRoam();

    ctx.owner.startWalk('station');
    expect(ctx.builds).toHaveLength(1);
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'entering' });

    ctx.owner.setChecked('station', false);
    expect(ctx.owner.roam.value).toBeNull();
    ctx.owner.setChecked('station', true);
    ctx.owner.startWalk('station');
    expect(ctx.builds).toHaveLength(2);
  });

  it('建不出来时显示失败、可以重试；退出时中止正在建的，晚到的结果不写入', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    expect(() => ctx.owner.retryWalk()).toThrow('导航网格没有失败，不用重试');

    ctx.builds[0]?.reject(new Error('瓦片下载失败（404）'));
    await flushBuild();
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'failed', reason: 'build' });
    ctx.owner.retryWalk();
    expect(ctx.builds).toHaveLength(2);
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'preparing', progress: 0 });

    ctx.owner.exitRoam();
    expect(ctx.builds[1]?.signal.aborted).toBe(true);
    ctx.builds[1]?.resolve(NAVIGATION);
    await flushBuild();
    ctx.owner.startWalk('station');
    expect(ctx.builds).toHaveLength(3);
  });

  it('人称默认第一人称，换了在几次步行之间沿用；不在步行、人称不对时抛错（ADR 0090）', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    expect(() => ctx.owner.setWalkView('third')).toThrow('没有在步行');
    ctx.owner.startWalk('station');
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ view: 'first' });

    ctx.owner.setWalkView('third');
    expect(ctx.owner.deriveContent().roam).toMatchObject({ view: 'third', avatar: AVATAR_URL });
    const before = ctx.owner.roam.value;
    ctx.owner.setWalkView('third');
    expect(ctx.owner.roam.value).toBe(before);
    expect(() => ctx.owner.setWalkView('top' as unknown as WalkView)).toThrow('人称只能是 first、third：top');

    ctx.owner.exitRoam();
    ctx.owner.startWalk('station');
    expect(ctx.owner.roam.value).toMatchObject({ view: 'third' });
  });

  it('速度按档位、默认 4 m/s（ADR 0094），几次步行之间沿用；回到起始点、脱困把计数加 1；不在漫游、步行时调用抛错', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    expect(() => ctx.owner.respawnWalk()).toThrow('没有在步行');
    expect(() => ctx.owner.setSpeed(6)).toThrow('没有在漫游');
    ctx.owner.startWalk('station');
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();

    expect(ctx.owner.deriveContent().roam).toMatchObject({ speed: 4 });
    ctx.owner.setSpeed(6);
    ctx.owner.respawnWalk();
    ctx.owner.unstuckWalk();
    ctx.owner.unstuckWalk();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ speed: 6, respawn: 1, unstuck: 2 });
    expect(() => ctx.owner.setSpeed(3)).toThrow('漫游速度只能是 0.5、1、1.6、2.5、4、6、8');

    ctx.owner.exitRoam();
    ctx.owner.startWalk('station');
    expect(ctx.owner.roam.value).toMatchObject({ speed: 6, respawn: 0, unstuck: 0 });
  });

  it('有了别的定位就退出步行，正在建的一并中止；开始路线漫游也结束步行，同一个模型的导航网格接着建（ADR 0097 第 6 节）', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');

    ctx.owner.locate('station');
    expect(ctx.owner.roam.value).toBeNull();
    expect(ctx.builds[0]?.signal.aborted).toBe(true);

    ctx.owner.startWalk('station');
    ctx.owner.startRoute('station', 'enter');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'route' });
    expect(ctx.builds).toHaveLength(2);
    expect(ctx.builds[1]?.signal.aborted).toBe(false);
    expect(ctx.owner.walkStage.value).toBeNull();
  });
});

describe('useSceneModels 的漫游入口与方式（ADR 0097）', () => {
  // 只有路线、没有出生点的模型
  const ROUTE_ONLY = buildModelCatalog(
    sceneManifestSchema.parse({
      models: [
        {
          id: 'square',
          name: '广场',
          cityCode: '320500',
          kind: 'oblique',
          underground: false,
          tileset: 'Q/tileset.json',
          routes: [{ id: 'loop', name: '环线', path: [[120.6, 31.3, 2], [120.601, 31.3, 2]] }]
        }
      ]
    }),
    'https://maps.test/3dt/manifest.json'
  );

  it('漫游：有出生点的从步行开始，只有路线的停在第一条路线的起点；都没有的抛错', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.owner.setChecked('city', true);
    ctx.ready('station', 'city');
    ctx.owner.startRoam('station');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'walk', modelId: 'station', speed: 4 });
    expect(() => ctx.owner.startRoam('city')).toThrow('模型 city 既没有出生点也没有路线，不能漫游');

    using route = setup(ROUTE_ONLY);
    route.owner.setChecked('square', true);
    route.ready('square');
    route.owner.startRoam('square');
    expect(route.owner.roam.value).toMatchObject({ kind: 'route', modelId: 'square', routeId: 'loop', playing: false });
  });

  it('换方式：同一个模型，速度不变；换回路线接着上次的路线，再次漫游也是；没在漫游、没有这种方式时抛错', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    expect(() => ctx.owner.setRoamMode('route')).toThrow('没有在漫游');
    ctx.owner.startRoam('station');
    ctx.owner.setSpeed(6);

    ctx.owner.setRoamMode('route');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'route', routeId: 'enter', speed: 6 });
    ctx.owner.startRoute('station', 'platform');
    ctx.owner.setRoamMode('walk');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'walk', modelId: 'station', speed: 6 });
    ctx.owner.setRoamMode('route');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'route', routeId: 'platform' });

    // 同一种方式不重新开始
    const current = ctx.owner.roam.value;
    ctx.owner.setRoamMode('route');
    expect(ctx.owner.roam.value).toBe(current);

    using route = setup(ROUTE_ONLY);
    route.owner.setChecked('square', true);
    route.ready('square');
    route.owner.startRoam('square');
    expect(() => route.owner.setRoamMode('walk')).toThrow('模型 square 的清单里没有出生点，不能步行');
  });
});

describe('useSceneModels 路线漫游时的地图（ADR 0097 第 6 节）', () => {
  it('室内的模型开始路线漫游时建导航网格，路线不等它；建好后有室内地图、人和路线，人按走过的米数在路线上', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');
    expect(ctx.builds).toHaveLength(1);
    expect(ctx.owner.deriveContent().roam).toMatchObject({ kind: 'route', playing: false });
    expect([ctx.owner.indoorMap.value, ctx.owner.roamPlayer.value, ctx.owner.routeTrack.value]).toStrictEqual([
      null,
      null,
      null
    ]);

    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    expect(ctx.owner.indoorMap.value?.grid).toBe(NAVIGATION.grid);
    const track = required(ctx.owner.routeTrack.value, '没有路线');
    const [start, end] = track.points;
    expect(track.walked).toBe(0);
    expect(end?.distance).toBeCloseTo(19, 0);
    expect(ctx.owner.roamPlayer.value).toMatchObject({ target: null });
    expect(ctx.owner.roamPlayer.value?.x).toBeCloseTo(start?.x ?? Number.NaN, 3);
    expect(ctx.owner.roamPlayer.value?.floor).toBeCloseTo(start?.floor ?? Number.NaN, 3);

    const id = ctx.owner.roam.value?.id ?? '';
    ctx.roamStatus.value = { kind: 'route', id, run: 0, distance: 19, total: 19, finished: true };
    expect(ctx.owner.routeTrack.value?.walked).toBe(19);
    expect(ctx.owner.roamPlayer.value?.x).toBeCloseTo(end?.x ?? Number.NaN, 1);
  });

  it('同一个模型换方式时还在建的导航网格接着建，不重新下载；退出漫游时中止；地面上的模型路线漫游不建', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    ctx.owner.setRoamMode('route');
    ctx.owner.setRoamMode('walk');
    expect(ctx.builds).toHaveLength(1);
    expect(ctx.builds[0]?.signal.aborted).toBe(false);
    ctx.owner.exitRoam();
    expect(ctx.builds[0]?.signal.aborted).toBe(true);

    using square = setup(
      buildModelCatalog(
        sceneManifestSchema.parse({
          models: [
            {
              id: 'square',
              name: '广场',
              cityCode: '320500',
              kind: 'oblique',
              underground: false,
              tileset: 'Q/tileset.json',
              routes: [{ id: 'loop', name: '环线', path: [[120.6, 31.3, 2], [120.601, 31.3, 2]] }]
            }
          ]
        }),
        'https://maps.test/3dt/manifest.json'
      )
    );
    square.owner.setChecked('square', true);
    square.ready('square');
    square.owner.startRoam('square');
    expect(square.builds).toHaveLength(0);
    expect(() => square.owner.openMap()).toThrow('站内地图还没有准备好');
  });

  it('完整地图：建好以后才能打开；打开时路线暂停，关上时打开前在播放就接着播放；不能瞬移', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');
    expect(() => ctx.owner.openMap()).toThrow('站内地图还没有准备好，不能打开完整地图');
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();

    ctx.owner.playRoute();
    ctx.owner.openMap();
    expect(ctx.owner.mapOpen.value).toBe(true);
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: false });
    expect(() => ctx.owner.teleportWalk({ x: 1, y: 2, floor: -5 })).toThrow('没有在步行');
    ctx.owner.closeMap();
    expect(ctx.owner.mapOpen.value).toBe(false);
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: true });

    // 暂停时打开、关上，仍是暂停
    ctx.owner.pauseRoute();
    ctx.owner.openMap();
    ctx.owner.closeMap();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: false });

    // 打开着时退出，再开始的路线不带着地图
    ctx.owner.openMap();
    ctx.owner.startRoute('station', 'platform');
    expect(ctx.owner.mapOpen.value).toBe(false);
  });
});

describe('useSceneModels 步行时的地图（ADR 0087）', () => {
  it('导航网格建好以后有室内地图；进到站内以后才能打开完整地图，打开时步行暂停', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    expect(ctx.owner.indoorMap.value).toBeNull();
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    const id = ctx.owner.roam.value?.id ?? '';

    expect(ctx.owner.indoorMap.value?.grid).toBe(NAVIGATION.grid);
    expect(() => ctx.owner.openMap()).toThrow('还没有进到站内');
    const player = { x: 1, y: 2, floor: -5, yaw: 0, hfov: 1.5, target: null };
    ctx.roamStatus.value = { kind: 'walk', id, phase: 'walking', view: 'first', notice: null, notices: 0, player };
    expect(ctx.owner.roamPlayer.value).toBe(player);

    ctx.owner.openMap();
    expect(ctx.owner.mapOpen.value).toBe(true);
    expect(ctx.owner.deriveContent().roam).toMatchObject({ paused: true });
    ctx.owner.closeMap();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ paused: false });
  });

  it('在完整地图上双击：瞬移计数加 1、带上位置，完整地图关上；退出步行后不再有地图', async () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    const id = ctx.owner.roam.value?.id ?? '';
    const status = { kind: 'walk', id, phase: 'walking', view: 'first', notice: null, notices: 0 } as const;
    ctx.roamStatus.value = { ...status, player: null };
    ctx.owner.openMap();

    ctx.owner.teleportWalk({ x: 3, y: 4, floor: -10 });
    ctx.owner.teleportWalk({ x: 5, y: 6, floor: -5 });

    expect(ctx.owner.mapOpen.value).toBe(false);
    expect(ctx.owner.deriveContent().roam).toMatchObject({ teleport: { count: 2, spot: { x: 5, y: 6, floor: -5 } } });
    expect(() => ctx.owner.teleportWalk({ x: Number.NaN, y: 0, floor: 0 })).toThrow('瞬移的位置有不是数的坐标');
    ctx.owner.exitRoam();
    expect(ctx.owner.indoorMap.value).toBeNull();
    expect(ctx.owner.mapOpen.value).toBe(false);
  });
});
