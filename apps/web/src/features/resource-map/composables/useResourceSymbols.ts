import { computed, type MaybeRefOrGetter, type ShallowRef, shallowReadonly, shallowRef, toValue } from 'vue';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import type { Resource, ResourceCatalog } from '../catalog';
import { classItems } from '../classification';
import {
  effectiveOverride,
  fromStoredSymbols,
  pruneOverride,
  type ResourceSymbolOverride,
  storedSymbolsSchema,
  type SymbolMode,
  type SymbolOverrideOf,
  type SymbolOverrides,
  type SymbolPreview,
  type SymbolTarget,
  targetOverride,
  toStoredSymbols,
  withTargetOverride
} from '../resource-symbols';
import { classDefaultSymbol, defaultSymbol, resourceStyle, symbolModeOf } from '../style-registry';
import {
  COLOR_FIELDS,
  type ColorField,
  colorOf,
  FILL_STYLES,
  LINE_DASHES,
  nextOverride,
  normalizeColor,
  normalizeSize,
  POINT_STROKE_WIDTHS,
  type ResourceSymbol,
  resolveSymbol,
  SIZE_REFERENCES,
  type SizeKind,
  SYMBOL_FIELDS,
  type SymbolOverride,
  type SymbolSize
} from '../symbols';

/** 资源图层的符号（ADR 0044 第 5 节）：页面把它交给 useResourceLayers 一起推导，图例通过 props 拿到它编辑 */
export interface ResourceSymbols {
  /** 确认过的覆盖，按资源；只记和默认不同的部分 */
  readonly overrides: Readonly<ShallowRef<SymbolOverrides>>;
  /** 拖动取色时的临时预览，同一时间只有一个 */
  readonly preview: Readonly<ShallowRef<SymbolPreview | null>>;
  /** 推导用的覆盖：确认的覆盖再叠加预览 */
  readonly overrideOf: SymbolOverrideOf;
  /** 按属性配色的资源的样式方式；目录里没有、不按属性配色的资源为 null */
  readonly modeOf: (code: string) => SymbolMode | null;
  /**
   * 确认过的符号（不含预览），编辑器按它显示，取色器拖动中的颜色由取色器自己显示；
   * 目录里没有的资源、规则里没有的取值为 null
   */
  readonly symbolOf: (target: SymbolTarget) => ResourceSymbol | null;
  /** 改目标的字段并保存；参数不合法时抛错，同时清掉这个目标的预览 */
  readonly setSymbol: (target: SymbolTarget, patch: SymbolOverride) => void;
  /** 拖动取色时的预览，不保存；和确认的颜色相同时清掉这个字段的预览；颜色解析不了、这个几何没有该字段时抛错 */
  readonly previewColor: (target: SymbolTarget, field: ColorField, color: string) => void;
  /** 丢弃预览（关闭取色器、取消） */
  readonly clearPreview: () => void;
  /** 切换按属性配色的资源的样式方式，两种方式的覆盖都保留；不是按属性配色的资源时抛错 */
  readonly setMode: (code: string, mode: SymbolMode) => void;
  /** 恢复一个目标的默认符号 */
  readonly resetSymbol: (target: SymbolTarget) => void;
  /** 恢复一个资源的全部默认：样式方式、统一样式和各取值 */
  readonly resetResource: (code: string) => void;
  /** 恢复全部资源的默认 */
  readonly resetAll: () => void;
  /** 资源有没有任何覆盖（选了统一样式也算） */
  readonly isCustomized: (code: string) => boolean;
  /** 目标有没有覆盖 */
  readonly hasOverride: (target: SymbolTarget) => boolean;
}

export interface ResourceSymbolsOptions {
  /** 资源目录，通常是 useResourceCatalogQuery 的 data */
  readonly catalog: MaybeRefOrGetter<ResourceCatalog | undefined>;
  /** 页面提供时按用户保存（ADR 0042）；不提供时不读不写 */
  readonly preferences?: PreferenceScope | null;
}

