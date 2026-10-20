import { Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElTooltip } from 'element-plus';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import { BoundaryPanel } from '../boundary/BoundaryPanel';
import type { Boundaries } from '../boundary/useBoundaries';
import { BasemapPanel } from './BasemapPanel';
import type { Basemap } from './useBasemap';
import styles from './BasemapWindow.module.scss';

/** 底图和行政区边界的独立浮窗，不参与功能面板的标签与统一关闭（ADR 0066） */
export const BasemapWindow = defineComponent({
  name: 'BasemapWindow',
  props: {
    basemap: { type: Object as PropType<Basemap>, required: true },
    boundaries: { type: Object as PropType<Boundaries>, required: true },
    open: { type: Boolean, default: false },
    visible: { type: Boolean, default: true }
  },
  emits: {
    close: () => true
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    // 透明度是次要操作，每次打开浮窗默认收起
    const opacityOpen = ref(false);
    watch(() => props.open, open => {
      if (!open) {
        opacityOpen.value = false;
      }
    });
    return () => (
      <div
        ref={element}
        class={styles.window}
        style={props.open && props.visible ? undefined : { display: 'none' }}
        data-basemap-window>
        {props.open && (
          <MxPanel floating title="底图" class={styles.panel}>
            {{
              actions: () => [
                <ElTooltip content="调整透明度" placement="top">
                  <button
                    type="button"
                    class={styles.opacity}
                    aria-label="调整底图与边界透明度"
                    aria-expanded={opacityOpen.value}
                    onClick={() => (opacityOpen.value = !opacityOpen.value)}>
                    <SvgIcon name="layer-opacity" size={16} />
                  </button>
                </ElTooltip>,
                <ElButton link icon={Close} aria-label="关闭底图" onClick={() => emit('close')} />
              ],
              default: () => [
                <BasemapPanel basemap={props.basemap} showOpacity={opacityOpen.value} />,
                <MxTitle class={styles.heading} level="section">行政区</MxTitle>,
                <BoundaryPanel boundaries={props.boundaries} showOpacity={opacityOpen.value} />
              ]
            }}
          </MxPanel>
        )}
      </div>
    );
  }
});
