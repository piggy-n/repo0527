import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElFormItem, ElInput } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { QueryForm } from '@/shared/query-form/QueryForm';
import type { ReportFilters } from '../api';

/** 统计报表的筛选栏：只按报表名称；编辑不触发请求，点"查询"或按回车才生效 */
export const ReportFilterBar = defineComponent({
  name: 'ReportFilterBar',
  props: {
    // 和 ElForm 的 model 一样，直接修改传入的响应式对象的字段
    model: { type: Object as PropType<ReportFilters>, required: true }
  },
  emits: {
    search: () => true,
    reset: () => true
  },
  setup(props, { emit }) {
    return () => (
      <QueryForm labelChars={4}>
        {{
          default: () => [
            <ElFormItem label="报表名称">
              <ElInput
                modelValue={props.model.name}
                onUpdate:modelValue={(value: string) => {
                  props.model.name = value;
                }}
                placeholder="请输入报表名称"
                clearable
                onKeydown={(event: Event | KeyboardEvent) => {
                  // 输入法选字时按的回车只是确认候选词，不查询
                  if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                    emit('search');
                  }
                }}
              />
            </ElFormItem>
          ],
          actions: () => [
            <ElButton type="primary" icon={Search} onClick={() => emit('search')}>
              查询
            </ElButton>,
            <ElButton icon={RefreshLeft} onClick={() => emit('reset')}>
              重置
            </ElButton>
          ]
        }}
      </QueryForm>
    );
  }
});
