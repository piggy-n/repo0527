import 'maplibre-gl/dist/maplibre-gl.css';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  LngLat,
  Map as MlMap,
  MercatorCoordinate,
  setWorkerUrl,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type LngLatLike,
  type StyleSpecification
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ThreeDManager, type ThreeDTilesAsset, type ThreeLayer } from 'maplibre-gl-three';
import { AmbientLight, AnimationMixer, Clock, Group, type Object3D, Raycaster, Vector2, Vector3, Vector4 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import cityBoundary from '../../../../apps/yzt/src/shared/map/boundary/data/jiangsu-city.json';
import {
  ecefOf,
  ecefToEnuMatrix,
  isRawTileset,
  meridionalRadius,
  type ModelId,
  MODELS,
  offsetLngLat,
  preparedTilesetUrl,
  primeVerticalRadius
} from './common.ts';
import manifest from './manifest.json';
import { OwnTilesLayer } from './own-layer.ts';
import { RoamScene } from './roam-scene.ts';

const params = new URLSearchParams(location.search);
const layerKind = params.get('layer') === 'own' ? 'own' : 'lib';
const transformKind = params.get('tf') === 'corrected' ? 'corrected' : 'default';
const anchorModel = params.get('anchor') as ModelId | null;
const projection = params.get('projection') === 'mercator' ? 'mercator' : 'globe';
const preserve = params.get('preserve') === '1';
const tiandituKey: string | undefined = import.meta.env.VITE_TIANDITU_KEY;
// 没有天地图 key 或被它的 WAF 拦下（418）时用 ?basemap=arcgis，换成同样没有偏移的影像
const basemapKind = params.get('basemap') === 'arcgis' || !tiandituKey ? 'arcgis' : 'tianditu';

performance.setResourceTimingBufferSize(50000);
setWorkerUrl(workerUrl);

const panel = document.querySelector<HTMLElement>('#panel');
if (!panel) {
  throw new Error('缺少面板');
}

// ---------- 样式：影像底图、边界、测试图层 ----------

function tiandituTiles(layer: string): string[] {
  return ['0', '1', '2', '3', '4', '5', '6', '7'].map(
    sub =>
      `https://t${sub}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tiandituKey ?? ''}`
  );
}

const box = (center: readonly [number, number], halfEast: number, halfNorth: number) => {
  const [west, south] = offsetLngLat(center[0], center[1], -halfEast, -halfNorth);
  const [east, north] = offsetLngLat(center[0], center[1], halfEast, halfNorth);
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]
  ];
};

// 真实的资源 MVT 要后端 token，这次不请求；用同样的写法（花纹、虚线、描边）的本地 GeoJSON 代替
function testFeatures(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const id of ['station', 'oblique'] as const) {
    const { center } = MODELS[id];
    const [lng, lat] = center;
    const line = (east0: number, north0: number, east1: number, north1: number, kind: string): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { kind },
      geometry: {
        type: 'LineString',
        coordinates: [offsetLngLat(lng, lat, east0, north0), offsetLngLat(lng, lat, east1, north1)]
      }
    });
    features.push({ type: 'Feature', properties: { kind: 'pattern' }, geometry: { type: 'Polygon', coordinates: box(center, 180, 120) } });
    features.push(line(-300, -40, 300, -40, 'dash-below'));
    features.push(line(-300, 40, 300, 40, 'solid-above'));
    features.push({ type: 'Feature', properties: { kind: 'label', name: id === 'station' ? '测试标注一' : '测试标注二' }, geometry: { type: 'Point', coordinates: [lng, lat] } });
  }
  return { type: 'FeatureCollection', features };
}