const STROKE_WIDTHS: readonly number[] = POINT_STROKE_WIDTHS;

// 自定义大小按步长取整，越界时抛错
function requireSize(kind: SizeKind, size: SymbolSize): SymbolSize {
  const normalized = normalizeSize(kind, size);
  if (normalized === null) {
    const { min, max } = SIZE_REFERENCES[kind];
    throw new RangeError(`大小只能是 ${min}～${max}，收到 ${size}`);
  }
  return normalized;
}

// 改动按几何校验、自定义大小取整；不合法时抛错（界面先校验，这里是最后一道）。颜色由 nextOverride 规范化
function checkedPatch(resource: Resource, patch: SymbolOverride): SymbolOverride {
  const allowed: readonly string[] = SYMBOL_FIELDS[resource.geometry];
  const unknown = Object.keys(patch).find(field => !allowed.includes(field));
  if (unknown) {
    throw new Error(`资源 ${resource.code} 的符号没有 ${unknown}`);
  }
  for (const field of COLOR_FIELDS) {
    const value = patch[field];
    if (value !== undefined && normalizeColor(value) === null) {
      throw new Error(`${field} 不是颜色：${value}`);
    }
  }
  if (patch.strokeWidth !== undefined && !STROKE_WIDTHS.includes(patch.strokeWidth)) {
    throw new RangeError(`描边宽度只能是 ${STROKE_WIDTHS.join('、')}，收到 ${patch.strokeWidth}`);
  }
  for (const dash of [patch.dash, patch.outlineDash]) {
    if (dash !== undefined && !Object.hasOwn(LINE_DASHES, dash)) {
      throw new Error(`没有线型 ${dash}`);
    }
  }
  if (patch.fillStyle !== undefined && !Object.hasOwn(FILL_STYLES, patch.fillStyle)) {
    throw new Error(`没有填充方式 ${patch.fillStyle}`);
  }
  return {
    ...patch,
    ...(patch.size === undefined ? {} : { size: requireSize('circle', patch.size) }),
    ...(patch.width === undefined ? {} : { width: requireSize('line', patch.width) }),
    ...(patch.outlineWidth === undefined ? {} : { outlineWidth: requireSize('outline', patch.outlineWidth) })
  };
}

const sameOverride = (a: ResourceSymbolOverride | undefined, b: ResourceSymbolOverride | undefined) =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

const isTarget = (preview: SymbolPreview, target: SymbolTarget) =>
  preview.code === target.code && preview.item === target.item;

// 目标对应的资源和默认符号
interface ResolvedTarget {
  readonly resource: Resource;
  readonly defaults: ResourceSymbol;
}

