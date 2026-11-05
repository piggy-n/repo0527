import 'maplibre-gl/dist/maplibre-gl.css';
import { TilesRenderer } from '3d-tiles-renderer';
import { GaussianSplatRenderer, Lcc2StreamScheduler } from 'gaussian-splat-lite';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type LngLatLike,
  Map as MlMap,
  MercatorCoordinate,
  setWorkerUrl,
  type StyleSpecification
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import proj4 from 'proj4';
import {
  AmbientLight,
  BoxGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { prepareTileset } from '../../../../../packages/map-core/src/scene/prepare-tileset.ts';
import { collisionNodes, type CollisionMesh, LCC_URL, loadCollisionMesh, loadIndex } from './lcc-meta.ts';

const params = new URLSearchParams(location.search);
setWorkerUrl(workerUrl);
performance.setResourceTimingBufferSize(50000);

// ---------- 坐标 ----------

const EPSG_4548 = '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs';
const WGS84_LL = '+proj=longlat +datum=WGS84 +no_defs';
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const primeVertical = (lat: number) => A / Math.sqrt(1 - E2 * Math.sin(MathUtils.degToRad(lat)) ** 2);
const meridional = (lat: number) => (A * (1 - E2)) / (1 - E2 * Math.sin(MathUtils.degToRad(lat)) ** 2) ** 1.5;

function ecefOf(lng: number, lat: number, height: number): Vector3 {
  const lon = MathUtils.degToRad(lng);
  const la = MathUtils.degToRad(lat);
  const n = primeVertical(lat);
  return new Vector3((n + height) * Math.cos(la) * Math.cos(lon), (n + height) * Math.cos(la) * Math.sin(lon), (n * (1 - E2) + height) * Math.sin(la));
}

function ecefToEnu(lng: number, lat: number, height: number): Matrix4 {
  const lon = MathUtils.degToRad(lng);
  const la = MathUtils.degToRad(lat);
  const east = new Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const up = new Vector3(Math.cos(la) * Math.cos(lon), Math.cos(la) * Math.sin(lon), Math.sin(la));
  const south = new Vector3(Math.sin(la) * Math.cos(lon), Math.sin(la) * Math.sin(lon), -Math.cos(la));
  return new Matrix4().makeBasis(east, up, south).setPosition(ecefOf(lng, lat, height)).invert();
}

function enuToMercator(lng: number, lat: number): Matrix4 {
  const anchor = MercatorCoordinate.fromLngLat([lng, lat], 0);
  const cos = Math.cos(MathUtils.degToRad(lat));
  const east = 1 / (2 * Math.PI * primeVertical(lat) * cos);
  const north = 1 / (2 * Math.PI * meridional(lat) * cos);
  const up = anchor.meterInMercatorCoordinateUnits();
  return new Matrix4().set(east, 0, 0, anchor.x, 0, 0, north, anchor.y, 0, up, 0, anchor.z, 0, 0, 0, 1);
}

function enuToGlobe(lng: number, lat: number): Matrix4 {
  const lon = MathUtils.degToRad(lng);
  const la = MathUtils.degToRad(lat);
  const east = new Vector3(Math.cos(lon), 0, -Math.sin(lon));
  const up = new Vector3(Math.sin(lon) * Math.cos(la), Math.sin(la), Math.cos(lon) * Math.cos(la));
  const north = new Vector3(-Math.sin(lon) * Math.sin(la), Math.cos(la), -Math.cos(lon) * Math.sin(la));
  return new Matrix4()
    .makeBasis(east.clone().multiplyScalar(1 / primeVertical(lat)), up.clone().multiplyScalar(1 / 6371008.8), north.clone().multiplyScalar(-1 / meridional(lat)))
    .setPosition(up);
}

const index = await loadIndex();
const [originLng, originLat] = proj4(EPSG_4548, WGS84_LL, [index.offset[0], index.offset[1]]);

/** LCC2 局部（网格 x、y，高度 z）到地心：原点和两个网格方向按 proj4 算，高度取椭球高 */
function lccToEcefMatrix(): Matrix4 {
  const at = (x: number, y: number, z: number) => {
    const [lng, lat] = proj4(EPSG_4548, WGS84_LL, [index.offset[0] + x, index.offset[1] + y]);
    return ecefOf(lng, lat, index.offset[2] + z);
  };
  const origin = at(0, 0, 0);
  const axisX = at(100, 0, 0).sub(origin).multiplyScalar(0.01);
  const axisY = at(0, 100, 0).sub(origin).multiplyScalar(0.01);
  const axisZ = at(0, 0, 100).sub(origin).multiplyScalar(0.01);
  return new Matrix4().makeBasis(axisX, axisY, axisZ).setPosition(origin);
}

const worldFromEcef = ecefToEnu(originLng, originLat, 0);
const worldFromLcc = worldFromEcef.clone().multiply(lccToEcefMatrix());

// ---------- 地图 ----------

// ?bench=1 给测量脚本用：只留底图和泼溅，不开面板，相机默认对准样例的包围盒中心
const benchMode = params.get('bench') === '1';
const noBasemap = params.get('basemap') === 'none';
const { min: boxMin, max: boxMax } = index.root.boundingBox;
const [boxLng, boxLat] = proj4(EPSG_4548, WGS84_LL, [
  index.offset[0] + (boxMin[0] + boxMax[0]) / 2,
  index.offset[1] + (boxMin[1] + boxMax[1]) / 2
]);

const imagerySources: StyleSpecification['sources'] = noBasemap
  ? {}
  : {
      img: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19
      }
    };

