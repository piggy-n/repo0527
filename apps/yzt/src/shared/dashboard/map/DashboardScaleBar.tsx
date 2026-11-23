import { computed, defineComponent, ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { useExportPart } from './export-parts';
import { scaleBarExportPart } from './overlay-export';
import { SCALE_UNIT_GAP, scaleBar } from './scale-bar';
import styles from './overlay.module.scss';

// 按字号估文字宽度：数字和小数点约 0.6 个字宽，汉字一个字宽；估宽一点，排出来不会超出 maxWidth
function textWidth(text: string, fontSize: number): number {
  const digits = text.replaceAll(/[^\d.]/g, '').length;
  return (digits * 0.6 + text.length - digits) * fontSize;
}

/** 比例尺：深蓝、白交替的四段，上面写刻度，末尾写单位；按 maxWidth 选总长度；放在地图角上时一起画进导出图片 */
export const DashboardScaleBar = defineComponent({
  name: 'DashboardScaleBar',
  props: {
    /** 画布中心附近一个 CSS 像素代表的米数，即 MapView 的 metersPerPixel */
    metersPerPixel: { type: Number, required: true },
    /** 能用的宽度（CSS 像素），包括两端伸出去的刻度文字和末尾的单位 */
    maxWidth: { type: Number, required: true }
  },
  setup(props) {
    useExportPart(() => scaleBarExportPart(props.metersPerPixel));
    const unit = ref<HTMLElement>();
    const fontSize = ref(14);
    // 字号随 --ui-scale 变，单位的宽度跟着变；量到时读一次字号
    useResizeObserver(unit, entries => {
      const element = entries[0]?.target;
      if (element) {
        fontSize.value = Number.parseFloat(getComputedStyle(element).fontSize) || 14;
      }
    });
    const bar = computed(() => {
      const size = fontSize.value;
      return scaleBar(props.metersPerPixel, props.maxWidth, text => textWidth(text, size));
    });

    return () => {
      const value = bar.value;
      if (!value) {
        return null;
      }
      const last = String(value.length);
      const width = `${value.width}px`;
      return (
        <div class={styles.scaleBar} role="img" aria-label={`比例尺，全长${value.length}${value.unit}`}>
          <div class={styles.scaleLabels} aria-hidden="true">
            <div class={styles.scaleTicks} style={{ width }}>
              {value.ticks.map(tick => tick.label !== null && (
                <span key={tick.offset} style={{ left: `${tick.offset}px` }}>
                  {tick.label}
                </span>
              ))}
            </div>
            {/* 单位跟在最后一个刻度文字后面：文字以刻度为中心，伸出去一半 */}
            <span ref={unit} style={{ marginLeft: `calc(${last.length / 2}ch + ${SCALE_UNIT_GAP}px)` }}>
              {value.unit}
            </span>
          </div>
          <div class={styles.scaleTrack} style={{ width }} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      );
    };
  }
});
