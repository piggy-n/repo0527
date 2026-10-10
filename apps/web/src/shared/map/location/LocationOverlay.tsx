import { Close, CopyDocument, LocationFilled } from '@element-plus/icons-vue';
import { useClipboard, useElementSize, useEventListener } from '@vueuse/core';
import { ElButton, ElIcon } from 'element-plus';
import { BROWSE_TOOL, type ScreenPoint } from '@yzt/map-core';
import { useMap } from '@yzt/map-vue';
import { computed, defineComponent, onScopeDispose, type PropType, ref } from 'vue';
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

/**
 * 位置点的图钉、位置信息和拾取提示（联调用的界面，5D 再设计；ADR 0037 第 5 条）。
 * 和画布放在同一个定位参照里盖在上面；当前工具不是"移动"时图钉不响应鼠标，单击落到地图上
 */
export const LocationOverlay = defineComponent({
  name: 'LocationOverlay',
  props: {
    location: { type: Object as PropType<LocationPointOwner>, required: true }
  },
  setup(props) {
    const map = useMap();
    const camera = map.useCamera();
    const root = ref<HTMLElement>();
    const info = ref<HTMLElement>();
    const canvasSize = useElementSize(root);
    const infoSize = useElementSize(info);
    const { copy, copied, text: copiedText } = useClipboard({ legacy: true, copiedDuring: 1500 });
    const phase = ref<PressPhase>('idle');
    // 拖动开始时的位置点，取消时回到这里
    let origin: LocationPoint | null = null;

    // 图钉尖端在画布上的位置，随相机重新投影；视图没就绪时不显示
    const anchor = computed(() => {
      void camera.value;
      const point = props.location.state.value.point;
      const view = map.view.value;
      return point && map.viewState.value === 'ready' && view ? view.project(point.lngLat) : null;
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
        if (!rect || !view || map.viewState.value !== 'ready') {
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
        <ElIcon class={styles.icon}>
          <LocationFilled />
        </ElIcon>
        <span class={styles.name}>坐标定位点</span>
      </div>
    );

    const renderInfo = (point: ScreenPoint) => {
      const { point: location } = props.location.state.value;
      if (!location) {
        return null;
      }
      const placement = placeLocationInfo(
        point,
        { width: infoSize.width.value, height: infoSize.height.value },
        { width: canvasSize.width.value, height: canvasSize.height.value }
      );
      return (
        <div
          ref={info}
          class={styles.info}
          style={{ left: `${placement.left}px`, top: `${placement.top}px` }}
          data-location-info={placement.side}>
          <div class={styles.header}>
            <span class={styles.title}>位置信息</span>
            <ElButton
              link
              icon={Close}
              aria-label="关闭位置信息"
              onClick={() => props.location.setInfoOpen(false)}
            />
          </div>
          {COPY_ROWS.map(({ format, label }) => {
            const value = formatLngLat(location.lngLat, format);
            return (
              <div key={format} class={styles.row}>
                <span class={styles.key}>{label}</span>
                <span class={styles.value}>{value}</span>
                <ElButton link icon={CopyDocument} aria-label={`复制${label}坐标`} onClick={() => void copy(value)}>
                  {copied.value && copiedText.value === value ? '已复制' : ''}
                </ElButton>
              </div>
            );
          })}
          <div class={styles.row}>
            <span class={styles.key}>所在区划</span>
            <span class={styles.value}>{describeLocationRegion(props.location.region.value)}</span>
          </div>
          <ElButton link type="danger" onClick={props.location.remove}>
            删除位置点
          </ElButton>
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
            <div class={styles.hint} style={position(pointer)}>
              点击地图拾取点位，Esc 取消
            </div>
          )}
        </div>
      );
    };
  }
});
