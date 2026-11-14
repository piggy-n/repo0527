// @vitest-environment node
import {
  type CameraState,
  type NavBuildProgress,
  NavGrid,
  type Navigation,
  navigationFrame,
  type RoamStatus,
  type ScanNavigation,
  type SceneStatus,
  type WalkView
} from '@mx/map-core';
import type { CameraControl, SceneCapabilities } from '@mx/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { sceneManifestSchema } from '../api';
import { buildModelCatalog } from '../catalog';
import type { LoadSplatNavigation } from '../navigation';
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
      { id: 'city', name: '倾斜', cityCode: '320100', kind: 'oblique', underground: false, tileset: 'C/tileset.json' },
      {
        id: 'scan',
        name: '扫描',
        cityCode: '320300',
        kind: 'splat',
        underground: false,
        lcc2: 'L/lcc2-sog-result/L.lcc2',
        placement: { lng: 117.06, lat: 34.27, height: 59.7, heading: 0 },
        spawn: { lng: 117.06, lat: 34.27, height: 59.2, heading: 20 },
        routes: [{ id: 'tomb', name: '进墓室', path: [[117.06, 34.27, 59.2], [117.06, 34.2702, 56, 0.9]] }]
      }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

// 引擎的能力（同 map-vue 的 MAPLIBRE_ENGINE），和不能显示高斯泼溅时的：这个文件在 node 环境里跑，不在运行时导入 map-vue
const MAPLIBRE: SceneCapabilities = { styleLayers: true, identify: true, splats: true };
const NO_SPLATS: SceneCapabilities = { ...MAPLIBRE, splats: false };

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

// 建导航网格换成用例控制的：记下每次请求，由用例决定建好、失败；高斯泼溅的 url 是索引的地址，带上清单的出生点
interface PendingBuild {
  readonly url: string;
  readonly spawn?: unknown;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: NavBuildProgress) => void;
  readonly resolve: (navigation: Navigation) => void;
  readonly reject: (error: Error) => void;
}

function setup(catalog = CATALOG, sceneCapabilities = MAPLIBRE) {
  // 大多数用例在三维里；二维的用例改它
  const dimension = ref<'2d' | '3d'>('3d');
  const builds: PendingBuild[] = [];
  const loadNavigation = (url: string, { signal, onProgress }: Pick<PendingBuild, 'signal' | 'onProgress'>) =>
    new Promise<Navigation>((resolve, reject) => builds.push({ url, signal, onProgress, resolve, reject }));
  const loadSplatNavigation: LoadSplatNavigation = (splat, spawn, { signal, onProgress }) =>
    new Promise<ScanNavigation>((resolve, reject) =>
      builds.push({
        url: splat.url,
        spawn,
        signal,
        onProgress,
        resolve: navigation => resolve({ ...navigation, partial: false }),
        reject
      })
    );
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
    useSceneModels(
      { sceneStatus, roamStatus, runCameraOperation, beginCameraOperation, sceneCapabilities, dimension },
      catalog,
      { loadNavigation, loadSplatNavigation, avatarUrl: AVATAR_URL }
    )
  );
  if (!owner) {
    throw new Error('作用域没有运行');
  }
  const ready = (...ids: string[]) => {
    sceneStatus.value = new Map(ids.map(id => [id, { state: 'ready', camera: CAMERA }]));
  };
  const dispose = () => scope.stop();
  return {
    owner,
    dimension,
    sceneStatus,
    roamStatus,
    flyTo,
    runCameraOperation,
    ready,
    builds,
    [Symbol.dispose]: dispose
  };
}

const summary = ({ tilesets }: ReturnType<ReturnType<typeof setup>['owner']['deriveContent']>) =>
  tilesets.map(({ id, show, lighting, group }) => [id, show, lighting, group ?? null]);

