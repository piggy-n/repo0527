import { relative, resolve, sep } from 'node:path';
import type { Logger, Plugin } from 'vite';
import { describeReport, type IconsOptions, syncIcons } from './sync.ts';

/** 开发服务器启动、图标目录有变化、构建开始时，自动规范化图标并更新注册表；构建时有错误会失败 */
export function iconsPlugin(options: IconsOptions): Plugin {
  const dir = resolve(options.dir);
  let logger: Logger | undefined;
  let isBuild = false;

  const run = () => {
    const report = syncIcons(options, { write: true });
    for (const line of describeReport(report)) {
      logger?.info(`[icons] ${line}`);
    }
    return report;
  };

  return {
    name: 'yzt:icons',
    configResolved(config) {
      ({ logger } = config);
      isBuild = config.command === 'build';
    },
    buildStart() {
      const { errors } = run();
      if (errors.length && isBuild) {
        this.error(`[icons] 图标目录中有无法处理的文件：\n${errors.join('\n')}`);
      }
    },
    configureServer(server) {
      server.watcher.add(dir);
      // 只关心图标目录下一层的 SVG；改名、写回文件会再次触发，但第二次运行没有变化
      const onChange = (file: string) => {
        const path = relative(dir, file);
        if (!path.startsWith('..') && !path.includes(sep) && path.toLowerCase().endsWith('.svg')) {
          run();
        }
      };
      server.watcher.on('add', onChange);
      server.watcher.on('change', onChange);
      server.watcher.on('unlink', onChange);
    }
  };
}
