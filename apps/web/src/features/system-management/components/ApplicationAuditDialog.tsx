import { MxTitle } from '@yzt/ui';
import { ElButton, ElDialog, ElInput, ElMessage, ElRadio, ElRadioGroup, ElSkeleton } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { useApplicationAudit } from '../composables/useApplicationAudit';
import { auditLabels, taskLabel } from '../presentation';
import styles from './system-management.module.scss';

// 空值和表格的全局样式一致，显示"-"
const EMPTY_VALUE = '-';

// 组件只需触发重试，不依赖查询库的返回对象，固定数据预览也复用同一弹窗
export type ApplicationAuditModel = Omit<ReturnType<typeof useApplicationAudit>, 'retry'> & {
  retry: () => Promise<unknown>;
};

export const ApplicationAuditDialog = defineComponent({
  name: 'ApplicationAuditDialog',
  props: { model: { type: Object as PropType<ApplicationAuditModel>, required: true } },
  setup(props) {
    const skeleton = useDelayedFlag(() => props.model.loading.value);
    const busy = useDelayedFlag(() => props.model.submitting.value);

    async function submit() {
      if (await props.model.submit()) {
        ElMessage.success('审核结果已提交');
      }
    }

    function renderDetail() {
      const model = props.model;
      if (model.loadFailed.value) {
        return (
          <div role="alert">
            申请详情加载失败
            <ElButton link type="primary" onClick={model.retry}>
              重试
            </ElButton>
          </div>
        );
      }
      if (model.loading.value) {
        return (
          <div class={styles.detailLoading}>
            {skeleton.value && <ElSkeleton rows={5} animated />}
          </div>
        );
      }
      const detail = model.detail.value;
      if (!detail) {
        return null;
      }
      return (
        <>
          <dl class={styles.details}>
            <dt>申请处室</dt>
            <dd>{detail.receiver_dept_name || EMPTY_VALUE}</dd>
            <dt>数据名称</dt>
            <dd>{detail.apply_name}</dd>
            <dt>资源标识</dt>
            <dd>{detail.layer_code || EMPTY_VALUE}</dd>
            <dt>行政区划</dt>
            <dd>{detail.xzqmc || EMPTY_VALUE}</dd>
            <dt>时间范围</dt>
            <dd>
              {detail.start_date || EMPTY_VALUE} 至 {detail.end_date || EMPTY_VALUE}
            </dd>
            <dt>导出格式</dt>
            <dd>{detail.data_formats || EMPTY_VALUE}</dd>
            <dt>申请用途</dt>
            <dd>{detail.apply_purpose || EMPTY_VALUE}</dd>
            <dt>审核状态</dt>
            <dd>{auditLabels[detail.status]}</dd>
            <dt>准备状态</dt>
            <dd>{taskLabel(detail.storage_status) || EMPTY_VALUE}</dd>
            {detail.status === 'rejected' && [
              <dt>不通过原因</dt>,
              <dd>{detail.remark || EMPTY_VALUE}</dd>
            ]}
          </dl>
          {model.editable.value && (
            <div class={styles.decision}>
              <MxTitle level="section">审核结果</MxTitle>
              <ElRadioGroup
                modelValue={model.decision.value}
                disabled={model.submitting.value}
                onUpdate:modelValue={value => {
                  model.decision.value = value === 'approved' ? 'approved' : 'rejected';
                  model.failure.value = '';
                }}
              >
                <ElRadio value="approved">通过</ElRadio>
                <ElRadio value="rejected">不通过</ElRadio>
              </ElRadioGroup>
              {model.decision.value === 'rejected' && (
                <ElInput
                  type="textarea"
                  rows={3}
                  maxlength={500}
                  showWordLimit
                  disabled={model.submitting.value}
                  modelValue={model.reason.value}
                  onUpdate:modelValue={(value: string) => (model.reason.value = value)}
                  placeholder="请填写不通过原因"
                  aria-label="不通过原因"
                />
              )}
              {model.failure.value && <p class={styles.error} role="alert">{model.failure.value}</p>}
            </div>
          )}
        </>
      );
    }

    return () => {
      const model = props.model;
      const title = model.editable.value ? '资源审核' : '申请详情';
      return (
        <ElDialog
          class={['dialog-panel-header', styles.dialog]}
          modelValue={model.selectedId.value !== undefined}
          onUpdate:modelValue={(open: boolean) => {
            if (!open) {
              model.close();
            }
          }}
          title={title}
          width="min(560px, calc(100vw - 32px))"
          top="6vh"
          closeOnClickModal={false}
          closeOnPressEscape={!model.submitting.value}
          showClose={!model.submitting.value}
          destroyOnClose
        >
          {{
            header: () => <MxTitle level="panel">{title}</MxTitle>,
            default: renderDetail,
            footer: () => [
              <ElButton disabled={model.submitting.value} onClick={model.close}>
                {model.editable.value ? '取消' : '关闭'}
              </ElButton>,
              model.editable.value && (
                <ElButton type="primary" disabled={model.submitting.value} loading={busy.value} onClick={submit}>
                  提交审核
                </ElButton>
              )
            ]
          }}
        </ElDialog>
      );
    };
  }
});
