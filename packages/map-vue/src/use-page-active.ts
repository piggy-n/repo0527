import { onActivated, onDeactivated, type Ref, readonly, ref } from 'vue';

/**
 * 所在页面是否在显示：被 KeepAlive 缓存、切到别的页面期间为 false（ADR 0063）；不在 KeepAlive 里时一直为 true。
 * 只能在组件的 setup 里调用
 */
export function usePageActive(): Readonly<Ref<boolean>> {
  const active = ref(true);
  onDeactivated(() => (active.value = false));
  onActivated(() => (active.value = true));
  return readonly(active);
}
