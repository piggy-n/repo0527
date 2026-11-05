import { useMapOverlay, usePageActive } from '@mx/map-vue';
import { useResizeObserver } from '@vueuse/core';
import { ElPopover } from 'element-plus';
import {
  computed,
  defineComponent,
  nextTick,
  onScopeDispose,
  type PropType,
  ref,
  type SlotsType,
  type VNode,
  watch
} from 'vue';
import { useLightDismiss } from './useLightDismiss';
import styles from './MapOptionsPopover.module.scss';

// 打开和关闭都自己处理，忽略 Element 的显隐请求
const ignoreVisibility = () => undefined;

/** 交给浮层内容的操作 */
export interface MapOptionsContext {
  /** 浮层正在显示；不显示时内容结束自己的临时交互 */
  readonly active: boolean;
  /** 关闭浮层，焦点回到入口：内容里的操作做完时调用（如选了底图） */
  readonly close: () => void;
}

/**
 * 底图、行政区边界的左侧箭头浮层（ADR 0146）：没有操作栏，内容撑高；再点入口、单击外部、按 Esc 关闭。
 * 开关由页面持有，选择状态仍由原有拥有者持有
 */
export const MapOptionsPopover = defineComponent({
  name: 'MapOptionsPopover',
  props: {
    name: { type: String, required: true },
    open: { type: Boolean, default: false },
    visible: { type: Boolean, default: true },
    /** 默认和入口垂直居中；left-end 底边和入口对齐、向上展开，给下方的底图浮层让位 */
    placement: { type: String as PropType<'left' | 'left-end'>, default: 'left' }
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** 定位完成后的视口顶部，用于上方面板让出空间 */
    topChange: (top: number | null) => top === null || Number.isFinite(top)
  },
  slots: Object as SlotsType<{
    reference: () => VNode[];
    default: (context: MapOptionsContext) => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const popover = ref<InstanceType<typeof ElPopover>>();
    const element = ref<HTMLElement>();
    const reference = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    // Element 只在 visible 变化时监听内容的尺寸；persistent 为 false 时内容挂载时已经可见，监听不会开始，内容变高后要自己定位
    useResizeObserver(element, () => void popover.value?.popperRef?.popperInstanceRef?.update());
    const pageActive = usePageActive();
    const shown = computed(() => props.open && props.visible && pageActive.value);
    watch(shown, visible => {
      if (!visible) {
        emit('topChange', null);
      }
    });
    watch(pageActive, active => {
      if (!active) {
        emit('update:open', false);
      }
    });
    const toggle = () => emit('update:open', pageActive.value && !shown.value);
    const close = () => {
      emit('update:open', false);
      reference.value?.querySelector('button')?.focus({ preventScroll: true });
    };
    useLightDismiss({
      active: () => shown.value,
      // 箭头和边框也算浮层：它们在内容外面、在 Element 的弹出层里面
      contains: target =>
        reference.value?.contains(target) === true || element.value?.closest('.el-popper')?.contains(target) === true,
      onOutside: () => emit('update:open', false),
      onEscape: close
    });
    // Popper 算完位置后报告顶部：Element 的位置要等 Vue 渲染才写进 DOM，这时量到的还是旧的，等这一轮之后再量；选项保持同一对象避免更新循环
    const popperOptions = {
      modifiers: [
        { name: 'preventOverflow', options: { padding: 12, altAxis: true, tether: false } },
        {
          name: 'reportTop',
          enabled: true,
          phase: 'afterWrite' as const,
          fn: ({ state }: { state: { elements: { popper: HTMLElement } } }) => {
            void nextTick(() => {
              if (shown.value) {
                emit('topChange', state.elements.popper.getBoundingClientRect().top);
              }
            });
          }
        }
      ]
    };
    onScopeDispose(() => emit('topChange', null));

    return () => (
      <ElPopover
        ref={popover}
        trigger="click"
        triggerKeys={[]}
        placement={props.placement}
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
        onUpdate:visible={ignoreVisibility}
      >
        {{
          reference: () => <span ref={reference} class={styles.reference} onClick={toggle}>{slots.reference()}</span>,
          default: () => (
            <div ref={element} class={styles.content} data-map-options={props.name}>
              {slots.default({ active: shown.value, close })}
            </div>
          )
        }}
      </ElPopover>
    );
  }
});
