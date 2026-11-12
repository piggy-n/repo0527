import type { ViewKind } from '@mx/map-core';
import { useMap } from '@mx/map-vue';
import { ElTooltip } from 'element-plus';
import { defineComponent, type PropType, type VNode } from 'vue';
import { type IconName, SvgIcon } from '../../icons/SvgIcon';
import { BoundarySettingsPanel } from '../boundary/BoundarySettingsPanel';
import type { Boundaries } from '../boundary/useBoundaries';
import { type MapOptionsContext, MapOptionsPopover } from '../popover/MapOptionsPopover';
import { TOOLBAR_ACTIONS } from '../toolbar/toolbar-items';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import { useCompassButton } from './useCompassButton';
import { useZoomButtons } from './useZoomButtons';
import type { ZoomRange } from './zoom';
import styles from './MapViewControls.module.scss';

// 只有图标，悬停在左边提示名称
function withTip(content: string, child: VNode, disabled = false) {
  return (
    <ElTooltip {...MAP_TOOLTIP_PROPS} content={content} placement="left" disabled={disabled}>
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
 * 地图的基础组（ADR 0053 第 3 节、ADR 0058）：层级、放大、缩小、指北针、默认视角、2D/3D，只有图标，悬停在左边提示名称；
 * 不支持三维的页面没有 2D/3D（ADR 0111）；页面给出行政区边界的拥有者时有它的入口（ADR 0128）。
 * 角落里的小控件，不登记为悬浮元素（第 9 节）；放在 provideMap 所在组件的子孙里
 */
export const MapViewControls = defineComponent({
  name: 'MapViewControls',
  props: {
    /** 页面的 useDefaultView 给出的回调；不要在这里调用 useDefaultView（ADR 0033） */
    goToDefaultView: { type: Function as PropType<() => void>, required: true },
    /** 和画布当前种类的缩放范围相同：支持三维的页面按 dimension 传二维或三维的范围 */
    zoomRange: { type: Object as PropType<ZoomRange>, required: true },
    /** 当前是二维还是三维；不传时不显示 2D/3D（页面不支持三维，ADR 0111） */
    dimension: { type: String as PropType<ViewKind>, default: undefined },
    /** 显示默认视角；地下空间时页面传 false：飞到全省会离开模型 */
    defaultView: { type: Boolean, default: true },
    /** 行政区边界的拥有者；不传时没有这个入口（现状底图的入口在业务组） */
    boundaries: { type: Object as PropType<Boundaries>, default: undefined },
    /** 行政区边界浮层的开关由页面持有（窄屏时和左侧面板互斥），同底图卡 */
    boundariesOpen: { type: Boolean, default: false },
    /** 窄屏让给另一边、地图不在看时为 false：浮层不显示，按钮不显示为按下 */
    boundariesVisible: { type: Boolean, default: true }
  },
  emits: {
    'update:dimension': (value: ViewKind) => value === '2d' || value === '3d',
    'update:boundariesOpen': (open: boolean) => typeof open === 'boolean'
  },
  setup(props, { emit }) {
    const map = useMap();
    const zoom = useZoomButtons(map, () => props.zoomRange);
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

    const dimensionShown = () => props.dimension !== undefined;

    // 点开是和底图卡同样的左侧浮层，默认只有三级勾选，透明度入口在同一行；勾选和透明度都在拥有者里（ADR 0146）
    const renderBoundaries = (boundaries: Boundaries) => {
      const { label, icon } = TOOLBAR_ACTIONS.boundaries;
      const pressed = props.boundariesOpen && props.boundariesVisible;
      return (
        <MapOptionsPopover
          key="boundaries"
          name="boundaries"
          placement="left-end"
          open={props.boundariesOpen}
          visible={props.boundariesVisible}
          onUpdate:open={open => emit('update:boundariesOpen', open)}
        >
          {{
            reference: () => [
              withTip(
                label,
                <button
                  type="button"
                  class={[styles.button, pressed && styles.current, props.boundariesOpen && styles.opened]}
                  aria-label={label}
                  aria-pressed={pressed}
                >
                  <SvgIcon name={icon} size={20} />
                </button>,
                pressed
              )
            ],
            default: ({ active }: MapOptionsContext) => [
              <BoundarySettingsPanel boundaries={boundaries} active={active} />
            ]
          }}
        </MapOptionsPopover>
      );
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
        {/* 行政区边界不紧贴底图卡：两边的浮层都向左打开，隔开默认视角一段、向上展开才不互相压住 */}
        {props.boundaries && <div key="boundaries-separator" class={styles.separator} role="separator" />}
        {props.boundaries && renderBoundaries(props.boundaries)}
        {/* 默认视角（地下空间时没有）和 2D/3D（不支持三维时没有）各自一段，段之间加分隔线 */}
        {(props.defaultView || dimensionShown()) && <div class={styles.separator} role="separator" />}
        {props.defaultView && iconButton('默认视角', 'map-default-view', props.goToDefaultView)}
        {props.defaultView && dimensionShown() && <div class={styles.separator} role="separator" />}
        {dimensionShown() && (
          <div class={styles.dimension}>
            {dimensionButton('2d', '二维', '2D')}
            {dimensionButton('3d', '三维', '3D')}
          </div>
        )}
      </div>
    );
  }
});
