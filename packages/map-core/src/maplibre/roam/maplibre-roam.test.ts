import { createNanoEvents } from 'nanoevents';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CameraState } from '../../camera/camera-model';
import { buildNavGrid } from '../../scene/nav/heightfield';
import type { Navigation } from '../../scene/nav/nav-build';
import { navigationFrame, toEcef } from '../../scene/nav/nav-frame';
import { NavGrid } from '../../scene/nav/nav-grid';
import { floorQuad, triangles, wallQuad } from '../../scene/nav/nav-testing';
import { labelRegions } from '../../scene/nav/regions';
import type {
  RoamStatus,
  RouteRoam,
  SceneContent,
  TilesetStatus,
  WalkRoam,
  WalkRoamStatus
} from '../../scene/scene-content-model';
import type { TilesetSphere } from '../../scene/tileset-camera';
import type { CameraEventData, GestureHandlerLike } from '../map-like';
import type { SceneLift, SceneMarker, SceneRenderer, SceneRendererEvents } from '../scene-renderer';
import { MapLibreRoam, type RoamMap } from './maplibre-roam';

const MODEL_AT: [number, number] = [120.66, 31.31];
const SAVED: CameraState = { center: [120.6, 31.3], zoom: 15, bearing: 10, pitch: 50 };
// 黑幕变黑的毫秒数（Blackout 的 FADE_OUT）
const FADE_OUT = 160;

class FakeGesture implements GestureHandlerLike {
  enabled = true;
  isEnabled(): boolean {
    return this.enabled;
  }
  enable(): void {
    this.enabled = true;
  }
  disable(): void {
    this.enabled = false;
  }
}

// 只记下漫游对地图做了什么：相机、上限、视场角、中心高度、手势
class FakeMap implements RoamMap {
  readonly calls: string[] = [];
  readonly canvas = Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
  camera: { center: [number, number]; zoom: number; bearing: number; pitch: number; elevation?: number } = {
    center: [...SAVED.center],
    zoom: SAVED.zoom,
    bearing: SAVED.bearing,
    pitch: SAVED.pitch
  };
  maxZoom = 18;
  maxPitch = 85;
  fov = 36.87;
  clamped = true;
  readonly dragPan = new FakeGesture();
  readonly scrollZoom = new FakeGesture();
  readonly boxZoom = new FakeGesture();
  readonly dragRotate = new FakeGesture();
  readonly keyboard = new FakeGesture();
  readonly doubleClickZoom = new FakeGesture();
  readonly touchZoomRotate = new FakeGesture();
  readonly touchPitch = new FakeGesture();

  constructor() {
    Object.defineProperty(this.canvas, 'clientWidth', { value: 800 });
    Object.defineProperty(this.canvas, 'clientHeight', { value: 600 });
    // 漫游开始前的工具关掉了框选放大
    this.boxZoom.enabled = false;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  getBearing(): number {
    return this.camera.bearing;
  }
  getPitch(): number {
    return this.camera.pitch;
  }
  jumpTo(
    camera: { center: [number, number]; zoom: number; bearing: number; pitch: number; elevation?: number },
    _eventData: CameraEventData
  ): void {
    this.calls.push(camera.elevation === 0 ? 'jumpTo ground' : 'jumpTo');
    this.camera = camera;
  }
  unproject(): { lng: number; lat: number } {
    return { lng: MODEL_AT[0], lat: MODEL_AT[1] };
  }
  getMaxZoom(): number {
    return this.maxZoom;
  }
  setMaxZoom(maxZoom: number): void {
    this.calls.push(`setMaxZoom ${maxZoom}`);
    this.maxZoom = maxZoom;
  }
  getMaxPitch(): number {
    return this.maxPitch;
  }
  setMaxPitch(maxPitch: number): void {
    this.calls.push(`setMaxPitch ${maxPitch}`);
    this.maxPitch = maxPitch;
  }
  getVerticalFieldOfView(): number {
    return this.fov;
  }
  setVerticalFieldOfView(fov: number): void {
    this.fov = fov;
  }
  getCenterClampedToGround(): boolean {
    return this.clamped;
  }
  setCenterClampedToGround(clamped: boolean): void {
    this.clamped = clamped;
  }
  gestures(): boolean[] {
    return [this.dragPan, this.scrollZoom, this.boxZoom, this.dragRotate, this.keyboard].map(g => g.enabled);
  }
}

// 渲染器只记下抬高、光环和远处压暗；包围盒的最低处由用例设
class FakeRenderer implements SceneRenderer {
  readonly lifts: (SceneLift | null)[] = [];
  readonly markers: (SceneMarker | null)[] = [];
  fog = false;
  lowest: number | null = -6;
  readonly #emitter = createNanoEvents<SceneRendererEvents>();

