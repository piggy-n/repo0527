import { useEventListener } from '@vueuse/core';
import type { Feature, Geometry } from 'geojson';
import type {
  CameraState,
  FitBoundsOptions,
  LngLat,
  MapInputEvent,
  MapTool,
  ScreenBox,
  ScreenPoint,
  SelectedFeature,
  StyleGroup,
  ToolView
} from '@mx/map-core';
import type { CameraOperation, MapContext } from '@mx/map-vue';
import { LatestController } from '@mx/utils';
import {
  acceptsClick,
  type BoxGesture,
  cancelBox,
  currentPanKey,
  drawingBox,
  moveBox,
  NO_BOX_GESTURE,
  type PointerHintContent,
  pressBox,
  releaseBox
} from '@mx/map-tools';
import {
  computed,
  type ComputedRef,
  getCurrentScope,
  nextTick,
  onScopeDispose,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  watch
} from 'vue';
import type { RegionScope } from '@/shared/map/region/region-scope';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import { type FeatureDetail, queryFeaturesAt } from '../api';
import {
  BOX_ESTIMATE_LIMIT,
  type BoxTask,
  featureBounds,
  FILTER_SCAN_PAGES,
  PICK_PAGE_SIZE,
  type PickCandidate,
  type PickResource,
  pickResources,
  planBox,
  planIdentify,
  type QueryArea,
  queryCapabilityOf,
  serverCandidates
} from '../feature-query';
import { type LabelEmphasis, type LabelTarget, selectionLabelsGroup } from '../labels';
import { pickHintLines, scenePickHintLines } from '../pick-hint';
import { type FeatureKey, useFeatureDetailQuery } from '../queries';
import { featurePasses, filterKey, isFiltering, sameFilter } from '../feature-filter';
import { isDrawn, type ResourceLayersState } from '../resource-layers';
import { type BatchHighlight, selectionGroup } from '../selection-style';
import { sourceLayerOf } from '../style-registry';
import type { ResourceLayers } from './useResourceLayers';

/** 后端识别的分页，用来加载更多 */
export interface ServerPages {
  /** 识别时的地理范围 */
  readonly geometry: QueryArea;
  /** 已加载的页数 */
  readonly loaded: number;
  readonly total: number;
  /** 识别时过滤着（ADR 0173）：列出的是后端结果里符合条件的，总数是筛之前的 */
  readonly filtered: boolean;
}

// 查到的后端结果：符合条件的候选，查到了第几页；tooMany 是过滤着、后端的总数超过了上限，没有往下查
interface ScannedPages {
  readonly candidates: readonly PickCandidate[];
  readonly loaded: number;
  readonly total: number;
  readonly tooMany: boolean;
}

/**
 * 从第 first 页查后端；过滤着时这一页一个都不符合、后面还有页，就接着查下一页，最多 FILTER_SCAN_PAGES 页（ADR 0173）。
 * 过滤着时渲染要素的估数只数符合条件的，拦不住后端按范围的统计：总数超过 limit 就不再查，交给调用方提示缩小范围。
 * 中止时以 AbortError 结束；调用方在等待以后自己再确认信号
 */
async function scanPages(
  target: PickResource,
  geometry: QueryArea,
  first: number,
  signal: AbortSignal,
  limit = Number.POSITIVE_INFINITY
): Promise<ScannedPages> {
  const filtering = isFiltering(target.filter);
  for (let pageNum = first; ; pageNum++) {
    // oxlint-disable-next-line no-await-in-loop -- 一页一页查，前一页有符合的就不再查
    const page = await queryFeaturesAt(target.layerCode, geometry, { pageNum, pageSize: PICK_PAGE_SIZE }, signal);
    if (filtering && page.total > limit) {
      return { candidates: [], loaded: pageNum, total: page.total, tooMany: true };
    }
    const candidates = serverCandidates(target, page.list);
    const more = pageNum * PICK_PAGE_SIZE < page.total;
    if (signal.aborted || candidates.length > 0 || !filtering || !more || pageNum - first + 1 >= FILTER_SCAN_PAGES) {
      return { candidates, loaded: pageNum, total: page.total, tooMany: false };
    }
  }
}

