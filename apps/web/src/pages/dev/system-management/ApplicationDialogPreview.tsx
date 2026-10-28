import { MxSection, MxTitle } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
  ElTag,
  type FormInstance,
  type FormRules
} from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { DATA_LAYERS } from '@/shared/data-request/catalog';
import { AuditStatusTag, hasPrepareStep, PrepareStatusText } from './ApplicationStatus';
import styles from './preview.module.scss';
import type { ApplicationSample } from './samples';
import type { SystemManagementDemo } from './useSystemManagementDemo';

const REASON_MAX_LENGTH = 200;

const layerLabel = (code: string | undefined) =>
  DATA_LAYERS.find(layer => layer.value === code)?.label ?? code;

/** 申请详情与审核：待审核的申请在详情下面填审核意见，其余只查看 */
export const ApplicationDialogPreview = defineComponent({
  name: 'ApplicationDialogPreview',
  props: {
    demo: { type: Object as PropType<SystemManagementDemo>, required: true }
  },
  setup(props) {
    const demo = props.demo;
    const formRef = ref<FormInstance>();
    // 弹窗宽 640 放得下两列；更窄时每行一项
    const narrow = useMediaQuery('(width < 640px)');
    const title = computed(() => (demo.mode.value === 'audit' ? '审核申请' : '申请详情'));

    const rules: FormRules = {
      reason: [
        {
          validator: (_rule, value: string, callback) => {
            if (!demo.form.approved && !value.trim()) {
              callback(new Error('请填写不通过的原因'));
              return;
            }
            callback();
          },
          trigger: 'blur'
        }
      ]
    };

    async function submit() {
      const valid = await formRef.value?.validate().catch(() => false);
      if (valid) {
        await demo.submit();
      }
    }

    function renderFields(row: ApplicationSample) {
      return (
        <ElDescriptions column={narrow.value ? 1 : 2} class={styles.descriptions}>
          <ElDescriptionsItem label="数据名称" span={narrow.value ? 1 : 2}>
            {row.name}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="申请人">{row.applicant}</ElDescriptionsItem>
          <ElDescriptionsItem label="申请处室">{row.department}</ElDescriptionsItem>
          <ElDescriptionsItem label="主题图层">{layerLabel(row.layerCode)}</ElDescriptionsItem>
          <ElDescriptionsItem label="行政区划">{row.region}</ElDescriptionsItem>
          <ElDescriptionsItem label="开始时间">{row.startTime}</ElDescriptionsItem>
          <ElDescriptionsItem label="结束时间">{row.endTime}</ElDescriptionsItem>
          <ElDescriptionsItem label="导出格式">
            <span class={styles.formats}>
              {row.formats.map(format => (
                <ElTag key={format} type="info">
                  {format}
                </ElTag>
              ))}
            </span>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="申请时间">{row.appliedAt}</ElDescriptionsItem>
          <ElDescriptionsItem label="申请用途" span={narrow.value ? 1 : 2}>
            {row.purpose}
          </ElDescriptionsItem>
        </ElDescriptions>
      );
    }

    function renderDownload(row: ApplicationSample) {
      const percent = demo.downloadPercent(row.id);
      if (percent !== undefined && demo.downloadFeedback.value === 'progress') {
        return <span class={styles.downloading}>下载 {percent}%</span>;
      }
      return (
        <ElButton
          link
          type="primary"
          loading={percent !== undefined}
          disabled={row.prepare !== 'success'}
          onClick={() => demo.download(row.id)}
        >
          下载
        </ElButton>
      );
    }

    function renderResult(row: ApplicationSample) {
      return (
        <MxSection title="审核结果">
          <ElDescriptions column={narrow.value ? 1 : 2} class={styles.descriptions}>
            <ElDescriptionsItem label="审核状态">
              <AuditStatusTag row={row} tableRowMode={demo.tableRowMode.value} />
            </ElDescriptionsItem>
            {hasPrepareStep(row) && (
              <ElDescriptionsItem label="数据准备">
                <span class={styles.prepareWithAction}>
                  <PrepareStatusText status={row.prepare} />
                  {renderDownload(row)}
                </span>
              </ElDescriptionsItem>
            )}
            {row.status === 'rejected' && (
              <ElDescriptionsItem label="不通过原因" span={narrow.value ? 1 : 2}>
                {row.reason}
              </ElDescriptionsItem>
            )}
          </ElDescriptions>
        </MxSection>
      );
    }

    function renderAudit() {
      const form = demo.form;
      return (
        <MxSection title="审核意见">
          <ElForm
            ref={formRef}
            model={form}
            rules={rules}
            labelPosition="top"
            disabled={demo.submitting.value}
            class={styles.auditForm}
          >
            <ElFormItem label="审核结果">
              <ElRadioGroup
                modelValue={form.approved}
                onUpdate:modelValue={(value: string | number | boolean | undefined) => {
                  form.approved = value === true;
                  formRef.value?.clearValidate('reason');
                }}
              >
                <ElRadio value={true}>通过</ElRadio>
                <ElRadio value={false}>不通过</ElRadio>
              </ElRadioGroup>
            </ElFormItem>
            {!form.approved && (
              <ElFormItem label="不通过的原因" prop="reason" required>
                <ElInput
                  type="textarea"
                  modelValue={form.reason}
                  onUpdate:modelValue={(value: string) => (form.reason = value)}
                  placeholder="申请人会在消息里看到这段原因"
                  maxlength={REASON_MAX_LENGTH}
                  showWordLimit
                  autosize={{ minRows: 3, maxRows: 6 }}
                />
              </ElFormItem>
            )}
          </ElForm>
        </MxSection>
      );
    }

    function renderBody() {
      const row = demo.current.value;
      if (demo.detailLoading.value) {
        return <ElSkeleton rows={6} animated />;
      }
      if (!row) {
        return null;
      }
      return (
        <>
          <MxSection title="申请信息">{renderFields(row)}</MxSection>
          {demo.mode.value === 'audit' ? renderAudit() : renderResult(row)}
        </>
      );
    }

    function renderFooter() {
      if (demo.mode.value !== 'audit' || demo.detailLoading.value) {
        return null;
      }
      return (
        <>
          <ElButton disabled={demo.submitting.value} onClick={demo.close}>
            取消
          </ElButton>
          <ElButton type="primary" loading={demo.submitting.value} onClick={() => void submit()}>
            提交审核
          </ElButton>
        </>
      );
    }

    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        modelValue={demo.openId.value !== null}
        onUpdate:modelValue={(open: boolean) => {
          if (!open) {
            demo.close();
          }
        }}
        beforeClose={(done: () => void) => {
          if (!demo.submitting.value) {
            done();
          }
        }}
        title={title.value}
        alignCenter
        appendToBody
        closeOnClickModal={false}
      >
        {{
          header: () => (
            <MxTitle level="panel" description={demo.current.value?.name}>
              {title.value}
            </MxTitle>
          ),
          default: renderBody,
          footer: renderFooter
        }}
      </ElDialog>
    );
  }
});