  attach(): void {}
  detach(): void {}
  loseContext(): void {}
  prerender(): void {}
  render(): void {}
  endFrame(): void {}
  async addTileset(): Promise<TilesetSphere> {
    return { center: MODEL_AT, radius: 10 };
  }
  updateTileset(): void {}
  removeTileset(): void {}
  async addSplat(): Promise<TilesetSphere> {
    return { center: MODEL_AT, radius: 10 };
  }
  updateSplat(): void {}
  removeSplat(): void {}
  pick(): null {
    return null;
  }
  project(): null {
    return null;
  }
  setLift(lift: SceneLift | null): void {
    this.lifts.push(lift);
  }
  lowestHeight(): number | null {
    return this.lowest;
  }
  setInteriorFog(enabled: boolean): void {
    this.fog = enabled;
  }
  setMarker(marker: SceneMarker | null): void {
    this.markers.push(marker);
  }
  on<E extends keyof SceneRendererEvents>(event: E, callback: SceneRendererEvents[E]) {
    return this.#emitter.on(event, callback);
  }
  [Symbol.dispose](): void {}
}

// 12 米见方的屋子：地板在地面以下 6 米，顶板在地面以下 2.5 米；局部系是 MODEL_AT 的东北天
function room(): Navigation {
  const grid = new NavGrid(
    labelRegions(
      buildNavGrid([
        triangles(
          floorQuad(-6, -6, 6, 6, -6),
          floorQuad(-6, -6, 6, 6, -2.5),
          wallQuad(-6, -6, 6, -6, -6, -2.5),
          wallQuad(6, -6, 6, 6, -6, -2.5),
          wallQuad(6, 6, -6, 6, -6, -2.5),
          wallQuad(-6, 6, -6, -6, -6, -2.5)
        )
      ])
    )
  );
  const [lng, lat] = MODEL_AT;
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return { grid, frame: navigationFrame([...east, 0, ...north, 0, ...up, 0, ...toEcef(lng, lat, 0), 1]) };
}

const NAVIGATION = room();
// 屋子里离中心东边 5 米、北边 5 米的地板
const floorAt = (east: number, north: number): [number, number, number] => {
  const [lng, lat, height] = NAVIGATION.frame.toLngLat([east, north, -6]);
  return [lng, lat, height];
};

const route = (extra: Partial<RouteRoam> = {}): RouteRoam => ({
  kind: 'route',
  id: 'route-1',
  path: [floorAt(-4, 0), floorAt(4, 0)],
  playing: false,
  speed: 2,
  run: 0,
  ...extra
});

const walk = (extra: Partial<WalkRoam> = {}): WalkRoam => ({
  kind: 'walk',
  id: 'walk-1',
  navigation: NAVIGATION,
  spawn: { lng: floorAt(0, -3)[0], lat: floorAt(0, -3)[1], height: -6, heading: 0 },
  speed: 2,
  respawn: 0,
  unstuck: 0,
  paused: false,
  teleport: null,
  view: 'first',
  avatar: 'https://models.test/avatar.glb',
  ...extra
});

const UNDERGROUND = { tilesetId: 'room', surfaceOpacity: 0.25 } as const;
const content = (roam?: SceneContent['roam'], underground: SceneContent['underground'] = UNDERGROUND): SceneContent =>
  roam ? { tilesets: [], underground, roam } : { tilesets: [], underground };

function setup(tilesetState: TilesetStatus['state'] = 'ready') {
  const map = new FakeMap();
  const renderer = new FakeRenderer();
  const container = document.body.appendChild(document.createElement('div'));
  const statuses: (RoamStatus | null)[] = [];
  const takeovers: { engaged: boolean; lifted: boolean }[] = [];
  const flights: [CameraState, number][] = [];
  const state = { tileset: tilesetState };
  const roam = new MapLibreRoam({
    map,
    cameraTransform: () => ({
      getCameraAltitude: () => 1000,
      getCameraLngLat: () => ({ lng: MODEL_AT[0], lat: MODEL_AT[1] - 0.01 }),
      isPointOnMapSurface: () => true,
      isLocationOccluded: () => false
    }),
    container,
    renderer: () => renderer,
    tilesetState: () => state.tileset,
    currentCamera: () => SAVED,
    flyTo: (camera, duration) => flights.push([camera, duration]),
    onTakeover: change => takeovers.push(change),
    onStatus: status => statuses.push(status)
  });
  return {
    map,
    renderer,
    roam,
    statuses,
    takeovers,
    flights,
    state,
    get status() {
      return roam.status;
    },
    [Symbol.dispose]: () => {
      roam[Symbol.dispose]();
      container.remove();
    }
  };
}

const walkStatus = (status: RoamStatus | null): WalkRoamStatus => {
  if (status?.kind !== 'walk') {
    throw new Error('没有步行的状态');
  }
  return status;
};

// 推进 ms 毫秒：黑幕的定时器和逐帧推进都在里面
const advance = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance']
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MapLibreRoam (ADR 0147 §4)', () => {
  it('needs only what the MapLibre map offers', () => {
    expectTypeOf<MapLibreMap>().toExtend<RoamMap>();
  });

