import type { GeoJSONSourceSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
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

  it('counts one version per commit, including setGroups with several groups', () => {
    using model = createModel();

    model.setGroups({ basemap: lineGroup('tdt'), business: lineGroup('dltb') });
    expect(model.version).toBe(1);

    model.setGroup('highlight', lineGroup('selected'));
    expect(model.version).toBe(2);
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

    expect(model.version).toBe(1);
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
    expect(changes[0]).toMatchObject({ fromVersion: 0, toVersion: 2 });
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
      fromVersion: 1,
      toVersion: 2,
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

    expect(model.version).toBe(2);
    expect(changes).toHaveLength(1);
  });

  it('lets a listener commit during a notification', async () => {
    using model = createModel();
    const changes = listen(model);
    model.on('change', ({ toVersion }) => {
      if (toVersion === 1) {
        model.setGroup('highlight', lineGroup('selected'));
      }
    });

    model.setGroup('basemap', lineGroup('tdt'));
    await nextMicrotask();
    await nextMicrotask();

    expect(changes.map(({ fromVersion, toVersion }) => [fromVersion, toVersion])).toEqual([
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

  describe('validation', () => {
    it('rejects a source ID used by two groups and keeps the previous state', () => {
      using model = createModel();
      model.setGroup('basemap', lineGroup('tdt'));
      const before = model.current;

      expect(() => model.setGroup('business', lineGroup('tdt'))).toThrow('数据源 ID "tdt" 在分组 basemap 和 business 中重复');
      expect(model.version).toBe(1);
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
