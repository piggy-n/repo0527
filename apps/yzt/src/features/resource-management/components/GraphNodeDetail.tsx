import { ElTable, ElTableColumn, ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { DetailNode, GraphEdgeKind, GraphNodeDetail as Detail } from '../extraction/graph-model';
import { EDGE_STYLES } from '../extraction/graph-style';
import type { RelationField, RelationTable } from '../extraction/relation-graph';
import { EdgeKindSample } from './EdgeKindSample';
import styles from './GraphNodeDetail.module.scss';

// 数据表的说明和字段；没有字段说明的表只显示时点
function renderTable(table: RelationTable) {
  const facts = [table.geometry && `几何：${table.geometry}`, `时点：${table.period}`].filter(Boolean);
  return (
    <div key="table" class={styles.block}>
      <h4>
        数据表{table.fields && <span>{table.fields.length} 个字段</span>}
      </h4>
      {table.title && <p class={styles.meta}>{table.title}</p>}
      <p class={styles.meta}>{facts.join(' · ')}</p>
      {table.fields && (
        <ElTable class={styles.fields} data={table.fields} size="small" maxHeight={240} border>
          <ElTableColumn prop="code" label="字段" width="96" />
          <ElTableColumn label="名称" minWidth="120">
            {{
              default: ({ row }: { row: RelationField }) => (
                <>
                  <div>{row.name}</div>
                  {row.note && <div class={styles.note}>{row.note}</div>}
                </>
              )
            }}
          </ElTableColumn>
          <ElTableColumn prop="type" label="类型" width="88" />
        </ElTable>
      )}
    </div>
  );
}

function kindLabel(kind: GraphEdgeKind, label: string) {
  return (
    <span class={styles.kind} style={{ color: EDGE_STYLES[kind].text }}>
      <EdgeKindSample kind={kind} width={20} />
      {label}
    </span>
  );
}

/** 知识图谱选中节点的详情：层级、关联关系、下级、数据表字段；点关联的节点在图上定位过去 */
export const GraphNodeDetail = defineComponent({
  name: 'GraphNodeDetail',
  props: {
    detail: { type: Object as PropType<Detail | null>, default: null }
  },
  emits: {
    locate: (_id: string) => true
  },
  setup(props, { emit }) {
    function nodeButton(node: DetailNode) {
      return (
        <button type="button" class={styles.node} onClick={() => emit('locate', node.id)}>
          {node.code && <span class={styles.code}>{node.code}</span>}
          {node.name}
        </button>
      );
    }

    function renderRelations(detail: Detail) {
      if (detail.relations.length === 0) {
        return null;
      }
      return (
        <div key="relations" class={styles.block}>
          <h4>
            关联关系<span>{detail.relations.length}</span>
          </h4>
          <ul class={styles.list}>
            {detail.relations.map(relation => (
              <li key={relation.id} class={styles.line}>
                {kindLabel(relation.kind, relation.label)}
                {nodeButton(relation.other)}
                {relation.product && <span class={styles.product}>{relation.product}</span>}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    function renderChildRelations(detail: Detail) {
      if (detail.childRelations.length === 0) {
        return null;
      }
      return (
        <div key="child-relations" class={styles.block}>
          <h4>
            下级分类的关系<span>{detail.childRelations.length}</span>
          </h4>
          <ul class={styles.list}>
            {detail.childRelations.map(relation => (
              <li key={relation.id} class={styles.line}>
                {nodeButton(relation.inner)}
                {kindLabel(relation.kind, relation.label)}
                {nodeButton(relation.other)}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    function renderNodes(key: string, title: string, count: number | null, nodes: readonly DetailNode[]) {
      if (nodes.length === 0) {
        return null;
      }
      return (
        <div key={key} class={styles.block}>
          <h4>
            {title}
            {count !== null && <span>{count}</span>}
          </h4>
          <div class={styles.chips}>
            {nodes.map(node => (
              <span key={node.id}>{nodeButton(node)}</span>
            ))}
          </div>
        </div>
      );
    }

    return () => {
      const detail = props.detail;
      if (!detail) {
        return (
          <section class={styles.root} aria-live="polite">
            <strong class={styles.name}>请选择知识图谱节点</strong>
            <p class={styles.meta}>在图上点击节点，查看所在层级、关联关系和字段；双击可收起或展开下级</p>
          </section>
        );
      }
      return (
        <section class={styles.root} aria-live="polite">
          <div class={styles.head}>
            <div class={styles.title}>
              {detail.code && <span class={styles.code}>{detail.code}</span>}
              <strong class={styles.name}>{detail.name}</strong>
            </div>
            {detail.isTarget && (
              <ElTag size="small" type="success">
                已选中
              </ElTag>
            )}
          </div>
          <p class={styles.meta}>
            <span class={styles.dot} style={{ backgroundColor: detail.color }} />
            {detail.meta}
          </p>
          {detail.path.length > 0 && (
            <p key="path" class={styles.meta}>
              上级：{detail.path.map(item => [item.code, item.name].filter(Boolean).join(' ')).join(' / ')}
            </p>
          )}
          {detail.note && (
            <p key="note" class={styles.meta}>
              {detail.note}
            </p>
          )}
          {renderRelations(detail)}
          {renderChildRelations(detail)}
          {renderNodes('children', '下级', detail.children.length, detail.children)}
          {detail.table && renderTable(detail.table)}
          {renderNodes('datasets', detail.datasetsTitle, null, detail.datasets)}
        </section>
      );
    };
  }
});
