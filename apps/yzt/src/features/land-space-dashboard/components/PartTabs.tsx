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

// 边缘切出的半个分项露出不到这么宽时只是一条边，看不出字
const SLIVER = 24;

// 位置的容差半个像素：分项的位置取整数的 offsetLeft、offsetWidth，scrollLeft 在缩放的屏幕上可能带小数
function inside(tab: TabExtent, left: number, viewWidth: number): boolean {
  return tab.start >= left - 0.5 && tab.end <= left + viewWidth + 0.5;
}

// 滚动区的这条边缘切到的分项露出的宽度，没切到时为 0
function cutWidth(tabs: readonly TabExtent[], edge: number, side: 'left' | 'right'): number {
  const tab = tabs.find(item => item.start < edge - 0.5 && item.end > edge + 0.5);
  if (!tab) {
    return 0;
  }
  return side === 'left' ? tab.end - edge : edge - tab.start;
}

/** 切换后滚动区的 scrollLeft，规则见 docs/modules/land-space-dashboard.md 的分项栏；direction 是选中项移动的方向，0 表示不知道 */
export function revealScrollLeft(
  tabs: readonly TabExtent[],
  index: number,
  scrollLeft: number,
  viewWidth: number,
  direction: number
): number {
  const tab = tabs[index];
  const last = tabs.at(-1);
  if (!tab || !last) {
    return scrollLeft;
  }
  const clamp = (left: number) => Math.min(Math.max(0, last.end - viewWidth), Math.max(0, left));
  const leftward = direction < 0 || (direction === 0 && tab.start < scrollLeft);
  // 选中项本身放不下时对齐它靠移动方向的那一端
  if (tab.end - tab.start > viewWidth) {
    return clamp(leftward ? tab.start : tab.end - viewWidth);
  }
  // 移动方向那一侧的分项
  const ahead = leftward ? tabs.slice(0, index) : tabs.slice(index + 1);
  // 候选：不动、选中项居中、每个分项贴左边或贴右边；居中的那个总能放下选中项
  const centered = clamp(Math.round((tab.start + tab.end - viewWidth) / 2));
  const candidates = [scrollLeft, centered, ...tabs.flatMap(item => [item.start, item.end - viewWidth])]
    .map(clamp)
    .filter(left => inside(tab, left, viewWidth))
    .map(left => {
      const atLeft = cutWidth(tabs, left, 'left');
      const atRight = cutWidth(tabs, left + viewWidth, 'right');
      return {
        left,
        // 最窄的窄条比 SLIVER 窄多少，没有窄条时为 0
        sliver: SLIVER - Math.min(SLIVER, ...[atLeft, atRight].filter(cut => cut > 0)),
        towardCut: (leftward ? atLeft : atRight) > 0,
        shown: ahead.filter(item => inside(item, left, viewWidth)).length,
        moved: Math.abs(left - scrollLeft)
      };
    });
  // 依次比较：窄条、移动方向那一侧切没切到分项、那一侧完整放下几个、滚多远
  candidates.sort((a, b) =>
    a.sliver - b.sliver ||
    Number(a.towardCut) - Number(b.towardCut) ||
    b.shown - a.shown ||
    a.moved - b.moved
  );
  return candidates[0]?.left ?? centered;
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

    // 平滑滚动的终点：滚动停下前按终点判断，否则途中再切换会按半路的位置算，滚动接着走到旧终点、切掉选中项
    let scrollTarget: number | undefined;

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
      const from = scrollTarget ?? view.scrollLeft;
      const left = revealScrollLeft(tabs, index.value, from, view.clientWidth, direction);
      if (Math.abs(left - from) > 0.5) {
        scrollTarget = props.reducedMotion ? undefined : left;
        view.scrollTo({ left, behavior: props.reducedMotion ? 'auto' : 'smooth' });
      }
    }

    // 滚到终点时不再有终点；scrollend 还管被拖动、滚轮打断的平滑滚动
    function onScroll(): void {
      const view = scroller.value;
      if (view && scrollTarget !== undefined && Math.abs(view.scrollLeft - scrollTarget) < 1) {
        scrollTarget = undefined;
      }
    }

    function onScrollend(): void {
      scrollTarget = undefined;
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
            onScroll={onScroll}
            onScrollend={onScrollend}
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
