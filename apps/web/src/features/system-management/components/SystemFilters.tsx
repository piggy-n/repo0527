import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { QueryForm } from '@/shared/query-form/QueryForm';
import type { SystemFilters as Filters } from '../api';
import { auditLabels, taskLabels } from '../presentation';

/** 筛选沿用公共查询表单，编辑值与已应用条件由拥有者分开保存 */
export const SystemFilters = defineComponent({
  name: 'SystemFilters',
  props: {
    form: { type: Object as PropType<Filters>, required: true },
    audit: Boolean
  },
  emits: {
    search: () => true,
    reset: () => true
  },
  setup(props, { emit }) {
    return () => (
      <QueryForm labelChars={6}>
        {{
          default: () => [
            <ElFormItem label="数据名称">
              <ElInput
                modelValue={props.form.name}
                onUpdate:modelValue={(value: string) => (props.form.name = value)}
                placeholder="请输入数据名称"
                clearable
                onKeydown={event => {
                  if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                    emit('search');
                  }
                }}
              />
            </ElFormItem>,
            props.audit && (
              <ElFormItem label="审核状态">
                <ElSelect
                  modelValue={props.form.status}
                  onUpdate:modelValue={(value: Filters['status']) => (props.form.status = value)}
                >
                  <ElOption value="all" label="全部" />
                  {(['pending', 'approved', 'rejected'] as const).map(status => (
                    <ElOption key={status} value={status} label={auditLabels[status]} />
                  ))}
                </ElSelect>
              </ElFormItem>
            ),
            props.audit && (
              <ElFormItem label="数据准备状态">
                <ElSelect
                  modelValue={props.form.taskStatus}
                  onUpdate:modelValue={(value: Filters['taskStatus']) => (props.form.taskStatus = value)}
                >
                  <ElOption value="all" label="全部" />
                  {Object.entries(taskLabels).map(([value, label]) => (
                    <ElOption key={value} value={value} label={label} />
                  ))}
                </ElSelect>
              </ElFormItem>
            )
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
