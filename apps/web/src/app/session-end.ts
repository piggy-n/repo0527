import { useSessionStore } from '@/shared/auth/session-store';
import { queryClient } from './query-client';

/** 会话结束（退出、登录过期、其他标签页退出）时的统一清理；跳转和提示因场景而异，由调用方负责（docs/modules/auth.md） */
export function endSession(): void {
  // 清空查询缓存会同时取消进行中的查询：上一个账号的数据不会留给之后登录的账号，晚到的结果和错误提示也不会出现
  queryClient.clear();
  useSessionStore().clear();
}
