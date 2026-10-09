import { MapSession, type MapSessionOptions } from '@yzt/map-core';
import { getCurrentInstance, onBeforeMount, onBeforeUnmount, onUnmounted, provide } from 'vue';
import { INTERNAL_MAP_CONTEXT } from './context';
import { StyleBinder, type StyleDerivation } from './style-binder';

export interface ProvideMapOptions<G extends string> extends MapSessionOptions<G> {
  /** 样式提交失败、视图运行中的错误；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
}

/** 页面句柄：只交给调用 provideMap 的页面，子孙组件通过 useMap 拿到只读的上下文 */
export interface MapHandle<G extends string> {
  /** 把推导函数绑定到分组；只能在同一个组件的 setup 中调用，一个分组只能绑定一次 */
  bindStyle(bindings: Partial<Readonly<Record<G, StyleDerivation>>>): void;
}

function reportToConsole(error: unknown): void {
  console.error('[map-vue]', error);
}

/**
 * 在当前组件里创建地图会话并提供给子孙组件（ADR 0028）。
 * 挂载前一次提交所有绑定的初始值；卸载前停止提交，子组件里的视图释放之后再释放会话
 */
export function provideMap<const G extends string>(options: ProvideMapOptions<G>): MapHandle<G> {
  if (!getCurrentInstance()) {
    throw new Error('provideMap 只能在组件的 setup 中调用');
  }
  const onError = options.onError ?? reportToConsole;
  const session = new MapSession(options);
  const binder = new StyleBinder(session.style, onError);
  provide(INTERNAL_MAP_CONTEXT, { session, onError });

  // 父组件的 onBeforeMount 早于子组件的 setup：视图创建时会话里已经是完整的初始样式
  onBeforeMount(() => binder.start());
  // 早于本组件的 scope.stop 和子组件卸载；卸载路径上的回调不抛错，否则后续的卸载钩子都不会执行
  onBeforeUnmount(() => disposeSafely(binder, onError));
  // 晚于子组件的 onUnmounted：先释放视图，后释放会话
  onUnmounted(() => disposeSafely(session, onError));

  return { bindStyle: bindings => binder.bind(bindings) };
}

function disposeSafely(resource: Disposable, onError: (error: unknown) => void): void {
  try {
    resource[Symbol.dispose]();
  } catch (error) {
    onError(error);
  }
}