describe('useSceneModels', () => {
  it('加入即加载，新加入的在最前、已经加入的不动；地下、室内用头灯，白膜按效果分组', () => {
    using ctx = setup();

    ctx.owner.add(['city']);
    ctx.owner.add(['white']);
    ctx.owner.add(['station']);
    ctx.owner.add(['city']);

    expect(ctx.owner.added.value).toStrictEqual(['station', 'white', 'city']);
    expect(summary(ctx.owner.deriveContent())).toStrictEqual([
      ['station', true, 'headlight', null],
      ['white/plain', true, 'sun', 'white'],
      ['city', true, 'sun', null]
    ]);
    expect(ctx.owner.deriveContent().tilesets[2]?.url).toBe('https://maps.test/3dt/C/tileset.json');
  });

  it('一次加入几个（ADR 0157）：没加入过的整批放在最前、批内保持给出的先后；移出可以一次几个', () => {
    using ctx = setup();
    ctx.owner.add(['city']);

    ctx.owner.add(['white', 'city', 'station', 'white']);
    expect(ctx.owner.added.value).toStrictEqual(['white', 'station', 'city']);

    ctx.owner.remove(['white', 'scan', 'city']);
    expect(ctx.owner.added.value).toStrictEqual(['station']);
    // 移出后再加入，又放到最前
    ctx.owner.add(['city']);
    expect(ctx.owner.added.value).toStrictEqual(['city', 'station']);
  });

  it('移动只改先后；位置超出范围、没加入时抛错', () => {
    using ctx = setup();
    ctx.owner.add(['city', 'white', 'station']);

    ctx.owner.moveModel('city', 2);
    expect(ctx.owner.added.value).toStrictEqual(['white', 'station', 'city']);
    ctx.owner.moveModel('city', 0);
    expect(ctx.owner.added.value).toStrictEqual(['city', 'white', 'station']);

    expect(() => ctx.owner.moveModel('city', 3)).toThrow(RangeError);
    expect(() => ctx.owner.moveModel('city', 0.5)).toThrow(RangeError);
    expect(() => ctx.owner.moveModel('scan', 0)).toThrow('模型 scan 没有加入');
  });

  it('隐藏：交给会话时不显示、数据留着（白膜换过的效果也留着），再显示照常；移出时一起忘掉', () => {
    using ctx = setup();
    ctx.owner.add(['white', 'scan']);
    ctx.owner.setEffect('white', 'window');

    ctx.owner.setVisible('white', false);
    ctx.owner.setVisible('scan', false);
    expect(ctx.owner.hidden.value).toStrictEqual(new Set(['white', 'scan']));
    expect(summary(ctx.owner.deriveContent()).map(([id, show]) => [id, show])).toStrictEqual([
      ['white/plain', false],
      ['white/window', false]
    ]);
    expect(ctx.owner.deriveContent().splats?.map(({ id, show }) => [id, show])).toStrictEqual([['scan', false]]);

    ctx.owner.setVisible('white', true);
    expect(summary(ctx.owner.deriveContent()).map(([id, show]) => [id, show])).toStrictEqual([
      ['white/plain', false],
      ['white/window', true]
    ]);

    ctx.owner.remove(['scan']);
    ctx.owner.add(['scan']);
    expect(ctx.owner.hidden.value).toStrictEqual(new Set());
    expect(() => ctx.owner.setVisible('city', false)).toThrow('模型 city 没有加入');
  });

  it('高斯泼溅（ADR 0149）：引擎支持时在目录里，勾选后交给会话、状态按模型 ID、就绪后能定位；不能显示时不列出', () => {
    using ctx = setup();
    expect(ctx.owner.models.value.map(({ id }) => id)).toContain('scan');

    ctx.owner.add(['scan']);
    expect(ctx.owner.deriveContent().splats?.map(({ id, url }) => [id, url])).toStrictEqual([
      ['scan', 'https://maps.test/3dt/L/lcc2-sog-result/L.lcc2']
    ]);
    expect(ctx.owner.stateOf('scan')).toBe('loading');
    ctx.ready('scan');
    expect(ctx.owner.stateOf('scan')).toBe('ready');
    ctx.owner.locate('scan');
    expect(ctx.flyTo).toHaveBeenCalledWith(CAMERA);
    ctx.owner.remove(['scan']);
    expect(ctx.owner.deriveContent()).not.toHaveProperty('splats');

    using noSplats = setup(CATALOG, NO_SPLATS);
    expect(noSplats.owner.models.value.map(({ id }) => id)).toStrictEqual(['station', 'white', 'city']);
  });

  it('换白膜效果：显示过的留在场景里、只显示当前的，换回来不重新加载', () => {
    using ctx = setup();
    ctx.owner.add(['white']);

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
    ctx.owner.add(['white']);
    expect(ctx.owner.stateOf('white')).toBe('loading');

    ctx.sceneStatus.value = new Map([['white/plain', { state: 'failed', error: new Error('404') }]]);
    expect(ctx.owner.stateOf('white')).toBe('failed');
    ctx.owner.setEffect('white', 'window');
    expect(ctx.owner.stateOf('white')).toBe('loading');
  });

  it('定位：就绪后飞到报告的相机；没有单独的钻地，地下的模型也只是飞过去（ADR 0097 第 5 节）', () => {
    using ctx = setup();
    ctx.owner.add(['station']);
    ctx.owner.add(['white']);
    ctx.owner.add(['city']);

    ctx.ready('station', 'white/plain', 'city');
    ctx.owner.locate('station');

    expect(ctx.flyTo).toHaveBeenCalledWith(CAMERA);
    expect(ctx.owner.deriveContent().underground).toBeNull();
    expect(summary(ctx.owner.deriveContent()).map(([id, show]) => [id, show])).toStrictEqual([
      ['city', true],
      ['white/plain', true],
      ['station', true]
    ]);
  });

  it('还没就绪时定位：等就绪后飞过去；隐藏它时放弃；隐藏着的不能定位', async () => {
    using ctx = setup();
    ctx.owner.add(['station', 'city']);
    ctx.runCameraOperation(() => {});

    ctx.owner.locate('city');
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledExactlyOnceWith(CAMERA);

    ctx.owner.locate('station');
    ctx.owner.setVisible('station', false);
    ctx.ready('city', 'station');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(1);
    expect(() => ctx.owner.locate('station')).toThrow('模型 station 隐藏着，不能定位');
  });

  it('二维里加入只进列表：不飞过去，切到三维时也不飞；二维里不能定位（ADR 0157）', async () => {
    using ctx = setup();
    ctx.dimension.value = '2d';
    ctx.owner.add(['city']);
    expect(ctx.owner.added.value).toStrictEqual(['city']);
    expect(() => ctx.owner.locate('city')).toThrow('二维里不能定位三维模型');

    ctx.dimension.value = '3d';
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).not.toHaveBeenCalled();
    ctx.owner.locate('city');
    expect(ctx.flyTo).toHaveBeenCalledExactlyOnceWith(CAMERA);
  });

  it('每次加入一个模型都在就绪后飞过去，不看已经加入了几个；移出、有了别的定位时不动相机', async () => {
    using ctx = setup();
    ctx.owner.add(['city']);
    await nextTick();
    expect(ctx.flyTo).not.toHaveBeenCalled();
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledExactlyOnceWith(CAMERA);

    // 已经加入了一个，再加入的照样飞
    ctx.owner.add(['white']);
    ctx.ready('city', 'white/plain');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(2);

    // 移出不飞，剩下一个也不飞
    ctx.owner.remove(['city']);
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(2);

    // 还没就绪时移出别的模型，不影响飞向新加入的
    ctx.sceneStatus.value = new Map();
    ctx.owner.add(['station']);
    ctx.owner.remove(['white']);
    ctx.ready('station');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(3);

    // 还没就绪时移出它自己：不飞
    ctx.sceneStatus.value = new Map();
    ctx.owner.add(['city']);
    ctx.owner.remove(['city']);
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(3);

    // 还没就绪时又加入了别的：飞向后加入的那个，先加入的不再飞
    ctx.owner.remove(['station']);
    ctx.sceneStatus.value = new Map();
    ctx.owner.add(['white']);
    ctx.owner.add(['city']);
    ctx.ready('white/plain');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(3);
    ctx.ready('white/plain', 'city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(4);

    // 还没就绪时有了别的定位
    ctx.owner.remove(['white']);
    ctx.owner.remove(['city']);
    ctx.sceneStatus.value = new Map();
    ctx.owner.add(['station']);
    ctx.runCameraOperation(() => {});
    ctx.ready('station');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledTimes(4);
  });

  it('加入的模型加载失败后重试，就绪时照样飞过去', async () => {
    using ctx = setup();
    ctx.owner.add(['city']);
    ctx.sceneStatus.value = new Map([['city', { state: 'failed', error: new Error('404') }]]);
    await nextTick();
    ctx.owner.retry('city');
    ctx.ready('city');
    await nextTick();
    expect(ctx.flyTo).toHaveBeenCalledExactlyOnceWith(CAMERA);
  });

  it('移出时忘掉效果和重试次数', () => {
    using ctx = setup();
    ctx.owner.add(['station']);
    ctx.ready('station');
    ctx.owner.retry('station');
    expect(ctx.owner.deriveContent().tilesets[0]?.attempt).toBe(1);

    ctx.owner.remove(['station']);
    ctx.owner.add(['station']);
    expect(ctx.owner.deriveContent().tilesets[0]?.attempt).toBe(0);

    // 高斯泼溅的重试次数按模型 ID 记，移出时一样忘掉（ADR 0149）
    ctx.owner.add(['scan']);
    ctx.owner.retry('scan');
    expect(ctx.owner.deriveContent().splats?.[0]?.attempt).toBe(1);
    ctx.owner.remove(['scan']);
    ctx.owner.add(['scan']);
    expect(ctx.owner.deriveContent().splats?.[0]?.attempt).toBe(0);
  });

  it('重试只加当前效果的次数', () => {
    using ctx = setup();
    ctx.owner.add(['white']);
    ctx.owner.retry('white');
    ctx.owner.setEffect('white', 'window');
    ctx.owner.retry('white');
    ctx.owner.retry('white');

    expect(ctx.owner.deriveContent().tilesets.map(({ id, attempt }) => [id, attempt])).toStrictEqual([
      ['white/plain', 1],
      ['white/window', 2]
    ]);
  });

  it('参数不合法时抛错：没有的模型和效果、没加入、不是白膜', () => {
    using ctx = setup();
    expect(() => ctx.owner.add(['nothing'])).toThrow('目录里没有模型 nothing');
    expect(() => ctx.owner.add(['city', 'nothing'])).toThrow('目录里没有模型 nothing');
    expect(ctx.owner.added.value).toStrictEqual([]);
    expect(() => ctx.owner.locate('city')).toThrow('模型 city 没有加入');
    expect(() => ctx.owner.setEffect('city', '')).toThrow('模型 city 没有效果');
    expect(() => ctx.owner.setEffect('white', 'tech')).toThrow('模型 white 没有效果 tech');
  });
});

