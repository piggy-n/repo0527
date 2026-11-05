import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceRecord } from '../api';
import {
  type ApplicationForm,
  applicationRequest,
  createApplicationForm,
  formatsForLayer
} from '../application-form';
import { type ApplicationSubmission, useDataApplicationMutation } from '../queries';

/** 一次提交的结果；null 表示没有发出，或页面已销毁、换了会话，界面不提示 */
export type ApplicationResult = { kind: 'success' } | { kind: 'error'; message: string } | null;

/**
 * 资源的数据下载申请：打开时按资源填默认值，切换图层时去掉新图层不支持的格式。
 * 提交期间不能关闭和重复提交；失败时保留填写的内容，可以直接重试。校验和提示由界面负责。
 * send 默认是真实的申请接口，组件样例页传入演示的提交
 */
export function useDataApplication(
  send: (submission: ApplicationSubmission) => Promise<unknown> = useDataApplicationMutation().mutateAsync
) {
  const session = useSessionStore();
  const sessionGuard = useSessionGuard();
  const open = ref(false);
  const target = shallowRef<ResourceRecord | null>(null);
  const form = reactive<ApplicationForm>({
    applyName: '',
    layerCode: '',
    regionPath: [],
    startTime: '',
    endTime: '',
    formats: [],
    purpose: ''
  });
  const pending = ref(false);
  const formats = computed(() => formatsForLayer(form.layerCode));
  let disposed = false;

  watch(
    () => form.layerCode,
    () => {
      const allowed = formats.value;
      form.formats = form.formats.filter(format => allowed.includes(format));
    }
  );
  // 换会话后旧表单不再提交，弹窗关闭；已发出的申请照常完成，但不报告结果
  watch(() => session.token, () => (open.value = false), { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    open.value = false;
  });

  function start(row: ResourceRecord) {
    if (pending.value) {
      return;
    }
    target.value = row;
    Object.assign(form, createApplicationForm(row));
    open.value = true;
  }

  /** 提交期间不关闭，避免结果出来时已经没有可以重试的表单 */
  function close() {
    if (!pending.value) {
      open.value = false;
    }
  }

  async function submit(): Promise<ApplicationResult> {
    if (!open.value || pending.value) {
      return null;
    }
    pending.value = true;
    const token = sessionGuard.capture();
    try {
      await send({ application: applicationRequest(form), token });
      if (disposed || !sessionGuard.isCurrent(token)) {
        return null;
      }
      open.value = false;
      return { kind: 'success' };
    } catch (cause) {
      if (disposed || !sessionGuard.isCurrent(token)) {
        return null;
      }
      return { kind: 'error', message: cause instanceof ApiError ? cause.message : '申请提交失败，请重试' };
    } finally {
      pending.value = false;
    }
  }

  return { open, target, form, formats, pending, start, close, submit };
}

export type DataApplicationOwner = ReturnType<typeof useDataApplication>;
