import { useMediaQuery, useResizeObserver } from '@vueuse/core';
import { ElDrawer } from 'element-plus';
import {
  computed,
  defineComponent,
  type PropType,
  provide,
  ref,
  type SlotsType,
  Teleport,
  type VNode,
  watch
} from 'vue';
import { COMPACT_MEDIA_QUERY } from '../breakpoints';
import { asideRegionKey, splitLayoutKey } from './context';
import styles from './MxSplitLayout.module.scss';
import { captureScrollPositions, isDisplayed, restoreScrollPositions, type ScrollPositions } from './scroll-positions';

export type SplitLayoutAsideType = 'menu' | 'panel';

// 侧栏宽度只有两档（docs/design/page-layout.md），抽屉宽度相同
const ASIDE_WIDTHS: Record<SplitLayoutAsideType, number> = { menu: 200, panel: 320 };

// 标记侧栏内容，其中的面板据此在抽屉里去掉圆角阴影、加关闭按钮
const AsideRegion = defineComponent({
  name: 'MxSplitLayoutAside',
  setup(_, { slots }) {
    provide(asideRegionKey, true);
    return () => slots.default?.();
  }
});

/** 分栏布局：侧栏加主区，四周统一间距；窄屏时侧栏收进抽屉，内容移动而不重建（docs/modules/ui.md） */
export const MxSplitLayout = defineComponent({
  name: 'MxSplitLayout',
  props: {
    asideType: { type: String as PropType<SplitLayoutAsideType>, default: 'panel' },
    asideLabel: { type: String, required: true }
  },
  slots: Object as SlotsType<{
    default?: () => VNode[];
    aside?: () => VNode[];
  }>,
  setup(props, { slots }) {
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const asideOpen = ref(false);
    const asideContent = ref<HTMLElement>();
    const drawerTarget = ref<HTMLElement>();
    // 抽屉第一次打开前不渲染内容区，没有目标元素，侧栏内容先留在隐藏的侧栏里
    const inDrawer = computed(() => compact.value && drawerTarget.value !== undefined);

    const openAside = () => {
      asideOpen.value = true;
    };
    const closeAside = () => {
      asideOpen.value = false;
    };
    provide(splitLayoutKey, {
      compact,
      asideOpen: computed(() => asideOpen.value),
      asideLabel: computed(() => props.asideLabel),
      openAside,
      closeAside
    });

    watch(compact, value => {
      if (!value) {
        closeAside();
      }
    });

    // 内容即将被隐藏或移动前记下滚动位置（隐藏后就读不到了），在新位置显示出来后写回
    let saved: ScrollPositions | undefined;
    const restoreIfDisplayed = () => {
      if (saved && asideContent.value && isDisplayed(asideContent.value)) {
        restoreScrollPositions(saved);
        saved = undefined;
      }
    };
    const changes = [compact, asideOpen, inDrawer];
    watch(
      changes,
      () => {
        if (asideContent.value && isDisplayed(asideContent.value)) {
          saved = captureScrollPositions(asideContent.value);
        }
      },
      { flush: 'pre' }
    );
    // 内容从隐藏变为显示、或移到尺寸不同的容器时触发，在绘制前写回；抽屉何时显示由 Element 决定，比本组件的更新晚
    useResizeObserver(asideContent, restoreIfDisplayed);
    // 移到尺寸相同的容器时 ResizeObserver 不触发，在本组件更新后再检查一次
    watch(changes, restoreIfDisplayed, { flush: 'post' });

    return () => {
      const width = ASIDE_WIDTHS[props.asideType];
      return (
        <div class={styles.root}>
          <aside class={[styles.aside, compact.value && styles.hidden]} style={{ width: `${width}px` }}>
            <Teleport to={drawerTarget.value} disabled={!inDrawer.value}>
              <div ref={asideContent} class={styles.asideContent}>
                <AsideRegion>{slots.aside?.()}</AsideRegion>
              </div>
            </Teleport>
          </aside>
          <div class={styles.main}>{slots.default?.()}</div>
          <ElDrawer
            class={styles.drawer}
            modelValue={asideOpen.value}
            onUpdate:modelValue={(value: boolean) => {
              asideOpen.value = value;
            }}
            direction="ltr"
            size={width}
            withHeader={false}
            title={props.asideLabel}
          >
            <div ref={drawerTarget} class={styles.drawerTarget} />
          </ElDrawer>
        </div>
      );
    };
  }
});