const style: StyleSpecification = {
  version: 8,
  glyphs: '/fonts/glyphs/{fontstack}/{range}.pbf',
  projection: { type: projection },
  sources: {
    img:
      basemapKind === 'arcgis'
        ? {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19
          }
        : { type: 'raster', tiles: tiandituTiles('img'), tileSize: 256, minzoom: 1, maxzoom: 18 },
    cia:
      basemapKind === 'arcgis'
        ? { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
        : { type: 'raster', tiles: tiandituTiles('cia'), tileSize: 256, minzoom: 1, maxzoom: 18 },
    city: { type: 'geojson', data: cityBoundary as GeoJSON.FeatureCollection },
    test: { type: 'geojson', data: testFeatures() }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#20262c' } },
    { id: 'img', type: 'raster', source: 'img' },
    ...(basemapKind === 'arcgis' ? [] : [{ id: 'cia', type: 'raster' as const, source: 'cia' }]),
    {
      id: 'city-fill',
      type: 'fill',
      source: 'city',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#ffd166', 'fill-opacity': 0.08 }
    },
    {
      id: 'city-line',
      type: 'line',
      source: 'city',
      paint: { 'line-color': '#ffd166', 'line-width': 2, 'line-dasharray': [3, 2] }
    },
    {
      id: 'test-pattern',
      type: 'fill',
      source: 'test',
      filter: ['==', ['get', 'kind'], 'pattern'],
      paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.9, 'fill-outline-color': '#00e5ff' }
    },
    {
      id: 'test-dash-below',
      type: 'line',
      source: 'test',
      filter: ['==', ['get', 'kind'], 'dash-below'],
      paint: { 'line-color': '#00ff88', 'line-width': 6, 'line-dasharray': [2, 1] }
    },
    {
      id: 'test-solid-above',
      type: 'line',
      source: 'test',
      filter: ['==', ['get', 'kind'], 'solid-above'],
      paint: { 'line-color': '#ff2d55', 'line-width': 6 }
    },
    {
      id: 'city-label',
      type: 'symbol',
      source: 'city',
      layout: { 'text-field': ['get', 'name'], 'text-size': 16 },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 }
    },
    {
      id: 'test-label',
      type: 'symbol',
      source: 'test',
      filter: ['==', ['get', 'kind'], 'label'],
      layout: { 'text-field': ['get', 'name'], 'text-size': 18, 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#d6006e', 'text-halo-width': 2 }
    }
  ]
};

const initial = MODELS.station;
const map = new MlMap({
  container: 'map',
  style,
  center: initial.center as LngLatLike,
  zoom: Number(params.get('zoom') ?? 16),
  pitch: 0,
  maxPitch: 180,
  // 超过 25 级时，贴地相机的近处瓦片级别会超出 MapLibre 的上限并在渲染循环里抛错
  maxZoom: Number(params.get('maxZoom') ?? 24),
  // 默认 true 时中心高度被夹回 0：模型地面不在 0 米（徐州 41 米）、第一人称和地下都要关掉
  centerClampedToGround: false,
  localIdeographFontFamily: '"Microsoft YaHei", sans-serif',
  canvasContextAttributes: { antialias: true, preserveDrawingBuffer: preserve }
});

