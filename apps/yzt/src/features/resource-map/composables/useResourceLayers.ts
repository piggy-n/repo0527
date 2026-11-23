import type { StyleGroup } from '@mx/map-core';
import type { MapContext } from '@mx/map-vue';
import { safeReporter } from '@mx/utils';
import {
  computed,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  toValue,
  watch
} from 'vue';
import { appConfig } from '@/shared/config/app-config';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import type { Resource, ResourceCatalog } from '../catalog';
import { labelFieldsOf } from '../label-fields';
import type { LabelEmphasis, LabelTarget } from '../labels';
import {
  batchYearOptions,
  EMPTY_RESOURCE_LAYERS,
  isDrawn,
  isLabelShown,
  labelTargetOf,
  lowestLayerOf,
  mergeDisplayState,
  withAdded,
  withMoved,
  withRemoved,
  type ResourceDisplay,
  type ResourceLayersState,
  resourceLabelsGroup,
  resourcesGroup,
  resourceTileBase,
  validateCatalog,
  withYearForAll
} from '../resource-layers';
import {
  fromStoredResourceLayers,
  type StoredResourceLayers,
  type StoredResourceLayerSet,
  storedResourceLayersSchema,
  toStoredResourceLayers
} from '../resource-layers-preference';
import type { PointHighlightOf } from '../selection-style';
import { type PointMarkOf, pointMarkOf, resourceHighlightStyle } from '../style-registry';
import type { ResourceSymbols } from './useResourceSymbols';

/**
 * 已添加的资源分几套（ADR 0169）：不按维度分开时二三维共用 shared；分开时二维、三维各一套，各有自己的加入、顺序、显隐、
 * 透明度、年份、标注开关和批量年份，符号和标注的样式仍然共用
 */
export type ResourceLayerSetId = 'shared' | '2d' | '3d';

/** 拥有者的一套已添加的资源（ADR 0169）：不管当前是哪一维都读写这一套，图层的平铺列表按套使用 */
export type ResourceLayerSet = Pick<ResourceLayers, 'state' | 'add' | 'remove' | 'moveLayer'>;

