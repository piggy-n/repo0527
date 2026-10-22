import { geoMercator } from 'd3-geo';
import { simplify } from '@turf/simplify';
import { Path, Shape, Vector2 } from 'three';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { sharedRegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { CITIES } from '../catalog';
import type { MapRegion } from './types';

export interface RegionGeometry {
  readonly code: string;
  readonly geometry: Polygon | MultiPolygon;
}

export interface RegionProperties {
  name: string;
  code: string;
}

export interface DashboardRegions {
  readonly regions: MapRegion[];
  readonly featureCollection: FeatureCollection<MultiPolygon, RegionProperties>;
}

/** 保留同市离散面和孔洞；展示简化只操作副本 */
export function prepareRegions(entries: readonly RegionGeometry[]): DashboardRegions {
  const features = CITIES.map(city => {
    const coordinates = entries.filter(entry => entry.code === city.code).flatMap(({ geometry }) =>
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);
    if (!coordinates.length) {
      throw new Error(`${city.name}边界缺失`);
    }
    const feature: Feature<MultiPolygon, RegionProperties> = {
      type: 'Feature',
      properties: { name: city.name, code: city.code },
      geometry: { type: 'MultiPolygon', coordinates }
    };
    return simplify(feature, { tolerance: 0.0006, highQuality: true, mutate: false });
  });
  const projection = geoMercator().center([119.15, 32.9]).scale(1000).translate([0, 0]);

  function project(coordinate: Position): [number, number] {
    const [longitude, latitude] = coordinate;
    const point = projection([longitude, latitude]);
    if (!point || !point.every(Number.isFinite)) {
      throw new Error('市界包含无法投影的坐标');
    }
    return point;
  }

  const rings = features.flatMap(feature => feature.geometry.coordinates.flatMap(polygon => polygon));
  const points = rings.flatMap(ring => ring.map(project));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) {
    throw new Error('市界范围为空');
  }
  const factor = 270 / span;
  const centerX = (maxX + minX) / 2;
  const centerY = (maxY + minY) / 2;
  const projectCoordinate = (coordinate: Position) => {
    const [x, y] = project(coordinate);
    return new Vector2((x - centerX) * factor, -(y - centerY) * factor);
  };
  return {
    featureCollection: { type: 'FeatureCollection', features },
    regions: features.map((feature, index) => ({
      code: CITIES[index].code,
      name: CITIES[index].name,
      anchor: CITIES[index].anchor,
      anchorPoint: projectCoordinate([...CITIES[index].anchor]),
      shapes: feature.geometry.coordinates.map(([outerRing, ...holes]) => {
        const shape = new Shape(outerRing.map(projectCoordinate));
        shape.holes = holes.map(ring => new Path(ring.map(projectCoordinate)));
        return shape;
      })
    }))
  };
}

/** 复用已校验的本地市界与共享下载，不复制第二份地理资产 */
export async function loadDashboardRegions(signal: AbortSignal): Promise<DashboardRegions> {
  signal.throwIfAborted();
  const loader = sharedRegionBoundaryLoader();
  const entries = await Promise.all(JIANGSU_CITIES.map(city => loader.load(city)));
  signal.throwIfAborted();
  return prepareRegions(entries);
}