const errors: string[] = [];
map.on('error', event => {
  const message = String(event.error?.message ?? event.error);
  errors.push(message.replace(/tk=[^&\s"]+/g, 'tk=***'));
});
window.addEventListener('error', event => errors.push(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => errors.push(`rejection: ${String(event.reason)}`));

// 花纹在样式加载后、第一次用到之前加进去
function hatchImage(): ImageData {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('没有 2d 上下文');
  }
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}
map.on('style.load', () => {
  map.addImage('hatch', hatchImage());
});

// ---------- 探针层：记下 MapLibre 给自定义层的矩阵和过渡值 ----------

let lastArgs: CustomRenderMethodInput | null = null;
let renderCount = 0;
const probeLayer: CustomLayerInterface = {
  id: 'probe',
  type: 'custom',
  renderingMode: '2d',
  render(_gl, args) {
    lastArgs = args;
    renderCount += 1;
  }
};

// ---------- maplibre-gl-three 的层 ----------

// 按 WGS84 椭球的两个曲率半径算东向、北向的比例；库的默认值用 MapLibre 的 6371008.8 米球
function correctedTransform(anchor: [number, number]) {
  const coordinate = MercatorCoordinate.fromLngLat(anchor);
  const cos = Math.cos((anchor[1] * Math.PI) / 180);
  return {
    translateX: coordinate.x,
    translateY: coordinate.y,
    translateZ: coordinate.z,
    rotateX: Math.PI / 2,
    rotateY: 0,
    rotateZ: 0,
    scaleEast: 1 / (2 * Math.PI * primeVerticalRadius(anchor[1]) * cos),
    scaleSouth: 1 / (2 * Math.PI * meridionalRadius(anchor[1]) * cos),
    scaleUp: coordinate.meterInMercatorCoordinateUnits()
  };
}

const manager = new ThreeDManager({
  // 高程基准默认要从 cdn.proj.org 下载 EGM96；内网不能用，而且 Cesium 现状用的是椭球高，这里关掉
  verticalDatum: { enabled: false },
  ...(transformKind === 'corrected' ? { getTransformParameters: correctedTransform } : {}),
  ...(anchorModel && MODELS[anchorModel]
    ? { calculateAnchorPoint: () => [MODELS[anchorModel].center[0], MODELS[anchorModel].center[1]] as [number, number] }
    : {})
});
await manager.init();
const layer: ThreeLayer = manager.createLayer({ id: 'three-layer' });
const threeBefore = params.get('before') ?? 'test-solid-above';

interface ModelEntry {
  readonly id: ModelId;
  readonly tiles: TilesRenderer;
  readonly asset: ThreeDTilesAsset | null;
  readonly own: OwnTilesLayer | null;
  readonly startedAt: number;
  firstLoadEndMs: number | null;
  loadModels: number;
  loadTilesets: number;
  loadErrors: string[];
}

const entries = new Map<ModelId, ModelEntry>();

// 所有 TilesRenderer 共用一个默认缓存，上限 400 MB；Cesium 现状是 384 MB 加 256 MB 溢出
const cacheMB = Number(params.get('lruMB') ?? 0);

function trackTiles(entry: ModelEntry): void {
  const { tiles } = entry;
  if (cacheMB > 0) {
    tiles.lruCache.maxBytesSize = cacheMB * 1048576;
    tiles.lruCache.minBytesSize = cacheMB * 0.75 * 1048576;
  }
  const events = tiles as unknown as {
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
  };
  events.addEventListener('load-model', () => {
    entry.loadModels += 1;
  });
  events.addEventListener('load-tileset', () => {
    entry.loadTilesets += 1;
  });
  events.addEventListener('load-error', event => {
    entry.loadErrors.push(String((event.url as string) ?? event.error));
  });
  events.addEventListener('tiles-load-end', () => {
    entry.firstLoadEndMs ??= performance.now() - entry.startedAt;
  });
}

async function addModel(id: ModelId): Promise<string> {
  if (entries.has(id)) {
    return 'already';
  }
  const { url: rawUrl, center } = MODELS[id];
  const tilesetUrl = isRawTileset() ? rawUrl : await preparedTilesetUrl(rawUrl);
  const startedAt = performance.now();
  let entry: ModelEntry;
  if (layerKind === 'own') {
    const own = new OwnTilesLayer(`own-${id}`, tilesetUrl, center[0], center[1]);
    entry = { id, tiles: own.tiles, asset: null, own, startedAt, firstLoadEndMs: null, loadModels: 0, loadTilesets: 0, loadErrors: [] };
    trackTiles(entry);
    map.addLayer(own, threeBefore);
  } else {
    const asset = await layer.load3dTiles({ tilesetUrl });
    entry = { id, tiles: asset.getTilesRenderer(), asset, own: null, startedAt, firstLoadEndMs: null, loadModels: 0, loadTilesets: 0, loadErrors: [] };
    trackTiles(entry);
  }
  entries.set(id, entry);
  return 'added';
}

function removeModel(id: ModelId): void {
  const entry = entries.get(id);
  if (!entry) {
    return;
  }
  entry.asset?.destroy();
  if (entry.own) {
    map.removeLayer(entry.own.id);
  }
  entries.delete(id);
}

function memoryOf(root: Object3D): { geometryMB: number; textureMB: number; meshes: number; triangles: number } {
  let geometry = 0;
  let texture = 0;
  let meshes = 0;
  let triangles = 0;
  const seen = new Set<unknown>();
  root.traverse(object => {
    const mesh = object as Object3D & {
      geometry?: { attributes: Record<string, { array: ArrayBufferView }>; index: { array: ArrayBufferView; count: number } | null };
      material?: { map?: { image?: { width?: number; height?: number } } | null };
    };
    if (!mesh.geometry) {
      return;
    }
    meshes += 1;
    if (!seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        geometry += attribute.array.byteLength;
      }
      if (mesh.geometry.index) {
        geometry += mesh.geometry.index.array.byteLength;
        triangles += mesh.geometry.index.count / 3;
      }
    }
    const image = mesh.material?.map?.image;
    if (image?.width && image.height && !seen.has(image)) {
      seen.add(image);
      texture += image.width * image.height * 4;
    }
  });
  return {
    geometryMB: Math.round((geometry / 1048576) * 10) / 10,
    textureMB: Math.round((texture / 1048576) * 10) / 10,
    meshes,
    triangles: Math.round(triangles)
  };
}

function resourcesOf(id: ModelId): { b3dm: number; json: number; downloadedMB: number } {
  const prefix = MODELS[id].url.replace(/[^/]+$/, '');
  let b3dm = 0;
  let json = 0;
  let bytes = 0;
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    if (!entry.name.includes(prefix)) {
      continue;
    }
    if (entry.name.endsWith('.b3dm')) {
      b3dm += 1;
      bytes += entry.decodedBodySize;
    } else if (entry.name.endsWith('.json')) {
      json += 1;
    }
  }
  return { b3dm, json, downloadedMB: Math.round((bytes / 1048576) * 10) / 10 };
}

function modelStats(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, entry] of entries) {
    const tiles = entry.tiles as unknown as {
      stats: Record<string, number>;
      visibleTiles: Set<unknown>;
      activeTiles: Set<unknown>;
      lruCache: { cachedBytes?: number };
      group: Object3D;
    };
    out[id] = {
      downloading: tiles.stats.downloading,
      parsing: tiles.stats.parsing,
      queued: tiles.stats.queued,
      failed: tiles.stats.failed,
      visible: tiles.visibleTiles.size,
      active: tiles.activeTiles.size,
      loadModels: entry.loadModels,
      loadTilesets: entry.loadTilesets,
      loadErrors: entry.loadErrors.length,
      firstLoadEndMs: entry.firstLoadEndMs === null ? null : Math.round(entry.firstLoadEndMs),
      ...resourcesOf(id),
      cachedMB: Math.round((tiles.lruCache.cachedBytes ?? 0) / 1048576),
      ...memoryOf(tiles.group)
    };
  }
  return out;
}

