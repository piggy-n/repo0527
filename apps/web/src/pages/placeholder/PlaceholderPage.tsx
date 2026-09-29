import { ElEmpty } from 'element-plus';
import { defineComponent } from 'vue';
import { useRoute } from 'vue-router';
import styles from './PlaceholderPage.module.scss';

/** 尚未迁移的业务页共用的占位页 */
export const PlaceholderPage = defineComponent({
  name: 'PlaceholderPage',
  setup() {
    const route = useRoute();

    return () => (
      <div class={styles.root}>
        <ElEmpty description={`${route.meta.title ?? route.path}：迁移中`} />
      </div>
    );
  }
});
