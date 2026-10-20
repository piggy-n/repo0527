import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import type { BasemapThumbnail as Thumbnail } from './basemap-style';
import styles from './BasemapThumbnail.module.scss';

/** 底图的缩略图：注记叠在底图上，对准南京；无底图显示浅色方格与居中禁用图标，尺寸由使用方决定 */
export const BasemapThumbnail = defineComponent({
  name: 'BasemapThumbnail',
  props: {
    thumbnail: { type: Object as PropType<Thumbnail | null>, default: null }
  },
  setup(props) {
    return () => {
      const { thumbnail } = props;
      return thumbnail ? (
        <span
          class={styles.image}
          style={{
            backgroundImage: `url("${thumbnail.labels}"), url("${thumbnail.base}")`,
            backgroundPosition: thumbnail.focus
          }}
          aria-hidden="true"
        />
      ) : (
        <span class={[styles.image, styles.none]} aria-hidden="true">
          <SvgIcon name="map-basemap-none" size={32} />
        </span>
      );
    };
  }
});
