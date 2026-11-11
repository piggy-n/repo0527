import type { LayerSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { VectorLayerSpecification } from './mvt/mvt-protocol';
import type { VectorPlan } from './mvt/scene-vectors';
import type { OverlayLayerSpecification, OverlaySpec } from './overlay-plan';
import { type TileUrlTemplate, tileUrlTemplate } from './url-template';

/** 一个影像图层：对应二维的一个 raster 图层 */
export interface ImageryPlan extends TileUrlTemplate {
  /** 二维的图层 ID */
  readonly id: string;
  readonly sourceId: string;
  readonly tileSize: number;
  readonly minimumLevel: number;
  readonly maximumLevel: number;
  readonly opacity: number;
  readonly show: boolean;
}

/** 三维不支持、跳过的图层（ADR 0079 第 7 节） */
export interface UnsupportedLayer {
  readonly layerId: string;
  readonly reason: string;
}

/** 三维从样式里取用的部分：影像按样式里的顺序从下到上 */
export interface SceneStylePlan {
  readonly imagery: readonly ImageryPlan[];
  /** 地球的底色；没有 background 图层时为 null，用场景的默认颜色 */
  readonly baseColor: string | null;
  /** GeoJSON 覆盖物，按样式里的顺序；形状在数据就绪后按级别推导（ADR 0080 第 1 节） */
  readonly overlays: readonly OverlaySpec[];
  /** 矢量瓦片的数据源（方案 B 的 PoC）：每个数据源一个，按第一个图层在样式里的位置从下到上 */
  readonly vectors: readonly VectorPlan[];
  readonly unsupported: readonly UnsupportedLayer[];
}

// 三维画不出来的样式属性：用了就整个图层跳过；清单外其他属性忽略（ADR 0080 第 1 节）
const UNSUPPORTED_PAINT = ['line-pattern', 'line-gradient', 'fill-pattern'] as const;

// MapLibre 的默认值：raster 数据源的瓦片 512 像素、0～22 级
const DEFAULT_TILE_SIZE = 512;
const DEFAULT_MAX_ZOOM = 22;

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const fail = (reason: string): Result<never> => ({ ok: false, reason });

function sourceReason(source: SourceSpecification | undefined): string {
  return `三维不支持 ${source?.type ?? '未知'} 数据源`;
}

// 影像的透明度只支持常量；覆盖物的样式在 overlay-plan 里按要素求值
function constantNumber(value: unknown, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === 'number' ? value : null;
}

function planRaster(
  layer: Extract<LayerSpecification, { type: 'raster' }>,
  source: SourceSpecification | undefined
): Result<ImageryPlan> {
  if (source?.type !== 'raster') {
    return fail(sourceReason(source));
  }
  if (!source.tiles || source.url !== undefined || (source.scheme ?? 'xyz') !== 'xyz') {
    return fail('三维只支持直接给出 tiles 的 xyz 瓦片');
  }
  if (layer.minzoom !== undefined || layer.maxzoom !== undefined) {
    return fail('三维不支持图层的级别范围');
  }
  const template = tileUrlTemplate(source.tiles);
  if (!template) {
    return fail('瓦片地址里有三维不支持的占位符');
  }
  const opacity = constantNumber(layer.paint?.['raster-opacity'], 1);
  if (opacity === null) {
    return fail('raster-opacity 不是常量');
  }
  return {
    ok: true,
    value: {
      ...template,
      id: layer.id,
      sourceId: layer.source,
      tileSize: source.tileSize ?? DEFAULT_TILE_SIZE,
      minimumLevel: source.minzoom ?? 0,
      maximumLevel: source.maxzoom ?? DEFAULT_MAX_ZOOM,
      opacity,
      show: layer.layout?.visibility !== 'none'
    }
  };
}

function planBackground(layer: Extract<LayerSpecification, { type: 'background' }>): Result<string | null> {
  if (layer.layout?.visibility === 'none') {
    return { ok: true, value: null };
  }
  const color = layer.paint?.['background-color'];
  if (color !== undefined && typeof color !== 'string') {
    return fail('background-color 不是常量');
  }
  return { ok: true, value: color ?? null };
}

function planOverlay(
  layer: OverlayLayerSpecification,
  source: SourceSpecification | undefined,
  order: number
): Result<OverlaySpec> {
  if (source?.type !== 'geojson') {
    return fail(sourceReason(source));
  }
  const paint: Readonly<Record<string, unknown>> = layer.paint ?? {};
  const property = UNSUPPORTED_PAINT.find(name => name in paint);
  if (property) {
    return fail(`三维不支持 ${property}`);
  }
  return { ok: true, value: { layer, order, sourceId: layer.source, data: source.data } };
}

// MapLibre 的默认值：vector 数据源 0～22 级
const DEFAULT_VECTOR_MAX_ZOOM = 22;

interface VectorDraft {
  readonly sourceId: string;
  readonly tiles: string;
  readonly minzoom: number;
  readonly maxzoom: number;
  readonly promoteId: string | null;
  readonly layers: VectorLayerSpecification[];
  readonly labelLayers: Extract<LayerSpecification, { type: 'symbol' }>[];
}

// 矢量数据源上的图层（方案 B 的 PoC）：fill、line、circle 画进 Worker 栅格化的位图，有文字的 symbol 只取文字
function planVector(
  layer: Extract<LayerSpecification, { type: 'fill' | 'line' | 'circle' | 'symbol' }>,
  source: Extract<SourceSpecification, { type: 'vector' }>,
  drafts: Map<string, VectorDraft>
): Result<null> {
  const [tiles] = source.tiles ?? [];
  if (tiles === undefined || source.url !== undefined || (source.scheme ?? 'xyz') !== 'xyz') {
    return fail('三维只支持直接给出 tiles 的 xyz 矢量瓦片');
  }
  let draft = drafts.get(layer.source);
  if (!draft) {
    draft = {
      sourceId: layer.source,
      tiles,
      minzoom: source.minzoom ?? 0,
      maxzoom: source.maxzoom ?? DEFAULT_VECTOR_MAX_ZOOM,
      promoteId: typeof source.promoteId === 'string' ? source.promoteId : null,
      layers: [],
      labelLayers: []
    };
    drafts.set(layer.source, draft);
  }
  if (layer.type === 'symbol') {
    draft.labelLayers.push(layer);
  } else {
    draft.layers.push(layer);
  }
  return { ok: true, value: null };
}

/**
 * 从二维的样式推导三维的影像图层、地球底色和覆盖物，支持清单之外的图层列出原因
 * （ADR 0024 第 10 节、ADR 0079 第 7 节、ADR 0080 第 1 节）
 */
export function planSceneStyle(style: StyleSpecification): SceneStylePlan {
  const imagery: ImageryPlan[] = [];
  const overlays: OverlaySpec[] = [];
  const unsupported: UnsupportedLayer[] = [];
  const vectors = new Map<string, VectorDraft>();
  let baseColor: string | null = null;
  for (const [order, layer] of style.layers.entries()) {
    if (layer.type === 'background') {
      const result = planBackground(layer);
      if (result.ok) {
        baseColor = result.value ?? baseColor;
      } else {
        unsupported.push({ layerId: layer.id, reason: result.reason });
      }
      continue;
    }
    if (layer.type === 'raster') {
      const result = planRaster(layer, style.sources[layer.source]);
      if (result.ok) {
        imagery.push(result.value);
      } else {
        unsupported.push({ layerId: layer.id, reason: result.reason });
      }
      continue;
    }
    // symbol 只画文字：没有文字的（只有图标）不算支持（ADR 0146）
    if (layer.type === 'symbol' && layer.layout?.['text-field'] === undefined) {
      unsupported.push({ layerId: layer.id, reason: '三维只画 symbol 图层的文字，这个图层没有 text-field' });
      continue;
    }
    if (layer.type === 'line' || layer.type === 'fill' || layer.type === 'circle' || layer.type === 'symbol') {
      const source = style.sources[layer.source];
      if (source?.type === 'vector') {
        const planned = planVector(layer, source, vectors);
        if (!planned.ok) {
          unsupported.push({ layerId: layer.id, reason: planned.reason });
        }
        continue;
      }
      const result = planOverlay(layer, source, order);
      if (result.ok) {
        overlays.push(result.value);
      } else {
        unsupported.push({ layerId: layer.id, reason: result.reason });
      }
      continue;
    }
    unsupported.push({ layerId: layer.id, reason: `三维暂不支持 ${layer.type} 图层` });
  }
  const plans: VectorPlan[] = [];
  for (const draft of vectors.values()) {
    plans.push({ ...draft, key: JSON.stringify(draft) });
  }
  return { imagery, baseColor, overlays, vectors: plans, unsupported };
}
