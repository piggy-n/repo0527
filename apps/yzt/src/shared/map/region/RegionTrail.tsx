import { defineComponent, type PropType } from 'vue';
import { regionTrail } from './region-catalog';
import type { RegionLocate } from './useRegionLocate';
import styles from './RegionTrail.module.scss';

/**
 * 当前区划的各级（设计稿 5D.4）：江苏省 › 南京市 › 江宁区，前面几级可以点（回到全省或回到市），最后一级是当前位置。
 * 区划定位面板和地图上方的区划条共用；放不下时最后一级省略
 */
export const RegionTrail = defineComponent({
  name: 'RegionTrail',
  props: {
    region: { type: Object as PropType<RegionLocate>, required: true }
  },
  setup(props) {
    return () => {
      const trail = regionTrail(props.region.state.value.selected);
      return (
        <nav class={styles.crumbs} aria-label="当前区划" data-region-current>
          {trail.map((item, index) => {
            const last = index === trail.length - 1;
            return [
              index > 0 && (
                <span class={styles.separator} aria-hidden="true">
                  ›
                </span>
              ),
              last ? (
                <span class={styles.here} aria-current="location" title={item.name}>
                  {item.name}
                </span>
              ) : (
                <button type="button" class={styles.crumb} onClick={() => props.region.select(item.code)}>
                  {item.name}
                </button>
              )
            ];
          })}
        </nav>
      );
    };
  }
});
