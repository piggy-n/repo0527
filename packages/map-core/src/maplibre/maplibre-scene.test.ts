import { createNanoEvents } from 'nanoevents';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneContentModel, type SceneStatus, type SplatLayer, type TilesetLayer } from '../scene/scene-content-model';
import type { SplatOptions, SplatSource } from '../scene/splat-sync';
import type { TilesetSphere } from '../scene/tileset-camera';
import type { TilesetOptions } from '../scene/tileset-sync';
import { MapLibreScene, type SceneMap, type SceneModuleState } from './maplibre-scene';
import { SCENE_LAYER_ID, type SceneLayer } from './scene-layer';
import type { CreateSceneRenderer, SceneRenderer, SceneRendererEvents, SceneSurface } from './scene-renderer';

// 地图只记图层的顺序；加上自定义层时像 MapLibre 一样调用 onAdd，撤下时调用 onRemove
class FakeSceneMap implements SceneMap {
  readonly canvas = document.createElement('canvas');
  order: string[] = ['background', 'resources', 'labels'];
  readonly layers = new Map<string, SceneLayer>();
  repaints = 0;

  addLayer(layer: SceneLayer, beforeId?: string): void {
    this.order = this.#insert(layer.id, beforeId);
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
  moveLayer(id: string, beforeId?: string): void {
    this.order = this.#insert(id, beforeId);
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
    this.order = ['background', 'labels'];
  }

  // 像 MapLibre 一样：有 beforeId 时插在它下面，没有时放在最上面
  #insert(id: string, beforeId: string | undefined): string[] {
    const rest = this.order.filter(item => item !== id);
    const index = beforeId === undefined ? -1 : rest.indexOf(beforeId);
    return index < 0 ? [...rest, id] : [...rest.slice(0, index), id, ...rest.slice(index)];
  }
}

const SPHERE: TilesetSphere = { center: [120.66, 31.31], height: 0, radius: 40 };
const SPLAT_SPHERE: TilesetSphere = { center: [117.06, 34.27], height: 0, radius: 120 };

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
  async addSplat(id: string, source: SplatSource, options: SplatOptions): Promise<TilesetSphere> {
    this.calls.push(`add splat ${id} ${source.placement.height} ${options.show ? 'show' : 'hide'}`);
    return SPLAT_SPHERE;
  }
  updateSplat(id: string, options: SplatOptions): void {
    this.calls.push(`update splat ${id} ${options.show ? 'show' : 'hide'}`);
  }
  removeSplat(id: string): void {
    this.calls.push(`remove splat ${id}`);
  }
  pick() {
    return { lngLat: [120.66, 31.31] as const, height: 12 };
  }
  project() {
    return { x: 10, y: 20 };
  }
  setLift(): void {}
  lowestHeight(): number | null {
    return null;
  }
  setInteriorFog(): void {}
  setMarker(): void {}
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

const splat = (extra: Partial<SplatLayer> = {}): SplatLayer => ({
  id: 'cws',
  url: 'https://models.test/cws/cws.lcc2',
  show: true,
  placement: { lng: 117.06, lat: 34.27, height: 59.7, heading: 0 },
  attempt: 0,
  ...extra
});

const TILESET_JSON = {
  asset: { version: '1.1' },
  geometricError: 10,
  root: { boundingVolume: { sphere: [0, 0, 0, 10] }, geometricError: 0, content: { uri: 'a.glb' } }
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 立即可知的结果：还没结束的 Promise 得到 'pending'
function settled<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 0))]);
}

const disposables: Disposable[] = [];
afterEach(() => disposables.splice(0).forEach(item => item[Symbol.dispose]()));

function setup(load?: () => Promise<CreateSceneRenderer>) {
  const map = new FakeSceneMap();
  const content = new SceneContentModel();
  const renderer = new FakeRenderer();
  const loadRenderer = load ?? (async () => () => renderer);
  const statuses: SceneStatus[] = [];
  const modules: SceneModuleState['kind'][] = [];
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
    onStatus: status => statuses.push(status),
    onModuleChange: state => modules.push(state.kind)
  });
  disposables.push(scene, content);
  const state = () => scene.status.get('station')?.state;
  return { map, content, renderer, scene, statuses, modules, errors, state, loads: () => loads };
}

// 显示三维并加载好三维模块
async function shown(ctx: ReturnType<typeof setup>, before?: string): Promise<void> {
  ctx.scene.update(true, true, before);
  ctx.scene.load();
  await flush();
  await flush();
}

