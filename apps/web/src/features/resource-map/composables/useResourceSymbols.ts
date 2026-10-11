import { computed, type MaybeRefOrGetter, type ShallowRef, shallowReadonly, shallowRef, toValue } from 'vue';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import type { Resource, ResourceCatalog } from '../catalog';
import {
  effectiveOverride,
  fromStoredSymbols,
  type ResourceSymbolOverride,
  storedSymbolsSchema,
  type SymbolOverrides,
  type SymbolPreview,
  toStoredSymbols
} from '../resource-symbols';
import { defaultSymbol, resourceStyle } from '../style-registry';
import {
  COLOR_FIELDS,
  type ColorField,
  colorOf,
  LINE_DASHES,
  nextOverride,
  normalizeColor,
  normalizeSize,
  POINT_STROKE_WIDTHS,
  type ResourceSymbol,
  resolveSymbol,
  SIZE_REFERENCES,
  SYMBOL_FIELDS,
  type SymbolOverride,
  type SymbolSize
} from '../symbols';

/** 资源图层的符号（ADR 0044 第 5 节）：页面把它交给 useResourceLayers 一起推导，图例通过 props 拿到它编辑 */
export interface ResourceSymbols {
  /** 确认过的覆盖，按资源；只记和默认不同的字段 */
  readonly overrides: Readonly<ShallowRef<SymbolOverrides>>;
  /** 拖动取色时的临时预览，同一时间只有一个 */
  readonly preview: Readonly<ShallowRef<SymbolPreview | null>>;
  /** 推导用的覆盖：确认的覆盖再叠加预览 */
  readonly overrideOf: (code: string) => SymbolOverride | undefined;
  /** 确认过的统一符号（不含预览），编辑器按它显示，取色器拖动中的颜色由取色器自己显示；目录里没有、按属性配色的资源为 null */
  readonly symbolOf: (code: string) => ResourceSymbol | null;
  /** 改统一样式的字段并保存；参数不合法时抛错，同时清掉预览 */
  readonly setUniform: (code: string, patch: SymbolOverride) => void;
  /** 拖动取色时的预览，不保存；和确认的颜色相同时清掉这个字段的预览；颜色解析不了、这个几何没有该字段时抛错 */
  readonly previewColor: (code: string, field: ColorField, color: string) => void;
  /** 丢弃预览（关闭取色器、取消） */
  readonly clearPreview: () => void;
  /** 恢复一个资源的默认符号 */
  readonly resetUniform: (code: string) => void;
  /** 恢复全部资源的默认符号 */
  readonly resetAll: () => void;
  readonly isCustomized: (code: string) => boolean;
}

export interface ResourceSymbolsOptions {
  /** 资源目录，通常是 useResourceCatalogQuery 的 data */
  readonly catalog: MaybeRefOrGetter<ResourceCatalog | undefined>;
  /** 页面提供时按用户保存（ADR 0042）；不提供时不读不写 */
  readonly preferences?: PreferenceScope | null;
}

const STROKE_WIDTHS: readonly number[] = POINT_STROKE_WIDTHS;

// 自定义大小按步长取整，越界时抛错
function requireSize(geometry: 'circle' | 'line', size: SymbolSize): SymbolSize {
  const normalized = normalizeSize(geometry, size);
  if (normalized === null) {
    const { min, max } = SIZE_REFERENCES[geometry];
    throw new RangeError(`大小只能是 ${min}～${max}，收到 ${size}`);
  }
  return normalized;
}

// 统一样式的改动按几何校验、自定义大小取整；不合法时抛错（界面先校验，这里是最后一道）。颜色由 nextOverride 规范化
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
  if (patch.dash !== undefined && !Object.hasOwn(LINE_DASHES, patch.dash)) {
    throw new Error(`没有线型 ${patch.dash}`);
  }
  return {
    ...patch,
    ...(patch.size === undefined ? {} : { size: requireSize('circle', patch.size) }),
    ...(patch.width === undefined ? {} : { width: requireSize('line', patch.width) })
  };
}

const sameOverride = (a: ResourceSymbolOverride | undefined, b: ResourceSymbolOverride | undefined) =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

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

  // 统一符号的资源：在目录里、不按属性配色；分类样式在 5C.5b
  const uniformResource = (code: string): Resource | null => {
    const resource = resources.value?.get(code);
    return resource && !resourceStyle(code).color ? resource : null;
  };

  const requireUniform = (code: string): Resource => {
    const resource = uniformResource(code);
    if (!resource) {
      throw new Error(`资源 ${code} 不在目录里，或者不是统一符号`);
    }
    return resource;
  };

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

  const overrideOf = (code: string) => effectiveOverride(overrides.value, preview.value, code);

  const committedSymbol = (resource: Resource) =>
    resolveSymbol(defaultSymbol(resource), overrides.value.get(resource.code)?.uniform);

  const setUniform = (code: string, patch: SymbolOverride) => {
    const resource = requireUniform(code);
    const uniform = nextOverride(defaultSymbol(resource), overrides.value.get(code)?.uniform, checkedPatch(resource, patch));
    if (preview.value?.code === code) {
      preview.value = null;
    }
    replace(code, Object.keys(uniform).length > 0 ? { uniform } : undefined);
  };

  const previewColor = (code: string, field: ColorField, color: string) => {
    const resource = requireUniform(code);
    if (!SYMBOL_FIELDS[resource.geometry].includes(field)) {
      throw new Error(`资源 ${code} 的符号没有 ${field}`);
    }
    const normalized = normalizeColor(color);
    if (normalized === null) {
      throw new Error(`${field} 不是颜色：${color}`);
    }
    // 取色器取消（Esc、点外面、失焦）时把颜色重置回确认的值并再报一次，打开时也会报一次换了写法的确认值（ADR 0044 第 6 节）
    const committed = colorOf(committedSymbol(resource), field);
    if (committed !== undefined && normalizeColor(committed) === normalized) {
      if (preview.value?.code === code && preview.value.field === field) {
        preview.value = null;
      }
      return;
    }
    preview.value = { code, field, color: normalized };
  };

  return {
    overrides: shallowReadonly(overrides),
    preview: shallowReadonly(preview),
    overrideOf,
    symbolOf: code => {
      const resource = uniformResource(code);
      return resource ? committedSymbol(resource) : null;
    },
    setUniform,
    previewColor,
    clearPreview: () => {
      preview.value = null;
    },
    resetUniform: code => {
      if (preview.value?.code === code) {
        preview.value = null;
      }
      replace(code, undefined);
    },
    resetAll: () => {
      preview.value = null;
      if (overrides.value.size > 0) {
        overrides.value = new Map();
      }
    },
    isCustomized: code => overrides.value.has(code)
  };
}
