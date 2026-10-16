import { useClipboard, useEventListener } from '@vueuse/core';
import { BROWSE_TOOL, type ScreenPoint } from '@yzt/map-core';
import { useMap } from '@yzt/map-vue';
import { MxTitle } from '@yzt/ui';
import { computed, defineComponent, onScopeDispose, type PropType, ref, watch } from 'vue';
import { usePageActive } from '../../composables/usePageActive';
import { useShownElementSize } from '../../composables/useShownElementSize';
import { SvgIcon } from '../../icons/SvgIcon';
import { PointerHint } from '../pointer-hint/PointerHint';
import { type CoordinateFormat, formatLngLat } from './coordinate-format';
import { describeLocationRegion, placeLocationInfo } from './location-info';
import { createPressGesture, type PressPhase } from './press-gesture';
import { LOCATION_PICK_TOOL, type LocationPoint, type LocationPointOwner } from './useLocationPoint';
import styles from './LocationOverlay.module.scss';

const COPY_ROWS: readonly { readonly format: CoordinateFormat; readonly label: string }[] = [
  { format: 'decimal', label: '小数' },
  { format: 'dms', label: '度分秒' }
];

function position({ x, y }: ScreenPoint) {
  return { left: `${x}px`, top: `${y}px` };
}

// 手势按视口坐标判断移动距离；拖动时再换成画布上的位置
function client(event: PointerEvent): ScreenPoint {
  return { x: event.clientX, y: event.clientY };
}

// 拾取时鼠标旁的提示
const PICK_HINT: readonly string[] = ['单击地图拾取点位', 'Esc 取消'];

/**
 * 位置点的图钉、位置信息和拾取提示（ADR 0037 第 5 条，设计稿 5D.7）。
 * 和画布放在同一个定位参照里盖在上面；当前工具不是"移动"时图钉不响应鼠标，单击落到地图上
 */