describe('useSceneModels 的路线漫游（ADR 0083）', () => {
  it('只有加载完成的模型、清单里有的路线能开始', () => {
    using ctx = setup();
    expect(() => ctx.owner.startRoute('station', 'enter')).toThrow('模型 station 没有加入');
    ctx.owner.add(['station']);
    expect(() => ctx.owner.startRoute('station', 'enter')).toThrow('模型 station 还不能漫游');
    ctx.ready('station');
    expect(() => ctx.owner.startRoute('station', 'nowhere')).toThrow('模型 station 没有路线 nowhere');
  });

  it('开始：停在起点交给会话；漫游地下的模型时在地下空间，地面上的模型不显示；播放、暂停、速度改意图', () => {
    using ctx = setup();
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');

    ctx.owner.exitRoam();
    expect(ctx.owner.roam.value).toBeNull();
    expect(ctx.owner.deriveContent().underground).toBeNull();
    expect(() => ctx.owner.playRoute()).toThrow('没有在路线漫游');

    ctx.owner.startRoute('station', 'enter');
    ctx.owner.remove(['station']);
    expect(ctx.owner.roam.value).toBeNull();
  });
});

const flushBuild = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useSceneModels 的步行（ADR 0086）', () => {
  it('只有加载完成、清单里有出生点的模型能开始；漫游地下的模型时在地下空间', () => {
    using ctx = setup();
    expect(() => ctx.owner.startWalk('station')).toThrow('模型 station 没有加入');
    ctx.owner.add(['station']);
    ctx.owner.add(['city']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
    ctx.ready('station');
    ctx.owner.startWalk('station');
    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    ctx.owner.exitRoam();

    ctx.owner.startWalk('station');
    expect(ctx.builds).toHaveLength(1);
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'entering' });

    ctx.owner.remove(['station']);
    expect(ctx.owner.roam.value).toBeNull();
    ctx.owner.add(['station']);
    ctx.owner.startWalk('station');
    expect(ctx.builds).toHaveLength(2);
  });

  it('建不出来时显示失败、可以重试；退出时中止正在建的，晚到的结果不写入', async () => {
    using ctx = setup();
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
    ctx.owner.add(['city']);
    ctx.ready('station', 'city');
    ctx.owner.startRoam('station');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'walk', modelId: 'station', speed: 4 });
    expect(() => ctx.owner.startRoam('city')).toThrow('模型 city 既没有出生点也没有路线，不能漫游');

    using route = setup(ROUTE_ONLY);
    route.owner.add(['square']);
    route.ready('square');
    route.owner.startRoam('square');
    expect(route.owner.roam.value).toMatchObject({ kind: 'route', modelId: 'square', routeId: 'loop', playing: false });
  });

  it('换方式：同一个模型，速度不变；换回路线接着上次的路线，再次漫游也是；没在漫游、没有这种方式时抛错', () => {
    using ctx = setup();
    ctx.owner.add(['station']);
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
    route.owner.add(['square']);
    route.ready('square');
    route.owner.startRoam('square');
    expect(() => route.owner.setRoamMode('walk')).toThrow('模型 square 的清单里没有出生点，不能步行');
  });
});

