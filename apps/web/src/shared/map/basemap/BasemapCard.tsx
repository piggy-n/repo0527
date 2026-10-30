import { defineComponent, type PropType } from 'vue';
import { MapCard } from '../card/MapCard';
import { MapOptionsPopover } from '../popover/MapOptionsPopover';
import { basemapOption } from './basemap-style';
import { BasemapPanel } from './BasemapPanel';
import { BasemapThumbnail } from './BasemapThumbnail';
import type { Basemap } from './useBasemap';

/**
 * 底图入口（ADR 0053、0111）：当前底图的缩略图卡片，点开是左侧的底图浮层，透明度在浮层的标题栏。
 * 开关由页面持有（窄屏时和左侧面板互斥），底图的选择在拥有者里；放在页面右下角，地图控制栏下面
 */
export const BasemapCard = defineComponent({
  name: 'BasemapCard',
  props: {
    basemap: { type: Object as PropType<Basemap>, required: true },
    open: { type: Boolean, default: false },
    /** 窄屏让给另一边、地图不在看时为 false：浮层不显示，卡片不显示为按下 */
    visible: { type: Boolean, default: true }
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** 浮层定位后的视口顶部，上方的面板据此让出空间 */
    topChange: (top: number | null) => top === null || Number.isFinite(top)
  },
  setup(props, { emit }) {
    return () => {
      const { basemap } = props;
      const current = basemapOption(basemap.selected.value);
      return (
        <MapOptionsPopover
          name="basemap"
          label="底图"
          opacity={basemap.opacity.value}
          open={props.open}
          visible={props.visible}
          onTopChange={top => emit('topChange', top)}
          onOpacityChange={basemap.setOpacity}
          onUpdate:open={open => emit('update:open', open)}
        >
          {{
            reference: () => [
              <MapCard label={current.shortLabel} name={`底图：${current.label}`} pressed={props.visible && props.open}>
                {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[current.id]} />] }}
              </MapCard>
            ],
            default: () => [<BasemapPanel basemap={basemap} showOpacity={false} />]
          }}
        </MapOptionsPopover>
      );
    };
  }
});