const style: StyleSpecification = benchMode
  ? {
      version: 8,
      projection: { type: 'globe' },
      sources: imagerySources,
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#20262c' } },
        ...(noBasemap ? [] : [{ id: 'img', type: 'raster' as const, source: 'img' }])
      ]
    }
  : {
      version: 8,
      glyphs: '/fonts/glyphs/{fontstack}/{range}.pbf',
      projection: { type: params.get('projection') === 'mercator' ? 'mercator' : 'globe' },
      sources: {
        ...imagerySources,
        test: {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: { kind: 'below' }, geometry: { type: 'LineString', coordinates: [[originLng - 0.002, originLat - 0.0006], [originLng + 0.002, originLat - 0.0006]] } },
              { type: 'Feature', properties: { kind: 'above' }, geometry: { type: 'LineString', coordinates: [[originLng - 0.002, originLat + 0.0003], [originLng + 0.002, originLat + 0.0003]] } },
              { type: 'Feature', properties: { kind: 'label', name: '测试标注' }, geometry: { type: 'Point', coordinates: [originLng, originLat] } }
            ]
          }
        }
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#20262c' } },
        ...(noBasemap ? [] : [{ id: 'img', type: 'raster' as const, source: 'img' }]),
        { id: 'line-below', type: 'line', source: 'test', filter: ['==', ['get', 'kind'], 'below'], paint: { 'line-color': '#00ff88', 'line-width': 8 } },
        { id: 'line-above', type: 'line', source: 'test', filter: ['==', ['get', 'kind'], 'above'], paint: { 'line-color': '#ff2d55', 'line-width': 8 } },
        {
          id: 'label',
          type: 'symbol',
          source: 'test',
          filter: ['==', ['get', 'kind'], 'label'],
          layout: { 'text-field': ['get', 'name'], 'text-size': 18, 'text-allow-overlap': true },
          paint: { 'text-color': '#ffffff', 'text-halo-color': '#d6006e', 'text-halo-width': 2 }
        }
      ]
    };

