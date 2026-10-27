import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import type { ResourceRecord } from '../api';
import {
  emptyLayerServiceDraft,
  type LayerServiceDraft,
  type LayerServiceKind,
  type LayerServiceRecord
} from '../layer-services';
import { useLayerServiceStore } from '../store';

/** 弹窗针对的资源和类别；名称和年份只用于标题 */
export interface LayerServiceTarget {
  id: string;
  name: string;
  year: number | null;
  kind: LayerServiceKind;
}

/** 一次新增或编辑；draft 是副本，取消时原记录不变 */
export interface LayerServiceEditor {
  id: string | undefined;
  draft: LayerServiceDraft;
}

/**
 * 地图服务、数据接口的弹窗：列表、新增 / 编辑表单、删除确认。从列表里新增、编辑、删除时列表不关闭；
 * 表单、确认框的开关和内容分开保存，关闭动画期间内容不消失。校验、提示由界面负责
 */
export function useLayerServices() {
  const store = useLayerServiceStore();
  const session = useSessionStore();
  const target = shallowRef<LayerServiceTarget | null>(null);
  const listOpen = ref(false);
  const formOpen = ref(false);
  const editor = shallowRef<LayerServiceEditor | null>(null);
  const removalOpen = ref(false);
  const removal = shallowRef<LayerServiceRecord | null>(null);
  const items = computed(() => (target.value ? store.items(target.value.id, target.value.kind) : []));

  function close() {
    listOpen.value = false;
    formOpen.value = false;
    removalOpen.value = false;
  }

  // 换会话时 store 清空了记录，开着的弹窗一起关掉
  watch(() => session.token, close, { flush: 'sync' });
  onScopeDispose(close);

  function count(id: string, kind: LayerServiceKind): number {
    return store.items(id, kind).length;
  }

  function aim(row: ResourceRecord, kind: LayerServiceKind) {
    target.value = { id: row.id, name: row.name, year: row.year, kind };
  }

  function openList(row: ResourceRecord, kind: LayerServiceKind) {
    aim(row, kind);
    listOpen.value = true;
  }

  /** 不传 item 为新增；表格上的加号直接打开表单，不经过列表 */
  function edit(item?: LayerServiceRecord) {
    const current = target.value;
    if (!current) {
      return;
    }
    const { name, type, url, status } = item ?? emptyLayerServiceDraft(current.kind);
    editor.value = { id: item?.id, draft: reactive({ name, type, url, status }) };
    formOpen.value = true;
  }

  function openForm(row: ResourceRecord, kind: LayerServiceKind) {
    aim(row, kind);
    edit();
  }

  function closeForm() {
    formOpen.value = false;
  }

  /** 校验是异步的：等待期间表单可能已关闭或重新打开，只保存仍在编辑的那一份 */
  function save(current: LayerServiceEditor): boolean {
    const active = target.value;
    if (!active || !formOpen.value || current !== editor.value) {
      return false;
    }
    const saved = store.save(active.id, active.kind, current.draft, current.id);
    if (saved) {
      formOpen.value = false;
    }
    return saved;
  }

  function requestRemoval(item: LayerServiceRecord) {
    removal.value = item;
    removalOpen.value = true;
  }

  /** 关闭确认框；确认并删除成功时返回 true，重复确认不会再删 */
  function answerRemoval(confirmed: boolean): boolean {
    const active = target.value;
    const item = removal.value;
    const open = removalOpen.value;
    removalOpen.value = false;
    if (!confirmed || !open || !active || !item) {
      return false;
    }
    return store.remove(active.id, active.kind, item.id);
  }

  return {
    target,
    items,
    listOpen,
    formOpen,
    editor,
    removalOpen,
    removal,
    count,
    openList,
    openForm,
    edit,
    closeForm,
    save,
    requestRemoval,
    answerRemoval
  };
}

export type LayerServicesOwner = ReturnType<typeof useLayerServices>;
