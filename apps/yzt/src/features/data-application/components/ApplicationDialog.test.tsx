import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, reactive, ref } from 'vue';
import { required } from '@/shared/testing/required';
import type { Application } from '../api';
import type { ApplicationReviewOwner, AuditResult, ReviewState } from '../composables/useApplicationReview';
import { ApplicationDialog } from './ApplicationDialog';

const application: Application = {
  id: 'apply-1',
  name: '拆除未尽区',
  applicant: '王立',
  department: '江苏省基础地理信息中心',
  layerCode: 'bgdc_dltb_2022',
  region: '江苏省南京市',
  appliedAt: '2026-10-28 11:29:36',
  startTime: '2026-10-28 08:00:00',
  endTime: '2026-12-31 23:59:59',
  formats: ['gdb'],
  purpose: '用于城市更新专项核查',
  status: 'pending',
  reason: undefined,
  prepare: undefined
};

afterEach(() => {
  // 弹窗渲染在 body 下，不归组件管
  document.body.innerHTML = '';
});

// 拥有者的状态由用例直接改：打开的申请、读取状态、模式；提交由用例决定什么时候返回。
// 页面收到 close 时去掉打开的申请
function mountDialog() {
  const current = ref<Application | null>(application);
  const state = ref<ReviewState>('ready');
  const mode = ref<'audit' | 'view'>('audit');
  const pending = ref(false);
  const submits: ((result: AuditResult) => void)[] = [];
  const close = () => {
    state.value = 'closed';
    current.value = null;
  };
  const owner: ApplicationReviewOwner = {
    application: computed(() => current.value),
    state: computed(() => state.value),
    mode: computed(() => mode.value),
    form: reactive({ approved: true, reason: '' }),
    pending,
    submit: () =>
      new Promise<AuditResult>(resolve => {
        pending.value = true;
        submits.push(result => {
          pending.value = false;
          resolve(result);
        });
      }),
    retry: () => undefined
  };
  const downloads = { isDownloading: () => false, percentOf: () => null };
  // 淡出要用真实的过渡才看得到，不用默认的过渡替身
  mount(ApplicationDialog, {
    props: { owner, downloads, onClose: close },
    attachTo: document.body,
    global: { stubs: { transition: false } }
  });
  return { current, state, mode, submits, close };
}

const dialogText = () => document.querySelector('.el-dialog')?.textContent ?? '';
// 区块标题：待审核是"申请信息、审核意见"，只查看是"申请信息、审核结果"
const sections = () => [...document.querySelectorAll('.el-dialog h3')].map(title => title.textContent?.trim());

describe('ApplicationDialog 显示的内容', () => {
  it('关闭以后淡出期间仍显示关闭前的申请，不变成"申请不存在"', async () => {
    const owner = mountDialog();
    await vi.waitFor(() => expect(dialogText()).toContain('拆除未尽区'));

    owner.close();
    await nextTick();
    expect(dialogText()).toContain('拆除未尽区');
    expect(dialogText()).not.toContain('申请不存在');
  });

  it('提交以后审核结果先刷新进来、弹窗随后关上，淡出期间仍显示审核意见', async () => {
    const owner = mountDialog();
    await vi.waitFor(() => expect(sections()).toEqual(['申请信息', '审核意见']));

    const submitButton = required(
      [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(
        button => button.textContent?.trim() === '提交审核'
      ),
      '提交审核按钮'
    );
    submitButton.click();
    await vi.waitFor(() => expect(owner.submits).toHaveLength(1));
    owner.mode.value = 'view';
    await nextTick();
    expect(sections()).toEqual(['申请信息', '审核意见']);

    required(owner.submits[0], '提交')({ kind: 'success', id: 'apply-1', approved: true });
    await vi.waitFor(() => expect(owner.state.value).toBe('closed'));
    await nextTick();
    expect(sections()).toEqual(['申请信息', '审核意见']);

    // 关上以后不再保持：再打开别的申请时显示新的内容
    owner.current.value = { ...application, id: 'apply-2', name: '医疗机构面层', status: 'approved', reason: '' };
    owner.mode.value = 'view';
    owner.state.value = 'ready';
    await vi.waitFor(() => expect(dialogText()).toContain('医疗机构面层'));
    expect(sections()).toEqual(['申请信息', '审核结果']);
  });
});
