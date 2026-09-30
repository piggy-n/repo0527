import { ElButton, ElForm, ElFormItem, ElInput, ElMessage } from 'element-plus';
import { defineComponent } from 'vue';
import type { Session } from '@/shared/auth/session-store';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { useLoginForm } from '../composables/useLoginForm';
import styles from './LoginForm.module.scss';

/** 登录表单的界面，状态与提交逻辑在 useLoginForm；登录成功时触发 success，跳转到哪里由页面决定 */
export const LoginForm = defineComponent({
  name: 'LoginForm',
  emits: {
    success: (session: Session) => Boolean(session.token)
  },
  setup(_, { emit }) {
    const { formRef, model, rules, submitting, errorMessage, submit } = useLoginForm();

    const handleSubmit = async () => {
      const session = await submit();
      if (session) {
        emit('success', session);
      } else if (errorMessage.value) {
        ElMessage.error(errorMessage.value);
      }
    };

    // 在输入框中按回车提交；用输入法选字时按的回车不算。ElForm 的类型没有声明 onSubmit，所以不监听表单的 submit 事件
    const submitOnEnter = (event: KeyboardEvent | Event) => {
      if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
        void handleSubmit();
      }
    };

    return () => (
      <ElForm ref={formRef} model={model} rules={rules} size="large">
        <ElFormItem prop="loginName">
          <ElInput
            modelValue={model.loginName}
            onUpdate:modelValue={value => {
              model.loginName = value;
            }}
            onKeydown={submitOnEnter}
            placeholder="请输入账号"
            autocomplete="username"
          >
            {{ prefix: () => <SvgIcon name="auth-user" /> }}
          </ElInput>
        </ElFormItem>
        <ElFormItem prop="password">
          <ElInput
            modelValue={model.password}
            onUpdate:modelValue={value => {
              model.password = value;
            }}
            onKeydown={submitOnEnter}
            type="password"
            showPassword
            placeholder="请输入密码"
            autocomplete="current-password"
          >
            {{ prefix: () => <SvgIcon name="auth-lock" /> }}
          </ElInput>
        </ElFormItem>
        <ElButton class={styles.submit} type="primary" loading={submitting.value} onClick={handleSubmit}>
          登录
        </ElButton>
      </ElForm>
    );
  }
});
