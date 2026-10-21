import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { QueryForm } from '@/shared/query-form/QueryForm';
import type { ResourceYear } from '../api';
import type { ResourceFilters } from '../composables/useResourceList';

/** 名称和年份先编辑草稿，明确查询时才应用到请求 */
export const ResourceFilterBar = defineComponent({
  name: 'ResourceFilterBar',
  props: {
    model: { type: Object as PropType<ResourceFilters>, required: true },
    years: { type: Array as PropType<ResourceYear[]>, required: true },
    loadingYears: Boolean,
    errorYears: Boolean,
    disabled: Boolean
  },
  emits: { search: () => true, reset: () => true },
  setup(props, { emit }) {
    const showLoading = useDelayedFlag(() => props.loadingYears);
    return () => (
      <QueryForm labelChars={4}>
        {{
          default: () => [
            <ElFormItem label="资源名称">
              <ElInput
                modelValue={props.model.name}
                onUpdate:modelValue={(value: string) => { props.model.name = value; }}
                placeholder="请输入资源名称"
                clearable
                disabled={props.disabled}
                onKeydown={(event: Event | KeyboardEvent) => {
                  if (event instanceof KeyboardEvent && event.key === 'Enter') {
                    event.preventDefault();
                    if (!event.isComposing) { emit('search'); }
                  }
                }}
              />
            </ElFormItem>,
            <ElFormItem label="年份">
              <ElSelect
                modelValue={props.model.year}
                onUpdate:modelValue={(value: string | undefined) => { props.model.year = value ?? ''; }}
                placeholder="全部"
                clearable
                loading={showLoading.value}
                disabled={props.disabled || props.errorYears}
              >
                {props.years.map(year => <ElOption key={year.value} label={year.label} value={year.value} />)}
              </ElSelect>
            </ElFormItem>
          ],
          actions: () => [
            <ElButton type="primary" icon={Search} disabled={props.disabled} onClick={() => emit('search')}>
              查询
            </ElButton>,
            <ElButton icon={RefreshLeft} disabled={props.disabled} onClick={() => emit('reset')}>重置</ElButton>
          ]
        }}
      </QueryForm>
    );
  }
});
