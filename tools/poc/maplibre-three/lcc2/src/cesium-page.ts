// Cesium 上叠一块透明的 Three.js 画布画 LCC2：两个 WebGL 上下文，各画各的，靠每帧同步相机对齐。
// 只是 PoC，用来判断 Cesium 引擎下这样加载 LCC2 能不能用；说明见 ../../CESIUM-OVERLAY.md
import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  BoxGeometry as CesiumBoxGeometry,
  type Camera as CesiumCamera,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CesiumWidget,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  HeadingPitchRange,
  type JulianDate,
  Math as CesiumMath,
  Matrix4 as CesiumMatrix4,
  PerInstanceColorAppearance,
  PerspectiveFrustum,
  PointPrimitiveCollection,
  Primitive,
  UrlTemplateImageryProvider
} from 'cesium';
import { GaussianSplatRenderer, Lcc2StreamScheduler } from 'gaussian-splat-lite';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  MathUtils,
  type Material,
  Matrix4,
  type Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene as ThreeScene,
  Vector3,
  WebGLRenderer
} from 'three';
import { frustumFov, MAPLIBRE_FOVY, writablePitch, zoomToDistance } from '../../../../../packages/map-cesium/src/camera-math.ts';
import { setCesiumBaseUrl } from '../../../../../packages/map-cesium/src/runtime.ts';
import { SceneTilesets } from '../../../../../packages/map-cesium/src/scene-tilesets.ts';
import { footprintOf, SceneUnderground } from '../../../../../packages/map-cesium/src/scene-underground.ts';
import { prepareTileset } from '../../../../../packages/map-core/src/scene/prepare-tileset.ts';
import { type BenchEye, bindWalkKeys } from '../../src/bench/api.ts';
import { LCC_URL, loadIndex } from './lcc-meta.ts';
import { DepthOccluder, DepthPackStage } from './overlay-depth.ts';
import { type GlMemoryReport, trackGlMemory } from './overlay-glmem.ts';
import { centroids, FencePacer, type FrameRecord, GpuTimer, isCyan, isMagenta, type Point, summarize } from './overlay-probe.ts';
import { ecefToEnu, lccOrigin, lccToEcefMatrix } from './placement.ts';

type Occlusion = 'none' | 'proxy' | 'depth';

const params = new URLSearchParams(location.search);
const flag = (name: string, fallback = false) => (params.has(name) ? params.get(name) !== '0' : fallback);
const num = (name: string, fallback: number) => (params.get(name) === null ? fallback : Number(params.get(name)));

// ?bench=1 给测量脚本用：不开面板
const benchMode = flag('bench');
const noBasemap = params.get('basemap') === 'none';
// ?sync=lag 故意让 Three 用上一帧的相机画，对比两边各跑各的 requestAnimationFrame 会差多少
const lagMode = params.get('sync') === 'lag';
// ?rtc=0 把 Three 的世界直接设成地心坐标，对比大坐标下的抖动
const rtc = flag('rtc', true);
// ?continuous=1 两边每帧都重画；默认 Cesium 按需渲染，Three 只在相机变了或泼溅有更新时重画
let continuous = flag('continuous');
const timersOn = flag('timers');
const TILESET_ID = 'oblique';
const TILESET_URL = '/3dt/XZ_GC_3DT/tileset.json';

const errors: string[] = [];
window.addEventListener('error', event => errors.push(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String(event.reason)}`.slice(0, 300)));

// ?glmem=1 时从上下文一创建就开始记申请的显存，两个上下文分开
const glMemory = new Map<HTMLCanvasElement, () => GlMemoryReport>();
if (flag('glmem')) {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const context = (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    if (type === 'webgl2' && context && !glMemory.has(this)) {
      glMemory.set(this, trackGlMemory(context as WebGL2RenderingContext));
    }
    return context;
  } as typeof original;
}

// ---------- 坐标 ----------

const index = await loadIndex();
const [originLng, originLat] = lccOrigin(index);
// Three 的世界：原点在样例的 offset 处，x 东、y 上、z 南。相机和模型都换到这里再交给显卡，数值只有几百米
const worldFromEcef = rtc ? ecefToEnu(originLng, originLat, 0) : new Matrix4();
const ecefFromLcc = lccToEcefMatrix(index);
// 这份样例的 offset 不准，配准值来自方案 C 的报告第 9 节；换样例时用参数覆盖
const placement = { lift: num('lift', 29.58), dx: num('dx', -15.3), dy: num('dy', 83.4), yaw: num('yaw', 0) };
/** 配准：在 LCC2 的局部坐标里平移、绕 z 轴转 */
const correction = new Matrix4();
/** 配准后的 LCC2 局部坐标到地心 */
const ecefFromLocal = new Matrix4();
/** 样例文件里的坐标到 Three 的世界，不含配准 */
const worldFromLcc = new Matrix4().multiplyMatrices(worldFromEcef, ecefFromLcc);

function updatePlacementMatrices(): void {
  correction.makeRotationZ(MathUtils.degToRad(placement.yaw)).setPosition(placement.dx, placement.dy, placement.lift);
  ecefFromLocal.multiplyMatrices(ecefFromLcc, correction);
}
updatePlacementMatrices();

const localToEcef = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(ecefFromLocal);
const toCartesian = (v: Vector3) => new Cartesian3(v.x, v.y, v.z);
const { min: boxMin, max: boxMax } = index.root.boundingBox;
const boxCenter = [(boxMin[0] + boxMax[0]) / 2, (boxMin[1] + boxMax[1]) / 2] as const;
// 广场地面在局部 z≈-26（方案 C 的报告第 9 节）
const PLAZA_Z = -26;

// ---------- Cesium ----------

setCesiumBaseUrl('/cesium/');
const host = document.querySelector<HTMLElement>('#map');
if (!host) {
  throw new Error('缺少容器');
}

// 创建参数和 packages/map-cesium/src/cesium-scene.ts 相同，只是渲染循环自己写，好决定两块画布谁先画
const widget = new CesiumWidget(host, {
  baseLayer: false,
  skyBox: false,
  requestRenderMode: !continuous,
  maximumRenderTimeChange: Number.POSITIVE_INFINITY,
  creditContainer: document.createElement('div'),
  showRenderLoopErrors: false,
  useDefaultRenderLoop: false,
  contextOptions: { webgl: { powerPreference: 'high-performance' } }
});
const { scene } = widget;
const cesiumCamera: CesiumCamera = scene.camera;
scene.globe.baseColor = Color.fromCssColorString('#20262c');
scene.globe.showGroundAtmosphere = false;
cesiumCamera.percentageChanged = 0.001;
// 按设备像素比出图；?scale= 可以整体降分辨率，两块画布一起变
widget.useBrowserRecommendedResolution = false;
widget.resolutionScale = num('scale', 1);
scene.renderError.addEventListener((_scene: unknown, error: unknown) => errors.push(`cesium render: ${String(error)}`.slice(0, 300)));
const cesiumGl = widget.canvas.getContext('webgl2') as WebGL2RenderingContext;

const fovy = params.get('fovy') ? CesiumMath.toRadians(Number(params.get('fovy'))) : MAPLIBRE_FOVY;
function applyFov(): void {
  const { frustum } = cesiumCamera;
  const { clientWidth: width, clientHeight: height } = widget.canvas;
  if (width > 0 && height > 0 && frustum instanceof PerspectiveFrustum) {
    frustum.fov = frustumFov(fovy, width / height);
  }
}

if (!noBasemap) {
  widget.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 19
    })
  );
}

const tilesets = new SceneTilesets(widget, {
  failed: (id, error) => errors.push(`tile ${id}: ${String(error)}`.slice(0, 200)),
  initial: () => undefined
});
const loadJson = async (url: string, signal: AbortSignal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${url} ${response.status}`);
  }
  return response.json() as Promise<unknown>;
};
const prepareOblique = () => prepareTileset(new URL(TILESET_URL, location.href).href, loadJson, new AbortController().signal);

