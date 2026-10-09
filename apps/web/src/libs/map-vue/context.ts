import type { MapSession } from '@yzt/map-core';
import type { InjectionKey } from 'vue';

/** map-vue 内部的完整上下文：画布组件用它拿到会话；对外的只读上下文由 useMap 给出（ADR 0028） */
export interface InternalMapContext {
  readonly session: MapSession<string>;
  readonly onError: (error: unknown) => void;
}

export const INTERNAL_MAP_CONTEXT: InjectionKey<InternalMapContext> = Symbol('map-vue');
