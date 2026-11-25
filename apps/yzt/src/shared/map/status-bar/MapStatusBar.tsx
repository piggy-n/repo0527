import { useShownElementSize } from '@mx/map-vue';
import { ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType, ref, type SlotsType, type VNode, type VNodeChild } from 'vue';
import { type IconName, SvgIcon } from '../../icons/SvgIcon';
import { type CoordinateFormat, formatLngLat } from '../location/coordinate-format';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import {
  belowSurface,
  eyeHeightLabel,
  eyeText,
  fitStatusLayout,
  SCALE_MAX_WIDTH,
  type ScaleBar,
  type StatusLayout,
  type ViewAngles
} from './status-bar';
import type { MapReadout, ReadoutPosition } from './useMapReadout';
import styles from './MapStatusBar.module.scss';

// 前面的插槽和状态栏之间的距离，和样式里的一致
const BEFORE_GAP = 8;

// 量尺按最宽的读数量，缩放、转动时排法不来回切换：比例尺最小级别 5 级是"200 km"，三维的视点高度在 5～8 级是四位数的千米
const SCALE_SAMPLE: ScaleBar = { meters: 200_000, width: SCALE_MAX_WIDTH, label: '200 km' };
const EYE_SAMPLE = 8_888_000;
const ANGLE_SAMPLE = { bearing: -180, pitch: 85 };

const CENTER_HINT = '画布中心的经纬度';
const POINTER_HINT = '鼠标所在位置的经纬度';

// 读数前的图标，读屏名称是这一段的说明
const readoutIcon = (name: IconName, hint: string) => (
  <span class={styles.icon} role="img" aria-label={hint}>
    <SvgIcon name={name} size={14} />
  </span>
);

// 一段读数（图标和数值）：悬停整段说明它是什么，每段各自提示（用户 2026-11-24）；只有这几段接鼠标，状态栏别处不挡地图。
// 量尺里的不带提示
function readout(hint: string, tip: boolean, content: VNodeChild, extraClass?: string) {
  const segment = <span class={[styles.segment, styles.readout, extraClass]}>{content}</span>;
  return tip ? (
    <ElTooltip {...MAP_TOOLTIP_PROPS} content={hint} placement="top">
      {segment}
    </ElTooltip>
  ) : (
    segment
  );
}

// 段之间加分隔线；一段都没有时不显示
const joined = (segments: readonly VNode[], shown: boolean) =>
  segments.length === 0 ? null : (
    <div class={styles.bar} data-map-readout={shown ? '' : undefined}>
      {segments.flatMap((segment, index) => (index === 0 ? [segment] : [<span class={styles.divider} />, segment]))}
    </div>
  );

const scaleSegment = ({ width, label }: Pick<ScaleBar, 'width' | 'label'>, tip: boolean) =>
  readout(
    `比例尺 ${label}`,
    tip,
    <>
      <span class={styles.scaleBar} style={{ width: `${width}px` }} />
      {label}
    </>,
    styles.scale
  );

// 三维代替比例尺的一段（ADR 0080 第 6 节）：图标加高度，地表以下换向下的图标，全称在提示里
const eyeSegment = (meters: number, tip: boolean) => {
  const below = belowSurface(meters);
  const hint = eyeText(meters);
  return readout(
    hint,
    tip,
    <>
      {readoutIcon(below ? 'readout-eye-below' : 'readout-eye-height', hint)}
      {eyeHeightLabel(below ? -meters : meters)}
    </>
  );
};

// 一个角度：图标加度数
const angleReadout = (icon: IconName, name: string, degrees: number, tip: boolean) => {
  const hint = `${name} ${degrees}°`;
  return readout(
    hint,
    tip,
    <>
      {readoutIcon(icon, hint)}
      {degrees}°
    </>
  );
};

