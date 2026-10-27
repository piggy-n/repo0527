// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SCENE_CONTENT,
  type RouteRoam,
  type SceneContent,
  SceneContentModel,
  type TilesetLayer
} from './scene-content-model';

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
