import { ElSwitch, ElTooltip } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { OpacitySlider } from '../OpacitySlider';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import type { BasemapId } from './basemap-style';
import { BasemapThumbnail } from './BasemapThumbnail';
import type { Basemap } from './useBasemap';
import styles from './BasemapPanel.module.scss';

/**
 * 底图的切换（ADR 0146）：默认只有缩略图，只写类型，选中的主色描边；点缩略图选中并交给使用方（picked）。
 * 当前缩略图角上的入口点开才有标注和透明度。只显示 useBasemap 的状态并调用它的操作，外观和登记由外壳负责
 */
export const BasemapPanel = defineComponent({
  name: 'BasemapPanel',
  props: {
    basemap: { type: Object as PropType<Basemap>, required: true },
    /** 浮层不显示时为 false：收起标注和透明度，下次打开又只有切换按钮 */
    active: { type: Boolean, default: true }
  },
  emits: {
    /** 点了一张缩略图，包括当前的这张 */
    picked: () => true
  },
  setup(props, { emit }) {
    // 调过的值在拥有者里，这里只记展开没有
    const adjusting = ref(false);
    watch(
      () => props.active,
      active => {
        if (!active) {
          adjusting.value = false;
        }
      }
    );
    const pick = (id: BasemapId) => {
      props.basemap.select(id);
      emit('picked');
    };

    return () => {
      const { options, thumbnails, selected, opacity, labelsVisible } = props.basemap;
      return (
        <div class={styles.panel}>
          <div class={styles.options} role="group" aria-label="底图">
            {options.map(option => {
              const on = option.id === selected.value;
              return (
                <div key={option.id} class={styles.item}>
                  <button
                    type="button"
                    class={[styles.option, on && styles.on]}
                    aria-label={option.label}
                    aria-pressed={on}
                    onClick={() => pick(option.id)}
                  >
                    <span class={styles.frame}>
                      <BasemapThumbnail thumbnail={thumbnails[option.id]} />
                      {on && <SvgIcon class={styles.check} name="check" size={12} />}
                      <span class={styles.label}>{option.shortLabel}</span>
                    </span>
                  </button>
                  {/* 和缩略图并列，不嵌套：按钮里不能再放按钮；无底图没有可调的 */}
                  {on && opacity.value !== null && (
                    <ElTooltip {...MAP_TOOLTIP_PROPS} content="标注和透明度" placement="top">
                      <button
                        type="button"
                        class={[styles.adjust, adjusting.value && styles.adjusting]}
                        aria-label="调整标注和透明度"
                        aria-pressed={adjusting.value}
                        onClick={() => (adjusting.value = !adjusting.value)}
                      >
                        <SvgIcon name="map-adjust" size={14} />
                      </button>
                    </ElTooltip>
                  )}
                </div>
              );
            })}
          </div>
          {adjusting.value && opacity.value !== null && (
            <div class={styles.adjustments}>
              <div class={styles.labels}>
                <span class={styles.labelsName} aria-hidden="true">
                  标注
                </span>
                <ElSwitch
                  class={styles.labelsSwitch}
                  size="small"
                  aria-label="底图标注"
                  modelValue={labelsVisible.value}
                  onUpdate:modelValue={value => props.basemap.setLabelsVisible(value === true)}
                />
              </div>
              <OpacitySlider value={opacity.value} label="底图的透明度" onChange={props.basemap.setOpacity} />
            </div>
          )}
        </div>
      );
    };
  }
});
