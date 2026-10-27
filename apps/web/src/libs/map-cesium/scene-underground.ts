import {
  type BoundingSphere,
  Cartesian3,
  type CesiumWidget,
  Color,
  Ellipsoid,
  type GlobeTranslucency,
  NearFarScalar,
  Rectangle
} from 'cesium';

// 钻地观察窗比模型四周宽出这么多（米）
const FOOTPRINT_MARGIN = 40;
// 土层颜色、相机在地下时的背景色（旧项目的取值）：地下往上看是土，地表半透明时瓦片缝透出的背景也看不出来
const SOIL = Color.fromCssColorString('#2a2d31');
const UNDERGROUND_BACKGROUND = Color.fromCssColorString('#1e2226');
// 土层在任何距离都不透明；不能设成 undefined，Cesium 会退回全 0 的默认值，等于关掉土层
const SOIL_ALPHA_BY_DISTANCE = new NearFarScalar(1, 1, 2, 1);
// 离相机 near 米以内的地表按设定的不透明度，到 near × FADE 渐变回不透明；near 随相机离地高度放大，最多 3 千米，
// 再高整片都不透明：整个地表一起变透明，从高处会隔着地球看到另一面，四周也全是土层
const CLEAR_NEAR = 150;
const CLEAR_MAX = 3000;
const CLEAR_HEIGHT_FACTOR = 1.5;
const CLEAR_FADE = 4;
const OPAQUE = new NearFarScalar(1, 1, 2, 1);
// 退出时相机在地下，先飞到地表以上这个高度
const EXIT_HEIGHT = 120;

// Cesium 的类型声明把按距离的透明度写成必有，实际默认值是 undefined，表示不按距离变化
interface DistanceAlphas {
  frontFaceAlphaByDistance: NearFarScalar | undefined;
  backFaceAlphaByDistance: NearFarScalar | undefined;
}

const distanceAlphas = (translucency: GlobeTranslucency): DistanceAlphas => translucency;

/** 模型占地的经纬度矩形，四周外扩 FOOTPRINT_MARGIN 米 */
export function footprintOf(sphere: BoundingSphere): Rectangle {
  const rectangle = Rectangle.fromBoundingSphere(sphere);
  const latitude = (rectangle.north + rectangle.south) / 2;
  const radius = Ellipsoid.WGS84.maximumRadius;
  const dLat = FOOTPRINT_MARGIN / radius;
  const dLon = FOOTPRINT_MARGIN / (radius * Math.cos(latitude));
  return new Rectangle(rectangle.west - dLon, rectangle.south - dLat, rectangle.east + dLon, rectangle.north + dLat);
}

/** 离相机多远以内的地表透明；相机太高时整片不透明 */
export function clearDistance(cameraHeight: number): number | null {
  const near = Math.max(CLEAR_NEAR, Math.abs(cameraHeight) * CLEAR_HEIGHT_FACTOR);
  return near > CLEAR_MAX ? null : near;
}

interface Defaults {
  readonly collision: boolean;
  readonly minimumZoomDistance: number;
  readonly depthTest: boolean;
  readonly color: Color;
  readonly colorDistance: NearFarScalar | undefined;
  readonly background: Color;
  readonly near: number;
  readonly translucent: boolean;
  readonly frontAlpha: number;
  readonly backAlpha: number;
  readonly frontDistance: NearFarScalar | undefined;
  readonly backDistance: NearFarScalar | undefined;
  readonly rectangle: Rectangle;
}

/**
 * 钻地观察（ADR 0081 第 6 节，沿用旧项目的做法）：观察窗里、离相机不远的地表半透明，地下是土层；
 * 退出时恢复进入前的设置，相机在地下的先飞回地表上方
 */
export class SceneUnderground implements Disposable {
  readonly #widget: CesiumWidget;
  #defaults: Defaults | null = null;
  #opacity = 1;
  #removeWatch: (() => void) | null = null;

  constructor(widget: CesiumWidget) {
    this.#widget = widget;
  }

  get active(): boolean {
    return this.#defaults !== null;
  }

