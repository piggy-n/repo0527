import type { MultiPolygon, Polygon } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';
import { selectionGroup } from '@/features/resource-map/selection-style';
import { measureGroup } from '@/shared/map/measure/measure-style';
import { regionClipGroup } from '@/shared/map/region/region-clip';
import { regionGroup } from '@/shared/map/region/region-style';
import type { RegionBoundary } from '@/shared/map/region/region-geometry';
import type { SampleStyleState } from './sample-style';

// 虚构南京附近的范围：主区划含孔洞，孔洞里的小岛仍属于区划，数据仅用于离线验收
const SAMPLE_BOUNDARY: RegionBoundary = {
  code: 'sample', bounds: [118.58, 31.99, 118.94, 32.16],
  geometry: {
    type: 'MultiPolygon', coordinates: [
      [
        [[118.58, 31.99], [118.94, 31.99], [118.94, 32.16], [118.58, 32.16], [118.58, 31.99]],
        [[118.78, 32.04], [118.78, 32.10], [118.86, 32.10], [118.86, 32.04], [118.78, 32.04]]
      ],
      [[[118.80, 32.06], [118.84, 32.06], [118.84, 32.08], [118.80, 32.08], [118.80, 32.06]]]
    ]
  } satisfies MultiPolygon
};
const DETAIL: Polygon = {
  type: 'Polygon', coordinates: [
    [[118.67, 32.03], [118.73, 32.03], [118.73, 32.08], [118.67, 32.08], [118.67, 32.03]]
  ]
};
const EMPTY: StyleGroup = { sources: {}, layers: [] };

/** 直接复用业务的高亮、几何遮罩与测量推导，避免开发页另造一套样式语义 */
export function sampleOverlayGroups({ visible, alternateColors }: SampleStyleState) {
  return {
    selection: visible ? selectionGroup(DETAIL, alternateColors, {
      sourceId: 'sample-mvt', sourceLayer: 'detail', minzoom: 10, guids: ['points-secondary']
    }) : EMPTY,
    'region-clip': visible ? regionClipGroup(SAMPLE_BOUNDARY) : EMPTY,
    region: visible ? regionGroup(SAMPLE_BOUNDARY) : EMPTY,
    measure: visible ? measureGroup({
      measurements: [],
      draft: { kind: 'distance', points: [[118.66, 32.14], [118.81, 32.14]], preview: [118.91, 32.14] }
    }) : EMPTY
  };
}
