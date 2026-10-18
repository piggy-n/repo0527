// @vitest-environment node
import { CameraModel, StyleModel, type StyleGroup } from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { StyleMirror, type StyleMirrorPort } from './style-mirror';

const IMAGE = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };
const GROUP: StyleGroup = {
  sources: { areas: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [{ id: 'pattern', type: 'fill', source: 'areas', paint: { 'fill-pattern': ['get', 'pattern'] } }],
  images: {}
};

function fixture() {
  const style = new StyleModel<string>({ groups: ['sample'] });
  const camera = new CameraModel({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });
  const callbacks: ((error: unknown) => void)[] = [];
  const report = vi.fn<(error: unknown) => void>();
  const port: StyleMirrorPort = {
    create: (_layer, _zoom, onError) => {
      callbacks.push(onError);
      return { setVisible: () => {}, setZoom: () => {}, [Symbol.dispose]: () => {} };
    },
    order: () => {}, requestRender: () => {}
  };
  style.setGroup('sample', GROUP);
  const mirror = new StyleMirror({ style, camera, port, onError: report });
  return {
    style, mirror, callbacks, report,
    [Symbol.dispose]: () => { mirror[Symbol.dispose](); camera[Symbol.dispose](); style[Symbol.dispose](); }
  };
}

describe('动态花纹图片新增与迟到错误', () => {
  it.each([false, true])('新增动态图片后，同步前的旧图层错误不能污染来源错误，暂停=%s', async paused => {
    using ctx = fixture();
    expect(ctx.callbacks).toHaveLength(1);
    if (paused) { ctx.mirror.pause(); }
    ctx.style.setGroup('sample', { ...GROUP, images: { newlyLoaded: IMAGE } });
    ctx.callbacks[0](new Error('旧图片尚未加载'));
    expect(ctx.mirror.sourceErrors.size).toBe(0);
    expect(ctx.report).not.toHaveBeenCalled();
    await Promise.resolve();
    if (paused) { ctx.mirror.resume(); }
    expect(ctx.callbacks).toHaveLength(2);
    expect(ctx.mirror.sourceErrors.size).toBe(0);
    const current = new Error('当前图片失败');
    ctx.callbacks[1](current);
    expect(ctx.mirror.sourceErrors.get('areas')).toBe(current);
    expect(ctx.report).toHaveBeenCalledExactlyOnceWith(current);
  });
});