/** 创建资源图层的符号拥有者，在 provideMap 所在组件的 setup 中调用；存下的覆盖读到后替换一次 */
export function useResourceSymbols(options: ResourceSymbolsOptions): ResourceSymbols {
  const overrides = shallowRef<SymbolOverrides>(new Map());
  const preview = shallowRef<SymbolPreview | null>(null);
  const resources = computed(() => toValue(options.catalog)?.resources);

  if (options.preferences) {
    usePreference(options.preferences, {
      name: 'resource-symbols',
      version: 1,
      schema: storedSymbolsSchema,
      snapshot: () => toStoredSymbols(overrides.value),
      restore: stored => {
        if (stored) {
          overrides.value = fromStoredSymbols(stored);
        }
      }
    });
  }

  // 统一样式对任何资源都有；取值只属于按属性配色的资源，键要在规则的取值里
  const resolveTarget = ({ code, item }: SymbolTarget): ResolvedTarget | null => {
    const resource = resources.value?.get(code);
    if (!resource) {
      return null;
    }
    if (item === undefined) {
      return { resource, defaults: defaultSymbol(resource) };
    }
    const rule = resourceStyle(code).color;
    const classItem = rule && classItems(rule).find(entry => entry.key === item);
    return classItem ? { resource, defaults: classDefaultSymbol(resource, classItem) } : null;
  };

  const requireTarget = (target: SymbolTarget): ResolvedTarget => {
    const resolved = resolveTarget(target);
    if (!resolved) {
      throw new Error(`资源 ${target.code} 不在目录里，或者没有取值 ${target.item}`);
    }
    return resolved;
  };

  const committedSymbol = ({ defaults }: ResolvedTarget, target: SymbolTarget) =>
    resolveSymbol(defaults, targetOverride(overrides.value.get(target.code), target.item));

  const replace = (code: string, next: ResourceSymbolOverride | undefined) => {
    const current = overrides.value;
    if (sameOverride(current.get(code), next)) {
      return;
    }
    const map = new Map(current);
    if (next) {
      map.set(code, next);
    } else {
      map.delete(code);
    }
    overrides.value = map;
  };

  const clearPreviewIf = (matches: (current: SymbolPreview) => boolean) => {
    if (preview.value && matches(preview.value)) {
      preview.value = null;
    }
  };

  const setSymbol = (target: SymbolTarget, patch: SymbolOverride) => {
    const { resource, defaults } = requireTarget(target);
    const current = overrides.value.get(target.code);
    const next = nextOverride(defaults, targetOverride(current, target.item), checkedPatch(resource, patch));
    clearPreviewIf(previewing => isTarget(previewing, target));
    replace(target.code, withTargetOverride(current, target.item, next));
  };

  const previewColor = (target: SymbolTarget, field: ColorField, color: string) => {
    const resolved = requireTarget(target);
    if (!SYMBOL_FIELDS[resolved.resource.geometry].includes(field)) {
      throw new Error(`资源 ${target.code} 的符号没有 ${field}`);
    }
    const normalized = normalizeColor(color);
    if (normalized === null) {
      throw new Error(`${field} 不是颜色：${color}`);
    }
    // 取色器取消（Esc、点外面、失焦）时把颜色重置回确认的值并再报一次，打开时也会报一次换了写法的确认值（ADR 0044 第 6 节）
    const committed = colorOf(committedSymbol(resolved, target), field);
    if (committed !== undefined && normalizeColor(committed) === normalized) {
      clearPreviewIf(previewing => isTarget(previewing, target) && previewing.field === field);
      return;
    }
    const item = target.item === undefined ? {} : { item: target.item };
    preview.value = { code: target.code, ...item, field, color: normalized };
  };

  const setMode = (code: string, mode: SymbolMode) => {
    if (!resources.value?.has(code) || !resourceStyle(code).color) {
      throw new Error(`资源 ${code} 不在目录里，或者不按属性配色`);
    }
    clearPreviewIf(previewing => previewing.code === code);
    replace(code, pruneOverride({ ...overrides.value.get(code), mode: mode === 'uniform' ? 'uniform' : undefined }));
  };

  return {
    overrides: shallowReadonly(overrides),
    preview: shallowReadonly(preview),
    overrideOf: code => effectiveOverride(overrides.value, preview.value, code),
    modeOf: code => {
      const style = resourceStyle(code);
      return resources.value?.has(code) && style.color ? symbolModeOf(style, overrides.value.get(code)) : null;
    },
    symbolOf: target => {
      const resolved = resolveTarget(target);
      return resolved ? committedSymbol(resolved, target) : null;
    },
    setSymbol,
    previewColor,
    clearPreview: () => {
      preview.value = null;
    },
    setMode,
    resetSymbol: target => {
      clearPreviewIf(previewing => isTarget(previewing, target));
      replace(target.code, withTargetOverride(overrides.value.get(target.code), target.item, {}));
    },
    resetResource: code => {
      clearPreviewIf(previewing => previewing.code === code);
      replace(code, undefined);
    },
    resetAll: () => {
      preview.value = null;
      if (overrides.value.size > 0) {
        overrides.value = new Map();
      }
    },
    isCustomized: code => overrides.value.has(code),
    hasOverride: target => targetOverride(overrides.value.get(target.code), target.item) !== undefined
  };
}
