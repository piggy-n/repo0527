import { defineComponent, type SlotsType, type VNode } from 'vue';
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
    iconTile: Boolean
  },
  slots: Object as SlotsType<{
    default?: () => VNode[];
    icon?: () => VNode[];
    actions?: () => VNode[];
    footer?: () => VNode[];
  }>,
  setup(props, { slots }) {
    const renderIcon = () => {
      const icon = slots.icon?.();
      return props.iconTile ? <span class={styles.tile}>{icon}</span> : icon;
    };

    return () => {
      const hasHeader = Boolean(props.title || slots.actions);
      return (
        <section class={styles.root}>
          {hasHeader && (
            <header class={styles.header}>
              {props.title && (
                <MxTitle level="panel">
                  {{ default: () => props.title, icon: slots.icon && renderIcon }}
                </MxTitle>
              )}
              {slots.actions && <div class={styles.actions}>{slots.actions()}</div>}
            </header>
          )}
          <div class={[styles.body, props.flush && styles.flush]}>{slots.default?.()}</div>
          {slots.footer && <footer class={styles.footer}>{slots.footer()}</footer>}
        </section>
      );
    };
  }
});
