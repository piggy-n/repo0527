import { Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElTooltip } from 'element-plus';
import { defineComponent, type PropType, ref, type SlotsType, type VNode, watch } from 'vue';
import { usePageActive } from '../../composables/usePageActive';
import { revealScrollLeft } from './panel-group';
import type { PanelGroup } from './usePanelGroup';
import styles from './MapPanelGroup.module.scss';

/** 每个功能的内容插槽拿到的参数 */
export interface PanelSlotProps {
  /** 正在显示：隐藏（切到别的 Tab、窄屏时让给另一边、所在页面被缓存）时为 false，内容据此结束临时的交互（ADR 0053 第 4 节、ADR 0063） */
  readonly active: boolean;
}

/**
 * 一组 Tab 面板的外壳（ADR 0053 第 4 节）：头部是已打开功能的 Tab，同一时间只显示一个内容。
 * 打开期间内容一直挂载，切走时只隐藏；关闭时卸载。外壳代表整组登记为贴右边的悬浮元素，隐藏时不算。
 * Tab 放不下时（手机宽度时三个功能）在自己的区域里横向滚动，当前的 Tab 连同关闭按钮滚进可见范围
 */
export const MapPanelGroup = defineComponent({
  name: 'MapPanelGroup',
  props: {
    group: { type: Object as PropType<PanelGroup>, required: true },
    /** 每个功能的 Tab 名称 */
    labels: { type: Object as PropType<Readonly<Record<string, string>>>, required: true },
    /** 窄屏时让给另一边就是 false；打开的功能保留 */
    visible: { type: Boolean, default: true }
  },
  emits: {
    /** Tab 上的关闭按钮：外壳已经从组里关掉它，页面需要时做连带的事（如关闭资源详情时清除选择） */
    close: (id: string) => typeof id === 'string'
  },
  slots: Object as SlotsType<Record<string, (props: PanelSlotProps) => VNode[]>>,
  setup(props, { emit, slots }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    // 页面被缓存、切到别的页面期间按隐藏处理：取色预览、拾取这类临时交互由内容按 active 结束
    const pageActive = usePageActive();

    // 切换、前移 Tab 或重新显示整组时，把当前 Tab 滚进可见范围；隐藏时不量尺寸
    const tabs = ref<HTMLElement>();
    watch(
      [() => props.group.state.value.current, () => props.group.state.value.open, () => props.visible],
      () => {
        const list = tabs.value;
        const current = list?.querySelector('[aria-selected="true"]')?.parentElement;
        if (list && current) {
          list.scrollLeft = revealScrollLeft(
            list.scrollLeft,
            list.getBoundingClientRect(),
            current.getBoundingClientRect()
          );
        }
      },
      { flush: 'post' }
    );

    const close = (id: string) => {
      props.group.close(id);
      emit('close', id);
    };
    // 先清空整组，再逐项通知页面执行资源详情等功能的关闭副作用
    const closeAll = () => {
      const opened = props.group.state.value.open;
      props.group.closeAll();
      for (const id of opened) {
        emit('close', id);
      }
    };

    const renderTab = (id: string, current: boolean) => {
      const label = props.labels[id] ?? id;
      return (
        <div key={id} class={[styles.tab, current && styles.current]}>
          <button
            type="button"
            role="tab"
            class={styles.label}
            aria-selected={current}
            onClick={() => props.group.select(id)}>
            {label}
          </button>
          <ElButton link size="small" icon={Close} aria-label={`关闭${label}`} onClick={() => close(id)} />
        </div>
      );
    };

    return () => {
      const { open, current } = props.group.state.value;
      const shown = props.visible && open.length > 0;
      return (
        <div ref={element} class={styles.group} style={shown ? undefined : { display: 'none' }} data-panel-group>
          {open.length > 0 && (
            <MxPanel floating class={styles.shell}>
              {{
                header: () => (
                  <div ref={tabs} class={styles.tabs} role="tablist">
                    {open.map(id => renderTab(id, id === current))}
                  </div>
                ),
                actions: () => (
                  <ElTooltip content="关闭全部功能" placement="left">
                    <ElButton
                      class={styles.closeAll}
                      link
                      icon={Close}
                      aria-label="关闭全部功能"
                      onClick={closeAll}
                    />
                  </ElTooltip>
                ),
                default: () =>
                  open.map(id => (
                    <div
                      key={id}
                      role="tabpanel"
                      aria-label={props.labels[id] ?? id}
                      class={styles.content}
                      style={id === current ? undefined : { display: 'none' }}
                      data-panel={id}>
                      {slots[id]?.({ active: shown && pageActive.value && id === current })}
                    </div>
                  ))
              }}
            </MxPanel>
          )}
        </div>
      );
    };
  }
});
