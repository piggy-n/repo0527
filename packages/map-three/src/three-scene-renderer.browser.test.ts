import { type CameraState, type LngLat, MapLibreView, MapSession, type ScreenPoint } from '@mx/map-core';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { boxGlb, boxTileset, FIXTURE_ORIGIN, serveFixtures, swingingArmGlb } from './testing/fixtures';
import { required } from './testing/required';
import { ThreeSceneRenderer } from './three-scene-renderer';

// 真实的 MapLibre 和 Three（ADR 0147 3C.1 的验收）：自写层的拾取—投影往返、glTF 和骨骼动画、GL 上下文丢失和恢复。
// 模型在内存里生成，只用 https://fixture.test/ 下的假地址

const MODEL_AT: LngLat = [120.66, 31.31];
// 软件渲染下 MapLibre、瓦片的加载都慢：用例的时限放宽到 60 秒；可能一直等不到的条件和它赛跑
const TEST_TIMEOUT = 60000;
const WAIT_TIMEOUT = 45000;
const WIDTH = 640;
const HEIGHT = 480;

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

// 等一个可能一直不来的事件，超时以说明失败
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

// 视图切到三维时投影总是地球（ADR 0147 第 2 节），z12 以上和墨卡托相同；background 是底图的颜色
async function setup(camera: CameraState, background = '#000000') {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px`;
  const session = new MapSession({ groups: ['basemap'], camera });
  session.style.setGroup('basemap', {
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': background } }]
  });
  const errors: unknown[] = [];
  let renderer: ThreeSceneRenderer | undefined;
  const view = new MapLibreView({
    session,
    container,
    onError: error => errors.push(error),
    // 和页面的选项一致（ADR 0147 第 5 节）；读像素要保留绘制缓冲
    mapOptions: {
      maxZoom: 24,
      maxPitch: 85,
      centerClampedToGround: false,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false }
    },
    loadSceneRenderer: async () => () => (renderer = new ThreeSceneRenderer())
  });
  onTestFinished(() => {
    view[Symbol.dispose]();
    session[Symbol.dispose]();
    container.remove();
  });
  await view.whenReady();
  view.setKind('3d');
  // 三维还要等三维模块加载好
  await view.whenReady();
  const canvas = required(container.querySelector('canvas'), '地图画布');
  return {
    session,
    view,
    errors,
    canvas,
    get renderer(): ThreeSceneRenderer {
      return required(renderer, '三维渲染器');
    }
  };
}

type Context = Awaited<ReturnType<typeof setup>>;

// 加一个立方体瓦片集，等到它就绪
async function loadBox(ctx: Context, half: number, at: LngLat = MODEL_AT): Promise<void> {
  const glb = await boxGlb(half);
  onTestFinished(serveFixtures({ '/box/tileset.json': boxTileset(at, half), '/box/box.glb': glb }));
  ctx.session.scene.set({
    tilesets: [{ id: 'box', url: `${FIXTURE_ORIGIN}/box/tileset.json`, show: true, lighting: 'sun', attempt: 0 }],
    underground: null
  });
  await until(() => ctx.view.sceneStatus.get('box')?.state === 'ready', '瓦片集就绪');
}

// 加一个立方体瓦片集，等到它就绪、画出来（画布中心能拾取到模型）
async function addBox(ctx: Context, half: number): Promise<void> {
  await loadBox(ctx, half);
  await until(() => pickedModel(ctx), '画出立方体');
}

const pickedModel = (ctx: Context) => {
  const result = ctx.view.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
  return result.kind === 'hit' && result.surface === 'model';
};

// 拾取画布上的这些点，打到模型的再投影回去，返回每个点的像素误差
function roundTrip(ctx: Context, points: readonly ScreenPoint[]): number[] {
  return points.flatMap(point => {
    const result = ctx.view.pick(point);
    if (result.kind !== 'hit' || result.surface !== 'model') {
      return [];
    }
    const back = required(ctx.view.project(result.lngLat, result.height ?? 0), '投影回画布的点');
    return [Math.hypot(back.x - point.x, back.y - point.y)];
  });
}

// 画布中心附近的一圈点
const AROUND_CENTER: readonly ScreenPoint[] = [-24, 0, 24].flatMap(dx =>
  [-24, 0, 24].map(dy => ({ x: WIDTH / 2 + dx, y: HEIGHT / 2 + dy }))
);

// 读画布上一个点的颜色（CSS 像素，设备像素比为 1）
function pixel(canvas: HTMLCanvasElement, { x, y }: ScreenPoint): [number, number, number] {
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), canvas.height - Math.round(y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

// 逐帧检测用：底图是不透明的蓝灰色，清屏色是全透明；采样点是画布中心（模型）和四周 100 像素处
const BACKGROUND = '#204060';
const MIDDLE: ScreenPoint = { x: WIDTH / 2, y: HEIGHT / 2 };
const SAMPLES: readonly ScreenPoint[] = [
  MIDDLE,
  ...[
    [-100, 0],
    [100, 0],
    [0, -100],
    [0, 100]
  ].map(([dx = 0, dy = 0]) => ({ x: MIDDLE.x + dx, y: MIDDLE.y + dy }))
];

// 读画布上一个点的颜色和透明度（CSS 像素，设备像素比为 1）
function rgba(canvas: HTMLCanvasElement, { x, y }: ScreenPoint): [number, number, number, number] {
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), canvas.height - Math.round(y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
}

// 立方体是红色的（光照下也是红色为主）
const isModelRed = ([r, g, b]: readonly number[]) => (r ?? 0) > 40 && (r ?? 0) > (g ?? 0) * 2 && (r ?? 0) > (b ?? 0) * 2;

async function nextFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    // oxlint-disable-next-line no-await-in-loop -- 一帧一帧地等
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

// 从 from 到 to（含）每次走 step
function steps(from: number, to: number, step: number): number[] {
  const count = Math.round((to - from) / step);
  return Array.from({ length: count + 1 }, (_, i) => from + i * step);
}

/**
 * 逐帧检测：每一帧读一次采样点，全是清屏色（什么都没画）算空白帧；绘制缓冲是保留的，读到的是最近画完的一帧。
 * 模型层挂着时，地图每画完一帧（render 事件里渲染器的 endFrame）再读画布中心，不是红色算没画出模型
 */
function watchFrames(ctx: Context) {
  const counts = { sampled: 0, blank: 0, rendered: 0, missing: 0 };
  let frame = 0;
  const sample = () => {
    counts.sampled++;
    if (SAMPLES.every(point => rgba(ctx.canvas, point)[3] === 0)) {
      counts.blank++;
    }
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  const { renderer } = ctx;
  const endFrame = renderer.endFrame.bind(renderer);
  renderer.endFrame = () => {
    endFrame();
    counts.rendered++;
    if (!isModelRed(rgba(ctx.canvas, MIDDLE))) {
      counts.missing++;
    }
  };
  return {
    stop: () => {
      cancelAnimationFrame(frame);
      renderer.endFrame = endFrame;
      return { ...counts };
    }
  };
}

describe('ThreeSceneRenderer 在 MapLibre 的自写层里', { timeout: TEST_TIMEOUT }, () => {
  it('墨卡托：拾取到模型表面的真实经纬度和椭球高，再投影回画布误差小于 1 像素', async () => {
    const ctx = await setup({ center: MODEL_AT, zoom: 17, bearing: 30, pitch: 50 });
    await addBox(ctx, 40);

    const errors = roundTrip(ctx, AROUND_CENTER);
    const center = ctx.view.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
    if (center.kind !== 'hit') {
      throw new Error('画布中心没有拾取到东西');
    }

    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...errors)).toBeLessThan(1);
    expect(center.surface).toBe('model');
    // 立方体边长 80 米，底面在椭球面上
    expect(center.height).toBeGreaterThan(-0.5);
    expect(center.height).toBeLessThan(80.5);
    expect(Math.abs(center.lngLat[0] - MODEL_AT[0])).toBeLessThan(0.001);
    expect(Math.abs(center.lngLat[1] - MODEL_AT[1])).toBeLessThan(0.001);
    expect(ctx.errors).toStrictEqual([]);
  });

  // 垂直俯视时 MapLibre 的远裁剪面只比地面低 1%（这块画布 z18 不到 2 米），不能把地下的模型裁掉
  it('垂直俯视时，地面以下的模型照样画出、拾取得到', async () => {
    const ctx = await setup({ center: MODEL_AT, zoom: 18, bearing: 0, pitch: 0 });
    const glb = await boxGlb(5);
    onTestFinished(serveFixtures({ '/box/tileset.json': boxTileset(MODEL_AT, 5, 'box.glb', -30), '/box/box.glb': glb }));
    ctx.session.scene.set({
      tilesets: [{ id: 'box', url: `${FIXTURE_ORIGIN}/box/tileset.json`, show: true, lighting: 'sun', attempt: 0 }],
      underground: null
    });
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };

    await expect.poll(() => isModelRed(pixel(ctx.canvas, center)), { timeout: WAIT_TIMEOUT }).toBe(true);

    const hit = ctx.view.pick(center);
    if (hit.kind !== 'hit') {
      throw new Error('画布中心没有拾取到东西');
    }
    expect(hit.surface).toBe('model');
    // 边长 10 米，底面在 -30 米：看到的是 -20 米的顶面
    expect(hit.height).toBeCloseTo(-20, 0);
    expect(ctx.errors).toStrictEqual([]);
  });

  it.each([
    ['地球（z10.5）', 10.5, 3000],
    ['地球投影的过渡段（z11.6）', 11.6, 1200]
  ])('%s：拾取—投影往返误差同样小于 1 像素', async (_, zoom, half) => {
    const ctx = await setup({ center: MODEL_AT, zoom, bearing: 0, pitch: 30 });
    await addBox(ctx, half);

    const errors = roundTrip(ctx, AROUND_CENTER);

    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...errors)).toBeLessThan(1);
  });

  it('就绪的状态带着让整个瓦片集进入画布的相机', async () => {
    const ctx = await setup({ center: [120, 31], zoom: 12, bearing: 0, pitch: 0 });
    await loadBox(ctx, 40);

    const status = ctx.view.sceneStatus.get('box');
    if (status?.state !== 'ready') {
      throw new Error('瓦片集没有就绪');
    }

    // 方块底面贴地，球心离地 40 米：相机朝北，视线穿过球心后落在它以北 40·tan(俯角) 米
    const north = (status.camera.center[1] - MODEL_AT[1]) * 111320;
    expect(status.camera.center[0]).toBeCloseTo(MODEL_AT[0], 3);
    expect(Math.abs(north - 40 * Math.tan((55 * Math.PI) / 180))).toBeLessThan(1);
    expect(status.camera.pitch).toBe(55);
  });

  it('glTF 的骨骼动画按时间播放，画面随之变化', async () => {
    // 40 米高的手臂整个在画布里
    const ctx = await setup({ center: MODEL_AT, zoom: 18, bearing: 0, pitch: 60 });
    const url = URL.createObjectURL(new Blob([await swingingArmGlb(40)]));
    onTestFinished(() => URL.revokeObjectURL(url));

    await ctx.renderer.addModel('arm', url, { lngLat: MODEL_AT, height: 0 }, new AbortController().signal);
    // 不在地面上的点按最近一帧投影：加载得快时可能还没画过，先等一帧
    await until(() => ctx.view.project(MODEL_AT, 30) !== null, '画过一帧');
    // 手臂离地 30 米处的一行像素：上半截左右摆，这一行的颜色跟着变
    const upper = required(ctx.view.project(MODEL_AT, 30), '手臂上半截在画布上的位置');
    const row = Array.from({ length: 33 }, (_, i) => ({ x: upper.x - 160 + i * 10, y: upper.y }));
    const snapshot = () => row.map(point => pixel(ctx.canvas, point).join(',')).join(' ');
    await until(() => (ctx.renderer.modelTime('arm') ?? 0) > 0.1, '动画开始播放');
    const before = snapshot();
    const green = row.some(point => {
      const [r, g] = pixel(ctx.canvas, point);
      return g > 40 && g > r * 2;
    });
    await until(() => (ctx.renderer.modelTime('arm') ?? 0) > 0.45, '动画播放到另一侧');

    expect(green).toBe(true);
    expect(snapshot()).not.toBe(before);
    expect(ctx.errors).toStrictEqual([]);
  });

  it('GL 上下文丢失后恢复：瓦片集仍是就绪，模型层重新挂上、重新上传，照样画出、照样拾取', async () => {
    const ctx = await setup({ center: MODEL_AT, zoom: 17, bearing: 0, pitch: 45 });
    await addBox(ctx, 40);
    const middle = { x: WIDTH / 2, y: HEIGHT / 2 };
    const isRed = () => {
      const [r, g, b] = pixel(ctx.canvas, middle);
      return r > 40 && r > g * 2 && r > b * 2;
    };
    await until(isRed, '画出红色的立方体');
    const gl = required(ctx.canvas.getContext('webgl2'), 'WebGL2 上下文');
    const lose = required(gl.getExtension('WEBGL_lose_context'), 'WEBGL_lose_context 扩展');

    const lost = new Promise<void>(resolve => ctx.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    lose.loseContext();
    await within(lost, 'GL 上下文丢失');
    const restored = new Promise<void>(resolve =>
      ctx.canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
    );
    // 在派发丢失事件的同一个任务里调用 restoreContext，Chromium 不恢复（2026-11-06 实测）
    await new Promise(resolve => setTimeout(resolve, 0));
    lose.restoreContext();
    await within(restored, 'GL 上下文恢复');
    await until(() => !gl.isContextLost() && pickedModel(ctx), '恢复后再次拾取到模型');
    await until(isRed, '恢复后再次画出红色的立方体');

    expect(ctx.view.sceneStatus.get('box')?.state).toBe('ready');
    expect(Math.max(...roundTrip(ctx, AROUND_CENTER))).toBeLessThan(1);
  });

  // MapLibre 地球投影下的 flyTo 中心不变时，acos 收到舍入到 1 以上的点积，缩放变成 NaN，地图就坏了（maplibre-view 的 globe-fly.ts）。
  // 路径长度在调用时就算好了，下一次调用停掉上一段：不等动画，一次扫很多个中心，只看 acos 收到了什么
  it('z12 以下中心不变的飞行、定位：acos 不会收到大于 1 的点积，飞得到终点', { timeout: TEST_TIMEOUT }, async () => {
    const ctx = await setup({ center: MODEL_AT, zoom: 10, bearing: 0, pitch: 30 }, BACKGROUND);
    const acos = vi.spyOn(Math, 'acos');
    onTestFinished(() => acos.mockRestore());
    const oversized = () => acos.mock.calls.filter(([value]) => value > 1).length;
    const STEP = 1.37e-5;
    const centerOf = (index: number): LngLat => [MODEL_AT[0] + index * STEP, MODEL_AT[1] + ((index * 7919) % 1500) * STEP];
    for (let index = 0; index < 1500; index++) {
      ctx.view.flyTo({ center: centerOf(index), zoom: 10 }, { duration: 0 });
      ctx.view.flyTo({ zoom: 11.5 + (index % 3) }, { duration: 100 });
    }
    expect(oversized()).toBe(0);
    // 定位到同一个范围：缩小了再定位一次，目标的中心就是现在的中心
    for (let index = 0; index < 500; index++) {
      const [lng, lat] = centerOf(index);
      const bounds = [lng - 0.15, lat - 0.15, lng + 0.15, lat + 0.15] as const;
      ctx.view.fitBounds(bounds, { duration: 0 });
      ctx.view.flyTo({ zoom: 8 }, { duration: 0 });
      ctx.view.fitBounds(bounds, { duration: 100 });
    }
    expect(oversized()).toBe(0);
    ctx.view.flyTo({ center: MODEL_AT, zoom: 10 }, { duration: 0 });
    ctx.view.flyTo({ zoom: 13.5 }, { duration: 200 });
    await until(() => Math.abs(ctx.session.camera.current.zoom - 13.5) < 0.01, '飞到 z13.5');
    expect(oversized()).toBe(0);
    expect(ctx.errors).toStrictEqual([]);
  });

  // 逐帧检测（ADR 0147 3C.2 的验收）：投影切换、缩放穿过 z12 时没有空白帧，三维的每一帧都画出模型
  describe('逐帧检测', () => {
    // 立方体的半边长按级别取，在画布中心占一块
    it.each([
      ['z16 俯仰 60', 16, 60, 200],
      ['z9 俯仰 30', 9, 30, 6000]
    ])('二三维切换（%s）：没有空白帧，三维的每一帧都画出模型', async (_, zoom, pitch, half) => {
      const ctx = await setup({ center: MODEL_AT, zoom, bearing: 0, pitch }, BACKGROUND);
      await addBox(ctx, half);
      await until(() => isModelRed(rgba(ctx.canvas, MIDDLE)), '画出立方体');
      const frames = watchFrames(ctx);

      ctx.view.setKind('2d');
      await nextFrames(12);
      ctx.view.setKind('3d');
      await nextFrames(12);
      const { blank, sampled, rendered, missing } = frames.stop();

      expect(sampled).toBeGreaterThanOrEqual(20);
      expect(blank).toBe(0);
      expect(rendered).toBeGreaterThan(0);
      expect(missing).toBe(0);
      expect(ctx.errors).toStrictEqual([]);
    });

    it('缩放穿过 z12（逐级跳和飞行动画）：没有空白帧，每一帧都画出模型', async () => {
      const ctx = await setup({ center: MODEL_AT, zoom: 13.5, bearing: 0, pitch: 30 }, BACKGROUND);
      await addBox(ctx, 3000);
      await until(() => isModelRed(rgba(ctx.canvas, MIDDLE)), '画出立方体');
      const frames = watchFrames(ctx);

      for (const zoom of [...steps(13.5, 10, -0.25), ...steps(10, 13.5, 0.25)]) {
        ctx.view.flyTo({ zoom }, { duration: 0 });
        // oxlint-disable-next-line no-await-in-loop -- 每一级画一帧再跳下一级
        await nextFrames(1);
      }
      for (const zoom of [10, 13.5]) {
        ctx.view.flyTo({ zoom }, { duration: 1200 });
        // oxlint-disable-next-line no-await-in-loop -- 一段飞完再飞回来
        await until(() => Math.abs(ctx.session.camera.current.zoom - zoom) < 0.01, `飞到 z${zoom}`);
      }
      await nextFrames(2);
      const { blank, sampled, rendered, missing } = frames.stop();

      expect(sampled).toBeGreaterThanOrEqual(40);
      expect(blank).toBe(0);
      expect(rendered).toBeGreaterThanOrEqual(30);
      expect(missing).toBe(0);
      expect(ctx.errors).toStrictEqual([]);
    });
  });
});
