import { Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { ElButton, ElPopover } from 'element-plus';
import { computed, defineComponent, onScopeDispose, type PropType, ref, type SlotsType, type VNode, watch } from 'vue';
import { usePageActive } from '../../composables/usePageActive';
import { OpacitySlider } from '../OpacitySlider';
import { OpacityToggle } from '../OpacityToggle';
import styles from './MapOptionsPopover.module.scss';

/** 底图的左侧箭头浮层；选择状态仍由原有拥有者持有 */
export const MapOptionsPopover = defineComponent({
  name: 'MapOptionsPopover',
  props: {
    name: { type: String, required: true },
    label: { type: String, required: true },
    /** 当前透明度，null 表示没有可调整的底图 */
    opacity: { type: Number as PropType<number | null>, default: null },
    open: { type: Boolean, default: false },
    visible: { type: Boolean, default: true }
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    opacityChange: (value: number) => value >= 0 && value <= 1,
    /** 定位完成后的视口顶部，用于上方面板让出空间 */
    topChange: (top: number | null) => top === null || Number.isFinite(top)
  },
  slots: Object as SlotsType<{
    reference: () => VNode[];
    default: () => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    const pageActive = usePageActive();
    const shown = computed(() => props.open && props.visible && pageActive.value);
    // 每次打开只显示常用选项，透明度按需在下方展开
    const opacityOpen = ref(false);
    watch(shown, visible => {
      if (!visible) {
        opacityOpen.value = false;
        emit('topChange', null);
      }
    });
    watch(pageActive, active => {
      if (!active) {
        emit('update:open', false);
      }
    });
    // 切到无底图时收起透明度，切回后按需重新展开
    watch(() => props.opacity, opacity => {
      if (opacity === null) {
        opacityOpen.value = false;
      }
    });
    // 自己处理入口切换，忽略 Element 的外部点击、失焦和 Esc 关闭请求
    const ignoreVisibility = () => undefined;
    const toggle = () => emit('update:open', pageActive.value && !shown.value);
    // 在 Popper 写完位置后报告顶部；选项保持同一对象避免更新循环
    const popperOptions = {
      modifiers: [
        { name: 'preventOverflow', options: { padding: 12, altAxis: true, tether: false } },
        {
          name: 'reportTop',
          enabled: true,
          phase: 'afterWrite' as const,
          fn: ({ state }: { state: { elements: { popper: HTMLElement } } }) => {
            if (shown.value) {
              emit('topChange', state.elements.popper.getBoundingClientRect().top);
            }
          }
        }
      ]
    };
    onScopeDispose(() => emit('topChange', null));

    return () => (
      <ElPopover
        trigger="click"
        triggerKeys={[]}
        placement="left"
        fallbackPlacements={['left-start', 'left-end']}
        strategy="fixed"
        width={320}
        offset={12}
        showArrow
        tabindex={-1}
        persistent={false}
        popperStyle={{ padding: 0, maxWidth: 'calc(100vw - 112px)' }}
        popperOptions={popperOptions}
        visible={shown.value}
        onUpdate:visible={ignoreVisibility}>
        {{
          reference: () => <span class={styles.reference} onClick={toggle}>{slots.reference()}</span>,
          default: () => (
            <div ref={element} class={styles.content} data-map-options={props.name}>
              <div class={styles.controls}>
                {props.opacity !== null && (
                  <OpacityToggle
                    label={props.label}
                    open={opacityOpen.value}
                    onUpdate:open={open => (opacityOpen.value = open)}
                  />
                )}
                <ElButton
                  class={styles.close}
                  link
                  icon={Close}
                  aria-label={`关闭${props.label}`}
                  onClick={() => emit('update:open', false)}
                />
              </div>
              <div class={styles.body}>
                {slots.default()}
                {opacityOpen.value && props.opacity !== null && (
                  <OpacitySlider
                    value={props.opacity}
                    label={`${props.label}的透明度`}
                    onChange={value => emit('opacityChange', value)}
                  />
                )}
              </div>
            </div>
          )
        }}
      </ElPopover>
    );
  }
});