/** 资源图层的拥有者（ADR 0041 第 3 节）：页面把 deriveGroup 绑定到 resources 分组，面板通过 props 拿到它 */
export interface ResourceLayers {
  /**
   * 按 code 的显示状态和面板顺序，连同它所基于的目录；目录还没加载时为空。按维度分开时是当前维度的那一套（ADR 0169），
   * 下面的读取、操作和推导也都对着这一套
   */
  readonly state: Readonly<Ref<ResourceLayersState>>;
  /** 二维、三维各自一套已添加的资源（ADR 0169，选项 perDimension）；为 false 时二三维共用一套 */
  readonly perDimension: boolean;
  /** 当前维度用的那一套：不分开时总是 shared，分开时跟着维度是 2d 或 3d */
  readonly currentSet: ComputedRef<ResourceLayerSetId>;
  /** 某一套，不管当前维度：不分开时只有 shared，分开时只有 2d、3d，没有这一套时抛错 */
  readonly forSet: (set: ResourceLayerSetId) => ResourceLayerSet;
  /** 目录变化时校验不通过的资源和原因：它们不进入推导，随目录变化，不随视图清除 */
  readonly configErrors: ComputedRef<ReadonlyMap<string, readonly string[]>>;
  /** 最小显示级别，面板结合当前的缩放级别提示"放大至第 N 级显示"；没有限制时为 undefined */
  readonly minzoomOf: (code: string) => number | undefined;
  /** 以下操作遇到目录里没有的资源都抛错 */
  /**
   * 加入当前地图（ADR 0157、0161）：没加入的按给出的先后整批插到已加入的资源里的第 at 位（默认最前）并显示，已加入的不动；
   * 只替换一次状态。调用方按目录的先后给出
   */
  readonly add: (codes: readonly string[], at?: number) => void;
  /** 移出当前地图，透明度、年份等设置保留，再加入时沿用；没加入的忽略 */
  readonly remove: (codes: readonly string[]) => void;
  /** 当前图层里的显示、隐藏：只对已加入的资源起作用 */
  readonly setVisible: (code: string, visible: boolean) => void;
  /** 在当前地图里挪到第 to 位（已加入的资源里从上往下数）；没加入、位置越界时抛错 */
  readonly moveLayer: (code: string, to: number) => void;
  /** 不在 0～1 之间时抛错 */
  readonly setOpacity: (code: string, opacity: number) => void;
  /** 不是这个资源的年份时抛错 */
  readonly setYear: (code: string, year: number) => void;
  /** 显示、隐藏标注（ADR 0160）；没有登记标注字段的资源抛错 */
  readonly setLabeled: (code: string, labeled: boolean) => void;
  /**
   * 资源的标注图层要用的（ADR 0160）：画出标注（看得见）、校验通过、有标注字段，三维里分组不为空时才有，
   * 加强标注按它画；其他时候为 null
   */
  readonly labelTarget: (code: string) => LabelTarget | null;
  /** 批量设置可选的年份：多年份资源的年份并集加上固定的 2020、2021，新的在前（ADR 0094）；目录还没加载时没有 */
  readonly batchYears: ComputedRef<readonly number[]>;
  /**
   * 最后一次批量设置的年份，面板的选择框回显它（ADR 0116）：单独改某个资源的年份不影响它，随偏好存下，按套记（ADR 0169）；
   * 没有批量设置过、或已不在可选的年份里时为 null
   */
  readonly batchYear: ComputedRef<number | null>;
  /**
   * 批量设置年份（ADR 0052 第 2 节）：有这一年的资源不论是否勾选都切过去，其他不变，只替换一次状态，并记下这一年；
   * 没有任何资源有这一年时图层不变（ADR 0094），年份不是整数时抛错
   */
  readonly setYearForAll: (year: number) => void;
  /**
   * 三维且三维引擎不画样式图层（能力 `styleLayers` 为 false；app 注入的是 true，现在走不到，ADR 0157）：分组为空，图例只有说明；
   * 引用资源数据源的推导（框选的批量高亮）这时也不能有图层
   */
  readonly hiddenInScene: ComputedRef<boolean>;
  /**
   * 点资源的选中高亮按它的形状和大小画（ADR 0159）：读它的符号覆盖，图片在资源分组里；
   * 不是点资源、没画在地图上（包括三维里分组为空、配置不合法）时为 null，高亮退回红色圆点
   */
  readonly pointHighlight: (code: string) => PointHighlightOf | null;
  /**
   * 点资源的要素在这一级画出的样子（形状、icon-size、描边，ADR 0159 第 3 节），点选按到它的距离过滤和排序；
   * 条件同 pointHighlight
   */
  readonly pointMark: (code: string, zoom: number) => PointMarkOf | null;
  readonly deriveGroup: () => StyleGroup;
  /**
   * 三维模型层的插槽（ADR 0161）：给出的资源（从上到下）里画在地图上的、最下面那个的最下面一层；都没画、三维里不显示资源图层时
   * 为 undefined。页面交给 bindSceneSlot，也用它判断有没有二维图层画在模型上面
   */
  readonly sceneSlot: (codes: readonly string[]) => string | undefined;
  /**
   * resource-labels 分组（ADR 0160）：页面把它和 resources 一起绑定；emphasis 是查询详情里正在加强标注的要素，
   * 它原来的标注滤掉，由页面从点选的拥有者传进来
   */
  readonly deriveLabelsGroup: (emphasis: LabelEmphasis | null) => StyleGroup;
}

export interface ResourceLayersOptions {
  /** 资源目录，通常是 useResourceCatalogQuery 的 data；重新加载失败时查询保留上一次的目录 */
  readonly catalog: MaybeRefOrGetter<ResourceCatalog | undefined>;
  /** 瓦片的基础地址；默认由 appConfig.apiBaseUrl 和页面的地址得出 */
  readonly tileBase?: string;
  /** 配置错误的原因；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
  /** 默认用登记表的样式逐个资源校验；测试时注入 */
  readonly validate?: (catalog: ResourceCatalog | null, tileBase: string) => ReadonlyMap<string, readonly string[]>;
  /** 页面提供时记住上次的勾选、透明度、顺序和年份（ADR 0042）；不提供时不读不写 */
  readonly preferences?: PreferenceScope | null;
  /** 二维、三维各自一套已添加的资源（ADR 0169）：现状底图按 appConfig.layersPerDimension 给；默认 false，二三维共用一套 */
  readonly perDimension?: boolean;
  /** 用户调整的符号（ADR 0044 第 4 节），推导读它的覆盖和预览；不提供时都用默认符号 */
  readonly symbols?: Pick<ResourceSymbols, 'overrideOf'> | null;
}

function reportToConsole(error: unknown): void {
  console.error('[resource-map]', error);
}

const NO_RESOURCES: StyleGroup = Object.freeze({ sources: Object.freeze({}), layers: Object.freeze([]) });

/** 一套已添加的资源（ADR 0169） */
interface SetSlot {
  /** 状态带着它所基于的目录：推导只读这一份，侦听器什么时候执行都不会读到中间态 */
  readonly state: ShallowRef<ResourceLayersState>;
  /** 最后一次批量设置的年份：只给面板回显，不参与推导（ADR 0116） */
  readonly batchYear: ShallowRef<number | null>;
}

function newSlot(): SetSlot {
  return { state: shallowRef(EMPTY_RESOURCE_LAYERS), batchYear: shallowRef(null) };
}