/** 结果来自单击还是框选（ADR 0049 第 3 节） */
export type PickMode = 'pick' | 'box';

// 一次识别：单击还是框选，单击时点中的位置（被面板挡住时露出来）；拾取不到、框选时为 null
interface Identification {
  readonly mode: PickMode;
  readonly anchor: LngLat | null;
}

// 一次识别的准备结果：要做的识别和识别的方式；点在区划外、框整个在区划外时为 null
type Prepared = { readonly tasks: BoxTask[]; readonly how: Identification } | null;

// 一次识别的准备：在点击的当下拾取、规划
type IdentifyPlan = () => Prepared;

/** 一个资源的候选；渲染要素的没有分页 */
export interface CandidateList {
  /** 列表的身份：每轮识别一个新的，加载更多、从详情返回时不变；面板据此决定是否回到顶部 */
  readonly id: number;
  readonly mode: PickMode;
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
  /** 查后端失败，可以从这个资源继续识别；规划本身出错（如几何求交）时 target 为 null，重试时重新规划 */
  | { readonly kind: 'failed'; readonly target: PickResource | null; readonly error: unknown }
  /** 框里这个资源的渲染要素超过估数的上限，没有请求后端 */
  | { readonly kind: 'too-many'; readonly target: PickResource; readonly estimate: number }
  /** 识别范围和区划求交后整理不成能发给后端的几何，没有请求后端（ADR 0051 第 4 节）；单击的容差框也可能出现 */
  | { readonly kind: 'too-complex'; readonly target: PickResource; readonly mode: PickMode }
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

/** 选择的拥有者（ADR 0047、0049）：页面登记点选工具、绑定 selection 分组，详情面板和框选的浮层通过 props 拿到它 */
export interface FeaturePick {
  readonly state: Readonly<ShallowRef<FeaturePickState>>;
  /** 拖动中正在画的框，交给框选的浮层；没有在框选时为 null */
  readonly boxDraft: ComputedRef<ScreenBox | null>;
  /**
   * 鼠标旁的提示，交给框选的浮层（ADR 0056 第 4 节）：每次进入点/框选时打开，第一次单击或框选识别之后关闭；
   * 视图就绪、指针在画布上、没有在框选时才有值
   */
  readonly hint: ComputedRef<PointerHintContent | null>;
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
  /**
   * 正在加强标注的要素（ADR 0160）：查询详情里正在看的那一个，而且它所在的资源开着标注；框选、悬停、在图层里选中一行都不算。
   * 页面把它交给资源的标注分组，滤掉这个要素原来的标注
   */
  readonly labelEmphasis: ComputedRef<LabelEmphasis | null>;
  /** 绑定到 selection-labels 分组：加强标注，和资源的标注分组读同一份状态、同一轮提交 */
  readonly deriveLabelsGroup: () => StyleGroup;
}

export interface FeaturePickOptions {
  /** 区划裁剪的范围（ADR 0051）：点选、框选只认范围里的要素，范围变化时关闭结果；不传时不限制 */
  readonly scope?: () => RegionScope | null;
  /** 用户的单击、框选开始了一次识别（规划出结果或失败时，在点击的当下调用）；页面据此切到资源详情（ADR 0053 第 4 节） */
  readonly onIdentifyStart?: () => void;
  /** 三维里画在模型上面的资源（ADR 0161）：点到模型时按鼠标下的地面识别；不传时都按模型脚下（规则甲） */
  readonly overModels?: (code: string) => boolean;
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

// 结果在右侧的面板里：单击的位置被面板挡住时平移地图让它露出来（设计稿 5D.6）。
// 面板随这次结果打开、变高，等它按新状态渲染以后再量；这期间开始了新的识别、关闭了结果就不动
function reveal(operation: CameraOperation, lngLat: LngLat, signal: AbortSignal): void {
  void nextTick(() => {
    if (!signal.aborted) {
      operation.run(control => control.reveal(lngLat));
    }
  });
}

function identityOf({ target, guid }: PickCandidate): SelectedFeature {
  return { sourceId: target.sourceId, featureId: guid };
}

/**
 * 资源仍然画在地图上、年份没变、还在目录里；给了要素的属性时它没被过滤掉，没给时过滤条件没变（列出的候选按识别时的条件，
 * ADR 0173）
 */
function isShown(
  state: ResourceLayersState,
  target: PickResource,
  properties?: Readonly<Record<string, unknown>>
): boolean {
  const { code } = target.resource;
  const display = state.displays.get(code);
  if (!display || !isDrawn(display) || display.year !== target.year || !state.catalog?.resources.has(code)) {
    return false;
  }
  return properties ? featurePasses(code, display.filter, properties) : sameFilter(display.filter, target.filter);
}

// 参与识别的资源、年份和过滤条件，连同顺序；变了时进行中的识别作废
function identifySignature(state: ResourceLayersState): string {
  return state.order
    .flatMap(code => {
      const display = state.displays.get(code);
      return display && isDrawn(display) && state.catalog?.resources.has(code)
        ? [`${code}@${display.year}#${filterKey(display.filter)}`]
        : [];
    })
    .join();
}

/** 创建选择的拥有者，在 provideMap 所在组件的 setup 中调用；作用域销毁时作废进行中的识别和加载 */
export function useFeaturePick(
  map: Pick<
    MapContext,
    'useCamera' | 'select' | 'beginCameraOperation' | 'runCameraOperation' | 'view' | 'pointer' | 'sceneCapabilities'
  >,
  resources: Pick<
    ResourceLayers,
    'state' | 'configErrors' | 'hiddenInScene' | 'pointHighlight' | 'pointMark' | 'labelTarget'
  >,
  options: FeaturePickOptions = {}
): FeaturePick {
  if (!getCurrentScope()) {
    throw new Error('useFeaturePick 只能在组件的 setup 或 effectScope 中调用');
  }
  const camera = map.useCamera();
  const scope = options.scope ?? (() => null);
  const overModels = options.overModels ?? (() => false);
  // 页面的回调抛错不能打断识别（.claude/rules/map.md"接收外部回调的模块"）
  const notifyStart = () => {
    try {
      options.onIdentifyStart?.();
    } catch (error) {
      console.error('[feature-pick] onIdentifyStart 抛出了异常', error);
    }
  };
  const state = shallowRef<FeaturePickState>(IDLE);
  const flashing = shallowRef(false);
  // 识别、加载更多各是一条可替换的通道（ADR 0039）
  const identifications = new LatestController();
  const pages = new LatestController();
  // 识别失败时重试要做的事：查后端失败时从失败的资源继续，规划出错时重新规划
  let remaining:
    | { readonly kind: 'tasks'; readonly tasks: readonly BoxTask[]; readonly how: Identification }
    | { readonly kind: 'plan'; readonly plan: IdentifyPlan }
    | null = null;
  // 每轮识别的列表编号
  let listIds = 0;
  // 拖动框选的手势（ADR 0049 第 1 节）
  const gesture = shallowRef<BoxGesture>(NO_BOX_GESTURE);
  // 按住 Ctrl（Mac 上 ⌘）临时拖动地图，提示里写同一个键（ADR 0056）
  const panKey = currentPanKey();
  const hintLines = pickHintLines(panKey);
  const sceneHintLines = scenePickHintLines(panKey);
  // 鼠标旁的提示是否打开：进入点/框选时打开，单击或框选识别过一次后关闭，直到下次进入
  const hintOpen = shallowRef(false);
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

  // 选中要素的高亮数据：完整几何加点选时的属性（点按属性取形状，ADR 0159），只随详情和选中的候选换新对象，
  // 拖透明度、预览颜色时 selection 的数据源不重发
  const selectedFeature = computed((): Feature | null => {
    const status = detail.value;
    const candidate = selected.value;
    if (status?.kind !== 'ready' || !candidate) {
      return null;
    }
    return { type: 'Feature', properties: { ...candidate.properties }, geometry: status.detail.geometry };
  });

  // 加强标注（ADR 0160）：不等详情，用瓦片里的这个要素；资源不再画在地图上、关了标注时没有
  const emphasis = computed((): { readonly target: LabelTarget; readonly guid: string } | null => {
    const candidate = selected.value;
    if (!candidate || !isShown(resources.state.value, candidate.target, candidate.properties)) {
      return null;
    }
    const target = resources.labelTarget(candidate.target.resource.code);
    return target && { target, guid: candidate.guid };
  });

  // 会话只存选中要素的身份（ADR 0047 第 4 节）：详情里的那一个，或框选列表里已取到的全部（ADR 0049 第 3 节）
  const selectedFeatures = computed((): SelectedFeature[] => {
    const current = state.value;
    if (current.kind === 'detail') {
      return [identityOf(current.candidate)];
    }
    return current.kind === 'candidates' && current.list.mode === 'box' ? current.list.candidates.map(identityOf) : [];
  });
  // 在下一轮调度写入，作用域销毁时（地图上下文可能已经释放）不再写
  watch(selectedFeatures, features => map.select(features));

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

  // locate 是详情到了以后要执行的定位；为 null 时不移动相机
  const showDetail = (candidate: PickCandidate, back: PickReturn | null, locate: CameraOperation | null) =>
    setState({ kind: 'detail', candidate, back }, locate);

  // operation：这次识别在开始等待之前开始的相机操作，没有等待过时为 null；locate：结果来自后端，只有一个时定位。
  // 要不要移动相机和操作是否仍有效分开：等待过的沿用等待之前的那一次，等待期间用户发起的定位（默认视角、坐标定位等）
  // 会作废它，晚到的结果不再移动相机，也不作废用户的定位；没有等待过时还在点击的当下，要移动时才开始（ADR 0038、0039）
  const found = (
    list: CandidateList,
    operation: CameraOperation | null,
    locate: boolean,
    how: Identification,
    signal: AbortSignal
  ) => {
    const cameraOperation = () => operation ?? map.beginCameraOperation();
    const { candidates, pages: serverPages } = list;
    const [only] = candidates;
    if (only && candidates.length === 1 && !hasMorePages(serverPages)) {
      // 后端识别出的要素可能很小或不在眼前，定位并闪烁；直接点中、框中的渲染要素就在眼前，不移动相机，只在被挡住时露出来
      if (locate) {
        showDetail(only, null, cameraOperation());
        return;
      }
      showDetail(only, null, null);
      if (how.anchor) {
        reveal(cameraOperation(), how.anchor, signal);
      }
      return;
    }
    setState({ kind: 'candidates', list, more: MORE_IDLE });
    if (how.anchor) {
      reveal(cameraOperation(), how.anchor, signal);
    }
  };

  // 从上到下逐个资源识别，第一个有结果的胜出（ADR 0047 第 2 节、ADR 0049 第 2 节）
  const run = async (tasks: readonly BoxTask[], how: Identification, signal: AbortSignal) => {
    const { mode } = how;
    // 框选的范围大，过滤着时按后端的总数拦（ADR 0050、0173）；单击的范围小，不拦
    const limit = mode === 'box' ? BOX_ESTIMATE_LIMIT : Number.POSITIVE_INFINITY;
    // 查后端的识别可能以定位、露出结束：在开始等待之前就开始这次相机操作，等待期间用户发起的定位（默认视角、坐标定位等）
    // 会作废它，晚到的结果不再覆盖（ADR 0038、0039）；后端为空、转用下面资源的渲染要素时也用它
    let operation: CameraOperation | null = null;
    for (const [index, task] of tasks.entries()) {
      if (task.kind === 'too-many') {
        setState({ kind: 'too-many', target: task.target, estimate: task.estimate });
        return;
      }
      if (task.kind === 'too-complex') {
        setState({ kind: 'too-complex', target: task.target, mode });
        return;
      }
      if (task.kind === 'rendered') {
        const list = { id: ++listIds, mode, target: task.target, candidates: task.candidates, pages: null };
        found(list, operation, false, how, signal);
        return;
      }
      operation ??= map.beginCameraOperation();
      let scanned: ScannedPages;
      try {
        // oxlint-disable-next-line no-await-in-loop -- 上面的资源有结果时下面的不再查询
        scanned = await scanPages(task.target, task.geometry, 1, signal, limit);
      } catch (error) {
        if (!signal.aborted) {
          remaining = { kind: 'tasks', tasks: tasks.slice(index), how };
          setState({ kind: 'failed', target: task.target, error });
        }
        return;
      }
      if (signal.aborted) {
        return;
      }
      if (scanned.tooMany) {
        setState({ kind: 'too-many', target: task.target, estimate: scanned.total });
        return;
      }
      // 过滤着时只有符合条件的（ADR 0173）；连查几页都没有符合的，同这个资源没有结果
      const { candidates, loaded, total } = scanned;
      if (candidates.length > 0) {
        const serverPages = { geometry: task.geometry, loaded, total, filtered: isFiltering(task.target.filter) };
        const list = { id: ++listIds, mode, target: task.target, candidates, pages: serverPages };
        found(list, operation, true, how, signal);
        return;
      }
    }
    setState(EMPTY);
  };

  const close = () => {
    identifications.abort();
    pages.abort();
    remaining = null;
    gesture.value = NO_BOX_GESTURE;
    setState(IDLE);
  };

  // 新的单击或框选先作废上一次，再准备：拾取点中的位置、屏幕查询、求交都在点击时做完，之后地图移动不影响结果。
  // 点在区划外、框整个在区划外时准备结果为 null：落在遮罩上等于点在空白处，关闭现有的结果（ADR 0051 第 3 节）；
  // 准备出错（拾取、求交）也是这次识别的失败，显示失败，重试时用同样的输入重新准备（ADR 0051 第 4 节）
  const execute = (plan: IdentifyPlan) => {
    const signal = identifications.next();
    pages.abort();
    remaining = null;
    let prepared: Prepared;
    try {
      prepared = plan();
    } catch (error) {
      remaining = { kind: 'plan', plan };
      notifyStart();
      setState({ kind: 'failed', target: null, error });
      return;
    }
    if (!prepared) {
      close();
      return;
    }
    notifyStart();
    setState(IDENTIFYING);
    void run(prepared.tasks, prepared.how, signal);
  };

  // 参与识别的资源、级别和区划范围按点击时的定
  const start = (plan: (targets: readonly PickResource[], zoom: number, area: RegionScope | null) => Prepared) => {
    const { zoom } = camera.value;
    const targets = pickResources(resources.state.value, resources.configErrors.value, zoom);
    const area = scope();
    execute(() => plan(targets, zoom, area));
  };

  // 点中的位置也在准备时取下，之后地图移动不影响
  const identify = (point: ScreenPoint, view: ToolView) => {
    hintOpen.value = false;
    start((targets, zoom, area) => {
      const hit = view.pick(point);
      const how: Identification = { mode: 'pick', anchor: hit.kind === 'hit' ? hit.lngLat : null };
      const tasks = planIdentify(
        targets,
        point,
        zoom,
        view,
        area,
        target => resources.pointMark(target.resource.code, zoom),
        target => overModels(target.resource.code),
        target => resources.labelTarget(target.resource.code) !== null
      );
      return tasks && { tasks, how };
    });
  };

  const identifyBox = (box: ScreenBox, view: ToolView) => {
    hintOpen.value = false;
    start((targets, zoom, area) => {
      const tasks = planBox(targets, box, zoom, view, area);
      return tasks && { tasks, how: { mode: 'box', anchor: null } };
    });
  };

  const cancelGesture = () => {
    gesture.value = cancelBox(gesture.value);
  };

  const choose = (candidate: PickCandidate) => {
    const current = state.value;
    if (current.kind !== 'candidates' || !current.list.candidates.includes(candidate)) {
      throw new Error('只能选择当前候选列表里的要素');
    }
    pages.abort();
    // 从列表选择是一次新的意图，开始新的相机操作
    showDetail(candidate, { list: current.list, camera: camera.value }, map.beginCameraOperation());
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
    let scanned: ScannedPages;
    try {
      scanned = await scanPages(list.target, serverPages.geometry, serverPages.loaded + 1, signal);
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
    const added = scanned.candidates.filter(({ key }) => !known.has(key));
    const candidates = [...list.candidates, ...added];
    const next = { ...serverPages, loaded: scanned.loaded, total: scanned.total };
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
    if (current.kind === 'failed' && remaining?.kind === 'plan') {
      execute(remaining.plan);
      return;
    }
    if (current.kind === 'failed' && remaining?.kind === 'tasks') {
      const signal = identifications.next();
      setState(IDENTIFYING);
      void run(remaining.tasks, remaining.how, signal);
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

  // 选中的资源取消勾选、换了年份、不在目录里时清除；叠放顺序变了时保留详情，但不能再返回旧的列表（ADR 0047 第 6 节）。
  // 过滤条件变了（ADR 0173）：列表、进行中的识别作废，详情里的要素还在时保留、不能再返回旧的列表
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
        case 'too-many':
        case 'too-complex':
          if (!isShown(next, current.target)) {
            close();
          }
          break;
        case 'detail':
          // 详情里的要素被过滤掉时关闭，条件变了但它还在时保留（ADR 0173）
          if (!isShown(next, current.candidate.target, current.candidate.properties)) {
            close();
          } else if (
            current.back &&
            (next.order.join() !== previous.order.join() || !isShown(next, current.candidate.target))
          ) {
            state.value = { ...current, back: null };
          }
          break;
        case 'idle':
        case 'empty':
          break;
      }
    }
  );

  // 换区划、回到全省、边界加载完成时关闭结果，和资源变化时一样（ADR 0051 第 3 节）
  watch(scope, close);

  // 拖动框选时地图移动（滚轮缩放等）、窗口失焦都取消这次手势（ADR 0049 第 1 节）
  watch(camera, cancelGesture);
  useEventListener('blur', cancelGesture);
  // 视图不再就绪（页面被缓存时暂停、失败）时同样取消：之后收不到松开，回来后不能留着矩形；工具不变（ADR 0063）
  watch(
    () => map.view.value === null,
    gone => {
      if (gone) {
        cancelGesture();
      }
    }
  );

  // 三维里照常识别（ADR 0157）：登记的数据集查后端（identifyStep），点到模型上时画在模型下面的查模型脚下、
  // 画在上面的按鼠标下的地面（planIdentify，ADR 0161）
  const handleInput = (event: MapInputEvent, view: ToolView): boolean => {
    // 引擎不能在三维里识别（能力 identify 为 false）时三维期间单击、框选什么也不做，Esc 照样清除二维的结果（ADR 0080 第 5 节）；
    // app 注入的引擎是 true（ADR 0157），这个分支留给别的引擎
    if (view.kind === '3d' && !map.sceneCapabilities.identify && event.type !== 'key' && event.type !== 'leave') {
      return false;
    }
    switch (event.type) {
      case 'down':
        if (event.button === 0) {
          gesture.value = pressBox(event.point);
        }
        return event.button === 0;
      case 'move':
        gesture.value = moveBox(gesture.value, event.point);
        return gesture.value.kind !== 'idle';
      case 'up': {
        if (event.button !== 0) {
          return false;
        }
        const { gesture: next, box } = releaseBox(gesture.value, event.point);
        gesture.value = next;
        if (box) {
          identifyBox(box, view);
        }
        return box !== null;
      }
      case 'click':
        // 双击的第二下、框选或取消的手势派生的单击都不识别
        if (event.button !== 0 || event.clickCount !== 1 || !acceptsClick(gesture.value)) {
          return false;
        }
        identify(event.point, view);
        return true;
      case 'leave':
        cancelGesture();
        return false;
      case 'key':
        if (event.key !== 'Escape') {
          return false;
        }
        // 有手势时只取消这次框选，不改变已有的结果
        if (gesture.value.kind === 'idle') {
          close();
        } else {
          cancelGesture();
        }
        return true;
      case 'dblclick':
        break;
    }
    return false;
  };

  // 常驻模式、十字光标（ADR 0056 第 3 节）；拖动用来框选，关掉拖动平移和 Shift 框选放大（ADR 0049 第 1 节），
  // 按住修饰键时临时拖动地图；进入时打开提示，离开时关闭提示、清除结果
  const pickTool: MapTool = {
    persistent: true,
    cursor: 'crosshair',
    gestures: { dragPan: false, boxZoom: false },
    panModifier: panKey.modifier,
    activate: () => {
      hintOpen.value = true;
    },
    deactivate: () => {
      hintOpen.value = false;
      close();
    },
    handleInput
  };

  // 框选列表的批量高亮引用资源分组的数据源：资源不再显示时不出图层，和资源分组在同一轮变化（ADR 0049 第 3 节）
  const batchHighlight = (): BatchHighlight | null => {
    const current = state.value;
    if (current.kind !== 'candidates' || current.list.mode !== 'box') {
      return null;
    }
    const { target, candidates } = current.list;
    const { code } = target.resource;
    // 三维里资源分组为空时（ADR 0147）批量高亮引用的数据源不在样式里，结果保留，切回二维再画
    if (
      resources.hiddenInScene.value ||
      !isShown(resources.state.value, target) ||
      resources.configErrors.value.has(code)
    ) {
      return null;
    }
    return {
      sourceId: target.sourceId,
      sourceLayer: sourceLayerOf(code, target.year),
      minzoom: target.resource.minzoom,
      guids: candidates.map(({ guid }) => guid),
      point: target.resource.geometry === 'circle' ? resources.pointHighlight(code) : null
    };
  };

  onScopeDispose(() => {
    identifications[Symbol.dispose]();
    pages[Symbol.dispose]();
    stopFlash();
  });

  return {
    state: shallowReadonly(state),
    boxDraft: computed(() => drawingBox(gesture.value)),
    hint: computed(() => {
      const point = map.pointer.value;
      const view = map.view.value;
      if (!hintOpen.value || point === null || view === null || gesture.value.kind === 'drawing') {
        return null;
      }
      const unsupported = view.kind === '3d' && !map.sceneCapabilities.identify;
      return { point, lines: unsupported ? sceneHintLines : hintLines };
    }),
    detail,
    tools: { [FEATURE_PICK_TOOL]: pickTool },
    choose,
    back,
    loadMore,
    retry,
    locate,
    close,
    deriveGroup: () => {
      const feature = selectedFeature.value;
      const candidate = selected.value;
      // 只有点资源的高亮读资源的状态和符号：面、线的高亮不随透明度、取色预览重新推导
      const point =
        feature && candidate?.target.resource.geometry === 'circle'
          ? resources.pointHighlight(candidate.target.resource.code)
          : null;
      return selectionGroup(feature && { feature, point }, flashing.value, batchHighlight());
    },
    labelEmphasis: computed(() => {
      const current = emphasis.value;
      return current && { code: current.target.code, guid: current.guid };
    }),
    deriveLabelsGroup: () => selectionLabelsGroup(emphasis.value?.target ?? null, emphasis.value?.guid ?? null)
  };
}