// statistics 是 Cesium 自己的调试面板用的，类型声明里没有
type TilesetWithStatistics = Cesium3DTileset & {
  readonly statistics: { readonly selected: number; readonly numberOfPendingRequests: number; readonly numberOfTilesProcessing: number };
};

function allTilesets(): TilesetWithStatistics[] {
  const out: TilesetWithStatistics[] = [];
  for (let i = 0; i < scene.primitives.length; i += 1) {
    const primitive: unknown = scene.primitives.get(i);
    if (primitive instanceof Cesium3DTileset) {
      out.push(primitive as TilesetWithStatistics);
    }
  }
  return out;
}

// ---------- 相机 ----------

interface ViewTarget {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

/** 俯瞰：和 CesiumScene.jumpTo 相同，画布中心的地面点和 MapLibre 的相机一致 */
function setView(target: ViewTarget): void {
  const [lng, lat] = target.center;
  const distance = zoomToDistance(target.zoom, lat, widget.canvas.clientHeight, MAPLIBRE_FOVY);
  cesiumCamera.lookAt(
    Cartesian3.fromDegrees(lng, lat),
    new HeadingPitchRange(CesiumMath.toRadians(target.bearing), CesiumMath.toRadians(writablePitch(target.pitch) - 90), distance)
  );
  cesiumCamera.lookAtTransform(CesiumMatrix4.IDENTITY);
  scene.requestRender();
}

/** 第一人称：height 是椭球高，heading 从正北顺时针，pitch 向上为正（度） */
function setEye(eye: BenchEye): void {
  cesiumCamera.setView({
    destination: Cartesian3.fromDegrees(eye.lng, eye.lat, eye.height),
    orientation: { heading: CesiumMath.toRadians(eye.heading), pitch: CesiumMath.toRadians(eye.pitch), roll: 0 }
  });
  scene.requestRender();
}

/** 绕配准后的局部坐标点看：heading 从正北顺时针，pitch 向下为负（度），range 是到这个点的距离（米） */
function lookAtLocal(x: number, y: number, z: number, heading: number, pitch: number, range: number): void {
  cesiumCamera.lookAt(toCartesian(localToEcef(x, y, z)), new HeadingPitchRange(CesiumMath.toRadians(heading), CesiumMath.toRadians(pitch), range));
  cesiumCamera.lookAtTransform(CesiumMatrix4.IDENTITY);
  scene.requestRender();
}

/** 站在配准后的局部坐标点上 */
function setLocalEye(x: number, y: number, z: number, heading: number, pitch = 0): BenchEye {
  const position = Cartographic.fromCartesian(toCartesian(localToEcef(x, y, z)));
  const eye = {
    lng: CesiumMath.toDegrees(position.longitude),
    lat: CesiumMath.toDegrees(position.latitude),
    height: position.height,
    heading,
    pitch
  };
  setEye(eye);
  return eye;
}

applyFov();
if (params.get('eye')) {
  const [x, y, z, heading, pitch] = (params.get('eye') ?? '').split(',').map(Number);
  setLocalEye(x, y, z, heading ?? 0, pitch ?? 0);
} else {
  lookAtLocal(boxCenter[0], boxCenter[1], PLAZA_Z, num('heading', 0), num('pitch', -45), num('range', 420));
}

// ---------- Three 的画布 ----------

class Overlay {
  readonly canvas = document.createElement('canvas');
  readonly renderer: WebGLRenderer;
  readonly gl: WebGL2RenderingContext;
  readonly scene = new ThreeScene();
  readonly camera = new PerspectiveCamera();
  readonly splatRenderer: GaussianSplatRenderer;
  /** 上一次画的时候相机的世界矩阵 */
  readonly drawnView = new Matrix4();
  streaming: Lcc2StreamScheduler | null = null;
  proxy: TilesRenderer | null = null;
  depth: DepthOccluder | null = null;
  dirty = true;
  renders = 0;
  readonly #next = new Matrix4();
  readonly #array = new Array<number>(16);
  #sourceId: number | null = null;

