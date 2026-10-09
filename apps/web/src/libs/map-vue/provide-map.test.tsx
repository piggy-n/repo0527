import type { CameraState, MapSession, StyleGroup } from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { INTERNAL_MAP_CONTEXT } from './context';
import { provideMap } from './provide-map';
import { StyleBinder } from './style-binder';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

function basemap(color: string): StyleGroup {
  return {
    sources: {},
    layers: [{ id: 'basemap-background', type: 'background', paint: { 'background-color': color } }]
  };
}

function backgroundColor(session: MapSession<string>): unknown {
  const layer = session.style.current.layers.find(({ id }) => id === 'basemap-background');
  return layer?.paint && 'background-color' in layer.paint ? layer.paint['background-color'] : undefined;
}

// 自己会抛错的错误报告器
function throwingReporter(): never {
  throw new Error('报告器出错');
}

function injectSession(): MapSession<string> {
  const context = inject(INTERNAL_MAP_CONTEXT);
  if (!context) {
    throw new Error('没有找到地图上下文');
  }
  return context.session;
}

/** 页面：provideMap 并绑定底图；子组件 Probe 模拟画布组件，看到的是内部上下文里的会话 */
function setup(options: { onError?: (error: unknown) => void; onChildUnmounted?: () => void } = {}) {
  const color = ref('#eef2f7');
  const observed: { session?: MapSession<string>; layersAtChildSetup?: string[]; lateBindError?: unknown } = {};

  const Probe = defineComponent(() => {
    const session = injectSession();
    observed.session = session;
    observed.layersAtChildSetup = session.style.current.layers.map(({ id }) => id);
    onUnmounted(() => options.onChildUnmounted?.());
    return () => null;
  });

  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['basemap', 'measure'], camera: CAMERA, onError: options.onError });
    map.bindStyle({ basemap: () => basemap(color.value) });
    onMounted(() => {
      try {
        map.bindStyle({ measure: () => ({ sources: {}, layers: [] }) });
      } catch (error) {
        observed.lateBindError = error;
      }
    });
    return () => <Probe />;
  });

  const wrapper = mount(Page);
  const { session } = observed;
  if (!session) {
    throw new Error('子组件没有拿到会话');
  }
  return { wrapper, color, session, observed };
}

describe('provideMap', () => {
  it('只能在组件的 setup 中调用', () => {
    expect(() => provideMap({ groups: ['basemap'], camera: CAMERA })).toThrow('只能在组件的 setup 中调用');
  });

  it('绑定的初始值在子组件 setup 之前提交，画布创建视图时会话里已经是完整的样式', () => {
    const { observed, session } = setup();

    expect(observed.layersAtChildSetup).toEqual(['basemap-background']);
    expect(session.style.version).toBe(1);
  });

  it('挂载后推导结果的变化照常提交；挂载后再绑定会抛错', async () => {
    const { color, session, observed } = setup();

    color.value = '#1f2d52';
    await nextTick();

    expect(backgroundColor(session)).toBe('#1f2d52');
    expect(observed.lateBindError).toBeInstanceOf(Error);
    expect((observed.lateBindError as Error).message).toContain('只能在 provideMap 所在组件的 setup 中绑定');
  });

  it('卸载时先卸载子组件、后释放会话，卸载后不再提交', async () => {
    let sessionAliveInChildUnmounted: boolean | undefined;
    const { wrapper, color, session } = setup({
      onChildUnmounted: () => {
        // 会话释放后再订阅会抛错
        try {
          session.style.on('change', () => undefined)();
          sessionAliveInChildUnmounted = true;
        } catch {
          sessionAliveInChildUnmounted = false;
        }
      }
    });

    wrapper.unmount();
    color.value = '#1f2d52';
    await nextTick();

    expect(sessionAliveInChildUnmounted).toBe(true);
    expect(() => session.style.on('change', () => undefined)).toThrow('StyleModel 已释放');
    expect(session.style.version).toBe(1);
    expect(backgroundColor(session)).toBe('#eef2f7');
  });

  it('卸载路径上的错误交给 onError，不中断子组件卸载和会话释放', () => {
    const failure = new Error('停止提交失败');
    const dispose = vi.spyOn(StyleBinder.prototype, Symbol.dispose).mockImplementation(() => {
      throw failure;
    });
    try {
      const errors: unknown[] = [];
      let childUnmounted = false;
      const { wrapper, session } = setup({
        onError: error => errors.push(error),
        onChildUnmounted: () => (childUnmounted = true)
      });

      expect(() => wrapper.unmount()).not.toThrow();
      expect(errors).toEqual([failure]);
      expect(childUnmounted).toBe(true);
      expect(() => session.style.on('change', () => undefined)).toThrow('StyleModel 已释放');
    } finally {
      dispose.mockRestore();
    }
  });

  it('组名受声明的分组约束：类型检查报错，运行时提交被拒绝并交给 onError', () => {
    const errors: Error[] = [];
    mount(
      defineComponent(() => {
        const map = provideMap({ groups: ['basemap'], camera: CAMERA, onError: error => errors.push(error as Error) });
        map.bindStyle({
          // @ts-expect-error 未声明的分组
          basemapp: () => basemap('#eef2f7')
        });
        return () => null;
      })
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.cause).toEqual(expect.objectContaining({ message: '未声明的分组：basemapp' }));
  });

  it('没有传 onError 时打印到控制台', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const Page = defineComponent(() => {
        const map = provideMap({ groups: ['basemap'], camera: CAMERA });
        map.bindStyle({
          basemap: () => {
            throw new Error('推导失败');
          }
        });
        return () => null;
      });

      expect(() => mount(Page)).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('[map-vue]', expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });

  describe('onError 自身抛错', () => {
    it('推导失败时报告器的异常不冒出挂载过程，改为打印到控制台', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const Page = defineComponent(() => {
          const map = provideMap({ groups: ['basemap'], camera: CAMERA, onError: throwingReporter });
          map.bindStyle({
            basemap: () => {
              throw new Error('推导失败');
            }
          });
          return () => null;
        });

        expect(() => mount(Page)).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          '[map-vue] 错误报告器抛出了异常',
          new Error('报告器出错'),
          expect.any(Error)
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it('卸载路径上释放出错、报告器也抛错时，卸载照常完成', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const dispose = vi.spyOn(StyleBinder.prototype, Symbol.dispose).mockImplementation(() => {
        throw new Error('停止提交失败');
      });
      try {
        let childUnmounted = false;
        const { wrapper, session } = setup({
          onError: throwingReporter,
          onChildUnmounted: () => (childUnmounted = true)
        });

        expect(() => wrapper.unmount()).not.toThrow();
        expect(childUnmounted).toBe(true);
        expect(() => session.style.on('change', () => undefined)).toThrow('StyleModel 已释放');
      } finally {
        dispose.mockRestore();
        consoleError.mockRestore();
      }
    });
  });
});
