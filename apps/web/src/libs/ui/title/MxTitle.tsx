import { defineComponent, type PropType, type SlotsType, type VNode } from 'vue';
import styles from './MxTitle.module.scss';

export type MxTitleLevel = 'panel' | 'section';

/** 标题：面板标题（h2）或区块标题（h3），左侧默认是竖杠，可换成图标；extra 放在右侧，不在标题元素内 */
export const MxTitle = defineComponent({
  name: 'MxTitle',
  props: {
    level: { type: String as PropType<MxTitleLevel>, default: 'section' },
    // 紧跟在标题后面的灰色说明，例如分类的上级路径；空间不够时先省略它，标题保持完整
    description: String
  },
  slots: Object as SlotsType<{
    default?: () => VNode[];
    icon?: () => VNode[];
    extra?: () => VNode[];
  }>,
  setup(props, { slots }) {
    return () => {
      const Heading = props.level === 'panel' ? 'h2' : 'h3';
      return (
        <div class={[styles.root, styles[props.level]]}>
          {slots.icon ? (
            <span class={styles.icon} aria-hidden="true">
              {slots.icon()}
            </span>
          ) : (
            <span class={styles.mark} aria-hidden="true" />
          )}
          <Heading class={styles.text}>{slots.default?.()}</Heading>
          {props.description && (
            <span class={styles.description} title={props.description}>
              {props.description}
            </span>
          )}
          {slots.extra && <div class={styles.extra}>{slots.extra()}</div>}
        </div>
      );
    };
  }
});
