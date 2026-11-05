import { TilesRenderer } from '3d-tiles-renderer';
import { LRUCache } from '3d-tiles-renderer/core';
import {
  AmbientLight,
  Euler,
  Matrix4,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import { ecefOf, ecefToEnuMatrix } from './common.ts';

const EYE_HEIGHT = 1.6;
const STEP_UP = 0.5;
const BODY_RADIUS = 0.3;

export interface RoamOptions {
  readonly container: HTMLElement;
  readonly tilesetUrl: string;
  readonly origin: readonly [number, number];
  readonly spawn: { readonly lng: number; readonly lat: number; readonly height: number; readonly heading: number };
  /** 屏幕空间误差目标，默认 8；和 Cesium 对比时用同样的 16 */
  readonly errorTarget?: number;
  /** 竖直视场角（度），默认 70 */
  readonly fovy?: number;
  /** 渲染分辨率倍数，默认 1 */
  readonly pixelRatio?: number;
}

export interface FloorSample {
  readonly floor: number | null;
  readonly ms: number;
}

/**
 * 独立的 Three 场景：自己的画布和 TilesRenderer，局部系（东、上、南）原点在模型附近。
 * 只验证能否在站内显示、取地板和碰撞；正式方案的行走规则在 map-core 的 Walker
 */
export class RoamScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.05, 3000);
  readonly tiles: TilesRenderer;
  readonly #raycaster = new Raycaster();
  readonly #origin: readonly [number, number];
  readonly #ecefToEnu: Matrix4;
  readonly #keys = new Set<string>();
  readonly #observer: ResizeObserver;
  readonly #abort = new AbortController();
  readonly #container: HTMLElement;
  #heading = 0;
  #pitch = 0;
  #raf = 0;
  #last = performance.now();
  frames = 0;
  lastFrameMs = 0;
  errors: string[] = [];

  constructor({ container, tilesetUrl, origin, spawn, errorTarget = 8, fovy = 70, pixelRatio = 1 }: RoamOptions) {
    this.#container = container;
    this.#origin = origin;
    this.#ecefToEnu = ecefToEnuMatrix(origin[0], origin[1], 0);
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatio);
    this.camera.fov = fovy;
    container.append(this.renderer.domElement);
    this.scene.matrixAutoUpdate = false;
    this.scene.add(new AmbientLight(0xffffff, 2.2));
    const headlight = new PointLight(0xffffff, 3, 0, 1.2);
    this.camera.add(headlight);
    this.scene.add(this.camera);
    this.tiles = new TilesRenderer(tilesetUrl);
    // 默认缓存是模块级单例：地图层隐藏后它的瓦片一直算在用，缓存满了这里就加载不了，所以单独给一个
    const cache = new LRUCache();
    cache.unloadPriorityCallback = this.tiles.lruCache.unloadPriorityCallback;
    this.tiles.lruCache = cache;
    this.tiles.group.matrixAutoUpdate = false;
    this.tiles.group.matrix.copy(this.#ecefToEnu);
    this.tiles.errorTarget = errorTarget;
    this.tiles.setCamera(this.camera);
    this.tiles.addEventListener('load-error', (event: { url?: unknown; error?: unknown }) =>
      this.errors.push(String(event.url ?? event.error))
    );
    this.scene.add(this.tiles.group);
    this.setPose(spawn.lng, spawn.lat, spawn.height + EYE_HEIGHT, spawn.heading, 0);
    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(container);
    this.#resize();
    this.#bindInput();
    this.#raf = requestAnimationFrame(this.#tick);
  }

  /** 把经纬度和椭球高换成局部系 */
  toLocal(lng: number, lat: number, height: number): Vector3 {
    return ecefOf(lng, lat, height).applyMatrix4(this.#ecefToEnu);
  }

  setPose(lng: number, lat: number, eyeHeight: number, headingDeg: number, pitchDeg: number): void {
    this.camera.position.copy(this.toLocal(lng, lat, eyeHeight));
    this.#heading = (headingDeg * Math.PI) / 180;
    this.#pitch = (pitchDeg * Math.PI) / 180;
    this.#applyRotation();
  }

  /** 朝下打射线取地板：head 是视点，上方再留 STEP_UP；取不到时为 null。高度是局部系的 y，约等于椭球高 */
  floorAt(position: Vector3): FloorSample {
    const start = performance.now();
    this.#raycaster.ray.origin.copy(position).add(new Vector3(0, STEP_UP - EYE_HEIGHT, 0));
    this.#raycaster.ray.direction.set(0, -1, 0);
    this.#raycaster.near = 0;
    this.#raycaster.far = 8;
    const hit = this.#raycaster.intersectObject(this.tiles.group, true)[0];
    return { floor: hit ? hit.point.y : null, ms: performance.now() - start };
  }

  /** 前方在腰部高度有没有挡着：distance 以内算挡住 */
  blockedAhead(position: Vector3, direction: Vector3, distance: number): boolean {
    this.#raycaster.ray.origin.copy(position).add(new Vector3(0, -0.8, 0));
    this.#raycaster.ray.direction.copy(direction);
    this.#raycaster.near = 0;
    this.#raycaster.far = distance + BODY_RADIUS;
    return this.#raycaster.intersectObject(this.tiles.group, true).length > 0;
  }

  /** 沿路线逐点取地板，和清单里的高度比较 */
  sampleRoute(path: readonly (readonly [number, number, number])[]): {
    readonly samples: number;
    readonly hits: number;
    readonly meanAbsDiff: number;
    readonly maxAbsDiff: number;
    readonly meanMs: number;
    readonly diffs: readonly (number | null)[];
  } {
    const diffs: (number | null)[] = [];
    let total = 0;
    let max = 0;
    let hits = 0;
    let ms = 0;
    for (const [lng, lat, height] of path) {
      const eye = this.toLocal(lng, lat, height + EYE_HEIGHT);
      const expected = this.toLocal(lng, lat, height).y;
      const sample = this.floorAt(eye);
      ms += sample.ms;
      if (sample.floor === null) {
        diffs.push(null);
        continue;
      }
      const diff = sample.floor - expected;
      diffs.push(Number(diff.toFixed(3)));
      hits += 1;
      total += Math.abs(diff);
      max = Math.max(max, Math.abs(diff));
    }
    return {
      samples: path.length,
      hits,
      meanAbsDiff: hits ? total / hits : NaN,
      maxAbsDiff: max,
      meanMs: ms / path.length,
      diffs
    };
  }

  stats(): Record<string, unknown> {
    const { stats, visibleTiles, activeTiles, lruCache } = this.tiles as unknown as {
      stats: Record<string, number>;
      visibleTiles: Set<unknown>;
      activeTiles: Set<unknown>;
      lruCache: { cachedBytes?: number };
    };
    return {
      downloading: stats.downloading,
      parsing: stats.parsing,
      failed: stats.failed,
      visible: visibleTiles.size,
      active: activeTiles.size,
      cachedMB: Math.round((lruCache.cachedBytes ?? 0) / 1048576),
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      frames: this.frames,
      frameMs: Math.round(this.lastFrameMs),
      errors: this.errors.length
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.#raf);
    this.#abort.abort();
    this.#observer.disconnect();
    this.tiles.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  #bindInput(): void {
    const { signal } = this.#abort;
    const canvas = this.renderer.domElement;
    window.addEventListener('keydown', event => this.#keys.add(event.code), { signal });
    window.addEventListener('keyup', event => this.#keys.delete(event.code), { signal });
    canvas.addEventListener(
      'pointermove',
      event => {
        if (event.buttons !== 1) {
          return;
        }
        this.#heading += event.movementX * 0.003;
        this.#pitch = Math.max(-1.4, Math.min(1.4, this.#pitch - event.movementY * 0.003));
        this.#applyRotation();
      },
      { signal }
    );
  }

  // heading 从正北顺时针；局部系 x 东、y 上、z 南，相机朝 -z，所以 heading 0 看北
  #applyRotation(): void {
    this.camera.quaternion.setFromEuler(new Euler(this.#pitch, -this.#heading, 0, 'YXZ'));
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#container;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
  }

  #walk(dt: number): void {
    const forward = (this.#keys.has('KeyW') ? 1 : 0) - (this.#keys.has('KeyS') ? 1 : 0);
    const strafe = (this.#keys.has('KeyD') ? 1 : 0) - (this.#keys.has('KeyA') ? 1 : 0);
    if (forward === 0 && strafe === 0) {
      return;
    }
    const direction = new Vector3(Math.sin(this.#heading) * forward + Math.cos(this.#heading) * strafe, 0, -Math.cos(this.#heading) * forward + Math.sin(this.#heading) * strafe).normalize();
    const step = 2.5 * dt;
    if (this.blockedAhead(this.camera.position, direction, step)) {
      return;
    }
    const next = this.camera.position.clone().addScaledVector(direction, step);
    const { floor } = this.floorAt(next);
    if (floor !== null) {
      next.y = floor + EYE_HEIGHT;
      this.camera.position.copy(next);
    }
  }

  #tick = (now: number): void => {
    this.#raf = requestAnimationFrame(this.#tick);
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.lastFrameMs = now - this.#last;
    this.#last = now;
    this.#walk(dt);
    this.camera.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    this.tiles.update();
    this.renderer.render(this.scene, this.camera);
    this.frames += 1;
  };

  get origin(): readonly [number, number] {
    return this.#origin;
  }
}
