import type { ViewKind } from '@yzt/map-core';
import { useMap } from '@yzt/map-vue';
import { ElTooltip } from 'element-plus';
import { defineComponent, type PropType, type VNode } from 'vue';
import { type IconName, SvgIcon } from '../../icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import { useCompassButton } from './useCompassButton';
import { useZoomButtons } from './useZoomButtons';
import type { ZoomRange } from './zoom';
import styles from './MapViewControls.module.scss';

// 只有图标，悬停在左边提示名称
function withTip(content: string, child: VNode) {
  return (
    <ElTooltip {...MAP_TOOLTIP_PROPS} content={content} placement="left">
      {child}
    </ElTooltip>
  );
}

function iconButton(label: string, icon: IconName, onClick: () => void, disabled = false) {
  return withTip(
    label,
    <button type="button" class={styles.button} aria-label={label} disabled={disabled} onClick={onClick}>
      <SvgIcon name={icon} size={20} />
    </button>
  );
}

/**
 * 地图的基础组（ADR 0053 第 3 节、ADR 0058）：层级、放大、缩小、指北针、默认视角、2D/3D，只有图标，悬停在左边提示名称。
 * 角落里的小控件，不登记为悬浮元素（第 9 节）；放在 provideMap 所在组件的子孙里
 */
export const MapViewControls = defineComponent({
  name: 'MapViewControls',
  props: {
    /** 页面的 useDefaultView 给出的回调；不要在这里调用 useDefaultView（ADR 0033） */
    goToDefaultView: { type: Function as PropType<() => void>, required: true },
    /** 和画布的缩放范围相同 */
    zoomRange: { type: Object as PropType<ZoomRange>, required: true },
    /** 当前是二维还是三维；不传时三维按钮不可用（三维阶段之前，ADR 0053 第 3 节） */
    dimension: { type: String as PropType<ViewKind>, default: undefined }
  },
  emits: {
    'update:dimension': (value: ViewKind) => value === '2d' || value === '3d'
  },
  setup(props, { emit }) {
    const map = useMap();
    const zoom = useZoomButtons(map, props.zoomRange);
    const compass = useCompassButton(map);

    const dimensionButton = (value: ViewKind, label: string, text: string) => {
      const current = props.dimension === value;
      return (
        <button
          type="button"
          class={[styles.button, current && styles.current]}
          aria-label={label}
          aria-pressed={current}
          onClick={() => {
            if (!current) {
              emit('update:dimension', value);
            }
          }}
        >
          {text}
        </button>
      );
    };

    const renderDimension = () => {
      if (props.dimension !== undefined) {
        return [dimensionButton('2d', '二维', '2D'), dimensionButton('3d', '三维', '3D')];
      }
      return [
        <button type="button" class={[styles.button, styles.current]} aria-label="二维" aria-pressed="true">
          2D
        </button>,
        // 三维阶段之前点了没有效果（用户决定显示，ADR 0053 第 3 节）
        withTip(
          '三维暂未开放',
          <button type="button" class={styles.button} aria-label="三维" aria-pressed="false" aria-disabled="true">
            3D
          </button>
        )
      ];
    };

    return () => (
      <div class={styles.controls} role="toolbar" aria-label="地图视角" aria-orientation="vertical">
        {withTip(
          zoom.title.value,
          <div class={styles.level} role="status" aria-label={zoom.title.value} tabindex={0}>
            {zoom.level.value}
          </div>
        )}
        <div class={styles.separator} role="separator" />
        {iconButton('放大', 'map-zoom-in', zoom.zoomIn, !zoom.canZoomIn.value)}
        {iconButton('缩小', 'map-zoom-out', zoom.zoomOut, !zoom.canZoomOut.value)}
        {withTip(
          compass.title.value,
          <button type="button" class={styles.button} aria-label={compass.title.value} onClick={compass.resetNorth}>
            <SvgIcon name="map-compass-color" size={20} rotate={compass.rotation.value} />
          </button>
        )}
        <div class={styles.separator} role="separator" />
        {iconButton('默认视角', 'map-default-view', props.goToDefaultView)}
        <div class={styles.separator} role="separator" />
        <div class={styles.dimension}>{renderDimension()}</div>
      </div>
    );
  }
});
