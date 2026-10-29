import { Expand } from '@element-plus/icons-vue';
import { useMediaQuery, useResizeObserver } from '@vueuse/core';
import { ElDrawer, ElIcon } from 'element-plus';
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

/**
 * 分栏布局：侧栏加主区，四周统一间距；窄屏时侧栏收成左侧的窄条，点击后在抽屉中打开，内容移动而不重建。
 * 开启 collapsible 后，宽屏时也能把侧栏收成同样的窄条，点击在原位展开；收起把手和窄条的外观可以由页面给出（docs/modules/ui.md）
 */
export const MxSplitLayout = defineComponent({
  name: 'MxSplitLayout',
  props: {
    asideType: { type: String as PropType<SplitLayoutAsideType>, default: 'panel' },
    asideLabel: { type: String, required: true },
    /** 宽屏时侧栏可以收起：侧栏的面板出现收起按钮 */
    collapsible: Boolean,
    /** 宽屏时侧栏收成窄条；由页面持有，配合 onUpdate:collapsed */
    collapsed: Boolean
  },
  emits: {
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  slots: Object as SlotsType<{
    default?: () => VNode[];
    aside?: () => VNode[];
    /** 宽屏收起时窄条里的内容，代替图标和竖排名称；窄屏时仍用默认的窄条 */
    rail?: () => VNode[];
    /** 宽屏展开时的收起把手，贴在侧栏右上角，代替侧栏面板里的收起按钮 */
    collapse?: () => VNode[];
  }>,
  setup(props, { slots, emit }) {
    const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
    const asideOpen = ref(false);
    const asideContent = ref<HTMLElement>();
    const drawerTarget = ref<HTMLElement>();
    // 抽屉第一次打开前不渲染内容区，没有目标元素，侧栏内容先留在隐藏的侧栏里
    const inDrawer = computed(() => compact.value && drawerTarget.value !== undefined);
    // 宽屏收起只看页面给的状态；窄屏时侧栏总在抽屉里，不受它影响
    const collapsedWide = computed(() => props.collapsible && props.collapsed && !compact.value);
    const expandedWide = computed(() => props.collapsible && !props.collapsed && !compact.value);
    const collapseAside = () => emit('update:collapsed', true);

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
      closeAside,
      collapseInPanel: computed(() => props.collapsible && !compact.value && !slots.collapse),
      collapseAside
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
    const changes = [compact, asideOpen, inDrawer, collapsedWide];
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
      // 窄屏点窄条打开抽屉；宽屏收起时点窄条在原位展开
      const expand = compact.value ? openAside : () => emit('update:collapsed', false);
      // 页面给的窄条内容只在宽屏收起时用；内容可能只是图片，名称由 aria-label 给出
      const customRail = collapsedWide.value && slots.rail !== undefined;
      return (
        <div class={styles.root}>
          <aside
            class={[styles.aside, (compact.value || collapsedWide.value) && styles.hidden]}
            style={{ width: `${width}px` }}
          >
            <Teleport to={drawerTarget.value} disabled={!inDrawer.value}>
              <div ref={asideContent} class={styles.asideContent}>
                <AsideRegion>{slots.aside?.()}</AsideRegion>
              </div>
            </Teleport>
            {expandedWide.value && slots.collapse && (
              <button
                type="button"
                class={styles.collapseHandle}
                aria-label={`收起${props.asideLabel}`}
                onClick={collapseAside}
              >
                {slots.collapse()}
              </button>
            )}
          </aside>
          {(compact.value || collapsedWide.value) && (
            <button
              type="button"
              class={[styles.rail, customRail && styles.customRail]}
              aria-expanded={compact.value ? asideOpen.value : false}
              aria-label={customRail ? props.asideLabel : undefined}
              onClick={expand}
            >
              {customRail ? (
                slots.rail?.()
              ) : (
                <>
                  <ElIcon>
                    <Expand />
                  </ElIcon>
                  <span class={styles.railLabel}>{props.asideLabel}</span>
                </>
              )}
            </button>
          )}
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