  it('enters a route under the blackout: takes over the map, lifts the underground model and places the eye', () => {
    using ctx = setup();
    ctx.roam.apply(content(route()), true);

    expect(ctx.status).toMatchObject({ kind: 'route', id: 'route-1', distance: 0, finished: false });
    expect(ctx.roam.engaged).toBe(false);
    expect(ctx.map.calls).toStrictEqual([]);

    advance(FADE_OUT);

    // 最低处 -6 米加眼高 1.6 米，要高出 0 米 2 米：抬高 ceil(6.4) = 7 米
    expect(ctx.renderer.lifts).toStrictEqual([{ tilesetId: 'room', meters: 7, backdrop: '#1e2226' }]);
    expect(ctx.takeovers).toStrictEqual([{ engaged: true, lifted: true }]);
    expect(ctx.roam.lift).toBe(7);
    expect([ctx.map.maxZoom, ctx.map.maxPitch, ctx.map.clamped]).toStrictEqual([24, 180, false]);
    expect(ctx.map.fov).toBeCloseTo(60, 9);
    expect(ctx.map.gestures()).toStrictEqual([false, false, false, false, false]);
    // 视点在路线的起点上一个眼高，相机按抬高后的位置
    expect(ctx.map.camera.elevation).toBeGreaterThan(0);
    const session = ctx.roam.sessionCamera(600);
    expect(session?.center[0]).toBeCloseTo(floorAt(-4, 0)[0], 6);
  });

  it('plays the route frame by frame, reports progress every half meter and the end', () => {
    using ctx = setup();
    ctx.roam.apply(content(route()), true);
    advance(FADE_OUT);
    ctx.roam.apply(content(route({ playing: true })), true);
    advance(1000);

    const status = ctx.status;
    expect(status?.kind === 'route' && status.distance).toBeGreaterThan(1.5);
    expect(status?.kind === 'route' && status.distance).toBeLessThan(2.5);
    const distances = ctx.statuses.flatMap(item => (item?.kind === 'route' ? [item.distance] : []));
    expect(distances.slice(1).every((distance, index) => distance - (distances[index] ?? 0) >= 0.5)).toBe(true);

    advance(5000);
    const end = ctx.status;
    expect(end?.kind === 'route' && end.finished).toBe(true);
    expect(end?.kind === 'route' ? end.distance : NaN).toBeCloseTo(8, 3);
  });

  it('leaves under the blackout: restores the map, then flies back to the camera before the roam', () => {
    using ctx = setup();
    ctx.roam.apply(content(route()), true);
    advance(FADE_OUT);
    ctx.map.calls.length = 0;

    ctx.roam.apply(content(), true);
    expect(ctx.status).toBeNull();
    expect(ctx.roam.engaged).toBe(true);

    advance(FADE_OUT);
    expect(ctx.roam.engaged).toBe(false);
    expect(ctx.renderer.lifts.at(-1)).toBeNull();
    expect(ctx.takeovers.at(-1)).toStrictEqual({ engaged: false, lifted: false });
    // 相机先放到上限以内（地表以上、俯角不超过 60°）再收紧上限
    expect(ctx.map.calls).toStrictEqual(['jumpTo ground', 'setMaxZoom 18', 'setMaxPitch 85']);
    expect(ctx.map.camera.pitch).toBeLessThanOrEqual(60);
    expect([ctx.map.clamped, ctx.map.fov]).toStrictEqual([true, 36.87]);
    // 工具关掉的框选放大不打开
    expect(ctx.map.gestures()).toStrictEqual([true, true, false, true, true]);
    expect(ctx.flights).toStrictEqual([[SAVED, 1200]]);
    expect(ctx.roam.sessionCamera(600)).toBeNull();
  });

  it('stops at once without flying back when another positioning takes over', () => {
    using ctx = setup();
    ctx.roam.apply(content(route({ playing: true })), true);
    advance(FADE_OUT + 200);

    ctx.roam.detach();

    expect(ctx.roam.engaged).toBe(false);
    expect(ctx.renderer.lifts.at(-1)).toBeNull();
    expect(ctx.flights).toStrictEqual([]);
    const reported = ctx.statuses.length;
    advance(1000);
    expect(ctx.statuses).toHaveLength(reported);
    // 拥有者随后撤掉漫游：只报告结束
    ctx.roam.apply(content(), true);
    advance(FADE_OUT);
    expect(ctx.status).toBeNull();
    expect(ctx.flights).toStrictEqual([]);
  });

