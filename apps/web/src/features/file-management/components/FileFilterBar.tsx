import { RefreshLeft, Search } from '@element-plus/icons-vue';
import { ElButton, ElDatePicker, ElForm, ElFormItem, ElInput, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { fileTags } from '../categories';
import type { FileFilters } from '../composables/useFileList';

// 年份不能晚于今年，与旧页面一致
const isFutureYear = (date: Date) => date.getFullYear() > new Date().getFullYear();

/** 文件列表的筛选栏：编辑表单不触发请求，点"查询"或在名称框按回车才生效 */
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
  setup(props, { emit }) {
    // 查询表单的排布见 docs/design/page-layout.md 的"筛选栏"
    return () => (
      <ElForm class="form-query" labelWidth="auto">
        <ElFormItem label="文档名称">
          <ElInput
            modelValue={props.model.name}
            onUpdate:modelValue={(value: string) => {
              props.model.name = value;
            }}
            placeholder="请输入文档名称"
            clearable
            onKeydown={(event: Event | KeyboardEvent) => {
              if (event instanceof KeyboardEvent && event.key === 'Enter') {
                emit('search');
              }
            }}
          />
        </ElFormItem>
        <ElFormItem label="年份">
          <ElDatePicker
            type="year"
            valueFormat="YYYY"
            placeholder="请选择年份"
            disabledDate={isFutureYear}
            modelValue={props.model.year}
            onUpdate:modelValue={(value: string | null) => {
              props.model.year = value ?? '';
            }}
          />
        </ElFormItem>
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
        <div class="form-query__actions">
          <ElButton type="primary" icon={Search} onClick={() => emit('search')}>
            查询
          </ElButton>
          <ElButton icon={RefreshLeft} onClick={() => emit('reset')}>
            重置
          </ElButton>
        </div>
      </ElForm>
    );
  }
});
