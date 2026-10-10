import { BROWSE_TOOL, MapSession, type MapSessionOptions, type MapTool } from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';
import { getCurrentInstance, onBeforeMount, onBeforeUnmount, onUnmounted, provide } from 'vue';
import { INTERNAL_MAP_CONTEXT, type MapContext, MapContextState } from './context';
import { type OverlayOptions, resolveOverlayOptions } from './overlay';
import { StyleBinder, type StyleDerivation } from './style-binder';

export interface ProvideMapOptions<G extends string> extends MapSessionOptions<G> {
  /** 样式提交失败、视图运行中的错误；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
  /** 定位避开悬浮元素时的边距、间隔和可视区域的下限（ADR 0029） */
  readonly overlay?: OverlayOptions;
}

/** 页面句柄：只交给调用 provideMap 的页面；除了绑定样式，也包含子孙组件通过 useMap 拿到的只读上下文 */
export interface MapHandle<G extends string> extends MapContext {
  /** 把推导函数绑定到分组；只能在同一个组件的 setup 中调用，一个分组只能绑定一次 */
  bindStyle(bindings: Partial<Readonly<Record<G, StyleDerivation>>>): void;
  /** 登记交互工具（ADR 0034）；只能在同一个组件的 setup 中调用，同一个 ID 只能登记一次，browse 是内置的移动 */
  registerTools(tools: Readonly<Record<string, MapTool>>): void;
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
  // 统一的上报入口：外部的报告器抛错时不能打断提交、状态转换和卸载，map-vue 内部都经由它上报
  const onError = safeReporter(options.onError ?? reportToConsole, 'map-vue');
  const overlayOptions = resolveOverlayOptions(options.overlay);
  const session = new MapSession(options);
  const binder = new StyleBinder(session.style, onError);
  const state = new MapContextState(session, onError, overlayOptions);
  provide(INTERNAL_MAP_CONTEXT, state);

  // 和样式绑定一样只在 setup 里登记，挂载前关闭
  let registering = true;
  const registerTools = (tools: Readonly<Record<string, MapTool>>) => {
    if (!registering) {
      throw new Error('工具只能在 provideMap 所在组件的 setup 中登记');
    }
    const entries = Object.entries(tools);
    // 先全部检查再登记：有一个不合法时这一次都不登记
    for (const [id] of entries) {
      if (id === BROWSE_TOOL) {
        throw new Error(`工具 ID ${BROWSE_TOOL} 是内置的移动，不能登记`);
      }
      if (session.tool.has(id)) {
        throw new Error(`工具 ${id} 已经登记`);
      }
    }
    for (const [id, tool] of entries) {
      session.tool.register(id, tool);
    }
  };

  // 父组件的 onBeforeMount 早于子组件的 setup：视图创建时会话里已经是完整的初始样式
  onBeforeMount(() => {
    registering = false;
    binder.start();
  });
  // 早于本组件的 scope.stop 和子组件卸载；卸载路径上的回调不抛错，否则后续的卸载钩子都不会执行
  onBeforeUnmount(() => disposeSafely(binder, onError));
  // 晚于子组件的 onUnmounted：画布已经释放了视图，再结束等待者、释放会话
  onUnmounted(() => {
    disposeSafely(state, onError);
    disposeSafely(session, onError);
  });

  const handle: MapHandle<G> = { ...state.context, bindStyle: bindings => binder.bind(bindings), registerTools };
  return Object.freeze(handle);
}

function disposeSafely(resource: Disposable, onError: (error: unknown) => void): void {
  try {
    resource[Symbol.dispose]();
  } catch (error) {
    onError(error);
  }
}