function restoreSlot(slot: SetSlot, stored: StoredResourceLayerSet): void {
  slot.state.value = fromStoredResourceLayers(stored);
  slot.batchYear.value = stored.batchYear ?? null;
}

// 一套的加入、移出、移动，不管当前是哪一维
function setOf(slot: SetSlot): ResourceLayerSet {
  return {
    state: shallowReadonly(slot.state),
    add: (codes, at) => {
      slot.state.value = withAdded(slot.state.value, codes, at);
    },
    remove: codes => {
      slot.state.value = withRemoved(slot.state.value, codes);
    },
    moveLayer: (code, to) => {
      slot.state.value = withMoved(slot.state.value, code, to);
    }
  };
}

/** 创建资源图层的拥有者，在 provideMap 所在组件的 setup 中调用 */
export function useResourceLayers(
  map: Pick<MapContext, 'dimension' | 'sceneCapabilities'>,
  options: ResourceLayersOptions
): ResourceLayers {
  const tileBase = options.tileBase ?? resourceTileBase(appConfig.apiBaseUrl, window.location.origin);
  const onError = safeReporter(options.onError ?? reportToConsole, 'resource-map');
  const validate = options.validate ?? validateCatalog;
  const perDimension = options.perDimension ?? false;
  // 偏好顶层的那一套：不分开时二三维共用，分开时是二维的；分开时三维另有一套，存在偏好的 scene 里（ADR 0169）
  const primary = newSlot();
  const scene = perDimension ? newSlot() : primary;
  const slots: ReadonlyMap<ResourceLayerSetId, SetSlot> = new Map<ResourceLayerSetId, SetSlot>(
    perDimension
      ? [
          ['2d', primary],
          ['3d', scene]
        ]
      : [['shared', primary]]
  );
  const currentSet = computed((): ResourceLayerSetId => {
    if (!perDimension) {
      return 'shared';
    }
    return map.dimension.value === '3d' ? '3d' : '2d';
  });
  // 不分开时 scene 就是 primary，两维都是这一套
  const currentSlot = computed(() => (map.dimension.value === '3d' ? scene : primary));
  const state = computed(() => currentSlot.value.state.value);

  // 有偏好的范围时，目录要等恢复结束才合并：不先按默认值显示、再换成上次的选择（ADR 0042 第 5 节）
  const { preferences } = options;
  const restored = shallowRef(!preferences);
  if (preferences) {
    // 不分开时读到的三维那一套原样写回：再分开时还在（ADR 0169）
    let keptScene: StoredResourceLayerSet | undefined;
    usePreference(preferences, {
      name: 'resource-layers',
      version: 1,
      schema: storedResourceLayersSchema,
      snapshot: (): StoredResourceLayers => {
        const stored = toStoredResourceLayers(primary.state.value, primary.batchYear.value);
        const sceneStored = perDimension
          ? toStoredResourceLayers(scene.state.value, scene.batchYear.value)
          : keptScene;
        return sceneStored ? { ...stored, scene: sceneStored } : stored;
      },
      restore: stored => {
        if (stored) {
          keptScene = stored.scene;
          restoreSlot(primary, stored);
          if (perDimension) {
            // 第一次分开时三维复制现在共用的那一套（用户 2026-11-22），之后各改各的
            restoreSlot(scene, stored.scene ?? stored);
          }
        }
        restored.value = true;
      }
    });
  }

  watch(
    () => [toValue(options.catalog), restored.value] as const,
    ([catalog, ready]) => {
      if (catalog && ready) {
        for (const slot of slots.values()) {
          slot.state.value = mergeDisplayState(slot.state.value, catalog);
        }
      }
    },
    { immediate: true }
  );

  // 只在目录变化时校验（ADR 0026 第 5 条）：目录没变时这个 computed 不通知，勾选、改透明度、换维度不会重新校验；
  // 几套在同一轮合并目录，读哪一套都一样
  const catalog = computed(() => primary.state.value.catalog);
  const configErrors = computed(() => validate(catalog.value, tileBase));
  watch(
    configErrors,
    errors => {
      for (const [code, reasons] of errors) {
        onError(new Error(`资源 ${code} 的图层配置不合法，不显示：${reasons.join('；')}`));
      }
    },
    { immediate: true }
  );

  const sets = new Map([...slots].map(([id, slot]) => [id, setOf(slot)]));
  const forSet = (set: ResourceLayerSetId): ResourceLayerSet => {
    const found = sets.get(set);
    if (!found) {
      throw new Error(`资源图层没有 ${set} 这一套：${perDimension ? '按维度分开时只有 2d、3d' : '不分开时只有 shared'}`);
    }
    return found;
  };

  // 改当前那一套里一个资源的显示状态；值没变时 change 返回原来的对象，状态不替换
  const update = (code: string, change: (display: ResourceDisplay, resource: Resource) => ResourceDisplay) => {
    const slot = currentSlot.value;
    const previous = slot.state.value;
    const display = previous.displays.get(code);
    const resource = previous.catalog?.resources.get(code);
    if (!display || !resource) {
      throw new Error(`目录里没有资源 ${code}`);
    }
    const next = change(display, resource);
    if (next !== display) {
      slot.state.value = { ...previous, displays: new Map([...previous.displays, [code, next]]) };
    }
  };

  const add = (codes: readonly string[], at?: number) => forSet(currentSet.value).add(codes, at);

  const remove = (codes: readonly string[]) => forSet(currentSet.value).remove(codes);

  const setVisible = (code: string, visible: boolean) =>
    update(code, display => (display.checked === visible ? display : { ...display, checked: visible }));

  const moveLayer = (code: string, to: number) => forSet(currentSet.value).moveLayer(code, to);

  const setOpacity = (code: string, opacity: number) => {
    if (!(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) {
      throw new RangeError(`资源的透明度应在 0～1 之间，收到 ${opacity}`);
    }
    update(code, display => (display.opacity === opacity ? display : { ...display, opacity }));
  };

  const setYear = (code: string, year: number) =>
    update(code, (display, resource) => {
      if (!resource.years.includes(year)) {
        throw new RangeError(`资源 ${code} 没有 ${year} 年的数据，可选：${resource.years.join('、')}`);
      }
      return display.year === year ? display : { ...display, year };
    });

  const setLabeled = (code: string, labeled: boolean) => {
    if (labelFieldsOf(code).length === 0) {
      throw new Error(`资源 ${code} 没有可标注的字段`);
    }
    update(code, display => (display.labeled === labeled ? display : { ...display, labeled }));
  };

  // 只改当前那一套，批量年份也按套记下（ADR 0169）
  const setYearForAll = (year: number) => {
    const slot = currentSlot.value;
    slot.state.value = withYearForAll(slot.state.value, year);
    slot.batchYear.value = year;
  };

  const batchYears = computed(() => batchYearOptions(catalog.value));

  const hiddenInScene = computed(() => map.dimension.value === '3d' && !map.sceneCapabilities.styleLayers);

  // 画在地图上的点资源：选中高亮引用它在资源分组里的图片，点选按它的符号算距离
  const drawnPoint = (code: string): Resource | null => {
    const current = state.value;
    const resource = current.catalog?.resources.get(code);
    const drawn =
      resource?.geometry === 'circle' &&
      !hiddenInScene.value &&
      isDrawn(current.displays.get(code)) &&
      !configErrors.value.has(code);
    return drawn ? resource : null;
  };

  const batchYear = computed(() => {
    const last = currentSlot.value.batchYear.value;
    return last !== null && batchYears.value.includes(last) ? last : null;
  });

  return {
    state,
    perDimension,
    currentSet,
    forSet,
    configErrors,
    minzoomOf: code => catalog.value?.resources.get(code)?.minzoom,
    add,
    remove,
    setVisible,
    moveLayer,
    setOpacity,
    setYear,
    setLabeled,
    labelTarget: code => {
      const current = state.value;
      const resource = current.catalog?.resources.get(code);
      const display = current.displays.get(code);
      if (!resource || !isLabelShown(display) || hiddenInScene.value || configErrors.value.has(code)) {
        return null;
      }
      return labelTargetOf(resource, display, options.symbols?.overrideOf(code));
    },
    batchYears,
    batchYear,
    setYearForAll,
    hiddenInScene,
    pointHighlight: code => {
      const resource = drawnPoint(code);
      if (!resource) {
        return null;
      }
      const override = options.symbols?.overrideOf(code);
      return color => resourceHighlightStyle(resource, color, override);
    },
    pointMark: (code, zoom) => {
      const resource = drawnPoint(code);
      return resource && pointMarkOf(resource, zoom, options.symbols?.overrideOf(code));
    },
    deriveGroup: () =>
      hiddenInScene.value
        ? NO_RESOURCES
        : resourcesGroup({
            state: state.value,
            invalid: configErrors.value,
            tileBase,
            overrideOf: options.symbols?.overrideOf
          }),
    sceneSlot: codes =>
      hiddenInScene.value
        ? undefined
        : lowestLayerOf(state.value, configErrors.value, codes, options.symbols?.overrideOf),
    deriveLabelsGroup: emphasis =>
      hiddenInScene.value
        ? NO_RESOURCES
        : resourceLabelsGroup({
            state: state.value,
            invalid: configErrors.value,
            overrideOf: options.symbols?.overrideOf,
            emphasis
          })
  };
}