// ---------- 帧等待 ----------

function frames(count: number, timeoutMs = 20000): Promise<boolean> {
  return new Promise(resolve => {
    const target = renderCount + count;
    const timer = setTimeout(() => {
      map.off('render', check);
      resolve(false);
    }, timeoutMs);
    const check = () => {
      if (renderCount >= target) {
        clearTimeout(timer);
        map.off('render', check);
        resolve(true);
      }
    };
    map.on('render', check);
    map.triggerRepaint();
  });
}

async function waitTiles(id: ModelId, timeoutMs = 120000): Promise<Record<string, unknown>> {
  const start = performance.now();
  const entry = entries.get(id);
  if (!entry) {
    throw new Error(`${id} 没有加载`);
  }
  while (performance.now() - start < timeoutMs) {
    await frames(5, 10000);
    const { stats } = entry.tiles as unknown as { stats: Record<string, number> };
    if (stats.downloading === 0 && stats.parsing === 0 && stats.queued === 0 && entry.loadModels > 0) {
      await frames(5, 10000);
      if (stats.downloading === 0 && stats.parsing === 0 && stats.queued === 0) {
        return { settled: true, waitedMs: Math.round(performance.now() - start), ...(modelStats()[id] as object) };
      }
    }
  }
  return { settled: false, waitedMs: Math.round(performance.now() - start), ...(modelStats()[id] as object) };
}

// ---------- 对齐测量 ----------

function libProject(lng: number, lat: number, height: number): { x: number; y: number } {
  const camera = layer.three.getCamera();
  const local = manager.ecefToLocalSpace(ecefOf(lng, lat, height));
  const clip = local.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  const canvas = map.getCanvas();
  return { x: ((clip.x + 1) / 2) * canvas.clientWidth, y: ((1 - clip.y) / 2) * canvas.clientHeight };
}

function ownProject(entry: ModelEntry, lng: number, lat: number, height: number): { x: number; y: number } {
  const own = entry.own;
  if (!own) {
    throw new Error('不是自写层');
  }
  const [anchorLng, anchorLat] = own.anchor;
  const enu = ecefOf(lng, lat, height).applyMatrix4(ecefToEnuMatrix(anchorLng, anchorLat, 0));
  return own.project(enu);
}

