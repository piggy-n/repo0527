import { computed, defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import chartStyles from '@/shared/dashboard/charts/charts.module.scss';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { LandSpacePart } from '../data/land-space-data';
import styles from './PartTabs.module.scss';

// 选中项离滚动区边缘留出的距离，看得出前后还有分项
const EDGE = 12;

/** 让 [start, start + width] 完整出现在滚动区里的 scrollLeft；已经在里面时不动 */
export function revealScrollLeft(scrollLeft: number, viewWidth: number, start: number, width: number): number {
  if (start - EDGE < scrollLeft) {
    return Math.max(0, start - EDGE);
  }
  if (start + width + EDGE > scrollLeft + viewWidth) {
    return start + width + EDGE - viewWidth;
  }
  return scrollLeft;
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

    // 选中项滚进视野，只滚分项栏自己，不带动外层的列表
    function reveal(): void {
      const view = scroller.value;
      const tab = selectedTab();
      if (!view || !tab) {
        return;
      }
      const left = revealScrollLeft(view.scrollLeft, view.clientWidth, tab.offsetLeft, tab.offsetWidth);
      if (left !== view.scrollLeft) {
        view.scrollTo({ left, behavior: props.reducedMotion ? 'auto' : 'smooth' });
      }
    }

    watch([() => props.selected, () => props.parts], reveal, { flush: 'post' });

    // 按到头的按钮会停用、丢掉焦点，焦点交给选中的分项，键盘用户接着从分项栏往下走
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
        selectedTab()?.focus();
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
      selectedTab()?.focus();
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