  constructor(parent: HTMLElement) {
    // 盖在 Cesium 的画布上，不接收鼠标和键盘，操作全部交给 Cesium
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    this.canvas.dataset.role = 'overlay';
    parent.append(this.canvas);
    // 库的文档要求关掉多重采样；透明背景，露出下面的 Cesium
    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.scene.matrixAutoUpdate = false;
    this.camera.matrixAutoUpdate = false;
    this.splatRenderer = new GaussianSplatRenderer({
      renderer: this.renderer,
      onDirty: () => {
        this.dirty = true;
      }
    });
    this.scene.add(this.splatRenderer);
  }

  /** 绘图缓冲的尺寸直接照抄 Cesium 的画布：窗口大小、设备像素比、resolutionScale 变了都跟着变 */
  syncSize(source: HTMLCanvasElement): boolean {
    if (this.canvas.width === source.width && this.canvas.height === source.height) {
      return false;
    }
    this.renderer.setSize(source.width, source.height, false);
    return true;
  }

  /** 把 Cesium 的相机换到 Three 的世界里；先在双精度里减掉原点，再交给显卡 */
  syncCamera(source: CesiumCamera): boolean {
    const { camera } = this;
    CesiumMatrix4.toArray(source.inverseViewMatrix, this.#array);
    this.#next.fromArray(this.#array).premultiply(worldFromEcef);
    let changed = !this.#next.equals(camera.matrix);
    if (changed) {
      camera.matrix.copy(this.#next);
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
      camera.updateMatrixWorld(true);
    }
    const { frustum } = source;
    if (frustum instanceof PerspectiveFrustum) {
      const fov = MathUtils.radToDeg(frustum.fovy ?? MAPLIBRE_FOVY);
      const aspect = frustum.aspectRatio ?? camera.aspect;
      const near = Math.max(frustum.near, 0.05);
      if (fov !== camera.fov || aspect !== camera.aspect || near !== camera.near) {
        camera.fov = fov;
        camera.aspect = aspect;
        camera.near = near;
        camera.far = 20000;
        camera.updateProjectionMatrix();
        changed = true;
      }
    }
    return changed;
  }

  render(): void {
    // 先清标记再画，画的过程中库又要求重画时不会丢
    this.dirty = false;
    this.depth?.sync(this.camera);
    this.renderer.render(this.scene, this.camera);
    this.drawnView.copy(this.camera.matrixWorld);
    this.renders += 1;
  }

  async addLcc(budget: number): Promise<void> {
    const streaming = new Lcc2StreamScheduler({
      splatBudget: budget,
      maxSh: 0,
      splatBudgetMode: 'limit',
      maxConcurrentLoads: 2,
      cooldownMs: 500,
      fadeDurationMs: 0,
      onChange: () => {
        this.dirty = true;
      },
      onError: (error: unknown, url?: string) => errors.push(`lcc ${url ?? ''}: ${String(error)}`.slice(0, 200))
    });
    this.streaming = streaming;
    streaming.group.matrixAutoUpdate = false;
    streaming.group.matrix.copy(worldFromLcc);
    streaming.group.matrixWorldNeedsUpdate = true;
    this.scene.add(streaming.group);
    streaming.setCamera(this.camera);
    this.#sourceId = await streaming.addSource({ url: LCC_URL, environment: false, transform: correction.clone() });
    this.dirty = true;
  }

  /**
   * 配准放在这个输入自己的 transform 上。不能改 group 的矩阵：相机不动时库不会重新取它，画面停在旧位置
   * （每帧都重画、相机一直在动时看不出来，按需渲染才会碰到）
   */
  applyPlacement(): void {
    if (this.streaming && this.#sourceId !== null) {
      this.streaming.setSourceSettings(this.#sourceId, { transform: correction.clone() });
    }
    this.dirty = true;
  }

  /** 缓解办法一：Three 这边再加载一份倾斜模型，只写深度不出颜色，泼溅按它做深度测试 */
  async addProxy(): Promise<void> {
    const prepared = await prepareOblique();
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
    const tiles = new TilesRenderer(url);
    tiles.group.matrixAutoUpdate = false;
    tiles.group.matrix.copy(worldFromEcef);
    tiles.group.matrixWorldNeedsUpdate = true;
    tiles.setCamera(this.camera);
    const markDirty = () => {
      this.dirty = true;
    };
    tiles.addEventListener('load-model', (event: { scene?: { traverse(visit: (object: unknown) => void): void } }) => {
      event.scene?.traverse(object => {
        const { material } = object as Mesh;
        for (const item of ([] as (Material | undefined)[]).concat(material)) {
          if (item) {
            item.colorWrite = false;
            // 只写深度用不到贴图，不让它传上显卡
            const textured = item as Material & { map?: { dispose(): void } | null };
            textured.map?.dispose();
            textured.map = null;
          }
        }
      });
      markDirty();
    });
    tiles.addEventListener('tile-visibility-change', markDirty);
    tiles.addEventListener('needs-render', markDirty);
    tiles.addEventListener('load-error', (event: { url?: unknown }) => errors.push(`proxy tile ${String(event.url)}`.slice(0, 200)));
    this.scene.add(tiles.group);
    this.proxy = tiles;
    this.dirty = true;
  }

  removeProxy(): void {
    if (this.proxy) {
      this.scene.remove(this.proxy.group);
      this.proxy.dispose();
      this.proxy = null;
      this.dirty = true;
    }
  }

  addDepth(source: HTMLCanvasElement): void {
    this.depth = new DepthOccluder(source, this.renderer);
    this.depth.bias = num('depthBias', 0);
    this.scene.add(this.depth.mesh);
    this.dirty = true;
  }

  removeDepth(): void {
    if (this.depth) {
      this.scene.remove(this.depth.mesh);
      this.depth.dispose();
      this.depth = null;
      this.dirty = true;
    }
  }

  /** 每帧都要调：泼溅的加载、换级只在这里推进 */
  update(): void {
    this.streaming?.update();
    if (this.proxy) {
      this.proxy.setResolution(this.camera, this.canvas.width, this.canvas.height);
      this.proxy.update();
    }
  }
}

let overlay: Overlay | null = null;
let occlusion: Occlusion = 'none';
let depthStage: DepthPackStage | null = null;

// ---------- 对齐用的标记：同一个地心坐标，Cesium 画品红的圆点，Three 画青色的方点 ----------

const markerLocals: readonly (readonly [number, number, number])[] = [
  [boxCenter[0], boxCenter[1], PLAZA_Z + 2],
  [boxCenter[0] - 60, boxCenter[1] - 90, PLAZA_Z + 2],
  [boxCenter[0] + 60, boxCenter[1] - 90, PLAZA_Z + 2],
  [boxCenter[0] - 60, boxCenter[1] + 90, PLAZA_Z + 2],
  [boxCenter[0] + 60, boxCenter[1] + 90, PLAZA_Z + 2],
  [boxCenter[0] - 30, boxCenter[1] + 40, PLAZA_Z + 40],
  [boxCenter[0] + 30, boxCenter[1] - 40, PLAZA_Z - 7]
];
// 标记是固定的地心坐标，之后再改泼溅的摆放（比如下沉做遮挡测试）不影响它们
const markerEcef = markerLocals.map(([x, y, z]) => localToEcef(x, y, z));
const cesiumMarkers = new PointPrimitiveCollection();
for (const position of markerEcef) {
  cesiumMarkers.add({ position: toCartesian(position), pixelSize: 22, color: Color.MAGENTA, disableDepthTestDistance: Number.POSITIVE_INFINITY });
}
cesiumMarkers.show = flag('markers');
scene.primitives.add(cesiumMarkers);
const threeMarkers = new Points(
  new BufferGeometry(),
  new PointsMaterial({ color: 0x00ffff, size: 8, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true })
);
{
  // 顶点存相对第一个标记的偏移，矩阵里放第一个标记的位置：数值小，单精度够用
  const [anchor] = markerEcef;
  const offsets = new Float32Array(markerEcef.length * 3);
  markerEcef.forEach((position, i) => offsets.set([position.x - anchor.x, position.y - anchor.y, position.z - anchor.z], i * 3));
  threeMarkers.geometry.setAttribute('position', new BufferAttribute(offsets, 3));
  threeMarkers.matrixAutoUpdate = false;
  threeMarkers.matrix.copy(worldFromEcef).multiply(new Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z));
  threeMarkers.matrixWorldNeedsUpdate = true;
  threeMarkers.frustumCulled = false;
  threeMarkers.renderOrder = 1000;
  threeMarkers.visible = cesiumMarkers.show;
}

function setMarkers(show: boolean): void {
  cesiumMarkers.show = show;
  threeMarkers.visible = show;
  scene.requestRender();
  if (overlay) {
    overlay.dirty = true;
  }
}

/** 地心坐标按 Three 的相机算出来的位置（绘图缓冲的像素，原点在左上）；在相机后面或画布外时为 null */
function expectedPixels(positions: readonly Vector3[] = markerEcef): (Point | null)[] {
  if (!overlay) {
    return positions.map(() => null);
  }
  const { camera, canvas } = overlay;
  return positions.map(position => {
    const eye = position.clone().applyMatrix4(worldFromEcef).applyMatrix4(camera.matrixWorldInverse);
    if (eye.z > -camera.near) {
      return null;
    }
    const clip = eye.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(clip.x) > 1 || Math.abs(clip.y) > 1) {
      return null;
    }
    return { x: ((clip.x + 1) / 2) * canvas.width, y: ((1 - clip.y) / 2) * canvas.height };
  });
}

/**
 * 算出来的对齐：同一个点，Cesium 自己的投影和 Three 相机的投影差多少像素（绘图缓冲的像素）。
 * 默认比标记；locals 给配准后的局部坐标时比这些点，第一人称时标记都在画面外
 */
function projectionError(locals?: readonly (readonly [number, number, number])[]): { max: number; compared: number; points: (number | null)[] } {
  const positions = locals ? locals.map(([x, y, z]) => localToEcef(x, y, z)) : markerEcef;
  const expected = expectedPixels(positions);
  const ratio = widget.canvas.width / widget.canvas.clientWidth;
  const points = positions.map((position, i) => {
    const three = expected[i];
    const cesium = scene.cartesianToCanvasCoordinates(toCartesian(position));
    if (!three || !cesium) {
      return null;
    }
    return Number(Math.hypot(three.x - cesium.x * ratio, three.y - cesium.y * ratio).toFixed(4));
  });
  const compared = points.filter(value => value !== null);
  return { max: Math.max(0, ...compared), compared: compared.length, points };
}

// ---------- 渲染循环 ----------

const cesiumTimer = new GpuTimer(cesiumGl, timersOn);
let overlayTimer: GpuTimer | null = null;
// ?pace=1：等上一帧在 GPU 上画完再开始下一帧；只有 Cesium 时先只等它一个上下文
let pacer: FencePacer | null = flag('pace') ? new FencePacer([cesiumGl]) : null;
const records: FrameRecord[] = [];
const beforeFrame = new Set<() => void>();
const afterFrame = new Set<() => void>();
let frameNo = 0;
let cesiumRenders = 0;
let depthCaptures = 0;
let viewMismatches = 0;
let lastFrameAt = performance.now();
/** 下一帧两边都强制重画，读像素时两块画布的绘图缓冲才都在 */
let forceBoth = false;
// Cesium 这一帧画的时候相机的世界矩阵（换到 Three 的世界里），和 Three 画的那一帧比对
const cesiumDrawnView = new Matrix4();
const viewArray = new Array<number>(16);
scene.postRender.addEventListener(() => {
  cesiumRenders += 1;
  CesiumMatrix4.toArray(cesiumCamera.inverseViewMatrix, viewArray);
  cesiumDrawnView.fromArray(viewArray).premultiply(worldFromEcef);
});

// 上一次取深度时的相机、视锥和画布尺寸
const depthSignature = new Float64Array(20);
const nextSignature = new Float64Array(20);
let rendersAtDepth = -1;

function depthStale(): boolean {
  CesiumMatrix4.toArray(cesiumCamera.inverseViewMatrix, viewArray);
  nextSignature.set(viewArray);
  const { frustum } = cesiumCamera;
  nextSignature[16] = frustum instanceof PerspectiveFrustum ? (frustum.fov ?? 0) : 0;
  nextSignature[17] = widget.canvas.width;
  nextSignature[18] = widget.canvas.height;
  let changed = rendersAtDepth !== cesiumRenders;
  for (let i = 0; i < nextSignature.length; i += 1) {
    if (nextSignature[i] !== depthSignature[i]) {
      changed = true;
    }
  }
  depthSignature.set(nextSignature);
  return changed;
}

/** Cesium 先画一遍压成颜色的距离，Three 立刻把这块画布读成纹理；之后的正常一遍再把画布盖回颜色 */
function captureDepth(time: JulianDate): void {
  if (!overlay?.depth || !depthStage) {
    return;
  }
  depthStage.packing = true;
  scene.requestRender();
  scene.render(time);
  overlay.depth.upload();
  depthStage.packing = false;
  scene.requestRender();
  overlay.dirty = true;
  depthCaptures += 1;
}

function drawOverlay(): { rendered: boolean; ms: number } {
  if (!overlay) {
    return { rendered: false, ms: 0 };
  }
  const start = performance.now();
  const resized = overlay.syncSize(widget.canvas);
  const moved = overlay.syncCamera(cesiumCamera);
  overlay.update();
  const rendered = continuous || forceBoth || overlay.dirty || resized || moved;
  if (rendered) {
    overlayTimer?.begin();
    overlay.render();
    overlayTimer?.end();
  }
  return { rendered, ms: performance.now() - start };
}

// initializeFrame 是 CesiumWidget.render 里调的同一个方法，类型声明里没有
const initializeFrame = () => (scene as unknown as { initializeFrame(): void }).initializeFrame();

function frame(): void {
  requestAnimationFrame(frame);
  if (pacer && !pacer.ready()) {
    return;
  }
  const now = performance.now();
  const intervalMs = now - lastFrameAt;
  lastFrameAt = now;
  frameNo += 1;
  widget.resize();
  if (widget.canvas.width === 0 || widget.canvas.height === 0) {
    widget.clock.tick();
    return;
  }
  applyFov();
  let overlayResult = { rendered: false, ms: 0 };
  if (lagMode) {
    // 相当于 Three 的 requestAnimationFrame 排在 Cesium 前面：这时相机还是上一帧的
    overlayResult = drawOverlay();
  }
  for (const hook of beforeFrame) {
    hook();
  }
  if (forceBoth) {
    scene.requestRender();
  }
  const rendersBefore = cesiumRenders;
  const cesiumStart = performance.now();
  // 相机在这里定下来（惯性、飞行、控制器），之后两边都用同一个相机画
  initializeFrame();
  const time = widget.clock.tick();
  cesiumTimer.begin();
  const capturing = occlusion === 'depth' && overlay?.depth && depthStale();
  if (capturing) {
    captureDepth(time);
  }
  scene.render(time);
  cesiumTimer.end();
  if (capturing) {
    rendersAtDepth = cesiumRenders;
  }
  const cesiumRendered = cesiumRenders !== rendersBefore;
  const cesiumMs = performance.now() - cesiumStart;
  if (!lagMode) {
    overlayResult = drawOverlay();
  }
  if (overlay && cesiumRendered && !cesiumDrawnView.equals(overlay.drawnView)) {
    viewMismatches += 1;
  }
  forceBoth = false;
  for (const hook of afterFrame) {
    hook();
  }
  cesiumTimer.poll();
  overlayTimer?.poll();
  pacer?.mark();
  records.push({ intervalMs, cesiumMs, overlayMs: overlayResult.ms, cesiumRendered, overlayRendered: overlayResult.rendered });
  if (records.length > 5000) {
    records.splice(0, records.length - 5000);
  }
}
requestAnimationFrame(frame);

/** 等 count 帧；按需渲染时每帧不一定重画 */
function frames(count: number, timeoutMs = 60000): Promise<boolean> {
  return new Promise(resolve => {
    const target = frameNo + count;
    const start = performance.now();
    const tick = () => {
      if (frameNo >= target) {
        resolve(true);
      } else if (performance.now() - start > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(tick, 30);
      }
    };
    tick();
  });
}

/** 两边在同一帧里各强制画一次，画完后在同一个任务里运行 read */
function sameFrame<T>(read: () => T): Promise<T> {
  return new Promise(resolve => {
    forceBoth = true;
    const hook = () => {
      afterFrame.delete(hook);
      resolve(read());
    };
    afterFrame.add(hook);
  });
}

interface MarkerOffsets {
  /** 两块画布上同一个标记的质心差（绘图缓冲的像素） */
  readonly max: number | null;
  readonly points: ({ dx: number; dy: number } | null)[];
  readonly found: number;
}

/** radius 是在期望位置周围找质心的范围（像素）；两个标记在屏幕上靠得太近时都不算，免得互相串 */
function readMarkers(radius = 20): MarkerOffsets {
  if (!overlay) {
    return { max: null, points: [], found: 0 };
  }
  const all = expectedPixels();
  const expected = all.map((point, i) => {
    const crowded = all.some((other, j) => i !== j && point && other && Math.hypot(point.x - other.x, point.y - other.y) < radius * 2 + 12);
    return crowded ? null : point;
  });
  const cesium = centroids(widget.canvas, isMagenta, expected, radius);
  const three = centroids(overlay.canvas, isCyan, expected, radius);
  const points = expected.map((_, i) => {
    const a = cesium[i];
    const b = three[i];
    return a && b ? { dx: Number((b.x - a.x).toFixed(3)), dy: Number((b.y - a.y).toFixed(3)) } : null;
  });
  const lengths = points.filter(point => point !== null).map(point => Math.hypot(point.dx, point.dy));
  return { max: lengths.length > 0 ? Number(Math.max(...lengths).toFixed(3)) : null, points, found: lengths.length };
}

/** 画出来的对齐：强制两边重画，读两块画布各自的标记质心 */
const measureMarkers = (radius?: number): Promise<MarkerOffsets> => sameFrame(() => readMarkers(radius));

interface MotionOptions {
  readonly kind: 'orbit' | 'dolly' | 'tilt';
  readonly frames: number;
  /** 每帧转多少度，或者每帧距离乘多少 */
  readonly step: number;
  readonly target?: readonly [number, number, number];
  readonly heading?: number;
  readonly pitch?: number;
  readonly range?: number;
  /** 找标记的范围（像素）；故意错开一帧时偏差大，要放大 */
  readonly radius?: number;
}

/** 连续运动时每一帧都量一次标记：相机在帧开头改，和 Cesium 的控制器改相机的时机相同 */
async function motionTest(options: MotionOptions): Promise<{ frames: number; maxPx: number | null; perFrame: (number | null)[]; viewMismatches: number; projectionMaxPx: number }> {
  const target = options.target ?? [boxCenter[0], boxCenter[1], PLAZA_Z];
  let heading = options.heading ?? 0;
  let pitch = options.pitch ?? -40;
  let range = options.range ?? 300;
  const perFrame: (number | null)[] = [];
  let projectionMaxPx = 0;
  const mismatchesBefore = viewMismatches;
  lookAtLocal(target[0], target[1], target[2], heading, pitch, range);
  await measureMarkers();
  await new Promise<void>(resolve => {
    let left = options.frames;
    const before = () => {
      if (options.kind === 'orbit') {
        heading += options.step;
      } else if (options.kind === 'tilt') {
        pitch = Math.max(-89, Math.min(-5, pitch + options.step));
      } else {
        range *= options.step;
      }
      lookAtLocal(target[0], target[1], target[2], heading, pitch, range);
      forceBoth = true;
    };
    const after = () => {
      perFrame.push(readMarkers(options.radius).max);
      projectionMaxPx = Math.max(projectionMaxPx, projectionError().max);
      left -= 1;
      if (left <= 0) {
        beforeFrame.delete(before);
        afterFrame.delete(after);
        resolve();
      }
    };
    beforeFrame.add(before);
    afterFrame.add(after);
  });
  const found = perFrame.filter(value => value !== null);
  return {
    frames: perFrame.length,
    maxPx: found.length > 0 ? Math.max(...found) : null,
    perFrame,
    viewMismatches: viewMismatches - mismatchesBefore,
    projectionMaxPx: Number(projectionMaxPx.toFixed(4))
  };
}

/** 按时间转：每秒 degPerSecond 度，转 seconds 秒；慢的机器丢帧，但走的路一样 */
function spin(seconds: number, degPerSecond: number, pitch = -35, range = 300): Promise<void> {
  return new Promise(resolve => {
    const startedAt = performance.now();
    const hook = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      lookAtLocal(boxCenter[0], boxCenter[1], PLAZA_Z, elapsed * degPerSecond, pitch, range);
      if (elapsed >= seconds) {
        beforeFrame.delete(hook);
        resolve();
      }
    };
    beforeFrame.add(hook);
  });
}

let compositeContext: CanvasRenderingContext2D | null = null;
const isBoxRed = (r: number, g: number, b: number) => r > 230 && g < 70 && b < 40;

/**
 * 量遮挡错了多少：Three 的画布盖住了多大比例的画面；Cesium 里的红方块有多少像素，叠上 Three 的画布后还剩多少。
 * 两块画布按浏览器合成的方式叠到一块 2D 画布上数
 */
function measureCoverage(): Promise<{ overlayCoverage: number; cesiumRed: number; compositeRed: number }> {
  return sameFrame(() => {
    const { width, height } = widget.canvas;
    compositeContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const context = compositeContext;
    if (!context || !overlay) {
      return { overlayCoverage: 0, cesiumRed: 0, compositeRed: 0 };
    }
    context.canvas.width = width;
    context.canvas.height = height;
    const count = (match: (r: number, g: number, b: number, a: number) => boolean) => {
      const { data } = context.getImageData(0, 0, width, height);
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (match(data[i], data[i + 1], data[i + 2], data[i + 3])) {
          total += 1;
        }
      }
      return total;
    };
    context.drawImage(overlay.canvas, 0, 0);
    const covered = count((_r, _g, _b, a) => a > 16);
    context.clearRect(0, 0, width, height);
    context.drawImage(widget.canvas, 0, 0);
    const cesiumRed = count(isBoxRed);
    context.drawImage(overlay.canvas, 0, 0);
    const compositeRed = count(isBoxRed);
    return { overlayCoverage: Number((covered / (width * height)).toFixed(4)), cesiumRed, compositeRed };
  });
}

