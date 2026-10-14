import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';
import type { RegionBoundary } from './region-geometry';

type Ring = Position[];

// 分组名；数据源和图层的 ID 以它为前缀（ADR 0027）
const REGION_CLIP_GROUP = 'region-clip';

const SOURCE = REGION_CLIP_GROUP;

// Web 墨卡托能显示的纬度范围
const MAX_LATITUDE = 85.051129;

const WORLD: Ring = [
  [-180, -MAX_LATITUDE],
  [180, -MAX_LATITUDE],
  [180, MAX_LATITUDE],
  [-180, MAX_LATITUDE],
  [-180, -MAX_LATITUDE]
];

// 沿用旧项目的遮罩；地图样式里的颜色是数据，不走 CSS 令牌
const MASK_COLOR = '#F3F5F8';

const LAYERS: readonly LayerSpecification[] = [
  {
    id: `${REGION_CLIP_GROUP}-mask`,
    type: 'fill',
    source: SOURCE,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    // 大面积的面关掉抗锯齿，瓦片接缝处不出现细线
    paint: { 'fill-color': MASK_COLOR, 'fill-opacity': 1, 'fill-antialias': false }
  }
];

// 环的有向面积的两倍：经度向右、纬度向上时，逆时针为正
function signedArea(ring: Ring): number {
  let sum = 0;
  for (let index = 1; index < ring.length; index++) {
    const [x1 = 0, y1 = 0] = ring[index - 1] ?? [];
    const [x2 = 0, y2 = 0] = ring[index] ?? [];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

function oriented(ring: Ring, counterClockwise: boolean): Ring {
  return signedArea(ring) > 0 === counterClockwise ? ring : ring.toReversed();
}

// 环 a 是否在环 b 里：取 a 上不落在 b 边界上的顶点判断；环之间不交叉，任取一个结果都一样
function ringInside(a: Ring, b: Ring): boolean {
  const polygon: Polygon = { type: 'Polygon', coordinates: [b] };
  for (const vertex of a) {
    const touching = booleanPointInPolygon(vertex, polygon);
    if (touching === booleanPointInPolygon(vertex, polygon, { ignoreBoundary: true })) {
      return touching;
    }
  }
  return false;
}

/** 区划所有的环，不分外环和洞 */
export function regionRings(geometry: Polygon | MultiPolygon): Ring[] {
  return (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flat();
}

/**
 * 遮罩的几何：整个世界去掉区划（ADR 0051 第 2 节）。按环的嵌套深度构造（奇偶规则），不看数据标的外环、洞和方向；
 * 前提是环之间不交叉、各部分不重叠
 */
export function clipMask(geometry: Polygon | MultiPolygon): MultiPolygon {
  const rings = regionRings(geometry);
  const containers = rings.map((ring, index) =>
    rings.flatMap((other, otherIndex) => (otherIndex !== index && ringInside(ring, other) ? [otherIndex] : []))
  );
  // 深度：被几个环包含就是几加 1，整个世界是 0；直接包含它的环深度小 1
  const depthOf = (index: number) => (containers[index]?.length ?? 0) + 1;
  const parentOf = (index: number) => containers[index]?.find(other => depthOf(other) === depthOf(index) - 1);
  // 深度为偶数的环是遮罩的外环（世界用 undefined 表示），直接在它里面的环是它的洞
  const holesOf = (parent: number | undefined) =>
    rings.flatMap((ring, index) => (parentOf(index) === parent ? [oriented(ring, false)] : []));
  const masks: Ring[][] = [[WORLD, ...holesOf(undefined)]];
  for (const [index, ring] of rings.entries()) {
    if (depthOf(index) % 2 === 0) {
      masks.push([oriented(ring, true), ...holesOf(index)]);
    }
  }
  return { type: 'MultiPolygon', coordinates: masks };
}

/** 推导 region-clip 分组：区划外盖上遮罩；没有边界（全省、加载中、失败）时是空分组 */
export function regionClipGroup(boundary: RegionBoundary | null): StyleGroup {
  if (!boundary) {
    return { sources: {}, layers: [] };
  }
  // 交给会话的 GeoJSON 每次换新对象（ADR 0022）
  const data: Feature = { type: 'Feature', properties: {}, geometry: clipMask(boundary.geometry) };
  return { sources: { [SOURCE]: { type: 'geojson', data } }, layers: LAYERS };
}
