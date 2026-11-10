import type { SceneFrame, SceneSurface } from '@mx/map-core';
import type { GlWatch, ThreeSceneInspection, ThreeSceneRendererOptions } from '@mx/map-three';
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { type MapThreeModule, SplatProbe } from './splat-probe';

// 假的 map-three：渲染器记下构造参数、render 时问监听现在算不算在回调里；监听记下监听的上下文、是否已撤掉
class FakeRenderer {
  static created: FakeRenderer[] = [];
  frames = 0;
  insideDuringRender: boolean | null = null;
  constructor(readonly options?: ThreeSceneRendererOptions) {
    FakeRenderer.created.push(this);
  }
  attach(_surface: SceneSurface): void {}
  render(_frame: SceneFrame): void {
    this.frames++;
    this.insideDuringRender = watches.at(-1)?.inside() ?? null;
  }
  inspect(): ThreeSceneInspection {
    return { frames: this.frames } as ThreeSceneInspection;
  }
}

interface FakeWatch {
  readonly gl: WebGL2RenderingContext;
  readonly inside: () => boolean;
  disposed: boolean;
}

const watches: FakeWatch[] = [];

const module = {
  ThreeSceneRenderer: FakeRenderer,
  watchGl: (gl: WebGL2RenderingContext, inside: () => boolean): GlWatch => {
    const watch: FakeWatch = { gl, inside, disposed: false };
    watches.push(watch);
    return {
      errors: [],
      errorCount: 2,
      libraryOutside: 7,
      libraryOutsideByMethod: { texSubImage2D: 7 },
      [Symbol.dispose]: () => {
        watch.disposed = true;
      }
    };
  }
} as unknown as MapThreeModule;

const fakeGl = (name: string) =>
  ({ RENDERER: 1, getExtension: () => null, getParameter: () => name }) as unknown as WebGL2RenderingContext;

// 像 MapLibre 视图那样：加载渲染器模块、建渲染器、挂上
async function mount(probe: SplatProbe, budget: number, gl: WebGL2RenderingContext) {
  const create = await probe.engine(budget).loadRenderer();
  const renderer = required(create, '渲染器的工厂')() as unknown as FakeRenderer;
  renderer.attach({ gl } as SceneSurface);
  return renderer;
}

describe('SplatProbe（/dev/splat-watch）', () => {
  it('引擎是 maplibre，渲染器只换总预算；挂上后读得到显卡和渲染器的读数', async () => {
    const probe = new SplatProbe(() => Promise.resolve(module));
    const engine = probe.engine(6_000_000);
    expect(engine.kind).toBe('maplibre');
    expect(engine.capabilities.splats).toBe(true);

    const renderer = await mount(probe, 6_000_000, fakeGl('RTX 3060'));
    expect(renderer.options).toEqual({ splatBudget: 6_000_000 });
    const snapshot = probe.snapshot(1000);
    expect(snapshot.gpu).toBe('RTX 3060');
    expect(snapshot.inspection?.frames).toBe(0);
    expect(snapshot.watch).toBeNull();
  });

  it('GL 监听：打开后监听挂上的上下文，render 期间算在回调里，之外不算；关掉就撤掉', async () => {
    const probe = new SplatProbe(() => Promise.resolve(module));
    const gl = fakeGl('RTX 3060');
    const renderer = await mount(probe, 3_000_000, gl);
    probe.setWatching(true, 1000);
    const watch = required(watches.at(-1), '监听');
    expect(watch.gl).toBe(gl);
    expect(watch.inside()).toBe(false);
    renderer.render({} as SceneFrame);
    expect(renderer.insideDuringRender).toBe(true);
    expect(watch.inside()).toBe(false);
    expect(probe.snapshot(3000).watch).toEqual({
      seconds: 2,
      errorCount: 2,
      errors: [],
      libraryOutside: 7,
      libraryOutsideByMethod: { texSubImage2D: 7 }
    });

    probe.setWatching(false);
    expect(watch.disposed).toBe(true);
    expect(probe.snapshot().watch).toBeNull();
  });

  it('先打开监听再建地图也行；换预算重建地图后监听换到新的上下文', async () => {
    const probe = new SplatProbe(() => Promise.resolve(module));
    probe.setWatching(true);
    await mount(probe, 3_000_000, fakeGl('A'));
    const first = required(watches.at(-1), '第一个监听');

    probe.detach();
    expect(first.disposed).toBe(true);
    const second = fakeGl('B');
    await mount(probe, 10_000_000, second);
    expect(watches.at(-1)?.gl).toBe(second);
    expect(probe.snapshot().gpu).toBe('B');
  });

  it('帧率按两次读数之间画了几帧算，第一次没有', async () => {
    const probe = new SplatProbe(() => Promise.resolve(module));
    const renderer = await mount(probe, 3_000_000, fakeGl('A'));
    expect(probe.snapshot(1000).fps).toBeNull();
    for (let index = 0; index < 30; index++) {
      renderer.render({} as SceneFrame);
    }
    expect(probe.snapshot(1500).fps).toBe(60);
  });

  it('卸下以后不再读那个渲染器', async () => {
    const probe = new SplatProbe(() => Promise.resolve(module));
    await mount(probe, 3_000_000, fakeGl('A'));
    probe.detach();
    expect(probe.snapshot()).toEqual({ gpu: null, fps: null, inspection: null, watch: null });
  });
});
