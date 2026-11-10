import {
  buildNavigation,
  type CameraState,
  type LngLat,
  MapLibreView,
  MapSession,
  type Navigation,
  prepareTileset,
  type RoamStatus,
  type RouteRoam,
  type ScreenPoint,
  type WalkRoam,
  type WalkRoamStatus
} from '@mx/map-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { b3dmOf, FIXTURE_ORIGIN, roomGlb, roomTileset, serveFixtures } from './testing/fixtures';
import { required } from './testing/required';
import { ThreeSceneRenderer } from './three-scene-renderer';

// 真实的 MapLibre 和 Three：漫游地下的模型时抬高（ADR 0147 第 4 节的验收）。屋子在内存里生成，只用 https://fixture.test/

const MODEL_AT: LngLat = [120.66, 31.31];
// 地下的屋子：下层地板在 -12 米；包围盒最低处 -12.4 米，抬高 ceil(2 - (-12.4 + 1.6)) = 13 米
const UNDERGROUND_FLOOR = -12;
const GROUND_FLOOR = 2;
const BACKGROUND = '#204060';
const START: CameraState = { center: MODEL_AT, zoom: 17, bearing: 0, pitch: 30 };
const TEST_TIMEOUT = 90000;
const WAIT_TIMEOUT = 60000;
const WIDTH = 640;
const HEIGHT = 480;

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

