import { Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElPopover, ElTooltip } from 'element-plus';
import { computed, defineComponent, ref, type SlotsType, type VNode, watch } from 'vue';
import { usePageActive } from '../../composables/usePageActive';
import { SvgIcon } from '../../icons/SvgIcon';
import styles from './MapOptionsPopover.module.scss';

/** 底图、行政区共用的左侧箭头浮层；选择状态仍由原有拥有者持有 */
export const MapOptionsPopover = defineComponent({
  name: 'MapOptionsPopover',
  props: {
    name: { type: String, required: true },
    label: { type: String, required: true },
    open: { type: Boolean, default: false },
    visible: { type: Boolean, default: true }
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean'
  },
  slots: Object as SlotsType<{
    reference: () => VNode[];
    default: (props: { showOpacity: boolean }) => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    const pageActive = usePageActive();
    const shown = computed(() => props.open && props.visible && pageActive.value);
    // 每次打开只显示常用选项，透明度通过头部图标展开
    const opacityOpen = ref(false);
    watch(shown, visible => {
      if (!visible) {
        opacityOpen.value = false;
      }
    });
    watch(pageActive, active => {
      if (!active) {
        emit('update:open', false);
      }
    });
    // 只接受 Popover 的打开请求，外部点击、Esc 和入口再次点击不能关闭
    const openPopover = (open: boolean) => {
      if (open && pageActive.value) {
        emit('update:open', true);
      }
    };

    return () => (
      <ElPopover
        trigger="click"
        placement="left"
        fallbackPlacements={['left-start', 'left-end']}
        strategy="fixed"
        width={320}
        offset={12}
        showArrow
        tabindex={-1}
        persistent={false}
        popperStyle={{ padding: 0, maxWidth: 'calc(100vw - 112px)' }}
        popperOptions={{
          modifiers: [{ name: 'preventOverflow', options: { padding: 12, altAxis: true, tether: false } }]
        }}
        visible={shown.value}
        onUpdate:visible={openPopover}>
        {{
          reference: () => <span class={styles.reference}>{slots.reference()}</span>,
          default: () => (
            <div ref={element} class={styles.content} data-map-options={props.name}>
              <div class={styles.header}>
                <MxTitle level="section">{props.label}</MxTitle>
                <ElTooltip content="调整透明度" placement="top">
                  <button
                    type="button"
                    class={[styles.opacity, opacityOpen.value && styles.opacityOpen]}
                    aria-label={`调整${props.label}透明度`}
                    aria-expanded={opacityOpen.value}
                    aria-pressed={opacityOpen.value}
                    onClick={() => (opacityOpen.value = !opacityOpen.value)}>
                    <SvgIcon name="layer-opacity" size={16} />
                  </button>
                </ElTooltip>
                <ElButton link icon={Close} aria-label={`关闭${props.label}`} onClick={() => emit('update:open', false)} />
              </div>
              <div class={styles.body}>{slots.default({ showOpacity: opacityOpen.value })}</div>
            </div>
          )
        }}
      </ElPopover>
    );
  }
});
