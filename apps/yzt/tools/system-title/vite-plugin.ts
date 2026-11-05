import type { Logger, Plugin } from 'vite';
import type { OutlineConfig } from './paths.ts';
import { syncTitleOutline } from './sync.ts';

/** 开发服务器启动（修改 .env 后会自动重启）和构建开始时，按配置同步各段文字的轮廓 */
export function systemTitlePlugin({ fontPath, outlines }: OutlineConfig): Plugin {
  let logger: Logger | undefined;

  return {
    name: 'yzt:system-title',
    configResolved(config) {
      ({ logger } = config);
    },
    buildStart() {
      for (const spec of outlines) {
        const result = syncTitleOutline({ ...spec, fontPath });
        if (result === 'generated') {
          logger?.info(`[system-title] 已按"${spec.text}"重新生成轮廓`);
        } else if (result === 'font-missing') {
          logger?.warn(`[system-title] "${spec.text}"的轮廓需要更新，但找不到字体 ${fontPath}，沿用已提交的轮廓`);
        }
      }
    }
  };
}
