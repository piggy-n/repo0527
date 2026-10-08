import { defineComponent, type SlotsType, type VNode } from 'vue';
import { MxTitle } from '../title/MxTitle';
import styles from './MxSection.module.scss';

/** 区块：区块标题（h3）加内容，自带标题与内容、相邻区块之间的间距；规范见 docs/design/page-layout.md */
export const MxSection = defineComponent({
  name: 'MxSection',
  props: {
    title: { type: String, required: true }
  },
  slots: Object as SlotsType<{
    default?: () => VNode[];
    icon?: () => VNode[];
    extra?: () => VNode[];
  }>,
  setup(props, { slots }) {
    return () => (
      <section class={styles.root}>
        <MxTitle>{{ default: () => props.title, icon: slots.icon, extra: slots.extra }}</MxTitle>
        <div class={styles.body}>{slots.default?.()}</div>
      </section>
    );
  }
});
