import { Close, Expand } from '@element-plus/icons-vue';
import { ElButton } from 'element-plus';
import { computed, defineComponent, inject, provide, type SlotsType, type VNode } from 'vue';
import { asideRegionKey, splitLayoutKey } from '../split-layout/context';
import { MxTitle } from '../title/MxTitle';
import styles from './MxPanel.module.scss';

/** 面板：头部（标题 + 右侧操作）、内部滚动的内容区、可选的底部；规范见 docs/design/page-layout.md */
export const MxPanel = defineComponent({
  name: 'MxPanel',
  props: {
    title: String,
    // 去掉内容区的内边距：表格贴边、放地图、内容自带内边距时使用
    flush: Boolean,
    // 卡片头部：图标放在浅底方块里，只用于同一页有多张并列卡片的场合
    iconTile: Boolean,
    // 在分栏布局的主区中，窄屏时在头部最左侧显示打开侧栏的按钮
    asideToggle: Boolean
  },
  slots: Object as SlotsType<{
    default?: () => VNode[];
    icon?: () => VNode[];
    actions?: () => VNode[];
    footer?: () => VNode[];
  }>,
  setup(props, { slots }) {
    // 不在分栏布局中时为 null，面板照常使用
    const layout = inject(splitLayoutKey, null);
    const isAsideRoot = inject(asideRegionKey, false);
    // 嵌套在本面板里的面板不再算侧栏的最外层面板
    provide(asideRegionKey, false);

    const inDrawer = computed(() => isAsideRoot && layout?.compact.value === true);
    const showToggle = computed(() => props.asideToggle && layout?.compact.value === true);

    const renderIcon = () => {
      const icon = slots.icon?.();
      return props.iconTile ? <span class={styles.tile}>{icon}</span> : icon;
    };

    return () => {
      const actions = slots.actions?.();
      const hasHeader = Boolean(props.title || actions || showToggle.value || inDrawer.value);
      return (
        <section class={[styles.root, inDrawer.value && styles.inDrawer]}>
          {hasHeader && (
            <header class={styles.header}>
              {showToggle.value && layout && [
                <ElButton icon={Expand} onClick={layout.openAside}>
                  {layout.asideLabel.value}
                </ElButton>,
                <span class={styles.separator} aria-hidden="true" />
              ]}
              {props.title && (
                <MxTitle level="panel">{{ default: () => props.title, icon: slots.icon && renderIcon }}</MxTitle>
              )}
              {(actions || inDrawer.value) && (
                <div class={styles.actions}>
                  {actions}
                  {inDrawer.value && layout && (
                    <ElButton
                      link
                      icon={Close}
                      aria-label={`关闭${layout.asideLabel.value}`}
                      onClick={layout.closeAside}
                    />
                  )}
                </div>
              )}
            </header>
          )}
          <div class={[styles.body, props.flush && styles.flush]}>{slots.default?.()}</div>
          {slots.footer && <footer class={styles.footer}>{slots.footer()}</footer>}
        </section>
      );
    };
  }
});