/** Three 画布缩小后的灰度（乘了不透明度，0～255），用来比两次画面差多少 */
function grabOverlay(width: number, height: number): Promise<number[]> {
  return sameFrame(() => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!context || !overlay) {
      return [];
    }
    context.canvas.width = width;
    context.canvas.height = height;
    context.drawImage(overlay.canvas, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push(Math.round(((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * data[i + 3]) / 255));
    }
    return gray;
  });
}

// ---------- 加载 ----------

const lighting = 'sun';
const loadStartedAt = performance.now();
if (flag('tiles', true)) {
  await tilesets.add(TILESET_ID, await prepareOblique(), { show: true, lighting }, new AbortController().signal);
}

async function setOcclusion(mode: Occlusion): Promise<void> {
  if (!overlay) {
    throw new Error('先调用 start()');
  }
  overlay.removeProxy();
  overlay.removeDepth();
  occlusion = mode;
  if (mode === 'proxy') {
    await overlay.addProxy();
  } else if (mode === 'depth') {
    depthStage ??= new DepthPackStage(scene);
    overlay.addDepth(widget.canvas);
    rendersAtDepth = -1;
  }
  scene.requestRender();
}

/** 建 Three 的画布并加载泼溅；?defer=1 时由测量脚本分步调用，好分别读两个上下文的显存 */
async function start(options: { splat?: boolean } = {}): Promise<void> {
  if (overlay) {
    return;
  }
  const created = new Overlay(host as HTMLElement);
  created.scene.add(threeMarkers);
  overlayTimer = new GpuTimer(created.gl, timersOn);
  if (pacer) {
    pacer = new FencePacer([cesiumGl, created.gl]);
  }
  overlay = created;
  if (options.splat ?? flag('splat', true)) {
    await addLcc();
  }
  const mode = params.get('occlusion');
  if (mode === 'proxy' || mode === 'depth') {
    await setOcclusion(mode);
  }
}

