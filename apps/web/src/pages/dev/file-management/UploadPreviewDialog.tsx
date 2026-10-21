import { Document, UploadFilled } from '@element-plus/icons-vue';
import { MxSection } from '@yzt/ui';
import {
  ElAlert, ElButton, ElCascader, ElDatePicker, ElDialog, ElForm, ElFormItem, ElIcon,
  ElInput, ElOption, ElProgress, ElSelect, ElUpload, type CascaderOption, type UploadFile
} from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { fileCategories, fileTags, type FileCategory } from '@/features/file-management/categories';
import type { UploadPreview } from './useUploadPreview';
import styles from './preview.module.scss';

// 适配选择器的索引签名，不改变共享的业务分类配置
const categoryOptions = (nodes: FileCategory[]): CascaderOption[] => nodes.map(node => ({
  value: node.id,
  label: node.label,
  children: node.children ? categoryOptions(node.children) : undefined
}));
const options = categoryOptions(fileCategories);
// 原型按字节展示数量级，不规定业务大小上限
const size = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

/** 使用真实组件确认上传字段、状态与关闭行为；状态由原型拥有者提供 */
export const UploadPreviewDialog = defineComponent({
  name: 'UploadPreviewDialog',
  props: { model: { type: Object as PropType<UploadPreview>, required: true } },
  setup(props) {
    const totalBytes = computed(() => props.model.files.value.reduce((sum, file) => sum + file.size, 0));
    const picked = (file: UploadFile) => {
      if (file.raw) {
        props.model.addFiles([file.raw]);
      }
    };

    return () => {
      const model = props.model;
      const error = (key: keyof typeof model.errors.value) => model.attempted.value ? model.errors.value[key] : '';
      return (
        <ElDialog
          class={styles.dialog}
          title="上传文档"
          width="720px"
          top="6vh"
          modelValue={model.visible.value}
          onUpdate:modelValue={value => { model.visible.value = value; }}
          closeOnClickModal={false}
        >
          {{
            default: () => <div class={styles.dialogBody}>
              <MxSection title="基本信息">
                <ElForm model={model.fields} labelPosition="top" disabled={model.locked.value}>
                  <ElFormItem label="文件分类" required error={error('categoryId')}>
                    <ElCascader
                      modelValue={model.fields.categoryId}
                      onUpdate:modelValue={value => {
                        model.fields.categoryId = typeof value === 'string' ? value : '';
                      }}
                      options={options}
                      props={{ emitPath: false }}
                      popperClass={styles.categoryPopup}
                      placeholder="请选择具体分类"
                    />
                  </ElFormItem>
                  <div class={styles.fieldRow}>
                    <ElFormItem label="年份" required error={error('year')}>
                      <ElDatePicker
                        type="year"
                        valueFormat="YYYY"
                        modelValue={model.fields.year}
                        onUpdate:modelValue={(value: string | null) => { model.fields.year = value ?? ''; }}
                        disabledDate={(date: Date) => date.getFullYear() > new Date().getFullYear()}
                        placeholder="请选择年份"
                      />
                    </ElFormItem>
                    <ElFormItem label="业务类型标签" required error={error('tag')}>
                      <ElSelect
                        modelValue={model.fields.tag}
                        onUpdate:modelValue={(value: string) => { model.fields.tag = value; }}
                        placeholder="请选择业务类型标签"
                      >
                        {fileTags.map(tag => <ElOption key={tag} label={tag} value={tag} />)}
                      </ElSelect>
                    </ElFormItem>
                  </div>
                  <ElFormItem label="备注">
                    <ElInput
                      modelValue={model.fields.remark}
                      onUpdate:modelValue={(value: string) => { model.fields.remark = value; }}
                      type="textarea"
                      rows={2}
                      resize="vertical"
                      placeholder="可选，补充这批文件的说明"
                    />
                  </ElFormItem>
                </ElForm>
              </MxSection>
              <MxSection title="待上传文件">
                <p class={styles.hint}>本次选择的文件共用以上分类、年份、标签与备注。</p>
                <ElUpload
                  key={model.files.value.length === 0 ? 'empty' : 'files'}
                  class={styles.upload}
                  drag
                  multiple
                  autoUpload={false}
                  showFileList={false}
                  disabled={model.locked.value}
                  onChange={picked}
                  accept=""
                >
                  <ElIcon size={28}><UploadFilled /></ElIcon>
                  <div>将文件拖到此处，或 <span class={styles.choose}>点击选择</span></div>
                  <span class={styles.hint}>支持同时选择多个文件</span>
                </ElUpload>
                {error('files') && <p class={styles.validation} role="alert">{error('files')}</p>}
                <ul class={styles.files} aria-label="待上传文件列表">
                  {model.files.value.map((file, index) => <li key={index}>
                    <ElIcon><Document /></ElIcon>
                    <span class={styles.fileName} title={file.name}>{file.name}</span>
                    <span class={styles.fileSize}>{size(file.size)}</span>
                    <ElButton
                      link
                      type="danger"
                      disabled={model.locked.value}
                      aria-label={`移除 ${file.name}`}
                      onClick={() => { model.files.value = model.files.value.filter((_, at) => at !== index); }}
                    >移除</ElButton>
                  </li>)}
                </ul>
                <p class={styles.hint}>已选择 {model.files.value.length} 个文件，共 {size(totalBytes.value)}</p>
              </MxSection>
              <div aria-live="polite" class={styles.status}>
                {model.phase.value === 'sending' && <>
                  <p>{model.result.value === 'unknown' ? '正在发送文件，总大小暂不可用' : `正在发送文件 · ${model.percent.value}%`}</p>
                  {model.result.value !== 'unknown' && <ElProgress percentage={model.percent.value} showText={false} />}
                  <p class={styles.hint}>可暂时收起窗口，回到页面继续查看进度。</p>
                </>}
                {model.phase.value === 'processing' &&
                  <ElAlert title="文件已发送，正在处理" type="info" closable={false} showIcon />}
                {model.phase.value === 'success' &&
                  <ElAlert title="上传成功，文件列表已更新" type="success" closable={false} showIcon />}
                {model.phase.value === 'error' && <ElAlert
                  title="上传未完成"
                  description="未收到成功确认。已保留所选文件和填写信息；请先核对列表，再决定是否重试。"
                  type="error"
                  closable={false}
                  showIcon
                />}
              </div>
            </div>,
            footer: () => <div class={styles.footer}>
              <span class={styles.hint}>{model.busy.value ? '收起窗口不会撤销上传' : '关闭窗口后保留本次填写'}</span>
              <div class={styles.footerActions}>
                <ElButton onClick={() => { model.visible.value = false; }}>{model.busy.value ? '暂时收起' : '关闭'}</ElButton>
                {model.phase.value === 'success'
                  ? <ElButton type="primary" onClick={model.reset}>继续上传</ElButton>
                  : <ElButton type="primary" disabled={model.busy.value} onClick={model.submit}>
                    {model.busy.value ? '上传中' : model.phase.value === 'error' ? '重新上传' : '开始上传'}
                  </ElButton>}
              </div>
            </div>
          }}
        </ElDialog>
      );
    };
  }
});