export const LocationOverlay = defineComponent({
  name: 'LocationOverlay',
  props: {
    location: { type: Object as PropType<LocationPointOwner>, required: true }
  },
  setup(props) {
    const map = useMap();
    const root = ref<HTMLElement>();
    const info = ref<HTMLElement>();
    const canvasSize = useShownElementSize(root);
    const infoSize = useShownElementSize(info, undefined, { box: 'border-box' });
    const { copy, copied, text: copiedText } = useClipboard({ legacy: true, copiedDuring: 1500 });
    const phase = ref<PressPhase>('idle');
    // 拖动开始时的位置点，取消时回到这里
    let origin: LocationPoint | null = null;

    // 图钉尖端在画布上的位置，随相机和画布尺寸重新投影；视图没就绪时不显示
    const anchor = computed(() => {
      void map.projectionRevision.value;
      const point = props.location.state.value.point;
      const view = map.view.value;
      return point && view ? view.project(point.lngLat) : null;
    });

    const gesture = createPressGesture({
      onPhase: next => {
        if (next === 'dragging') {
          origin = props.location.state.value.point;
        }
        phase.value = next;
      },
      onClick: () => props.location.setInfoOpen(!props.location.state.value.infoOpen),
      onDragMove: ({ x, y }) => {
        const rect = root.value?.getBoundingClientRect();
        const view = map.view.value;
        if (!rect || !view) {
          return;
        }
        const result = view.pick({ x: x - rect.left, y: y - rect.top });
        if (result.kind === 'hit') {
          props.location.place(result.lngLat, 'drag');
        }
      },
      onDragEnd: () => (origin = null),
      onDragCancel: () => {
        if (origin) {
          props.location.place(origin.lngLat, origin.source);
        }
        origin = null;
      }
    });
    onScopeDispose(() => gesture[Symbol.dispose]());
    useEventListener(document, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.phase !== 'idle') {
        gesture.cancel();
      }
    });
    // 拖动中所在页面被缓存（键盘或浏览器的前进后退切走）：和 Esc 一样回到拖动前的位置（ADR 0063）
    const pageActive = usePageActive();
    watch(pageActive, active => {
      if (!active && gesture.phase !== 'idle') {
        gesture.cancel();
      }
    });

    const onPointerdown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      // 拖出图钉后仍然收到移动和松开
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      gesture.down(client(event));
    };

    const renderPin = (point: ScreenPoint) => (
      <div
        class={[
          styles.pin,
          phase.value === 'pressing' && styles.pressing,
          phase.value === 'dragging' && styles.dragging,
          map.activeTool.value !== BROWSE_TOOL && styles.inert
        ]}
        style={position(point)}
        role="button"
        aria-label="坐标定位点"
        onPointerdown={onPointerdown}
        onPointermove={(event: PointerEvent) => gesture.move(client(event))}
        onPointerup={() => gesture.up()}
        onPointercancel={() => gesture.cancel()}
        onContextmenu={(event: MouseEvent) => event.preventDefault()}>
        <svg class={styles.ring} viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="18" />
        </svg>
        {phase.value === 'dragging' && <span class={styles.shadow} />}
        <SvgIcon class={styles.icon} name="location-pin" size={32} />
        <span class={styles.name}>坐标定位点</span>
      </div>
    );

    const renderInfo = (point: ScreenPoint) => {
      const { point: location } = props.location.state.value;
      if (!location) {
        return null;
      }
      // 只放在没被登记的悬浮元素挡住的区域里（设计稿 5D.7）；每次渲染时现量，面板开关后下一次重新投影时跟上
      const placement = placeLocationInfo(
        point,
        { width: infoSize.width.value, height: infoSize.height.value },
        { width: canvasSize.width.value, height: canvasSize.height.value },
        map.overlayPadding()
      );
      const closeButton = (
        <button
          type="button"
          class={styles.iconButton}
          aria-label="关闭位置信息"
          title="关闭位置信息"
          onClick={() => props.location.setInfoOpen(false)}>
          <SvgIcon name="close" size={14} />
        </button>
      );
      return (
        <div
          ref={info}
          class={[styles.info, styles[placement.side]]}
          style={{ left: `${placement.left}px`, top: `${placement.top}px` }}
          data-location-info={placement.side}>
          <span class={styles.caret} style={{ left: `${placement.caret}px` }} />
          <MxTitle class={styles.heading}>{{ default: () => '位置信息', extra: () => [closeButton] }}</MxTitle>
          {COPY_ROWS.map(({ format, label }) => {
            const value = formatLngLat(location.lngLat, format);
            const done = copied.value && copiedText.value === value;
            return (
              <div key={format} class={styles.row}>
                <span class={styles.key}>{label}</span>
                <span class={styles.value}>{value}</span>
                <button
                  type="button"
                  class={[styles.iconButton, done && styles.copied]}
                  aria-label={done ? `已复制${label}坐标` : `复制${label}坐标`}
                  title={done ? '已复制' : `复制${label}坐标`}
                  onClick={() => void copy(value)}>
                  <SvgIcon name={done ? 'check' : 'copy'} size={14} />
                </button>
              </div>
            );
          })}
          <div class={styles.row}>
            <span class={styles.key}>所在区划</span>
            <span class={styles.value}>{describeLocationRegion(props.location.region.value)}</span>
          </div>
          <div class={styles.footer}>
            <button type="button" class={styles.remove} onClick={props.location.remove}>
              删除位置点
            </button>
          </div>
        </div>
      );
    };

    return () => {
      const point = anchor.value;
      const pointer = props.location.pickPointer.value;
      return (
        <div ref={root} class={styles.overlay} data-location-overlay>
          {point && renderPin(point)}
          {point && props.location.state.value.infoOpen && renderInfo(point)}
          {map.activeTool.value === LOCATION_PICK_TOOL && pointer && (
            <PointerHint
              point={pointer}
              canvas={{ width: canvasSize.width.value, height: canvasSize.height.value }}
              lines={PICK_HINT}
            />
          )}
        </div>
      );
    };
  }
});
