import { ElCheckTag, ElTag } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { RelationGraphOwner } from '../composables/useRelationGraph';
import styles from './RelationToolbar.module.scss';

/** 水资源图的筛选栏：数据成果的勾选标签和检索标签 */
export const RelationToolbar = defineComponent({
  name: 'RelationToolbar',
  props: {
    owner: { type: Object as PropType<RelationGraphOwner>, required: true }
  },
  setup(props) {
    const owner = props.owner;
    return () => (
      <div class={styles.toolbar}>
        <div class={styles.products} role="group" aria-label="数据成果">
          <span class={styles.label}>数据成果</span>
          {owner.graph.products.map(product => (
            <ElCheckTag
              key={product.id}
              class={styles.productTag}
              checked={!owner.hiddenProducts.value.has(product.id)}
              onChange={() => owner.toggleProduct(product.id)}
            >
              {product.name}
            </ElCheckTag>
          ))}
        </div>
        {owner.keyword.value && (
          <ElTag class={styles.keyword} closable onClose={owner.clearKeyword}>
            检索：{owner.keyword.value} · 命中 {owner.view.value.matches.size}
          </ElTag>
        )}
      </div>
    );
  }
});
