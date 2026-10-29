import type { StyleGroup } from '@yzt/map-core';
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { EngineState } from '../engine/engine';
import type { StepId } from '../engine/steps';
import {
  ALERT_COLOR,
  DENSITY_COLOR,
  DISTRICT_LINE_COLOR,
  FACILITY_COLOR,
  FACILITY_RING_COLOR,
  MASK_COLOR,
  PASS_COLORS,
  PENDING_COLOR,
  PLANNED_COLOR
} from './colors';
import type { MapData } from './map-data';

/**
 * 地图在这一刻的演出，全部由步骤的状态和进度算出（ADR 0102 第 5、6 条）：数据只在每轮换一次，
 * 动画只改图层里的阈值和不透明度（paint），不重新切片
 */
export interface MapFrame {
  /** 人口密度底色：所在市的排序 ≤ 它的区县点亮；null 是不显示 */
  readonly density: number | null;
  /** 计算的扫描：经度排序 ≤ 它的区县显示数值颜色，其余是待计算的灰色；1 是全部；null 是不显示 */
  readonly scan: number | null;
  /** 设施点：排序 ≤ 它的点落下；null 是不显示 */
  readonly rain: number | null;
  /** 服务圈的扩散 0～1 */
  readonly ring: number;
  /** 区县描边：数据核查的缺失、评价分级的未达标（闪烁）、结果阶段人工干预的预览（虚线） */
  readonly alert: { readonly kind: 'missing' | 'fail' | 'preview'; readonly opacity: number } | null;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) ** 2;

/**
 * 这一刻的演出：先后是人口（按市点亮）→ 设施落点 → 核查描出缺失 → 服务圈扩散 → 扫描出数值 → 未达标闪烁。
 * still 是减少动画：每一段开始就是终态，未达标的描边不闪
 */
export function mapFrame(state: EngineState, progress: (step: StepId) => number, still = false): MapFrame {
  const status = (step: StepId) => state.steps[step].status;
  const started = (step: StepId) => status(step) !== 'waiting' && status(step) !== 'stale';
  const finished = (step: StepId) => status(step) === 'done' || status(step) === 'reused';
  // 进度条到某一段时完成：t 从 from 到 to 映射成 0～1
  const span = (step: StepId, from: number, to: number) =>
    finished(step) || still ? 1 : clamp((progress(step) - from) / (to - from));

  let density: number | null = null;
  if (started('pop') && !finished('qc')) {
    density = span('pop', 0, 0.8);
  }
  const rain = started('poi') && !started('compute') ? span('poi', 0, 0.75) ** 2 : null;
  const ring = started('spatial') ? easeOut(span('spatial', 0.1, 0.45)) : 0;
  let scan: number | null = null;
  if (started('compute')) {
    scan = span('compute', 0, 0.85);
  }

  let alert: MapFrame['alert'] = null;
  const qcAsking =
    status('qc') === 'checkpoint' || (status('qc') === 'running' && !state.decided.qc && progress('qc') >= 0.35);
  if (qcAsking) {
    alert = { kind: 'missing', opacity: 1 };
  } else if (status('evaluate') === 'running') {
    // 0.15～0.75 之间闪四下
    const t = (progress('evaluate') - 0.15) / 0.6;
    if (t >= 0 && t <= 1) {
      alert = { kind: 'fail', opacity: still ? 1 : (1 - Math.cos(t * 8 * Math.PI)) / 2 };
    }
  }
  return { density, scan, rain, ring, alert };
}

const POLYGONS: FilterSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const EMPTY: StyleGroup = { sources: {}, layers: [] };

// 阈值以内取 inside，否则取 outside
const within = (property: string, threshold: number, inside: number, outside: number): ExpressionSpecification => [
  'case',
  ['<=', ['get', property], threshold],
  inside,
  outside
];

// 米换成像素：瓦片 512、纬度取江苏中部；随级别按 2 的幂放大
const METERS_TO_PIXELS_Z0 = 512 / (40075016.686 * Math.cos((32.5 * Math.PI) / 180));
const ringRadius = (meters: number, scale: number): ExpressionSpecification => {
  const base = meters * METERS_TO_PIXELS_Z0 * scale;
  return ['interpolate', ['exponential', 2], ['zoom'], 0, base, 22, base * 2 ** 22];
};

export const DISTRICTS_GROUP = 'simulation-districts';
export const MASK_GROUP = 'simulation-mask';
export const FACILITIES_GROUP = 'simulation-facilities';
export const ALERTS_GROUP = 'simulation-alerts';

