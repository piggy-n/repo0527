import { createNanoEvents } from 'nanoevents';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneContentModel, type SceneStatus, type TilesetLayer } from '../scene/scene-content-model';
import type { TilesetSphere } from '../scene/tileset-camera';
import type { TilesetOptions } from '../scene/tileset-sync';
import { MapLibreScene, type SceneMap } from './maplibre-scene';
import { SCENE_LAYER_ID, type SceneLayer } from './scene-layer';
import type { CreateSceneRenderer, SceneRenderer, SceneRendererEvents, SceneSurface } from './scene-renderer';

// 地图只记图层的顺序；加上自定义层时像 MapLibre 一样调用 onAdd，撤下时调用 onRemove
class FakeSceneMap implements SceneMap {
  readonly canvas = document.createElement('canvas');
  order: string[] = ['background', 'resources'];
  readonly layers = new Map<string, SceneLayer>();
  repaints = 0;

  addLayer(layer: SceneLayer): void {
    this.order.push(layer.id);
    this.layers.set(layer.id, layer);
    layer.onAdd(this, {} as WebGL2RenderingContext);
  }
  removeLayer(id: string): void {
    this.order = this.order.filter(item => item !== id);
    this.layers.get(id)?.onRemove();
    this.layers.delete(id);
  }
  getLayer(id: string): unknown {
    return this.order.includes(id) ? {} : undefined;
  }
  moveLayer(id: string): void {
    this.order = [...this.order.filter(item => item !== id), id];
  }
  getLayersOrder(): string[] {
    return [...this.order];
  }
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  triggerRepaint(): void {
    this.repaints++;
  }
  // 整体换样式：全部图层（包括自定义层）都没了
  replaceStyle(): void {
    for (const id of this.layers.keys()) {
      this.removeLayer(id);
    }
    this.order = ['background'];
  }
}

const SPHERE: TilesetSphere = { center: [120.66, 31.31], radius: 40 };

class FakeRenderer implements SceneRenderer {
  readonly calls: string[] = [];
  readonly emitter = createNanoEvents<SceneRendererEvents>();
  surface: SceneSurface | null = null;
  disposed = false;

  attach(surface: SceneSurface): void {
    this.surface = surface;
    this.calls.push('attach');
  }
  detach(): void {
    this.calls.push('detach');
  }
  loseContext(): void {
    this.calls.push('loseContext');
  }
  prerender(): void {}
  render(): void {}
  endFrame(): void {
    this.calls.push('endFrame');
  }
  async addTileset(id: string, _tileset: unknown, options: TilesetOptions): Promise<TilesetSphere> {
    this.calls.push(`add ${id} ${options.lighting}`);
    return SPHERE;
  }
  updateTileset(id: string, options: TilesetOptions): void {
    this.calls.push(`update ${id} ${options.lighting}`);
  }
  removeTileset(id: string): void {
    this.calls.push(`remove ${id}`);
  }
  pick() {
    return { lngLat: [120.66, 31.31] as const, height: 12 };
  }
  project() {
    return { x: 10, y: 20 };
  }
  on<E extends keyof SceneRendererEvents>(event: E, callback: SceneRendererEvents[E]) {
    return this.emitter.on(event, callback);
  }
  [Symbol.dispose](): void {
    this.disposed = true;
  }
}

const tileset = (attempt = 0): TilesetLayer => ({
  id: 'station',
  url: 'https://models.test/station/tileset.json',
  show: true,
  lighting: 'sun',
  attempt
});

