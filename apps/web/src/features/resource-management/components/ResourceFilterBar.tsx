import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { QueryForm } from '@/shared/query-form/QueryForm';
import type { ResourceYear } from '../api';
import type { ResourceFilters } from '../composables/useResourceList';

/** 资源列表的筛选栏：名称和年份是草稿，点"查询"或回车后才生效（由 useResourceList 处理） */
export const ResourceFilterBar = defineComponent({
  name: 'ResourceFilterBar',
  props: {
    model: { type: Object as PropType<ResourceFilters>, required: true },
    years: { type: Array as PropType<ResourceYear[]>, required: true },
    loadingYears: Boolean,
    errorYears: Boolean,
    disabled: Boolean
  },
  emits: {
    search: () => true,
    reset: () => true
  },
  setup(props, { emit }) {
    const showLoading = useDelayedFlag(() => props.loadingYears);

    // 回车查询；输入法选字时的回车不算
    function onNameKeydown(event: Event | KeyboardEvent) {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      if (!event.isComposing) {
        emit('search');
      }
    }

    return () => (
      <QueryForm labelChars={4}>
        {{
          default: () => [
            <ElFormItem label="资源名称">
              <ElInput
                modelValue={props.model.name}
                onUpdate:modelValue={(value: string) => {
                  props.model.name = value;
                }}
                placeholder="请输入资源名称"
                clearable
                disabled={props.disabled}
                onKeydown={onNameKeydown}
              />
            </ElFormItem>,
            <ElFormItem label="年份">
              <ElSelect
                modelValue={props.model.year}
                onUpdate:modelValue={(value: string | undefined) => {
                  // 清空时是 undefined，表单里用空字符串表示不筛选
                  props.model.year = value ?? '';
                }}
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
            <ElButton icon={RefreshLeft} disabled={props.disabled} onClick={() => emit('reset')}>
              重置
            </ElButton>
          ]
        }}
      </QueryForm>
    );
  }
});
