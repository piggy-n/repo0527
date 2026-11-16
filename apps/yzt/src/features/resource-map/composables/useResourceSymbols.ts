import { computed, type MaybeRefOrGetter, type ShallowRef, shallowReadonly, shallowRef, toValue } from 'vue';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import type { Resource, ResourceCatalog } from '../catalog';
import { classItems } from '../classification';
import { labelFieldsOf } from '../label-fields';
import {
  LABEL_FONT_NAMES,
  LABEL_HALO_WIDTHS,
  LABEL_SIZES,
  LABEL_ZOOM_RANGE,
  type LabelColorField,
  type LabelOverride,
  nextLabelOverride,
  PLACEMENTS_OF,
  type ResourceLabel
} from '../labels';
import { POINT_SHAPES } from '../point-shapes';
import {
  effectiveOverride,
  fromStoredSymbols,
  pruneOverride,
  RESOURCE_SYMBOLS_PREFERENCE,
  RESOURCE_SYMBOLS_VERSION,
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
import {
  classDefaultSymbol,
  defaultLabel,
  defaultSymbol,
  defaultSymbolMode,
  resourceLabel,
  resourceStyle,
  symbolModeOf
} from '../style-registry';
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
  /** 丢弃这个目标的预览（编辑器卸载、换了目标）；预览已经属于别的目标时不动 */
  readonly clearPreview: (target: SymbolTarget) => void;
  /** 切换按属性配色的资源的样式方式，两种方式的覆盖都保留；不是按属性配色的资源时抛错 */
  readonly setMode: (code: string, mode: SymbolMode) => void;
  /** 恢复一个目标的默认符号 */
  readonly resetSymbol: (target: SymbolTarget) => void;
  /** 恢复一个资源的全部默认：样式方式、统一样式和各取值 */
  readonly resetResource: (code: string) => void;
  /** 恢复全部资源的默认 */
  readonly resetAll: () => void;
  /**
   * 资源的符号有没有覆盖（选了统一样式也算），图例的"改过符号"按它；只改了标注不算，标注在标注编辑器里恢复（ADR 0160）
   */
  readonly isCustomized: (code: string) => boolean;
  /** 目标有没有覆盖 */
  readonly hasOverride: (target: SymbolTarget) => boolean;
  /**
   * 确认过的标注（ADR 0160，不含预览），标注编辑器按它显示；目录里没有、没有登记标注字段的资源为 null。
   * 标注的样式存在资源的覆盖里，跟着"恢复默认"和发布的默认符号走
   */
  readonly labelOf: (code: string) => ResourceLabel | null;
  /** 改标注并保存；参数不合法时抛错，同时清掉这个资源标注的预览 */
  readonly setLabel: (code: string, patch: LabelOverride) => void;
  /** 拖动取色时的标注颜色预览，不保存；和确认的颜色相同时清掉预览；颜色解析不了、资源没有标注时抛错 */
  readonly previewLabelColor: (code: string, field: LabelColorField, color: string) => void;
  /** 丢弃这个资源标注的预览（编辑器卸载、换了资源） */
  readonly clearLabelPreview: (code: string) => void;
  /** 恢复这个资源的默认标注 */
  readonly resetLabel: (code: string) => void;
  /** 标注有没有覆盖 */
  readonly hasLabelOverride: (code: string) => boolean;
}

export interface ResourceSymbolsOptions {
  /** 资源目录，通常是 useResourceCatalogQuery 的 data */
  readonly catalog: MaybeRefOrGetter<ResourceCatalog | undefined>;
  /** 页面提供时按用户保存（ADR 0042）；不提供时不读不写 */
  readonly preferences?: PreferenceScope | null;
}

const STROKE_WIDTHS: readonly number[] = POINT_STROKE_WIDTHS;
const LABEL_SIZE_VALUES: readonly number[] = LABEL_SIZES;
const LABEL_HALO_VALUES: readonly number[] = LABEL_HALO_WIDTHS;

