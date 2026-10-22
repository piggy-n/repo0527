import { Document, UploadFilled } from '@element-plus/icons-vue';
import { MxSection, MxTitle } from '@yzt/ui';
import {
  type CascaderOption,
  ElAlert,
  ElButton,
  ElCascader,
  ElDatePicker,
  ElDialog,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElOption,
  ElProgress,
  ElSelect,
  ElUpload,
  type UploadFile
} from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { type FileCategory, fileCategories, fileTags } from '../categories';
import type { FileUploadForm } from '../composables/useFileUploadForm';
import { formatFileBytes } from '../file-types';
import styles from './FileUploadDialog.module.scss';

// ElCascader 的选项类型带索引签名，转换一份，不改共享的分类配置
function toCascaderOptions(nodes: readonly FileCategory[]): CascaderOption[] {
  return nodes.map(node => ({
    value: node.id,
    label: node.label,
    children: node.children ? toCascaderOptions(node.children) : undefined
  }));
}

const categoryOptions = toCascaderOptions(fileCategories);

/** 上传弹窗：只显示草稿和这一批的状态；提交交给入口（useFileUpload），这里不发请求 */
export const FileUploadDialog = defineComponent({
  name: 'FileUploadDialog',
  props: {
    model: { type: Object as PropType<FileUploadForm>, required: true }
  },
  emits: {
    submit: () => true
  },
  setup(props, { emit }) {
    const totalBytes = computed(() => props.model.files.value.reduce((sum, file) => sum + file.size, 0));
    const showProgress = useDelayedFlag(() => props.model.busy.value);

    // 点过提交才显示校验错误
    const errorOf = (field: keyof FileUploadForm['errors']['value']) =>
      props.model.attempted.value ? props.model.errors.value[field] : '';

    function pick(file: UploadFile) {
      if (file.raw) {
        props.model.addFiles([file.raw]);
      }
    }

    function renderFields() {
      const { fields, locked } = props.model;
      return (
        <MxSection title="基本信息">
          <ElForm model={fields} labelPosition="top" disabled={locked.value}>
            <ElFormItem label="文件分类" required error={errorOf('categoryId')}>
              <ElCascader
                modelValue={fields.categoryId}
                onUpdate:modelValue={value => {
                  fields.categoryId = typeof value === 'string' ? value : '';
                }}
                options={categoryOptions}
                props={{ emitPath: false }}
                popperClass={styles.categoryPopup}
                placeholder="请选择具体分类"
              />
            </ElFormItem>
            <div class={styles.fieldRow}>
              <ElFormItem label="年份" required error={errorOf('year')}>
                <ElDatePicker
                  type="year"
                  valueFormat="YYYY"
                  modelValue={fields.year}
                  onUpdate:modelValue={(value: string | null) => {
                    fields.year = value ?? '';
                  }}
                  disabledDate={(date: Date) => date.getFullYear() > new Date().getFullYear()}
                  placeholder="请选择年份"
                />
              </ElFormItem>
              <ElFormItem label="业务类型标签" required error={errorOf('tag')}>
                <ElSelect
                  modelValue={fields.tag}
                  onUpdate:modelValue={(value: string) => {
                    fields.tag = value;
                  }}
                  placeholder="请选择业务类型标签"
                >
                  {fileTags.map(tag => <ElOption key={tag} label={tag} value={tag} />)}
                </ElSelect>
              </ElFormItem>
            </div>
            <ElFormItem label="备注">
              <ElInput
                modelValue={fields.remark}
                onUpdate:modelValue={(value: string) => {
                  fields.remark = value;
                }}
                type="textarea"
                rows={2}
                resize="vertical"
                placeholder="可选，补充这批文件的说明"
              />
            </ElFormItem>
          </ElForm>
        </MxSection>
      );
    }

    function renderFiles() {
      const { files, locked } = props.model;
      return (
        <MxSection title="待上传文件">
          <p class={styles.hint}>本次选择的文件共用以上分类、年份、标签与备注。</p>
          <ElUpload
            // 草稿清空后重建上传区，ElUpload 内部记着的文件随之清掉
            key={files.value.length === 0 ? 'empty' : 'files'}
            class={styles.upload}
            drag
            multiple
            autoUpload={false}
            showFileList={false}
            disabled={locked.value}
            onChange={pick}
          >
            <ElIcon size={28}>
              <UploadFilled />
            </ElIcon>
            <div>
              将文件拖到此处，或 <span class={styles.choose}>点击选择</span>
            </div>
            <span class={styles.hint}>支持同时选择多个文件</span>
          </ElUpload>
          {errorOf('files') && (
            <p class={styles.validation} role="alert">
              {errorOf('files')}
            </p>
          )}
          <ul class={styles.files} aria-label="待上传文件列表">
            {files.value.map((file, index) => (
              <li key={index}>
                <ElIcon>
                  <Document />
                </ElIcon>
                <span class={styles.fileName} title={file.name}>
                  {file.name}
                </span>
                <span class={styles.fileSize}>{formatFileBytes(file.size)}</span>
                <ElButton
                  link
                  type="danger"
                  disabled={locked.value}
                  aria-label={`移除 ${file.name}`}
                  onClick={() => props.model.removeFile(index)}
                >
                  移除
                </ElButton>
              </li>
            ))}
          </ul>
          <p class={styles.hint}>
            已选择 {files.value.length} 个文件，共 {formatFileBytes(totalBytes.value)}
          </p>
        </MxSection>
      );
    }

    // 发送中、等待处理、成功、失败四种状态；发送和处理延迟显示，很快完成时不闪一下
    function renderStatus() {
      const { phase, progress, progressOnly, failure } = props.model;
      const percent = progress.value?.percent ?? null;
      return (
        <div aria-live="polite" class={styles.status}>
          {showProgress.value && phase.value === 'sending' && (
            <>
              <p>{percent === null ? '正在发送文件，总大小暂不可用' : `正在发送文件 · ${percent}%`}</p>
              {percent !== null && <ElProgress percentage={percent} showText={false} />}
              <p class={styles.hint}>关闭窗口不影响正在上传的任务。</p>
            </>
          )}
          {showProgress.value && phase.value === 'processing' && (
            <ElAlert title="文件已发送，正在处理" type="info" closable={false} showIcon />
          )}
          {phase.value === 'success' && <ElAlert title="上传成功" type="success" closable={false} showIcon />}
          {phase.value === 'error' && (
            <ElAlert
              title={failure.value || '上传未完成'}
              // 没有收到成功确认不等于没有上传，先核对列表再重试
              description={progressOnly.value
                ? '未收到成功确认，请先核对列表。'
                : '未收到成功确认。请先核对列表，再决定是否重试。'}
              type="error"
              closable={false}
              showIcon
            />
          )}
        </div>
      );
    }

    function submitLabel() {
      const { busy, phase } = props.model;
      if (busy.value) {
        return '上传中';
      }
      return phase.value === 'error' ? '重新上传' : '开始上传';
    }

    function renderFooter() {
      const { phase, progressOnly, busy } = props.model;
      // 这一批已结束（成功，或关窗后在后台结束）时只能开始新的一批
      const finished = phase.value === 'success' || (progressOnly.value && !busy.value);
      return (
        <div class={styles.footer}>
          <div class={styles.footerActions}>
            <ElButton onClick={props.model.close}>关闭</ElButton>
            {finished ? (
              <ElButton type="primary" onClick={props.model.reset}>
                继续上传
              </ElButton>
            ) : (
              <ElButton type="primary" disabled={busy.value} onClick={() => emit('submit')}>
                {submitLabel()}
              </ElButton>
            )}
          </div>
        </div>
      );
    }

    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        title="上传文件"
        width="720px"
        top="6vh"
        appendToBody
        modelValue={props.model.visible.value}
        // 只在用户点关闭、按 Esc 时清草稿；关闭动画的事件不能把快速重新打开的窗口关掉
        beforeClose={done => {
          props.model.close();
          done();
        }}
        closeOnClickModal={false}
      >
        {{
          header: () => <MxTitle level="panel">上传文件</MxTitle>,
          default: () => (
            <div class={styles.dialogBody}>
              {!props.model.progressOnly.value && [renderFields(), renderFiles()]}
              {renderStatus()}
            </div>
          ),
          footer: renderFooter
        }}
      </ElDialog>
    );
  }
});