/** 加载泼溅；测量脚本分步读显存时单独调用 */
async function addLcc(budget = num('budget', 300000)): Promise<void> {
  if (!overlay) {
    throw new Error('先调用 start()');
  }
  if (!overlay.streaming) {
    await overlay.addLcc(budget);
  }
}

if (!flag('defer')) {
  await start();
}

// ---------- 测试工具 ----------

function setPlacement(next: Partial<typeof placement>): void {
  Object.assign(placement, next);
  updatePlacementMatrices();
  overlay?.applyPlacement();
  scene.requestRender();
}

const boxes: Primitive[] = [];

/** 在 Cesium 里放一个不透明的方块（配准后的局部坐标）；它后面的泼溅本该被挡住 */
function addCesiumBox(x: number, y: number, z: number, size: number, color = '#ff2200'): void {
  const center = localToEcef(x, y, z);
  const modelMatrix = CesiumMatrix4.fromArray(new Matrix4().copy(ecefFromLocal).setPosition(center).elements);
  const primitive = new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: CesiumBoxGeometry.fromDimensions({ dimensions: new Cartesian3(size, size, size), vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
      modelMatrix,
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(color)) }
    }),
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: false, closed: true }),
    asynchronous: false
  });
  boxes.push(scene.primitives.add(primitive) as Primitive);
  scene.requestRender();
}

