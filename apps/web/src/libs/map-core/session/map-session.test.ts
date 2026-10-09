import { describe, expect, it, vi } from 'vitest';
import type { CameraState } from '../camera/camera-model';
import { StyleModel } from '../style/style-model';
import { MapSession } from './map-session';

const NANJING: CameraState = { center: [118.8, 32.05], zoom: 8, bearing: 0, pitch: 0 };
const EMPTY = { sources: {}, layers: [] };

function createSession() {
  return new MapSession({
    groups: ['basemap', 'business'],
    root: { glyphs: '/fonts/{fontstack}/{range}.pbf' },
    camera: NANJING
  });
}

describe('MapSession', () => {
  it('creates the style and camera parts from the options', () => {
    using session = createSession();

    expect(session.style.current).toMatchObject({ version: 8, glyphs: '/fonts/{fontstack}/{range}.pbf' });
    expect(session.camera.current).toEqual(NANJING);
    // 构造完成后各部分仍然可用，所有权已经转给会话
    expect(() => session.style.setGroup('basemap', EMPTY)).not.toThrow();
    expect(() => session.camera.set({ ...NANJING, zoom: 9 }, { view: '2d', cause: 'user' })).not.toThrow();
    // @ts-expect-error 分组 ID 来自构造会话时声明的元组
    expect(() => session.style.setGroup('measure', EMPTY)).toThrow('未声明的分组：measure');
  });

  it('disposes every part together with the session', () => {
    const session = createSession();

    session[Symbol.dispose]();

    expect(() => session.style.setGroup('basemap', EMPTY)).toThrow('StyleModel 已释放');
    expect(() => session.camera.set(NANJING, { view: '2d', cause: 'user' })).toThrow('CameraModel 已释放');
    expect(() => session[Symbol.dispose]()).not.toThrow();
  });

  it('is disposed at the end of a using block', () => {
    let escaped: MapSession<'basemap' | 'business'> | undefined;
    {
      using session = createSession();
      escaped = session;
    }

    expect(() => escaped.style.setGroup('basemap', EMPTY)).toThrow('StyleModel 已释放');
  });

  it('releases the parts already created when the constructor fails', () => {
    using disposeStyle = vi.spyOn(StyleModel.prototype, Symbol.dispose);

    expect(() => new MapSession({ groups: ['basemap'], camera: { ...NANJING, zoom: Number.NaN } })).toThrow(
      RangeError
    );
    expect(disposeStyle).toHaveBeenCalledOnce();
  });
});
