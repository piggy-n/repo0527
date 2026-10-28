import type { StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import { safeReporter } from '@yzt/utils';
import {
  computed,
  type ComputedRef,
  type MaybeRefOrGetter,
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
import {
  EMPTY_RESOURCE_LAYERS,
  mergeDisplayState,
  resourceCodeOfSource,
  type ResourceDisplay,
  type ResourceLayersState,
  resourcesGroup,
  resourceTileBase,
  validateCatalog,
  withYearForAll
} from '../resource-layers';
import {
  fromStoredResourceLayers,
  storedResourceLayersSchema,
  toStoredResourceLayers
} from '../resource-layers-preference';
import { resourceStyle } from '../style-registry';
import type { ResourceSymbols } from './useResourceSymbols';

/** 资源图层的拥有者（ADR 0041 第 3 节）：页面把 deriveGroup 绑定到 resources 分组，面板通过 props 拿到它 */
export interface ResourceLayers {
  /** 按 code 的显示状态和面板顺序，连同它所基于的目录；目录还没加载时为空 */
  readonly state: Readonly<ShallowRef<ResourceLayersState>>;
  /** 目录变化时校验不通过的资源和原因：它们不进入推导，随目录变化，不随视图清除 */
  readonly configErrors: ComputedRef<ReadonlyMap<string, readonly string[]>>;
  /** 当前视图里至少有一张瓦片加载失败的资源，不表示整个资源不可用；随数据源移除、视图重建或替换清除 */
  readonly tileErrors: ComputedRef<ReadonlySet<string>>;
  /** 最小显示级别，面板结合当前的缩放级别提示"放大至第 N 级显示"；没有限制时为 undefined */
  readonly minzoomOf: (code: string) => number | undefined;
  /** 以下操作遇到目录里没有的资源都抛错 */
  readonly setChecked: (code: string, checked: boolean) => void;
  /** 一次勾选或取消多个资源（分类的级联勾选），只替换一次状态；有目录里没有的资源时什么也不改 */
  readonly setCheckedMany: (codes: readonly string[], checked: boolean) => void;
  /** 不在 0～1 之间时抛错 */
  readonly setOpacity: (code: string, opacity: number) => void;
  /** 不是这个资源的年份时抛错 */
  readonly setYear: (code: string, year: number) => void;
  /**
   * 批量设置年份（ADR 0052 第 2 节）：有这一年的资源不论是否勾选都切过去，其他不变，只替换一次状态；
   * 没有任何资源有这一年时什么也不改（ADR 0094），年份不是整数时抛错
   */
  readonly setYearForAll: (year: number) => void;
  /** 移到面板上的第 index 位（0 在最上面，画在最上层）；位置越界时抛错 */
  readonly move: (code: string, index: number) => void;
  readonly deriveGroup: () => StyleGroup;
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
  /** 用户调整的符号（ADR 0044 第 4 节），推导读它的覆盖和预览；不提供时都用默认符号 */
  readonly symbols?: Pick<ResourceSymbols, 'overrideOf'> | null;
}

function reportToConsole(error: unknown): void {
  console.error('[resource-map]', error);
}

/** 创建资源图层的拥有者，在 provideMap 所在组件的 setup 中调用 */
export function useResourceLayers(
  map: Pick<MapContext, 'sourceErrors'>,
  options: ResourceLayersOptions
): ResourceLayers {
  const tileBase = options.tileBase ?? resourceTileBase(appConfig.apiBaseUrl, window.location.origin);
  const onError = safeReporter(options.onError ?? reportToConsole, 'resource-map');
  const validate = options.validate ?? validateCatalog;
  // 状态带着它所基于的目录：推导只读这一份，侦听器什么时候执行都不会读到中间态
  const state = shallowRef<ResourceLayersState>(EMPTY_RESOURCE_LAYERS);

  // 有偏好的范围时，目录要等恢复结束才合并：不先按默认值显示、再换成上次的选择（ADR 0042 第 5 节）
  const { preferences } = options;
  const restored = shallowRef(!preferences);
  if (preferences) {
    usePreference(preferences, {
      name: 'resource-layers',
      version: 1,
      schema: storedResourceLayersSchema,
      snapshot: () => toStoredResourceLayers(state.value),
      restore: stored => {
        if (stored) {
          state.value = fromStoredResourceLayers(stored);
        }
        restored.value = true;
      }
    });
  }

  watch(
    () => [toValue(options.catalog), restored.value] as const,
    ([catalog, ready]) => {
      if (catalog && ready) {
        state.value = mergeDisplayState(state.value, catalog);
      }
    },
    { immediate: true }
  );

  // 只在目录变化时校验（ADR 0026 第 5 条）：目录没变时这个 computed 不通知，勾选、改透明度不会重新校验
  const catalog = computed(() => state.value.catalog);
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

  const tileErrors = computed(
    () =>
      new Set(
        [...map.sourceErrors.value.keys()].flatMap(sourceId => {
          const code = resourceCodeOfSource(sourceId);
          return code === null ? [] : [code];
        })
      )
  );

  // 改一个资源的显示状态；值没变时 change 返回原来的对象，状态不替换
  const update = (code: string, change: (display: ResourceDisplay, resource: Resource) => ResourceDisplay) => {
    const current = state.value;
    const display = current.displays.get(code);
    const resource = current.catalog?.resources.get(code);
    if (!display || !resource) {
      throw new Error(`目录里没有资源 ${code}`);
    }
    const next = change(display, resource);
    if (next !== display) {
      state.value = { ...current, displays: new Map([...current.displays, [code, next]]) };
    }
  };

  const setCheckedMany = (codes: readonly string[], checked: boolean) => {
    const current = state.value;
    const missing = codes.find(code => !current.displays.has(code));
    if (missing !== undefined) {
      throw new Error(`目录里没有资源 ${missing}`);
    }
    const displays = new Map(current.displays);
    let changed = false;
    for (const code of codes) {
      const display = displays.get(code);
      if (display && display.checked !== checked) {
        displays.set(code, { ...display, checked });
        changed = true;
      }
    }
    if (changed) {
      state.value = { ...current, displays };
    }
  };

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

  const setYearForAll = (year: number) => {
    state.value = withYearForAll(state.value, year);
  };

  const move = (code: string, index: number) => {
    const current = state.value;
    const from = current.order.indexOf(code);
    if (from === -1) {
      throw new Error(`目录里没有资源 ${code}`);
    }
    if (!(Number.isInteger(index) && index >= 0 && index < current.order.length)) {
      throw new RangeError(`位置应在 0～${current.order.length - 1} 之间，收到 ${index}`);
    }
    if (from !== index) {
      state.value = { ...current, order: current.order.toSpliced(from, 1).toSpliced(index, 0, code) };
    }
  };

  return {
    state: shallowReadonly(state),
    configErrors,
    tileErrors,
    minzoomOf: code => resourceStyle(code).minzoom,
    setChecked: (code, checked) => setCheckedMany([code], checked),
    setCheckedMany,
    setOpacity,
    setYear,
    setYearForAll,
    move,
    deriveGroup: () =>
      resourcesGroup({
        state: state.value,
        invalid: configErrors.value,
        tileBase,
        overrideOf: options.symbols?.overrideOf
      })
  };
}
