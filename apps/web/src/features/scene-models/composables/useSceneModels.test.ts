// @vitest-environment node
import type { CameraState, RoamStatus, SceneStatus } from '@yzt/map-core';
import type { CameraControl } from '@yzt/map-vue';
import { describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
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

function setup() {
  const sceneStatus = shallowRef<SceneStatus>(new Map());
  const roamStatus = shallowRef<RoamStatus | null>(null);
  const flyTo = vi.fn<CameraControl['flyTo']>();
  const control = { flyTo } as unknown as CameraControl;
  // 和上下文一样：开始一次新的相机操作时，上一次的信号中止
  let current = new AbortController();
  const beginCameraOperation = vi.fn<SceneModelsContext['beginCameraOperation']>(() => {
    current.abort(new DOMException('有新的相机操作', 'AbortError'));
    current = new AbortController();
    return { signal: current.signal, run: action => action(control) };
  });
  const runCameraOperation = vi.fn<SceneModelsContext['runCameraOperation']>(action =>
    beginCameraOperation().run(action)
  );
  const scope = effectScope();
  const owner = scope.run(() =>
    useSceneModels({ sceneStatus, roamStatus, runCameraOperation, beginCameraOperation }, CATALOG)
  );
  if (!owner) {
    throw new Error('作用域没有运行');
  }
  const ready = (...ids: string[]) => {
    sceneStatus.value = new Map(ids.map(id => [id, { state: 'ready', camera: CAMERA }]));
  };
  const dispose = () => scope.stop();
  return { owner, sceneStatus, roamStatus, flyTo, runCameraOperation, ready, [Symbol.dispose]: dispose };
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

  it('定位：就绪后飞到报告的相机；地下的模型进入钻地、钻地期间不显示地面上的模型，定位地面上的模型结束钻地', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.owner.setChecked('white', true);
    ctx.owner.setChecked('city', true);
    expect(() => ctx.owner.locate('station')).toThrow('模型 station 还不能定位');

    ctx.ready('station', 'white/plain', 'city');
    ctx.owner.locate('station');

    expect(ctx.flyTo).toHaveBeenCalledWith(CAMERA);
    expect(ctx.owner.focus.value).toBe('station');
    expect(ctx.owner.deriveContent().underground).toStrictEqual({ tilesetId: 'station', surfaceOpacity: 0.25 });
    expect(summary(ctx.owner.deriveContent()).map(([id, show]) => [id, show])).toStrictEqual([
      ['station', true],
      ['white/plain', false],
      ['city', false]
    ]);

    ctx.owner.setSurfaceOpacity(0.6);
    ctx.owner.locate('white');
    expect(ctx.owner.underground.value).toBeNull();
    expect(ctx.owner.deriveContent().underground).toBeNull();
    // 下一次进入钻地从默认的不透明度开始
    ctx.owner.locate('station');
    expect(ctx.owner.underground.value?.opacity).toBe(0.25);
  });

  it('卸载时一起结束这个模型的钻地、定位，忘掉效果和重试次数', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.locate('station');
    ctx.owner.retry('station');
    expect(ctx.owner.deriveContent().tilesets[0]?.attempt).toBe(1);

    ctx.owner.setChecked('station', false);
    expect(ctx.owner.underground.value).toBeNull();
    expect(ctx.owner.focus.value).toBeNull();

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

  it('参数不合法时抛错：没有的模型和效果、没加载、不是白膜、不在钻地、不透明度超出 0～0.6', () => {
    using ctx = setup();
    expect(() => ctx.owner.setChecked('nothing', true)).toThrow('目录里没有模型 nothing');
    expect(() => ctx.owner.locate('city')).toThrow('模型 city 没有加载');
    expect(() => ctx.owner.setEffect('city', '')).toThrow('模型 city 没有效果');
    expect(() => ctx.owner.setEffect('white', 'tech')).toThrow('模型 white 没有效果 tech');
    expect(() => ctx.owner.setSurfaceOpacity(0.3)).toThrow('没有在钻地');

    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.locate('station');
    expect(() => ctx.owner.setSurfaceOpacity(0.7)).toThrow('地表不透明度不在 0～0.6 之间');
    ctx.owner.exitUnderground();
    expect(ctx.owner.underground.value).toBeNull();
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

  it('开始：停在起点交给会话；地下的模型按钻地处理、标为当前；播放、暂停、倍速改意图', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');

    ctx.owner.startRoute('station', 'enter');
    const roam = ctx.owner.deriveContent().roam;
    expect(roam).toMatchObject({ kind: 'route', playing: false, rate: 1, run: 0 });
    expect(roam?.path).toHaveLength(2);
    expect(ctx.owner.underground.value).toStrictEqual({ modelId: 'station', opacity: 0.25 });
    expect(ctx.owner.focus.value).toBe('station');
    expect(ctx.owner.routePhase.value).toBe('ready');

    ctx.owner.playRoute();
    expect(ctx.owner.routePhase.value).toBe('playing');
    ctx.owner.setRouteRate(2);
    ctx.owner.pauseRoute();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: false, rate: 2, run: 0 });
    expect(() => ctx.owner.setRouteRate(3)).toThrow('漫游的倍速只能是 0.5、1、2');
  });

  it('进度只认这一次、这一遍的；走过一段后暂停是 paused，到终点再播放从头走一遍', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');
    const id = ctx.owner.roam.value?.id ?? '';

    ctx.roamStatus.value = { id: 'other', run: 0, distance: 5, total: 19, finished: false };
    expect(ctx.owner.roamStatus.value).toBeNull();
    ctx.roamStatus.value = { id, run: 0, distance: 5, total: 19, finished: false };
    expect(ctx.owner.routePhase.value).toBe('paused');

    ctx.owner.playRoute();
    ctx.roamStatus.value = { id, run: 0, distance: 19, total: 19, finished: true };
    expect(ctx.owner.routePhase.value).toBe('finished');
    ctx.owner.playRoute();
    expect(ctx.owner.deriveContent().roam).toMatchObject({ playing: true, run: 1 });
    expect(ctx.owner.roamStatus.value).toBeNull();
  });

  it('有了别的定位就退出漫游，保留钻地；换一条路线不会被上一条的信号退出，沿用选过的倍速', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');
    ctx.owner.setRouteRate(2);
    ctx.owner.startRoute('station', 'platform');
    expect(ctx.owner.roam.value).toMatchObject({ routeId: 'platform', rate: 2, playing: false });

    ctx.owner.locate('station');
    expect(ctx.owner.roam.value).toBeNull();
    expect(ctx.owner.deriveContent().roam).toBeUndefined();
    expect(ctx.owner.underground.value?.modelId).toBe('station');
  });

  it('退出、卸载这个模型都结束漫游；退出后保留钻地', () => {
    using ctx = setup();
    ctx.owner.setChecked('station', true);
    ctx.ready('station');
    ctx.owner.startRoute('station', 'enter');

    ctx.owner.exitRoam();
    expect(ctx.owner.roam.value).toBeNull();
    expect(ctx.owner.underground.value?.modelId).toBe('station');
    expect(() => ctx.owner.playRoute()).toThrow('没有在漫游');

    ctx.owner.startRoute('station', 'enter');
    ctx.owner.setChecked('station', false);
    expect(ctx.owner.roam.value).toBeNull();
  });
});
