import { useMapOverlay } from '@yzt/map-vue';
import { defineComponent, type PropType, ref } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { RegionTrail } from './RegionTrail';
import type { RegionLocate } from './useRegionLocate';
import styles from './RegionScopeBar.module.scss';

/**
 * 当前区划（设计稿 5D.7）：选中区划后放在地图上方，和区划定位面板一样的可点击的各级，"回到全省"清除选择；
 * 没选区划时不显示。关掉区划定位面板后，靠它知道遮罩外是哪里。贴着地图上边，登记为悬浮元素，定位时让开它
 */
export const RegionScopeBar = defineComponent({
  name: 'RegionScopeBar',
  props: {
    region: { type: Object as PropType<RegionLocate>, required: true }
  },
  setup(props) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'top');

    // "回到全省"和基础组的"默认视角"做的是同一件事（清除选择、回到默认视角），用同一个图标
    return () =>
      props.region.state.value.selected ? (
        <div ref={element} class={styles.bar} data-region-scope>
          <RegionTrail class={styles.trail} region={props.region} />
          <span class={styles.divider} aria-hidden="true" />
          <button type="button" class={styles.reset} onClick={() => props.region.select(null)}>
            <SvgIcon name="map-default-view" size={14} />
            回到全省
          </button>
        </div>
      ) : null;
  }
});