const errors: string[] = [];
window.addEventListener('error', event => errors.push(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String(event.reason)}`));

const map = new MlMap({
  container: 'map',
  style,
  center: (benchMode ? [boxLng, boxLat] : [originLng, originLat]) as LngLatLike,
  zoom: Number(params.get('zoom') ?? 17),
  pitch: Number(params.get('pitch') ?? 0),
  bearing: Number(params.get('bearing') ?? 0),
  maxPitch: 180,
  maxZoom: 24,
  centerClampedToGround: false,
  attributionControl: benchMode ? false : undefined,
  localIdeographFontFamily: '"Microsoft YaHei", sans-serif',
  canvasContextAttributes: { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.get('preserve') === '1' }
});
map.on('error', event => errors.push(String(event.error?.message ?? event.error).slice(0, 200)));

// ---------- 自写层：一个 Three 场景同时放泼溅和 b3dm ----------

class SplatLayer implements CustomLayerInterface {
  readonly id = 'splat-layer';
  readonly type = 'custom';
  readonly renderingMode = '3d';
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  renderer: WebGLRenderer | null = null;
  splatRenderer: GaussianSplatRenderer | null = null;
  streaming: Lcc2StreamScheduler | null = null;
  tiles: TilesRenderer | null = null;
  frames = 0;
  lastError: string | null = null;
  lift = 0;
  rendering = false;
  prerenders = 0;
  readonly correction = new Matrix4();
  readonly #mapRef: MlMap;
  readonly #toMercator = enuToMercator(originLng, originLat);
  readonly #toGlobe = enuToGlobe(originLng, originLat);
  readonly #combined = new Matrix4();
  readonly #flat = new Matrix4();
  readonly #globe = new Matrix4();
  readonly #view = new Matrix4();
  readonly #scale = new Vector3();

  constructor(mapRef: MlMap) {
    this.#mapRef = mapRef;
    this.scene.matrixAutoUpdate = false;
    this.camera.matrixAutoUpdate = false;
    this.scene.add(new AmbientLight(0xffffff, 3));
  }

  onAdd(_map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const renderer = new WebGLRenderer({ canvas: this.#mapRef.getCanvas(), context: gl as WebGL2RenderingContext, antialias: false });
    renderer.autoClear = false;
    this.renderer = renderer;
    // 库的异步流程（排序结果、分块上传）会在 render 回调外调 GL。守住帧的两头，?guard=0 可以关掉对比：
    // 帧结束时重置 Three 的状态缓存，回调外的调用从已知状态开始；帧开始时靠 prerender 让 MapLibre 重建它的状态
    if (params.get('guard') !== '0') {
      this.#mapRef.on('render', () => renderer.resetState());
    }
    this.splatRenderer = new GaussianSplatRenderer({ renderer });
    this.scene.add(this.splatRenderer);
  }

  addLcc(options: { budget: number; lift: number; sh?: number }): Promise<number> {
    const streaming = new Lcc2StreamScheduler({
      splatBudget: options.budget,
      maxSh: options.sh ?? 0,
      splatBudgetMode: 'limit',
      maxConcurrentLoads: 2,
      cooldownMs: 500,
      fadeDurationMs: 0,
      onError: (error: unknown, url?: string) => errors.push(`lcc ${url ?? ''}: ${String(error)}`.slice(0, 200))
    });
    this.streaming = streaming;
    streaming.group.matrixAutoUpdate = false;
    this.setLift(options.lift);
    this.scene.add(streaming.group);
    streaming.setCamera(this.camera);
    return streaming.addSource({ url: LCC_URL, environment: false });
  }

  setLift(metres: number): void {
    this.lift = metres;
    this.#applyLccPlacement();
  }

  /** 配准修正：在 LCC2 局部系里平移（米）并绕原点转 yaw（度，逆时针） */
  setCorrection(dx: number, dy: number, dz: number, yawDeg: number): void {
    this.correction.makeRotationZ(MathUtils.degToRad(yawDeg)).setPosition(dx, dy, dz);
    this.#applyLccPlacement();
  }

  #applyLccPlacement(): void {
    const group = this.streaming?.group;
    if (group) {
      group.matrix.copy(new Matrix4().makeTranslation(0, this.lift, 0).multiply(worldFromLcc).multiply(this.correction));
      group.matrixWorldNeedsUpdate = true;
    }
  }

  async addTiles(): Promise<void> {
    const absolute = new URL('/3dt/XZ_GC_3DT/tileset.json', location.href).href;
    const prepared = await prepareTileset(
      absolute,
      async (target, signal) => (await fetch(target, { signal })).json(),
      new AbortController().signal
    );
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
    const tiles = new TilesRenderer(url);
    tiles.group.matrixAutoUpdate = false;
    this.tiles = tiles;
    this.setTilesOffset(0);
    this.scene.add(tiles.group);
    tiles.setCamera(this.camera);
    if (this.renderer) {
      tiles.setResolutionFromRenderer(this.camera, this.renderer);
    }
    tiles.addEventListener('load-error', (event: { url?: unknown }) => errors.push(`tile ${String(event.url)}`.slice(0, 200)));
  }

  setTilesOffset(up: number): void {
    if (this.tiles) {
      this.tiles.group.matrix.copy(new Matrix4().makeTranslation(0, up, 0).multiply(worldFromEcef));
      this.tiles.group.matrixWorldNeedsUpdate = true;
    }
  }

  // 什么也不画：MapLibre 在 prerender 之后调用 context.setDirty()，回调外的 GL 调用留下的状态因此作废
  prerender(): void {
    this.prerenders += 1;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const { renderer } = this;
    if (!renderer) {
      return;
    }
    try {
      const data = args.defaultProjectionData;
      const t = data.projectionTransition;
      if (t <= 0) {
        this.#combined.fromArray(data.mainMatrix as unknown as number[]).multiply(this.#toMercator);
      } else {
        this.#globe.fromArray(data.mainMatrix as unknown as number[]).multiply(this.#toGlobe);
        if (t >= 1) {
          this.#combined.copy(this.#globe);
        } else {
          this.#flat.fromArray(data.fallbackMatrix as unknown as number[]).multiply(this.#toMercator);
          for (let i = 0; i < 16; i += 1) {
            this.#combined.elements[i] = MathUtils.lerp(this.#flat.elements[i], this.#globe.elements[i], t);
          }
        }
      }
      this.#syncCamera(args);
      this.scene.updateMatrixWorld(true);
      const canvas = renderer.domElement;
      // 先重置 Three 的状态缓存，后面的上传和绘制都基于真实的 GL 状态
      renderer.resetState();
      this.rendering = true;
      if (this.tiles) {
        this.tiles.setResolution(this.camera, canvas.width, canvas.height);
        this.tiles.update();
      }
      this.streaming?.update();
      renderer.clearDepth();
      renderer.render(this.scene, this.camera);
      renderer.clearDepth();
      this.frames += 1;
    } catch (error) {
      this.lastError = String(error).slice(0, 300);
      errors.push(`render: ${this.lastError}`);
    } finally {
      this.rendering = false;
    }
    this.#mapRef.triggerRepaint();
  }

  /** 世界（东、上、南）坐标到屏幕 CSS 像素；只用于测量 */
  project(world: Vector3): { x: number; y: number } {
    const canvas = this.#mapRef.getCanvas();
    const clip = world.clone().applyMatrix4(this.camera.matrixWorldInverse).applyMatrix4(this.camera.projectionMatrix);
    return { x: ((clip.x + 1) / 2) * canvas.clientWidth, y: ((1 - clip.y) / 2) * canvas.clientHeight };
  }

  #syncCamera(args: CustomRenderMethodInput): void {
    const { camera } = this;
    this.#view.fromArray(args.projectionMatrix as unknown as number[]).invert().multiply(this.#combined);
    this.#view.invert().decompose(camera.position, camera.quaternion, this.#scale);
    camera.quaternion.normalize();
    camera.scale.set(1, 1, 1);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
    camera.projectionMatrix.multiplyMatrices(this.#combined, camera.matrixWorld);
    const normalization = -camera.projectionMatrix.elements[11];
    if (normalization !== 0) {
      camera.projectionMatrix.multiplyScalar(1 / normalization);
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const p = camera.projectionMatrix.elements;
    camera.fov = MathUtils.radToDeg(2 * Math.atan(1 / p[5]));
    camera.aspect = p[5] / p[0];
    camera.near = p[14] / (p[10] - 1);
    camera.far = p[14] / (p[10] + 1);
  }
}

const layer = new SplatLayer(map);

function frames(count: number, timeoutMs = 30000): Promise<boolean> {
  return new Promise(resolve => {
    const target = layer.frames + count;
    const start = performance.now();
    const tick = () => {
      if (layer.frames >= target) {
        resolve(true);
      } else if (performance.now() - start > timeoutMs) {
        resolve(false);
      } else {
        map.triggerRepaint();
        setTimeout(tick, 50);
      }
    };
    tick();
  });
}

function stats(): Record<string, unknown> {
  const raw = (layer.streaming?.stats ?? {}) as unknown as Record<string, number>;
  const tiles = layer.tiles as unknown as { stats: Record<string, number>; visibleTiles: Set<unknown>; lruCache: { cachedBytes: number } } | null;
  const info = layer.renderer?.info;
  return {
    t: Number(((map as unknown as { painter?: unknown }) && (window as unknown as { __t?: number }).__t) ?? 0),
    zoom: Number(map.getZoom().toFixed(2)),
    pitch: Number(map.getPitch().toFixed(1)),
    fps: Number(fps.toFixed(1)),
    frames: layer.frames,
    visibleSplats: raw.visibleSplats,
    chunks: raw.residentChunks,
    loading: raw.loadingChunks,
    progress: Number((raw.loadProgress ?? 0).toFixed(2)),
    cpuMB: Math.round((raw.residentCpuBytes ?? 0) / 1048576),
    gpuMB: Math.round((raw.residentGpuBytes ?? 0) / 1048576),
    pending: raw.pendingBytes,
    tilesVisible: tiles?.visibleTiles.size,
    tilesRefused: tiles?.stats.refused,
    tilesCachedMB: tiles ? Math.round(tiles.lruCache.cachedBytes / 1048576) : undefined,
    calls: info?.render.calls,
    triangles: info?.render.triangles,
    geometries: info?.memory.geometries,
    textures: info?.memory.textures,
    heapMB: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576),
    errors: errors.length
  };
}

let fps = 0;
let fpsFrames = 0;
let fpsStart = performance.now();
map.on('render', () => {
  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsStart >= 1000) {
    fps = (fpsFrames * 1000) / (now - fpsStart);
    fpsFrames = 0;
    fpsStart = now;
  }
});

const panel = document.querySelector<HTMLElement>('#panel');
// 测量时不开面板：定时刷新本身就是主线程的工作
if (benchMode) {
  panel?.remove();
} else {
  setInterval(() => {
    if (panel) {
      panel.textContent = JSON.stringify(stats()).replace(/,/g, '\n').replace(/[{}"]/g, '');
    }
  }, 500);
}

// ---------- 测试工具 ----------

/** 放一个红色方块，中心在 LCC2 局部坐标；用来看不透明物体和泼溅的遮挡 */
function addBox(x: number, y: number, z: number, size: number, color = 0xff2200): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial({ color }));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(worldFromLcc).multiply(new Matrix4().makeTranslation(x, y, z));
  layer.scene.add(mesh);
  return mesh;
}

/** LCC2 局部坐标对应的屏幕位置，和同一经纬度的 map.project 比较 */
function alignmentAt(x: number, y: number): unknown {
  const [lng, lat] = proj4(EPSG_4548, WGS84_LL, [index.offset[0] + x, index.offset[1] + y]);
  const world = new Vector3(x, y, -index.offset[2]).applyMatrix4(worldFromLcc);
  const three = layer.project(world);
  const two = map.project([lng, lat]);
  return { x, y, lng, lat, px: Number(Math.hypot(three.x - two.x, three.y - two.y).toFixed(3)) };
}

/** 第一人称：局部坐标的视点，朝 heading（从局部 y 轴顺时针） */
async function firstPerson(x: number, y: number, z: number, heading: number, lift: number, targetM = 8): Promise<unknown> {
  const rad = MathUtils.degToRad(heading);
  const point = (px: number, py: number, pz: number) => {
    const [lng, lat] = proj4(EPSG_4548, WGS84_LL, [index.offset[0] + px, index.offset[1] + py]);
    return { lng, lat, h: index.offset[2] + pz + lift };
  };
  const from = point(x, y, z);
  const to = point(x + Math.sin(rad) * targetM, y + Math.cos(rad) * targetM, z);
  const options = map.calculateCameraOptionsFromTo({ lng: from.lng, lat: from.lat } as never, from.h, { lng: to.lng, lat: to.lat } as never, to.h);
  map.jumpTo(options);
  await frames(4, 40000);
  const cam = layer.camera.position.clone().applyMatrix4(worldFromLcc.clone().invert());
  return { zoom: options.zoom, pitch: options.pitch, bearing: options.bearing, cameraLocal: cam.toArray().map(v => Number(v.toFixed(3))), near: Number(layer.camera.near.toFixed(3)), far: Number(layer.camera.far.toFixed(0)) };
}

const raycaster = new Raycaster();

/** 射线拾取：b3dm 用 Three，泼溅用库自己的 raycast；屏幕坐标为 CSS 像素 */
function pick(x: number, y: number): unknown {
  const canvas = map.getCanvas();
  raycaster.setFromCamera(new Vector2((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2), layer.camera);
  const toLocal = worldFromLcc.clone().invert();
  const result: Record<string, unknown> = {};
  if (layer.streaming) {
    const start = performance.now();
    const hit = raycaster.intersectObject(layer.streaming.group, true)[0];
    result.splat = hit ? { local: hit.point.clone().applyMatrix4(toLocal).toArray().map(v => Number(v.toFixed(3))), ms: Number((performance.now() - start).toFixed(1)) } : { hit: false, ms: Number((performance.now() - start).toFixed(1)) };
  }
  if (layer.tiles) {
    const start = performance.now();
    const hit = raycaster.intersectObject(layer.tiles.group, true)[0];
    result.b3dm = hit ? { local: hit.point.clone().applyMatrix4(toLocal).toArray().map(v => Number(v.toFixed(3))), ms: Number((performance.now() - start).toFixed(1)) } : { hit: false, ms: Number((performance.now() - start).toFixed(1)) };
  }
  return result;
}

/** 读当前画布灰度（要 ?preserve=1） */
function grab(): { width: number; height: number; gray: Float32Array; alpha: Uint8Array } {
  const gl = map.getCanvas().getContext('webgl2') as WebGL2RenderingContext;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const gray = new Float32Array(width * height);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    gray[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
    alpha[i] = pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2] > 12 ? 1 : 0;
  }
  return { width, height, gray, alpha };
}

/** 模板 b（只算 mask 为 1 的位置）在 a 上平移，找归一化互相关最大的位移 */
function bestShift(a: ReturnType<typeof grab>, b: ReturnType<typeof grab>, range: number, stride = 3): unknown {
  const { width, height } = a;
  const samples: number[] = [];
  for (let y = range; y < height - range; y += stride) {
    for (let x = range; x < width - range; x += stride) {
      if (b.alpha[x + y * width]) {
        samples.push(x + y * width);
      }
    }
  }
  const score = (dx: number, dy: number): number => {
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    for (const i of samples) {
      const va = a.gray[i + dx + dy * width];
      const vb = b.gray[i];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
    const n = samples.length;
    return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n) || 1);
  };
  let best = { dx: 0, dy: 0, ncc: -2 };
  for (let dy = -range; dy <= range; dy += 1) {
    for (let dx = -range; dx <= range; dx += 1) {
      const ncc = score(dx, dy);
      if (ncc > best.ncc) {
        best = { dx, dy, ncc };
      }
    }
  }
  return { ...best, ncc: Number(best.ncc.toFixed(4)), atZero: Number(score(0, 0).toFixed(4)), samples: samples.length };
}

const nodes = collisionNodes(index);
const meshes = new Map<string, CollisionMesh>();

/** 局部 (x, y) 处从 topZ 朝下第一个碰撞面的 z */
async function lccSurface(x: number, y: number, topZ: number): Promise<number | null> {
  let best: number | null = null;
  for (const node of nodes) {
    const { min, max } = node.box;
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1]) {
      continue;
    }
    let mesh = meshes.get(node.id);
    if (!mesh) {
      mesh = await loadCollisionMesh(node);
      meshes.set(node.id, mesh);
    }
    const t = mesh.raycast([x, y, topZ], [0, 0, -1], 60);
    if (t !== null && (best === null || t < best)) {
      best = t;
    }
  }
  return best === null ? null : topZ - best;
}

/** b3dm 在局部 (x, y) 处从高处朝下第一个面的局部 z */
function tilesSurface(x: number, y: number, topZ: number): number | null {
  if (!layer.tiles) {
    return null;
  }
  const origin = new Vector3(x, y, topZ).applyMatrix4(worldFromLcc);
  const below = new Vector3(x, y, topZ - 1).applyMatrix4(worldFromLcc);
  raycaster.ray.origin.copy(origin);
  raycaster.ray.direction.copy(below.sub(origin)).normalize();
  raycaster.near = 0;
  raycaster.far = 200;
  const hit = raycaster.intersectObject(layer.tiles.group, true)[0];
  raycaster.near = 0;
  raycaster.far = Infinity;
  if (!hit) {
    return null;
  }
  return hit.point.clone().applyMatrix4(worldFromLcc.clone().invert()).z;
}

await new Promise<void>(resolve => {
  if (benchMode ? map.isStyleLoaded() : map.loaded()) {
    resolve();
  } else {
    // 测量时不等底图的瓦片，尽早开始加载泼溅
    map.once(benchMode ? 'style.load' : 'load', () => resolve());
  }
});
map.addLayer(layer, benchMode ? undefined : (params.get('before') ?? 'line-above'));

// 测量脚本用的接口，和 src/bench 的两个页面相同
if (benchMode) {
  const budget = Number(params.get('budget') ?? 3000000);
  const loadStartedAt = performance.now();
  await layer.addLcc({ budget, lift: 0 });
  let lastVisible = -1;
  const streamStats = () => (layer.streaming?.stats ?? {}) as unknown as Record<string, number>;
  Object.assign(window, {
    bench: {
      engine: 'maplibre+three+gaussian-splat-lite',
      config: { budget, maxConcurrentLoads: 2, cooldownMs: 500, antialias: false, projection: 'globe' },
      gl: map.getCanvas().getContext('webgl2'),
      loadStartedAt,
      defaultCenter: [boxLng, boxLat],
      errors,
      isStable() {
        const raw = streamStats();
        const visible = raw.visibleSplats ?? 0;
        const stable = visible > 0 && visible === lastVisible && raw.loadingChunks === 0 && !raw.pendingBytes;
        lastVisible = visible;
        return stable;
      },
      basemapIdle: () => noBasemap || map.areTilesLoaded(),
      tick: () => map.triggerRepaint(),
      // 层每帧都请求重画，已经是连续渲染
      setContinuous() {},
      setCamera: (camera: { center: LngLatLike; zoom: number; bearing: number; pitch: number }) => map.jumpTo(camera),
      setModelVisible(visible: boolean) {
        if (layer.streaming) {
          layer.streaming.group.visible = visible;
        }
      },
      renders: () => layer.frames,
      isRendering: () => layer.rendering,
      stats() {
        const raw = streamStats();
        const info = layer.renderer?.info;
        return {
          visibleSplats: raw.visibleSplats ?? null,
          splatChunks: raw.residentChunks ?? null,
          loadProgress: raw.loadProgress ?? null,
          splatCpuMB: Math.round((raw.residentCpuBytes ?? 0) / 1048576),
          splatGpuMB: Math.round((raw.residentGpuBytes ?? 0) / 1048576),
          engineCalls: info?.render.calls ?? null,
          engineTriangles: info?.render.triangles ?? null,
          geometries: info?.memory.geometries ?? null,
          textures: info?.memory.textures ?? null
        };
      }
    },
    benchReady: true
  });
}

Object.assign(window, {
  m3: {
    map,
    layer,
    errors,
    index,
    origin: [originLng, originLat],
    worldFromLcc,
    frames,
    stats,
    addBox,
    alignmentAt,
    firstPerson,
    pick,
    grab,
    bestShift,
    lccSurface,
    tilesSurface,
    nodes,
    meshes
  },
  m3Ready: true
});
