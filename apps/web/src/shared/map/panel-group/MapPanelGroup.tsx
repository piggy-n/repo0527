import { Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType, ref, type SlotsType, type VNode } from 'vue';
import type { PanelGroup } from './usePanelGroup';
import styles from './MapPanelGroup.module.scss';

/** 每个功能的内容插槽拿到的参数 */
export interface PanelSlotProps {
  /** 正在显示：隐藏（切到别的 Tab、窄屏时让给另一边）时为 false，内容据此结束临时的交互（ADR 0053 第 4 节） */
  readonly active: boolean;
}

/**
 * 一组 Tab 面板的外壳（ADR 0053 第 4 节）：头部是已打开功能的 Tab，同一时间只显示一个内容。
 * 打开期间内容一直挂载，切走时只隐藏；关闭时卸载。外壳代表整组登记为贴右边的悬浮元素，隐藏时不算
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

    const close = (id: string) => {
      props.group.close(id);
      emit('close', id);
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
            onClick={() => props.group.show(id)}>
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
                  <div class={styles.tabs} role="tablist">
                    {open.map(id => renderTab(id, id === current))}
                  </div>
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
                      {slots[id]?.({ active: shown && id === current })}
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
