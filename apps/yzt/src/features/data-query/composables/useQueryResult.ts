import { bbox } from '@turf/bbox';
import type { StyleGroup, ViewBounds } from '@yzt/map-core';
import type { CameraOperation, MapContext } from '@yzt/map-vue';
import { LatestController } from '@yzt/utils';
import type { FeatureCollection } from 'geojson';
import {
  computed,
  type ComputedRef,
  getCurrentScope,
  nextTick,
  onScopeDispose,
  readonly,
  type Ref,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  toRaw,
  watch
} from 'vue';
import { appConfig } from '@/shared/config/app-config';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { findRegion } from '@/shared/map/region/region-catalog';
import { type RegionBoundaryLoader, sharedRegionBoundaryLoader } from '@/shared/map/region/region-geometry';
import { usePagedList } from '@/shared/table/usePagedList';
import type { QueryRequest, ResultPage } from '../api';
import { useResultFeaturesQuery, useResultPageQuery } from '../queries';
import { featureCollection, queryTileBase, resultGroup } from '../result-layers';
import { layerOf, type QueryLayer, type QueryTopic } from '../topics';

/** 每页条数，同旧页面 */
export const RESULT_PAGE_SIZE = 100;

// 定位到结果时最多放大到这一级，同旧页面
const FIT_MAX_ZOOM = 14;
// 画的范围按外包框放大一倍定位，周围的结果也看得到（同旧页面）
const SHAPE_FIT_SCALE = 2;

/** 一次查询的第一个结果：页面据此提示（如"空间查询成功，已绘制 N 个结果"）；每次提交一个新的对象 */
export type QueryOutcome =
  | { readonly request: QueryRequest; readonly status: 'success'; readonly total: number }
  | { readonly request: QueryRequest; readonly status: 'error' };

/** 查询结果的拥有者：最后一次提交的查询，结果表的分页、空间查询的要素和地图上的结果分组 */
export interface QueryResult {
  /** 最后一次提交的查询；清除后为 null */
  readonly request: Readonly<ShallowRef<QueryRequest | null>>;
  readonly layer: ComputedRef<QueryLayer | null>;
  readonly page: ComputedRef<ResultPage | undefined>;
  readonly total: ComputedRef<number>;
  readonly pageNum: Readonly<Ref<number>>;
  readonly initialLoading: ComputedRef<boolean>;
  readonly refreshing: ComputedRef<boolean>;
  readonly isError: Readonly<Ref<boolean>>;
  readonly outcome: Readonly<ShallowRef<QueryOutcome | null>>;
  /** 提交一次查询：结果表回到第 1 页，同一个查询再提交时重新请求；定位到查询的范围 */
  readonly submit: (request: QueryRequest) => void;
  readonly clear: () => void;
  readonly setPage: (page: number) => void;
  readonly refresh: () => Promise<void>;
  /** 绑定到 query-result 分组 */
  readonly deriveGroup: () => StyleGroup;
}

export interface QueryResultOptions {
  readonly map: Pick<MapContext, 'beginCameraOperation'>;
  readonly topic: QueryTopic;
  /** 测试时传入；默认是共用的区划边界 */
  readonly loader?: RegionBoundaryLoader;
}

// 外包框以中心放大 scale 倍
function scaleBounds([west, south, east, north]: ViewBounds, scale: number): ViewBounds {
  const [halfWidth, halfHeight] = [((east - west) * scale) / 2, ((north - south) * scale) / 2];
  const [centerX, centerY] = [(west + east) / 2, (south + north) / 2];
  return [centerX - halfWidth, centerY - halfHeight, centerX + halfWidth, centerY + halfHeight];
}

function boundsOf(collection: FeatureCollection): ViewBounds {
  const [west, south, east, north] = bbox(collection);
  return [west, south, east, north];
}

// 等结果面板挂上再定位：定位要避开它，登记的悬浮元素是在定位的那一刻量的（ADR 0029）
async function fitAfterRender(
  operation: CameraOperation,
  signal: AbortSignal,
  bounds: () => ViewBounds | Promise<ViewBounds>
): Promise<void> {
  try {
    await nextTick();
    const target = await bounds();
    if (!signal.aborted) {
      operation.run(camera => camera.fitBounds(target, { maxZoom: FIT_MAX_ZOOM }));
    }
  } catch {
    // 边界加载失败时不定位，结果照常显示
  }
}