  it('waits for the underground tileset before lifting it; without an underground model nothing is lifted', () => {
    using ctx = setup('loading');
    ctx.renderer.lowest = null;
    ctx.roam.apply(content(route()), true);
    advance(FADE_OUT);
    expect(ctx.roam.engaged).toBe(false);

    ctx.renderer.lowest = -6;
    ctx.state.tileset = 'ready';
    ctx.roam.onSceneStatus();
    advance(FADE_OUT);
    expect(ctx.roam.lift).toBe(7);

    using plain = setup();
    plain.roam.apply(content(route(), null), true);
    advance(FADE_OUT);
    expect(plain.roam.engaged).toBe(true);
    expect(plain.roam.lift).toBe(0);
    expect(plain.renderer.lifts).toStrictEqual([null]);
    expect(plain.takeovers).toStrictEqual([{ engaged: true, lifted: false }]);
  });

  it('walks: spawns at the manifest point, lands, moves with W and reports the player in real coordinates', () => {
    using ctx = setup();
    ctx.roam.apply(content(walk()), true);
    expect(walkStatus(ctx.status).phase).toBe('entering');

    advance(FADE_OUT);
    const landed = walkStatus(ctx.status);
    expect(landed.phase).toBe('walking');
    expect(ctx.renderer.fog).toBe(true);
    // 出生点在清单的位置，视点在地板上方一个眼高：真实的高度，不带抬高量
    expect(landed.player?.floor).toBeCloseTo(-6, 1);
    expect(Math.hypot((landed.player?.x ?? 0) - 0, (landed.player?.y ?? 0) + 3)).toBeLessThan(0.5);
    const eye = ctx.roam.sessionCamera(600);
    expect(eye?.center[1]).toBeCloseTo(floorAt(0, -3)[1], 5);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    advance(1000);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    // 朝北走了约 2 米（2 米/秒）
    expect(walkStatus(ctx.status).player?.y).toBeGreaterThan(-1.5);
  });

  it('teleports to a spot of the indoor map under a blink; paused walking ignores keys', () => {
    using ctx = setup();
    ctx.roam.apply(content(walk()), true);
    advance(FADE_OUT);

    ctx.roam.apply(content(walk({ teleport: { count: 1, spot: { x: 4, y: 4, floor: -6 } } })), true);
    advance(FADE_OUT + 50);
    const player = walkStatus(ctx.status).player;
    expect(player?.x).toBeCloseTo(4, 0);
    expect(player?.y).toBeCloseTo(4, 0);

    ctx.roam.apply(content(walk({ paused: true, teleport: { count: 1, spot: { x: 4, y: 4, floor: -6 } } })), true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    advance(500);
    expect(walkStatus(ctx.status).player?.y).toBeCloseTo(player?.y ?? NaN, 3);
  });

  it('hands over from a route to a walk without leaving the model: one takeover, the same lift', () => {
    using ctx = setup();
    ctx.roam.apply(content(route()), true);
    advance(FADE_OUT);

    ctx.roam.apply(content(walk()), true);
    advance(FADE_OUT);

    expect(walkStatus(ctx.status).phase).toBe('walking');
    expect(ctx.takeovers).toStrictEqual([{ engaged: true, lifted: true }]);
    expect(ctx.renderer.lifts).toHaveLength(1);
    // 换手时视点就在屋子里：从脚下附近开始，不是清单的出生点
    const player = walkStatus(ctx.status).player;
    expect(Math.hypot((player?.x ?? 0) + 4, player?.y ?? 0)).toBeLessThan(1);
  });

  it('suspends when the view leaves 3D: the camera goes straight back', () => {
    using ctx = setup();
    ctx.roam.apply(content(walk()), true);
    advance(FADE_OUT);

    ctx.roam.suspend();

    expect(ctx.roam.engaged).toBe(false);
    expect(ctx.map.camera).toMatchObject({ center: SAVED.center, zoom: SAVED.zoom, pitch: SAVED.pitch, elevation: 0 });
    expect(ctx.flights).toStrictEqual([]);
  });

  it('pauses with the page: no frames, keys forgotten; resuming puts the camera back at the eye', () => {
    using ctx = setup();
    ctx.roam.apply(content(walk()), true);
    advance(FADE_OUT);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    ctx.roam.pause();
    const before = walkStatus(ctx.status).player?.y;
    advance(1000);
    expect(walkStatus(ctx.status).player?.y).toBe(before);

    ctx.map.camera = { center: [0, 0], zoom: 3, bearing: 0, pitch: 0 };
    ctx.roam.resume();
    advance(100);
    expect(ctx.map.camera.zoom).toBeGreaterThan(20);
    expect(walkStatus(ctx.status).player?.y).toBe(before);
  });
});
