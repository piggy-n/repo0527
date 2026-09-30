import type { FormInstance, FormRules } from 'element-plus';
import { onScopeDispose, reactive, ref } from 'vue';
import { type Session, useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import { type LoginCredentials, login } from '../api';

/** 登录表单的状态与提交逻辑，不含界面：不渲染、不跳转、不弹提示，这些由使用它的组件决定 */
export function useLoginForm() {
  const session = useSessionStore();

  // 绑定到 ElForm 的 ref，用来调用它的 validate()
  const formRef = ref<FormInstance>();
  const model = reactive<LoginCredentials>({ loginName: '', password: '' });
  // blur：离开输入框时检查；change：ElInput 在值变化时触发，浏览器自动填充写入值时也会触发，
  // 只写 blur 的话，未聚焦的输入框被自动填充后不会失焦，之前的错误提示会一直留着
  const trigger = ['blur', 'change'];
  const rules: FormRules<LoginCredentials> = {
    // whitespace：只输入空格也视为未填写
    loginName: [{ required: true, whitespace: true, message: '请输入账号', trigger }],
    password: [{ required: true, message: '请输入密码', trigger }]
  };
  const submitting = ref(false);
  const errorMessage = ref('');
  // 表单销毁时取消进行中的登录，晚到的结果不能再写入会话：此时可能已经建立了别的会话
  const controller = new AbortController();
  onScopeDispose(() => controller.abort());

  /** 校验并登录，成功时保存会话并返回它；校验未通过或登录失败时返回 undefined，失败原因见 errorMessage */
  async function submit(): Promise<Session | undefined> {
    // 回车和点击可能同时触发，提交中直接忽略；标志在第一个 await 之前设置，所以不需要防抖
    if (submitting.value) {
      return undefined;
    }
    submitting.value = true;
    errorMessage.value = '';
    try {
      // 校验不通过时 validate() 会 reject，带上出错的字段；错误文字由 ElFormItem 显示
      const valid = await formRef.value?.validate().catch(() => false);
      if (!valid) {
        return undefined;
      }
      const { signal } = controller;
      const result = await login({ loginName: model.loginName.trim(), password: model.password }, signal);
      // 响应已收到、这里还没执行时表单被销毁，取消来不及生效
      if (signal.aborted) {
        return undefined;
      }
      session.start(result);
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        // 表单销毁时取消的请求，不需要显示原因
        if (error.kind !== 'canceled') {
          errorMessage.value = error.message;
        }
        return undefined;
      }
      throw error;
    } finally {
      submitting.value = false;
    }
  }

  return { formRef, model, rules, submitting, errorMessage, submit };
}
