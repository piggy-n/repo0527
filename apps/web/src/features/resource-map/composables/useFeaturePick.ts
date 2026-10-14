import type { Geometry, Point, Polygon } from 'geojson';
import type {
  CameraState,
  FitBoundsOptions,
  MapInputEvent,
  MapTool,
  ScreenPoint,
  StyleGroup,
  ToolView
} from '@yzt/map-core';
import type { CameraOperation, MapContext } from '@yzt/map-vue';
import { LatestController } from '@yzt/utils';
import {
  computed,
  type ComputedRef,
  getCurrentScope,
  onScopeDispose,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  watch
} from 'vue';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import { type FeatureDetail, type FeaturePage, queryFeaturesAt } from '../api';
import {
  featureBounds,
  type IdentifyTask,
  PICK_PAGE_SIZE,
  type PickCandidate,
  type PickResource,
  pickResources,
  planIdentify,
  queryCapabilityOf,
  serverCandidates
} from '../feature-query';
import { type FeatureKey, useFeatureDetailQuery } from '../queries';
import type { ResourceLayersState } from '../resource-layers';
import { selectionGroup } from '../selection-style';
import type { ResourceLayers } from './useResourceLayers';

/** 后端识别的分页，用来加载更多 */
export interface ServerPages {
  /** 识别时的地理范围 */
  readonly geometry: Point | Polygon;
  /** 已加载的页数 */
  readonly loaded: number;
  readonly total: number;
}

/** 一个资源的候选；渲染要素的没有分页 */
export interface CandidateList {
  readonly target: PickResource;
  readonly candidates: readonly PickCandidate[];
  readonly pages: ServerPages | null;
}

/** 从候选进入详情时记下的列表和视角，返回时恢复 */
export interface PickReturn {
  readonly list: CandidateList;
  readonly camera: CameraState;
}

/** 加载更多的状态 */
export type MoreStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly error: unknown };

/** 点选的状态（ADR 0047 第 2、6、7 节） */
export type FeaturePickState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'identifying' }
  /** 点击位置没有可识别的要素 */
  | { readonly kind: 'empty' }
  /** 查后端失败，可以从这个资源继续识别 */
  | { readonly kind: 'failed'; readonly target: PickResource; readonly error: unknown }
  | { readonly kind: 'candidates'; readonly list: CandidateList; readonly more: MoreStatus }
  /** back 为 null 时没有可返回的列表 */
  | { readonly kind: 'detail'; readonly candidate: PickCandidate; readonly back: PickReturn | null };

/** 详情的加载状态；数据由查询缓存持有 */
export type FeatureDetailStatus =
  /** 资源不能查详情：属性用候选的，没有完整几何 */
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: FeatureDetail }
  | { readonly kind: 'failed'; readonly error: unknown };

/** 选择的拥有者（ADR 0047）：页面登记点选工具、绑定 selection 分组，详情面板通过 props 拿到它 */
export interface FeaturePick {
  readonly state: Readonly<ShallowRef<FeaturePickState>>;
  /** 详情的加载状态，只在 detail 时有值 */
  readonly detail: ComputedRef<FeatureDetailStatus | null>;
  /** 交给 registerTools */
  readonly tools: Readonly<Record<typeof FEATURE_PICK_TOOL, MapTool>>;
  /** 从候选列表进入详情：记下视角，详情到了以后定位并闪烁；不是当前列表里的候选时抛错 */
  readonly choose: (candidate: PickCandidate) => void;
  /** 回到候选列表和进入前的视角；没有可返回的列表时什么也不做 */
  readonly back: () => void;
  /** 加载下一页候选；没有更多、正在加载时什么也不做 */
  readonly loadMore: () => void;
  /** 识别失败时从失败的资源继续，详情失败时重新查询；其他时候什么也不做 */
  readonly retry: () => void;
  /** 定位到选中的要素并闪烁；还没有完整几何时什么也不做 */
  readonly locate: () => void;
  /** 作废进行中的识别，清除选择 */
  readonly close: () => void;
  /** 绑定到 selection 分组 */
  readonly deriveGroup: () => StyleGroup;
}

