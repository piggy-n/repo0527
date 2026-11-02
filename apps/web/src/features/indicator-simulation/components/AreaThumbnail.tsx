import type { MultiPolygon } from 'geojson';
import { computed, defineComponent, type PropType } from 'vue';
import { thumbnailPath } from '../scope/thumbnail';
import styles from './AreaThumbnail.module.scss';

/** 自定义范围的缩略图：轮廓画在浅色方格上；只是装饰，读屏跳过 */
export const AreaThumbnail = defineComponent({
  name: 'AreaThumbnail',
  props: {
    outline: { type: Object as PropType<MultiPolygon>, required: true },
    size: { type: Number, default: 56 }
  },
  setup(props) {
    const path = computed(() => thumbnailPath(props.outline, props.size));
    return () => (
      <svg
        class={styles.thumbnail}
        width={props.size}
        height={props.size}
        viewBox={`0 0 ${props.size} ${props.size}`}
        aria-hidden="true"
      >
        <path class={styles.shape} d={path.value} />
      </svg>
    );
  }
});
