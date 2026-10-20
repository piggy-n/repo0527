import { defineComponent, type PropType, ref, watch } from 'vue';
import { OpacityToggle } from '../OpacityToggle';
import { BoundaryPanel } from './BoundaryPanel';
import type { Boundaries } from './useBoundaries';

/** 行政区标签中的设置，切走或收起时结束透明度展开 */
export const BoundarySettingsPanel = defineComponent({
  name: 'BoundarySettingsPanel',
  props: {
    boundaries: { type: Object as PropType<Boundaries>, required: true },
    active: { type: Boolean, default: true }
  },
  setup(props) {
    const opacityOpen = ref(false);
    watch(() => props.active, active => {
      if (!active) {
        opacityOpen.value = false;
      }
    });
    return () => (
      <BoundaryPanel boundaries={props.boundaries} showOpacity={opacityOpen.value}>
        {{
          actions: () => [
            <OpacityToggle label="行政区" open={opacityOpen.value} onUpdate:open={open => (opacityOpen.value = open)} />
          ]
        }}
      </BoundaryPanel>
    );
  }
});
