import type { Logger, Plugin } from 'vite';
import { type SyncOptions, syncTitleOutline } from './sync.ts';

/** 开发服务器启动（修改 .env 后会自动重启）和构建开始时，按 VITE_APP_TITLE 同步标题轮廓 */
export function systemTitlePlugin(options: SyncOptions): Plugin {
  let logger: Logger | undefined;

  return {
    name: 'yzt:system-title',
    configResolved(config) {
      ({ logger } = config);
    },
    buildStart() {
      const result = syncTitleOutline(options);
      if (result === 'generated') {
        logger?.info(`[system-title] 已按"${options.text}"重新生成标题轮廓`);
      } else if (result === 'font-missing') {
        logger?.warn(`[system-title] 标题文字已变化，但找不到字体 ${options.fontPath}，沿用已提交的轮廓`);
      }
    }
  };
}