// 旋转、俯仰都为 0 时没有这一段；两项各自提示，中间的间隔不接鼠标
const anglesSegment = ({ bearing, pitch }: ViewAngles, tip: boolean) =>
  bearing === null && pitch === null ? null : (
    <span class={[styles.segment, styles.angles]}>
      {bearing !== null && angleReadout('readout-bearing', '旋转', bearing, tip)}
      {pitch !== null && angleReadout('readout-pitch', '俯仰', pitch, tip)}
    </span>
  );

// 量尺里的角度：有的一项换成最宽的度数
const angleSample = ({ bearing, pitch }: ViewAngles): ViewAngles => ({
  bearing: bearing === null ? null : ANGLE_SAMPLE.bearing,
  pitch: pitch === null ? null : ANGLE_SAMPLE.pitch
});

/**
 * 左下角的状态栏（ADR 0053 第 5 节、ADR 0171）：经纬度（前面的图标分鼠标所在位置和画布中心）、比例尺（三维是视点高度，
 * ADR 0080 第 6 节）、不为 0 的旋转和俯仰。宽度会变的排在后面，后面没有东西被它推动，不留位；只显示、不拦截鼠标，
 * 每段读数除外（悬停整段说明，用户 2026-11-24）。三种排法的宽度由隐藏的量尺按最宽的读数量出，放不下时按 fitStatusLayout 取舍。
 * 插槽 before 排在状态栏左边（现状底图的请求状态，ADR 0158、0171），它的宽度先让出来；插槽里的内容自己决定拦不拦截鼠标
 */
export const MapStatusBar = defineComponent({
  name: 'MapStatusBar',
  props: {
    readout: { type: Object as PropType<MapReadout>, required: true },
    /** 经纬度的写法，跟着坐标定位面板 */
    format: { type: String as PropType<CoordinateFormat>, required: true }
  },
  slots: Object as SlotsType<{ before?: () => VNode[] }>,
  setup(props, { slots }) {
    const root = ref<HTMLElement>();
    const before = ref<HTMLElement>();
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
    const { width: beforeWidth } = useShownElementSize(before, undefined, borderBox);
    const layout = computed(() =>
      fitStatusLayout(
        { full: widths.full.value, 'no-angles': widths['no-angles'].value, 'scale-only': widths['scale-only'].value },
        available.value - (slots.before ? beforeWidth.value + BEFORE_GAP : 0)
      )
    );

    const positionSegment = ({ lngLat, center }: ReadoutPosition, tip: boolean) => {
      const hint = center ? CENTER_HINT : POINTER_HINT;
      return readout(
        hint,
        tip,
        <>
          {readoutIcon(center ? 'readout-center' : 'readout-pointer', hint)}
          {formatLngLat(lngLat, props.format)}
        </>
      );
    };

    // 按排法取出要显示的几段：经纬度、比例尺或视点高度、角度；量尺（measure）按最宽的读数，不带提示
    const bar = (shown: StatusLayout, measure: boolean) => {
      const { scale, eye, position, angles } = props.readout;
      const segments: VNode[] = [];
      if (shown !== 'scale-only' && position.value) {
        segments.push(positionSegment(position.value, !measure));
      }
      if (scale.value) {
        segments.push(scaleSegment(measure ? SCALE_SAMPLE : scale.value, !measure));
      } else if (eye.value !== null) {
        segments.push(eyeSegment(measure ? EYE_SAMPLE : eye.value, !measure));
      }
      const angleSegment =
        shown === 'full' ? anglesSegment(measure ? angleSample(angles.value) : angles.value, !measure) : null;
      if (angleSegment) {
        segments.push(angleSegment);
      }
      return joined(segments, !measure);
    };

    return () => (
      <div ref={root} class={styles.root} data-map-status-bar>
        {slots.before && (
          <div ref={before} class={styles.before}>
            {slots.before()}
          </div>
        )}
        {bar(layout.value, false)}
        <div class={styles.rulers} aria-hidden="true">
          <div ref={fullRuler}>{bar('full', true)}</div>
          <div ref={noAnglesRuler}>{bar('no-angles', true)}</div>
          <div ref={scaleOnlyRuler}>{bar('scale-only', true)}</div>
        </div>
      </div>
    );
  }
});
