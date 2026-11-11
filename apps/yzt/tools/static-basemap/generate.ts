import { simplify } from '@turf/simplify';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson';

interface RegionProperties {
  readonly name: string;
  readonly code: string;
}

/** 边界数据：省、市、县界都是这个形状 */
export type RegionCollection = FeatureCollection<Polygon | MultiPolygon, RegionProperties>;

export type LabelLevel = 'city' | 'county';

export interface LabelProperties extends RegionProperties {
  readonly level: LabelLevel;
}

type Rings = Position[][];

const polygonsOf = ({ geometry }: Feature<Polygon | MultiPolygon, RegionProperties>): Rings[] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

const x = (point: Position) => point[0] ?? 0;
const y = (point: Position) => point[1] ?? 0;

// 外环的面积（平面近似），只用来比较同一个行政区的几块面
function ringArea(ring: readonly Position[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    twice += x(ring[i]) * y(ring[i + 1]) - x(ring[i + 1]) * y(ring[i]);
  }
  return Math.abs(twice) / 2;
}

function contains(rings: Rings, px: number, py: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const crosses = y(ring[i]) > py !== y(ring[i + 1]) > py;
      if (crosses && px < x(ring[i]) + ((py - y(ring[i])) / (y(ring[i + 1]) - y(ring[i]))) * (x(ring[i + 1]) - x(ring[i]))) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// 到最近一条边的距离的平方；经度按纬度缩短，近似成等距
function edgeDistance(rings: Rings, px: number, py: number, lngScale: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = x(ring[i]) * lngScale;
      const ay = y(ring[i]);
      const dx = x(ring[i + 1]) * lngScale - ax;
      const dy = y(ring[i + 1]) - ay;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px * lngScale - ax) * dx + (py - ay) * dy) / length));
      const ox = ax + t * dx - px * lngScale;
      const oy = ay + t * dy - py;
      nearest = Math.min(nearest, ox * ox + oy * oy);
    }
  }
  return nearest;
}

const GRID_STEPS = 24;
const REFINE_ROUNDS = 4;

/** 地名的位置：面内离边界最远的点。形心可能落在凹形的外面，或者贴着边界 */
export function labelPoint(rings: Rings): Position {
  const outer = rings[0] ?? [];
  const lngs = outer.map(x);
  const lats = outer.map(y);
  let [west, east, south, north] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const lngScale = Math.cos((((south + north) / 2) * Math.PI) / 180);
  let best: Position = [(west + east) / 2, (south + north) / 2];
  let bestDistance = -1;
  for (let round = 0; round < REFINE_ROUNDS; round++) {
    const stepX = (east - west) / GRID_STEPS;
    const stepY = (north - south) / GRID_STEPS;
    for (let col = 0; col <= GRID_STEPS; col++) {
      for (let row = 0; row <= GRID_STEPS; row++) {
        const px = west + col * stepX;
        const py = south + row * stepY;
        if (contains(rings, px, py)) {
          const distance = edgeDistance(rings, px, py, lngScale);
          if (distance > bestDistance) {
            bestDistance = distance;
            best = [px, py];
          }
        }
      }
    }
    // 下一轮在最好的点周围两格里细找
    [west, east] = [x(best) - 2 * stepX, x(best) + 2 * stepX];
    [south, north] = [y(best) - 2 * stepY, y(best) + 2 * stepY];
  }
  return [Number(x(best).toFixed(4)), Number(y(best).toFixed(4))];
}

// 简化后再算：几千个点的边界算起来慢，这点误差不影响地名的位置
const LABEL_SIMPLIFY_TOLERANCE = 0.002;

function labelFeatures(regions: RegionCollection, level: LabelLevel): Feature<Point, LabelProperties>[] {
  // 同一个行政区可能有几个要素（连云港的两条），合起来取最大的一块
  const grouped = new Map<string, { name: string; polygons: Rings[] }>();
  for (const feature of regions.features) {
    const { code, name } = feature.properties;
    const entry = grouped.get(code) ?? { name, polygons: [] };
    entry.polygons.push(...polygonsOf(feature));
    grouped.set(code, entry);
  }
  return [...grouped]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([code, { name, polygons }]) => {
      const largest = polygons.reduce((a, b) => (ringArea(a[0] ?? []) >= ringArea(b[0] ?? []) ? a : b));
      const simplified = simplify({ type: 'Polygon', coordinates: largest }, { tolerance: LABEL_SIMPLIFY_TOLERANCE });
      return {
        type: 'Feature',
        properties: { name, code, level },
        geometry: { type: 'Point', coordinates: labelPoint(simplified.coordinates) }
      };
    });
}

/** 市、区县的地名点：市在前，各自按代码排序 */
export function labelCollection(
  cities: RegionCollection,
  counties: RegionCollection
): FeatureCollection<Point, LabelProperties> {
  return {
    type: 'FeatureCollection',
    features: [...labelFeatures(cities, 'city'), ...labelFeatures(counties, 'county')]
  };
}

const mercatorX = (lng: number) => (lng + 180) / 360;
const mercatorY = (lat: number) => {
  const radians = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
};

export interface ThumbnailOptions {
  readonly landColor: string;
  readonly outsideColor: string;
  readonly lineColor: string;
}

// 画面和缩略图的 CSS 对应：放大到 160%、居中，卡片（48 × 30）只露出 62.5% 的高度，全省要落在这个范围里
const WIDTH = 320;
const HEIGHT = 200;
const PROVINCE_HEIGHT = 116;
const PATH_SIMPLIFY_TOLERANCE = 0.4;

/** 底图卡和面板用的缩略图：全省的市按静态底图的配色画成 SVG，每个市一条 path，描边是市之间的细线 */
export function thumbnailSvg(cities: RegionCollection, options: ThumbnailOptions): string {
  const points = cities.features.flatMap(feature => polygonsOf(feature).flat(2));
  const xs = points.map(point => mercatorX(x(point)));
  const ys = points.map(point => mercatorY(y(point)));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = PROVINCE_HEIGHT / (maxY - minY);
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2;
  const offsetY = (HEIGHT - PROVINCE_HEIGHT) / 2;
  const project = (point: Position): Position => [
    (mercatorX(x(point)) - minX) * scale + offsetX,
    (mercatorY(y(point)) - minY) * scale + offsetY
  ];

  const paths = cities.features.map(feature => {
    const data = polygonsOf(feature)
      .map(rings => {
        const projected = rings.map(ring => ring.map(project));
        const simplified = simplify({ type: 'Polygon', coordinates: projected }, { tolerance: PATH_SIMPLIFY_TOLERANCE });
        return simplified.coordinates
          .map(ring => `M${ring.slice(0, -1).map(point => `${x(point).toFixed(1)} ${y(point).toFixed(1)}`).join('L')}Z`)
          .join('');
      })
      .join('');
    return `<path fill="${options.landColor}" d="${data}"/>`;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${options.outsideColor}"/>` +
    `<g stroke="${options.lineColor}" stroke-width="0.6" stroke-linejoin="round">${paths.join('')}</g>` +
    '</svg>\n'
  );
}
