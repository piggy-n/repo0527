// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildNavGrid } from './nav/heightfield';
import { navigationFrame, translation } from './nav/nav-frame';
import { NavGrid } from './nav/nav-grid';
import { floorQuad, triangles } from './nav/nav-testing';
import { labelRegions } from './nav/regions';
import {
  EMPTY_SCENE_CONTENT,
  type RouteRoam,
  type SceneContent,
  SceneContentModel,
  type TilesetLayer,
  type WalkRoam
} from './scene-content-model';

const frame = navigationFrame(Array.from(translation(-2_700_000, 4_700_000, 3_300_000)));

const tileset = (id: string, extra: Partial<TilesetLayer> = {}): TilesetLayer => ({
  id,
  url: `https://maps.test/3dt/${id}/tileset.json`,
  show: true,
  lighting: 'sun',
  attempt: 0,
  ...extra
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const roam = (extra: Partial<RouteRoam> = {}): RouteRoam => ({
  kind: 'route',
  id: 'enter',
  path: [
    [120.666, 31.3175, -5.1],
    [120.6665, 31.3176, -10.06]
  ],
  playing: false,
  rate: 1,
  run: 0,
  ...extra
});

describe('SceneContentModel', () => {
  it('开始是空的；替换后修订号加 1，同一轮的多次替换只通知一次最后的内容', async () => {
    using model = new SceneContentModel();
    const changes: SceneContent[] = [];
    model.on('change', content => changes.push(content));
    expect(model.current).toBe(EMPTY_SCENE_CONTENT);

    const first: SceneContent = { tilesets: [tileset('a')], underground: null };
    const second: SceneContent = { tilesets: [tileset('a'), tileset('b')], underground: null };
    model.set(first);
    model.set(second);

    expect(model.revision).toBe(2);
    expect(changes).toStrictEqual([]);
    await flush();
    expect(changes).toStrictEqual([second]);
  });

  it('同一个对象不算变化，不通知', async () => {
    using model = new SceneContentModel();
    const content: SceneContent = { tilesets: [tileset('a')], underground: null };
    model.set(content);
    await flush();
    const changed = vi.fn<(content: SceneContent) => void>();
    model.on('change', changed);

    model.set(content);
    await flush();

    expect(model.revision).toBe(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it('钻地指向已有的瓦片集，不透明度在 0～1', () => {
    using model = new SceneContentModel();
    const content: SceneContent = {
      tilesets: [tileset('station', { lighting: 'headlight' })],
      underground: { tilesetId: 'station', surfaceOpacity: 0.25 }
    };

    model.set(content);

    expect(model.current).toBe(content);
  });

  it('漫游：至少两个点、坐标是数、倍速是正数、遍数是非负整数（ADR 0083）', () => {
    using model = new SceneContentModel();
    const valid: SceneContent = { tilesets: [], underground: null, roam: roam({ playing: true, rate: 0.5, run: 2 }) };
    model.set(valid);
    expect(model.current).toBe(valid);

    const invalid: [RouteRoam, string][] = [
      [roam({ path: [[120.666, 31.3175, -5.1]] }), '路线少于两个点'],
      [roam({ path: [[120.666, 31.3175, -5.1], [120.6665, Number.NaN, -5.1]] }), '有不是数的坐标'],
      [roam({ rate: 0 }), '倍速不是正数'],
      [roam({ rate: Number.POSITIVE_INFINITY }), '倍速不是正数'],
      [roam({ run: 0.5 }), '遍数不是非负整数']
    ];
    for (const [route, message] of invalid) {
      expect(() => model.set({ tilesets: [], underground: null, roam: route })).toThrow(message);
    }
    expect(model.current).toBe(valid);
  });

  it('步行：速度是正数，回到出生点、脱困、瞬移的次数是非负整数，出生点、瞬移的坐标是数，人称、人物模型地址对（ADR 0086、0087、0090）', () => {
    const spot = { x: 1, y: 2, floor: -5 };
    using model = new SceneContentModel();
    const navigation = { grid: new NavGrid(labelRegions(buildNavGrid([triangles(floorQuad(0, 0, 4, 4, 0))]))), frame };
    const walk = (extra: Partial<WalkRoam> = {}): WalkRoam => ({
      kind: 'walk',
      id: 'walk-1',
      navigation,
      spawn: { lng: 120.666, lat: 31.3175, height: -5.1, heading: 76 },
      speed: 1.6,
      respawn: 0,
      unstuck: 0,
      paused: false,
      teleport: null,
      view: 'first',
      avatar: 'https://maps.test/roam/Cesium_Man.glb',
      ...extra
    });
    const teleport = { count: 3, spot };
    const walking = walk({ spawn: null, respawn: 2, unstuck: 1, paused: true, teleport, view: 'third' });
    const valid: SceneContent = { tilesets: [], underground: null, roam: walking };
    model.set(valid);
    expect(model.current).toBe(valid);

    const invalid: [WalkRoam, string][] = [
      [walk({ speed: 0 }), '速度不是正数'],
      [walk({ speed: Number.NaN }), '速度不是正数'],
      [walk({ respawn: -1 }), '次数不是非负整数'],
      [walk({ unstuck: 0.5 }), '次数不是非负整数'],
      [walk({ spawn: { lng: 120.666, lat: Number.NaN, height: -5.1, heading: 76 } }), '出生点有不是数的坐标'],
      [walk({ teleport: { count: -1, spot } }), '瞬移次数不是非负整数'],
      [walk({ teleport: { count: 1, spot: { ...spot, floor: Number.NaN } } }), '位置有不是数的坐标'],
      // 故意给出类型以外的人称，检查运行时校验
      [walk({ view: 'top' as unknown as WalkRoam['view'] }), '人称不对：top'],
      [walk({ avatar: '/roam/Cesium_Man.glb' }), '人物模型地址不是绝对地址']
    ];
    for (const [invalidWalk, message] of invalid) {
      expect(() => model.set({ tilesets: [], underground: null, roam: invalidWalk })).toThrow(message);
    }
    expect(model.current).toBe(valid);
  });

  it('不合法时抛错，状态和修订号都不变', () => {
    using model = new SceneContentModel();
    const invalid: [SceneContent, string][] = [
      [{ tilesets: [tileset('a'), tileset('a')], underground: null }, '瓦片集 ID 重复：a'],
      [{ tilesets: [tileset('a', { url: '' })], underground: null }, '瓦片集 a 的地址不是绝对地址'],
      [{ tilesets: [tileset('a', { url: '/3dt/a.json' })], underground: null }, '瓦片集 a 的地址不是绝对地址'],
      [{ tilesets: [tileset('a', { attempt: 1.5 })], underground: null }, '重试次数不是非负整数'],
      [{ tilesets: [tileset('a', { attempt: -1 })], underground: null }, '重试次数不是非负整数'],
      [{ tilesets: [tileset('a')], underground: { tilesetId: 'b', surfaceOpacity: 0.3 } }, '钻地的瓦片集不存在：b'],
      [{ tilesets: [tileset('a')], underground: { tilesetId: 'a', surfaceOpacity: 1.2 } }, '不在 0～1 之间'],
      [{ tilesets: [tileset('a')], underground: { tilesetId: 'a', surfaceOpacity: Number.NaN } }, '不在 0～1 之间']
    ];

    for (const [content, message] of invalid) {
      expect(() => model.set(content)).toThrow(message);
    }
    expect(model.current).toBe(EMPTY_SCENE_CONTENT);
    expect(model.revision).toBe(0);
  });

  it('释放后不能再替换和订阅，排队中的通知不再发出', async () => {
    const model = new SceneContentModel();
    const changed = vi.fn<(content: SceneContent) => void>();
    model.on('change', changed);
    model.set({ tilesets: [tileset('a')], underground: null });

    model[Symbol.dispose]();
    await flush();

    expect(changed).not.toHaveBeenCalled();
    expect(() => model.set(EMPTY_SCENE_CONTENT)).toThrow('SceneContentModel 已释放');
    expect(() => model.on('change', changed)).toThrow('SceneContentModel 已释放');
  });
});
