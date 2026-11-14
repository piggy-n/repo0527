import {
  type CameraState,
  type LngLat,
  MapLibreView,
  MapSession,
  type ScreenPoint,
  type SplatLayer,
  type TilesetLayer
} from '@mx/map-core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { boxGlb, boxTileset, FIXTURE_ORIGIN, serveFixtures } from './testing/fixtures';
import { watchGl } from './gl-watch';
import { writeSplatSquare } from './testing/lcc2-fixture';
import { required } from './testing/required';
import { ThreeSceneRenderer } from './three-scene-renderer';

// LCC2 高斯泼溅（ADR 0149 L.1 的验收）：真实的 MapLibre、Three 和 gaussian-splat-lite。数据在内存里生成
// （一个 60 米见方、绿色的扁平高斯铺成的正方形），库在 Worker 里下载数据块，所以写到磁盘上由开发服务器提供；
// 目录名是中文，地址按 URL 编码，同楚王山1号

const MODEL_AT: LngLat = [117.06, 34.27];
// 正方形所在的椭球高：拾取的高度要等于它
const GROUND = 30;
const TEST_TIMEOUT = 60000;
const WAIT_TIMEOUT = 45000;
const WIDTH = 640;
const HEIGHT = 480;
const MIDDLE: ScreenPoint = { x: WIDTH / 2, y: HEIGHT / 2 };
// 俯视 z18（512 像素的瓦片）：约 0.25 米一个像素，正方形占画布中间约 240 像素；高斯的软边再往外约 5 米
const ABOVE: CameraState = { center: MODEL_AT, zoom: 18, bearing: 0, pitch: 0 };

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

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function pixel(canvas: HTMLCanvasElement, { x, y }: ScreenPoint): [number, number, number] {
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), canvas.height - Math.round(y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

const isGreen = ([r, g, b]: readonly number[]) => g > 60 && g > r * 2 && g > b * 2;
const isRed = ([r, g, b]: readonly number[]) => r > 60 && r > g * 2 && r > b * 2;

// 渲染器的 render 包一层：GL 监听据此区分渲染回调里外
async function setup(camera: CameraState = ABOVE) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px`;
  const session = new MapSession({ groups: ['basemap'], camera });
  session.style.setGroup('basemap', {
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }]
  });
  const errors: unknown[] = [];
  let renderer: ThreeSceneRenderer | undefined;
  let rendering = false;
  const view = new MapLibreView({
    session,
    container,
    onError: error => errors.push(error),
    mapOptions: {
      maxZoom: 24,
      maxPitch: 85,
      centerClampedToGround: false,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false }
    },
    loadSceneRenderer: async () => () => {
      const created = new ThreeSceneRenderer({ splatBudget: 50_000 });
      const render = created.render.bind(created);
      created.render = frame => {
        rendering = true;
        try {
          render(frame);
        } finally {
          rendering = false;
        }
      };
      renderer = created;
      return created;
    }
  });
  onTestFinished(() => {
    view[Symbol.dispose]();
    session[Symbol.dispose]();
    container.remove();
  });
  await view.whenReady();
  view.setKind('3d');
  await view.whenReady();
  const canvas = required(container.querySelector('canvas'), '地图画布');
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  return {
    session,
    view,
    errors,
    canvas,
    gl,
    rendering: () => rendering,
    get renderer(): ThreeSceneRenderer {
      return required(renderer, '三维渲染器');
    }
  };
}

type Context = Awaited<ReturnType<typeof setup>>;

// 每个文件写一份，用例之间共用；tall 的索引包围盒顶到 20 米（倾斜模型的裁剪用，ADR 0149）
let url = '';
let tallUrl = '';
const square = (extra: Partial<SplatLayer> = {}): SplatLayer => ({
  id: 'square',
  url,
  show: true,
  placement: { lng: MODEL_AT[0], lat: MODEL_AT[1], height: GROUND, heading: 0 },
  attempt: 0,
  ...extra
});

const pickedHeight = (ctx: Context, point: ScreenPoint = MIDDLE): number | null => {
  const result = ctx.view.pick(point);
  return result.kind === 'hit' && result.surface === 'model' ? (result.height ?? null) : null;
};

// 加上正方形，等到就绪、画出来（画布中心是绿色、拾取得到）
const facing = (heading: number) => square({ placement: { ...square().placement, heading } });

// 换摆放时会重新加载：等状态换过一次再看就绪，旧的就绪不算
async function addSquare(ctx: Context, layer: SplatLayer = square()): Promise<void> {
  const before = ctx.view.sceneStatus;
  ctx.session.scene.set({ tilesets: [], splats: [layer], underground: null });
  await until(() => ctx.view.sceneStatus !== before && ctx.view.sceneStatus.get('square')?.state === 'ready', '泼溅就绪');
  await until(() => pickedHeight(ctx) !== null, '拾取到泼溅');
}

// 立方体立在 0 米的地面上、顶在 2 × half 米；泼溅的正方形也在 0 米，索引的包围盒顶到 20 米，盒子盖住 16 米高的立方体
async function serveBox(half: number): Promise<TilesetLayer> {
  const glb = await boxGlb(half);
  onTestFinished(serveFixtures({ '/box/tileset.json': boxTileset(MODEL_AT, half), '/box/box.glb': glb }));
  return { id: 'box', url: `${FIXTURE_ORIGIN}/box/tileset.json`, show: true, lighting: 'sun', attempt: 0, clippedBySplats: true };
}

// 瓦片集就绪只是读到了根索引：等立方体的内容加载完、再画一帧
async function boxContentDrawn(ctx: Context): Promise<void> {
  await until(() => {
    const box = ctx.renderer.inspect().tilesets.box;
    return box !== undefined && box.loaded > 0 && box.downloading === 0 && box.parsing === 0;
  }, '立方体的内容加载完');
  await new Promise(resolve => requestAnimationFrame(resolve));
}

// 泼溅的数据块都到了、画过一帧
async function splatDrawn(ctx: Context): Promise<void> {
  await until(() => ctx.view.sceneStatus.get('square')?.state === 'ready', '泼溅就绪');
  await until(() => ctx.renderer.inspect().splats.square?.loadProgress === 1, '泼溅的数据块都到了');
  await new Promise(resolve => requestAnimationFrame(resolve));
}

// 先只有立方体：画出来、拾取得到顶面，才能说后面是裁掉的
async function boxFirst(ctx: Context, half = 8): Promise<TilesetLayer> {
  const box = await serveBox(half);
  ctx.session.scene.set({ tilesets: [box], underground: null });
  await boxContentDrawn(ctx);
  await until(() => isRed(pixel(ctx.canvas, MIDDLE)) && pickedHeight(ctx) !== null, '画出立方体');
  expect(pickedHeight(ctx)).toBeCloseTo(half * 2, 0);
  return box;
}

const tall = (extra: Partial<SplatLayer> = {}) =>
  square({ url: tallUrl, placement: { lng: MODEL_AT[0], lat: MODEL_AT[1], height: 0, heading: 0 }, ...extra });
const clipped = (ctx: Context) => ctx.renderer.inspect().tilesets.box?.clipped;

// 写下的夹具文件在整个文件跑完以后删掉：afterAll 要在收集用例时登记，运行中登记的 Vitest 不执行
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
});

describe('高斯泼溅（ADR 0149）', { timeout: TEST_TIMEOUT }, () => {
  beforeAll(async () => {
    const written = await Promise.all([
      writeSplatSquare('方块', { size: 60, count: 31, color: [0, 1, 0] }),
      writeSplatSquare('高方块', { size: 60, count: 31, color: [0, 1, 0], top: 20 })
    ]);
    [url, tallUrl] = written.map(item => item.url);
    cleanups.push(...written.map(({ cleanup }) => cleanup));
  });

  it('加载：就绪时带建议的相机，画出来，拾取到的高度是摆放的高度，拾取—投影往返小于 1 像素', async () => {
    const ctx = await setup();
    await addSquare(ctx);
    await until(() => isGreen(pixel(ctx.canvas, MIDDLE)), '画出绿色的正方形');

    const status = ctx.view.sceneStatus.get('square');
    expect(status?.state === 'ready' && status.camera.center[0]).toBeCloseTo(MODEL_AT[0], 5);
    expect(pickedHeight(ctx)).toBeCloseTo(GROUND, 0);
    const errors = [-60, 0, 60].map(dx => {
      const point = { x: MIDDLE.x + dx, y: MIDDLE.y + dx / 2 };
      const result = ctx.view.pick(point);
      if (result.kind !== 'hit' || result.surface !== 'model') {
        throw new Error(`没有拾取到 ${point.x}, ${point.y}`);
      }
      const back = required(ctx.view.project(result.lngLat, result.height ?? 0), '投影回画布的点');
      return Math.hypot(back.x - point.x, back.y - point.y);
    });
    expect(Math.max(...errors)).toBeLessThan(1);
    // 正方形外面拾取不到模型
    expect(pickedHeight(ctx, { x: 20, y: 20 })).toBeNull();
    const inspection = ctx.renderer.inspect().splats.square;
    expect(inspection?.visibleSplats).toBeGreaterThan(0);
    expect(inspection?.budget).toBe(50_000);
    expect(ctx.errors).toStrictEqual([]);
  });

  it('朝向：heading 是从正东逆时针转的角度', async () => {
    const ctx = await setup();
    // 东偏南 15°、40 米处：不转时离边 31 米（软边到 36 米）拾取不到；逆时针转 30° 后有一个角正对它（42 米），
    // 顺时针转 30° 时仍然拾取不到
    await addSquare(ctx, facing(0));
    // 不在地面上的点要画过一帧才能投影
    const metersPerLng = 111320 * Math.cos((MODEL_AT[1] * Math.PI) / 180);
    const probe = required(
      ctx.view.project([MODEL_AT[0] + 38.64 / metersPerLng, MODEL_AT[1] - 10.35 / 110950], GROUND),
      '东偏南 15° 的点'
    );
    expect(pickedHeight(ctx, probe)).toBeNull();
    await addSquare(ctx, facing(-30));
    expect(pickedHeight(ctx, probe)).toBeNull();

    ctx.session.scene.set({ tilesets: [], splats: [facing(30)], underground: null });
    await until(() => pickedHeight(ctx, probe) !== null, '逆时针转 30° 以后拾取到');
    expect(pickedHeight(ctx, probe)).toBeCloseTo(GROUND, 0);
  });

  it('隐藏时不画、拾取不到；移除后状态里不再有它，读数里也没有', async () => {
    const ctx = await setup();
    await addSquare(ctx);

    ctx.session.scene.set({ tilesets: [], splats: [square({ show: false })], underground: null });
    await until(() => pickedHeight(ctx) === null && !isGreen(pixel(ctx.canvas, MIDDLE)), '隐藏后不画');
    expect(ctx.view.sceneStatus.get('square')?.state).toBe('ready');

    ctx.session.scene.set({ tilesets: [], underground: null });
    await until(() => !ctx.view.sceneStatus.has('square'), '移除');
    expect(ctx.renderer.inspect().splats).toStrictEqual({});
  });

  it('读索引时换了摆放：上一份已中止、还没清理，新的一份照常加载，不报"已经加过"', async () => {
    const ctx = await setup();
    // 索引在主线程下载：扣住它，让上一份停在读索引上
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (target === url) {
        await gate;
      }
      return original(input, init);
    };
    onTestFinished(() => {
      window.fetch = original;
    });

    ctx.session.scene.set({ tilesets: [], splats: [facing(0)], underground: null });
    await until(() => ctx.renderer.inspect().splats.square !== undefined, '上一份开始读索引');
    ctx.session.scene.set({ tilesets: [], splats: [facing(30)], underground: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    release?.();
    await until(() => ['ready', 'failed'].includes(ctx.view.sceneStatus.get('square')?.state ?? ''), '加载结束');

    const status = ctx.view.sceneStatus.get('square');
    expect(status?.state === 'failed' ? String(status.error) : status?.state).toBe('ready');
    expect(Object.keys(ctx.renderer.inspect().splats)).toStrictEqual(['square']);
  });

  it('悬停的拾取跳过泼溅，打到后面的立方体；不写 hover 的照常打到泼溅（ADR 0149）', async () => {
    const ctx = await setup();
    const glb = await boxGlb(8);
    onTestFinished(serveFixtures({ '/box/tileset.json': boxTileset(MODEL_AT, 8), '/box/box.glb': glb }));
    const box: TilesetLayer = { id: 'box', url: `${FIXTURE_ORIGIN}/box/tileset.json`, show: true, lighting: 'sun', attempt: 0 };
    // 正方形在 30 米，立方体顶在 16 米：俯视时中心先打到泼溅，后面是立方体，旁边是地面
    ctx.session.scene.set({ tilesets: [box], splats: [square()], underground: null });
    await boxContentDrawn(ctx);
    await splatDrawn(ctx);
    const aside = { x: MIDDLE.x + 90, y: MIDDLE.y };
    const hover = (point: ScreenPoint) => ctx.view.pick(point, { hover: true });

    expect(pickedHeight(ctx)).toBeCloseTo(GROUND, 0);
    expect(hover(MIDDLE)).toMatchObject({ kind: 'hit', surface: 'model' });
    const behind = hover(MIDDLE);
    expect(behind.kind === 'hit' ? behind.height : null).toBeCloseTo(16, 0);
    expect(pickedHeight(ctx, aside)).toBeCloseTo(GROUND, 0);
    expect(hover(aside)).toMatchObject({ kind: 'hit', surface: 'map' });
  });

  it('索引不存在时进入 failed，换成在的地址以后就绪', async () => {
    const ctx = await setup();
    ctx.session.scene.set({ tilesets: [], splats: [square({ url: url.replace(/\.lcc2$/, '-missing.lcc2') })], underground: null });
    await until(() => ctx.view.sceneStatus.get('square')?.state === 'failed', '加载失败');

    const failed = ctx.view.sceneStatus.get('square');
    expect(failed?.state === 'failed' && String(failed.error)).toContain('404');

    ctx.session.scene.set({ tilesets: [], splats: [square({ attempt: 1 })], underground: null });
    await until(() => ctx.view.sceneStatus.get('square')?.state === 'ready', '重试后就绪');
    expect(ctx.errors).toStrictEqual([]);
  });

  it('和瓦片集一起画：不透明的立方体挡住后面的泼溅，拾取到的是立方体', async () => {
    const ctx = await setup();
    const glb = await boxGlb(8);
    onTestFinished(serveFixtures({ '/box/tileset.json': boxTileset(MODEL_AT, 8), '/box/box.glb': glb }));
    const box: TilesetLayer = { id: 'box', url: `${FIXTURE_ORIGIN}/box/tileset.json`, show: true, lighting: 'sun', attempt: 0 };
    // 立方体立在 0 米的地面上，顶在 16 米；正方形在 30 米：把正方形放到 5 米，立方体穿过它
    ctx.session.scene.set({
      tilesets: [box],
      splats: [square({ placement: { lng: MODEL_AT[0], lat: MODEL_AT[1], height: 5, heading: 0 } })],
      underground: null
    });
    await until(() => ctx.view.sceneStatus.get('box')?.state === 'ready', '立方体就绪');
    // 两样都画出来以后再看中心：泼溅后画、做深度测试，被立方体挡住
    await boxContentDrawn(ctx);
    await until(() => isGreen(pixel(ctx.canvas, { x: MIDDLE.x + 90, y: MIDDLE.y })), '立方体外画出泼溅');
    await splatDrawn(ctx);

    expect(pixel(ctx.canvas, MIDDLE)).toSatisfy(isRed);
    expect(pickedHeight(ctx)).toBeCloseTo(16, 0);
    expect(pickedHeight(ctx, { x: MIDDLE.x + 90, y: MIDDLE.y })).toBeCloseTo(5, 0);
  });

  it('隔离一份泼溅（ADR 0156 R.5）：只画它、底色清屏，它拿全部预算；撤掉隔离后照常画、预算平分', async () => {
    const ctx = await setup();
    const glb = await boxGlb(8);
    onTestFinished(serveFixtures({ '/box/tileset.json': boxTileset(MODEL_AT, 8), '/box/box.glb': glb }));
    const box: TilesetLayer = { id: 'box', url: `${FIXTURE_ORIGIN}/box/tileset.json`, show: true, lighting: 'sun', attempt: 0 };
    // 立方体挡在正方形前面（同上一个用例）；另一份泼溅在 2 公里外，只用来分预算
    const far = square({ id: 'far', placement: { lng: MODEL_AT[0] + 0.02, lat: MODEL_AT[1], height: GROUND, heading: 0 } });
    ctx.session.scene.set({
      tilesets: [box],
      splats: [square({ placement: { lng: MODEL_AT[0], lat: MODEL_AT[1], height: 5, heading: 0 } }), far],
      underground: null
    });
    await until(() => ctx.view.sceneStatus.get('box')?.state === 'ready', '立方体就绪');
    await boxContentDrawn(ctx);
    await splatDrawn(ctx);
    await until(() => isRed(pixel(ctx.canvas, MIDDLE)), '立方体挡住泼溅');
    const total = ctx.renderer.inspect().splatBudget;
    const budgets = () => {
      const { splats } = ctx.renderer.inspect();
      return [splats.square?.budget, splats.far?.budget];
    };
    expect(budgets()).toStrictEqual([total / 2, total / 2]);
    const corner = { x: 4, y: 4 };
    const before = pixel(ctx.canvas, corner);

    ctx.renderer.setLift({ modelId: 'square', meters: 0, backdrop: '#1e2226' });
    await until(() => isGreen(pixel(ctx.canvas, MIDDLE)), '只画泼溅');
    // 角上没有模型的地方是底色（30, 34, 38），不是二维
    const [r, g, b] = pixel(ctx.canvas, corner);
    expect([Math.abs(r - 30), Math.abs(g - 34), Math.abs(b - 38)].every(difference => difference <= 2)).toBe(true);
    expect(budgets()).toStrictEqual([total, 1]);

    ctx.renderer.setLift(null);
    await until(() => isRed(pixel(ctx.canvas, MIDDLE)), '立方体又挡住泼溅');
    expect(pixel(ctx.canvas, corner)).toStrictEqual(before);
    expect(budgets()).toStrictEqual([total / 2, total / 2]);
    expect(ctx.errors).toStrictEqual([]);
  });

  describe('要求裁剪的瓦片集（倾斜摄影）在泼溅的范围里不画（ADR 0149）', () => {
    it('重叠时立方体在盒子里不画、拾取不到，画出后面的泼溅；隐藏、卸载泼溅后恢复', async () => {
      const ctx = await setup();
      const box = await boxFirst(ctx);

      ctx.session.scene.set({ tilesets: [box], splats: [tall()], underground: null });
      await splatDrawn(ctx);
      await until(() => isGreen(pixel(ctx.canvas, MIDDLE)), '中心画出泼溅（立方体被裁掉）');
      expect(clipped(ctx)).toBe(true);
      expect(pickedHeight(ctx)).toBeCloseTo(0, 0);

      ctx.session.scene.set({ tilesets: [box], splats: [tall({ show: false })], underground: null });
      await until(() => isRed(pixel(ctx.canvas, MIDDLE)), '隐藏泼溅后画出立方体');
      expect(clipped(ctx)).toBe(false);
      expect(pickedHeight(ctx)).toBeCloseTo(16, 0);

      ctx.session.scene.set({ tilesets: [box], splats: [tall()], underground: null });
      await until(() => isGreen(pixel(ctx.canvas, MIDDLE)), '再显示泼溅后又裁掉');
      expect(pickedHeight(ctx)).toBeCloseTo(0, 0);
      ctx.session.scene.set({ tilesets: [box], underground: null });
      await until(() => isRed(pixel(ctx.canvas, MIDDLE)), '卸载泼溅后画出立方体');
      expect(clipped(ctx)).toBe(false);
      expect(pickedHeight(ctx)).toBeCloseTo(16, 0);
      expect(ctx.errors).toStrictEqual([]);
    });

    it('只裁盒子里面：比盒子高的立方体（顶在 80 米），顶面照常画出、拾取到', async () => {
      const ctx = await setup();
      const box = await boxFirst(ctx, 40);

      ctx.session.scene.set({ tilesets: [box], splats: [tall()], underground: null });
      await splatDrawn(ctx);
      expect(clipped(ctx)).toBe(true);
      expect(pixel(ctx.canvas, MIDDLE)).toSatisfy(isRed);
      expect(pickedHeight(ctx)).toBeCloseTo(80, 0);
    });

    it('范围不重叠时不裁：泼溅在 500 米以外', async () => {
      const ctx = await setup();
      const far = tall({ placement: { lng: MODEL_AT[0] + 0.0055, lat: MODEL_AT[1], height: 0, heading: 0 } });
      const box = await boxFirst(ctx);

      ctx.session.scene.set({ tilesets: [box], splats: [far], underground: null });
      await splatDrawn(ctx);
      expect(clipped(ctx)).toBe(false);
      expect(pixel(ctx.canvas, MIDDLE)).toSatisfy(isRed);
      expect(pickedHeight(ctx)).toBeCloseTo(16, 0);
    });

    it('先加泼溅、后加立方体也裁；不要求裁剪的瓦片集不裁', async () => {
      const ctx = await setup();
      ctx.session.scene.set({ tilesets: [], splats: [tall()], underground: null });
      await splatDrawn(ctx);
      const box = await serveBox(8);
      ctx.session.scene.set({ tilesets: [box], splats: [tall()], underground: null });
      await boxContentDrawn(ctx);
      expect(clipped(ctx)).toBe(true);
      expect(pixel(ctx.canvas, MIDDLE)).toSatisfy(isGreen);
      expect(pickedHeight(ctx)).toBeCloseTo(0, 0);

      ctx.session.scene.set({ tilesets: [{ ...box, clippedBySplats: false }], splats: [tall()], underground: null });
      await until(() => isRed(pixel(ctx.canvas, MIDDLE)), '不要求裁剪时画出立方体');
      expect(clipped(ctx)).toBe(false);
      expect(pickedHeight(ctx)).toBeCloseTo(16, 0);
    });
  });

  it('GL 监听：加载、转动、缩放期间没有 GL 错误，库在渲染回调外的调用被每帧两头的保护盖住', async () => {
    const ctx = await setup({ ...ABOVE, pitch: 50 });
    using watch = watchGl(ctx.gl, ctx.rendering);
    // 斜着看时画布中心是 0 米的地面：正方形也放在 0 米
    await addSquare(ctx, square({ placement: { ...square().placement, height: 0 } }));
    for (const [bearing, zoom] of [
      [30, 17.5],
      [90, 18],
      [200, 17],
      [320, 18.5]
    ] as const) {
      ctx.view.flyTo({ bearing, zoom }, { duration: 0 });
      // oxlint-disable-next-line no-await-in-loop -- 每个姿态等画出来、后台的排序跑完再换下一个
      await until(() => pickedHeight(ctx) !== null, `bearing ${bearing} 拾取到`);
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    expect(watch.errors).toStrictEqual([]);
    expect(watch.errorCount).toBe(0);
    expect(ctx.errors).toStrictEqual([]);
    // 开发页按方法显示：分开的次数加起来等于总数
    expect(Object.values(watch.libraryOutsideByMethod).reduce((total, count) => total + count, 0)).toBe(watch.libraryOutside);
    // 库确实在渲染回调外调用了 GL（后台排序、分块上传）：保护有东西要守。这么小的数据去掉保护也不出错，
    // 真实数据要在开发页上用同样的监听再看（docs/modules/map-three.md"高斯泼溅"）
    expect(watch.libraryOutside).toBeGreaterThan(0);
  });

  it('GL 上下文丢失后恢复：泼溅还在，照样画出、照样拾取', async () => {
    const ctx = await setup();
    await addSquare(ctx);
    await until(() => isGreen(pixel(ctx.canvas, MIDDLE)), '画出绿色的正方形');
    const lose = required(ctx.gl.getExtension('WEBGL_lose_context'), 'WEBGL_lose_context 扩展');

    const lost = new Promise<void>(resolve => ctx.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    lose.loseContext();
    await within(lost, 'GL 上下文丢失');
    const restored = new Promise<void>(resolve =>
      ctx.canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
    );
    // 在派发丢失事件的同一个任务里调用 restoreContext，Chromium 不恢复（同 three-scene-renderer 的用例）
    await new Promise(resolve => setTimeout(resolve, 0));
    lose.restoreContext();
    await within(restored, 'GL 上下文恢复');
    await until(() => !ctx.gl.isContextLost() && pickedHeight(ctx) !== null, '恢复后再次拾取到泼溅');
    await until(() => isGreen(pixel(ctx.canvas, MIDDLE)), '恢复后再次画出绿色的正方形');

    expect(ctx.view.sceneStatus.get('square')?.state).toBe('ready');
    expect(pickedHeight(ctx)).toBeCloseTo(GROUND, 0);
  });
});
