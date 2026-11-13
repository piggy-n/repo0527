import { type CameraState, type LngLat, MapLibreView, MapSession, type SceneBudget, type SceneFrame, type TilesetLayer } from '@mx/map-core';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { blockTileset, FIXTURE_ORIGIN, serveFixtures, texturedBoxGlb } from './testing/fixtures';
import { required } from './testing/required';
import { type ThreeSceneInspection, ThreeSceneRenderer, type ThreeSceneRendererOptions } from './three-scene-renderer';

// 真实的 MapLibre、Three 和瓦片库（ADR 0147 第 5 节，3C.4）：JKQ2 那样根节点没有内容、一层要么全要要么全不要的瓦片集，
// 预算很小。模型在内存里生成，只用 https://fixture.test/ 下的假地址

const MODEL_AT: LngLat = [120.66, 31.31];
const TEST_TIMEOUT = 90000;
const WAIT_TIMEOUT = 70000;
const WIDTH = 640;
const HEIGHT = 480;
// z17 俯视：相机离地约 367 米，屏幕误差约是几何误差的 2 倍；粗的 16 米误差约 31 像素、细的 2 米约 4 像素
const CAMERA: CameraState = { center: MODEL_AT, zoom: 17, bearing: 0, pitch: 0 };
const GRID = { blocks: 4, spacing: 50, blockError: 16, fineError: 2 };
// 粗的一块 32×32 贴图（带 mipmap 约 5.5 KB），细的一块 256×256（约 350 KB）
const BLOCK_TEXTURE = 32;
const FINE_TEXTURE = 256;
const KB = 1024;
// 粗的一层共约 100 KB，细的一层共约 22 MB
const BLOCK_LEVEL_FITS = { cacheBytes: 600 * KB, cacheLimitBytes: 900 * KB };

// 每一帧检查一次，条件成立时结束；超时以说明失败，结束后不再检查
async function until(accept: () => boolean, label: string): Promise<void> {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const satisfied = new Promise<void>(resolve => {
    const poll = () => {
      if (accept()) {
        resolve();
        return;
      }
      frame = requestAnimationFrame(poll);
    };
    poll();
  });
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  try {
    await Promise.race([satisfied, expired]);
  } finally {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  }
}

const seconds = (value: number) => new Promise(resolve => setTimeout(resolve, value * 1000));

// 上传贴图的调用照常执行，调用的那一刻来源是关掉的 ImageBitmap（宽高是 0）时记一次。要在调用时看：
// 上传以后才释放的那份，事后在调用记录里也是 0×0
function watchTextureUploads(name: 'texImage2D' | 'texSubImage2D', onClosed: () => void) {
  const original = WebGL2RenderingContext.prototype[name] as (...args: unknown[]) => unknown;
  return vi.spyOn(WebGL2RenderingContext.prototype, name).mockImplementation(function (this: WebGL2RenderingContext, ...args: unknown[]) {
    const source = args.at(-1);
    if (source instanceof ImageBitmap && source.width === 0 && source.height === 0) {
      onClosed();
    }
    return original.apply(this, args);
  });
}

// 记下每一帧 render 里的上传次数：贴图、缓冲。只算 render 里的：MapLibre 自己的上传不在这里
class RecordingRenderer extends ThreeSceneRenderer {
  readonly frames: { textures: number; buffers: number }[] = [];
  #closedUploads = 0;
  readonly #textures = [
    watchTextureUploads('texSubImage2D', () => {
      this.#closedUploads++;
    }),
    watchTextureUploads('texImage2D', () => {
      this.#closedUploads++;
    })
  ];
  readonly #buffers = vi.spyOn(WebGL2RenderingContext.prototype, 'bufferData');

  override render(frame: SceneFrame): void {
    const textureCalls = () => this.#textures.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    const beforeTextures = textureCalls();
    const beforeBuffers = this.#buffers.mock.calls.length;
    super.render(frame);
    const textures = textureCalls() - beforeTextures;
    const buffers = this.#buffers.mock.calls.length - beforeBuffers;
    if (textures > 0 || buffers > 0) {
      this.frames.push({ textures, buffers });
    }
  }

  /**
   * 上传了关掉的 ImageBitmap（宽高是 0）的次数：释放了还没传进这个上下文的贴图，第一次绘制时就会这样，
   * Three 吞掉错误、瓦片画成黑的
   */
  closedUploads(): number {
    return this.#closedUploads;
  }

  restore(): void {
    for (const spy of [...this.#textures, this.#buffers]) {
      spy.mockRestore();
    }
  }
}

