import { Document, UploadFilled } from '@element-plus/icons-vue';
import { MxSection, MxTitle } from '@yzt/ui';
import {
  ElAlert, ElButton, ElCascader, ElDatePicker, ElDialog, ElForm, ElFormItem, ElIcon,
  ElInput, ElOption, ElProgress, ElSelect, ElUpload, type CascaderOption, type UploadFile
} from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { fileCategories, fileTags, type FileCategory } from '../categories';
import type { FileUploadForm } from '../composables/useFileUploadForm';
import styles from './FileUploadDialog.module.scss';

// 适配选择器的索引签名，不改变共享的业务分类配置
const categoryOptions = (nodes: FileCategory[]): CascaderOption[] => nodes.map(node => ({
  value: node.id,
  label: node.label,
  children: node.children ? categoryOptions(node.children) : undefined
}));
const options = categoryOptions(fileCategories);
// 按字节展示数量级，不规定业务大小上限
const size = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

/** 上传界面只显示草稿和任务状态，提交由拥有者处理 */
export const FileUploadDialog = defineComponent({
  name: 'FileUploadDialog',
  props: { model: { type: Object as PropType<FileUploadForm>, required: true } },
  emits: { submit: () => true },
  setup(props, { emit }) {
    const totalBytes = computed(() => props.model.files.value.reduce((sum, file) => sum + file.size, 0));
    const showProgress = useDelayedFlag(() => props.model.busy.value);
    const picked = (file: UploadFile) => {
      if (file.raw) {
        props.model.addFiles([file.raw]);
      }
    };

    return () => {
      const model = props.model;
      const percent = model.progress.value?.percent ?? null;
      const error = (key: keyof typeof model.errors.value) => model.attempted.value ? model.errors.value[key] : '';
      return (
        <ElDialog
          class={['dialog-panel-header', styles.dialog]}
          title="上传文件"
          width="720px"
          top="6vh"
          appendToBody
          modelValue={model.visible.value}
          // 在 X / Esc 的用户动作时清草稿，动画事件不能关闭快速重开的窗口
          beforeClose={done => { model.close(); done(); }}
          closeOnClickModal={false}
        >
          {{
            header: () => <MxTitle level="panel">上传文件</MxTitle>,
            default: () => <div class={styles.dialogBody}>
              {!model.progressOnly.value && <><MxSection title="基本信息">
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
                      onClick={() => model.removeFile(index)}
                    >移除</ElButton>
                  </li>)}
                </ul>
                <p class={styles.hint}>已选择 {model.files.value.length} 个文件，共 {size(totalBytes.value)}</p>
              </MxSection></>}
              <div aria-live="polite" class={styles.status}>
                {showProgress.value && model.phase.value === 'sending' && <>
                  <p>{percent === null ? '正在发送文件，总大小暂不可用' : `正在发送文件 · ${percent}%`}</p>
                  {percent !== null && <ElProgress percentage={percent} showText={false} />}
                  <p class={styles.hint}>关闭窗口不影响正在上传的任务。</p>
                </>}
                {showProgress.value && model.phase.value === 'processing' &&
                  <ElAlert title="文件已发送，正在处理" type="info" closable={false} showIcon />}
                {model.phase.value === 'success' &&
                  <ElAlert title="上传成功" type="success" closable={false} showIcon />}
                {model.phase.value === 'error' && <ElAlert
                  title={model.failure.value || '上传未完成'}
                  description={model.progressOnly.value
                    ? '未收到成功确认，请先核对列表。'
                    : '未收到成功确认。请先核对列表，再决定是否重试。'}
                  type="error"
                  closable={false}
                  showIcon
                />}
              </div>
            </div>,
            footer: () => <div class={styles.footer}>
              <div class={styles.footerActions}>
                <ElButton onClick={model.close}>关闭</ElButton>
                {model.phase.value === 'success' || (model.progressOnly.value && !model.busy.value)
                  ? <ElButton type="primary" onClick={model.reset}>继续上传</ElButton>
                  : <ElButton type="primary" disabled={model.busy.value} onClick={() => emit('submit')}>
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
