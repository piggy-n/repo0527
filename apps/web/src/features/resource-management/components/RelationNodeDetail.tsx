import { ElTable, ElTableColumn, ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { RelationGraphOwner } from '../composables/useRelationGraph';
import type { RelationField, RelationNode } from '../extraction/relation-graph';
import { productColor, RELATION_KIND_STYLES } from '../extraction/relation-style';
import type { RelationNodeDetail as Detail } from '../extraction/relation-view';
import { RelationKindSample } from './RelationKindSample';
import styles from './RelationNodeDetail.module.scss';

const LEVEL_NAMES = ['一级类', '二级类', '三级类'];

function levelName(node: RelationNode): string {
  if (node.level === null) {
    return '数据表';
  }
  return LEVEL_NAMES[node.level - 1] ?? `${node.level} 级类`;
}

// 数据表的说明和字段；没有字段说明的表只显示时点
function renderTable(node: RelationNode) {
  const table = node.table;
  if (!table) {
    return null;
  }
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

/** 关系图选中节点的详情：层级、关联关系、下级、数据表字段；点关联的节点在图上定位过去 */
export const RelationNodeDetail = defineComponent({
  name: 'RelationNodeDetail',
  props: {
    owner: { type: Object as PropType<RelationGraphOwner>, required: true }
  },
  setup(props) {
    const owner = props.owner;

    function nodeButton(node: RelationNode) {
      return (
        <button type="button" class={styles.node} onClick={() => owner.locate(node.id)}>
          <span class={styles.code}>{node.code}</span>
          {node.name}
        </button>
      );
    }

    const productNames = new Map(owner.graph.products.map(product => [product.id, product.name]));

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
            {detail.relations.map(({ relation, other }) => (
              <li key={relation.id} class={styles.line}>
                <span class={styles.kind} style={{ color: RELATION_KIND_STYLES[relation.kind].color }}>
                  <RelationKindSample kind={relation.kind} width={16} />
                  {RELATION_KIND_STYLES[relation.kind].label}
                </span>
                {nodeButton(other)}
                <span class={styles.product}>{productNames.get(other.productId)}</span>
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
            {detail.childRelations.map(({ relation, inner, other }) => (
              <li key={relation.id} class={styles.line}>
                {nodeButton(inner)}
                <span class={styles.kind} style={{ color: RELATION_KIND_STYLES[relation.kind].color }}>
                  <RelationKindSample kind={relation.kind} width={16} />
                  {RELATION_KIND_STYLES[relation.kind].label}
                </span>
                {nodeButton(other)}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    function renderChildren(detail: Detail) {
      if (detail.children.length === 0) {
        return null;
      }
      return (
        <div key="children" class={styles.block}>
          <h4>
            下级分类<span>{detail.children.length}</span>
          </h4>
          <div class={styles.chips}>
            {detail.children.map(child => (
              <span key={child.id}>{nodeButton(child)}</span>
            ))}
          </div>
        </div>
      );
    }

    function renderDatasets(detail: Detail) {
      if (detail.productDatasets.length === 0) {
        return null;
      }
      return (
        <div key="datasets" class={styles.block}>
          <h4>{detail.product.name}的数据表</h4>
          <div class={styles.chips}>
            {detail.productDatasets.map(dataset => (
              <span key={dataset.id}>{nodeButton(dataset)}</span>
            ))}
          </div>
        </div>
      );
    }

    return () => {
      const detail = owner.detail.value;
      if (!detail) {
        return (
          <section class={styles.root} aria-live="polite">
            <strong class={styles.name}>请选择关系图节点</strong>
            <p class={styles.meta}>在关系图中点击分类或数据表，查看所在层级、关联关系和字段</p>
          </section>
        );
      }
      const { node, product, path } = detail;
      const productIndex = owner.graph.products.indexOf(product);
      return (
        <section class={styles.root} aria-live="polite">
          <div class={styles.head}>
            <div class={styles.title}>
              <span class={styles.code}>{node.code}</span>
              <strong class={styles.name}>{node.name}</strong>
            </div>
            <ElTag size="small" type="success">
              已选中
            </ElTag>
          </div>
          <p class={styles.meta}>
            <span class={styles.dot} style={{ backgroundColor: productColor(productIndex) }} />
            {product.name} · {levelName(node)}
          </p>
          {path.length > 0 && (
            <p key="path" class={styles.meta}>
              上级：{path.map(item => `${item.code} ${item.name}`).join(' / ')}</p>
          )}
          {renderRelations(detail)}
          {renderChildRelations(detail)}
          {renderChildren(detail)}
          {renderTable(node)}
          {renderDatasets(detail)}
        </section>
      );
    };
  }
});
