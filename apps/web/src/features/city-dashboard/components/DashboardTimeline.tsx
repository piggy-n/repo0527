import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './DashboardMap.module.scss';

/** 原生 range 保留拖动和键盘语义，独立视觉层复原旧时间轴 */
export const DashboardTimeline = defineComponent({
  name: 'DashboardTimeline',
  props: {
    years: { type: Array as PropType<readonly number[]>, required: true },
    activeYear: { type: Number as PropType<number | null>, default: null },
    ready: { type: Boolean, default: false },
    reduced: { type: Boolean, default: false }
  },
  emits: { change: (_year: number) => true },
  setup(props, { emit }) {
    function select(index: number): void {
      const year = props.years[index];
      if (props.ready && year !== undefined) { emit('change', year); }
    }
    return () => {
      const index = props.years.indexOf(props.activeYear ?? 0);
      const progress = props.years.length > 1 ? Math.max(0, index) / (props.years.length - 1) * 100 : 0;
      return <div class={styles.timeline} aria-label="地图展示年份" data-reduced={props.reduced}>
        <button class={styles.timelineArrow} type="button" aria-label="上一个地图年份" disabled={!props.ready || index <= 0} onClick={() => select(index - 1)}><SvgIcon name="dashboard-timeline-prev-color" size={36} /></button>
        <div class={styles.trackContent}>
          <div class={styles.track}>
            {props.years.length > 1 ? <>
              <span class={styles.trackVisual} aria-hidden="true"><i class={styles.trackFill} style={{ width: `${progress}%` }} /><i class={styles.trackThumb} style={{ left: `${progress}%` }} /></span>
              <input type="range" aria-label="切换地图年份" aria-valuetext={`${props.activeYear}年`} min={0} max={props.years.length - 1} value={Math.max(0, index)} disabled={!props.ready}
                onInput={event => { if (event.currentTarget instanceof HTMLInputElement) { select(Number(event.currentTarget.value)); } }} />
            </> : <span class={styles.singleTrack} />}
          </div>
          <div class={styles.years}>
            {props.years.map(year => <button key={year} type="button" aria-pressed={year === props.activeYear} disabled={!props.ready || props.years.length === 1} onClick={() => emit('change', year)}>{year}年</button>)}
            {!props.years.length && <span>请选择年份</span>}
          </div>
        </div>
        <button class={styles.timelineArrow} type="button" aria-label="下一个地图年份" disabled={!props.ready || index < 0 || index >= props.years.length - 1} onClick={() => select(index + 1)}><SvgIcon name="dashboard-timeline-next-color" size={36} /></button>
      </div>;
    };
  }
});
