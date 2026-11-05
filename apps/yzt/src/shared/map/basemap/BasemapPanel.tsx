import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { OpacitySlider } from '../OpacitySlider';
import { BasemapThumbnail } from './BasemapThumbnail';
import type { Basemap } from './useBasemap';
import styles from './BasemapPanel.module.scss';

/**
 * 底图的切换（ADR 0031，设计稿 5D.4）：缩略图只写类型，选中的主色描边；当前底图的透明度。
 * 只显示 useBasemap 的状态并调用它的操作；现状底图中放在底图 Popover，外观和登记由外壳负责
 */
export const BasemapPanel = defineComponent({
  name: 'BasemapPanel',
  props: {
    basemap: { type: Object as PropType<Basemap>, required: true },
    /** 浮层另行提供透明度滑块时隐藏这里的滑块 */
    showOpacity: { type: Boolean, default: true }
  },
  setup(props) {
    return () => {
      const { options, thumbnails, selected, opacity } = props.basemap;
      return (
        <div class={styles.panel}>
          <div class={styles.options} role="group" aria-label="底图">
            {options.map(option => {
              const on = option.id === selected.value;
              return (
                <button
                  key={option.id}
                  type="button"
                  class={[styles.option, on && styles.on]}
                  aria-label={option.label}
                  aria-pressed={on}
                  onClick={() => props.basemap.select(option.id)}
                >
                  <span class={styles.frame}>
                    <BasemapThumbnail thumbnail={thumbnails[option.id]} />
                    {on && <SvgIcon class={styles.check} name="check" size={12} />}
                    <span class={styles.label}>{option.shortLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {props.showOpacity && opacity.value !== null && (
            <OpacitySlider value={opacity.value} label="底图的透明度" onChange={props.basemap.setOpacity} />
          )}
        </div>
      );
    };
  }
});
