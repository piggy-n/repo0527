import type {
  CameraState,
  ClientPoint,
  LngLat,
  MapPointerEvent,
  PickResult,
  ScreenPoint,
  Unsubscribe
} from '@yzt/map-core';
import type { Position } from 'geojson';
import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileFeature,
  Cesium3DTileset,
  CesiumWidget,
  ClassificationType,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  Ellipsoid,
  EllipsoidalOccluder,
  type Entity,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  PolygonHierarchy,
  PolylineDashMaterialProperty,
  RuntimeError,
  SceneTransforms,
  Transforms,
  UrlTemplateImageryProvider
} from 'cesium';
import { createNanoEvents } from 'nanoevents';
import {
  distanceToZoom,
  frustumFov,
  MAPLIBRE_FOVY,
  normalizeBearing,
  readablePitch,
  writablePitch,
  zoomToDistance
} from './camera-math';
import {
  type CreateScene,
  type SceneEvents,
  type SceneGestures,
  type SceneLike,
  type ScenePose,
  WebGLUnavailableError
} from './scene-like';
import type { OverlayLayer, OverlayShape, RgbaColor } from './overlay-plan';
import type { ImageryPlan } from './scene-style';

// 没有 background 图层时地球的底色（旧项目的取值）
const DEFAULT_BASE_COLOR = '#dfe7f2';

// 两点几乎重合时不转动：叉积太小，转轴的方向不可靠（单位是米的平方）
const MIN_PAN_AXIS = 1e-3;
// 临时拖动的一步转几次：一次转动加一次修正
const PAN_STEPS = 2;

// 画布上的鼠标事件对应的工具输入，和二维相同（ADR 0034 第 1 条）
const POINTER_TYPES = {
  mousedown: 'down',
  mousemove: 'move',
  mouseup: 'up',
  click: 'click',
  dblclick: 'dblclick',
  mouseleave: 'leave'
} as const satisfies Readonly<Record<string, MapPointerEvent['type']>>;

type PointerType = keyof typeof POINTER_TYPES;

interface ImageryEntry {
  readonly plan: ImageryPlan;
  readonly layer: ImageryLayer;
  readonly unsubscribe: () => void;
}

// 这些字段决定瓦片从哪里来，变了要换一个影像图层；透明度、显隐直接改
function sameProvider(a: ImageryPlan, b: ImageryPlan): boolean {
  return (
    a.url === b.url &&
    a.subdomains.join('\n') === b.subdomains.join('\n') &&
    a.tileSize === b.tileSize &&
    a.minimumLevel === b.minimumLevel &&
    a.maximumLevel === b.maximumLevel
  );
}

function isModel(picked: unknown): boolean {
  if (picked instanceof Cesium3DTileFeature) {
    return true;
  }
  return (
    typeof picked === 'object' &&
    picked !== null &&
    'primitive' in picked &&
    picked.primitive instanceof Cesium3DTileset
  );
}

function tuple({ x, y, z }: Cartesian3): [number, number, number] {
  return [x, y, z];
}

// 一个形状画成的实体；live 之后坐标改由每帧读取 geometry，只改坐标时不重建（测量画线，ADR 0080 第 1 节）
interface OverlayItem {
  readonly entity: Entity;
  geometry: Cartesian3[] | PolygonHierarchy;
  live: boolean;
}

interface OverlayEntry {
  layer: OverlayLayer;
  readonly items: OverlayItem[];
}

function positionsOf(path: readonly Position[]): Cartesian3[] {
  return Cartesian3.fromDegreesArray(path.flatMap(([lng = 0, lat = 0]) => [lng, lat]));
}

function hierarchyOf([outer = [], ...holes]: readonly (readonly Position[])[]): PolygonHierarchy {
  return new PolygonHierarchy(
    positionsOf(outer),
    holes.map(hole => new PolygonHierarchy(positionsOf(hole)))
  );
}

function colorOf([r, g, b, a]: RgbaColor): Color {
  return new Color(r, g, b, a);
}

function sameColor(a: RgbaColor, b: RgbaColor): boolean {
  return a.every((value, index) => value === b[index]);
}

