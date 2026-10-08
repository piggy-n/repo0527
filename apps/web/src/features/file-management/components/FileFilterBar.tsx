import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElDatePicker, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType, type SlotsType, type VNode } from 'vue';
import { QueryForm } from '@/shared/query-form/QueryForm';
import { fileTags } from '../categories';
import type { FileFilters } from '../composables/useFileList';

// 年份不能晚于今年，与旧页面一致
const isFutureYear = (date: Date) => date.getFullYear() > new Date().getFullYear();

/** 文件列表的筛选栏：编辑表单不触发请求，点"查询"或在名称框按回车才生效；extra 放在按钮行的右端（如上传） */
export const FileFilterBar = defineComponent({
  name: 'FileFilterBar',
  props: {
    // 和 ElForm 的 model 一样，直接修改传入的响应式对象的字段
    model: { type: Object as PropType<FileFilters>, required: true }
  },
  emits: {
    search: () => true,
    reset: () => true
  },
  slots: Object as SlotsType<{
    extra?: () => VNode[];
  }>,
  setup(props, { emit, slots }) {
    return () => (
      <QueryForm labelChars={6}>
        {{
          default: () => [
            <ElFormItem label="文档名称">
              <ElInput
                modelValue={props.model.name}
                onUpdate:modelValue={(value: string) => {
                  props.model.name = value;
                }}
                placeholder="请输入文档名称"
                clearable
                onKeydown={(event: Event | KeyboardEvent) => {
                  // 输入法选字时按的回车只是确认候选词，不查询
                  if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
                    emit('search');
                  }
                }}
              />
            </ElFormItem>,
            <ElFormItem label="年份">
              <ElDatePicker
                type="year"
                valueFormat="YYYY"
                placeholder="全部"
                disabledDate={isFutureYear}
                modelValue={props.model.year}
                onUpdate:modelValue={(value: string | null) => {
                  props.model.year = value ?? '';
                }}
              />
            </ElFormItem>,
            <ElFormItem label="业务类型标签">
              <ElSelect
                placeholder="全部"
                clearable
                modelValue={props.model.tag}
                onUpdate:modelValue={(value: string | undefined) => {
                  props.model.tag = value ?? '';
                }}
              >
                {fileTags.map(tag => (
                  <ElOption key={tag} label={tag} value={tag} />
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
          ],
          extra: slots.extra
        }}
      </QueryForm>
    );
  }
});
