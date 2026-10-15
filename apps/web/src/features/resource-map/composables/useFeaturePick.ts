import { useEventListener } from '@vueuse/core';
import type { Geometry } from 'geojson';
import type {
  CameraState,
  FitBoundsOptions,
  MapInputEvent,
  MapTool,
  ScreenBox,
  ScreenPoint,
  SelectedFeature,
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
import {
  acceptsClick,
  type BoxGesture,
  cancelBox,
  drawingBox,
  moveBox,
  NO_BOX_GESTURE,
  pressBox,
  releaseBox
} from '@/shared/map/box-select/box-gesture';
import type { RegionScope } from '@/shared/map/region/region-scope';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import { type FeatureDetail, type FeaturePage, queryFeaturesAt } from '../api';
import {
  type BoxTask,
  featureBounds,
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
import { type FeatureKey, useFeatureDetailQuery } from '../queries';
import type { ResourceLayersState } from '../resource-layers';
import { type BatchHighlight, selectionGroup } from '../selection-style';
import { resourceStyle, sourceLayerOf } from '../style-registry';
import type { ResourceLayers } from './useResourceLayers';

/** 后端识别的分页，用来加载更多 */
export interface ServerPages {
  /** 识别时的地理范围 */
  readonly geometry: QueryArea;
  /** 已加载的页数 */
  readonly loaded: number;
  readonly total: number;
}

/** 结果来自单击还是框选（ADR 0049 第 3 节） */
export type PickMode = 'pick' | 'box';

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
  /** 识别范围和区划求交后整理不成能发给后端的几何，没有请求后端（ADR 0051 第 4 节） */
  | { readonly kind: 'too-complex'; readonly target: PickResource }
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

export interface FeaturePickOptions {
  /** 区划裁剪的范围（ADR 0051）：点选、框选只认范围里的要素，范围变化时关闭结果；不传时不限制 */
  readonly scope?: () => RegionScope | null;
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

function identityOf({ target, guid }: PickCandidate): SelectedFeature {
  return { sourceId: target.sourceId, featureId: guid };
}

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
  resources: Pick<ResourceLayers, 'state' | 'configErrors'>,
  options: FeaturePickOptions = {}
): FeaturePick {
  if (!getCurrentScope()) {
    throw new Error('useFeaturePick 只能在组件的 setup 或 effectScope 中调用');
  }
  const camera = map.useCamera();
  const scope = options.scope ?? (() => null);
  const state = shallowRef<FeaturePickState>(IDLE);
  const flashing = shallowRef(false);
  // 识别、加载更多各是一条可替换的通道（ADR 0039）
  const identifications = new LatestController();
  const pages = new LatestController();
  // 识别失败时重试要做的事：查后端失败时从失败的资源继续，规划出错时重新规划
  let remaining:
    | { readonly kind: 'tasks'; readonly tasks: readonly BoxTask[]; readonly mode: PickMode }
    | { readonly kind: 'plan'; readonly plan: () => BoxTask[] | null; readonly mode: PickMode }
    | null = null;
  // 每轮识别的列表编号
  let listIds = 0;
  // 拖动框选的手势（ADR 0049 第 1 节）
  const gesture = shallowRef<BoxGesture>(NO_BOX_GESTURE);
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

  // locate：查后端时在开始等待之前开始的相机操作，渲染要素的结果为 null
  const found = (list: CandidateList, locate: CameraOperation | null) => {
    const { candidates, pages: serverPages } = list;
    const [only] = candidates;
    if (only && candidates.length === 1 && !hasMorePages(serverPages)) {
      // 后端识别出的要素可能很小或不在眼前，定位并闪烁；直接点中、框中的渲染要素就在眼前，不移动相机
      showDetail(only, null, locate);
      return;
    }
    setState({ kind: 'candidates', list, more: MORE_IDLE });
  };

  // 从上到下逐个资源识别，第一个有结果的胜出（ADR 0047 第 2 节、ADR 0049 第 2 节）
  const run = async (tasks: readonly BoxTask[], mode: PickMode, signal: AbortSignal) => {
    // 查后端的识别可能以定位结束：在开始等待之前就开始这次相机操作，等待期间用户发起的定位（默认视角、坐标定位等）
    // 会作废它，晚到的结果不再覆盖（ADR 0038、0039）
    let locate: CameraOperation | null = null;
    for (const [index, task] of tasks.entries()) {
      if (task.kind === 'too-many') {
        setState({ kind: 'too-many', target: task.target, estimate: task.estimate });
        return;
      }
      if (task.kind === 'too-complex') {
        setState({ kind: 'too-complex', target: task.target });
        return;
      }
      if (task.kind === 'rendered') {
        found({ id: ++listIds, mode, target: task.target, candidates: task.candidates, pages: null }, null);
        return;
      }
      locate ??= map.beginCameraOperation();
      let page: FeaturePage;
      try {
        const first = { pageNum: 1, pageSize: PICK_PAGE_SIZE };
        // oxlint-disable-next-line no-await-in-loop -- 上面的资源有结果时下面的不再查询
        page = await queryFeaturesAt(task.target.layerCode, task.geometry, first, signal);
      } catch (error) {
        if (!signal.aborted) {
          remaining = { kind: 'tasks', tasks: tasks.slice(index), mode };
          setState({ kind: 'failed', target: task.target, error });
        }
        return;
      }
      if (signal.aborted) {
        return;
      }
      const candidates = serverCandidates(task.target, page.list);
      if (candidates.length > 0) {
        const serverPages = { geometry: task.geometry, loaded: 1, total: page.total };
        found({ id: ++listIds, mode, target: task.target, candidates, pages: serverPages }, locate);
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

  // 新的单击或框选先作废上一次，再规划：规划里的屏幕查询、求交在点击时做完，之后地图移动不影响结果。
  // 点在区划外、框整个在区划外时计划为 null：落在遮罩上等于点在空白处，关闭现有的结果（ADR 0051 第 3 节）；
  // 规划出错时显示失败，重试时用同样的输入重新规划（ADR 0051 第 4 节）
  const execute = (mode: PickMode, plan: () => BoxTask[] | null) => {
    const signal = identifications.next();
    pages.abort();
    remaining = null;
    let tasks: BoxTask[] | null;
    try {
      tasks = plan();
    } catch (error) {
      remaining = { kind: 'plan', plan, mode };
      setState({ kind: 'failed', target: null, error });
      return;
    }
    if (!tasks) {
      close();
      return;
    }
    setState(IDENTIFYING);
    void run(tasks, mode, signal);
  };

  // 参与识别的资源、级别和区划范围按点击时的定
  const start = (
    mode: PickMode,
    plan: (targets: readonly PickResource[], zoom: number, area: RegionScope | null) => BoxTask[] | null
  ) => {
    const { zoom } = camera.value;
    const targets = pickResources(resources.state.value, resources.configErrors.value, zoom);
    const area = scope();
    execute(mode, () => plan(targets, zoom, area));
  };

  const identify = (point: ScreenPoint, view: ToolView) =>
    start('pick', (targets, zoom, area) => planIdentify(targets, point, zoom, view, area));

  const identifyBox = (box: ScreenBox, view: ToolView) =>
    start('box', (targets, zoom, area) => planBox(targets, box, zoom, view, area));

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
    if (current.kind === 'failed' && remaining?.kind === 'plan') {
      execute(remaining.mode, remaining.plan);
      return;
    }
    if (current.kind === 'failed' && remaining?.kind === 'tasks') {
      const signal = identifications.next();
      setState(IDENTIFYING);
      void run(remaining.tasks, remaining.mode, signal);
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
        case 'too-many':
        case 'too-complex':
          if (!isShown(next, current.target)) {
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

  // 换区划、回到全省、边界加载完成时关闭结果，和资源变化时一样（ADR 0051 第 3 节）
  watch(scope, close);

  // 拖动框选时地图移动（滚轮缩放等）、窗口失焦都取消这次手势（ADR 0049 第 1 节）
  watch(camera, cancelGesture);
  useEventListener('blur', cancelGesture);

  const handleInput = (event: MapInputEvent, view: ToolView): boolean => {
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

  // 常驻模式、默认箭头光标；拖动用来框选，关掉拖动平移和 Shift 框选放大（ADR 0049 第 1 节）；离开点选工具时清除
  const pickTool: MapTool = {
    persistent: true,
    cursor: 'default',
    gestures: { dragPan: false, boxZoom: false },
    deactivate: close,
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
    if (!isShown(resources.state.value, target) || resources.configErrors.value.has(code)) {
      return null;
    }
    return {
      sourceId: target.sourceId,
      sourceLayer: sourceLayerOf(code, target.year),
      minzoom: resourceStyle(code).minzoom,
      guids: candidates.map(({ guid }) => guid)
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
      return selectionGroup(status?.kind === 'ready' ? status.detail.geometry : null, flashing.value, batchHighlight());
    }
  };
}
