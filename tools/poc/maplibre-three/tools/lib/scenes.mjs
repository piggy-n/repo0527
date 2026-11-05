// 场景表：同一场景的各个方案用相同的相机和相同的飞行路径
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DIR } from './paths.mjs';

const MODELS = JSON.parse(readFileSync(join(POC_DIR, 'src', 'models.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(POC_DIR, 'src', 'manifest.json'), 'utf8'));

// MapLibre 的缩放级口径，和 packages/map-cesium/src/camera-math.ts 相同
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.516964;
const WALK_FOVY = 60;
const EYE_HEIGHT = 1.6;
// MapLibre 把相机夹在 0 米以上，地下的模型要抬高才能走进去
const STATION_LIFT = 20;

function offset([lng, lat], east, north) {
  const rad = Math.PI / 180;
  return [lng + east / (111320 * Math.cos(lat * rad)), lat + north / 110950];
}

/** 飞一圈回到原点：平移、缩放、俯仰都变，方位转满 360° */
export function aerialFlight({ center, zoom, pitch, bearing }, viewportHeight) {
  const span = (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((center[1] * Math.PI) / 180) * viewportHeight) / 2 ** zoom;
  return [
    { center, zoom, pitch, bearing },
    { center: offset(center, 0.35 * span, 0.2 * span), zoom: zoom + 0.5, pitch: pitch + 10, bearing: bearing + 90 },
    { center: offset(center, -0.3 * span, 0.4 * span), zoom: zoom - 0.4, pitch: pitch - 10, bearing: bearing + 180 },
    { center: offset(center, -0.2 * span, -0.35 * span), zoom: zoom + 0.3, pitch: pitch + 5, bearing: bearing + 270 },
    { center, zoom, pitch, bearing: bearing + 360 }
  ];
}

function metres(a, b) {
  const rad = Math.PI / 180;
  const east = (b[0] - a[0]) * 111320 * Math.cos(a[1] * rad);
  const north = (b[1] - a[1]) * 110950;
  return { east, north, up: b[2] - a[2], length: Math.hypot(east, north, b[2] - a[2]) };
}

function pointAt(path, lengths, distance) {
  for (let i = 1; i < path.length; i += 1) {
    if (distance <= lengths[i]) {
      const span = lengths[i] - lengths[i - 1];
      const t = span > 0 ? (distance - lengths[i - 1]) / span : 0;
      return path[i - 1].map((value, axis) => value + (path[i][axis] - value) * t);
    }
  }
  return path[path.length - 1];
}

/** 按路线等距取点，朝向看前方 6 米：拐角处不抖 */
export function routeEyes(path, stepM = 2) {
  const lengths = [0];
  for (let i = 1; i < path.length; i += 1) {
    lengths.push(lengths[i - 1] + metres(path[i - 1], path[i]).length);
  }
  const total = lengths[lengths.length - 1];
  const eyes = [];
  let heading = null;
  for (let distance = 0; distance <= total; distance += stepM) {
    const here = pointAt(path, lengths, distance);
    const ahead = pointAt(path, lengths, Math.min(total, distance + 6));
    const { east, north } = metres(here, ahead);
    let next = east === 0 && north === 0 ? (heading ?? 0) : (Math.atan2(east, north) * 180) / Math.PI;
    if (heading !== null) {
      // 展开到上一个角度附近，插值时不绕远路
      next += Math.round((heading - next) / 360) * 360;
    }
    heading = next;
    eyes.push({ lng: here[0], lat: here[1], height: here[2] + EYE_HEIGHT, heading, pitch: 0 });
  }
  return eyes;
}

function aerialScene(id, title, models, center, zoom, variants) {
  return { id, title, kind: 'aerial', models, view: { center, zoom, pitch: 55, bearing: 20 }, variants };
}

const C = { id: 'c', label: '方案 C' };
const cacheVariant = cacheMB => ({ id: `c-${cacheMB}mb`, label: `方案 C ${cacheMB} MB 缓存`, cacheMB });
const C_ADAPTIVE = { id: 'c-adaptive', label: '方案 C 自适应缓存', adaptive: true };
const CESIUM = { id: 'cesium', label: 'Cesium' };
const C_ROAM = { id: 'c-roam', label: '方案 C 独立场景' };

function lccScenes(budgets) {
  return budgets.map(budget => {
    const millions = budget / 1000000;
    return {
      id: `lcc2-${Number.isInteger(millions) ? millions : millions.toFixed(1)}m`,
      title: `LCC2 高斯泼溅，预算 ${millions} 百万`,
      kind: 'lcc',
      budget,
      view: { zoom: 18.5, pitch: 60, bearing: 20 },
      variants: [{ id: 'c', label: '方案 C' }]
    };
  });
}

/** 所有场景；顺序就是报告的顺序 */
export function buildScenes(options) {
  const station = MODELS.station.center;
  const oblique = MODELS.oblique.center;
  const stationModel = MANIFEST.models[0];
  const route = stationModel.routes.find(item => item.id === 'concourse') ?? stationModel.routes[0];
  const obliqueVariants = [C, ...options.cacheMBs.map(cacheVariant), C_ADAPTIVE, CESIUM];
  return [
    aerialScene('white-z15.5', '白模，z15.5', ['white'], MODELS.white.center, 15.5, [C, CESIUM]),
    aerialScene('white-station-z17', '白模加车站，z17', ['white', 'station'], station, 17, [C, CESIUM]),
    aerialScene('white-station-z18', '白模加车站，z18', ['white', 'station'], station, 18, [C, CESIUM]),
    aerialScene('oblique-z17', '倾斜摄影，z17', ['oblique'], oblique, 17, obliqueVariants),
    aerialScene('oblique-z19', '倾斜摄影，z19', ['oblique'], oblique, 19, obliqueVariants),
    {
      id: 'indoor',
      title: '站内，第一人称',
      kind: 'indoor',
      models: ['station'],
      route: route.path,
      variants: [C, C_ROAM, CESIUM]
    },
    ...lccScenes(options.lccBudgets)
  ];
}

function query(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
}

const eyeParam = ({ lng, lat, height, heading, pitch }) => [lng, lat, height, heading, pitch].join(',');

/** 一个场景一个方案就是一次运行 */
export function buildRuns(options) {
  const runs = [];
  for (const scene of buildScenes(options)) {
    for (const variant of scene.variants) {
      runs.push(makeRun(scene, variant, options));
    }
  }
  return runs;
}

function makeRun(scene, variant, options) {
  const base = { id: `${scene.id}/${variant.id}`, scene, variant };
  const { basemap, viewport } = options;
  if (scene.kind === 'lcc') {
    return {
      ...base,
      engine: 'lcc',
      needsLcc: true,
      stableStreak: 15,
      loadTimeoutMs: options.loadTimeoutMs * 2,
      path: `/lcc2app/map.html?${query({ bench: 1, basemap, budget: scene.budget, ...scene.view })}`,
      // 中心来自样例的包围盒，页面起来以后才知道
      flight: bench => aerialFlight({ ...scene.view, center: bench.defaultCenter }, viewport.height)
    };
  }
  if (scene.kind === 'indoor') {
    const eyes = routeEyes(scene.route);
    const eye = eyeParam(eyes[0]);
    const flight = () => eyes;
    const loadTimeoutMs = options.loadTimeoutMs;
    if (variant.id === 'c-roam') {
      return { ...base, engine: 'c', loadTimeoutMs, flight, path: `/bench-c.html?${query({ mode: 'roam', eye, fovy: WALK_FOVY })}` };
    }
    if (variant.id === 'cesium') {
      return {
        ...base,
        engine: 'cesium',
        loadTimeoutMs,
        flight,
        path: `/bench-cesium.html?${query({ models: scene.models.join(','), basemap, eye, fovy: WALK_FOVY, underground: 1 })}`
      };
    }
    return {
      ...base,
      engine: 'c',
      loadTimeoutMs,
      flight,
      path: `/bench-c.html?${query({ models: scene.models.join(','), basemap, eye, fovy: WALK_FOVY, lift: STATION_LIFT })}`
    };
  }
  const { center, ...view } = scene.view;
  const camera = { center: center.join(','), ...view };
  const models = scene.models.join(',');
  const flight = () => aerialFlight(scene.view, viewport.height);
  const loadTimeoutMs = options.loadTimeoutMs;
  if (variant.id === 'cesium') {
    return { ...base, engine: 'cesium', loadTimeoutMs, flight, path: `/bench-cesium.html?${query({ models, basemap, ...camera })}` };
  }
  return {
    ...base,
    engine: 'c',
    loadTimeoutMs,
    flight,
    path: `/bench-c.html?${query({ models, basemap, lruMB: variant.cacheMB, adaptive: variant.adaptive ? 1 : undefined, ...camera })}`
  };
}

export function selectRuns(runs, only) {
  if (only.length === 0) {
    return runs;
  }
  // 完全相同的优先：indoor/c 只选方案 C，不带上 indoor/c-roam、indoor/cesium
  const ids = new Set(runs.map(run => run.id));
  return runs.filter(run => only.some(pattern => (ids.has(pattern) ? run.id === pattern : run.id.includes(pattern))));
}

/** 这些运行要哪些模型文件；相对模型目录 */
export function requiredModels(runs) {
  const needed = new Set();
  for (const run of runs) {
    for (const id of run.scene.models ?? []) {
      needed.add(MODELS[id].url.replace(/^\/3dt\//, ''));
    }
  }
  return [...needed];
}
