import { bbox } from '@turf/bbox';
import { bboxClip } from '@turf/bbox-clip';
import { intersect } from '@turf/intersect';
import type { BBox, MultiPolygon, Polygon } from 'geojson';
import {
  AREA_LIMITS,
  type AreaFailure,
  type AreaGeometry,
  geometryMeasure,
  problem,
  vertexCount
} from './area-geometry';

// 范围覆盖了哪些行政区（docs/modules/shared-map.md 的"自定义范围"）。在 Worker 里运行，只用相对导入和 npm 包

/** 参与分析的一个行政区 */
export interface RegionShape {
  readonly code: string;
  readonly geometry: Polygon | MultiPolygon;
}

/** 全部覆盖或部分覆盖；没有列出的行政区是未覆盖 */
export type CoverRelation = 'full' | 'partial';

/** 范围覆盖的一个行政区 */
export interface RegionCover {
  readonly code: string;
  readonly relation: CoverRelation;
  /** 范围内的面积（平方千米） */
  readonly area: number;
  /** 范围内面积占行政区面积的比例，0～1 */
  readonly ratio: number;
  /** 行政区在范围内的部分 */
  readonly geometry: Polygon | MultiPolygon;
}

/** 只与范围的边界相交的行政区：交集很小，或只是沿边界的细条，按未覆盖处理 */
export interface RegionTouch {
  readonly code: string;
  readonly area: number;
}

export interface AreaCoverage {
  /** 范围的面积（平方千米） */
  readonly area: number;
  /** 覆盖的行政区里的面积合计：参与计算的部分 */
  readonly coveredArea: number;
  /** 不在任何行政区里的面积（如省外）；在边界误差以内时为 0 */
  readonly outsideArea: number;
  /** 按传入行政区的先后 */
  readonly covers: readonly RegionCover[];
  readonly touches: readonly RegionTouch[];
}

export type CoverOutcome = { readonly ok: true; readonly coverage: AreaCoverage } | AreaFailure;

/**
 * 判定的容差：县界经过简化，和上传的精确边界、沿边界画的线都有出入。
 * 宽度按"沿周长的一条带"估计，比例防止大行政区的误差带过宽
 */
export const COVER_RULES = {
  /** 行政区在范围外的部分不超过它面积的这个比例时，算全部覆盖 */
  fullRatio: 0.005,
  /** 或者不超过"周长 × 这个宽度（千米）"时，也算全部覆盖 */
  fullBand: 0.025,
  /** 交集小于这个面积（平方千米，同范围的最小面积）时只算边界相交 */
  touchArea: AREA_LIMITS.minArea,
  /** 交集的平均宽度（2 × 面积 ÷ 周长，千米）小于它时是沿边界的细条，只算边界相交 */
  touchWidth: 0.025,
  /** 范围自己的平均宽度小于它（千米）时不按宽度判断细条：细长的范围（如沿河的带）本来就窄 */
  thinArea: 0.3,
  /** 不在行政区里的面积同时超过这个值（平方千米）和范围面积的 outsideRatio 时才算在外面 */
  outsideArea: 0.1,
  outsideRatio: 0.005
} as const;

// 节点多于这个数时，先把范围裁到行政区的外包框再求交：裁剪是线性的，求交的耗时和节点数成正比
const CLIP_VERTICES = 500;

export interface CoverOptions {
  /** 这组行政区合起来的名称，写进提示，如"江苏省" */
  readonly scopeName: string;
  /** 每个行政区之后让出一次，取消时抛出 AbortError */
  readonly checkpoint?: () => Promise<void>;
}

const overlaps = (a: BBox, b: BBox): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

type Polygonal = Polygon | MultiPolygon;

const feature = (geometry: Polygonal) => ({ type: 'Feature' as const, properties: {}, geometry });

const intersection = (a: Polygonal, b: Polygonal): Polygonal | null =>
  intersect({ type: 'FeatureCollection', features: [feature(a), feature(b)] })?.geometry ?? null;

// 范围与一个行政区的交集；先裁到外包框时求交出错（裁出退化的环）就不裁再求一次
function pieceOf(area: AreaGeometry, region: RegionShape, regionBox: BBox, clip: boolean): Polygonal | null {
  if (clip) {
    try {
      const clipped = bboxClip(area, regionBox).geometry;
      if (clipped.type === 'Polygon' || clipped.type === 'MultiPolygon') {
        return intersection(clipped, region.geometry);
      }
    } catch {
      // 退回不裁的求交
    }
  }
  return intersection(area, region.geometry);
}

/** 范围与各行政区求交，分出全部覆盖、部分覆盖和只在边界相交；一个也没覆盖、覆盖的部分太小时返回原因 */
export async function coverRegions(
  area: AreaGeometry,
  regions: readonly RegionShape[],
  { scopeName, checkpoint = () => Promise.resolve() }: CoverOptions
): Promise<CoverOutcome> {
  const whole = geometryMeasure(area);
  const thin = (2 * whole.area) / whole.perimeter < COVER_RULES.thinArea;
  const box = bbox(area);
  const clip = vertexCount(area) > CLIP_VERTICES;
  const covers: RegionCover[] = [];
  const touches: RegionTouch[] = [];
  let intersected = 0;
  for (const region of regions) {
    // oxlint-disable-next-line no-await-in-loop -- 分段执行：每个行政区之后让出事件循环，取消消息才能被处理
    await checkpoint();
    const regionBox = bbox(region.geometry);
    if (!overlaps(box, regionBox)) {
      continue;
    }
    const piece = pieceOf(area, region, regionBox, clip);
    if (!piece) {
      continue;
    }
    const measure = geometryMeasure(piece);
    intersected += measure.area;
    const width = measure.perimeter > 0 ? (2 * measure.area) / measure.perimeter : 0;
    if (measure.area < COVER_RULES.touchArea || (!thin && width < COVER_RULES.touchWidth)) {
      touches.push({ code: region.code, area: measure.area });
      continue;
    }
    const target = geometryMeasure(region.geometry);
    const left = target.area - measure.area;
    const full = left <= Math.max(target.area * COVER_RULES.fullRatio, target.perimeter * COVER_RULES.fullBand);
    covers.push({
      code: region.code,
      relation: full ? 'full' : 'partial',
      area: measure.area,
      ratio: Math.min(1, measure.area / target.area),
      geometry: piece
    });
  }
  if (covers.length === 0) {
    return problem(
      'outside',
      touches.length > 0
        ? `范围只沿${scopeName}的边界略有重叠，没有覆盖任何区县，请检查后重新绘制或上传`
        : `范围不在${scopeName}内：与${scopeName}的区县都不重叠。请检查坐标系，或重新绘制`
    );
  }
  // 每个覆盖的交集都不小于 touchArea（等于最小面积），合计不会太小
  const coveredArea = covers.reduce((sum, cover) => sum + cover.area, 0);
  const gap = whole.area - intersected;
  const outside = gap >= COVER_RULES.outsideArea && gap >= whole.area * COVER_RULES.outsideRatio;
  return {
    ok: true,
    coverage: { area: whole.area, coveredArea, outsideArea: outside ? gap : 0, covers, touches }
  };
}
