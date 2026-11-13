// 崩溃标记问"还在不在"（ADR 0155 第 4 节，docs/config/scene-tier.md"崩溃标记"）：广播的消息和替页面回答的 Worker 的协议。
// Worker 也导入它，只写类型和常量

/** 广播频道的名字 */
export const PING_CHANNEL = 'yzt.scene-tier';

/** 广播的消息：问还在不在、回答还在、检查的页面删了谁的标记 */
export type PingMessage =
  | { readonly kind: 'ping' }
  | { readonly kind: 'alive'; readonly id: string }
  | { readonly kind: 'removed'; readonly id: string };

/** 替页面回答"还在"的 Worker：listen 在 Worker 开始听广播以后结束 */
export interface ScenePingProtocol {
  readonly listen: {
    readonly request: { readonly channel: string; readonly id: string };
    readonly response: void;
  };
}
