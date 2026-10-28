import { EYE_HEIGHT } from '@yzt/map-core';
import { computed, defineComponent, type PropType, ref, type VNode } from 'vue';
import { useShownElementSize } from '../../composables/useShownElementSize';
import { type CoordinateFormat, formatLngLat } from '../location/coordinate-format';
import { eyeText, fitStatusLayout, type ScaleBar, type StatusLayout, type ViewAngles } from './status-bar';
import type { MapReadout, ReadoutPosition } from './useMapReadout';
import styles from './MapStatusBar.module.scss';

// 每种排法最多显示几段
const LAYOUT_SEGMENTS: Readonly<Record<StatusLayout, number>> = { full: 3, 'no-angles': 2, 'scale-only': 1 };

// 段之间加分隔线；一段都没有时不显示
const joined = (segments: readonly VNode[]) =>
  segments.length === 0 ? null : (
    <div class={styles.bar}>
      {segments.flatMap((segment, index) => (index === 0 ? [segment] : [<span class={styles.divider} />, segment]))}
    </div>
  );

const scaleSegment = ({ width, label }: ScaleBar) => (
  <span class={styles.segment}>
    <span class={styles.scaleBar} style={{ width: `${width}px` }} />
    {label}
  </span>
);

// 三维代替比例尺的一段（ADR 0080 第 6 节）
const eyeSegment = (meters: number) => <span class={styles.segment}>{eyeText(meters)}</span>;

// 旋转、俯仰都为 0 时没有这一段
const anglesSegment = ({ bearing, pitch }: ViewAngles) =>
  bearing === null && pitch === null ? null : (
    <span class={[styles.segment, styles.angles]}>
      {bearing !== null && <span>旋转 {bearing}°</span>}
      {pitch !== null && <span>俯仰 {pitch}°</span>}
    </span>
  );

// 步行时的三段：第一视角、眼高、朝向（原型 `/dev/map-3d`），放不下时同样先去掉后面的
const firstPersonSegments = (heading: number) => [
  <span class={styles.segment}>第一视角</span>,
  <span class={styles.segment}>眼高 {EYE_HEIGHT} m</span>,
  <span class={[styles.segment, styles.angles]}>朝向 {heading}°</span>
];

/**
 * 左下角的状态栏（ADR 0053 第 5 节，设计稿 5D.3）：比例尺（三维是视点高度，ADR 0080 第 6 节）、鼠标所在的经纬度、
 * 不为 0 的旋转和俯仰；步行时是第一视角、眼高和朝向（ADR 0086 第 5 节）。
 * 只显示、不拦截鼠标；三种排法的宽度由隐藏的量尺量出，放不下时按 fitStatusLayout 取舍
 */
export const MapStatusBar = defineComponent({
  name: 'MapStatusBar',
  props: {
    readout: { type: Object as PropType<MapReadout>, required: true },
    /** 经纬度的写法，跟着坐标定位面板 */
    format: { type: String as PropType<CoordinateFormat>, required: true }
  },
  setup(props) {
    const root = ref<HTMLElement>();
    const fullRuler = ref<HTMLElement>();
    const noAnglesRuler = ref<HTMLElement>();
    const scaleOnlyRuler = ref<HTMLElement>();
    const { width: available } = useShownElementSize(root);
    const borderBox = { box: 'border-box' } as const;
    const widths = {
      full: useShownElementSize(fullRuler, undefined, borderBox).width,
      'no-angles': useShownElementSize(noAnglesRuler, undefined, borderBox).width,
      'scale-only': useShownElementSize(scaleOnlyRuler, undefined, borderBox).width
    };
    const layout = computed(() =>
      fitStatusLayout(
        { full: widths.full.value, 'no-angles': widths['no-angles'].value, 'scale-only': widths['scale-only'].value },
        available.value
      )
    );

    const positionSegment = ({ lngLat, center }: ReadoutPosition) => (
      <span class={styles.segment}>
        {center && <span class={styles.muted}>中心</span>}
        {formatLngLat(lngLat, props.format)}
      </span>
    );

    // 按排法取出要显示的几段
    const bar = (shown: StatusLayout) => {
      const { scale, eye, position, angles, firstPerson } = props.readout;
      if (firstPerson.value) {
        return joined(firstPersonSegments(firstPerson.value.heading).slice(0, LAYOUT_SEGMENTS[shown]));
      }
      const segments: VNode[] = [];
      // 排法里的 scale-only 指只留第一段：二维是比例尺，三维是视点高度
      if (scale.value) {
        segments.push(scaleSegment(scale.value));
      } else if (eye.value !== null) {
        segments.push(eyeSegment(eye.value));
      }
      if (shown !== 'scale-only' && position.value) {
        segments.push(positionSegment(position.value));
      }
      const angleSegment = shown === 'full' ? anglesSegment(angles.value) : null;
      if (angleSegment) {
        segments.push(angleSegment);
      }
      return joined(segments);
    };

    return () => (
      <div ref={root} class={styles.root} data-map-status-bar>
        {bar(layout.value)}
        <div class={styles.rulers} aria-hidden="true">
          <div ref={fullRuler}>{bar('full')}</div>
          <div ref={noAnglesRuler}>{bar('no-angles')}</div>
          <div ref={scaleOnlyRuler}>{bar('scale-only')}</div>
        </div>
      </div>
    );
  }
});