// 样式完全相同的两个形状：坐标可以直接换，不用重建实体
function sameStyle(a: OverlayShape, b: OverlayShape): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    return (
      sameColor(a.color, b.color) &&
      a.width === b.width &&
      a.dash?.length === b.dash?.length &&
      a.dash?.pattern === b.dash?.pattern
    );
  }
  if (a.kind === 'polygon' && b.kind === 'polygon') {
    return sameColor(a.color, b.color);
  }
  if (a.kind === 'point' && b.kind === 'point') {
    return (
      a.radius === b.radius &&
      a.strokeWidth === b.strokeWidth &&
      sameColor(a.color, b.color) &&
      sameColor(a.strokeColor, b.strokeColor)
    );
  }
  return false;
}

/** 唯一调用 Cesium 的门面（ADR 0079 第 3 节）：CesiumView 通过 SceneLike 使用它 */
export class CesiumScene implements SceneLike {
  readonly #widget: CesiumWidget;
  readonly #emitter = createNanoEvents<SceneEvents>();
  readonly #stack: DisposableStack;
  readonly #imagery = new Map<string, ImageryEntry>();
  readonly #overlays = new Map<string, OverlayEntry>();
  // 被替换的图层的实体：留到新的画好再移除，重建期间不空白（ADR 0080 第 1 节）
  #retiring: Entity[] = [];
  #flying = false;
  // 相机在动时不算画面稳定；相机、影像变了以后重新等一次
  #moving = false;
  #settled = false;