// MapLibre 自己的投影算某个高度：用它给自定义层的矩阵（只在墨卡托下有意义）
function mapMatrixProject(lng: number, lat: number, height: number): { x: number; y: number } | null {
  if (!lastArgs || lastArgs.defaultProjectionData.projectionTransition > 0) {
    return null;
  }
  const coordinate = MercatorCoordinate.fromLngLat([lng, lat], height);
  const m = lastArgs.defaultProjectionData.mainMatrix as ArrayLike<number>;
  const p = new Vector4(coordinate.x, coordinate.y, coordinate.z, 1);
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  const canvas = map.getCanvas();
  return { x: ((x / w + 1) / 2) * canvas.clientWidth, y: ((1 - y / w) / 2) * canvas.clientHeight };
}

interface AlignmentOptions {
  readonly center?: readonly [number, number];
  readonly zooms?: readonly number[];
  readonly pitch?: number;
  readonly bearing?: number;
  readonly grid?: number;
  readonly modelId?: ModelId;
}

async function alignment(options: AlignmentOptions = {}): Promise<unknown[]> {
  const { center = initial.center, zooms = [12, 16, 18, 20], pitch = 0, bearing = 0, grid = 5, modelId } = options;
  const results: unknown[] = [];
  const canvas = map.getCanvas();
  const entry = modelId ? entries.get(modelId) : undefined;
  const project = entry?.own ? (lng: number, lat: number, h: number) => ownProject(entry, lng, lat, h) : libProject;
  for (const zoom of zooms) {
    map.jumpTo({ center: center as LngLatLike, zoom, pitch, bearing });
    const drew = await frames(4, 30000);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const metersPerPixel = (2 * Math.PI * 6378137 * Math.cos((center[1] * Math.PI) / 180)) / (512 * 2 ** zoom);
    let max = 0;
    let maxDistance = 0;
    let sum = 0;
    let count = 0;
    const camera = entry?.own ? entry.own.camera : layer.three.getCamera();
    const rows: unknown[] = [];
    for (let i = 0; i < grid; i += 1) {
      for (let j = 0; j < grid; j += 1) {
        const px = { x: (width * (i + 0.5)) / grid, y: height * (0.15 + (0.8 * (j + 0.5)) / grid) };
        const lngLat = map.unproject([px.x, px.y]);
        const two = map.project(lngLat);
        const three = project(lngLat.lng, lngLat.lat, 0);
        const error = Math.hypot(three.x - two.x, three.y - two.y);
        const distance = map.getCenter().distanceTo(lngLat);
        rows.push({ px: [Math.round(px.x), Math.round(px.y)], distanceM: Math.round(distance), errorPx: Number(error.toFixed(3)) });
        if (error > max) {
          max = error;
          maxDistance = distance;
        }
        sum += error;
        count += 1;
      }
    }
    // 中心点和离中心 100 米、500 米的点
    const probe = (east: number, north: number, h = 0) => {
      const [lng, lat] = offsetLngLat(center[0], center[1], east, north);
      const three = project(lng, lat, h);
      const two = h === 0 ? map.project([lng, lat]) : mapMatrixProject(lng, lat, h);
      if (!two) {
        return null;
      }
      const px = Math.hypot(three.x - two.x, three.y - two.y);
      return { px: Number(px.toFixed(3)), m: Number((px * metersPerPixel).toFixed(3)) };
    };
    results.push({
      zoom,
      pitch,
      bearing,
      drew,
      transition: lastArgs?.defaultProjectionData.projectionTransition ?? null,
      metersPerPixel: Number(metersPerPixel.toFixed(4)),
      gridMaxPx: Number(max.toFixed(3)),
      gridMaxM: Number((max * metersPerPixel).toFixed(3)),
      gridMeanPx: Number((sum / count).toFixed(3)),
      atDistanceM: Math.round(maxDistance),
      center: probe(0, 0),
      east100: probe(100, 0),
      north100: probe(0, 100),
      east500: probe(500, 0),
      north500: probe(0, 500),
      east1000: probe(1000, 0),
      north1000: probe(0, 1000),
      east100up100: probe(100, 0, 100),
      cameraFov: Number(camera.fov?.toFixed(2)),
      gridRows: params.get('rows') === '1' ? rows : undefined
    });
  }
  return results;
}

// ---------- 拾取 ----------

const raycaster = new Raycaster();

