import { defineComponent, type PropType } from 'vue';
import type { GraphEdgeKind } from '../extraction/graph-model';
import { EDGE_STYLES } from '../extraction/graph-style';

/** 图例里的一小段线：和图上的关系线同色、同线型，带箭头。按数据画的图形，不是图标 */
export const EdgeKindSample = defineComponent({
  name: 'EdgeKindSample',
  props: {
    kind: { type: String as PropType<GraphEdgeKind>, required: true },
    width: { type: Number, default: 26 }
  },
  setup(props) {
    return () => {
      const style = EDGE_STYLES[props.kind];
      const lineEnd = props.width - 7;
      return (
        <svg width={props.width} height="8" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
          <line
            x1="1"
            y1="4"
            x2={lineEnd}
            y2="4"
            stroke={style.color}
            stroke-width="2"
            stroke-dasharray={style.dash?.join(' ')}
          />
          <path d={`M${lineEnd} 1 L${props.width - 1} 4 L${lineEnd} 7 Z`} fill={style.color} />
        </svg>
      );
    };
  }
});