  /** preserveDrawingBuffer 只给浏览器测试读画布的像素用 */
  constructor(container: HTMLElement, { preserveDrawingBuffer = false }: { preserveDrawingBuffer?: boolean } = {}) {
    using stack = new DisposableStack();
    let widget: CesiumWidget;
    try {
      widget = new CesiumWidget(container, {
        contextOptions: { webgl: { preserveDrawingBuffer } },
        // 不请求 Cesium ion 的全球影像；底图由样式镜像（ADR 0079 第 7 节）
        baseLayer: false,
        // 星空要额外的贴图，天空的大气效果是着色器画的，保留
        skyBox: false,
        // 只在场景变化时渲染
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY,
        // 版权信息不显示在地图上，署名由页面决定（ADR 0053 第 5 节）
        creditContainer: document.createElement('div'),
        // 渲染出错时不弹 Cesium 的错误面板，交给视图进入失败
        showRenderLoopErrors: false
      });
    } catch (error) {
      if (error instanceof RuntimeError && /webgl/i.test(error.message)) {
        throw new WebGLUnavailableError({ cause: error });
      }
      throw error;
    }
    this.#widget = widget;
    stack.defer(() => widget.destroy());
    const { scene, camera, canvas } = widget;
    scene.globe.baseColor = Color.fromCssColorString(DEFAULT_BASE_COLOR);
    // 地面大气会给影像蒙上一层颜色，和二维对不上
    scene.globe.showGroundAtmosphere = false;
    // 每一帧的相机变化都报告，状态栏和浮层才跟得上
    camera.percentageChanged = 0.001;
    this.#applyFov();

    stack.defer(camera.changed.addEventListener(() => this.#onCameraChange()));
    stack.defer(camera.moveEnd.addEventListener(() => this.#onCameraIdle()));
    stack.defer(
      scene.postRender.addEventListener(() => {
        this.#removeRetired();
        this.#checkSettled();
      })
    );
    stack.defer(scene.renderError.addEventListener((_scene, error: unknown) => this.#emitter.emit('failure', error)));
    if (canvas.tabIndex < 0) {
      canvas.tabIndex = 0;
    }
    for (const type of Object.keys(POINTER_TYPES) as PointerType[]) {
      const listener = (event: MouseEvent) => this.#emitter.emit('pointer', this.#toPointerEvent(type, event));
      canvas.addEventListener(type, listener);
      stack.defer(() => canvas.removeEventListener(type, listener));
    }
    const interact = () => this.#emitter.emit('interact');
    for (const type of ['mousedown', 'wheel', 'touchstart'] as const) {
      canvas.addEventListener(type, interact, { passive: true });
      stack.defer(() => canvas.removeEventListener(type, interact));
    }
    const onKeyDown = ({ key }: KeyboardEvent) => this.#emitter.emit('key', key);
    canvas.addEventListener('keydown', onKeyDown);
    stack.defer(() => canvas.removeEventListener('keydown', onKeyDown));
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(container);
    stack.defer(() => observer.disconnect());
    stack.defer(() => this.#removeImagery());
    this.#stack = stack.move();
  }

  get flying(): boolean {
    return this.#flying;
  }

  readCamera(): CameraState | null {
    const { width, height } = this.size();
    if (width <= 0 || height <= 0) {
      return null;
    }
    const { camera } = this.#widget;
    const ground = camera.pickEllipsoid(new Cartesian2(width / 2, height / 2), Ellipsoid.WGS84);
    if (!ground) {
      // 画布中心没打到地球（看向天空）时退化成相机正下方，不产生 NaN
      const position = camera.positionCartographic;
      const latitude = CesiumMath.toDegrees(position.latitude);
      return {
        center: [CesiumMath.toDegrees(position.longitude), latitude],
        zoom: distanceToZoom(position.height, latitude, height, MAPLIBRE_FOVY),
        bearing: normalizeBearing(CesiumMath.toDegrees(camera.heading)),
        pitch: readablePitch(Math.max(0, CesiumMath.toDegrees(camera.pitch) + 90))
      };
    }
    // 俯角和方位在目标点的东北天坐标系里解算，不能直接读 camera.pitch、camera.heading：
    // 它们相对相机所在位置的水平面，倾斜时和目标点差一个张角，来回切换会漂（旧项目实测 3°）
    const target = Cartographic.fromCartesian(ground);
    const toLocal = Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(ground), new Matrix4());
    const offset = Matrix4.multiplyByPoint(toLocal, camera.positionWC, new Cartesian3());
    const up = Matrix4.multiplyByPointAsVector(toLocal, camera.upWC, new Cartesian3());
    // 屏幕上方指向的方位就是二维的 bearing；正俯视时同样成立
    const bearing =
      Math.hypot(up.x, up.y) > 1e-6 ? Math.atan2(up.x, up.y) : Math.atan2(-offset.x, -offset.y);
    const latitude = CesiumMath.toDegrees(target.latitude);
    return {
      center: [CesiumMath.toDegrees(target.longitude), latitude],
      zoom: distanceToZoom(Cartesian3.magnitude(offset), latitude, height, MAPLIBRE_FOVY),
      bearing: normalizeBearing(CesiumMath.toDegrees(bearing)),
      pitch: readablePitch(CesiumMath.toDegrees(Math.atan2(Math.hypot(offset.x, offset.y), offset.z)))
    };
  }

  jumpTo(state: CameraState): void {
    const placement = this.#placement(state);
    if (!placement) {
      return;
    }
    const { camera } = this.#widget;
    camera.lookAt(placement.target, placement.offset);
    // lookAt 会把相机锁在目标点的参考系里，解除后用户才能自由操作
    camera.lookAtTransform(Matrix4.IDENTITY);
    this.#widget.scene.requestRender();
  }

  flyTo(state: CameraState, duration: number | undefined): void {
    if (duration === 0) {
      this.jumpTo(state);
      return;
    }
    const placement = this.#placement(state);
    if (!placement) {
      return;
    }
    this.#flying = true;
    const finish = () => {
      this.#flying = false;
    };
    this.#widget.camera.flyToBoundingSphere(new BoundingSphere(placement.target, 1), {
      offset: placement.offset,
      duration: duration === undefined ? undefined : duration / 1000,
      complete: finish,
      cancel: finish
    });
  }

  completeFlight(): void {
    if (this.#flying) {
      this.#widget.camera.completeFlight();
      this.#flying = false;
    }
  }

  cancelFlight(): void {
    if (this.#flying) {
      this.#widget.camera.cancelFlight();
      this.#flying = false;
    }
  }

  savePose(): ScenePose {
    const { camera } = this.#widget;
    return { position: tuple(camera.positionWC), direction: tuple(camera.directionWC), up: tuple(camera.upWC) };
  }

  restorePose({ position, direction, up }: ScenePose): void {
    this.#widget.camera.setView({
      destination: new Cartesian3(...position),
      orientation: { direction: new Cartesian3(...direction), up: new Cartesian3(...up) }
    });
    this.#widget.scene.requestRender();
  }

  panBetween(from: ClientPoint, to: ClientPoint): void {
    const { camera, canvas, scene } = this.#widget;
    const box = canvas.getBoundingClientRect();
    const target = new Cartesian2(to.x - box.left, to.y - box.top);
    const start = camera.pickEllipsoid(new Cartesian2(from.x - box.left, from.y - box.top), Ellipsoid.WGS84);
    let end = camera.pickEllipsoid(target, Ellipsoid.WGS84);
    if (!start || !end) {
      return;
    }
    // 绕地心转动相机：Camera.rotate 按右手定则转过 -angle，轴取 start × end 时，转后 to 下面是原来 from 下面的点。
    // 椭球不是球，第一次转完有米级的偏差，再按 to 下面的新点修正一次
    for (let step = 0; step < PAN_STEPS && end; step++) {
      const axis = Cartesian3.cross(start, end, new Cartesian3());
      if (Cartesian3.magnitude(axis) < MIN_PAN_AXIS) {
        break;
      }
      camera.rotate(Cartesian3.normalize(axis, axis), Cartesian3.angleBetween(start, end));
      end = camera.pickEllipsoid(target, Ellipsoid.WGS84);
    }
    scene.requestRender();
  }

  pick({ x, y }: ScreenPoint): PickResult {
    const { scene, camera } = this.#widget;
    const position = new Cartesian2(x, y);
    if (scene.pickPositionSupported) {
      const picked: unknown = scene.pick(position);
      const world = isModel(picked) ? scene.pickPosition(position) : undefined;
      if (world) {
        return this.#hit('model', world);
      }
    }
    // 本阶段没有地形，地球就是椭球（ADR 0079 第 5 节）
    const ground = camera.pickEllipsoid(position, Ellipsoid.WGS84);
    return ground ? this.#hit('ellipsoid', ground) : { kind: 'miss' };
  }

  project([lng, lat]: LngLat, height = 0): ScreenPoint | null {
    const { scene, camera } = this.#widget;
    const world = Cartesian3.fromDegrees(lng, lat, height);
    // 在地球背面、相机背后的点不投影
    if (!new EllipsoidalOccluder(Ellipsoid.WGS84, camera.positionWC).isPointVisible(world)) {
      return null;
    }
    const toPoint = Cartesian3.subtract(world, camera.positionWC, new Cartesian3());
    if (Cartesian3.dot(toPoint, camera.directionWC) <= 0) {
      return null;
    }
    const onScreen = SceneTransforms.worldToWindowCoordinates(scene, world);
    return onScreen ? { x: onScreen.x, y: onScreen.y } : null;
  }

  eyeHeight(): number {
    return this.#widget.camera.positionCartographic.height;
  }

  size(): { width: number; height: number } {
    const { canvas } = this.#widget;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  setImagery(imagery: readonly ImageryPlan[]): void {
    const layers = this.#widget.imageryLayers;
    for (const [id, entry] of this.#imagery) {
      const plan = imagery.find(item => item.id === id);
      if (!plan || !sameProvider(plan, entry.plan)) {
        this.#removeEntry(id, entry);
      }
    }
    for (const plan of imagery) {
      const entry = this.#imagery.get(plan.id) ?? this.#addEntry(plan);
      entry.layer.alpha = plan.opacity;
      entry.layer.show = plan.show;
    }
    // 依次提到最上面，最后的在最上面：和样式里图层的顺序一致
    for (const plan of imagery) {
      const entry = this.#imagery.get(plan.id);
      if (entry) {
        layers.raiseToTop(entry.layer);
      }
    }
    this.#settled = false;
    this.#widget.scene.requestRender();
  }

  setBaseColor(color: string | null): void {
    this.#widget.scene.globe.baseColor = Color.fromCssColorString(color ?? DEFAULT_BASE_COLOR);
    this.#widget.scene.requestRender();
  }

  setOverlays(layers: readonly OverlayLayer[]): void {
    const { entities } = this.#widget;
    const ids = new Set(layers.map(({ id }) => id));
    entities.suspendEvents();
    try {
      for (const [id, entry] of this.#overlays) {
        if (!ids.has(id)) {
          this.#removeOverlay(id, entry);
        }
      }
      for (const layer of layers) {
        const entry = this.#overlays.get(layer.id);
        if (entry?.layer === layer) {
          continue;
        }
        if (entry && this.#moveOverlay(entry, layer)) {
          continue;
        }
        if (entry) {
          this.#retiring.push(...entry.items.map(({ entity }) => entity));
          this.#overlays.delete(layer.id);
        }
        this.#overlays.set(layer.id, { layer, items: layer.shapes.map(shape => this.#addShape(shape, layer.order)) });
      }
    } finally {
      entities.resumeEvents();
    }
    this.#settled = false;
    this.#widget.scene.requestRender();
  }

  setGestures({ drag }: SceneGestures): void {
    const controller = this.#widget.scene.screenSpaceCameraController;
    controller.enableRotate = drag;
    controller.enableTranslate = drag;
  }

  setCursor(cursor: string | undefined): void {
    this.#widget.canvas.style.cursor = cursor ?? '';
  }

  focus(): void {
    this.#widget.canvas.focus({ preventScroll: true });
  }

  setRendering(active: boolean): void {
    this.#widget.useDefaultRenderLoop = active;
    if (active) {
      this.#widget.scene.requestRender();
    }
  }

  resize(): void {
    this.#widget.resize();
    this.#applyFov();
    this.#widget.scene.requestRender();
    this.#emitter.emit('resize');
  }

  on<E extends keyof SceneEvents>(event: E, callback: SceneEvents[E]): Unsubscribe {
    return this.#emitter.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#emitter.events = {};
    this.#stack.dispose();
  }

  // 目标点和相机相对它的偏移：画布中心正好是目标点，和 readCamera 互逆
  #placement({ center: [lng, lat], zoom, bearing, pitch }: CameraState) {
    const { height } = this.size();
    if (height <= 0) {
      return null;
    }
    const distance = zoomToDistance(zoom, lat, height, MAPLIBRE_FOVY);
    const offset = new HeadingPitchRange(
      CesiumMath.toRadians(bearing),
      CesiumMath.toRadians(writablePitch(pitch) - 90),
      distance
    );
    return { target: Cartesian3.fromDegrees(lng, lat), offset };
  }

  #hit(surface: 'model' | 'ellipsoid', world: Cartesian3): PickResult {
    const { longitude, latitude, height } = Cartographic.fromCartesian(world);
    return {
      kind: 'hit',
      surface,
      lngLat: [CesiumMath.toDegrees(longitude), CesiumMath.toDegrees(latitude)],
      height
    };
  }

