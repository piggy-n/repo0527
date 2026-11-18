import { computed, defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import chartStyles from '@/shared/dashboard/charts/charts.module.scss';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { LandSpacePart } from '../data/land-space-data';
import styles from './PartTabs.module.scss';

/** 分项在滚动区内容里的起止位置 */
export interface TabExtent {
  readonly start: number;
  readonly end: number;
}

// 滚动区边缘切到半个分项；容差半个像素，scrollLeft 可能带小数
function cutAt(tabs: readonly TabExtent[], edge: number): boolean {
  return tabs.some(tab => tab.start < edge - 0.5 && tab.end > edge + 0.5);
}

/** 选中项完整露出、移动方向那一侧的边缘不切到半个分项时的 scrollLeft；direction 是选中项移动的方向，0 表示不知道 */
export function revealScrollLeft(
  tabs: readonly TabExtent[],
  index: number,
  scrollLeft: number,
  viewWidth: number,
  direction: number
): number {
  const tab = tabs[index];
  if (!tab) {
    return scrollLeft;
  }
  const hidden = tab.start < scrollLeft - 0.5 || tab.end > scrollLeft + viewWidth + 0.5;
  const leftward = direction < 0 || (direction === 0 && tab.start < scrollLeft);
  const rightward = direction > 0 || (direction === 0 && !leftward);
  const towardCut = (leftward && cutAt(tabs, scrollLeft)) || (rightward && cutAt(tabs, scrollLeft + viewWidth));
  if (!hidden && !towardCut) {
    return scrollLeft;
  }
  // 要滚时，移动方向那一侧对齐到整个分项，并尽量多放下那一侧的分项
  if (leftward) {
    const first = tabs.slice(0, index + 1).find(item => tab.end - item.start <= viewWidth);
    return first?.start ?? tab.start;
  }
  const last = tabs.slice(index).findLast(item => item.end - tab.start <= viewWidth);
  return Math.max(0, (last?.end ?? tab.end) - viewWidth);
}

const KEY_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };

/** 三级的分项切换栏：第一项「综合」，横向滚动，左右按钮和方向键逐项切换；少于两个分项时不显示 */
export const PartTabs = defineComponent({
  name: 'LandSpacePartTabs',
  props: {
    parts: { type: Array as PropType<readonly LandSpacePart[]>, required: true },
    /** null 是「综合」 */
    selected: { type: String as PropType<string | null>, default: null },
    /** 分项栏的读屏名称 */
    label: { type: String, required: true },
    reducedMotion: { type: Boolean, default: false }
  },
  emits: {
    select: (_id: string | null) => true
  },
  setup(props, { emit }) {
    const scroller = ref<HTMLElement>();
    const options = computed(() => [{ id: null, name: '综合' }, ...props.parts]);
    const index = computed(() => Math.max(0, options.value.findIndex(option => option.id === props.selected)));

    function selectedTab(): HTMLElement | null | undefined {
      return scroller.value?.querySelector<HTMLElement>('[aria-selected="true"]');
    }

    // 选中项滚进视野，只滚分项栏自己，不带动外层的列表；offsetLeft 相对滚动区（它是定位容器）
    function reveal(direction: number): void {
      const view = scroller.value;
      if (!view) {
        return;
      }
      const tabs = [...view.querySelectorAll<HTMLElement>('[role="tab"]')].map(tab => ({
        start: tab.offsetLeft,
        end: tab.offsetLeft + tab.offsetWidth
      }));
      const left = revealScrollLeft(tabs, index.value, view.scrollLeft, view.clientWidth, direction);
      if (Math.abs(left - view.scrollLeft) > 0.5) {
        view.scrollTo({ left, behavior: props.reducedMotion ? 'auto' : 'smooth' });
      }
    }

    const optionIndex = (id: string | null) => options.value.findIndex(option => option.id === id);
    watch(
      () => props.selected,
      (selected, previous) => reveal(Math.sign(optionIndex(selected) - optionIndex(previous))),
      { flush: 'post' }
    );
    watch(() => props.parts, () => reveal(0), { flush: 'post' });

    // 按到头的按钮会停用、丢掉焦点，焦点交给选中的分项，键盘用户接着从分项栏往下走；
    // 交焦点不让浏览器自己滚，否则会打断 reveal 的平滑滚动，停在选中项露不全的位置
    async function step(delta: number, event: MouseEvent): Promise<void> {
      const next = options.value[index.value + delta];
      if (!next) {
        return;
      }
      const button = event.currentTarget;
      const hadFocus = button instanceof HTMLButtonElement && document.activeElement === button;
      emit('select', next.id);
      await nextTick();
      if (hadFocus && button.disabled) {
        selectedTab()?.focus({ preventScroll: true });
      }
    }

    // 方向键切换后焦点跟着选中项
    async function onKeydown(event: KeyboardEvent): Promise<void> {
      let target: number | undefined;
      if (event.key in KEY_STEPS) {
        target = index.value + KEY_STEPS[event.key];
      } else if (event.key === 'Home') {
        target = 0;
      } else if (event.key === 'End') {
        target = options.value.length - 1;
      }
      const next = target === undefined ? undefined : options.value[target];
      if (!next) {
        return;
      }
      event.preventDefault();
      emit('select', next.id);
      await nextTick();
      selectedTab()?.focus({ preventScroll: true });
    }

    return () => {
      if (props.parts.length < 2) {
        return null;
      }
      const current = index.value;
      return (
        <div class={styles.parts}>
          <button
            type="button"
            class={[chartStyles.iconButton, styles.step]}
            aria-label="上一个分项"
            title="上一个分项"
            disabled={current <= 0}
            onClick={(event: MouseEvent) => void step(-1, event)}
          >
            <SvgIcon name="dashboard-chevron" rotate={180} />
          </button>
          <div
            ref={scroller}
            class={styles.scroller}
            role="tablist"
            aria-label={props.label}
            onKeydown={event => void onKeydown(event)}
          >
            {options.value.map((option, position) => (
              <button
                key={option.id ?? ''}
                type="button"
                role="tab"
                class={styles.tab}
                aria-selected={position === current}
                tabindex={position === current ? 0 : -1}
                onClick={() => emit('select', option.id)}
              >
                {option.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            class={[chartStyles.iconButton, styles.step]}
            aria-label="下一个分项"
            title="下一个分项"
            disabled={current >= options.value.length - 1}
            onClick={(event: MouseEvent) => void step(1, event)}
          >
            <SvgIcon name="dashboard-chevron" />
          </button>
        </div>
      );
    };
  }
});