function clearCesiumBoxes(): void {
  for (const box of boxes.splice(0)) {
    scene.primitives.remove(box);
  }
  scene.requestRender();
}

function setTilesVisible(show: boolean): void {
  tilesets.update(TILESET_ID, { show, lighting });
}

/** 地表要不要挡住它下面的东西：Cesium 默认是 false，地下的模型隔着地面也看得见；这时深度里也没有地表 */
function setGroundDepthTest(on: boolean): void {
  scene.globe.depthTestAgainstTerrain = on;
  scene.requestRender();
}

const sceneUnderground = new SceneUnderground(widget);

/** 应用里的钻地：模型四周的地表半透明、可以进到地球表面以下；不透明度同 features/scene-models 的 SURFACE_OPACITY */
function setUnderground(on: boolean): void {
  const sphere = tilesets.boundingSphere(TILESET_ID);
  sceneUnderground.set(on && sphere ? footprintOf(sphere) : null, 0.25);
}

function setSplatVisible(show: boolean): void {
  if (overlay?.streaming) {
    overlay.streaming.group.visible = show;
    overlay.dirty = true;
  }
}

function setContinuous(on: boolean): void {
  continuous = on;
  scene.requestRenderMode = !on;
  scene.requestRender();
}

function tilesStable(): boolean {
  const all = allTilesets();
  return all.every(tileset => tileset.tilesLoaded && tileset.statistics.numberOfPendingRequests === 0 && tileset.statistics.numberOfTilesProcessing === 0);
}