const TILESET_JSON = {
  asset: { version: '1.1' },
  geometricError: 10,
  root: { boundingVolume: { sphere: [0, 0, 0, 10] }, geometricError: 0, content: { uri: 'a.glb' } }
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const disposables: Disposable[] = [];
afterEach(() => disposables.splice(0).forEach(item => item[Symbol.dispose]()));

function setup(load?: () => Promise<CreateSceneRenderer>) {
  const map = new FakeSceneMap();
  const content = new SceneContentModel();
  const renderer = new FakeRenderer();
  const loadRenderer = load ?? (async () => () => renderer);
  const statuses: SceneStatus[] = [];
  const errors: unknown[] = [];
  let loads = 0;
  const scene = new MapLibreScene({
    map,
    scene: content,
    loadRenderer: () => {
      loads++;
      return loadRenderer();
    },
    loadJson: async () => TILESET_JSON,
    onError: error => errors.push(error),
    onStatus: status => statuses.push(status)
  });
  disposables.push(scene, content);
  const state = () => scene.status.get('station')?.state;
  return { map, content, renderer, scene, statuses, errors, state, loads: () => loads };
}

describe('MapLibreScene', () => {
  it('不显示三维时不加载渲染器、不应用三维内容；切到三维后加载、加上模型层并就绪', async () => {
    const { map, content, renderer, scene, state, loads } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(false, true);
    await flush();
    expect(loads()).toBe(0);
    expect(state()).toBeUndefined();

    scene.update(true, true);
    await flush();
    await flush();

    expect(loads()).toBe(1);
    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', SCENE_LAYER_ID]);
    expect(renderer.calls).toStrictEqual(['attach', 'add station sun']);
    expect(scene.status.get('station')).toMatchObject({ state: 'ready', camera: { center: SPHERE.center, pitch: 55 } });
  });

  it('切回二维撤下模型层，内容和渲染器保留；再切回三维重新挂上，不重新加载', async () => {
    const { map, content, renderer, scene, loads } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true);
    await flush();
    await flush();

    scene.update(false, true);
    content.set({ tilesets: [{ ...tileset(), lighting: 'headlight' }], underground: null });
    await flush();
    expect(map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
    expect(renderer.calls.at(-1)).toBe('detach');

    scene.update(true, true);

    expect(loads()).toBe(1);
    expect(renderer.calls.slice(-2)).toStrictEqual(['attach', 'update station headlight']);
  });

  it('渲染器加载失败时瓦片集进入 failed；重试（换重试次数）重新加载', async () => {
    let fail = true;
    const { content, scene, state, loads } = setup(async () => {
      if (fail) {
        throw new Error('三维模块下载失败');
      }
      return () => new FakeRenderer();
    });
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true);
    await flush();
    await flush();
    expect(scene.status.get('station')).toMatchObject({ state: 'failed', error: new Error('三维模块下载失败') });

    fail = false;
    content.set({ tilesets: [tileset(1)], underground: null });
    await flush();
    await flush();

    expect(loads()).toBe(2);
    expect(state()).toBe('ready');
  });

  it('样式整体重建后模型层不在了：样式加载完成时重新挂上', async () => {
    const { map, content, renderer, scene } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true);
    await flush();
    await flush();

    map.replaceStyle();
    scene.update(true, false);
    expect(map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
    scene.update(true, true);

    expect(map.getLayersOrder()).toStrictEqual(['background', SCENE_LAYER_ID]);
    expect(renderer.calls.filter(call => call === 'attach')).toHaveLength(2);
  });

  it('增量命令把新图层加在最上面后，模型层挪回最上面', async () => {
    const { map, content, scene } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true);
    await flush();
    await flush();
    map.order.push('measure');

    scene.keepOnTop();

    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', 'measure', SCENE_LAYER_ID]);
  });

  it('GL 上下文丢失时渲染器丢掉 GPU 资源；恢复后样式重新加载时再次挂上', async () => {
    const { map, content, renderer, scene } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true);
    await flush();
    await flush();

    map.replaceStyle();
    scene.loseContext();
    scene.update(true, true);

    expect(renderer.calls.slice(-3)).toStrictEqual(['detach', 'loseContext', 'attach']);
    expect(map.getLayer(SCENE_LAYER_ID)).toBeDefined();
  });

  it('只在显示三维时拾取、投影模型，画完一帧时通知渲染器；释放时释放渲染器', async () => {
    const { content, renderer, scene } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true);
    await flush();
    await flush();

    expect(scene.pick({ x: 1, y: 1 })).toStrictEqual({ lngLat: [120.66, 31.31], height: 12 });
    expect(scene.project([120.66, 31.31], 12)).toStrictEqual({ x: 10, y: 20 });
    scene.endFrame();
    expect(renderer.calls.at(-1)).toBe('endFrame');
    scene.update(false, true);
    expect(scene.pick({ x: 1, y: 1 })).toBeNull();

    scene[Symbol.dispose]();
    expect(renderer.disposed).toBe(true);
  });
});
