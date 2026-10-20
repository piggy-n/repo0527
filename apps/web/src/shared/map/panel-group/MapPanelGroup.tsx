import { ArrowDown, ArrowUp, Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType, ref, type SlotsType, type VNode } from 'vue';
import { usePageActive } from '../../composables/usePageActive';
import type { PanelGroup } from './usePanelGroup';
import styles from './MapPanelGroup.module.scss';

/** 每个功能的内容插槽拿到的参数 */
export interface PanelSlotProps {
  /** 正在显示：隐藏（切到别的 Tab、窄屏时让给另一边、所在页面被缓存）时为 false，内容据此结束临时的交互（ADR 0053 第 4 节、ADR 0063） */
  readonly active: boolean;
}

/**
 * 一组 Tab 面板的外壳：单功能直接显示名称，多功能在标准标题下显示两列标签，同一时间只显示一个内容。
 * 打开期间内容一直挂载，切走时只隐藏；关闭时卸载。外壳代表整组登记为贴右边的悬浮元素，隐藏时不算。
 * 标题和标签固定在内容滚动区外，收起时只保留标题行
 */
export const MapPanelGroup = defineComponent({
  name: 'MapPanelGroup',
  props: {
    group: { type: Object as PropType<PanelGroup>, required: true },
    /** 每个功能的 Tab 名称 */
    labels: { type: Object as PropType<Readonly<Record<string, string>>>, required: true },
    /** 窄屏时让给另一边就是 false；打开的功能保留 */
    visible: { type: Boolean, default: true },
    /** 同列详情需要空间时只保留标题行，功能状态不清空 */
    collapsed: { type: Boolean, default: false },
    collapsible: { type: Boolean, default: false }
  },
  emits: {
    /** Tab 上的关闭按钮：外壳已经从组里关掉它，页面按需处理关闭副作用 */
    close: (id: string) => typeof id === 'string',
    activate: () => true,
    'update:collapsed': (value: boolean) => typeof value === 'boolean'
  },
  slots: Object as SlotsType<Record<string, (props: PanelSlotProps) => VNode[]>>,
  setup(props, { emit, slots }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    // 页面被缓存、切到别的页面期间按隐藏处理：取色预览、拾取这类临时交互由内容按 active 结束
    const pageActive = usePageActive();

    const close = (id: string) => {
      props.group.close(id);
      emit('close', id);
    };
    // 先清空整组，再逐项通知页面处理关闭
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
            onClick={() => {
              props.group.select(id);
              emit('activate');
              emit('update:collapsed', false);
            }}>
            <span class={styles.mark} aria-hidden="true" />
            {label}
          </button>
          <ElButton
            class={styles.closeTab}
            link
            size="small"
            icon={Close}
            aria-label={`关闭${label}`}
            onClick={() => close(id)}
          />
        </div>
      );
    };

    return () => {
      const { open, current } = props.group.state.value;
      const shown = props.visible && open.length > 0;
      // 单功能省去标签区，数量变化只调整标题布局，保留内容与交互状态
      const title = open.length === 1 && current !== null ? (props.labels[current] ?? current) : '地图工具';
      return (
        <div
          ref={element}
          class={[styles.group, props.collapsed && styles.collapsed]}
          style={shown ? undefined : { display: 'none' }}
          data-panel-group
          onPointerdown={() => !props.collapsed && emit('activate')}>
          {open.length > 0 && (
            <MxPanel floating flush={props.collapsed} class={styles.shell}>
              {{
                header: () => (
                  <div class={styles.heading}>
                    <div class={styles.titleRow}>
                      <MxTitle level="panel">{title}</MxTitle>
                      <div class={styles.controls}>
                        {props.collapsible && (
                          <ElButton
                            link
                            icon={props.collapsed ? ArrowDown : ArrowUp}
                            aria-label={props.collapsed ? '展开功能面板' : '收起功能面板'}
                            aria-expanded={!props.collapsed}
                            onClick={() => emit('update:collapsed', !props.collapsed)}
                          />
                        )}
                        <ElButton
                          link
                          icon={Close}
                          aria-label={open.length === 1 ? `关闭${title}` : '关闭全部功能'}
                          onClick={closeAll}
                        />
                      </div>
                    </div>
                    {!props.collapsed && open.length > 1 && (
                      <div class={styles.tabs} role="tablist" aria-label="已打开的地图工具">
                        {open.map(id => renderTab(id, id === current))}
                      </div>
                    )}
                  </div>
                ),
                default: () =>
                  open.map(id => (
                    <div
                      key={id}
                      role="tabpanel"
                      aria-label={props.labels[id] ?? id}
                      class={styles.content}
                      style={!props.collapsed && id === current ? undefined : { display: 'none' }}
                      data-panel={id}>
                      {slots[id]?.({ active: shown && !props.collapsed && pageActive.value && id === current })}
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