describe('MapLibreScene', () => {
  it('不加载三维模块就不挂模型层、不应用三维内容；加载好以后挂上模型层，追上积下的内容', async () => {
    const ctx = setup();
    const { map, content, renderer, scene, state } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(true, true, undefined);
    await flush();
    expect(ctx.loads()).toBe(0);
    expect(scene.module.kind).toBe('idle');
    expect(map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
    expect(state()).toBeUndefined();

    scene.load();
    expect(scene.module.kind).toBe('loading');
    await flush();
    await flush();

    expect(ctx.loads()).toBe(1);
    expect(ctx.modules).toStrictEqual(['loading', 'ready']);
    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', 'labels', SCENE_LAYER_ID]);
    expect(renderer.calls).toStrictEqual(['attach', 'add station sun']);
    expect(scene.status.get('station')).toMatchObject({ state: 'ready', camera: { center: SPHERE.center, pitch: 55 } });
    expect(await settled(scene.whenLoaded())).toBeUndefined();
  });

  it('高斯泼溅（ADR 0149）：交给渲染器、就绪时带建议的相机，状态和瓦片集合在一起；只改显示不重新加载，数据失败进入 failed', async () => {
    const ctx = setup();
    const { content, renderer, scene, statuses } = ctx;
    content.set({ tilesets: [tileset()], splats: [splat()], underground: null });
    await shown(ctx);

    // 瓦片集要先下载、整理索引，泼溅直接交给渲染器
    expect(renderer.calls).toStrictEqual(['attach', 'add splat cws 59.7 show', 'add station sun']);
    expect(scene.status.get('station')?.state).toBe('ready');
    expect(scene.status.get('cws')).toMatchObject({ state: 'ready', camera: { center: SPLAT_SPHERE.center, pitch: 55 } });
    expect(statuses.at(-1)).toBe(scene.status);

    content.set({ tilesets: [tileset()], splats: [splat({ show: false })], underground: null });
    await flush();
    expect(renderer.calls.at(-1)).toBe('update splat cws hide');

    const error = new Error('数据块下载失败');
    renderer.emitter.emit('splatfailed', 'cws', error);
    expect(scene.status.get('cws')).toStrictEqual({ state: 'failed', error });
    expect(scene.status.get('station')?.state).toBe('ready');

    content.set({ tilesets: [tileset()], underground: null });
    await flush();
    expect(renderer.calls.at(-1)).toBe('remove splat cws');
    expect([...scene.status.keys()]).toStrictEqual(['station']);
  });

  it('不显示三维时加载好三维模块也不挂模型层、不应用内容', async () => {
    const { map, content, renderer, scene, state } = setup();
    content.set({ tilesets: [tileset()], underground: null });
    scene.update(false, true, undefined);
    scene.load();
    await flush();
    await flush();

    expect(scene.module.kind).toBe('ready');
    expect(map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
    expect(renderer.calls).toStrictEqual([]);
    expect(state()).toBeUndefined();
  });

  it('加载中、已加载时再 load 不重复加载', async () => {
    const ctx = setup();
    ctx.scene.load();
    ctx.scene.load();
    await flush();
    ctx.scene.load();

    expect(ctx.loads()).toBe(1);
  });

  it('切回二维撤下模型层，内容和渲染器保留；再切回三维重新挂上，不重新加载', async () => {
    const ctx = setup();
    const { map, content, renderer, scene } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    await shown(ctx);

    scene.update(false, true, undefined);
    content.set({ tilesets: [{ ...tileset(), lighting: 'headlight' }], underground: null });
    await flush();
    expect(map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
    expect(renderer.calls.at(-1)).toBe('detach');

    scene.update(true, true, undefined);

    expect(ctx.loads()).toBe(1);
    expect(renderer.calls.slice(-2)).toStrictEqual(['attach', 'update station headlight']);
  });

  it('三维模块加载失败：模块的状态是 failed，瓦片集不记失败；再 load 重新加载，成功后应用内容', async () => {
    let fail = true;
    const error = new Error('三维模块下载失败');
    const ctx = setup(async () => {
      if (fail) {
        throw error;
      }
      return () => new FakeRenderer();
    });
    const { content, scene, state } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    const first = scene.whenLoaded();
    await shown(ctx);

    expect(scene.module).toStrictEqual({ kind: 'failed', error });
    expect(ctx.errors).toStrictEqual([error]);
    expect(state()).toBeUndefined();
    await expect(first).rejects.toBe(error);

    fail = false;
    scene.load();
    const second = scene.whenLoaded();
    await flush();
    await flush();

    expect(ctx.loads()).toBe(2);
    expect(ctx.modules).toStrictEqual(['loading', 'failed', 'loading', 'ready']);
    expect(await settled(second)).toBeUndefined();
    expect(state()).toBe('ready');
  });

  it('创建渲染器抛错也算三维模块加载失败', async () => {
    const error = new Error('WebGL2 不可用');
    const ctx = setup(async () => () => {
      throw error;
    });
    await shown(ctx);

    expect(ctx.scene.module).toStrictEqual({ kind: 'failed', error });
  });

  it('加载期间释放：加载结果不再使用，等待的人以 AbortError 结束', async () => {
    const renderer = new FakeRenderer();
    let resolve: ((create: CreateSceneRenderer) => void) | undefined;
    const ctx = setup(() => new Promise(done => (resolve = done)));
    ctx.scene.load();
    const loaded = ctx.scene.whenLoaded();

    ctx.scene[Symbol.dispose]();
    resolve?.(() => renderer);
    await flush();

    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.modules).toStrictEqual(['loading']);
    expect(ctx.map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
  });

  it('样式整体重建后模型层不在了：样式加载完成时重新挂上', async () => {
    const ctx = setup();
    const { map, content, renderer, scene } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    await shown(ctx, 'labels');

    map.replaceStyle();
    scene.update(true, false, 'labels');
    expect(map.getLayer(SCENE_LAYER_ID)).toBeUndefined();
    scene.update(true, true, 'labels');

    expect(map.getLayersOrder()).toStrictEqual(['background', SCENE_LAYER_ID, 'labels']);
    expect(renderer.calls.filter(call => call === 'attach')).toHaveLength(2);
  });

  it('模型层插在页面声明的图层下面；增量命令把新图层加在最上面后，按新快照的位置挪回去', async () => {
    const ctx = setup();
    const { map, content, scene } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    await shown(ctx, 'labels');
    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', SCENE_LAYER_ID, 'labels']);

    map.order.push('measure');
    scene.place('labels');
    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', SCENE_LAYER_ID, 'labels', 'measure']);

    // 下面的分组新加的图层：样式命令按下一个图层插入，落在模型层上面，要把模型层挪到它上面
    map.order = ['background', 'resources', SCENE_LAYER_ID, 'selection', 'labels', 'measure'];
    scene.place('labels');
    expect(map.getLayersOrder()).toStrictEqual([
      'background',
      'resources',
      'selection',
      SCENE_LAYER_ID,
      'labels',
      'measure'
    ]);

    // 上面的分组都空了：放到最上面
    map.order = ['background', 'resources', SCENE_LAYER_ID];
    map.order.push('highlight');
    scene.place(undefined);
    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', 'highlight', SCENE_LAYER_ID]);
  });

  it('位置没变时不挪动；模型层不在地图上时只记下位置', async () => {
    const ctx = setup();
    const { map, scene } = ctx;
    const moves: (string | undefined)[] = [];
    const moveLayer = map.moveLayer.bind(map);
    map.moveLayer = (id, before) => {
      moves.push(before);
      moveLayer(id, before);
    };
    scene.place('labels');
    expect(moves).toStrictEqual([]);

    await shown(ctx, 'labels');
    scene.place('labels');

    expect(moves).toStrictEqual([]);
    expect(map.getLayersOrder()).toStrictEqual(['background', 'resources', SCENE_LAYER_ID, 'labels']);
  });

  it('GL 上下文丢失时渲染器丢掉 GPU 资源；恢复后样式重新加载时再次挂上', async () => {
    const ctx = setup();
    const { map, content, renderer, scene } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    await shown(ctx);

    map.replaceStyle();
    scene.loseContext();
    scene.update(true, true, undefined);

    expect(renderer.calls.slice(-3)).toStrictEqual(['detach', 'loseContext', 'attach']);
    expect(map.getLayer(SCENE_LAYER_ID)).toBeDefined();
  });

  it('只在显示三维时拾取、投影模型，画完一帧时通知渲染器；释放时释放渲染器', async () => {
    const ctx = setup();
    const { content, renderer, scene } = ctx;
    content.set({ tilesets: [tileset()], underground: null });
    await shown(ctx);

    expect(scene.pick({ x: 1, y: 1 })).toStrictEqual({ lngLat: [120.66, 31.31], height: 12 });
    expect(scene.project([120.66, 31.31], 12)).toStrictEqual({ x: 10, y: 20 });
    scene.endFrame();
    expect(renderer.calls.at(-1)).toBe('endFrame');
    scene.update(false, true, undefined);
    expect(scene.pick({ x: 1, y: 1 })).toBeNull();

    scene[Symbol.dispose]();
    expect(renderer.disposed).toBe(true);
  });
});