/** 后端识别还有没加载的页 */
export function hasMorePages(pages: ServerPages | null): boolean {
  return pages !== null && pages.loaded * PICK_PAGE_SIZE < pages.total;
}

// 定位最多放大到 17 级，四边避开登记的悬浮元素（ADR 0047 第 5 节）
const FIT_OPTIONS: FitBoundsOptions = { maxZoom: 17 };

// 闪烁两次：亮、灭、亮、灭，每 200 ms 切换
const FLASH_INTERVAL = 200;
const FLASH_TOGGLES = 3;

const IDLE: FeaturePickState = Object.freeze({ kind: 'idle' });
const IDENTIFYING: FeaturePickState = Object.freeze({ kind: 'identifying' });
const EMPTY: FeaturePickState = Object.freeze({ kind: 'empty' });
const MORE_IDLE: MoreStatus = Object.freeze({ kind: 'idle' });

// 资源仍然勾选、年份没变、还在目录里
function isShown(state: ResourceLayersState, target: PickResource): boolean {
  const { code } = target.resource;
  const display = state.displays.get(code);
  return display?.checked === true && display.year === target.year && state.catalog?.resources.has(code) === true;
}

// 参与识别的资源和年份，连同顺序；变了时进行中的识别作废
function identifySignature(state: ResourceLayersState): string {
  return state.order
    .filter(code => state.displays.get(code)?.checked && state.catalog?.resources.has(code))
    .map(code => `${code}@${state.displays.get(code)?.year}`)
    .join();
}