function proxyStable(): boolean {
  const stats = (overlay?.proxy as unknown as { stats: Record<string, number> } | null | undefined)?.stats;
  return !stats || (stats.queued + stats.downloading + stats.parsing === 0 && stats.visible > 0);
}

let lastVisible = -1;
function splatStable(): boolean {
  const raw = (overlay?.streaming?.stats ?? null) as unknown as Record<string, number> | null;
  if (!raw) {
    return true;
  }
  const visible = raw.visibleSplats ?? 0;
  const stable = visible > 0 && visible === lastVisible && raw.loadingChunks === 0 && !raw.pendingBytes;
  lastVisible = visible;
  return stable;
}

/** 等倾斜模型和泼溅都加载完、画面不再变；按需渲染下期间要不断请求重画 */
async function settle(timeoutMs = 180000): Promise<boolean> {
  const start = performance.now();
  let calm = 0;
  while (performance.now() - start < timeoutMs) {
    scene.requestRender();
    await frames(2);
    const stable = tilesStable() && splatStable() && proxyStable() && (noBasemap || scene.globe.tilesLoaded) && !overlay?.dirty;
    calm = stable ? calm + 1 : 0;
    if (calm >= 3) {
      return true;
    }
  }
  return false;
}

const mbOf = (bytes: number) => Math.round(bytes / 1048576);

