import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import {
  LAYER_SERVICE_TYPES,
  type LayerServiceDraft,
  type LayerServiceKind,
  type LayerServiceRecord
} from './layer-services';

type LayerServiceGroups = Partial<Record<LayerServiceKind, readonly LayerServiceRecord[]>>;

const NO_SERVICES: readonly LayerServiceRecord[] = [];

/**
 * 地图服务、数据接口的内存记录，按资源 ID 和类别分开；表格的数量和弹窗的列表共用。
 * 和旧页面一样离开页面再回来仍在，刷新浏览器丢失；不写浏览器存储
 */
export const useLayerServiceStore = defineStore('resource-layer-services', () => {
  const session = useSessionStore();
  const records = shallowRef<Record<string, LayerServiceGroups>>({});
  // 记录编号只需在本 store 里唯一；不用 crypto.randomUUID，普通 HTTP 的内网没有它
  const nextId = ref(0);

  function reset() {
    records.value = {};
  }

  // store 不随页面卸载，换会话时清空，不把上一个账号的记录留给下一个
  watch(() => session.token, reset, { flush: 'sync' });

  function items(layerId: string, kind: LayerServiceKind): readonly LayerServiceRecord[] {
    return records.value[layerId]?.[kind] ?? NO_SERVICES;
  }

  function replace(layerId: string, kind: LayerServiceKind, next: readonly LayerServiceRecord[]) {
    records.value = { ...records.value, [layerId]: { ...records.value[layerId], [kind]: next } };
  }

  /** 新增（不传 id）或替换一条记录；名称、地址去掉首尾空白后不能为空，已删除的记录不能被编辑回来 */
  function save(layerId: string, kind: LayerServiceKind, draft: LayerServiceDraft, id?: string): boolean {
    const name = draft.name.trim();
    const url = draft.url.trim();
    if (!name || !url || !LAYER_SERVICE_TYPES[kind].includes(draft.type)) {
      return false;
    }
    const previous = items(layerId, kind);
    if (id === undefined) {
      nextId.value += 1;
      replace(layerId, kind, [...previous, { ...draft, name, url, id: `layer-service-${nextId.value}` }]);
      return true;
    }
    if (!previous.some(item => item.id === id)) {
      return false;
    }
    const record: LayerServiceRecord = { ...draft, name, url, id };
    replace(layerId, kind, previous.map(item => (item.id === id ? record : item)));
    return true;
  }

  function remove(layerId: string, kind: LayerServiceKind, id: string): boolean {
    const previous = items(layerId, kind);
    if (!previous.some(item => item.id === id)) {
      return false;
    }
    replace(layerId, kind, previous.filter(item => item.id !== id));
    return true;
  }

  return { records, nextId, items, save, remove, reset };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLayerServiceStore, import.meta.hot));
}