function pick(x: number, y: number): unknown {
  const camera = layer.three.getCamera();
  const canvas = map.getCanvas();
  const ndc = new Vector2((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
  raycaster.setFromCamera(ndc, camera);
  const start = performance.now();
  const targets = [...entries.values()].map(entry => entry.tiles.group);
  const hits = raycaster.intersectObjects(targets, true);
  const ms = performance.now() - start;
  const hit = hits[0];
  if (!hit) {
    return { hit: false, ms: Number(ms.toFixed(1)) };
  }
  const { point, height } = manager.localSpaceToLngLatAlt(hit.point.clone());
  const back = libProject(point[0], point[1], height);
  return {
    hit: true,
    lng: Number(point[0].toFixed(7)),
    lat: Number(point[1].toFixed(7)),
    height: Number(height.toFixed(3)),
    distance: Number(hit.distance.toFixed(3)),
    hits: hits.length,
    ms: Number(ms.toFixed(1)),
    reprojectErrorPx: Number(Math.hypot(back.x - x, back.y - y).toFixed(3))
  };
}

// ---------- 单独的 glTF：经纬度摆放、播放动画 ----------

let mixer: AnimationMixer | null = null;
let man: Group | null = null;
let manBones: Object3D[] = [];
const clock = new Clock();

async function addMan(lng: number, lat: number, height: number, scale: number): Promise<Record<string, unknown>> {
  const gltf = await new GLTFLoader().loadAsync('/roam/Cesium_Man.glb');
  man?.removeFromParent();
  man = new Group();
  man.name = 'cesium-man';
  man.add(gltf.scene);
  man.matrixAutoUpdate = false;
  man.matrix.copy(manager.getEcefMatrix({ point: [lng, lat], height })).scale(new Vector3(scale, scale, scale));
  manBones = [];
  gltf.scene.traverse(object => {
    if ((object as { isBone?: boolean }).isBone) {
      manBones.push(object);
    }
    object.frustumCulled = false;
  });
  const scene = layer.three.getScene();
  if (!scene.children.some(child => (child as { isAmbientLight?: boolean }).isAmbientLight)) {
    scene.add(new AmbientLight(0xffffff, 3));
  }
  scene.add(man);
  mixer = new AnimationMixer(gltf.scene);
  for (const clip of gltf.animations) {
    mixer.clipAction(clip).play();
  }
  return { animations: gltf.animations.map(clip => `${clip.name || 'clip'} ${clip.duration.toFixed(2)}s`), bones: manBones.length };
}

function manPose(): unknown {
  const bone = manBones[1] ?? manBones[0];
  return bone ? bone.quaternion.toArray().map(value => Number(value.toFixed(4))) : null;
}

map.on('render', () => {
  mixer?.update(clock.getDelta());
});

// ---------- 第一人称 ----------

async function firstPerson(options: {
  lng: number;
  lat: number;
  eye: number;
  bearing: number;
  lookDownDeg?: number;
  targetM?: number;
}): Promise<unknown> {
  const { lng, lat, eye, bearing, lookDownDeg = 0, targetM = 40 } = options;
  const rad = (bearing * Math.PI) / 180;
  const [toLng, toLat] = offsetLngLat(lng, lat, Math.sin(rad) * targetM, Math.cos(rad) * targetM);
  const toHeight = eye - Math.tan((lookDownDeg * Math.PI) / 180) * targetM;
  const camera = map.calculateCameraOptionsFromTo(new LngLat(lng, lat), eye, new LngLat(toLng, toLat), toHeight);
  map.jumpTo(camera);
  await frames(4, 30000);
  const three = layer.three.getCamera();
  const local = three.position.clone();
  const actual = manager.localSpaceToLngLatAlt(local);
  const transform = (map as unknown as { transform: { nearZ: number; farZ: number; getCameraAltitude?: () => number; pixelsPerMeter?: number } }).transform;
  return {
    requested: { lng, lat, eye },
    options: { zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing, elevation: camera.elevation },
    applied: {
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      center: map.getCenter().toArray(),
      elevation: map.getCenterElevation?.()
    },
    threeCamera: {
      lng: Number(actual.point[0].toFixed(7)),
      lat: Number(actual.point[1].toFixed(7)),
      height: Number(actual.height.toFixed(3)),
      near: Number(three.near.toFixed(3)),
      far: Number(three.far.toFixed(1)),
      fov: Number(three.fov.toFixed(2))
    },
    mapAltitude: transform?.getCameraAltitude?.(),
    errors: errors.length
  };
}

// ---------- 独立 Three 场景（站内） ----------

let roam: RoamScene | null = null;

function setMapLayerVisible(visible: boolean): void {
  map.setLayoutProperty('three-layer', 'visibility', visible ? 'visible' : 'none');
}

async function enterRoam(): Promise<void> {
  const container = document.querySelector<HTMLElement>('#roam');
  if (!container || roam) {
    return;
  }
  container.style.display = 'block';
  setMapLayerVisible(false);
  const tilesetUrl = await preparedTilesetUrl(MODELS.station.url);
  const spawn = manifest.models[0].spawn as { lng: number; lat: number; height: number; heading: number };
  roam = new RoamScene({ container, tilesetUrl, origin: [spawn.lng, spawn.lat], spawn });
  Object.assign(window, { roam });
}

function exitRoam(): void {
  const container = document.querySelector<HTMLElement>('#roam');
  roam?.dispose();
  roam = null;
  if (container) {
    container.style.display = 'none';
  }
  setMapLayerVisible(true);
}

// ---------- 面板 ----------

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

function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

const stats = document.createElement('pre');
const controls = document.createElement('div');
controls.append(
  button('站', () => void addModel('station')),
  button('白模', () => void addModel('white')),
  button('倾斜', () => void addModel('oblique')),
  button('到苏州', () => map.jumpTo({ center: MODELS.station.center as LngLatLike, zoom: 16.5, pitch: 55 })),
  button('到徐州', () => map.jumpTo({ center: MODELS.oblique.center as LngLatLike, zoom: 17, pitch: 55 })),
  button('地球', () => map.setProjection({ type: 'globe' })),
  button('墨卡托', () => map.setProjection({ type: 'mercator' })),
  button('俯仰 0', () => map.easeTo({ pitch: 0 })),
  button('俯仰 70', () => map.easeTo({ pitch: 70 })),
  button('站内', () => void enterRoam()),
  button('退出站内', () => exitRoam())
);
panel.append(controls, stats);

setInterval(() => {
  const webgl = layer.three.getRenderer();
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  const gpu = map.getCanvas().getContext('webgl2')?.getParameter(37445);
  const debugInfo = map.getCanvas().getContext('webgl2')?.getExtension('WEBGL_debug_renderer_info');
  const rendererName = debugInfo ? map.getCanvas().getContext('webgl2')?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gpu;
  const lines = [
    `layer=${layerKind} tf=${transformKind} anchor=${anchorModel ?? 'center'} raw=${isRawTileset()}`,
    `FPS ${fps.toFixed(1)}  zoom ${map.getZoom().toFixed(2)}  pitch ${map.getPitch().toFixed(0)}  t=${lastArgs?.defaultProjectionData.projectionTransition.toFixed(2) ?? '-'}`,
    `heap ${heap ? Math.round(heap / 1048576) : '-'} MB  errors ${errors.length}`,
    webgl
      ? `geo ${webgl.info.memory.geometries} tex ${webgl.info.memory.textures} calls ${webgl.info.render.calls} tris ${webgl.info.render.triangles} frame ${webgl.info.render.frame}`
      : 'three: not attached',
    `GL ${String(rendererName).slice(0, 80)}`,
    JSON.stringify(modelStats(), null, 0).replace(/},/g, '},\n').replace(/[{}"]/g, ' ')
  ];
  stats.textContent = lines.join('\n');
}, 500);

// ---------- 启动 ----------

const api = {
  map,
  manager,
  layer,
  entries,
  errors,
  MODELS,
  addModel,
  removeModel,
  modelStats,
  frames,
  waitTiles,
  alignment,
  pick,
  addMan,
  manPose,
  firstPerson,
  enterRoam,
  exitRoam,
  setMapLayerVisible,
  libProject,
  manifest,
  lastArgs: () => lastArgs,
  renderCount: () => renderCount,
  libFrame: () => layer.three.getRenderer()?.info.render.frame ?? null,
  offsetLngLat,
  fps: () => fps
};
Object.assign(window, { poc: api });
await new Promise<void>(resolve => {
  if (map.loaded()) {
    resolve();
  } else {
    map.once('load', () => resolve());
  }
});
map.addLayer(probeLayer, 'img');
if (layerKind === 'lib') {
  map.addLayer(layer, threeBefore);
}
const toAdd = (params.get('models') ?? '').split(',').filter(Boolean) as ModelId[];
for (const id of toAdd) {
  await addModel(id);
}
Object.assign(window, { pocReady: true });
