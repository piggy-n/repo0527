import type { CameraState, LngLat, MapPointerEvent, PickResult, ScreenPoint, Unsubscribe } from '@yzt/map-core';
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileFeature,
  Cesium3DTileset,
  CesiumWidget,
  Color,
  Ellipsoid,
  EllipsoidalOccluder,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
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
import type { ImageryPlan } from './scene-style';

// 没有 background 图层时地球的底色（旧项目的取值）
const DEFAULT_BASE_COLOR = '#dfe7f2';

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

/** 唯一调用 Cesium 的门面（ADR 0079 第 3 节）：CesiumView 通过 SceneLike 使用它 */
export class CesiumScene implements SceneLike {
  readonly #widget: CesiumWidget;
  readonly #emitter = createNanoEvents<SceneEvents>();
  readonly #stack: DisposableStack;
  readonly #imagery = new Map<string, ImageryEntry>();
  #flying = false;
  // 相机在动时不算画面稳定；相机、影像变了以后重新等一次
  #moving = false;
  #settled = false;

  constructor(container: HTMLElement) {
    using stack = new DisposableStack();
    let widget: CesiumWidget;
    try {
      widget = new CesiumWidget(container, {
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
    stack.defer(scene.postRender.addEventListener(() => this.#checkSettled()));
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

  #checkSettled(): void {
    if (!this.#settled && !this.#moving && this.#widget.scene.globe.tilesLoaded) {
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
}

/** 创建真实的三维场景 */
export const createCesiumScene: CreateScene = container => new CesiumScene(container);
