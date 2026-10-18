import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  type CesiumCanvasOptions,
  type CesiumCanvasSurface,
  type LoadCesiumSurface,
  useCesiumCanvas
} from './use-cesium-canvas';

/** 控制模块何时加载完成，不依赖真实 SDK 或计时长度 */
function pendingLoader() {
  let resolve!: (create: (options: CesiumCanvasOptions) => CesiumCanvasSurface) => void;
  const promise = new Promise<(options: CesiumCanvasOptions) => CesiumCanvasSurface>(settle => { resolve = settle; });
  return { load: () => promise, resolve };
}

/** 假画布记录生命周期，保留回调以模拟晚到的引擎事件 */
function fakeSurface() {
  const pause = vi.fn();
  const resume = vi.fn();
  const dispose = vi.fn();
  let options!: CesiumCanvasOptions;
  const create = vi.fn((value: CesiumCanvasOptions): CesiumCanvasSurface => {
    options = value;
    return { pause, resume, [Symbol.dispose]: dispose };
  });
  return { create, pause, resume, dispose, ready: () => options.onReady(), fail: () => options.onError(new Error('失败')) };
}

function harness(load: LoadCesiumSurface) {
  let controller!: ReturnType<typeof useCesiumCanvas>;
  const active = ref(true);
  const wrapper = mount(defineComponent({
    setup() {
      const container = ref<HTMLElement>();
      controller = useCesiumCanvas(container, () => '/cesium/', () => active.value, load);
      return () => <div ref={container} />;
    }
  }));
  return { controller, active, wrapper };
}

// 模块加载只经过微任务，以必然更晚的下一轮事件循环作为等待边界
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('三维预览画布生命周期', () => {
  it('加载晚于卸载时不创建引擎', async () => {
    const loading = pendingLoader();
    const surface = fakeSurface();
    const { wrapper } = harness(loading.load);
    wrapper.unmount();
    loading.resolve(surface.create);
    await flush();

    expect(surface.create).not.toHaveBeenCalled();
  });

  it('重试只接受最新一次加载，旧模块晚到不能创建第二张画布', async () => {
    const first = pendingLoader();
    const second = pendingLoader();
    const surface = fakeSurface();
    const load = vi.fn<LoadCesiumSurface>().mockImplementationOnce(first.load).mockImplementationOnce(second.load);
    const { controller } = harness(load);
    const retrying = controller.retry();
    second.resolve(surface.create);
    await retrying;
    surface.ready();
    first.resolve(surface.create);
    await flush();

    expect(surface.create).toHaveBeenCalledOnce();
    expect(controller.state.value).toEqual({ status: 'ready' });
  });

  it('挂载期间暂停，在模块到达后保持暂停；恢复和卸载分别交给引擎', async () => {
    const loading = pendingLoader();
    const surface = fakeSurface();
    const { active, wrapper } = harness(loading.load);
    active.value = false;
    await nextTick();
    loading.resolve(surface.create);
    await flush();
    expect(surface.pause).toHaveBeenCalledOnce();
    active.value = true;
    await nextTick();
    expect(surface.resume).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(surface.dispose).toHaveBeenCalledOnce();
  });

  it('引擎失败后释放，重试能恢复，旧事件不能覆盖新状态', async () => {
    const first = fakeSurface();
    const second = fakeSurface();
    const load = vi.fn<LoadCesiumSurface>()
      .mockResolvedValueOnce(first.create)
      .mockResolvedValueOnce(second.create);
    const { controller } = harness(load);
    await flush();
    first.fail();
    expect(controller.state.value).toEqual({ status: 'failed', message: '失败' });
    expect(first.dispose).toHaveBeenCalledOnce();
    await controller.retry();
    second.ready();
    first.ready();
    first.fail();
    expect(controller.state.value).toEqual({ status: 'ready' });
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('模块加载失败和构造失败都成为可重试状态', async () => {
    const surface = fakeSurface();
    const load = vi.fn<LoadCesiumSurface>()
      .mockRejectedValueOnce(new Error('模块失败'))
      .mockResolvedValueOnce(() => { throw new Error('WebGL 失败'); })
      .mockResolvedValueOnce(surface.create);
    const { controller } = harness(load);
    await flush();
    expect(controller.state.value).toEqual({ status: 'failed', message: '模块失败' });
    await controller.retry();
    expect(controller.state.value).toEqual({ status: 'failed', message: 'WebGL 失败' });
    await controller.retry();
    surface.ready();
    expect(controller.state.value).toEqual({ status: 'ready' });
  });
});
