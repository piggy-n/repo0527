// 方案 C 的测量页：只有底图和模型，没有面板、定时器和测试图层，不让页面自己的工作混进测量
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  type LngLatLike,
  LngLat,
  Map as MlMap,
  setWorkerUrl,
  type StyleSpecification
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type ModelId, MODELS, offsetLngLat, preparedTilesetUrl } from '../common.ts';
import manifest from '../manifest.json';
import { OwnTilesLayer } from '../own-layer.ts';
import { RoamScene } from '../roam-scene.ts';
import { type BenchCamera, type BenchEye, bindWalkKeys, isEye, numberParam, parseCenter, parseEye, publish } from './api.ts';

const params = new URLSearchParams(location.search);
const modelIds = (params.get('models') ?? '').split(',').filter(Boolean) as ModelId[];
const noBasemap = params.get('basemap') === 'none';
const cacheMB = numberParam(params, 'lruMB', 0);
const eye = parseEye(params.get('eye'));
const interactive = params.get('walk') === '1';
const errors: string[] = [];
window.addEventListener('error', event => errors.push(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String(event.reason)}`));

interface TilesInternals {
  readonly stats: Readonly<Record<string, number>>;
  readonly visibleTiles: ReadonlySet<unknown>;
  readonly lruCache: { readonly cachedBytes?: number; maxBytesSize: number; minBytesSize: number };
  readonly group: { visible: boolean };
  errorTarget: number;
}

const internals = (tiles: unknown) => tiles as TilesInternals;

function queuesEmpty(tiles: TilesInternals): boolean {
  const { stats } = tiles;
  return stats.downloading === 0 && stats.parsing === 0 && stats.queued === 0;
}

// ---------- 独立 Three 场景 ----------

async function startRoam(): Promise<void> {
  const container = document.querySelector<HTMLElement>('#map');
  if (!container) {
    throw new Error('缺少容器');
  }
  const loadStartedAt = performance.now();
  const spawn = manifest.models[0].spawn as { lng: number; lat: number; height: number; heading: number };
  const fovy = numberParam(params, 'fovy', 60);
  const tilesetUrl = await preparedTilesetUrl(MODELS.station.url);
  const scene = new RoamScene({
    container,
    tilesetUrl,
    origin: [spawn.lng, spawn.lat],
    spawn,
    errorTarget: 16,
    fovy,
    pixelRatio: window.devicePixelRatio
  });
  const tiles = internals(scene.tiles);
  let models = 0;
  (scene.tiles as unknown as { addEventListener(type: string, listener: () => void): void }).addEventListener('load-model', () => {
    models += 1;
  });
  const apply = ({ lng, lat, height, heading, pitch }: BenchEye) => scene.setPose(lng, lat, height, heading, pitch);
  if (eye) {
    apply(eye);
  }
  publish({
    engine: 'three（独立场景）',
    config: { errorTarget: tiles.errorTarget, fovy, antialias: true, cacheMB: 'LRU 默认 400 MB' },
    gl: scene.renderer.getContext() as WebGL2RenderingContext,
    loadStartedAt,
    errors: scene.errors,
    isStable: () => models > 0 && queuesEmpty(tiles),
    basemapIdle: () => true,
    tick() {},
    setContinuous() {},
    setCamera(camera: BenchCamera) {
      if (isEye(camera)) {
        apply(camera);
      }
    },
    setModelVisible(visible) {
      tiles.group.visible = visible;
    },
    renders: () => scene.frames,
    stats: () => ({
      tilesVisible: tiles.visibleTiles.size,
      tilesRefused: tiles.stats.refused ?? null,
      tilesFailed: tiles.stats.failed ?? null,
      engineCacheMB: Math.round((tiles.lruCache.cachedBytes ?? 0) / 1048576),
      engineCalls: scene.renderer.info.render.calls,
      engineTriangles: scene.renderer.info.render.triangles,
      geometries: scene.renderer.info.memory.geometries,
      textures: scene.renderer.info.memory.textures
    })
  });
}

// ---------- 地图里的自写层 ----------

async function startMap(): Promise<void> {
  const center = parseCenter(params.get('center'), MODELS[modelIds[0] ?? 'station'].center);
  const lift = numberParam(params, 'lift', 0);
  const fovy = params.get('fovy');
  const style: StyleSpecification = {
    version: 8,
    projection: { type: 'globe' },
    sources: noBasemap
      ? {}
      : {
          img: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19
          }
        },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#20262c' } },
      ...(noBasemap ? [] : [{ id: 'img', type: 'raster' as const, source: 'img' }])
    ]
  };
  setWorkerUrl(workerUrl);
  const map = new MlMap({
    container: 'map',
    style,
    center: center as LngLatLike,
    zoom: numberParam(params, 'zoom', 16),
    pitch: numberParam(params, 'pitch', 0),
    bearing: numberParam(params, 'bearing', 0),
    maxPitch: 180,
    // 超过 25 级时，贴地相机的近处瓦片级别会超出 MapLibre 的上限并在渲染循环里抛错
    maxZoom: 24,
    // 默认 true 时中心高度被夹回 0：模型地面不在 0 米、第一人称和地下都要关掉
    centerClampedToGround: false,
    attributionControl: false,
    canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' }
  });
  map.on('error', event => errors.push(String(event.error?.message ?? event.error).slice(0, 300)));
  if (fovy) {
    map.setVerticalFieldOfView(Number(fovy));
  }
  // load 事件要等底图的瓦片；模型不等，和 Cesium 一样尽早开始加载
  await new Promise<void>(resolve => {
    if (map.isStyleLoaded()) {
      resolve();
    } else {
      map.once('style.load', () => resolve());
    }
  });
  let renders = 0;
  map.on('render', () => {
    renders += 1;
  });

  const applyCamera = (camera: BenchCamera) => {
    if (isEye(camera)) {
      const rad = (camera.heading * Math.PI) / 180;
      const pitchRad = (camera.pitch * Math.PI) / 180;
      const [toLng, toLat] = offsetLngLat(camera.lng, camera.lat, Math.sin(rad) * 8, Math.cos(rad) * 8);
      const options = map.calculateCameraOptionsFromTo(
        new LngLat(camera.lng, camera.lat),
        camera.height + lift,
        new LngLat(toLng, toLat),
        camera.height + lift + Math.tan(pitchRad) * 8
      );
      map.jumpTo(options);
    } else {
      map.jumpTo(camera as { center: LngLatLike; zoom: number; bearing: number; pitch: number });
    }
  };
  if (eye) {
    // 第一帧之前地球投影的过渡值还是初始的 1，calculateCameraOptionsFromTo 走球面公式，
    // 目标点取在地面上，算出的俯仰和缩放都不对。所以等第一帧画完，再设相机、加模型
    await new Promise<void>(resolve => {
      map.once('render', () => resolve());
      map.triggerRepaint();
    });
    applyCamera(eye);
    if (interactive) {
      map.dragRotate.disable();
      map.dragPan.disable();
      bindWalkKeys(map.getCanvasContainer(), eye, applyCamera);
    }
  }

  const loadStartedAt = performance.now();
  const layers: OwnTilesLayer[] = [];
  let models = 0;
  for (const id of modelIds) {
    const url = await preparedTilesetUrl(MODELS[id].url);
    const layer = new OwnTilesLayer(`own-${id}`, url, MODELS[id].center[0], MODELS[id].center[1]);
    if (lift !== 0) {
      layer.setLift(lift);
    }
    if (cacheMB > 0) {
      // 所有 TilesRenderer 共用一个模块级的缓存
      internals(layer.tiles).lruCache.maxBytesSize = cacheMB * 1048576;
      internals(layer.tiles).lruCache.minBytesSize = cacheMB * 0.75 * 1048576;
    }
    const events = layer.tiles as unknown as { addEventListener(type: string, listener: (event: { url?: unknown; error?: unknown }) => void): void };
    events.addEventListener('load-model', () => {
      models += 1;
    });
    events.addEventListener('load-error', event => errors.push(`tile: ${String(event.url ?? event.error).slice(0, 200)}`));
    map.addLayer(layer);
    layers.push(layer);
  }

  const trackedTiles = () => layers.map(layer => internals(layer.tiles));
  publish({
    engine: 'maplibre+three（自写层）',
    config: {
      errorTarget: internals(layers[0]?.tiles).errorTarget,
      cacheMB: cacheMB > 0 ? cacheMB : 'LRU 默认 400 MB',
      antialias: true,
      lift,
      fovy: map.getVerticalFieldOfView(),
      projection: 'globe'
    },
    gl: map.getCanvas().getContext('webgl2') as WebGL2RenderingContext,
    loadStartedAt,
    errors,
    isStable: () => models > 0 && trackedTiles().every(queuesEmpty),
    basemapIdle: () => noBasemap || map.areTilesLoaded(),
    tick: () => map.triggerRepaint(),
    setContinuous(on) {
      map.repaint = on;
    },
    setCamera: applyCamera,
    setModelVisible(visible) {
      for (const tiles of trackedTiles()) {
        tiles.group.visible = visible;
      }
      map.triggerRepaint();
    },
    renders: () => renders,
    stats() {
      const all = trackedTiles();
      const sum = (read: (tiles: TilesInternals) => number) => all.reduce((total, tiles) => total + read(tiles), 0);
      return {
        tilesVisible: sum(tiles => tiles.visibleTiles.size),
        tilesRefused: sum(tiles => tiles.stats.refused ?? 0),
        tilesFailed: sum(tiles => tiles.stats.failed ?? 0),
        // 缓存是共用的，不累加
        engineCacheMB: Math.round((all[0]?.lruCache.cachedBytes ?? 0) / 1048576),
        engineCalls: layers.reduce((total, layer) => total + (layer.renderer?.info.render.calls ?? 0), 0),
        engineTriangles: layers.reduce((total, layer) => total + (layer.renderer?.info.render.triangles ?? 0), 0),
        geometries: layers.reduce((total, layer) => total + (layer.renderer?.info.memory.geometries ?? 0), 0),
        textures: layers.reduce((total, layer) => total + (layer.renderer?.info.memory.textures ?? 0), 0),
        cameraZoom: map.getZoom(),
        cameraPitch: map.getPitch(),
        cameraBearing: map.getBearing(),
        cameraElevation: map.getCenterElevation(),
        canvasHeight: map.getCanvas().clientHeight
      };
    }
  });
}

if (params.get('mode') === 'roam') {
  await startRoam();
} else {
  await startMap();
}
