import { ElSkeleton, ElSkeletonItem } from 'element-plus';
import { defineComponent } from 'vue';

// 足够铺满常见高度的表体，多出的行被裁掉
const ROW_COUNT = 20;
// 每行的长度略有差别，看起来更像内容
const ROW_WIDTHS = ['100%', '92%', '96%', '88%'];

/** 表格首次加载时的骨架：放在 ElTable 的 empty 插槽里，表头不动，骨架行与数据行同高（见 docs/modules/table.md） */
export const TableSkeleton = defineComponent({
  name: 'TableSkeleton',
  setup() {
    // 样式在 element-theme.scss：要撑开 Element 的空状态区域，行高也要和表格的行高规则一起改
    return () => (
      <ElSkeleton class="table-skeleton" animated>
        {{
          template: () =>
            Array.from({ length: ROW_COUNT }, (_, index) => (
              <div key={index} class="table-skeleton__row">
                <ElSkeletonItem variant="text" style={{ width: ROW_WIDTHS[index % ROW_WIDTHS.length] }} />
              </div>
            ))
        }}
      </ElSkeleton>
    );
  }
});