const frames = (count: number) =>
  new Promise<void>(resolve => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

// 视图切到三维；页面的选项：缩放上限 18、俯角上限 85，中心高度夹到地面（漫游时由视图改掉再还原）
async function setup() {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px`;
  const session = new MapSession({ groups: ['basemap'], camera: START });
  session.style.setGroup('basemap', {
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': BACKGROUND } }]
  });
  const errors: unknown[] = [];
  const view = new MapLibreView({
    session,
    container,
    onError: error => errors.push(error),
    mapOptions: { maxZoom: 18, maxPitch: 85, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false } },
    loadSceneRenderer: async () => () => new ThreeSceneRenderer()
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
  return { session, view, errors, canvas };
}

type Context = Awaited<ReturnType<typeof setup>>;

// 加上屋子的瓦片集、建好导航网格；underground 时会话有地下空间，漫游时抬高
async function loadRoom(ctx: Context, floor: number, underground: boolean): Promise<Navigation> {
  const glb = await roomGlb();
  const tileset = roomTileset(MODEL_AT, floor);
  onTestFinished(serveFixtures({ '/room/tileset.json': tileset, '/room/room.glb': glb }));
  const url = `${FIXTURE_ORIGIN}/room/tileset.json`;
  ctx.session.scene.set({
    tilesets: [{ id: 'room', url, show: true, lighting: 'headlight', attempt: 0 }],
    underground: underground ? { tilesetId: 'room', surfaceOpacity: 0.25 } : null
  });
  await until(() => ctx.view.sceneStatus.get('room')?.state === 'ready', '屋子就绪');
  const signal = new AbortController().signal;
  const prepared = await prepareTileset(url, async target => (await fetch(target)).json() as Promise<unknown>, signal);
  return buildNavigation(prepared, { signal, download: async () => b3dmOf(glb) });
}

// 屋子局部系里的点（x 东、y 北、z 上，米）换成经纬度和真实的椭球高
const realOf = (navigation: Navigation, point: [number, number, number]) => navigation.frame.toLngLat(point);

function walkOf(navigation: Navigation, extra: Partial<WalkRoam> = {}): WalkRoam {
  const [lng, lat, height] = realOf(navigation, [-5, 0, 0]);
  return {
    kind: 'walk',
    id: 'walk-1',
    navigation,
    spawn: { lng, lat, height, heading: 90 },
    speed: 2,
    respawn: 0,
    unstuck: 0,
    paused: false,
    teleport: null,
    view: 'first',
    avatar: `${FIXTURE_ORIGIN}/avatar.glb`,
    ...extra
  };
}

function roam(ctx: Context, value: RouteRoam | WalkRoam | undefined): void {
  const { tilesets, underground } = ctx.session.scene.current;
  ctx.session.scene.set(value ? { tilesets, underground, roam: value } : { tilesets, underground });
}

const walking = (status: RoamStatus | null): status is WalkRoamStatus =>
  status?.kind === 'walk' && status.phase === 'walking' && status.player !== null;

async function walkIn(ctx: Context, navigation: Navigation): Promise<WalkRoamStatus> {
  roam(ctx, walkOf(navigation));
  await until(() => walking(ctx.view.roamStatus), '落到出生点');
  // 拾取按最近画出的一帧：进去之前从上面也能打到顶板的上表面（地板以上 8.2 米），要等打到站内的墙
  const floor = navigation.frame.toLngLat([0, 0, 0])[2];
  await until(() => {
    const hit = ctx.view.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
    return hit.kind === 'hit' && (hit.height ?? NaN) > floor - 0.3 && (hit.height ?? NaN) < floor + 7.5;
  }, '站内画出来');
  return required(walking(ctx.view.roamStatus) ? ctx.view.roamStatus : null, '步行的状态');
}

const AROUND_CENTER: readonly ScreenPoint[] = [-120, 0, 120].flatMap(dx =>
  [-90, 0, 90].map(dy => ({ x: WIDTH / 2 + dx, y: HEIGHT / 2 + dy }))
);

function pixel(canvas: HTMLCanvasElement, { x, y }: ScreenPoint): [number, number, number] {
  const gl = required(canvas.getContext('webgl2'), 'WebGL2 上下文');
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), canvas.height - Math.round(y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

const isBackground = ([r, g, b]: readonly number[]) => Math.abs(r - 32) < 8 && Math.abs(g - 64) < 8 && Math.abs(b - 96) < 8;

// 瞬移到上层（局部 5 米）以后
const onUpperFloor = (ctx: Context) => ctx.view.roamStatus?.kind === 'walk' && ctx.view.roamStatus.player?.floor === 5;
const playerOf = (ctx: Context) => (ctx.view.roamStatus?.kind === 'walk' ? ctx.view.roamStatus.player : null);
const routeStatus = (ctx: Context) => (ctx.view.roamStatus?.kind === 'route' ? ctx.view.roamStatus : null);

// 屋子里沿西墙往北、再往东的路线（局部系里，两种高度的屋子一样）
const routeOf = (navigation: Navigation): RouteRoam => ({
  kind: 'route',
  id: 'route-1',
  path: [realOf(navigation, [-8, -8, 0]), realOf(navigation, [-8, 8, 0]), realOf(navigation, [0, 8, 0])],
  playing: false,
  speed: 1,
  run: 0
});

describe('漫游地下的模型时抬高（ADR 0147 第 4 节）', { timeout: TEST_TIMEOUT }, () => {
  it('视点在出生点地板上方 1.6 米（真实高度）；拾取—投影往返误差小于 1 像素，拾取到的是真实高度', async () => {
    const ctx = await setup();
    const navigation = await loadRoom(ctx, UNDERGROUND_FLOOR, true);
    const status = await walkIn(ctx, navigation);

    expect(status.player?.floor).toBeCloseTo(0, 1);
    expect(required(ctx.view.eyeHeight(), '视点高度')).toBeCloseTo(UNDERGROUND_FLOOR + 1.6, 1);
    const errors = AROUND_CENTER.flatMap(point => {
      const result = ctx.view.pick(point);
      if (result.kind !== 'hit' || result.surface !== 'model') {
        return [];
      }
      // 屋子在 -12.2～-3.8 米：拾取的结果不带抬高量
      expect(result.height).toBeGreaterThan(UNDERGROUND_FLOOR - 0.3);
      expect(result.height).toBeLessThan(UNDERGROUND_FLOOR + 8.3);
      const back = required(ctx.view.project(result.lngLat, result.height ?? 0), '投影回画布的点');
      return [Math.hypot(back.x - point.x, back.y - point.y)];
    });
    expect(errors.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...errors)).toBeLessThan(1);
    expect(ctx.errors).toStrictEqual([]);
  });

  it('沿路线取地板：和路线上的地板高度相差不超过 2 厘米', async () => {
    const ctx = await setup();
    const navigation = await loadRoom(ctx, UNDERGROUND_FLOOR, true);
    // 西边沿 x = -8 往北走的路线，地板高度和清单一样是真实的椭球高
    const path = [realOf(navigation, [-8, -8, 0]), realOf(navigation, [-8, 8, 0])];
    roam(ctx, { kind: 'route', id: 'route-1', path, playing: false, speed: 1, run: 0 });
    await until(() => ctx.view.roamStatus?.kind === 'route' && (ctx.view.eyeHeight() ?? 0) < -9, '放到起点');
    await frames(10);

    const differences = [3, 4, 5, 6, 8, 10, 12].map(ahead => {
      const [lng, lat, floor] = realOf(navigation, [-8, -8 + ahead, 0]);
      const screen = required(ctx.view.project([lng, lat], floor), '路线上的点在画布上的位置');
      const result = ctx.view.pick(screen);
      if (result.kind !== 'hit' || result.surface !== 'model') {
        throw new Error(`路线前方 ${ahead} 米没有拾取到地板`);
      }
      return Math.abs((result.height ?? NaN) - floor);
    });
    expect(Math.max(...differences)).toBeLessThan(0.02);
  });

  it('室内地图双击瞬移：人落在目标楼层，真实的视点高度在那层地板上方 1.6 米', async () => {
    const ctx = await setup();
    const navigation = await loadRoom(ctx, UNDERGROUND_FLOOR, true);
    await walkIn(ctx, navigation);

    roam(ctx, walkOf(navigation, { teleport: { count: 1, spot: { x: 5, y: 0, floor: 5 } } }));
    await until(() => (ctx.view.roamStatus?.kind === 'walk' && ctx.view.roamStatus.player?.floor === 5) || false, '瞬移');
    await frames(10);

    const player = required(walking(ctx.view.roamStatus) ? ctx.view.roamStatus.player : null, '人的位置');
    expect([player.x, player.y, player.floor]).toStrictEqual([5, 0, 5]);
    expect(required(ctx.view.eyeHeight(), '视点高度')).toBeCloseTo(UNDERGROUND_FLOOR + 5 + 1.6, 1);
  });

  it('出生点、路线进度、人的位置和不抬高时一致', async () => {
    const lifted = await setup();
    const liftedNav = await loadRoom(lifted, UNDERGROUND_FLOOR, true);
    const below = await walkIn(lifted, liftedNav);
    const liftedEye = required(lifted.view.eyeHeight(), '视点高度');
    // 同样的屋子放在地面以上、没有地下空间：不抬高
    const ground = await setup();
    const groundNav = await loadRoom(ground, GROUND_FLOOR, false);
    const above = await walkIn(ground, groundNav);
    const groundEye = required(ground.view.eyeHeight(), '视点高度');

    // 人的位置在导航网格的局部系里，两边一样；视点都在各自的地板上方 1.6 米
    expect(above.player).toStrictEqual(below.player);
    expect(liftedEye - UNDERGROUND_FLOOR).toBeCloseTo(groundEye - GROUND_FLOOR, 1);

    const teleport = { count: 1, spot: { x: 5, y: 0, floor: 5 } };
    roam(lifted, walkOf(liftedNav, { teleport }));
    roam(ground, walkOf(groundNav, { teleport }));
    await until(() => onUpperFloor(lifted) && onUpperFloor(ground), '两边都瞬移');
    expect(playerOf(ground)).toStrictEqual(playerOf(lifted));

    // 同一条路线（局部系里一样）：总长一样，从 0 开始
    roam(lifted, routeOf(liftedNav));
    roam(ground, routeOf(groundNav));
    await until(() => routeStatus(lifted) !== null && routeStatus(ground) !== null, '两边都开始路线');
    const [a, b] = [routeStatus(lifted), routeStatus(ground)];
    expect(a?.distance).toBe(0);
    expect(b?.distance).toBe(0);
    // 两间屋子差 14 米高，椭球上的长度差约 5 × 10⁻⁵ 米
    expect(a?.total).toBeCloseTo(b?.total ?? NaN, 3);
    expect(a?.total).toBeCloseTo(24, 2);
  });

  it('退出后模型、二维图层和相机都恢复', async () => {
    const ctx = await setup();
    const navigation = await loadRoom(ctx, UNDERGROUND_FLOOR, true);
    await frames(10);
    const corner = { x: 4, y: HEIGHT - 4 };
    expect(isBackground(pixel(ctx.canvas, corner))).toBe(true);
    const before = ctx.session.camera.current;
    await walkIn(ctx, navigation);

    roam(ctx, undefined);
    await until(() => ctx.view.roamStatus === null, '漫游结束');
    // 黑幕 160 毫秒，飞回 1.2 秒
    await until(() => {
      const { center, zoom, pitch } = ctx.session.camera.current;
      return (
        Math.abs(center[0] - before.center[0]) < 1e-7 &&
        Math.abs(center[1] - before.center[1]) < 1e-7 &&
        Math.abs(zoom - before.zoom) < 1e-6 &&
        Math.abs(pitch - before.pitch) < 1e-6
      );
    }, '飞回开始前的相机');
    await frames(10);

    expect(isBackground(pixel(ctx.canvas, corner))).toBe(true);
    // 地下的屋子照常画在地面上（不再抬高）：屋子中央的地板投影回画布中心附近
    const floor = required(ctx.view.project(MODEL_AT, UNDERGROUND_FLOOR), '屋子的地板');
    expect(Number.isFinite(floor.x)).toBe(true);
    const result = ctx.view.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
    expect(result.kind).toBe('hit');
    expect(ctx.errors).toStrictEqual([]);
  });
});
