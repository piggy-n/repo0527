// @vitest-environment node
import type { GeoJSONSourceSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import type { StyleImage } from './style-image';
import { type StyleChange, type StyleGroup, StyleModel } from './style-model';

// 通知在微任务里发出，排在它后面的微任务执行时已经发完
const nextMicrotask = () => Promise.resolve();

const EMPTY: StyleGroup = { sources: {}, layers: [] };

function geojson(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

function line(id: string, source: string, color = '#336699'): LayerSpecification {
  return { id, type: 'line', source, paint: { 'line-color': color } };
}

function lineGroup(id: string, color?: string): StyleGroup {
  return { sources: { [id]: geojson() }, layers: [line(`${id}-line`, id, color)] };
}

function createModel() {
  return new StyleModel({
    groups: ['basemap', 'business', 'highlight'],
    root: { glyphs: '/fonts/{fontstack}/{range}.pbf' }
  });
}

function listen(model: StyleModel<string>) {
  const changes: StyleChange[] = [];
  model.on('change', change => changes.push(change));
  return changes;
}

// 2 × 2 的图片；fill 是每个字节的值
const image = (fill = 0, overrides: Partial<StyleImage> = {}): StyleImage => ({
  width: 2,
  height: 2,
  data: new Uint8Array(16).fill(fill),
  ...overrides
});

// 每条命令的名称和第一个参数（ID 或图层）
const commandsOf = (change: StyleChange | undefined) =>
  change?.commands.map(({ command, args }) => [command, args[0]] as const);

describe('StyleModel', () => {
  it('composes groups in the declared order with the root properties', () => {
    using model = createModel();
    const basemap = lineGroup('tdt');
    const highlight = lineGroup('selected');

    model.setGroup('highlight', highlight);
    model.setGroup('basemap', basemap);

    expect(model.current).toEqual({
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      version: 8,
      sources: { ...basemap.sources, ...highlight.sources },
      layers: [...basemap.layers, ...highlight.layers]
    });
  });

  it('counts one revision per commit, including setGroups with several groups', () => {
    using model = createModel();

    model.setGroups({ basemap: lineGroup('tdt'), business: lineGroup('dltb') });
    expect(model.revision).toBe(1);

    model.setGroup('highlight', lineGroup('selected'));
    expect(model.revision).toBe(2);
  });

  it('ignores a commit that keeps every group reference', async () => {
    using model = createModel();
    const changes = listen(model);
    const basemap = lineGroup('tdt');
    model.setGroup('basemap', basemap);
    await nextMicrotask();

    model.setGroup('basemap', basemap);
    model.setGroups({});
    await nextMicrotask();

    expect(model.revision).toBe(1);
    expect(changes).toHaveLength(1);
  });

  it('merges the commits of one tick into one notification', async () => {
    using model = createModel();
    const changes = listen(model);

    model.setGroup('basemap', lineGroup('tdt'));
    model.setGroup('business', lineGroup('dltb'));
    expect(changes).toHaveLength(0);
    await nextMicrotask();

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ fromRevision: 0, toRevision: 2 });
    expect(changes[0]?.style).toBe(model.current);
    expect(changes[0]?.commands.map(command => command.command)).toEqual([
      'addSource',
      'addSource',
      'addLayer',
      'addLayer'
    ]);
  });

  it('diffs from the last notified snapshot', async () => {
    using model = createModel();
    const changes = listen(model);
    const business = lineGroup('dltb');
    model.setGroup('business', business);
    await nextMicrotask();

    model.setGroup('business', { ...business, layers: [line('dltb-line', 'dltb', '#993366')] });
    await nextMicrotask();

    expect(changes[1]).toMatchObject({
      fromRevision: 1,
      toRevision: 2,
      commands: [{ command: 'setPaintProperty', args: ['dltb-line', 'line-color', '#993366'] }]
    });
  });

  it('does not notify when a new group object has the same content', async () => {
    using model = createModel();
    const changes = listen(model);
    const basemap = lineGroup('tdt');
    model.setGroup('basemap', basemap);
    await nextMicrotask();

    model.setGroup('basemap', { ...basemap });
    await nextMicrotask();

    expect(model.revision).toBe(2);
    expect(changes).toHaveLength(1);
  });

  it('lets a listener commit during a notification', async () => {
    using model = createModel();
    const changes = listen(model);
    model.on('change', ({ toRevision }) => {
      if (toRevision === 1) {
        model.setGroup('highlight', lineGroup('selected'));
      }
    });

    model.setGroup('basemap', lineGroup('tdt'));
    await nextMicrotask();
    await nextMicrotask();

    expect(changes.map(({ fromRevision, toRevision }) => [fromRevision, toRevision])).toEqual([
      [0, 1],
      [1, 2]
    ]);
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    using model = createModel();
    const listener = vi.fn<(change: StyleChange) => void>();
    const unsubscribe = model.on('change', listener);

    unsubscribe();
    model.setGroup('basemap', lineGroup('tdt'));
    await nextMicrotask();

    expect(listener).not.toHaveBeenCalled();
  });

  describe('images', () => {
    // 同一份数据源：GeoJSON 数据按引用比较，换对象会多出更新数据的命令
    const lines = lineGroup('dltb');
    const patternGroup = (images: Record<string, StyleImage>): StyleGroup => ({ ...lines, images });

    it('composes the images of all groups and notifies them with the snapshot', async () => {
      using model = createModel();
      const changes = listen(model);
      const stripe = image(1);

      model.setGroup('business', patternGroup({ 'business-stripe': stripe }));
      await nextMicrotask();

      expect(model.images).toStrictEqual({ 'business-stripe': stripe });
      expect(changes[0]?.images).toBe(model.images);
      // 图片先于引用它的图层添加
      expect(commandsOf(changes[0])).toStrictEqual([
        ['addImage', 'business-stripe'],
        ['addSource', 'dltb'],
        ['addLayer', { ...line('dltb-line', 'dltb') }]
      ]);
    });

    it('counts a commit that only changes images and compares images by reference', async () => {
      using model = createModel();
      const changes = listen(model);
      const stripe = image(1);
      model.setGroup('business', patternGroup({ 'business-stripe': stripe }));
      await nextMicrotask();

      model.setGroup('business', patternGroup({ 'business-stripe': stripe }));
      await nextMicrotask();
      expect(model.revision).toBe(2);
      expect(changes).toHaveLength(1);

      const repainted = image(2);
      model.setGroup('business', patternGroup({ 'business-stripe': repainted }));
      await nextMicrotask();
      expect(changes[1]?.commands).toStrictEqual([{ command: 'updateImage', args: ['business-stripe', repainted] }]);
    });

    it('replaces an image whose size, pixel ratio or SDF flag changes, and removes images after the style commands', async () => {
      using model = createModel();
      const changes = listen(model);
      model.setGroup('business', patternGroup({ a: image(), b: image(), c: image(), d: image(), e: image() }));
      await nextMicrotask();

      model.setGroups({
        business: {
          sources: {},
          layers: [],
          images: {
            // 只变宽、只变高
            a: image(0, { width: 4, data: new Uint8Array(32) }),
            e: image(0, { height: 1, data: new Uint8Array(8) }),
            b: image(0, { pixelRatio: 2 }),
            c: image(0, { sdf: true })
          }
        }
      });
      await nextMicrotask();

      expect(commandsOf(changes[1])).toStrictEqual([
        ['removeImage', 'a'],
        ['addImage', 'a'],
        ['removeImage', 'e'],
        ['addImage', 'e'],
        ['removeImage', 'b'],
        ['addImage', 'b'],
        ['removeImage', 'c'],
        ['addImage', 'c'],
        ['removeLayer', 'dltb-line'],
        ['removeSource', 'dltb'],
        ['removeImage', 'd']
      ]);
    });

    it('treats the default pixel ratio and SDF flag as equal to the explicit defaults', async () => {
      using model = createModel();
      const changes = listen(model);
      model.setGroup('business', patternGroup({ a: image() }));
      await nextMicrotask();

      model.setGroup('business', patternGroup({ a: image(3, { pixelRatio: 1, sdf: false }) }));
      await nextMicrotask();

      expect(commandsOf(changes[1])).toStrictEqual([['updateImage', 'a']]);
    });

    it('rejects an image ID used by two groups and invalid images, keeping the previous state', () => {
      using model = createModel();
      model.setGroup('basemap', { sources: {}, layers: [], images: { shared: image() } });
      const before = model.images;

      expect(() => model.setGroup('business', patternGroup({ shared: image() }))).toThrow(
        '图片 ID "shared" 在分组 basemap 和 business 中重复'
      );
      expect(() => model.setGroup('business', patternGroup({ a: image(0, { width: 3 }) }))).toThrow('数据长度 16');
      expect(() => model.setGroup('business', patternGroup({ a: image(0, { width: 0, data: new Uint8Array() }) }))).toThrow(
        '宽高不是正整数'
      );
      expect(() => model.setGroup('business', patternGroup({ a: image(0, { pixelRatio: 0 }) }))).toThrow('像素比不是正数');
      expect(model.images).toBe(before);
      expect(model.revision).toBe(1);
    });
  });

  describe('validation', () => {
    it('rejects a source ID used by two groups and keeps the previous state', () => {
      using model = createModel();
      model.setGroup('basemap', lineGroup('tdt'));
      const before = model.current;

      expect(() => model.setGroup('business', lineGroup('tdt'))).toThrow('数据源 ID "tdt" 在分组 basemap 和 business 中重复');
      expect(model.revision).toBe(1);
      expect(model.current).toBe(before);
      // 被拒绝的分组不能留在内部状态里，否则下一次提交才会暴露
      expect(() => model.setGroup('highlight', lineGroup('selected'))).not.toThrow();
      expect(Object.keys(model.current.sources)).toEqual(['tdt', 'selected']);
    });

    it('rejects duplicate layer IDs', () => {
      using model = createModel();
      const group: StyleGroup = { sources: { tdt: geojson() }, layers: [line('tdt-line', 'tdt'), line('tdt-line', 'tdt')] };

      expect(() => model.setGroup('basemap', group)).toThrow('图层 ID "tdt-line" 在分组 basemap 和 basemap 中重复');
    });

    it('rejects a layer whose source does not exist', () => {
      using model = createModel();

      expect(() => model.setGroup('highlight', { sources: {}, layers: [line('selected-line', 'dltb')] })).toThrow(
        '图层 "selected-line" 引用的数据源 "dltb" 不存在'
      );
    });

    it('requires removing a source together with the layers of other groups that use it', () => {
      using model = createModel();
      model.setGroups({
        business: lineGroup('dltb'),
        highlight: { sources: {}, layers: [line('dltb-selected', 'dltb', '#ff0000')] }
      });

      expect(() => model.setGroup('business', EMPTY)).toThrow('图层 "dltb-selected" 引用的数据源 "dltb" 不存在');

      model.setGroups({ business: EMPTY, highlight: EMPTY });
      expect(model.current.layers).toEqual([]);
    });

    it('rejects groups that were not declared', () => {
      using model = createModel();

      // @ts-expect-error 分组 ID 来自构造时声明的元组，未声明的 ID 类型检查应该报错
      expect(() => model.setGroup('measure', EMPTY)).toThrow('未声明的分组：measure');
    });

    it('keeps camera properties out of the style root', () => {
      // @ts-expect-error 相机归 CameraModel，写在样式根属性里会和它抢着控制相机
      using model = new StyleModel({ groups: ['basemap'], root: { center: [118.8, 32.05] } });

      expect(model.revision).toBe(0);
    });

    it('rejects duplicate group IDs in the declaration', () => {
      expect(() => new StyleModel({ groups: ['basemap', 'basemap'] })).toThrow('分组 ID 重复');
    });
  });

  describe('disposal', () => {
    it('drops a pending notification and rejects further use', async () => {
      const model = createModel();
      const listener = vi.fn<(change: StyleChange) => void>();
      model.on('change', listener);
      model.setGroup('basemap', lineGroup('tdt'));

      model[Symbol.dispose]();
      await nextMicrotask();

      expect(listener).not.toHaveBeenCalled();
      expect(() => model.setGroup('basemap', EMPTY)).toThrow('StyleModel 已释放');
      expect(() => model.on('change', listener)).toThrow('StyleModel 已释放');
      expect(() => model[Symbol.dispose]()).not.toThrow();
    });

    it('is disposed at the end of a using block', async () => {
      const listener = vi.fn<(change: StyleChange) => void>();
      {
        using model = createModel();
        model.on('change', listener);
        model.setGroup('basemap', lineGroup('tdt'));
      }
      await nextMicrotask();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