  // 竖直视场角对齐二维（ADR 0079 第 4 节）；Cesium 在宽屏时把 fov 当作水平视场角
  #applyFov(): void {
    const { width, height } = this.size();
    const { frustum } = this.#widget.camera;
    if (width > 0 && height > 0 && frustum instanceof PerspectiveFrustum) {
      frustum.fov = frustumFov(MAPLIBRE_FOVY, width / height);
    }
  }

  #toPointerEvent(type: PointerType, event: MouseEvent): MapPointerEvent {
    const box = this.#widget.canvas.getBoundingClientRect();
    return {
      type: POINTER_TYPES[type],
      point: { x: event.clientX - box.left, y: event.clientY - box.top },
      button: event.button,
      clickCount: event.detail,
      modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey }
    };
  }

  #onCameraChange(): void {
    this.#moving = true;
    this.#settled = false;
    this.#emitter.emit('camerachange');
  }

  #onCameraIdle(): void {
    this.#moving = false;
    this.#emitter.emit('cameraidle');
    this.#widget.scene.requestRender();
  }

  // 所有实体都画好了才移除被替换的：在那之前新旧都在，半透明的线短暂地叠深一些
  #removeRetired(): void {
    if (this.#retiring.length === 0 || !this.#widget.dataSourceDisplay.ready) {
      return;
    }
    for (const entity of this.#retiring) {
      this.#widget.entities.remove(entity);
    }
    this.#retiring = [];
    this.#widget.scene.requestRender();
  }

  // 相机停下、影像瓦片和覆盖物都画好了才算稳定
  #checkSettled(): void {
    const { scene, dataSourceDisplay } = this.#widget;
    const drawn = scene.globe.tilesLoaded && dataSourceDisplay.ready && this.#retiring.length === 0;
    if (!this.#settled && !this.#moving && drawn) {
      this.#settled = true;
      this.#emitter.emit('settle');
    }
  }

  #addEntry(plan: ImageryPlan): ImageryEntry {
    const provider = new UrlTemplateImageryProvider({
      url: plan.url,
      subdomains: [...plan.subdomains],
      tileWidth: plan.tileSize,
      tileHeight: plan.tileSize,
      minimumLevel: plan.minimumLevel,
      maximumLevel: plan.maximumLevel
    });
    const layer = this.#widget.imageryLayers.addImageryProvider(provider);
    const unsubscribe = provider.errorEvent.addEventListener((error: unknown) =>
      this.#emitter.emit('imageryerror', plan.sourceId, error)
    );
    const entry: ImageryEntry = { plan, layer, unsubscribe };
    this.#imagery.set(plan.id, entry);
    return entry;
  }

  #removeEntry(id: string, entry: ImageryEntry): void {
    entry.unsubscribe();
    this.#widget.imageryLayers.remove(entry.layer, true);
    this.#imagery.delete(id);
  }

  #removeImagery(): void {
    for (const [id, entry] of this.#imagery) {
      this.#removeEntry(id, entry);
    }
  }

  // 贴地的线和面按样式里的顺序叠放；点不被地球遮挡（ADR 0080 第 1 节）
  #addShape(shape: OverlayShape, order: number): OverlayItem {
    const { entities } = this.#widget;
    if (shape.kind === 'line') {
      const color = colorOf(shape.color);
      const geometry = positionsOf(shape.path);
      const material = shape.dash
        ? new PolylineDashMaterialProperty({ color, dashLength: shape.dash.length, dashPattern: shape.dash.pattern })
        : new ColorMaterialProperty(color);
      const entity = entities.add({
        polyline: { positions: geometry, width: shape.width, material, clampToGround: true, zIndex: order }
      });
      return { entity, geometry, live: false };
    }
    if (shape.kind === 'polygon') {
      const geometry = hierarchyOf(shape.rings);
      const entity = entities.add({
        polygon: {
          hierarchy: geometry,
          material: colorOf(shape.color),
          classificationType: ClassificationType.TERRAIN,
          zIndex: order
        }
      });
      return { entity, geometry, live: false };
    }
    const [position] = positionsOf([shape.position]);
    const entity = entities.add({
      position,
      point: {
        pixelSize: shape.radius * 2,
        color: colorOf(shape.color),
        outlineColor: colorOf(shape.strokeColor),
        outlineWidth: shape.strokeWidth,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    return { entity, geometry: position ? [position] : [], live: false };
  }

  // 样式和形状个数都没变：只换坐标。第一次换时改成每帧读取，之后的变化不再重建几何
  #moveOverlay(entry: OverlayEntry, layer: OverlayLayer): boolean {
    const { shapes } = layer;
    const previous = entry.layer.shapes;
    const restyled = shapes.some((shape, index) => !sameStyle(shape, previous[index] ?? shape));
    if (shapes.length !== previous.length || restyled) {
      return false;
    }
    for (const [index, shape] of shapes.entries()) {
      const item = entry.items[index];
      if (item) {
        this.#moveShape(item, shape);
      }
    }
    entry.layer = layer;
    return true;
  }

  #moveShape(item: OverlayItem, shape: OverlayShape): void {
    const { entity } = item;
    if (shape.kind === 'point') {
      // 点的位置本来就是每帧更新的，直接换
      entity.position = new ConstantPositionProperty(positionsOf([shape.position])[0]);
      return;
    }
    item.geometry = shape.kind === 'line' ? positionsOf(shape.path) : hierarchyOf(shape.rings);
    if (item.live) {
      return;
    }
    item.live = true;
    const read = new CallbackProperty(() => item.geometry, false);
    if (entity.polyline) {
      entity.polyline.positions = read;
    }
    if (entity.polygon) {
      entity.polygon.hierarchy = read;
    }
  }

  #removeOverlay(id: string, entry: OverlayEntry): void {
    for (const { entity } of entry.items) {
      this.#widget.entities.remove(entity);
    }
    this.#overlays.delete(id);
  }
}

/** 创建真实的三维场景 */
export const createCesiumScene: CreateScene = container => new CesiumScene(container);