/** 区县：人口密度、待计算、数值颜色三层填充和分隔线 */
export function districtsGroup(data: MapData | null, frame: MapFrame | null): StyleGroup {
  if (!data || !frame || (frame.density === null && frame.scan === null)) {
    return EMPTY;
  }
  const source = DISTRICTS_GROUP;
  const layers: LayerSpecification[] = [];
  if (frame.density !== null) {
    layers.push({
      id: `${source}-density`,
      type: 'fill',
      source,
      filter: POLYGONS,
      paint: {
        'fill-color': DENSITY_COLOR,
        'fill-opacity': ['case', ['<=', ['get', 'cityRank'], frame.density], ['get', 'density'], 0]
      }
    });
  }
  if (frame.scan !== null) {
    layers.push(
      {
        id: `${source}-pending`,
        type: 'fill',
        source,
        filter: POLYGONS,
        paint: { 'fill-color': PENDING_COLOR, 'fill-opacity': within('lngRank', frame.scan, 0, 0.35) }
      },
      {
        id: `${source}-value`,
        type: 'fill',
        source,
        filter: POLYGONS,
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': within('lngRank', frame.scan, 0.8, 0) }
      }
    );
  }
  layers.push({
    id: `${source}-line`,
    type: 'line',
    source,
    paint: { 'line-color': DISTRICT_LINE_COLOR, 'line-width': 0.8, 'line-opacity': 0.6 }
  });
  return { sources: { [source]: { type: 'geojson', data: data.districts } }, layers };
}

/** 推演范围以外的区县盖上遮罩 */
export function maskGroup(data: MapData | null): StyleGroup {
  if (!data || data.mask.features.length === 0) {
    return EMPTY;
  }
  return {
    sources: { [MASK_GROUP]: { type: 'geojson', data: data.mask } },
    layers: [
      {
        id: `${MASK_GROUP}-fill`,
        type: 'fill',
        source: MASK_GROUP,
        filter: POLYGONS,
        paint: { 'fill-color': MASK_COLOR, 'fill-opacity': 0.68 }
      }
    ]
  };
}

/** 设施点和服务圈：现状绿色，规划新增紫色 */
export function facilitiesGroup(data: MapData | null, frame: MapFrame | null): StyleGroup {
  if (!data || !frame || frame.rain === null) {
    return EMPTY;
  }
  const source = FACILITIES_GROUP;
  const planned: ExpressionSpecification = ['get', 'planned'];
  const layers: LayerSpecification[] = [];
  if (frame.ring > 0 && data.ringMeters > 0) {
    layers.push({
      id: `${source}-ring`,
      type: 'circle',
      source,
      minzoom: 8.5,
      paint: {
        'circle-radius': ringRadius(data.ringMeters, frame.ring),
        'circle-color': ['case', planned, PLANNED_COLOR, FACILITY_RING_COLOR],
        'circle-opacity': 0.12,
        'circle-stroke-color': ['case', planned, PLANNED_COLOR, FACILITY_RING_COLOR],
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.55,
        'circle-pitch-alignment': 'map'
      }
    });
  }
  layers.push({
    id: `${source}-point`,
    type: 'circle',
    source,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 0.9, 9, 1.8, 12, 3.5, 15, 5],
      'circle-color': ['case', planned, PLANNED_COLOR, FACILITY_COLOR],
      'circle-opacity': within('rank', frame.rain, 1, 0),
      'circle-stroke-color': DISTRICT_LINE_COLOR,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 11, 1],
      'circle-stroke-opacity': within('rank', frame.rain, 1, 0)
    }
  });
  return { sources: { [source]: { type: 'geojson', data: data.facilities } }, layers };
}

const ALERT_COLORS = { missing: ALERT_COLOR, fail: PASS_COLORS.fail, preview: ALERT_COLOR } as const;

/** 区县描边：缺失人口琥珀色，未达标红色闪烁，干预预览琥珀色虚线；放在边界之上 */
export function alertsGroup(data: MapData | null, frame: MapFrame | null): StyleGroup {
  if (!data || !frame?.alert) {
    return EMPTY;
  }
  const { kind, opacity } = frame.alert;
  return {
    sources: { [ALERTS_GROUP]: { type: 'geojson', data: data.districts } },
    layers: [
      {
        id: `${ALERTS_GROUP}-line`,
        type: 'line',
        source: ALERTS_GROUP,
        filter: ['==', ['get', kind], true],
        paint: {
          'line-color': ALERT_COLORS[kind],
          'line-width': kind === 'preview' ? 2.2 : 2.6,
          'line-opacity': opacity,
          // 虚线是常量，不在常量和按要素取值之间切换（ADR 0046）
          ...(kind === 'preview' ? { 'line-dasharray': [2, 1.5] } : {})
        }
      }
    ]
  };
}
