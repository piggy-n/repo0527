import { ElTooltip } from 'element-plus';
import { defineComponent, type PropType, type SlotsType } from 'vue';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { KnowledgeGraphOwner, LegendEdge } from '../composables/knowledge-graph-owner';
import { EDGE_STYLES, NODE_STYLES } from '../extraction/graph-style';
import { EdgeKindSample } from './EdgeKindSample';
import { KnowledgeGraphChart } from './KnowledgeGraphChart';
import styles from './KnowledgeGraphPanel.module.scss';

function edgeContent(item: LegendEdge) {
  return [
    <EdgeKindSample key="sample" kind={item.kind} />,
    <span key="label">{EDGE_STYLES[item.kind].label}</span>,
    <span key="count" class={styles.count}>
      {item.available ? item.count : '待补充'}
    </span>
  ];
}

/** 知识图谱的面板：上面是可选的筛选栏（插槽），中间是画布，下面是节点和关系的图例；图例不盖在画布上，不遮挡节点 */
export const KnowledgeGraphPanel = defineComponent({
  name: 'KnowledgeGraphPanel',
  props: {
    owner: { type: Object as PropType<KnowledgeGraphOwner>, required: true }
  },
  slots: Object as SlotsType<{ toolbar?: () => unknown }>,
  setup(props, { slots }) {
    const owner = props.owner;

    // 能开关的是按钮；组织关系和上下级一直显示，只是说明
    function renderEdge(item: LegendEdge) {
      const style = EDGE_STYLES[item.kind];
      const description = item.available ? style.description : `${style.description}（暂无关系数据）`;
      return (
        <ElTooltip key={item.kind} {...MAP_TOOLTIP_PROPS} content={description} placement="top">
          {item.toggleable || !item.available ? (
            <button
              type="button"
              class={[styles.edge, styles.toggle, !item.shown && styles.off]}
              aria-pressed={item.shown}
              aria-disabled={!item.toggleable}
              onClick={() => item.toggleable && owner.toggleKind(item.kind)}
            >
              {edgeContent(item)}
            </button>
          ) : (
            <span class={styles.edge}>{edgeContent(item)}</span>
          )}
        </ElTooltip>
      );
    }

    return () => (
      <div class={styles.root}>
        {slots.toolbar?.()}
        <div class={styles.canvas}>
          <KnowledgeGraphChart
            view={owner.view.value}
            layoutInput={owner.layoutInput.value}
            selectedId={owner.selectedId.value}
            title={owner.title}
            onSelect={owner.select}
            onToggle={owner.toggleCollapsed}
          />
        </div>
        <div class={styles.legend}>
          <div class={styles.group} role="group" aria-label="节点类型">
            {owner.legendNodes.map(id => {
              const style = NODE_STYLES[id];
              return (
                <span key={id} class={styles.node}>
                  <i
                    class={[styles.dot, id === 'dataset' && styles.box]}
                    style={{ backgroundColor: style.fill, borderColor: style.border ?? style.fill }}
                  />
                  {style.label}
                </span>
              );
            })}
          </div>
          <div class={styles.group} role="group" aria-label="关系类型">
            {owner.legendEdges.value.map(renderEdge)}
          </div>
        </div>
      </div>
    );
  }
});
