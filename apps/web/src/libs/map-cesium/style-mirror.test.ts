// @vitest-environment node
import type {
  BackgroundLayerSpecification,
  LayerSpecification,
  RasterSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import { CameraModel, NO_SOURCE_ERRORS, StyleModel, type SourceErrors, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { StyleMirror, type StyleMirrorLayer, type StyleMirrorOptions, type StyleMirrorPort } from './style-mirror';
import type { BasicStyleLayer } from './style-plan';

const INITIAL_CAMERA = { center: [119, 32] as const, zoom: 8, bearing: 0, pitch: 0 };
const SOURCE: RasterSourceSpecification = { type: 'raster', tiles: ['/tiles/{z}/{x}/{y}.png'] };

/** 假层保留错误回调，检查已替换资源的迟到通知 */
class FakeLayer implements StyleMirrorLayer {
  readonly setVisible = vi.fn<(visible: boolean) => void>();
  readonly setZoom = vi.fn<(zoom: number) => void>();
  readonly dispose = vi.fn<() => void>();

  constructor(readonly layer: BasicStyleLayer, readonly zoom: number, readonly report: (error: unknown) => void) {}

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** 每个用例独立持有模型、镜像和假引擎 */
function fixture(group: StyleGroup, options: Pick<StyleMirrorOptions, 'onError' | 'onSourceErrors'> = {}) {
  const style = new StyleModel<string>({ groups: ['sample'] });
  style.setGroup('sample', group);
  const camera = new CameraModel(INITIAL_CAMERA);
  const handles: FakeLayer[] = [];
  const failures = new Map<string, unknown>();
  const duringCreate = vi.fn<(layer: FakeLayer) => void>();
  const port = {
    create: vi.fn<StyleMirrorPort['create']>((layer, zoom, onError) => {
      if (failures.has(layer.id)) {
        throw failures.get(layer.id);
      }
      const handle = new FakeLayer(layer, zoom, onError);
      handles.push(handle);
      duringCreate(handle);
      return handle;
    }),
    order: vi.fn<(layers: readonly StyleMirrorLayer[]) => void>(),
    requestRender: vi.fn<() => void>()
  } satisfies StyleMirrorPort;
  const onError = options.onError ?? vi.fn<(error: unknown) => void>();
  const onSourceErrors = options.onSourceErrors ?? vi.fn<(errors: SourceErrors) => void>();
  const mirror = new StyleMirror({ style, camera, port, onError, onSourceErrors });
  return {
    style, camera, mirror, port, handles, failures, duringCreate, onError, onSourceErrors,
    [Symbol.dispose]: () => {
      mirror[Symbol.dispose]();
      camera[Symbol.dispose]();
      style[Symbol.dispose]();
    }
  };
}

function background(id: string, color = '#ff0000'): BackgroundLayerSpecification {
  return { id, type: 'background', paint: { 'background-color': color } };
}

function raster(id: string, source = 'tiles'): LayerSpecification {
  return { id, type: 'raster', source };
}

describe('三维会话样式镜像', () => {
  it('首轮直接同步，排序只移动原来的层，变色只替换目标层', async () => {
    const bottom = background('bottom');
    const top = background('top', '#0000ff');
    using ctx = fixture({ sources: {}, layers: [bottom, top] });
    const [first, second] = ctx.handles;
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
    expect(first?.setVisible).toHaveBeenCalledExactlyOnceWith(true);
    expect(ctx.port.order).toHaveBeenLastCalledWith([first, second]);
    await Promise.resolve();
    expect(ctx.port.create).toHaveBeenCalledTimes(2);

    ctx.style.setGroup('sample', { sources: {}, layers: [top, bottom] });
    await Promise.resolve();
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
    expect(ctx.port.order).toHaveBeenLastCalledWith([second, first]);
    expect(first?.dispose).not.toHaveBeenCalled();

    const green = background('bottom', '#00ff00');
    ctx.style.setGroup('sample', { sources: {}, layers: [top, green] });
    await Promise.resolve();
    expect(ctx.port.create).toHaveBeenCalledTimes(3);
    expect(ctx.handles[2]?.layer.specification).toBe(green);
    expect(first?.dispose).toHaveBeenCalledOnce();
    expect(second?.dispose).not.toHaveBeenCalled();
    expect(ctx.port.order).toHaveBeenLastCalledWith([second, ctx.handles[2]]);
  });

  it('源整体替换重建引用它的层，其他层保持原实例', async () => {
    const base = background('base');
    const tiles = raster('raster');
    using ctx = fixture({ sources: { tiles: SOURCE }, layers: [base, tiles] });
    const [first, oldTiles] = ctx.handles;
    const updated: RasterSourceSpecification = { ...SOURCE, tiles: ['/new/{z}/{x}/{y}.png'] };
    ctx.style.setGroup('sample', { sources: { tiles: updated }, layers: [base, tiles] });
    await Promise.resolve();
    expect(ctx.port.create).toHaveBeenCalledTimes(3);
    expect(ctx.handles[2]?.layer.source).toBe(updated);
    expect(oldTiles?.dispose).toHaveBeenCalledOnce();
    expect(first?.dispose).not.toHaveBeenCalled();
  });

  it('平移不触碰样式，缩放只更新级别和显隐，不重建层', () => {
    const layer: BackgroundLayerSpecification = { ...background('base'), minzoom: 9, maxzoom: 10 };
    using ctx = fixture({ sources: {}, layers: [layer] });
    const handle = ctx.handles[0];
    expect(handle?.setVisible).toHaveBeenLastCalledWith(false);
    const renders = ctx.port.requestRender.mock.calls.length;
    ctx.camera.set({ ...INITIAL_CAMERA, center: [118, 31] }, { view: '2d', cause: 'user' });
    expect(ctx.port.requestRender).toHaveBeenCalledTimes(renders);
    expect(handle?.setZoom).not.toHaveBeenCalled();

    ctx.camera.set({ ...INITIAL_CAMERA, zoom: 9 }, { view: '3d', cause: 'user' });
    expect(handle?.setZoom).toHaveBeenLastCalledWith(9);
    expect(handle?.setVisible).toHaveBeenLastCalledWith(true);
    ctx.camera.set({ ...INITIAL_CAMERA, zoom: 10 }, { view: '3d', cause: 'user' });
    expect(handle?.setVisible).toHaveBeenLastCalledWith(false);
    expect(ctx.port.create).toHaveBeenCalledOnce();
  });

  it('暂停期间多次提交不写引擎，恢复只创建最新样式并取最新级别', async () => {
    using ctx = fixture({ sources: {}, layers: [background('base')] });
    const original = ctx.handles[0];
    ctx.mirror.pause();
    ctx.style.setGroup('sample', { sources: {}, layers: [background('intermediate')] });
    await Promise.resolve();
    const latest = background('latest', '#00ff00');
    ctx.style.setGroup('sample', { sources: {}, layers: [latest] });
    ctx.camera.set({ ...INITIAL_CAMERA, zoom: 11 }, { view: '2d', cause: 'program' });
    await Promise.resolve();
    expect(ctx.port.create).toHaveBeenCalledOnce();
    expect(original?.dispose).not.toHaveBeenCalled();
    expect(original?.setZoom).not.toHaveBeenCalled();

    ctx.mirror.resume();
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
    expect(ctx.handles[1]?.layer.specification).toBe(latest);
    expect(ctx.handles[1]?.zoom).toBe(11);
    expect(original?.dispose).toHaveBeenCalledOnce();
    ctx.mirror.resume();
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
  });

  it('同一来源只存首条错误，替换和移除来源清理记录，忽略过期回调', async () => {
    const first = new Error('第一张瓦片失败');
    const second = new Error('后续瓦片失败');
    const layer = raster('raster');
    using ctx = fixture({ sources: { tiles: SOURCE }, layers: [layer] });
    const original = ctx.handles[0];
    original?.report(first);
    const errors = ctx.mirror.sourceErrors;
    original?.report(second);
    expect(errors).toEqual(new Map([['tiles', first]]));
    expect(ctx.mirror.sourceErrors).toBe(errors);
    expect(ctx.onSourceErrors).toHaveBeenCalledOnce();

    const updated = { ...SOURCE, tiles: ['/new/{z}/{x}/{y}.png'] };
    ctx.style.setGroup('sample', { sources: { tiles: updated }, layers: [layer] });
    original?.report(second);
    await Promise.resolve();
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
    original?.report(second);
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
    ctx.handles[1]?.report(second);
    expect(ctx.mirror.sourceErrors).toEqual(new Map([['tiles', second]]));
    expect(errors).toEqual(new Map([['tiles', first]]));

    ctx.style.setGroup('sample', { sources: {}, layers: [] });
    await Promise.resolve();
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
  });

  it('不同来源的错误互不覆盖，暂停期间被替换的层也不能写入迟到错误', async () => {
    const other: RasterSourceSpecification = { ...SOURCE, tiles: ['/other/{z}/{x}/{y}.png'] };
    using ctx = fixture({ sources: { tiles: SOURCE, other }, layers: [raster('one'), raster('two', 'other')] });
    ctx.handles[0]?.report(new Error('一'));
    ctx.handles[1]?.report(new Error('二'));
    expect([...ctx.mirror.sourceErrors.keys()]).toEqual(['tiles', 'other']);
    ctx.mirror.pause();
    ctx.style.setGroup('sample', { sources: { other }, layers: [raster('replacement', 'other')] });
    ctx.handles[1]?.report(new Error('过期'));
    await Promise.resolve();
    expect(ctx.onError).toHaveBeenCalledTimes(2);
    ctx.mirror.resume();
    expect([...ctx.mirror.sourceErrors.keys()]).toEqual(['other']);
  });

  it('未知样式逐层跳过并去重报告，其他层仍可显示', async () => {
    const unsupported: LayerSpecification = { id: 'labels', type: 'symbol', source: 'points' };
    const group: StyleGroup = {
      sources: { points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [unsupported, background('base')]
    };
    using ctx = fixture(group);
    expect(ctx.handles.map(handle => handle.layer.id)).toEqual(['base']);
    expect(ctx.onError).toHaveBeenCalledOnce();
    expect(String(vi.mocked(ctx.onError).mock.calls[0]?.[0])).toContain('labels');
    ctx.style.setGroup('sample', { ...group, layers: [unsupported, background('base', '#00ff00')] });
    await Promise.resolve();
    expect(ctx.onError).toHaveBeenCalledOnce();
    expect(ctx.handles.at(-1)?.layer.id).toBe('base');
  });

  it('创建期间的加载回调归属新来源；单层创建异常只报告诊断', async () => {
    using ctx = fixture({ sources: {}, layers: [] });
    const syncError = new Error('同步加载失败');
    const createError = new Error('创建失败');
    ctx.failures.set('failed', createError);
    ctx.duringCreate.mockImplementation(handle => handle.report(syncError));
    ctx.style.setGroup('sample', {
      sources: { tiles: SOURCE, failed: { ...SOURCE, tiles: ['/failed/{z}/{x}/{y}.png'] } },
      layers: [raster('failed', 'failed'), raster('raster'), background('base')]
    });
    await Promise.resolve();
    expect(ctx.handles.map(handle => handle.layer.id)).toEqual(['raster', 'base']);
    expect(ctx.mirror.sourceErrors).toEqual(new Map([['tiles', syncError]]));
    expect(ctx.onError).toHaveBeenCalledWith(createError);
    expect(ctx.handles[0]?.setVisible).toHaveBeenLastCalledWith(true);
    expect(ctx.port.order).toHaveBeenLastCalledWith(ctx.handles);
  });

  it('修复创建异常后同一来源可以继续显示，不残留来源错误', async () => {
    using ctx = fixture({ sources: {}, layers: [] });
    const error = new RangeError('透明度超出范围');
    ctx.failures.set('raster', error);
    ctx.style.setGroup('sample', { sources: { tiles: SOURCE }, layers: [
      { id: 'raster', type: 'raster', source: 'tiles', paint: { 'raster-opacity': 2 } }
    ] });
    await Promise.resolve();
    expect(ctx.onError).toHaveBeenCalledWith(error);
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
    expect(ctx.onSourceErrors).not.toHaveBeenCalled();

    ctx.failures.delete('raster');
    ctx.style.setGroup('sample', { sources: { tiles: SOURCE }, layers: [
      { id: 'raster', type: 'raster', source: 'tiles', paint: { 'raster-opacity': 1 } }
    ] });
    await Promise.resolve();
    expect(ctx.handles[0]?.setVisible).toHaveBeenLastCalledWith(true);
    expect(ctx.handles[0]?.layer.source).toBe(SOURCE);
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
  });

  it.each(['setZoom', 'setVisible'] as const)('%s 的同步绘制异常不写入来源错误', method => {
    using ctx = fixture({ sources: { tiles: SOURCE }, layers: [{ ...raster('raster'), minzoom: 9 }] });
    const handle = ctx.handles[0];
    const error = new Error('绘制更新失败');
    handle?.[method].mockImplementation(() => { throw error; });
    ctx.camera.set({ ...INITIAL_CAMERA, zoom: 9 }, { view: '3d', cause: 'user' });
    expect(handle?.dispose).toHaveBeenCalledOnce();
    expect(ctx.onError).toHaveBeenCalledWith(error);
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
    expect(ctx.onSourceErrors).not.toHaveBeenCalled();
  });

  it('真实加载错误在只改样式时保留，替换来源后才清除', async () => {
    using ctx = fixture({ sources: { tiles: SOURCE }, layers: [raster('raster')] });
    const error = new Error('瓦片下载失败');
    ctx.handles[0]?.report(error);
    const changed: LayerSpecification = {
      id: 'raster', type: 'raster', source: 'tiles', paint: { 'raster-opacity': 0.5 }
    };
    ctx.style.setGroup('sample', { sources: { tiles: SOURCE }, layers: [changed] });
    await Promise.resolve();
    expect(ctx.mirror.sourceErrors).toEqual(new Map([['tiles', error]]));
    expect(ctx.onSourceErrors).toHaveBeenCalledOnce();

    ctx.style.setGroup('sample', { sources: { tiles: { ...SOURCE, tiles: ['/new.png'] } }, layers: [changed] });
    await Promise.resolve();
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
    expect(ctx.onSourceErrors).toHaveBeenLastCalledWith(NO_SOURCE_ERRORS);
  });

  it('更新失败只移除对应层，继续更新余下层', () => {
    using ctx = fixture({ sources: {}, layers: [background('failed'), background('good')] });
    const [failed, good] = ctx.handles;
    failed?.setZoom.mockImplementation(() => { throw new Error('重画失败'); });
    ctx.camera.set({ ...INITIAL_CAMERA, zoom: 9 }, { view: '3d', cause: 'user' });
    expect(failed?.dispose).toHaveBeenCalledOnce();
    expect(good?.setZoom).toHaveBeenCalledExactlyOnceWith(9);
    expect(ctx.port.order).toHaveBeenLastCalledWith([good]);
  });

  it('创建期间暂停会释放未配置的层，恢复时重新创建并配置', async () => {
    using ctx = fixture({ sources: {}, layers: [] });
    ctx.duringCreate.mockImplementationOnce(() => ctx.mirror.pause());
    ctx.style.setGroup('sample', { sources: {}, layers: [background('base')] });
    await Promise.resolve();
    expect(ctx.handles[0]?.dispose).toHaveBeenCalledOnce();
    expect(ctx.handles[0]?.setVisible).not.toHaveBeenCalled();
    ctx.mirror.resume();
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
    expect(ctx.handles[1]?.setVisible).toHaveBeenCalledExactlyOnceWith(true);
    expect(ctx.port.order).toHaveBeenLastCalledWith([ctx.handles[1]]);
  });

  it('排序失败不记为已应用，下次样式提交重新尝试同一顺序', async () => {
    const first = background('one');
    const second = background('two');
    using ctx = fixture({ sources: {}, layers: [first, second] });
    ctx.port.order.mockImplementationOnce(() => { throw new Error('排序失败'); });
    ctx.style.setGroup('sample', { sources: {}, layers: [second, first] });
    await Promise.resolve();
    expect(ctx.onError).toHaveBeenCalledWith(new Error('排序失败'));
    ctx.style.setGroup('sample', { sources: { unused: SOURCE }, layers: [second, first] });
    await Promise.resolve();
    expect(ctx.port.order).toHaveBeenCalledTimes(3);
    expect(ctx.port.order).toHaveBeenLastCalledWith([ctx.handles[1], ctx.handles[0]]);
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
  });

  it('释放断开监听且幂等；资源和报告器抛错不打断其他资源释放', async () => {
    using consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    using ctx = fixture({ sources: {}, layers: [background('one'), background('two')] }, {
      onError: () => { throw new Error('报告器失败'); },
      onSourceErrors: () => { throw new Error('来源报告器失败'); }
    });
    ctx.handles[0]?.dispose.mockImplementation(() => { throw new Error('释放失败'); });
    ctx.mirror[Symbol.dispose]();
    ctx.mirror[Symbol.dispose]();
    ctx.mirror.resume();
    ctx.style.setGroup('sample', { sources: {}, layers: [background('three')] });
    ctx.camera.set({ ...INITIAL_CAMERA, zoom: 9 }, { view: '2d', cause: 'program' });
    await Promise.resolve();
    ctx.handles[1]?.report(new Error('释放后回调'));
    expect(ctx.port.create).toHaveBeenCalledTimes(2);
    expect(ctx.handles[0]?.dispose).toHaveBeenCalledOnce();
    expect(ctx.handles[1]?.dispose).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(ctx.mirror.sourceErrors).toBe(NO_SOURCE_ERRORS);
  });

  it('来源报告器抛错仍保存记录，错误报告器重入释放后不再写引擎', async () => {
    using consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    using ctx = fixture({ sources: {}, layers: [] }, {
      onSourceErrors: () => { throw new Error('报告失败'); }
    });
    ctx.duringCreate.mockImplementation(handle => handle.report(new Error('加载失败')));
    ctx.style.setGroup('sample', { sources: { tiles: SOURCE }, layers: [raster('raster')] });
    await Promise.resolve();
    expect(ctx.mirror.sourceErrors.size).toBe(1);
    expect(consoleError).toHaveBeenCalledOnce();

    using stopped = fixture({ sources: {}, layers: [] }, { onError: () => stopped.mirror[Symbol.dispose]() });
    stopped.duringCreate.mockImplementation(handle => handle.report(new Error('加载失败')));
    stopped.style.setGroup('sample', { sources: { tiles: SOURCE }, layers: [raster('raster'), background('later')] });
    await Promise.resolve();
    expect(stopped.port.create).toHaveBeenCalledOnce();
    expect(stopped.handles[0]?.dispose).toHaveBeenCalledOnce();
    expect(stopped.handles[0]?.setVisible).not.toHaveBeenCalled();
    expect(stopped.port.order).not.toHaveBeenCalled();
    expect(stopped.port.requestRender).toHaveBeenCalledOnce();
  });
});
