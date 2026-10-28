import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { PrepareStatus } from '@/shared/data-request/prepare-status';
import { QueryForm } from '@/shared/query-form/QueryForm';
import type { ApplicationFilters, AuditStatus } from '../api';
import { AUDIT_STATUS_OPTIONS, PREPARE_STATUS_OPTIONS } from '../status';

/** 申请列表的筛选栏：编辑表单不触发请求，点"查询"或在名称框按回车才生效 */
export const ApplicationFilterBar = defineComponent({
  name: 'ApplicationFilterBar',
  props: {
    // 和 ElForm 的 model 一样，直接修改传入的响应式对象的字段
    model: { type: Object as PropType<ApplicationFilters>, required: true }
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
                modelValue={props.model.name}
                onUpdate:modelValue={(value: string) => {
                  props.model.name = value;
                }}
                placeholder="请输入数据名称"
                clearable
                onKeydown={(event: Event | KeyboardEvent) => {
                  // 输入法选字时按的回车只是确认候选词，不查询
                  if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                    emit('search');
                  }
                }}
              />
            </ElFormItem>,
            <ElFormItem label="审核状态">
              <ElSelect
                placeholder="全部"
                clearable
                modelValue={props.model.status}
                onUpdate:modelValue={(value: AuditStatus | undefined) => {
                  props.model.status = value ?? '';
                }}
              >
                {AUDIT_STATUS_OPTIONS.map(option => (
                  <ElOption key={option.value} label={option.label} value={option.value} />
                ))}
              </ElSelect>
            </ElFormItem>,
            <ElFormItem label="数据准备状态">
              <ElSelect
                placeholder="全部"
                clearable
                modelValue={props.model.prepare}
                onUpdate:modelValue={(value: PrepareStatus | undefined) => {
                  props.model.prepare = value ?? '';
                }}
              >
                {PREPARE_STATUS_OPTIONS.map(option => (
                  <ElOption key={option.value} label={option.label} value={option.value} />
                ))}
              </ElSelect>
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
