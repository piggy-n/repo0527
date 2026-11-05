// Cesium 对照组：瓦片集、缓存、钻地和相机换算直接用 packages/map-cesium 的源码，
// 不用 CesiumScene 本身，因为它把 CesiumWidget 藏在私有字段里，读不到统计和瓦片集。场景的创建参数和它保持一致
import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import {
  Cartesian3,
  Cesium3DTileset,
  CesiumWidget,
  Color,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  UrlTemplateImageryProvider
} from 'cesium';
import { frustumFov, MAPLIBRE_FOVY, writablePitch, zoomToDistance } from '../../../../../packages/map-cesium/src/camera-math.ts';
import { setCesiumBaseUrl } from '../../../../../packages/map-cesium/src/runtime.ts';
import { SceneTilesets } from '../../../../../packages/map-cesium/src/scene-tilesets.ts';
import { footprintOf, SceneUnderground } from '../../../../../packages/map-cesium/src/scene-underground.ts';
import { type ModelId, MODELS } from '../common.ts';
import { prepareTileset } from '../../../../../packages/map-core/src/scene/prepare-tileset.ts';
import { type BenchCamera, bindWalkKeys, isEye, numberParam, parseCenter, parseEye, publish } from './api.ts';

const params = new URLSearchParams(location.search);
const modelIds = (params.get('models') ?? '').split(',').filter(Boolean) as ModelId[];
const noBasemap = params.get('basemap') === 'none';
const underground = params.get('underground') === '1';
const eye = parseEye(params.get('eye'));
const errors: string[] = [];
window.addEventListener('error', event => errors.push(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String(event.reason)}`));

setCesiumBaseUrl('/cesium/');

const container = document.querySelector<HTMLElement>('#map');
if (!container) {
  throw new Error('缺少容器');
}

// 和 packages/map-cesium/src/cesium-scene.ts 的构造函数相同
const widget = new CesiumWidget(container, {
  baseLayer: false,
  skyBox: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Number.POSITIVE_INFINITY,
  creditContainer: document.createElement('div'),
  showRenderLoopErrors: false,
  contextOptions: { webgl: { powerPreference: 'high-performance' } }
});
const { scene, camera } = widget;
// 没有 background 图层时的底色和方案 C 的页面相同
scene.globe.baseColor = Color.fromCssColorString('#20262c');
scene.globe.showGroundAtmosphere = false;
camera.percentageChanged = 0.001;
// 默认按浏览器推荐分辨率、忽略 devicePixelRatio；对比时两个引擎的像素数要相同
widget.useBrowserRecommendedResolution = false;
widget.resolutionScale = 1;
scene.renderError.addEventListener((_scene, error: unknown) => errors.push(`render: ${String(error)}`.slice(0, 300)));

let renders = 0;
scene.postRender.addEventListener(() => {
  renders += 1;
});

const fovy = params.get('fovy') ? CesiumMath.toRadians(Number(params.get('fovy'))) : MAPLIBRE_FOVY;
function applyFov(): void {
  const { frustum } = camera;
  const { clientWidth: width, clientHeight: height } = widget.canvas;
  if (width > 0 && height > 0 && frustum instanceof PerspectiveFrustum) {
    frustum.fov = frustumFov(fovy, width / height);
  }
}
applyFov();

const applyCamera = (target: BenchCamera) => {
  if (isEye(target)) {
    camera.setView({
      destination: Cartesian3.fromDegrees(target.lng, target.lat, target.height),
      orientation: {
        heading: CesiumMath.toRadians(target.heading),
        pitch: CesiumMath.toRadians(target.pitch),
        roll: 0
      }
    });
  } else {
    // 同 CesiumScene.jumpTo：画布中心的地面点和 MapLibre 的相机相同
    const [lng, lat] = target.center;
    const distance = zoomToDistance(target.zoom, lat, widget.canvas.clientHeight, MAPLIBRE_FOVY);
    const offset = new HeadingPitchRange(
      CesiumMath.toRadians(target.bearing),
      CesiumMath.toRadians(writablePitch(target.pitch) - 90),
      distance
    );
    camera.lookAt(Cartesian3.fromDegrees(lng, lat), offset);
    camera.lookAtTransform(Matrix4.IDENTITY);
  }
  scene.requestRender();
};

const center = parseCenter(params.get('center'), MODELS[modelIds[0] ?? 'station'].center);
applyCamera(
  eye ?? {
    center,
    zoom: numberParam(params, 'zoom', 16),
    bearing: numberParam(params, 'bearing', 0),
    pitch: numberParam(params, 'pitch', 0)
  }
);

if (!noBasemap) {
  // 和方案 C 相同的影像地址和级别上限
  const provider = new UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 19
  });
  widget.imageryLayers.addImageryProvider(provider);
}

const lighting = underground ? 'headlight' : 'sun';
const loadStartedAt = performance.now();
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
for (const id of modelIds) {
  const prepared = await prepareTileset(new URL(MODELS[id].url, location.href).href, loadJson, new AbortController().signal);
  await tilesets.add(id, prepared, { show: true, lighting }, new AbortController().signal);
}

if (underground) {
  const sphere = tilesets.boundingSphere(modelIds[0]);
  if (sphere) {
    // 不透明度同 features/scene-models 的 SURFACE_OPACITY
    new SceneUnderground(widget).set(footprintOf(sphere), 0.25);
  }
}
applyFov();

if (eye && params.get('walk') === '1') {
  scene.screenSpaceCameraController.enableInputs = false;
  bindWalkKeys(widget.canvas, eye, applyCamera);
}

function allTilesets(): Cesium3DTileset[] {
  const out: Cesium3DTileset[] = [];
  for (let i = 0; i < scene.primitives.length; i += 1) {
    const primitive: unknown = scene.primitives.get(i);
    if (primitive instanceof Cesium3DTileset) {
      out.push(primitive);
    }
  }
  return out;
}

publish({
  engine: 'cesium',
  config: {
    maximumScreenSpaceError: allTilesets()[0]?.maximumScreenSpaceError,
    cacheMB: Math.round((allTilesets()[0]?.cacheBytes ?? 0) / 1048576),
    overflowMB: Math.round((allTilesets()[0]?.maximumCacheOverflowBytes ?? 0) / 1048576),
    msaaSamples: scene.msaaSamples,
    fovyDeg: CesiumMath.toDegrees(fovy),
    lighting,
    underground
  },
  gl: (widget.canvas.getContext('webgl2') as WebGL2RenderingContext),
  loadStartedAt,
  errors,
  isStable: () => {
    const all = allTilesets();
    return (
      all.length > 0 &&
      all.every(
        tileset =>
          tileset.tilesLoaded &&
          tileset.statistics.numberOfPendingRequests === 0 &&
          tileset.statistics.numberOfTilesProcessing === 0
      )
    );
  },
  basemapIdle: () => noBasemap || scene.globe.tilesLoaded,
  tick: () => scene.requestRender(),
  setContinuous(on) {
    scene.requestRenderMode = !on;
    scene.requestRender();
  },
  setCamera: applyCamera,
  setModelVisible(show) {
    for (const id of modelIds) {
      tilesets.update(id, { show, lighting });
    }
  },
  renders: () => renders,
  stats() {
    const all = allTilesets();
    const sum = (read: (tileset: Cesium3DTileset) => number) => all.reduce((total, tileset) => total + read(tileset), 0);
    return {
      tilesVisible: sum(tileset => tileset.statistics.selected),
      // Cesium 没有 refused；缓存不够时它提高屏幕误差，看 memoryAdjustedScreenSpaceError
      tilesRefused: null,
      memoryAdjustedSse: Math.max(...all.map(tileset => tileset.memoryAdjustedScreenSpaceError)),
      engineCacheMB: Math.round(sum(tileset => tileset.totalMemoryUsageInBytes) / 1048576),
      engineCalls: sum(tileset => tileset.statistics.numberOfCommands),
      engineTriangles: sum(tileset => tileset.statistics.numberOfTrianglesSelected),
      tilesFailed: null
    };
  }
});
