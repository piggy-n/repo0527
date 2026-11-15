import { useEventListener, useResizeObserver } from '@vueuse/core';
import { usePageActive } from '@mx/map-vue';
import {
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onScopeDispose,
  type PropType,
  ref,
  type SlotsType,
  type VNode,
  watch
} from 'vue';
import { layerPopoverPlacement, type PopoverPlacement } from './popover-placement';
import styles from './LayerPopover.module.scss';

// 手机宽度时盖在面板下段上：离面板左右边、当前图层标题下面这么多
const SHEET_INSET = 8;
const SHEET_TOP = 40;

/**
 * 当前图层的浮层（透明度、图例，ADR 0157）：在面板右边，箭头对着选中的行，换选中项、行换了位置、滚动列表、面板的布局和窗口变化时跟着走；
 * 手机宽度时盖在面板的下段上，没有箭头。开关由页面持有：再点入口、点关闭、按 Esc 关闭，不因为点外面关闭；
 * 面板停用时（漫游时被缓存）不响应 Esc。关闭时焦点在浮层里的，还给箭头对着的元素
 */
export const LayerPopover = defineComponent({
  name: 'LayerPopover',
  props: {
    open: { type: Boolean, default: false },
    /** 资源图层面板：浮层贴在它右边 */
    panel: { type: Function as PropType<() => HTMLElement | null>, required: true },
    /**
     * 箭头对着的元素：选中的行，所在的组收起时是组的标题（由页面给出）；关闭时焦点也还给它。
     * 在 DOM 更新以后取，它读到的响应式状态（选中、组的展开、行的顺序）变了就重新放
     */
    anchor: { type: Function as PropType<() => HTMLElement | null>, required: true },
    /** 当前图层的滚动区 */
    list: { type: Function as PropType<() => HTMLElement | null>, required: true },
    /**
     * 面板的布局（外壳给的两段高度）：拖动分割线、目录变高变矮时行挪了位置、元素不变，读到的值变了就重新放，
     * 手机宽度时等到下一帧。不监听面板和滚动区的尺寸：它们比外壳量的内容浅，会报 ResizeObserver loop（2026-11-14 审查发现）
     */
    layout: { type: Function as PropType<() => unknown>, default: () => null },
    /** 手机宽度：盖在面板下段上 */
    sheet: { type: Boolean, default: false },
    width: { type: Number, default: 300 },
    label: { type: String, required: true }
  },
  emits: {
    close: () => true
  },
  slots: Object as SlotsType<{
    header: () => VNode[];
    default: () => VNode[];
  }>,
  setup(props, { emit, slots }) {
    const element = ref<HTMLElement>();
    const content = ref<HTMLElement>();
    const placement = ref<PopoverPlacement | null>(null);
    const sheetBox = ref<{ left: number; width: number; top: number; maxHeight: number } | null>(null);
    const active = usePageActive();

    // 焦点在浮层里时（点了里面的关闭、在里面按 Esc），关掉以后还给箭头对着的元素，不落到 body
    const giveBackFocus = () => {
      if (!element.value?.contains(document.activeElement)) {
        return;
      }
      const target = props.anchor();
      void nextTick(() => {
        if (target?.isConnected) {
          target.focus();
        }
      });
    };
    watch(
      () => props.open,
      open => {
        if (!open) {
          giveBackFocus();
        }
      }
    );
    onBeforeUnmount(giveBackFocus);

    const place = () => {
      const panel = props.panel();
      const list = props.list();
      const anchor = props.anchor();
      if (!props.open || !panel || !list || !element.value) {
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (props.sheet) {
        sheetBox.value = {
          left: panelRect.left + SHEET_INSET,
          width: panelRect.width - 2 * SHEET_INSET,
          top: listRect.top - SHEET_TOP + SHEET_INSET,
          maxHeight: Math.max(0, panelRect.bottom - listRect.top + SHEET_TOP - 2 * SHEET_INSET)
        };
        return;
      }
      sheetBox.value = null;
      placement.value = layerPopoverPlacement({
        panel: panelRect,
        anchor: (anchor ?? list).getBoundingClientRect(),
        list: listRect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        // 内容本来的高度：外层的最大高度会把它截短，量里面的
        height: (content.value?.scrollHeight ?? 0) + (element.value.offsetHeight - (content.value?.clientHeight ?? 0))
      });
    };

    watch(
      () => [props.open, props.sheet, props.anchor()] as const,
      async () => {
        await nextTick();
        place();
      },
      { immediate: true, flush: 'post' }
    );
    // 外壳的布局多半是在它自己的尺寸监听回调里变的。盖在下段上时浮层的最大高度跟着变、内容跟着变高变矮，
    // 内容比外壳量的那层浅，同一轮送不到会报 ResizeObserver loop，所以等到下一帧再放；面板右边时最大高度只看视口，直接放
    let frame = 0;
    watch(
      () => props.layout(),
      async () => {
        await nextTick();
        cancelAnimationFrame(frame);
        if (props.sheet) {
          frame = requestAnimationFrame(place);
        } else {
          place();
        }
      },
      { flush: 'post' }
    );
    onScopeDispose(() => cancelAnimationFrame(frame));
    useResizeObserver(content, () => place());
    useEventListener(window, 'resize', () => place());
    // 列表、目录滚动时箭头跟着行；在捕获阶段才收得到元素自己的滚动
    useEventListener(document, 'scroll', () => place(), { capture: true, passive: true });
    useEventListener(document, 'keydown', (event: KeyboardEvent) => {
      if (props.open && active.value && event.key === 'Escape' && !event.defaultPrevented) {
        emit('close');
      }
    });

    return () => {
      if (!props.open) {
        return null;
      }
      const sheet = sheetBox.value;
      const box = placement.value;
      const style = sheet
        ? {
            left: `${sheet.left}px`,
            top: `${sheet.top}px`,
            width: `${sheet.width}px`,
            maxHeight: `${sheet.maxHeight}px`
          }
        : box
          ? {
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${props.width}px`,
              maxHeight: `${box.maxHeight}px`,
              '--arrow-top': `${box.arrowTop}px`
            }
          : { visibility: 'hidden' as const, width: `${props.width}px` };
      return (
        <div
          ref={element}
          class={[styles.popover, sheet && styles.sheet]}
          style={style}
          role="dialog"
          aria-label={props.label}
          data-layer-popover
        >
          <div class={styles.header}>{slots.header()}</div>
          <div ref={content} class={styles.body}>
            {slots.default()}
          </div>
        </div>
      );
    };
  }
});
