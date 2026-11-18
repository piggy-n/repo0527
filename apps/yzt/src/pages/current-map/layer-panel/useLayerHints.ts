import { computed, type ComputedRef, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import type { ResourceStatusKind } from '@/features/resource-map/resource-status';
import type { RequestKinds } from '@/shared/map/request-status/request-status';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import {
  LAYER_HINTS,
  type LayerHint,
  requestKindsOf,
  resourceStatusKindsOf,
  shownHintsOf,
  storedLayerHintsSchema
} from './layer-hints';

/** 图层行内提示的开关（ADR 0167）：页面创建，面板的设置浮层显示和修改，数据加载和图层的行按它显示 */
export interface LayerHints {
  /** 开着的种类 */
  readonly shown: Readonly<ShallowRef<ReadonlySet<LayerHint>>>;
  readonly setShown: (hint: LayerHint, shown: boolean) => void;
  /** 全开、全关 */
  readonly setAll: (shown: boolean) => void;
  /** 数据加载的条目、明细和行内的转圈、失败 */
  readonly requestKinds: ComputedRef<RequestKinds>;
  /** 资源行的状态图标 */
  readonly statusKinds: ComputedRef<readonly ResourceStatusKind[]>;
}

export interface LayerHintsOptions {
  /** 偏好范围：给了就按账号记住；开发页不传 */
  readonly preferences?: PreferenceScope | null;
}

/** 图层行内提示的开关：默认全开 */
export function useLayerHints({ preferences = null }: LayerHintsOptions = {}): LayerHints {
  const shown = shallowRef<ReadonlySet<LayerHint>>(new Set(LAYER_HINTS));

  if (preferences) {
    usePreference(preferences, {
      name: 'layer-hints',
      version: 1,
      schema: storedLayerHintsSchema,
      snapshot: () => ({ hidden: LAYER_HINTS.filter(hint => !shown.value.has(hint)) }),
      restore: stored => {
        if (stored) {
          shown.value = shownHintsOf(stored);
        }
      }
    });
  }

  const setShown = (hint: LayerHint, on: boolean) => {
    if (shown.value.has(hint) === on) {
      return;
    }
    shown.value = new Set(LAYER_HINTS.filter(item => (item === hint ? on : shown.value.has(item))));
  };

  const setAll = (on: boolean) => {
    if (on ? shown.value.size === LAYER_HINTS.length : shown.value.size === 0) {
      return;
    }
    shown.value = new Set(on ? LAYER_HINTS : []);
  };

  return {
    shown: shallowReadonly(shown),
    setShown,
    setAll,
    requestKinds: computed(() => requestKindsOf(shown.value)),
    statusKinds: computed(() => resourceStatusKindsOf(shown.value))
  };
}