function stats(): Record<string, unknown> {
  const all = allTilesets();
  const sum = (read: (tileset: TilesetWithStatistics) => number) => all.reduce((total, tileset) => total + read(tileset), 0);
  const raw = (overlay?.streaming?.stats ?? {}) as unknown as Record<string, number>;
  const proxy = overlay?.proxy as unknown as { visibleTiles: Set<unknown>; lruCache: { cachedBytes: number } } | null | undefined;
  const info = overlay?.renderer.info;
  const position = cesiumCamera.positionCartographic;
  return {
    canvas: [widget.canvas.width, widget.canvas.height],
    overlayCanvas: overlay ? [overlay.canvas.width, overlay.canvas.height] : null,
    dpr: window.devicePixelRatio,
    frame: frameNo,
    cesiumRenders,
    overlayRenders: overlay?.renders ?? 0,
    depthCaptures,
    viewMismatches,
    occlusion,
    cameraHeight: Number(position.height.toFixed(2)),
    // 多于一个时，后处理里读到的深度只有最近的那一段
    cesiumFrustums: Math.max(0, (scene as unknown as { frameState: { frustumSplits: number[] } }).frameState.frustumSplits.length - 1),
    cesiumTilesSelected: sum(tileset => tileset.statistics.selected),
    cesiumTilesetMB: mbOf(sum(tileset => tileset.totalMemoryUsageInBytes)),
    visibleSplats: raw.visibleSplats ?? null,
    splatChunks: raw.residentChunks ?? null,
    splatLoading: raw.loadingChunks ?? null,
    splatCpuMB: mbOf(raw.residentCpuBytes ?? 0),
    splatGpuMB: mbOf(raw.residentGpuBytes ?? 0),
    proxyTiles: proxy?.visibleTiles.size ?? null,
    proxyCachedMB: proxy ? mbOf(proxy.lruCache.cachedBytes) : null,
    threeTextures: info?.memory.textures ?? null,
    threeGeometries: info?.memory.geometries ?? null,
    threeCalls: info?.render.calls ?? null,
    heapMB: mbOf((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0),
    errors: errors.length
  };
}

/** 两个上下文各自申请的显存（要 ?glmem=1） */
function glMemoryReport(): { cesium: GlMemoryReport | null; overlay: GlMemoryReport | null } {
  return {
    cesium: glMemory.get(widget.canvas)?.() ?? null,
    overlay: overlay ? (glMemory.get(overlay.canvas)?.() ?? null) : null
  };
}

const perf = {
  reset(): void {
    records.length = 0;
    cesiumTimer.samples.length = 0;
    if (overlayTimer) {
      overlayTimer.samples.length = 0;
    }
  },
  summary(): Record<string, unknown> {
    const moving = records.filter(record => record.cesiumRendered || record.overlayRendered);
    return {
      frames: records.length,
      framesRendered: moving.length,
      intervalMs: summarize(moving.map(record => record.intervalMs)),
      cesiumCpuMs: summarize(records.filter(record => record.cesiumRendered).map(record => record.cesiumMs)),
      overlayCpuMs: summarize(records.filter(record => record.overlayRendered).map(record => record.overlayMs)),
      cesiumGpuMs: cesiumTimer.available ? summarize(cesiumTimer.samples) : null,
      overlayGpuMs: overlayTimer?.available ? summarize(overlayTimer.samples) : null,
      fenceTimeouts: pacer?.timeouts ?? null
    };
  }
};

if (flag('walk')) {
  // 手动看第一人称的手感：WASD 走、左键拖动转头，只挪相机，不做碰撞
  scene.screenSpaceCameraController.enableInputs = false;
  const [x, y, z, heading, pitch] = (params.get('eye') ?? `120,80,${PLAZA_Z - 5.72},0,0`).split(',').map(Number);
  bindWalkKeys(widget.canvas, setLocalEye(x, y, z, heading ?? 0, pitch ?? 0), setEye);
}

const panel = document.querySelector<HTMLElement>('#panel');
if (benchMode) {
  panel?.remove();
} else {
  setInterval(() => {
    if (panel) {
      panel.textContent = JSON.stringify(stats()).replace(/,"/g, '\n"').replace(/[{}"]/g, '');
    }
  }, 500);
}

Object.assign(window, {
  ov: {
    widget,
    scene,
    get overlay() {
      return overlay;
    },
    errors,
    index,
    placement,
    config: { rtc, lagMode, timersOn, budget: num('budget', 300000), fovyDeg: CesiumMath.toDegrees(fovy), msaaSamples: scene.msaaSamples, logDepth: scene.logarithmicDepthBuffer },
    gl: { cesium: cesiumGl, get overlay() {
      return overlay?.gl ?? null;
    } },
    loadStartedAt,
    start,
    addLcc,
    frames,
    settle,
    stats,
    perf,
    glMemoryReport,
    setView,
    setEye,
    setLocalEye,
    lookAtLocal,
    setPlacement,
    setOcclusion,
    setMarkers,
    setTilesVisible,
    setSplatVisible,
    setUnderground,
    setGroundDepthTest,
    setContinuous,
    addCesiumBox,
    clearCesiumBoxes,
    projectionError,
    measureMarkers,
    motionTest,
    spin,
    measureCoverage,
    grabOverlay,
    boxCenter,
    plazaZ: PLAZA_Z
  },
  ovReady: true
});
