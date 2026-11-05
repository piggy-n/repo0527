import { defineComponent } from 'vue';
import outline from './system-title-outline.json';
import styles from './SystemTitle.module.scss';

/** 系统名称：用优设标题黑生成的 SVG 轮廓，大小跟随父元素的 font-size，颜色跟随 color（见 docs/modules/system-title.md） */
export const SystemTitle = defineComponent({
  name: 'SystemTitle',
  setup() {
    return () => (
      <svg class={styles.root} viewBox={outline.viewBox} role="img" aria-label={outline.text}>
        <path d={outline.path} fill="currentColor" />
      </svg>
    );
  }
});
