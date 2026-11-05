import { TilesRenderer } from '3d-tiles-renderer';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { MercatorCoordinate } from 'maplibre-gl';
import {
  AmbientLight,
  BoxGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import { ecefToEnuMatrix, meridionalRadius, primeVerticalRadius } from './common.ts';

const MAPLIBRE_EARTH_RADIUS = 6371008.8;

/** 局部系（东、上、南，米）到 MapLibre 墨卡托世界：按 WGS84 椭球算比例，竖直方向和 MapLibre 的高度比例一致 */
export function enuToMercator(lng: number, lat: number): Matrix4 {
  const anchor = MercatorCoordinate.fromLngLat([lng, lat], 0);
  const cos = Math.cos((lat * Math.PI) / 180);
  const east = 1 / (2 * Math.PI * primeVerticalRadius(lat) * cos);
  const north = 1 / (2 * Math.PI * meridionalRadius(lat) * cos);
  const up = anchor.meterInMercatorCoordinateUnits();
  return new Matrix4().set(east, 0, 0, anchor.x, 0, 0, north, anchor.y, 0, up, 0, anchor.z, 0, 0, 0, 1);
}

/** 局部系（东、上、南，米）到 MapLibre 地球的单位球：x = sinλcosφ，y = sinφ，z = cosλcosφ */
export function enuToGlobe(lng: number, lat: number): Matrix4 {
  const lon = (lng * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const east = new Vector3(Math.cos(lon), 0, -Math.sin(lon));
  const up = new Vector3(Math.sin(lon) * Math.cos(la), Math.sin(la), Math.cos(lon) * Math.cos(la));
  const north = new Vector3(-Math.sin(lon) * Math.sin(la), Math.cos(la), -Math.cos(lon) * Math.sin(la));
  const e = east.clone().multiplyScalar(1 / primeVerticalRadius(lat));
  const u = up.clone().multiplyScalar(1 / MAPLIBRE_EARTH_RADIUS);
  const s = north.clone().multiplyScalar(-1 / meridionalRadius(lat));
  return new Matrix4().makeBasis(e, u, s).setPosition(up);
}

/**
 * 不用 maplibre-gl-three 的自写层：一个层一个瓦片集，锚点固定在模型中心。
 * 和库的两点不同：地球模式下也画；过渡段按 MapLibre 着色器的 mix(flat, globe, t) 在裁剪空间插值
 */
export class OwnTilesLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom';
  readonly renderingMode = '3d';
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly tiles: TilesRenderer;
  renderer: WebGLRenderer | null = null;
  map: MlMap | null = null;
  horizonHidden = false;
  readonly #lng: number;
  readonly #lat: number;
  readonly #toMercator: Matrix4;
  readonly #toGlobe: Matrix4;
  readonly #combined = new Matrix4();
  readonly #flat = new Matrix4();
  readonly #globe = new Matrix4();
  readonly #view = new Matrix4();
  readonly #scale = new Vector3();

  constructor(id: string, url: string, lng: number, lat: number) {
    this.id = id;
    this.#lng = lng;
    this.#lat = lat;
    this.#toMercator = enuToMercator(lng, lat);
    this.#toGlobe = enuToGlobe(lng, lat);
    this.tiles = new TilesRenderer(url);
    this.scene.matrixAutoUpdate = false;
    this.camera.matrixAutoUpdate = false;
    this.scene.matrix.copy(ecefToEnuMatrix(lng, lat, 0));
    this.scene.add(this.tiles.group);
    this.scene.add(new AmbientLight(0xffffff, 3));
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext });
    this.renderer.autoClear = false;
    this.tiles.setCamera(this.camera);
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.addEventListener('needs-update', () => map.triggerRepaint());
  }

  onRemove(): void {
    this.tiles.deleteCamera(this.camera);
    this.tiles.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    if (!this.renderer || !this.map) {
      return;
    }
    const data = args.defaultProjectionData;
    const t = data.projectionTransition;
    // 球背面：MapLibre 用裁剪面丢弃，这里按模型中心整体隐藏
    if (t > 0) {
      const up = new Vector3().setFromMatrixPosition(this.#toGlobe);
      const plane = data.clippingPlane;
      this.horizonHidden = up.x * plane[0] + up.y * plane[1] + up.z * plane[2] + plane[3] < 0;
      if (this.horizonHidden) {
        return;
      }
    } else {
      this.horizonHidden = false;
    }
    if (t <= 0) {
      this.#combined.fromArray(data.mainMatrix as ArrayLike<number> as number[]).multiply(this.#toMercator);
    } else {
      this.#globe.fromArray(data.mainMatrix as ArrayLike<number> as number[]).multiply(this.#toGlobe);
      if (t >= 1) {
        this.#combined.copy(this.#globe);
      } else {
        this.#flat.fromArray(data.fallbackMatrix as ArrayLike<number> as number[]).multiply(this.#toMercator);
        const out = this.#combined.elements;
        for (let i = 0; i < 16; i += 1) {
          out[i] = MathUtils.lerp(this.#flat.elements[i], this.#globe.elements[i], t);
        }
      }
    }
    this.#syncCamera(args);
    this.scene.updateMatrixWorld(true);
    const canvas = this.renderer.domElement;
    this.tiles.setResolution(this.camera, canvas.width, canvas.height);
    this.tiles.update();
    this.renderer.resetState();
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
  }

  /** 把模型整体抬高：MapLibre 把相机夹在 0 米以上，地下的模型抬高后才能走进去 */
  setLift(metres: number): void {
    this.scene.matrix.copy(new Matrix4().makeTranslation(0, metres, 0).multiply(ecefToEnuMatrix(this.#lng, this.#lat, 0)));
    this.scene.matrixWorldNeedsUpdate = true;
    this.map?.triggerRepaint();
  }

  /** 在锚点放一个边长 sizeM 米的立方体，低级别也能看出模型在球面上的位置和朝向 */
  addMarker(sizeM: number, color = 0xff3300): void {
    const mesh = new Mesh(new BoxGeometry(sizeM, sizeM, sizeM), new MeshBasicMaterial({ color }));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.scene.matrix).invert().multiply(new Matrix4().makeTranslation(0, sizeM / 2, 0));
    this.scene.add(mesh);
    this.map?.triggerRepaint();
  }

  /** 屏幕位置，单位 CSS 像素；只用于测量 */
  project(lngLatHeightEnu: Vector3): { x: number; y: number } {
    const canvas = this.renderer?.domElement;
    if (!canvas) {
      throw new Error('未加到地图');
    }
    const clip = lngLatHeightEnu.clone().applyMatrix4(this.camera.matrixWorldInverse).applyMatrix4(this.camera.projectionMatrix);
    return { x: ((clip.x + 1) / 2) * canvas.clientWidth, y: ((1 - clip.y) / 2) * canvas.clientHeight };
  }

  get anchor(): readonly [number, number] {
    return [this.#lng, this.#lat];
  }

  // 同 maplibre-gl-three 的 MapCameraSync：从完整矩阵拆出相机位姿和投影
  #syncCamera(args: CustomRenderMethodInput): void {
    const { camera } = this;
    this.#view
      .fromArray(args.projectionMatrix as ArrayLike<number> as number[])
      .invert()
      .multiply(this.#combined);
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
  }
}