describe('useSceneModels 路线漫游时的地图（ADR 0097 第 6 节）', () => {
  it('室内的模型开始路线漫游时建导航网格，路线不等它；建好后有室内地图、人和路线，人按走过的米数在路线上', async () => {
    using ctx = setup();
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    square.owner.add(['square']);
    square.ready('square');
    square.owner.startRoam('square');
    expect(square.builds).toHaveLength(0);
    expect(() => square.owner.openMap()).toThrow('站内地图还没有准备好');
  });

  it('完整地图：建好以后才能打开；打开时路线暂停，关上时打开前在播放就接着播放；不能瞬移', async () => {
    using ctx = setup();
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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
    ctx.owner.add(['station']);
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

describe('useSceneModels 高斯泼溅的漫游（ADR 0156）', () => {
  const INDEX_URL = 'https://maps.test/3dt/L/lcc2-sog-result/L.lcc2';

  it('步行：用碰撞网格建导航网格（索引的地址、清单的出生点），不读瓦片集；建好后交给会话、有地图，泼溅照常显示', async () => {
    using ctx = setup();
    ctx.owner.add(['scan']);
    ctx.ready('scan');
    ctx.owner.startRoam('scan');
    expect(ctx.owner.roam.value).toMatchObject({ kind: 'walk', modelId: 'scan' });
    expect(ctx.builds).toHaveLength(1);
    const build = required(ctx.builds[0], '没有建导航网格');
    expect(build.url).toBe(INDEX_URL);
    expect(build.spawn).toStrictEqual({ lng: 117.06, lat: 34.27, height: 59.2, heading: 20 });
    build.onProgress({ stage: 'download', done: 1, total: 4 });
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'preparing', progress: 0.2 });

    build.resolve(NAVIGATION);
    await flushBuild();
    expect(ctx.owner.walkStage.value).toStrictEqual({ kind: 'entering' });
    const content = ctx.owner.deriveContent();
    expect(content.roam).toMatchObject({
      kind: 'walk',
      navigation: { grid: NAVIGATION.grid, frame: NAVIGATION.frame },
      spawn: { lng: 117.06, lat: 34.27, height: 59.2, heading: 20 }
    });
    expect(content).toMatchObject({ underground: null, splats: [{ id: 'scan', show: true }] });
    expect(ctx.owner.indoorMap.value?.grid).toBe(NAVIGATION.grid);
  });

  it('路线：开始时也建导航网格，路线不等它；路线点的眼高原样交给会话，建好后有地图、人和路线', async () => {
    using ctx = setup();
    ctx.owner.add(['scan']);
    ctx.ready('scan');
    ctx.owner.startRoute('scan', 'tomb');
    expect(ctx.builds.map(({ url }) => url)).toStrictEqual([INDEX_URL]);
    expect(ctx.owner.deriveContent().roam).toMatchObject({
      kind: 'route',
      path: [
        [117.06, 34.27, 59.2],
        [117.06, 34.2702, 56, 0.9]
      ]
    });
    expect(ctx.owner.routeTrack.value).toBeNull();

    ctx.builds[0]?.resolve(NAVIGATION);
    await flushBuild();
    expect(ctx.owner.indoorMap.value?.grid).toBe(NAVIGATION.grid);
    expect(ctx.owner.routeTrack.value?.points).toHaveLength(2);
    expect(ctx.owner.roamPlayer.value).toMatchObject({ target: null });
  });
});
