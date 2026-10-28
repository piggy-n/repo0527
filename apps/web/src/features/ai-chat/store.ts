import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';

/** AI 后端的登录凭据（Bearer token），与系统的登录会话分开；账号来源与登录时机待定，见 docs/modules/ai-chat.md 的待办 */
export const useAiAuthStore = defineStore('ai-auth', () => {
  const token = ref<string | null>(null);

  function setToken(value: string) {
    token.value = value;
  }

  function reset() {
    token.value = null;
  }

  return { token, setToken, reset };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAiAuthStore, import.meta.hot));
}