async function setup(options: ThreeSceneRendererOptions, camera: CameraState = CAMERA) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px`;
  const session = new MapSession({ groups: ['basemap'], camera });
  session.style.setGroup('basemap', {
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }]
  });
  let renderer: RecordingRenderer | undefined;
  const errors: unknown[] = [];
  const view = new MapLibreView({
    session,
    container,
    onError: error => errors.push(error),
    // 读像素要保留绘制缓冲
    mapOptions: {
      maxZoom: 24,
      maxPitch: 85,
      centerClampedToGround: false,
      canvasContextAttributes: { antialias: false, preserveDrawingBuffer: true }
    },
    loadSceneRenderer: async () => () => (renderer = new RecordingRenderer(options))
  });
  onTestFinished(() => {
    view[Symbol.dispose]();
    session[Symbol.dispose]();
    container.remove();
    renderer?.restore();
  });
  await view.whenReady();
  view.setKind('3d');
  await view.whenReady();
  return {
    session,
    view,
    errors,
    canvas: required(container.querySelector('canvas'), '地图画布'),
    get renderer(): RecordingRenderer {
      return required(renderer, '三维渲染器');
    }
  };
}

type Context = Awaited<ReturnType<typeof setup>>;

interface BlockSizes {
  readonly blockTexture?: number;
  readonly fineTexture?: number;
  /** 细的瓦片除了前 promptFine 块，都晚这么久才下载完 */
  readonly fineDelayMs?: number;
  readonly promptFine?: number;
  /** 去掉所有 refine：按规范根节点默认 REPLACE，子节点沿用父节点的 */
  readonly withoutRefine?: boolean;
}

// 去掉索引里所有的 refine 字段
function stripRefine(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripRefine);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'refine').map(([key, item]) => [key, stripRefine(item)]));
  }
  return value;
}

async function serveBlocks(
  path: string,
  { blockTexture = BLOCK_TEXTURE, fineTexture = FINE_TEXTURE, fineDelayMs = 0, promptFine = 3, withoutRefine = false }: BlockSizes = {}
): Promise<string> {
  const [block, fine] = await Promise.all([texturedBoxGlb(20, blockTexture), texturedBoxGlb(10, fineTexture)]);
  const tileset = blockTileset(MODEL_AT, GRID);
  onTestFinished(
    serveFixtures({
      [`/${path}/tileset.json`]: withoutRefine ? stripRefine(tileset) : tileset,
      [`/${path}/block.glb`]: block,
      [`/${path}/fine.glb`]: fine
    })
  );
  if (fineDelayMs > 0) {
    const served = window.fetch;
    let fineRequests = 0;
    window.fetch = async (input, init) => {
      if (String(input instanceof Request ? input.url : input).endsWith(`/${path}/fine.glb`)) {
        fineRequests++;
        if (fineRequests > promptFine) {
          await new Promise(resolve => setTimeout(resolve, fineDelayMs));
        }
      }
      return served(input, init);
    };
    onTestFinished(() => {
      window.fetch = served;
    });
  }
  return `${FIXTURE_ORIGIN}/${path}/tileset.json`;
}

// 网格按屏幕误差上限 16 设计（见 GRID 的注释），不跟着引擎的默认值变
const GRID_SCREEN_ERROR = { maximumScreenSpaceError: 16 };

function showBlocks(ctx: Context, url: string, screenError: Pick<TilesetLayer, 'maximumScreenSpaceError'> = GRID_SCREEN_ERROR): void {
  ctx.session.scene.set({
    tilesets: [{ id: 'blocks', url, show: true, lighting: 'sun', attempt: 0, ...screenError }],
    underground: null
  });
}

const inspect = (ctx: Context): ThreeSceneInspection => ctx.renderer.inspect();

async function settle(ctx: Context): Promise<ThreeSceneInspection> {
  await until(() => ctx.view.sceneStatus?.get('blocks')?.state === 'ready', '瓦片集就绪');
  await until(() => {
    const state = inspect(ctx);
    return state.frames > 0 && state.settled && (state.tilesets.blocks?.visible ?? 0) > 0;
  }, '瓦片都到了、放宽的倍数不再变');
  return inspect(ctx);
}

describe('ThreeSceneRenderer 的缓存预算', () => {
  it('放得下时不放宽', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB });
    showBlocks(ctx, await serveBlocks('fits'));
    const state = await settle(ctx);
    expect(state.errorScale).toBe(1);
    expect(state.refused).toBe(0);
    // 细的一层全到了：4 × 4 × 4 块，都够细
    expect(state.tilesets.blocks?.visible).toBe(64);
    expect(state.tilesets.blocks?.detail).toEqual({ sharp: 64, relaxed: 0, waiting: 0, finest: 0, additive: 0 });
    // 每一层的实际大小：粗的 16 块、细的 64 块，细的一块的贴图是粗的 64 倍
    const [block, fine] = state.tilesets.blocks?.levels ?? [];
    expect([block?.loads, fine?.loads]).toEqual([16, 64]);
    expect(required(fine, '细的一层').averageBytes).toBeGreaterThan(required(block, '粗的一层').averageBytes * 10);
  });

  it('索引里没写 refine：没有内容的根节点改成 ADD 前先把 REPLACE 传给子节点，瓦片照样按细不细分', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB });
    showBlocks(ctx, await serveBlocks('no-refine', { withoutRefine: true }));
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    expect(state.tilesets.blocks?.detail).toEqual({ sharp: 64, relaxed: 0, waiting: 0, finest: 0, additive: 0 });
  });

  it('屏幕误差上限不写用 8，写了用它；改了只更新、不重新加载', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB });
    const url = await serveBlocks('screen-error');
    showBlocks(ctx, url, {});
    const fine = await settle(ctx);
    expect(fine.tilesets.blocks?.errorTarget).toBe(8);
    expect(fine.tilesets.blocks?.visible).toBe(64);

    // 粗的一层约 31 像素：上限 40 时细的一层不要了
    showBlocks(ctx, url, { maximumScreenSpaceError: 40 });
    await within(() => inspect(ctx).tilesets.blocks?.visible === 16, 10000);
    const coarse = inspect(ctx);
    expect(coarse.tilesets.blocks?.errorTarget).toBe(40);
    expect(coarse.tilesets.blocks?.visible).toBe(16);
    expect(coarse.tilesets.blocks?.loaded).toBe(fine.tilesets.blocks?.loaded);
  });

  it('一整层放不下：放宽到那一层丢掉，不拒绝，之后不再加载回来', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(BLOCK_LEVEL_FITS);
    showBlocks(ctx, await serveBlocks('cliff'));
    const state = await settle(ctx);
    expect(state.refused).toBe(0);
    expect(state.locked).toBe(true);
    expect(state.errorScale).toBeGreaterThan(1.5);
    // 粗的一层都显示着：约 31 像素，超过上限 16，是放宽了才停在这一级
    expect(state.tilesets.blocks?.visible).toBe(16);
    expect(state.tilesets.blocks?.detail).toEqual({ sharp: 0, relaxed: 16, waiting: 0, finest: 0, additive: 0 });
    expect(state.pinnedBytes).toBeLessThanOrEqual(BLOCK_LEVEL_FITS.cacheLimitBytes);
    // 同一个姿态再等一会：倍数、加载和卸载的次数都不再变，也不再画（按需渲染停得下来）
    await seconds(3);
    const later = inspect(ctx);
    expect(later.errorScale).toBe(state.errorScale);
    expect(later.tilesets.blocks?.loaded).toBe(state.tilesets.blocks?.loaded);
    expect(later.tilesets.blocks?.unloaded).toBe(state.tilesets.blocks?.unloaded);
    expect(later.frames - state.frames).toBeLessThanOrEqual(2);
  });

  it('已经不要、但还在下载的瓦片不算需求：放宽到够了就停，不等它们下载完', { timeout: TEST_TIMEOUT }, async () => {
    // 粗的一层约 1.4 MB。前 3 块细的到了就知道细的一层放不下，开始放宽；其余 22 块还在路上、约 1.9 MB，
    // 算上它们的话需求一直超过上限，这 1.5 秒里一直放宽（60 帧时一秒 18 倍）
    const ctx = await setup({ cacheBytes: 1700 * KB, cacheLimitBytes: 2000 * KB });
    showBlocks(ctx, await serveBlocks('slow', { blockTexture: 128, fineTexture: 128, fineDelayMs: 1500 }));
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(16);
    // 粗的一层的屏幕误差约 31，目标 16：放宽到 2 倍就够了
    expect(state.errorScale).toBeLessThan(3);
  });

  it('粗的一层也放不下：照样画出放得下的，不会放宽到整棵树不画', { timeout: TEST_TIMEOUT }, async () => {
    // 根节点没有内容，几何误差和粗的一层一样：放宽超过它时，停在根节点的话什么也不画
    const ctx = await setup({ cacheBytes: 15 * KB, cacheLimitBytes: 25 * KB });
    showBlocks(ctx, await serveBlocks('too-small'));
    await until(() => inspect(ctx).errorScale > 2 && inspect(ctx).settled, '放宽到超过根节点、不再变');
    const state = inspect(ctx);
    expect(state.saturated).toBe(true);
    expect(state.tilesets.blocks?.visible).toBeGreaterThan(0);
    // 不一直涨
    expect(state.errorScale).toBeLessThan(32);
    await seconds(2);
    expect(inspect(ctx).frames - state.frames).toBeLessThanOrEqual(2);
  });

  it('相机离开以后收紧：近处放得下细的一层时加载回来', { timeout: TEST_TIMEOUT }, async () => {
    // 全部的细层（约 22 MB）放不下；靠近后视野里约 5 块的细层（约 7 MB）放得下
    const ctx = await setup({ cacheBytes: 8 * 1024 * KB, cacheLimitBytes: 10 * 1024 * KB });
    showBlocks(ctx, await serveBlocks('closer'));
    const far = await settle(ctx);
    expect(far.locked).toBe(true);
    expect(far.errorScale).toBeGreaterThan(1);
    ctx.view.flyTo({ center: [MODEL_AT[0] + 0.0003, MODEL_AT[1] + 0.0003], zoom: 19.5 }, { duration: 0 });
    await until(() => inspect(ctx).errorScale === 1, '放宽的倍数收回到 1');
    const near = await settle(ctx);
    expect(near.refused).toBe(0);
    expect(near.locked).toBe(false);
    // 显示的是细的一层：比远处整层的块多
    expect(near.tilesets.blocks?.loaded).toBeGreaterThan(far.tilesets.blocks?.loaded ?? 0);
  });

  it('隐藏的瓦片集不占着共用的缓存', { timeout: TEST_TIMEOUT }, async () => {
    // 细的一层换成 64×64（共约 1.45 MB）：一个瓦片集刚好放得下、两个放不下。隐藏后不解除"在用"的话，第二个要放宽
    const ctx = await setup({ cacheBytes: 1200 * KB, cacheLimitBytes: 1600 * KB });
    showBlocks(ctx, await serveBlocks('first', { fineTexture: 64 }));
    const first = await settle(ctx);
    expect(first.errorScale).toBe(1);
    expect(first.tilesets.blocks?.visible).toBe(64);
    const secondUrl = await serveBlocks('second', { fineTexture: 64 });
    const firstUrl = `${FIXTURE_ORIGIN}/first/tileset.json`;
    ctx.session.scene.set({
      tilesets: [
        { id: 'blocks', url: firstUrl, show: false, lighting: 'sun', attempt: 0, ...GRID_SCREEN_ERROR },
        { id: 'other', url: secondUrl, show: true, lighting: 'sun', attempt: 0, ...GRID_SCREEN_ERROR }
      ],
      underground: null
    });
    await until(() => (inspect(ctx).tilesets.other?.loaded ?? 0) > 0 && inspect(ctx).settled, '第二个瓦片集的瓦片到了、不再变');
    const state = inspect(ctx);
    expect(state.refused).toBe(0);
    expect(state.errorScale).toBe(1);
    expect(state.tilesets.other?.visible).toBe(64);
    // 第一个瓦片集的瓦片被淘汰了，给第二个让出地方
    expect(state.tilesets.blocks?.unloaded).toBeGreaterThan(0);
  });

  it('重新请求淘汰过的瓦片：需求不把它们算两遍', { timeout: TEST_TIMEOUT }, async () => {
    // 同上，第一个瓦片集的瓦片被第二个挤掉，换回来时重新请求，细的除了前 3 块都晚 1.5 秒到。
    // 库在排队时就把它们原来的字节记进缓存（算在在用的里），还要加载的估计不能再加一遍。
    // 第二个瓦片集用同一份数据：它只是要挤掉第一个的瓦片（假文件一次只能有一组）
    const ctx = await setup({ cacheBytes: 1200 * KB, cacheLimitBytes: 1600 * KB });
    const url = await serveBlocks('requeued', { fineTexture: 64, fineDelayMs: 1500 });
    const showFirst = (first: boolean) => {
      ctx.session.scene.set({
        tilesets: [
          { id: 'blocks', url, show: first, lighting: 'sun', attempt: 0, ...GRID_SCREEN_ERROR },
          { id: 'other', url, show: !first, lighting: 'sun', attempt: 0, ...GRID_SCREEN_ERROR }
        ],
        underground: null
      });
    };
    showBlocks(ctx, url);
    const first = await settle(ctx);
    expect(first.errorScale).toBe(1);
    showFirst(false);
    await until(() => {
      const state = inspect(ctx);
      return state.settled && state.tilesets.other?.visible === 64 && (state.tilesets.blocks?.unloaded ?? 0) > 0;
    }, '第一个瓦片集的瓦片被挤掉');
    showFirst(true);
    let peak = 0;
    await until(() => {
      const state = inspect(ctx);
      peak = Math.max(peak, state.demandBytes);
      return state.settled && (state.tilesets.blocks?.visible ?? 0) > 0;
    }, '第一个瓦片集重新加载完');
    const state = inspect(ctx);
    expect(peak).toBeLessThan(first.pinnedBytes * 1.25);
    expect(state.errorScale).toBe(1);
    expect(state.tilesets.blocks?.visible).toBe(64);
  });

  it('第一次加载时细的一层还没有样本：不按粗的一层的大小估计，放得下就不放宽', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(UNSAMPLED_FITS);
    showBlocks(ctx, await serveBlocks('unsampled', UNSAMPLED_SIZES));
    const state = await settle(ctx);
    expect(state.raisedPredicted).toBe(0);
    expect(state.errorScale).toBe(1);
    expect(state.tilesets.blocks?.visible).toBe(64);
  });

  it('放大到还没有样本的一层：同样不按粗的一层估计', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(UNSAMPLED_FITS, { ...CAMERA, zoom: 15 });
    showBlocks(ctx, await serveBlocks('zoom-in', UNSAMPLED_SIZES));
    const far = await settle(ctx);
    expect(far.tilesets.blocks?.visible).toBe(16);
    ctx.view.flyTo({ center: MODEL_AT, zoom: 17 }, { duration: 0 });
    await until(() => {
      const state = inspect(ctx);
      return state.raisedPredicted > 0 || (state.settled && state.tilesets.blocks?.visible === 64);
    }, '放宽了或者细的一层到齐');
    const state = inspect(ctx);
    expect(state.raisedPredicted).toBe(0);
    expect(state.errorScale).toBe(1);
  });
});

// 粗的一块 256×256（约 340 KB），细的一块 32×32（约 6 KB）：两层共约 6 MB，放得下。细的都晚 1 秒到，这期间
// 只有粗的一层有样本，按它估计的话细的 64 块约 22 MB，加上粗的超过上限的 2 倍
const UNSAMPLED_SIZES: BlockSizes = { blockTexture: 256, fineTexture: 32, fineDelayMs: 1000, promptFine: 0 };
const UNSAMPLED_FITS = { cacheBytes: 8 * 1024 * KB, cacheLimitBytes: 10 * 1024 * KB };

// 在 ms 毫秒内等到条件：等不到时返回 false，由断言报告，不是用例超时
async function within(accept: () => boolean, ms: number): Promise<boolean> {
  try {
    await Promise.race([
      until(accept, '条件'),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), ms);
      })
    ]);
    return true;
  } catch {
    return false;
  }
}

// 记下对某个地址的请求次数
function countRequests(suffix: string): () => number {
  const served = window.fetch;
  let count = 0;
  window.fetch = async (input, init) => {
    if (String(input instanceof Request ? input.url : input).endsWith(suffix)) {
      count++;
    }
    return served(input, init);
  };
  onTestFinished(() => {
    window.fetch = served;
  });
  return () => count;
}

const METERS_PER_DEGREE = 111320;
const degreesEast = (meters: number) => meters / (METERS_PER_DEGREE * Math.cos((MODEL_AT[1] * Math.PI) / 180));

// 相机每帧按时间走，返回停下的函数：路线是离开模型中心的偏移（米）。一定在下一帧才开始
function moveCamera(ctx: Context, zoom: number, path: (seconds: number) => readonly [number, number]): () => void {
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const [east, north] = path((performance.now() - start) / 1000);
    ctx.view.flyTo({ center: [MODEL_AT[0] + degreesEast(east), MODEL_AT[1] + north / METERS_PER_DEGREE], zoom }, { duration: 0 });
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  const stop = () => cancelAnimationFrame(frame);
  onTestFinished(stop);
  return stop;
}

// 绕模型中心转圈：细的瓦片直径约 37 米，粗的约 71 米。不走回头路，帧慢时算出的速度也不变小
const CIRCLE_METERS = 40;
const circle = (speed: number) => (time: number) => {
  const angle = (speed * time) / CIRCLE_METERS;
  return [CIRCLE_METERS * Math.cos(angle), CIRCLE_METERS * Math.sin(angle)] as const;
};
// z15 俯视：粗的一层够了，只有它们；z17 要细的一层
const FAR_CAMERA: CameraState = { ...CAMERA, zoom: 15 };
const ROOMY = { cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB };

describe('ThreeSceneRenderer 动着的时候不请求', () => {
  it('相机比瓦片走得快时不请求这块瓦片；停下以后不用别的帧也会请求', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('moving'));
    const far = await settle(ctx);
    expect(far.tilesets.blocks?.visible).toBe(16);
    const fineRequests = countRequests('/moving/fine.glb');
    const stop = moveCamera(ctx, 17, circle(100));
    expect(await within(() => (inspect(ctx).tilesets.blocks?.culled ?? 0) > 0, 30000)).toBe(true);
    await seconds(2);
    const moving = inspect(ctx);
    expect(fineRequests()).toBe(0);
    expect(moving.tilesets.blocks?.culled).toBeGreaterThan(0);
    // 已经到了的照样显示：没放宽，粗的一层是在等细的
    expect(moving.tilesets.blocks?.visible).toBeGreaterThan(0);
    expect(moving.errorScale).toBe(1);
    expect(moving.tilesets.blocks?.detail.waiting).toBeGreaterThan(0);
    expect(moving.tilesets.blocks?.detail.relaxed).toBe(0);
    expect(moving.settled).toBe(false);
    stop();
    expect(await within(() => inspect(ctx).settled, 30000)).toBe(true);
    expect(inspect(ctx).tilesets.blocks?.visible).toBe(64);
    expect(fineRequests()).toBeGreaterThan(0);
    expect(inspect(ctx).tilesets.blocks?.culled).toBe(0);
  });

  it('比瓦片走得慢时照样请求', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('slowly'));
    await settle(ctx);
    const fineRequests = countRequests('/slowly/fine.glb');
    moveCamera(ctx, 17, circle(10));
    expect(await within(() => fineRequests() > 0, 30000)).toBe(true);
  });

  it('窗口短时，同样的速度也请求（对照）', { timeout: TEST_TIMEOUT }, async () => {
    // 100 米/秒，0.2 秒走 20 米，比细的瓦片（约 37 米）短
    const ctx = await setup({ ...ROOMY, requestCullWindow: 0.2 }, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('short-window'));
    await settle(ctx);
    const fineRequests = countRequests('/short-window/fine.glb');
    moveCamera(ctx, 17, circle(100));
    expect(await within(() => fineRequests() > 0, 30000)).toBe(true);
  });

  it('关掉时动着也请求（对照）', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ ...ROOMY, requestCullWindow: null }, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('always'));
    await settle(ctx);
    const fineRequests = countRequests('/always/fine.glb');
    moveCamera(ctx, 17, circle(100));
    expect(await within(() => fineRequests() > 0, 30000)).toBe(true);
    expect(inspect(ctx).tilesets.blocks?.culled).toBe(0);
  });

  it('窗口按动着时请求的瓦片实测：本机加载快，窗口缩短；停着时加载的不算', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('measured-fast'));
    const far = await settle(ctx);
    expect(far.tilesets.blocks?.cullWindow).toBe(1);
    // 20 米/秒，按开始的 1 秒走 20 米，比细的瓦片（约 37 米）短：动着也请求，到了就是样本
    moveCamera(ctx, 17, circle(20));
    expect(await within(() => (inspect(ctx).tilesets.blocks?.cullWindow ?? 1) < 0.5, 30000)).toBe(true);
  });

  it('加载慢时窗口跟着变长', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('measured-slow', { fineDelayMs: 1500 }));
    await settle(ctx);
    moveCamera(ctx, 17, circle(20));
    expect(await within(() => (inspect(ctx).tilesets.blocks?.cullWindow ?? 0) > 1.2, 30000)).toBe(true);
  });

  it('边飞边打开模型：一开始也不把看到的全请求了，停下才加载', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY, CAMERA);
    const url = await serveBlocks('flying-in');
    // 比粗的瓦片也快：一块都不请求
    const stop = moveCamera(ctx, 17, circle(200));
    await seconds(1);
    const blockRequests = countRequests('/flying-in/block.glb');
    let initial = 0;
    onTestFinished(
      ctx.renderer.on('tilesetinitial', () => {
        initial++;
      })
    );
    showBlocks(ctx, url);
    expect(await within(() => (inspect(ctx).tilesets.blocks?.culled ?? 0) > 0, 30000)).toBe(true);
    await seconds(1);
    expect(blockRequests()).toBe(0);
    expect(inspect(ctx).tilesets.blocks?.loaded).toBe(0);
    expect(inspect(ctx).settled).toBe(false);
    // 还有没请求的瓦片时不算首批瓦片到了：同组的白膜要等这个事件才撤下上一个
    expect(initial).toBe(0);
    stop();
    expect(await within(() => inspect(ctx).settled && (inspect(ctx).tilesets.blocks?.visible ?? 0) > 0, 30000)).toBe(true);
    expect(initial).toBe(1);
  });

  it('要的瓦片都到了时，动着也不算有没请求的：按需渲染停得下来', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY, FAR_CAMERA);
    showBlocks(ctx, await serveBlocks('all-here'));
    await settle(ctx);
    moveCamera(ctx, 15, circle(100));
    await seconds(1);
    expect(inspect(ctx).tilesets.blocks?.culled).toBe(0);
  });

  it('没请求的瓦片也算需求：放不下的一层不会因为动着就收紧过去', { timeout: TEST_TIMEOUT }, async () => {
    // 细的一层约 22 MB，放不下；这个上限下有 3 块细的到过，知道它们多大
    const ctx = await setup({ cacheBytes: 1200 * KB, cacheLimitBytes: 1600 * KB });
    showBlocks(ctx, await serveBlocks('demand'));
    const still = await settle(ctx);
    expect(still.errorScale).toBeGreaterThan(1.5);
    let lowest = still.errorScale;
    const watch = () => {
      lowest = Math.min(lowest, inspect(ctx).errorScale);
    };
    // 往东走，离开锁定的姿态（高度的四分之一，约 92 米）：解锁以后在用的只有粗的一层，需求远低于上限
    const stop = moveCamera(ctx, 17, time => [100 * time, 0]);
    await within(() => {
      watch();
      return false;
    }, 2500);
    stop();
    expect(inspect(ctx).locked).toBe(false);
    expect(lowest).toBeGreaterThan(1.5);
  });
});

const maxPerFrame = (ctx: Context, key: 'textures' | 'buffers') => Math.max(0, ...ctx.renderer.frames.map(frame => frame[key]));

describe('ThreeSceneRenderer 的上传预算', () => {
  it('提前按预算上传：一帧只传一步，第一次绘制时不再上传', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB, uploadBytesPerFrame: 1 });
    showBlocks(ctx, await serveBlocks('budget'));
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    expect(state.uploadPending).toBe(0);
    expect(state.uploadedBytes).toBeGreaterThan(64 * 256 * 256 * 4);
    // 一块瓦片一张贴图、一个网格（位置、法线、UV、索引四个缓冲，加上画画面本身的）
    expect(maxPerFrame(ctx, 'textures')).toBe(1);
    expect(maxPerFrame(ctx, 'buffers')).toBeLessThanOrEqual(8);
  });

  it('不提前上传时第一次绘制集中在一帧（对照）', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB, uploadBytesPerFrame: null });
    showBlocks(ctx, await serveBlocks('burst'));
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    expect(state.uploadedBytes).toBe(0);
    // 一组 4 块兄弟到齐才一起第一次绘制
    expect(maxPerFrame(ctx, 'textures')).toBeGreaterThanOrEqual(4);
    // 没提前传的贴图不释放：第一次绘制时要从内存里传，释放了就传上一张关掉的图（Three 吞掉错误，瓦片画成黑的）
    expect(state.releasedBytes).toBe(0);
    expect(ctx.renderer.closedUploads()).toBe(0);
  });

  it('撤下层时不卡住加载：切到二维再回来，瓦片照样到齐', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ cacheBytes: 64 * 1024 * KB, cacheLimitBytes: 96 * 1024 * KB, uploadBytesPerFrame: 1 });
    showBlocks(ctx, await serveBlocks('detach'));
    await until(() => inspect(ctx).uploadPending > 0, '有瓦片等待上传');
    ctx.view.setKind('2d');
    expect(inspect(ctx).uploadPending).toBe(0);
    ctx.view.setKind('3d');
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    // 撤下期间放行的瓦片没提前传：不释放，挂回来以后照样画出贴图
    expect(ctx.renderer.closedUploads()).toBe(0);
  });
});

// 画布上亮的像素数：贴图是白的、底色是黑的，贴图坏了（上传不了）时画成黑的
function brightPixels(canvas: HTMLCanvasElement): number {
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if ((data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0) > 300) {
      count++;
    }
  }
  return count;
}

// 等事件，等不到时以说明失败
async function event(target: EventTarget, type: string, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>(resolve => target.addEventListener(type, () => resolve(), { once: true })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loseAndRestoreContext(canvas: HTMLCanvasElement): Promise<void> {
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  const lose = required(gl.getExtension('WEBGL_lose_context'), 'WEBGL_lose_context 扩展');
  const lost = event(canvas, 'webglcontextlost', 'GL 上下文丢失');
  lose.loseContext();
  await lost;
  const restored = event(canvas, 'webglcontextrestored', 'GL 上下文恢复');
  // 在派发丢失事件的同一个任务里调用 restoreContext，Chromium 不恢复（three-scene-renderer.browser.test.ts）
  await new Promise(resolve => setTimeout(resolve, 0));
  lose.restoreContext();
  await restored;
}

describe('ThreeSceneRenderer 上传后释放贴图（ADR 0155 第 5 节）', () => {
  const fineTextures = 64 * FINE_TEXTURE * FINE_TEXTURE * 4;

  it('瓦片记完字节以后才释放内存里的贴图：缓存和上传预算照样按贴图算，画面照常', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY);
    showBlocks(ctx, await serveBlocks('released'));
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    // 释放以后贴图的宽高是 0：先释放再记账的话，缓存和上传预算只剩几何体
    expect(state.cachedBytes).toBeGreaterThan(fineTextures);
    expect(state.uploadedBytes).toBeGreaterThan(fineTextures);
    // 细的 64 块的贴图都释放了
    expect(state.releasedBytes).toBeGreaterThanOrEqual(fineTextures);
    expect(brightPixels(ctx.canvas)).toBeGreaterThan(1000);
    expect(ctx.errors).toEqual([]);
  });

  it('不释放时（测量工具的对照）：内存里的贴图留着', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ ...ROOMY, releaseImages: false });
    showBlocks(ctx, await serveBlocks('kept'));
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    expect(state.releasedBytes).toBe(0);
    expect(state.cachedBytes).toBeGreaterThan(fineTextures);
  });

  it('上传做到一半时丢上下文：恢复以后没有传关掉的贴图，瓦片照样到齐', { timeout: TEST_TIMEOUT }, async () => {
    // 一帧只传一步：一块瓦片先传贴图、下一帧传几何体，刚传完贴图的那一帧丢上下文。丢失事件是异步派发的，
    // 浏览器里这块瓦片多半在事件之前就在丢掉的上下文里传完了；"传进丢掉的上下文的不释放"由 tile-uploader.test.ts 管
    const ctx = await setup({ ...ROOMY, uploadBytesPerFrame: 1 });
    showBlocks(ctx, await serveBlocks('half-uploaded'));
    await until(() => (ctx.renderer.frames.at(-1)?.textures ?? 0) > 0 && inspect(ctx).uploadPending > 0, '刚传完一张贴图、还有等着的');
    await loseAndRestoreContext(ctx.canvas);
    const state = await settle(ctx);
    expect(state.tilesets.blocks?.visible).toBe(64);
    expect(ctx.renderer.closedUploads()).toBe(0);
    expect(ctx.errors).toEqual([]);
  });

  it('释放过贴图的瓦片：上下文丢了、恢复以后重新下载，照样画出贴图', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(ROOMY);
    showBlocks(ctx, await serveBlocks('restored'));
    const before = await settle(ctx);
    expect(before.releasedBytes).toBeGreaterThanOrEqual(fineTextures);
    const bright = brightPixels(ctx.canvas);
    expect(bright).toBeGreaterThan(1000);
    const fineRequests = countRequests('/restored/fine.glb');
    await loseAndRestoreContext(ctx.canvas);
    // 恢复以后画过几帧、瓦片都到了、不再变
    await until(() => {
      const state = inspect(ctx);
      return state.frames > before.frames + 2 && state.settled && state.tilesets.blocks?.visible === 64;
    }, '恢复后画出细的一层');
    expect(fineRequests()).toBeGreaterThanOrEqual(64);
    expect(brightPixels(ctx.canvas)).toBeGreaterThan(bright * 0.8);
    expect(ctx.errors).toEqual([]);
  });
});

// 测试用的预算来源：记下问过的显卡名字、挂上撤下，丢上下文时改成 lower
function budgetSource(budget: SceneBudget, lower: SceneBudget) {
  const listeners = new Set<(next: SceneBudget) => void>();
  const source = {
    renderers: [] as string[],
    shownCalls: [] as boolean[],
    lost: 0,
    get subscribers(): number {
      return listeners.size;
    },
    resolve(renderer: string): SceneBudget {
      source.renderers.push(renderer);
      return budget;
    },
    subscribe(listener: (next: SceneBudget) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    contextLost(): void {
      source.lost++;
      source.change(lower);
    },
    shown(shown: boolean): void {
      source.shownCalls.push(shown);
    },
    change(next: SceneBudget): void {
      for (const listener of listeners) {
        listener(next);
      }
    }
  };
  return source;
}

const budgetOf = ({ cacheBytes, cacheLimitBytes }: { cacheBytes: number; cacheLimitBytes: number }): SceneBudget => ({
  cacheBytes,
  cacheLimitBytes,
  uploadBytesPerFrame: 16 * 1024 * KB,
  splatBudget: 3_000_000
});

describe('ThreeSceneRenderer 的预算来源（ADR 0155）', () => {
  it('第一次挂上时按显卡的名字定预算；切二维、切回来时告诉它撤下、挂上，不再问', { timeout: TEST_TIMEOUT }, async () => {
    const source = budgetSource(budgetOf(ROOMY), budgetOf(BLOCK_LEVEL_FITS));
    const ctx = await setup({ budgetSource: source });
    expect(source.renderers).toHaveLength(1);
    // 软件渲染时是 SwiftShader 的名字：只要是显卡报的字符串
    expect(source.renderers[0]).toMatch(/\S/);
    // 读的是瓦片库 LRU 本身的设置：构造参数没给，产品就靠第一次挂上时的预算
    expect(inspect(ctx).cacheBytes).toBe(ROOMY.cacheBytes);
    expect(inspect(ctx).cacheLimitBytes).toBe(ROOMY.cacheLimitBytes);
    expect(source.shownCalls).toEqual([true]);
    ctx.view.setKind('2d');
    ctx.view.setKind('3d');
    await ctx.view.whenReady();
    expect(source.shownCalls).toEqual([true, false, true]);
    expect(source.renderers).toHaveLength(1);
  });

  it('调小预算：放不下的一层放宽丢掉，缓存回到新的上限以内', { timeout: TEST_TIMEOUT }, async () => {
    const source = budgetSource(budgetOf(ROOMY), budgetOf(BLOCK_LEVEL_FITS));
    const ctx = await setup({ budgetSource: source });
    showBlocks(ctx, await serveBlocks('lowered'));
    const roomy = await settle(ctx);
    expect(roomy.tilesets.blocks?.visible).toBe(64);
    expect(roomy.errorScale).toBe(1);
    // 细的一块（一张 256×256 的贴图带 mipmap 和几何体）：细的一层占了缓存的绝大部分
    const fineTile = roomy.cachedBytes / 64;
    source.change(budgetOf(BLOCK_LEVEL_FITS));
    await within(() => {
      const state = inspect(ctx);
      return state.settled && state.tilesets.blocks?.visible === 16 && state.cachedBytes < roomy.cachedBytes / 10;
    }, 30000);
    const lowered = inspect(ctx);
    expect(lowered.cacheLimitBytes).toBe(BLOCK_LEVEL_FITS.cacheLimitBytes);
    expect(lowered.errorScale).toBeGreaterThan(1.5);
    expect(lowered.tilesets.blocks?.visible).toBe(16);
    expect(lowered.pinnedBytes).toBeLessThanOrEqual(BLOCK_LEVEL_FITS.cacheLimitBytes);
    // 瓦片库真的淘汰了：缓存里的字节回到新的上限加一块细瓦片以内
    expect(lowered.cachedBytes).toBeLessThan(roomy.cachedBytes / 10);
    expect(lowered.cachedBytes).toBeLessThanOrEqual(BLOCK_LEVEL_FITS.cacheLimitBytes + fineTile);
  });

  it('丢上下文：预算来源降一档，恢复以后按降了的预算', { timeout: TEST_TIMEOUT }, async () => {
    const source = budgetSource(budgetOf(ROOMY), budgetOf(BLOCK_LEVEL_FITS));
    const ctx = await setup({ budgetSource: source });
    showBlocks(ctx, await serveBlocks('downgraded'));
    const before = await settle(ctx);
    expect(before.tilesets.blocks?.visible).toBe(64);
    await loseAndRestoreContext(ctx.canvas);
    expect(source.lost).toBe(1);
    await within(() => {
      const state = inspect(ctx);
      return state.frames > before.frames + 2 && state.settled && state.tilesets.blocks?.visible === 16;
    }, 30000);
    expect(inspect(ctx).cacheLimitBytes).toBe(BLOCK_LEVEL_FITS.cacheLimitBytes);
    expect(inspect(ctx).tilesets.blocks?.visible).toBe(16);
    // 恢复以后不再按显卡重新定
    expect(source.renderers).toHaveLength(1);
  });

  // 离开地图页时 map.remove() 不调用自定义层的 onRemove，detach 到不了：撤下标记、退订只靠释放渲染器
  it('视图释放（离开地图页）时告诉预算来源撤下，并退订', { timeout: TEST_TIMEOUT }, async () => {
    const source = budgetSource(budgetOf(ROOMY), budgetOf(BLOCK_LEVEL_FITS));
    const ctx = await setup({ budgetSource: source });
    expect(source.shownCalls).toEqual([true]);
    expect(source.subscribers).toBe(1);

    ctx.view[Symbol.dispose]();

    expect(source.shownCalls).toEqual([true, false]);
    expect(source.subscribers).toBe(0);
  });
});