// 拖动取色时标注颜色的临时预览，同符号的预览（ADR 0044 第 6 节）
interface LabelPreview {
  readonly code: string;
  readonly field: LabelColorField;
  readonly color: string;
}

const isZoom = (value: number) =>
  Number.isInteger(value) && value >= LABEL_ZOOM_RANGE.min && value <= LABEL_ZOOM_RANGE.max;

// 标注的改动按资源校验（界面先校验，这里是最后一道）；合并后最小级别不能比最大级别大
function checkLabelPatch(resource: Resource, current: ResourceLabel, patch: LabelOverride): void {
  const { field, font, size, color, haloColor, haloWidth, placement, minzoom, maxzoom } = patch;
  if (field !== undefined && !labelFieldsOf(resource.code).some(option => option.field === field)) {
    throw new Error(`资源 ${resource.code} 的标注没有字段 ${field}`);
  }
  if (font !== undefined && !LABEL_FONT_NAMES.includes(font)) {
    throw new Error(`没有字体 ${font}`);
  }
  if (size !== undefined && !LABEL_SIZE_VALUES.includes(size)) {
    throw new RangeError(`字号只能是 ${LABEL_SIZES.join('、')}，收到 ${size}`);
  }
  if (haloWidth !== undefined && !LABEL_HALO_VALUES.includes(haloWidth)) {
    throw new RangeError(`描边宽度只能是 ${LABEL_HALO_WIDTHS.join('、')}，收到 ${haloWidth}`);
  }
  for (const value of [color, haloColor]) {
    if (value !== undefined && normalizeColor(value) === null) {
      throw new Error(`不是颜色：${value}`);
    }
  }
  if (placement !== undefined && !PLACEMENTS_OF[resource.geometry].includes(placement)) {
    throw new Error(`资源 ${resource.code} 的标注不能放在${placement}`);
  }
  const from = minzoom ?? current.minzoom;
  const to = maxzoom ?? current.maxzoom;
  if (!isZoom(from) || !isZoom(to) || from > to) {
    const { min, max } = LABEL_ZOOM_RANGE;
    throw new RangeError(`显示级别应是 ${min}～${max} 之间的整数、从小到大，收到 ${from}～${to}`);
  }
}

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
  if (patch.shape !== undefined && !Object.hasOwn(POINT_SHAPES, patch.shape)) {
    throw new Error(`没有形状 ${patch.shape}`);
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

// 用户没调过时的样式方式，整理覆盖时用它判断要不要记下选的方式（ADR 0154）
const defaultModeOf = (code: string) => defaultSymbolMode(resourceStyle(code));

// 目标对应的资源和默认符号
interface ResolvedTarget {
  readonly resource: Resource;
  readonly defaults: ResourceSymbol;
}

/** 创建资源图层的符号拥有者，在 provideMap 所在组件的 setup 中调用；存下的覆盖读到后替换一次 */
export function useResourceSymbols(options: ResourceSymbolsOptions): ResourceSymbols {
  const overrides = shallowRef<SymbolOverrides>(new Map());
  const preview = shallowRef<SymbolPreview | null>(null);
  const labelPreview = shallowRef<LabelPreview | null>(null);
  const resources = computed(() => toValue(options.catalog)?.resources);

  if (options.preferences) {
    usePreference(options.preferences, {
      name: RESOURCE_SYMBOLS_PREFERENCE,
      version: RESOURCE_SYMBOLS_VERSION,
      schema: storedSymbolsSchema,
      snapshot: () => toStoredSymbols(overrides.value),
      restore: stored => {
        if (stored) {
          overrides.value = fromStoredSymbols(stored, defaultModeOf);
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
    replace(target.code, withTargetOverride(current, target.item, next, defaultModeOf(target.code)));
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

  // 确认过的标注；目录里没有、没有登记标注字段时为 null
  const committedLabel = (code: string) => {
    const resource = resources.value?.get(code);
    return resource ? resourceLabel(resource, overrides.value.get(code)) : null;
  };

  const clearLabelPreviewOf = (code: string) => {
    if (labelPreview.value?.code === code) {
      labelPreview.value = null;
    }
  };

  const setLabel = (code: string, patch: LabelOverride) => {
    const resource = resources.value?.get(code);
    const defaults = resource && defaultLabel(resource);
    const current = committedLabel(code);
    if (!resource || !defaults || !current) {
      throw new Error(`资源 ${code} 不在目录里，或者没有可标注的字段`);
    }
    checkLabelPatch(resource, current, patch);
    const override = overrides.value.get(code);
    const label = nextLabelOverride(defaults, override?.label, patch);
    clearLabelPreviewOf(code);
    replace(code, pruneOverride({ ...override, label }, defaultModeOf(code)));
  };

  const previewLabelColor = (code: string, field: LabelColorField, color: string) => {
    const current = committedLabel(code);
    if (!current) {
      throw new Error(`资源 ${code} 不在目录里，或者没有可标注的字段`);
    }
    const normalized = normalizeColor(color);
    if (normalized === null) {
      throw new Error(`${field} 不是颜色：${color}`);
    }
    // 取色器取消时把颜色重置回确认的值并再报一次（ADR 0044 第 6 节）
    if (normalizeColor(current[field]) === normalized) {
      if (labelPreview.value?.code === code && labelPreview.value.field === field) {
        labelPreview.value = null;
      }
      return;
    }
    labelPreview.value = { code, field, color: normalized };
  };

  // 推导用的覆盖：符号的预览之外，再叠加标注颜色的预览
  const overrideOf: SymbolOverrideOf = code => {
    const override = effectiveOverride(overrides.value, preview.value, code, defaultModeOf(code));
    const previewing = labelPreview.value;
    if (previewing?.code !== code) {
      return override;
    }
    const color: Partial<Record<LabelColorField, string>> = { [previewing.field]: previewing.color };
    return { ...override, label: { ...override?.label, ...color } };
  };

  const setMode = (code: string, mode: SymbolMode) => {
    if (!resources.value?.has(code) || !resourceStyle(code).color) {
      throw new Error(`资源 ${code} 不在目录里，或者不按属性配色`);
    }
    clearPreviewIf(previewing => previewing.code === code);
    replace(code, pruneOverride({ ...overrides.value.get(code), mode }, defaultModeOf(code)));
  };

  return {
    overrides: shallowReadonly(overrides),
    preview: shallowReadonly(preview),
    overrideOf,
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
    clearPreview: target => {
      clearPreviewIf(previewing => isTarget(previewing, target));
    },
    setMode,
    resetSymbol: target => {
      clearPreviewIf(previewing => isTarget(previewing, target));
      const { code, item } = target;
      replace(code, withTargetOverride(overrides.value.get(code), item, {}, defaultModeOf(code)));
    },
    resetResource: code => {
      clearPreviewIf(previewing => previewing.code === code);
      clearLabelPreviewOf(code);
      replace(code, undefined);
    },
    resetAll: () => {
      preview.value = null;
      labelPreview.value = null;
      if (overrides.value.size > 0) {
        overrides.value = new Map();
      }
    },
    isCustomized: code => {
      const override = overrides.value.get(code);
      return Boolean(override?.uniform ?? override?.mode ?? override?.items);
    },
    hasOverride: target => targetOverride(overrides.value.get(target.code), target.item) !== undefined,
    labelOf: committedLabel,
    setLabel,
    previewLabelColor,
    clearLabelPreview: clearLabelPreviewOf,
    resetLabel: code => {
      clearLabelPreviewOf(code);
      const override = overrides.value.get(code);
      if (override?.label) {
        replace(code, pruneOverride({ ...override, label: undefined }, defaultModeOf(code)));
      }
    },
    hasLabelOverride: code => overrides.value.get(code)?.label !== undefined
  };
}
