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
  ElMessage,
  ElRadio,
  ElRadioGroup,
  ElSkeleton,
  ElTag,
  type FormInstance,
  type FormRules
} from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import { dataFormatLabel, dataLayerLabel } from '@/shared/data-request/catalog';
import { PrepareStatusText } from '@/shared/data-request/PrepareStatusText';
import { DownloadButton } from '@/shared/file-transfer/DownloadButton';
import type { RowDownloadState } from '@/shared/file-transfer/useRowDownloads';
import type { Application } from '../api';
import type { ApplicationReviewOwner } from '../composables/useApplicationReview';
import { canDownload, hasPrepareStep } from '../status';
import styles from './ApplicationDialog.module.scss';
import { AuditStatusTag } from './ApplicationStatus';

const REASON_MAX_LENGTH = 200;

// 没有值时显示"-"，和表格的全局样式一致（没有的字段整个键都不出现，或者是空字符串）
const EMPTY_VALUE = '-';
const shown = (value: string | undefined) => (value === undefined || value === '' ? EMPTY_VALUE : value);

/** 申请详情与审核（ADR 0091）：上面是申请信息，下面是审核意见（待审核）或审核结果；提交期间不能关闭 */
export const ApplicationDialog = defineComponent({
  name: 'ApplicationDialog',
  props: {
    owner: { type: Object as PropType<ApplicationReviewOwner>, required: true },
    // 和列表共用下载的状态：在哪里点下载，两边都显示进度
    downloads: { type: Object as PropType<RowDownloadState>, required: true }
  },
  emits: {
    close: () => true,
    download: (_application: Application) => true
  },
  setup(props, { emit }) {
    const owner = props.owner;
    const formRef = ref<FormInstance>();
    // 校验期间不重复提交；提交中的防重复由拥有者负责
    const validating = ref(false);
    // 弹窗宽 640 放得下两列；更窄时每行一项
    const narrow = useMediaQuery('(width < 640px)');
    const columns = computed(() => (narrow.value ? 1 : 2));
    // 从消息打开时要先读详情；很快读完时不闪骨架屏
    const showSkeleton = useDelayedFlag(() => owner.state.value === 'loading');
    const title = computed(() => (owner.mode.value === 'audit' ? '审核申请' : '申请详情'));

    const rules: FormRules = {
      reason: [
        {
          validator: (_rule, value: string, callback) => {
            if (!owner.form.approved && !value.trim()) {
              callback(new Error('请填写不通过的原因'));
              return;
            }
            callback();
          },
          trigger: 'blur'
        }
      ]
    };

    function close() {
      if (!owner.pending.value) {
        emit('close');
      }
    }

    async function submit() {
      if (validating.value || owner.pending.value) {
        return;
      }
      validating.value = true;
      const valid = await formRef.value?.validate().catch(() => false);
      validating.value = false;
      if (!valid) {
        return;
      }
      const result = await owner.submit();
      if (result?.kind === 'success') {
        ElMessage.success(result.approved ? '已审核通过' : '已退回申请');
        // 提交期间换成了别的申请时（如浏览器后退），不关掉那一条
        if (owner.application.value?.id === result.id) {
          emit('close');
        }
      } else if (result?.kind === 'error') {
        ElMessage.error(result.message);
      }
    }

    function renderInformation(application: Application) {
      const wide = columns.value;
      return (
        <MxSection title="申请信息">
          <ElDescriptions class={styles.descriptions} column={wide}>
            <ElDescriptionsItem label="数据名称" span={wide}>
              {shown(application.name)}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="申请人">{shown(application.applicant)}</ElDescriptionsItem>
            <ElDescriptionsItem label="申请处室">{application.department}</ElDescriptionsItem>
            <ElDescriptionsItem label="主题图层">
              {application.layerCode === undefined ? EMPTY_VALUE : dataLayerLabel(application.layerCode)}
            </ElDescriptionsItem>
            <ElDescriptionsItem label="行政区划">{shown(application.region)}</ElDescriptionsItem>
            <ElDescriptionsItem label="开始时间">{application.startTime}</ElDescriptionsItem>
            <ElDescriptionsItem label="结束时间">{application.endTime}</ElDescriptionsItem>
            <ElDescriptionsItem label="导出格式">
              <span class={styles.formats}>
                {application.formats.map(format => (
                  <ElTag key={format} type="info">
                    {dataFormatLabel(format)}
                  </ElTag>
                ))}
              </span>
            </ElDescriptionsItem>
            <ElDescriptionsItem label="申请时间">{shown(application.appliedAt)}</ElDescriptionsItem>
            <ElDescriptionsItem label="申请用途" span={wide}>
              {shown(application.purpose)}
            </ElDescriptionsItem>
          </ElDescriptions>
        </MxSection>
      );
    }

    function renderResult(application: Application) {
      return (
        <MxSection title="审核结果">
          <ElDescriptions class={styles.descriptions} column={columns.value}>
            <ElDescriptionsItem label="审核状态">
              <AuditStatusTag status={application.status} />
            </ElDescriptionsItem>
            {hasPrepareStep(application) && (
              <ElDescriptionsItem label="数据准备">
                <span class={styles.prepare}>
                  <PrepareStatusText status={application.prepare} />
                  <DownloadButton
                    downloading={props.downloads.isDownloading(application.id)}
                    percent={props.downloads.percentOf(application.id)}
                    disabled={!canDownload(application)}
                    onClick={() => emit('download', application)}
                  />
                </span>
              </ElDescriptionsItem>
            )}
            {application.status === 'rejected' && (
              <ElDescriptionsItem label="不通过原因" span={columns.value}>
                {shown(application.reason)}
              </ElDescriptionsItem>
            )}
          </ElDescriptions>
        </MxSection>
      );
    }

    function renderAudit() {
      const form = owner.form;
      return (
        <MxSection title="审核意见">
          <ElForm
            ref={formRef}
            class={styles.form}
            model={form}
            rules={rules}
            labelPosition="top"
            disabled={owner.pending.value}
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
      const state = owner.state.value;
      const application = owner.application.value;
      if (state === 'loading') {
        return showSkeleton.value ? <ElSkeleton rows={6} animated /> : null;
      }
      if (state === 'error') {
        return (
          <div class={styles.message}>
            读取申请失败
            <ElButton link type="primary" onClick={owner.retry}>
              重试
            </ElButton>
          </div>
        );
      }
      if (state === 'missing' || !application) {
        return <div class={styles.message}>申请不存在或已被删除</div>;
      }
      return [
        renderInformation(application),
        owner.mode.value === 'audit' ? renderAudit() : renderResult(application)
      ];
    }

    function renderFooter() {
      if (owner.state.value !== 'ready' || owner.mode.value !== 'audit') {
        return null;
      }
      return (
        <>
          <ElButton disabled={owner.pending.value} onClick={close}>
            取消
          </ElButton>
          <ElButton type="primary" loading={owner.pending.value} onClick={() => void submit()}>
            提交审核
          </ElButton>
        </>
      );
    }

    return () => (
      <ElDialog
        class={['dialog-panel-header', styles.dialog]}
        // 弹窗开关跟着路由：打开的申请没了就关上（ADR 0091）
        modelValue={owner.state.value !== 'closed'}
        // 点关闭、按 Esc 时立即通知页面去掉查询参数；Element 的 update:modelValue 要等淡出结束才发出，不用它。
        // 提交期间不关
        beforeClose={(done: () => void) => {
          if (!owner.pending.value) {
            done();
            emit('close');
          }
        }}
        title={title.value}
        alignCenter
        appendToBody
        closeOnClickModal={false}
      >
        {{
          header: () => (
            <MxTitle level="panel" description={owner.application.value?.name}>
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
