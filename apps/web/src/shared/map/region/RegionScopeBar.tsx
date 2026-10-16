import { useMapOverlay } from '@yzt/map-vue';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { regionTrail } from './region-catalog';
import type { RegionLocate } from './useRegionLocate';
import styles from './RegionScopeBar.module.scss';

/**
 * 当前区划（设计稿 5D.7）：选中区划后放在地图上方，写出市、区县，"回到全省"清除选择；没选区划时不显示。
 * 关掉区划定位面板后，靠它知道遮罩外是哪里。贴着地图上边，登记为悬浮元素，定位时让开它
 */
export const RegionScopeBar = defineComponent({
  name: 'RegionScopeBar',
  props: {
    region: { type: Object as PropType<RegionLocate>, required: true }
  },
  setup(props) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'top');
    // 江苏省之下的各级
    const levels = computed(() => regionTrail(props.region.state.value.selected).slice(1));

    return () =>
      levels.value.length > 0 ? (
        <div ref={element} class={styles.bar} data-region-scope>
          <span class={styles.label}>区划</span>
          {levels.value.flatMap((level, index) => [
            index > 0 ? (
              <span key={`separator-${index}`} class={styles.separator} aria-hidden="true">
                ›
              </span>
            ) : null,
            <span key={level.code ?? ''}>{level.name}</span>
          ])}
          <button type="button" class={styles.reset} onClick={() => props.region.select(null)}>
            <SvgIcon name="close" size={12} />
            回到全省
          </button>
        </div>
      ) : null;
  }
});