export function useQueryResult({ map, topic, loader = sharedRegionBoundaryLoader() }: QueryResultOptions): QueryResult {
  if (!getCurrentScope()) {
    throw new Error('useQueryResult 只能在组件的 setup 或 effectScope 中调用');
  }
  const request = shallowRef<QueryRequest | null>(null);
  const list = usePagedList({
    emptyFilters: (): { request: QueryRequest | null } => ({ request: null }),
    // 表单是 reactive 的，交给查询缓存前取回原始对象
    normalize: filters => ({ request: filters.request && toRaw(filters.request) }),
    useQuery: useResultPageQuery
  });
  list.changePageSize(RESULT_PAGE_SIZE);
  const features = useResultFeaturesQuery(request);
  const tileBase = queryTileBase(appConfig.apiBaseUrl, window.location.origin);

  const layer = computed(() => (request.value ? (layerOf(topic, request.value.layerCode) ?? null) : null));
  // 交给会话的 GeoJSON 换新对象，不原地修改（ADR 0022）
  const collection = computed(() => (features.data.value ? featureCollection(features.data.value) : null));

  const outcome = shallowRef<QueryOutcome | null>(null);
  // 这次提交还没有给出结果
  let awaiting: QueryRequest | null = null;
  const settle = (current: QueryRequest, result: QueryOutcome) => {
    if (awaiting === current) {
      awaiting = null;
      outcome.value = result;
    }
  };
  // 属性类按结果表的第一页，空间类按命中的要素
  const pageStatus = [list.page, list.initialLoading, list.refreshing, list.isError] as const;
  watch(pageStatus, ([page, initialLoading, refreshing, isError]) => {
    const current = request.value;
    if (current?.kind !== 'attribute' || initialLoading || refreshing) {
      return;
    }
    if (isError) {
      settle(current, { request: current, status: 'error' });
    } else if (page) {
      settle(current, { request: current, status: 'success', total: list.total.value });
    }
  });

  // 定位：属性类定位到行政区划，画的范围定位到放大一倍的外包框，shp 等命中的要素到了再定位
  const focuses = new LatestController();
  onScopeDispose(() => focuses[Symbol.dispose]());
  let pendingShp: { readonly request: QueryRequest; readonly run: (bounds: ViewBounds) => void } | null = null;

  watch([features.data, features.isError], ([data, isError]) => {
    const current = request.value;
    if (current === null || current.kind === 'attribute') {
      return;
    }
    if (isError) {
      settle(current, { request: current, status: 'error' });
      return;
    }
    const fit = pendingShp;
    if (data && collection.value) {
      settle(current, { request: current, status: 'success', total: data.length });
      if (fit?.request === current && data.length > 0) {
        pendingShp = null;
        fit.run(boundsOf(collection.value));
      }
    }
  });

  const focus = (current: QueryRequest) => {
    pendingShp = null;
    const signal = focuses.next();
    const operation = map.beginCameraOperation();
    if (current.kind === 'attribute') {
      const region = findRegion(current.xzqdm);
      const bounds = async () => (region ? (await loader.load(region)).bounds : JIANGSU_BOUNDS);
      void fitAfterRender(operation, signal, bounds);
      return;
    }
    if (current.kind === 'geometry') {
      void fitAfterRender(operation, signal, () => scaleBounds(current.bounds, SHAPE_FIT_SCALE));
      return;
    }
    pendingShp = { request: current, run: bounds => void fitAfterRender(operation, signal, () => bounds) };
  };

  const apply = (next: QueryRequest | null) => {
    request.value = next;
    list.filterForm.request = next;
    list.search();
  };

  return {
    request: shallowReadonly(request),
    layer,
    page: list.page,
    total: list.total,
    pageNum: readonly(list.pageNum),
    initialLoading: list.initialLoading,
    refreshing: list.refreshing,
    isError: list.isError,
    outcome: shallowReadonly(outcome),
    submit: next => {
      awaiting = next;
      apply(next);
      focus(next);
    },
    clear: () => {
      awaiting = null;
      pendingShp = null;
      focuses.abort();
      if (request.value !== null) {
        apply(null);
      }
    },
    setPage: page => {
      list.pageNum.value = page;
    },
    refresh: list.refresh,
    deriveGroup: () => resultGroup(request.value, layer.value, collection.value, tileBase)
  };
}
