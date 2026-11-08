import { type CameraState, type LngLat, MapLibreView, MapSession, type SceneFrame } from '@mx/map-core';
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

// 记下每一帧 render 里的上传次数：贴图、缓冲。只算 render 里的：MapLibre 自己的上传不在这里
class RecordingRenderer extends ThreeSceneRenderer {
  readonly frames: { textures: number; buffers: number }[] = [];
  readonly #textures = [
    vi.spyOn(WebGL2RenderingContext.prototype, 'texSubImage2D'),
    vi.spyOn(WebGL2RenderingContext.prototype, 'texImage2D')
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
  const view = new MapLibreView({
    session,
    container,
    mapOptions: { maxZoom: 24, maxPitch: 85, centerClampedToGround: false, canvasContextAttributes: { antialias: false } },
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
    get renderer(): RecordingRenderer {
      return required(renderer, '三维渲染器');
    }
  };
}

type Context = Awaited<ReturnType<typeof setup>>;

interface BlockSizes {
  readonly blockTexture?: number;
  readonly fineTexture?: number;
  /** 细的瓦片除了前 3 块，都晚这么久才下载完 */
  readonly fineDelayMs?: number;
}

async function serveBlocks(
  path: string,
  { blockTexture = BLOCK_TEXTURE, fineTexture = FINE_TEXTURE, fineDelayMs = 0 }: BlockSizes = {}
): Promise<string> {
  const [block, fine] = await Promise.all([texturedBoxGlb(20, blockTexture), texturedBoxGlb(10, fineTexture)]);
  onTestFinished(
    serveFixtures({
      [`/${path}/tileset.json`]: blockTileset(MODEL_AT, GRID),
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
        if (fineRequests > 3) {
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

function showBlocks(ctx: Context, url: string): void {
  ctx.session.scene.set({
    tilesets: [{ id: 'blocks', url, show: true, lighting: 'sun', attempt: 0 }],
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
    // 细的一层全到了：4 × 4 × 4 块
    expect(state.tilesets.blocks?.visible).toBe(64);
  });

  it('一整层放不下：放宽到那一层丢掉，不拒绝，之后不再加载回来', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup(BLOCK_LEVEL_FITS);
    showBlocks(ctx, await serveBlocks('cliff'));
    const state = await settle(ctx);
    expect(state.refused).toBe(0);
    expect(state.locked).toBe(true);
    expect(state.errorScale).toBeGreaterThan(1.5);
    // 粗的一层都显示着
    expect(state.tilesets.blocks?.visible).toBe(16);
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
        { id: 'blocks', url: firstUrl, show: false, lighting: 'sun', attempt: 0 },
        { id: 'other', url: secondUrl, show: true, lighting: 'sun', attempt: 0 }
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
  });
});
