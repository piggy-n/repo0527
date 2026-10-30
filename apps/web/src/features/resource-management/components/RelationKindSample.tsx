import { defineComponent, type PropType } from 'vue';
import type { RelationKind } from '../extraction/relation-graph';
import { RELATION_KIND_STYLES } from '../extraction/relation-style';

/** 图例里的一小段线：和图上的关系线同色、同线型。按数据画的图形，不是图标 */
export const RelationKindSample = defineComponent({
  name: 'RelationKindSample',
  props: {
    kind: { type: String as PropType<RelationKind>, required: true },
    width: { type: Number, default: 24 }
  },
  setup(props) {
    return () => {
      const style = RELATION_KIND_STYLES[props.kind];
      return (
        <svg width={props.width} height="8" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
          <line
            x1="2"
            y1="4"
            x2={props.width - 2}
            y2="4"
            stroke={style.color}
            stroke-width="2"
            stroke-linecap="round"
            stroke-dasharray={style.dash ?? undefined}
          />
        </svg>
      );
    };
  }
});