/** 创建选择的拥有者，在 provideMap 所在组件的 setup 中调用；作用域销毁时作废进行中的识别和加载 */
export function useFeaturePick(
  map: Pick<MapContext, 'useCamera' | 'select' | 'beginCameraOperation' | 'runCameraOperation'>,
  resources: Pick<ResourceLayers, 'state' | 'configErrors'>
): FeaturePick {
  if (!getCurrentScope()) {
    throw new Error('useFeaturePick 只能在组件的 setup 或 effectScope 中调用');
  }
  const camera = map.useCamera();
  const state = shallowRef<FeaturePickState>(IDLE);
  const flashing = shallowRef(false);
  // 识别、加载更多各是一条可替换的通道（ADR 0039）
  const identifications = new LatestController();
  const pages = new LatestController();
  // 识别失败时还没识别的资源，重试时从失败的那个继续
  let remaining: readonly IdentifyTask[] = [];
  // 详情到了以后要执行的定位
  let pendingLocate: CameraOperation | null = null;
  let flashTimer: ReturnType<typeof setInterval> | undefined;

  const stopFlash = () => {
    clearInterval(flashTimer);
    flashTimer = undefined;
    flashing.value = false;
  };

  const flash = () => {
    stopFlash();
    let toggles = 0;
    flashing.value = true;
    flashTimer = setInterval(() => {
      toggles++;
      flashing.value = toggles % 2 === 0;
      if (toggles >= FLASH_TOGGLES) {
        stopFlash();
      }
    }, FLASH_INTERVAL);
  };

  // 换状态时放下之前的闪烁和待执行的定位
  const setState = (next: FeaturePickState, locate: CameraOperation | null = null) => {
    stopFlash();
    pendingLocate = locate;
    state.value = next;
  };

  const selected = computed(() => {
    const current = state.value;
    return current.kind === 'detail' ? current.candidate : null;
  });
  const detailKey = computed((): FeatureKey | null => {
    const candidate = selected.value;
    if (!candidate || !queryCapabilityOf(candidate.target.resource.code).detail) {
      return null;
    }
    return { layerCode: candidate.target.layerCode, guid: candidate.guid };
  });
  const query = useFeatureDetailQuery(detailKey);
  const detail = computed((): FeatureDetailStatus | null => {
    const key = detailKey.value;
    if (!selected.value) {
      return null;
    }
    if (!key) {
      return { kind: 'unsupported' };
    }
    // 换了要素后查询要到下一轮调度才换过来，期间的结果属于上一个要素
    const entry = query.data.value;
    if (entry?.feature.layerCode === key.layerCode && entry.feature.guid === key.guid) {
      return { kind: 'ready', detail: entry.detail };
    }
    return query.isError.value ? { kind: 'failed', error: query.error.value } : { kind: 'loading' };
  });

  // 会话只存选中要素的身份（ADR 0047 第 4 节）；在下一轮调度写入，作用域销毁时（地图上下文可能已经释放）不再写
  watch(selected, candidate =>
    map.select(candidate ? [{ sourceId: candidate.target.sourceId, featureId: candidate.guid }] : [])
  );

  const fitTo = (operation: Pick<CameraOperation, 'run'>, geometry: Geometry) => {
    const bounds = featureBounds(geometry);
    operation.run(control => control.fitBounds(bounds, FIT_OPTIONS));
    flash();
  };

  // 从候选选中、后端识别选中的要素，详情到了以后定位并闪烁；不能查详情的放弃，失败的等重试
  watch(detail, status => {
    const operation = pendingLocate;
    if (!operation || status?.kind === 'loading' || status?.kind === 'failed') {
      return;
    }
    pendingLocate = null;
    if (status?.kind === 'ready') {
      fitTo(operation, status.detail.geometry);
    }
  });

  const showDetail = (candidate: PickCandidate, back: PickReturn | null, locate: boolean) =>
    setState({ kind: 'detail', candidate, back }, locate ? map.beginCameraOperation() : null);

  const found = (target: PickResource, candidates: readonly PickCandidate[], serverPages: ServerPages | null) => {
    const [only] = candidates;
    if (only && candidates.length === 1 && !hasMorePages(serverPages)) {
      // 后端识别出的要素可能很小或不在眼前，定位并闪烁；直接点中的渲染要素就在眼前，不移动相机
      showDetail(only, null, serverPages !== null);
      return;
    }
    setState({ kind: 'candidates', list: { target, candidates, pages: serverPages }, more: MORE_IDLE });
  };

  // 从上到下逐个资源识别，第一个有结果的胜出（ADR 0047 第 2 节）
  const run = async (tasks: readonly IdentifyTask[], signal: AbortSignal) => {
    for (const [index, task] of tasks.entries()) {
      if (task.kind === 'rendered') {
        found(task.target, task.candidates, null);
        return;
      }
      let page: FeaturePage;
      try {
        const first = { pageNum: 1, pageSize: PICK_PAGE_SIZE };
        // oxlint-disable-next-line no-await-in-loop -- 上面的资源有结果时下面的不再查询
        page = await queryFeaturesAt(task.target.layerCode, task.geometry, first, signal);
      } catch (error) {
        if (!signal.aborted) {
          remaining = tasks.slice(index);
          setState({ kind: 'failed', target: task.target, error });
        }
        return;
      }
      if (signal.aborted) {
        return;
      }
      const candidates = serverCandidates(task.target, page.list);
      if (candidates.length > 0) {
        found(task.target, candidates, { geometry: task.geometry, loaded: 1, total: page.total });
        return;
      }
    }
    setState(EMPTY);
  };

  const identify = (point: ScreenPoint, view: ToolView) => {
    const signal = identifications.next();
    pages.abort();
    const { zoom } = camera.value;
    const targets = pickResources(resources.state.value, resources.configErrors.value, zoom);
    // 屏幕上的查询在点击时做完，之后地图移动不影响结果
    const tasks = planIdentify(targets, point, zoom, view);
    setState(IDENTIFYING);
    void run(tasks, signal);
  };

  const close = () => {
    identifications.abort();
    pages.abort();
    remaining = [];
    setState(IDLE);
  };

  const choose = (candidate: PickCandidate) => {
    const current = state.value;
    if (current.kind !== 'candidates' || !current.list.candidates.includes(candidate)) {
      throw new Error('只能选择当前候选列表里的要素');
    }
    pages.abort();
    showDetail(candidate, { list: current.list, camera: camera.value }, true);
  };

  const back = () => {
    const current = state.value;
    if (current.kind !== 'detail' || !current.back) {
      return;
    }
    const { list, camera: view } = current.back;
    setState({ kind: 'candidates', list, more: MORE_IDLE });
    // 回到进入详情前的视角，原样恢复，不避开悬浮元素
    map.runCameraOperation(control => control.flyTo(view, { padding: 0 }));
  };

  const fetchMore = async (list: CandidateList, serverPages: ServerPages, signal: AbortSignal) => {
    const range = { pageNum: serverPages.loaded + 1, pageSize: PICK_PAGE_SIZE };
    let page: FeaturePage;
    try {
      page = await queryFeaturesAt(list.target.layerCode, serverPages.geometry, range, signal);
    } catch (error) {
      if (!signal.aborted) {
        setState({ kind: 'candidates', list, more: { kind: 'failed', error } });
      }
      return;
    }
    if (signal.aborted) {
      return;
    }
    // 翻页期间数据可能变化，已经列出的不再重复
    const known = new Set(list.candidates.map(({ key }) => key));
    const added = serverCandidates(list.target, page.list).filter(({ key }) => !known.has(key));
    const candidates = [...list.candidates, ...added];
    const next = { geometry: serverPages.geometry, loaded: range.pageNum, total: page.total };
    setState({ kind: 'candidates', list: { ...list, candidates, pages: next }, more: MORE_IDLE });
  };

  const loadMore = () => {
    const current = state.value;
    if (current.kind !== 'candidates' || current.more.kind === 'loading') {
      return;
    }
    const { list } = current;
    if (!list.pages || !hasMorePages(list.pages)) {
      return;
    }
    const signal = pages.next();
    setState({ kind: 'candidates', list, more: { kind: 'loading' } });
    void fetchMore(list, list.pages, signal);
  };

  const retry = () => {
    const current = state.value;
    if (current.kind === 'failed') {
      const signal = identifications.next();
      setState(IDENTIFYING);
      void run(remaining, signal);
      return;
    }
    if (detail.value?.kind === 'failed') {
      void query.refetch();
    }
  };

  const locate = () => {
    const status = detail.value;
    if (status?.kind === 'ready') {
      fitTo(map.beginCameraOperation(), status.detail.geometry);
    }
  };

  // 选中的资源取消勾选、换了年份、不在目录里时清除；叠放顺序变了时保留详情，但不能再返回旧的列表（ADR 0047 第 6 节）
  watch(
    () => resources.state.value,
    (next, previous) => {
      const current = state.value;
      switch (current.kind) {
        case 'identifying':
        case 'failed':
          if (identifySignature(next) !== identifySignature(previous)) {
            close();
          }
          break;
        case 'candidates':
          if (!isShown(next, current.list.target)) {
            close();
          }
          break;
        case 'detail':
          if (!isShown(next, current.candidate.target)) {
            close();
          } else if (current.back && next.order.join() !== previous.order.join()) {
            state.value = { ...current, back: null };
          }
          break;
        case 'idle':
        case 'empty':
          break;
      }
    }
  );

  const handleInput = (event: MapInputEvent, view: ToolView): boolean => {
    // 拖动后的松手不算单击；双击的第二下忽略
    if (event.type === 'click' && event.button === 0 && event.clickCount === 1) {
      identify(event.point, view);
      return true;
    }
    if (event.type === 'key' && event.key === 'Escape') {
      close();
      return true;
    }
    return false;
  };

  // 常驻模式、默认箭头光标；5C.6a 不关拖动平移（ADR 0047 第 6 节）；离开点选工具时清除
  const pickTool: MapTool = { persistent: true, cursor: 'default', deactivate: close, handleInput };

  onScopeDispose(() => {
    identifications[Symbol.dispose]();
    pages[Symbol.dispose]();
    stopFlash();
  });

  return {
    state: shallowReadonly(state),
    detail,
    tools: { [FEATURE_PICK_TOOL]: pickTool },
    choose,
    back,
    loadMore,
    retry,
    locate,
    close,
    deriveGroup: () => {
      const status = detail.value;
      return selectionGroup(status?.kind === 'ready' ? status.detail.geometry : null, flashing.value);
    }
  };
}