  /** 进入或更新钻地；footprint 为 null 时退出 */
  set(footprint: Rectangle | null, surfaceOpacity: number): void {
    if (footprint === null) {
      this.#leave();
      return;
    }
    const { scene, camera } = this.#widget;
    const { globe, screenSpaceCameraController: controller } = scene;
    const translucency = globe.translucency;
    if (!this.#defaults) {
      this.#defaults = {
        collision: controller.enableCollisionDetection,
        minimumZoomDistance: controller.minimumZoomDistance,
        depthTest: globe.depthTestAgainstTerrain,
        color: Color.clone(globe.undergroundColor),
        colorDistance: NearFarScalar.clone(globe.undergroundColorAlphaByDistance),
        background: Color.clone(scene.backgroundColor),
        near: camera.frustum.near,
        translucent: translucency.enabled,
        frontAlpha: translucency.frontFaceAlpha,
        backAlpha: translucency.backFaceAlpha,
        frontDistance: NearFarScalar.clone(translucency.frontFaceAlphaByDistance),
        backDistance: NearFarScalar.clone(translucency.backFaceAlphaByDistance),
        rectangle: Rectangle.clone(translucency.rectangle)
      };
      controller.enableCollisionDetection = false;
      // 不能设为 0，否则滚轮会在地表被再次截停
      controller.minimumZoomDistance = 0.1;
      globe.depthTestAgainstTerrain = true;
      globe.undergroundColor = Color.clone(SOIL);
      globe.undergroundColorAlphaByDistance = SOIL_ALPHA_BY_DISTANCE;
      camera.frustum.near = 0.1;
      translucency.enabled = true;
      // 透明度全由按距离的那组值决定（Cesium 会把两者相乘）
      translucency.frontFaceAlpha = 1;
      translucency.backFaceAlpha = 1;
      // 背面不按距离变化
      distanceAlphas(translucency).backFaceAlphaByDistance = undefined;
      this.#removeWatch = scene.preRender.addEventListener(() => this.#follow());
    }
    translucency.rectangle = footprint;
    this.#opacity = surfaceOpacity;
    this.#follow();
    scene.requestRender();
  }

  [Symbol.dispose](): void {
    this.#restore();
  }

  // 每帧按相机的离地高度调整透明范围，相机进到地下时换背景
  #follow(): void {
    const { scene, camera } = this.#widget;
    const height = camera.positionCartographic.height;
    const near = clearDistance(height);
    scene.globe.translucency.frontFaceAlphaByDistance =
      near === null ? OPAQUE : new NearFarScalar(near, this.#opacity, near * CLEAR_FADE, 1);
    const background = height < 0 ? UNDERGROUND_BACKGROUND : this.#defaults?.background;
    if (background && !Color.equals(scene.backgroundColor, background)) {
      scene.backgroundColor = Color.clone(background);
    }
  }

  // 相机在地下时先平滑飞回地表上方，飞到了再恢复：半路恢复碰撞检测会把相机截停
  #leave(): void {
    if (!this.#defaults) {
      return;
    }
    const { camera } = this.#widget;
    const position = camera.positionCartographic;
    if (position.height >= 0) {
      this.#restore();
      return;
    }
    this.#removeWatch?.();
    this.#removeWatch = null;
    camera.flyTo({
      destination: Cartesian3.fromRadians(position.longitude, position.latitude, EXIT_HEIGHT),
      orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
      duration: 0.8,
      complete: () => this.#restore(),
      cancel: () => this.#restore()
    });
  }

  #restore(): void {
    const defaults = this.#defaults;
    if (!defaults) {
      return;
    }
    this.#defaults = null;
    this.#removeWatch?.();
    this.#removeWatch = null;
    const { scene, camera } = this.#widget;
    const { globe, screenSpaceCameraController: controller } = scene;
    const translucency = globe.translucency;
    controller.enableCollisionDetection = defaults.collision;
    controller.minimumZoomDistance = defaults.minimumZoomDistance;
    globe.depthTestAgainstTerrain = defaults.depthTest;
    globe.undergroundColor = defaults.color;
    globe.undergroundColorAlphaByDistance = defaults.colorDistance ?? SOIL_ALPHA_BY_DISTANCE;
    scene.backgroundColor = defaults.background;
    camera.frustum.near = defaults.near;
    translucency.enabled = defaults.translucent;
    translucency.frontFaceAlpha = defaults.frontAlpha;
    translucency.backFaceAlpha = defaults.backAlpha;
    distanceAlphas(translucency).frontFaceAlphaByDistance = defaults.frontDistance;
    distanceAlphas(translucency).backFaceAlphaByDistance = defaults.backDistance;
    translucency.rectangle = defaults.rectangle;
    scene.requestRender();
  }
}
